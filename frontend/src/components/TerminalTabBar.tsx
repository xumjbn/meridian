import React, { useState, useRef, useEffect } from 'react';
import { Dropdown, Input } from 'antd';
import type { MenuProps } from 'antd';
import { AppstoreOutlined, CodeOutlined, DesktopOutlined, CloseOutlined, EditOutlined, BgColorsOutlined } from '@ant-design/icons';
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
  /** 有新输出的非激活会话 id（标签显示提示点） */
  activityIds?: number[];
  /** 重命名 / 设置标签颜色 */
  onRename?: (id: number, name: string) => void;
  onRecolor?: (id: number, color: string) => void;
}

const TAB_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899'];

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
  activityIds = [],
  onRename,
  onRecolor,
}) => {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  // ── 拖拽排序：用 pointer 事件而非 HTML5 原生 DnD ──────────────────────────
  // 原生 draggable 在 Tauri/WebView 下常被外层 Dropdown 包裹层吞掉而完全不触发，
  // 改用 pointermove + 命中测试最稳，且能与单击/双击/右键/关闭按钮和平共存。
  const tabRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dragRef = useRef<{ id: number; startX: number; started: boolean } | null>(null);
  const overIdRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);          // 刚拖完，抑制紧随的 click 误选
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);

  // 命中测试：指针 x 落在哪个标签上（落在间隙/边缘则取中心最近者）
  const hitTestTab = (x: number): number | null => {
    let bestId: number | null = null;
    let bestDist = Infinity;
    for (const s of sessions) {
      const el = tabRefs.current[s.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return s.id;
      const c = (r.left + r.right) / 2;
      const d = Math.abs(x - c);
      if (d < bestDist) { bestDist = d; bestId = s.id; }
    }
    return bestId;
  };

  const stopDragListeners = () => {
    if (moveHandlerRef.current) window.removeEventListener('pointermove', moveHandlerRef.current);
    if (upHandlerRef.current) window.removeEventListener('pointerup', upHandlerRef.current);
    moveHandlerRef.current = null;
    upHandlerRef.current = null;
    document.body.style.userSelect = '';
  };

  const onTabPointerDown = (e: React.PointerEvent, s: TermSession) => {
    // 仅左键、未在重命名、且提供了重排回调时才接管；右键/中键留给原有逻辑
    if (e.button !== 0 || editingId === s.id || !onReorder) return;
    dragRef.current = { id: s.id, startX: e.clientX, started: false };
    overIdRef.current = s.id;

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started) {
        if (Math.abs(ev.clientX - d.startX) < 5) return; // 小位移视为点击，不触发拖拽
        d.started = true;
        setDragId(d.id);
        document.body.style.userSelect = 'none';
      }
      const over = hitTestTab(ev.clientX);
      if (over != null && over !== overIdRef.current) {
        overIdRef.current = over;
        setOverId(over);
      }
    };
    const up = () => {
      const d = dragRef.current;
      stopDragListeners();
      if (d && d.started) {
        const over = overIdRef.current;
        if (over != null && over !== d.id) onReorder?.(d.id, over);
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 0);
      }
      dragRef.current = null;
      setDragId(null);
      setOverId(null);
    };
    moveHandlerRef.current = move;
    upHandlerRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 卸载时清理可能残留的拖拽监听
  useEffect(() => () => stopDragListeners(), []);

  const startEdit = (s: TermSession) => { setEditingId(s.id); setEditVal(s.customName || s.name); };
  const commitEdit = (id: number) => { onRename?.(id, editVal); setEditingId(null); };

  const tabMenu = (s: TermSession): MenuProps['items'] => [
    { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => startEdit(s) },
    {
      key: 'color',
      icon: <BgColorsOutlined />,
      label: '标签颜色',
      children: [
        ...TAB_COLORS.map((c) => ({
          key: c,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} /> {c}
            </span>
          ),
          onClick: () => onRecolor?.(s.id, c),
        })),
        { type: 'divider' as const },
        { key: 'clear', label: '清除颜色', onClick: () => onRecolor?.(s.id, '') },
      ],
    },
    { type: 'divider' as const },
    { key: 'close', icon: <CloseOutlined />, danger: true, label: '关闭标签', onClick: () => onClose(s.id) },
  ];

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
        const isDropTarget = overId === s.id && dragId !== s.id;
        const editing = editingId === s.id;
        const iconColor = s.color || (active ? palette.primary : isLocal ? palette.accent : palette.textMute);
        return (
          <Dropdown key={s.id} trigger={['contextMenu']} menu={{ items: tabMenu(s) }}>
          <div
            ref={(el) => { tabRefs.current[s.id] = el; }}
            onPointerDown={(e) => onTabPointerDown(e, s)}
            style={{
              ...tabBase,
              ...(active ? activeStyle : idleStyle),
              ...(s.color ? { borderLeft: `3px solid ${s.color}` } : null),
              opacity: dragId === s.id ? 0.4 : 1,
              // 拖拽悬停目标：左侧高亮一条指示线
              boxShadow: isDropTarget ? `inset 3px 0 0 ${palette.primary}` : undefined,
            }}
            onClick={() => { if (justDraggedRef.current) return; onSelect(s.id); }}
            onDoubleClick={() => startEdit(s)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(s.id); // 中键关闭标签
              }
            }}
            title={isLocal ? '本地终端（双击重命名 · 右键改色）' : `${s.name} (${s.ip})　双击重命名 · 右键改色`}
          >
            {isLocal ? (
              <DesktopOutlined style={{ fontSize: 14, color: iconColor }} />
            ) : (
              <CodeOutlined style={{ fontSize: 14, color: iconColor }} />
            )}
            {editing ? (
              <Input
                size="small"
                autoFocus
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onPressEnter={() => commitEdit(s.id)}
                onBlur={() => commitEdit(s.id)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); }}
                style={{ width: 120, height: 22 }}
              />
            ) : (
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.customName || s.name}</span>
            )}
            {!active && activityIds.includes(s.id) && (
              <span
                title="有新输出"
                style={{ width: 7, height: 7, borderRadius: '50%', background: palette.accent, flexShrink: 0, animation: 'pulse 2s infinite' }}
              />
            )}
            <CloseOutlined
              style={{ fontSize: 11, color: palette.textMute, marginLeft: 2 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
            />
          </div>
          </Dropdown>
        );
      })}
    </div>
  );
};
