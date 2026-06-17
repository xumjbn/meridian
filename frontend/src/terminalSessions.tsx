import React, { createContext, useContext, useState, useCallback } from 'react';

// 一个在 App 内部打开的终端会话（不再新开浏览器标签页）
export interface TermSession {
  id: number;
  name: string;
  ip: string;
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

  const open = useCallback((s: TermSession) => {
    setSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    setActive(s.id);
  }, []);

  const close = useCallback((id: number) => {
    setSessions((prev) => prev.filter((x) => x.id !== id));
    // 关闭的若是当前激活会话，则回到普通页面
    setActive((cur) => (cur === id ? null : cur));
  }, []);

  return (
    <Ctx.Provider value={{ sessions, activeId, open, close, setActive }}>{children}</Ctx.Provider>
  );
};
