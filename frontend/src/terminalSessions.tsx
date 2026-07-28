import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// 一个在 App 内部打开的终端会话（选项卡标签页）。
//
// id 是会话自身的唯一标识，assetId 才是它连的主机。两者早先是同一个值，
// 导致同一台主机只能开一个终端——第二次连接只会切到已有标签。
export interface TermSession {
  id: number;      // 会话唯一 ID（同一主机可开多个）
  assetId: number; // 连接的资产 ID（本地终端为负数）
  name: string;
  ip: string;
  customName?: string; // 用户自定义标签名（重命名）
  color?: string;      // 用户自定义标签颜色
}

/** 新建会话的入参：会话 ID 由 open() 内部分配 */
export type NewSession = Omit<TermSession, 'id'>;

// 会话 ID 生成器：正数递增，与资产 ID 无关
let sessionSeq = 1;
const nextSessionId = () => sessionSeq++;

const META_KEY = 'term_tab_meta';
type TabMeta = Record<number, { name?: string; color?: string }>;
const loadTabMeta = (): TabMeta => {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') as TabMeta; } catch { return {}; }
};
const saveTabMeta = (m: TabMeta) => {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

export interface GlobalWSHandler {
  send: (data: string | ArrayBuffer | Blob | ArrayBufferView) => void;
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'idle';
  assetId: number;
}

interface TerminalCtx {
  sessions: TermSession[];
  activeId: number | null;
  /** 新开一个终端会话；同一台主机可以开多个（会话 ID 由内部生成） */
  open: (s: NewSession) => void;
  /** 关闭一个会话 */
  close: (id: number) => void;
  /** 切换当前激活的会话；传 null 表示回到普通页面 */
  setActive: (id: number | null) => void;
  /** 拖拽重排：把 dragId 移动到 overId 所在位置 */
  reorder: (dragId: number, overId: number) => void;
  /** 非激活会话有新输出时标记活动（标签显示提示点）；激活该会话即清除 */
  activityIds: number[];
  markActivity: (id: number) => void;
  /** 重命名标签 / 设置标签颜色（持久化，重开同一资产沿用） */
  renameSession: (id: number, name: string) => void;
  recolorSession: (id: number, color: string) => void;

  // 全局终端协同同步交互支持
  globalSyncedIds: string[];
  setGlobalSyncedIds: React.Dispatch<React.SetStateAction<string[]>>;
  connectedIds: string[];
  registerGlobalWS: (instanceId: string, handler: GlobalWSHandler | null) => void;
  broadcastGlobalData: (sourceId: string, data: string) => void;
  syncAllConnected: (checked: boolean) => void;
}

const Ctx = createContext<TerminalCtx | null>(null);

export const useTerminals = (): TerminalCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTerminals 必须在 TerminalProvider 内使用');
  return c;
};

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [activeId, setActiveRaw] = useState<number | null>(null);
  const [activityIds, setActivityIds] = useState<number[]>([]);

  // 全局同步会话物理连接注册表与选择集
  const globalWsRegistry = useRef<Record<string, GlobalWSHandler>>({});
  const [globalSyncedIds, setGlobalSyncedIds] = useState<string[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  const clearActivity = (id: number) =>
    setActivityIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));

  const markActivity = useCallback((id: number) => {
    setActivityIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  // 切换激活会话：清除其活动提示
  const setActive = useCallback((id: number | null) => {
    setActiveRaw(id);
    if (id != null) clearActivity(id);
  }, []);

  // 每次调用都新开一个会话；同一台主机可以开任意多个终端。
  // 标签的重命名/配色仍按资产维度记忆（同主机的多个标签共用同一份）。
  const open = useCallback((s: NewSession) => {
    const sid = nextSessionId();
    const meta = loadTabMeta()[s.assetId];
    setSessions((prev) => [...prev, { ...s, id: sid, customName: meta?.name, color: meta?.color }]);
    setActiveRaw(sid);
    clearActivity(sid);
  }, []);

  // 持久化按资产维度存（会话 ID 每次都变，存了也对不上）
  const renameSession = useCallback((id: number, name: string) => {
    const v = name.trim();
    let assetId: number | null = null;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      assetId = s.assetId;
      return { ...s, customName: v || undefined };
    }));
    if (assetId != null) {
      const m = loadTabMeta();
      m[assetId] = { ...(m[assetId] || {}), name: v || undefined };
      saveTabMeta(m);
    }
  }, []);

  const recolorSession = useCallback((id: number, color: string) => {
    let assetId: number | null = null;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      assetId = s.assetId;
      return { ...s, color: color || undefined };
    }));
    if (assetId != null) {
      const m = loadTabMeta();
      m[assetId] = { ...(m[assetId] || {}), color: color || undefined };
      saveTabMeta(m);
    }
  }, []);

  const close = useCallback((id: number) => {
    setSessions((prev) => prev.filter((x) => x.id !== id));
    // 关闭的若是当前激活会话，则回到普通页面
    setActiveRaw((cur) => (cur === id ? null : cur));
    clearActivity(id);
  }, []);

  const reorder = useCallback((dragId: number, overId: number) => {
    if (dragId === overId) return;
    setSessions((prev) => {
      const from = prev.findIndex((x) => x.id === dragId);
      const to = prev.findIndex((x) => x.id === overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const registerGlobalWS = useCallback((instanceId: string, handler: GlobalWSHandler | null) => {
    if (handler && handler.status === 'connected') {
      globalWsRegistry.current[instanceId] = handler;
      setConnectedIds((prev) => (prev.includes(instanceId) ? prev : [...prev, instanceId]));
    } else {
      delete globalWsRegistry.current[instanceId];
      setConnectedIds((prev) => prev.filter((id) => id !== instanceId));
      setGlobalSyncedIds((prev) => prev.filter((id) => id !== instanceId));
    }
  }, []);

  const broadcastGlobalData = useCallback((sourceId: string, data: string) => {
    // 只有当源终端本身也加入了同步组中，才进行全局广播
    if (!globalSyncedIds.includes(sourceId)) return;

    const encoder = new TextEncoder();
    const encoded = encoder.encode(data);

    globalSyncedIds.forEach((id) => {
      const handler = globalWsRegistry.current[id];
      if (handler && handler.status === 'connected') {
        handler.send(encoded);
      }
    });
  }, [globalSyncedIds]);

  const syncAllConnected = useCallback((checked: boolean) => {
    if (checked) {
      // 一键同步所有当前已成功连结的终端实例
      const ids = Object.entries(globalWsRegistry.current)
        .filter(([_, handler]) => handler.status === 'connected')
        .map(([id]) => id);
      setGlobalSyncedIds(ids);
    } else {
      setGlobalSyncedIds([]);
    }
  }, []);

  return (
    <Ctx.Provider value={{
      sessions,
      activeId,
      open,
      close,
      setActive,
      reorder,
      activityIds,
      markActivity,
      renameSession,
      recolorSession,
      globalSyncedIds,
      setGlobalSyncedIds,
      connectedIds,
      registerGlobalWS,
      broadcastGlobalData,
      syncAllConnected
    }}>
      {children}
    </Ctx.Provider>
  );
};
