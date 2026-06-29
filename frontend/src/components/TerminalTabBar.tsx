import React, { useState } from 'react';
import { AppstoreOutlined, CodeOutlined, DesktopOutlined, CloseOutlined } from '@ant-design/icons';
import { palette } from '../theme';
import type { TermSession } from '../terminalSessions';

interface Props {
  sessions: TermSession[];
  activeId: number | null;
  currentPageLabel: string;
  onSelectPage: () => void;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  /** 拖拽重排：把 dragId 移动到 overId 处 */
  onReorder?: (dragId: number, overId: number) => void;
}

const TAB_BAR_HEIGHT = 42;

// 项目内部的会话标签栏：左侧是「当前页面」，右侧是已打开的终端会话标签（可拖拽调序）
export const TerminalTabBar: React.FC<Props> = ({
  sessions,
  activeId,
  currentPageLabel,
  onSelectPage,
  onSelect,
  onClose,
  onReorder,
}) => {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const tabBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 30,
    padding: '0 12px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    border: '1px solid transparent',
    transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
  };

  const activeStyle: React.CSSProperties = {
    background: palette.brandGradientSoft,
    border: `1px solid ${palette.border}`,
    color: palette.primaryDeep,
    fontWeight: 600,
  };
  const idleStyle: React.CSSProperties = { color: palette.textSub, background: 'transparent' };

  return (
    <div
      style={{
        height: TAB_BAR_HEIGHT,
        background: palette.surface,
        borderBottom: `1px solid ${palette.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 14px',
        overflowX: 'auto',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* 当前页面标签 */}
      <div style={{ ...tabBase, ...(activeId === null ? activeStyle : idleStyle) }} onClick={onSelectPage}>
        <AppstoreOutlined style={{ fontSize: 14 }} />
        {currentPageLabel}
      </div>

      <span style={{ width: 1, height: 18, background: palette.border, margin: '0 2px' }} />

      {/* 终端会话标签（HTML5 拖拽重排） */}
      {sessions.map((s) => {
        const active = activeId === s.id;
        const isLocal = s.id < 0;
        const isDropTarget = overId === s.id && dragId !== null && dragId !== s.id;
        return (
          <div
            key={s.id}
            draggable={!!onReorder}
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              if (overId !== s.id) setOverId(s.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId !== null && dragId !== s.id) onReorder?.(dragId, s.id);
              setDragId(null);
              setOverId(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            style={{
              ...tabBase,
              ...(active ? activeStyle : idleStyle),
              opacity: dragId === s.id ? 0.4 : 1,
              // 拖拽悬停目标：左侧高亮一条指示线
              boxShadow: isDropTarget ? `inset 3px 0 0 ${palette.primary}` : undefined,
            }}
            onClick={() => onSelect(s.id)}
            title={isLocal ? '本地终端（本机）' : `${s.name} (${s.ip})`}
          >
            {isLocal ? (
              <DesktopOutlined style={{ fontSize: 14, color: active ? palette.primary : palette.accent }} />
            ) : (
              <CodeOutlined style={{ fontSize: 14, color: active ? palette.primary : palette.textMute }} />
            )}
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
            <CloseOutlined
              style={{ fontSize: 11, color: palette.textMute, marginLeft: 2 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
