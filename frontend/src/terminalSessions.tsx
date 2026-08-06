import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

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

// 标签名/颜色按 assetId 持久化，前提是 assetId 代表一台稳定的主机——只有正数资产 ID 满足。
// 负数是合成 ID：本地终端的 -1/-2/-3 是「当前开着第几个」算出来的槽位号，K8s Pod 的
// ≤ -1000 是本次页面加载内的登记顺序，两者都不指向固定的东西。给它们存名字的后果是
// 名字会串台：把第 2 个本地终端改名 rustshell，下次再开第 2 个本地终端（哪怕是完全
// 不相干的一个 Shell）就又叫 rustshell 了。所以合成 ID 的改名/改色只在本次会话内有效。
const isPersistableAssetId = (assetId: number): boolean => assetId > 0;
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
  /** 打开资产终端：已有该主机的会话则聚焦，否则新建 */
  open: (s: NewSession) => void;
  /** 复制一个终端：对同一主机再开一个独立会话 */
  duplicate: (id: number) => void;
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

  // close() 里要知道「被关掉的那个排第几」才能挑相邻标签，而 setState 的更新函数
  // 必须是纯的（StrictMode 下会跑两次），不能在里面顺手改另一个 state。
  // 所以用一个 ref 跟住列表，供 close() 只读地算位置。
  const sessionsRef = useRef<TermSession[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

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

  // 打开资产终端：已有该主机的会话就聚焦过去，没有才新建。
  // 本意是「打开这台资产」，不该每点一次就多出一个标签；要开第二个同主机
  // 终端走标签右键的「复制终端」（duplicate）。
  const open = useCallback((s: NewSession) => {
    // 注意：不要把 setActiveRaw / nextSessionId() 写进 setSessions 的更新函数里。
    // 更新函数必须是纯的——StrictMode 下会被调用两次，ID 计数器会被消耗两次，
    // 而第一次算出的那个 id 已经拿去 setActiveRaw 了，只是靠「后一次覆盖前一次」
    // 侥幸没出问题。这里改成：读 ref 判重、在外面算好 id，更新函数只做拼接。
    const existing = sessionsRef.current.find((x) => x.assetId === s.assetId);
    if (existing) {
      setActiveRaw(existing.id);
      clearActivity(existing.id);
      return;
    }
    const sid = nextSessionId();
    const meta = isPersistableAssetId(s.assetId) ? loadTabMeta()[s.assetId] : undefined;
    // 更新函数里再判一次同主机是否已存在：ref 可能是同一拍里的旧值，
    // 连点两下会绕过上面的判断，多开一个标签。
    setSessions((prev) => (prev.some((x) => x.assetId === s.assetId)
      ? prev
      : [...prev, { ...s, id: sid, customName: meta?.name, color: meta?.color }]));
    setActiveRaw(sid);
    clearActivity(sid);
  }, []);

  // 复制终端：对同一台主机再开一个独立会话（标签右键触发）
  const duplicate = useCallback((id: number) => {
    // 同 open：id 在外面生成一次，更新函数保持纯粹（理由见 open 处注释）
    const src = sessionsRef.current.find((x) => x.id === id);
    if (!src) return;
    const sid = nextSessionId();
    setSessions((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;                    // 源标签已被关掉
      return [...prev.slice(0, idx + 1), { ...src, id: sid }, ...prev.slice(idx + 1)];
    });
    setActiveRaw(sid);
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
    if (assetId != null && isPersistableAssetId(assetId)) {
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
    if (assetId != null && isPersistableAssetId(assetId)) {
      const m = loadTabMeta();
      m[assetId] = { ...(m[assetId] || {}), color: color || undefined };
      saveTabMeta(m);
    }
  }, []);

  const close = useCallback((id: number) => {
    // 关掉当前会话后该激活谁：优先右邻，没有右邻取左邻，一个都不剩才回普通页面。
    // 原来是无条件 setActiveRaw(null)，不看还剩几个终端——activeId=null 的语义是
    // 「回普通页面」，所以关掉一个标签就整个掉回控制台，哪怕旁边还开着好几个。
    // 浏览器标签、VS Code、各家终端都是「关掉后落到相邻标签」，这里对齐。
    const before = sessionsRef.current;
    const idx = before.findIndex((x) => x.id === id);
    const rest = before.filter((x) => x.id !== id);

    setSessions((prev) => prev.filter((x) => x.id !== id));
    setActiveRaw((cur) => {
      if (cur !== id) return cur;          // 关的不是当前的，激活项不动
      if (rest.length === 0) return null;  // 没有别的终端了，回普通页面
      // idx 落在 rest 里正好就是「原来的右邻」；关的是最后一个时夹到末位 = 左邻
      return rest[Math.min(idx, rest.length - 1)].id;
    });
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
      duplicate,
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
