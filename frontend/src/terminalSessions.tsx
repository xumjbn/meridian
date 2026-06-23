import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// 一个在 App 内部打开的终端会话（选项卡标签页）
export interface TermSession {
  id: number;
  name: string;
  ip: string;
}

export interface GlobalWSHandler {
  send: (data: string | ArrayBuffer | Blob | ArrayBufferView) => void;
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'idle';
  assetId: number;
}

interface TerminalCtx {
  sessions: TermSession[];
  activeId: number | null;
  /** 打开（或聚焦）一个资产的终端会话 */
  open: (s: TermSession) => void;
  /** 关闭一个会话 */
  close: (id: number) => void;
  /** 切换当前激活的会话；传 null 表示回到普通页面 */
  setActive: (id: number | null) => void;

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
  const [activeId, setActive] = useState<number | null>(null);

  // 全局同步会话物理连接注册表与选择集
  const globalWsRegistry = useRef<Record<string, GlobalWSHandler>>({});
  const [globalSyncedIds, setGlobalSyncedIds] = useState<string[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  const open = useCallback((s: TermSession) => {
    setSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    setActive(s.id);
  }, []);

  const close = useCallback((id: number) => {
    setSessions((prev) => prev.filter((x) => x.id !== id));
    // 关闭的若是当前激活会话，则回到普通页面
    setActive((cur) => (cur === id ? null : cur));
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
