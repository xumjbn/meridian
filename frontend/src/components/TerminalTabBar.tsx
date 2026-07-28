import React, { useState, useRef, useEffect } from 'react';
import { Dropdown, Input, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { AppstoreOutlined, CodeOutlined, DesktopOutlined, CloseOutlined, EditOutlined, BgColorsOutlined, LeftOutlined, RightOutlined, ExpandOutlined, CompressOutlined, PlusOutlined, CopyOutlined } from '@ant-design/icons';
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
  /** 终端模式：只留本标签栏与终端，顶栏隐藏、侧栏改悬浮 */
  termMode?: boolean;
  onToggleTermMode?: () => void;
  /** 「+」新建连接：弹 SSH 登录框 */
  onNewConnection?: () => void;
  /** 复制终端：对同一主机再开一个会话 */
  onDuplicate?: (id: number) => void;
}

const TAB_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899'];

const TAB_BAR_HEIGHT = 34;

/** 标签栏右侧插槽的 DOM id：单分屏时终端窗格把自己的状态条 portal 进来 */
export const TERM_TAB_SLOT_ID = 'lynx-term-tab-slot';

/** 多屏工具栏的「展开」把手插槽：原先是浮在终端顶部正中的一个小凸起，
 *  视觉上就是块刘海。挪到标签栏右侧和其它控件排在一行。 */
export const TERM_TOOLBAR_SLOT_ID = 'lynx-term-toolbar-slot';

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
  termMode = false,
  onToggleTermMode,
  onNewConnection,
  onDuplicate,
}) => {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  // ── 拖拽排序：pointer 事件 + setPointerCapture（不依赖 HTML5 原生 DnD）──────────
  // 原生 draggable / window 级监听在 Tauri/WebView 下都可能被外层 Dropdown 包裹层吞掉；
  // 这里按下即 setPointerCapture，把后续 move/up 强制派发到该标签本身，越过包裹层/滚动容器也不丢事件。
  const tabRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dragRef = useRef<{ id: number; startX: number; started: boolean; pointerId: number } | null>(null);
  const overIdRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);          // 刚拖完，抑制紧随的 click 误选

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

  const onTabPointerDown = (e: React.PointerEvent, s: TermSession) => {
    // 仅左键、未在重命名、且提供了重排回调时才接管；右键/中键留给原有逻辑
    if (e.button !== 0 || editingId === s.id || !onReorder) return;
    // 点在关闭按钮等交互元素上时不接管，交回它们自己的 click
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    // 注意：不在 pointerdown 立即 setPointerCapture —— 那会吞掉标签内子元素（X 关闭按钮）的 click。
    // 捕获延迟到 onTabPointerMove 里真正开始拖拽（位移超阈值）时再做。
    dragRef.current = { id: s.id, startX: e.clientX, started: false, pointerId: e.pointerId };
    overIdRef.current = s.id;
  };

  const onTabPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.started) {
      if (Math.abs(e.clientX - d.startX) < 5) return; // 小位移视为点击，不触发拖拽
      d.started = true;
      // 真正开始拖拽了，此刻才捕获指针（之后 move/up 强制派发到本标签，越过 Dropdown/滚动容器）
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      setDragId(d.id);
      document.body.style.userSelect = 'none';
    }
    const over = hitTestTab(e.clientX);
    if (over != null && over !== overIdRef.current) {
      overIdRef.current = over;
      setOverId(over);
    }
  };

  const onTabPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.started) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const over = overIdRef.current;
      if (over != null && over !== d.id) onReorder?.(d.id, over);
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
    }
    dragRef.current = null;
    document.body.style.userSelect = '';
    setDragId(null);
    setOverId(null);
  };

  // 右键菜单「左移 / 右移」：不依赖拖拽的确定性兜底，任何环境都能调序
  const moveTab = (s: TermSession, dir: -1 | 1) => {
    const idx = sessions.findIndex((x) => x.id === s.id);
    const target = sessions[idx + dir];
    if (target) onReorder?.(s.id, target.id);
  };

  // 卸载时复位可能残留的全局文本选择禁用
  useEffect(() => () => { document.body.style.userSelect = ''; }, []);

  const startEdit = (s: TermSession) => { setEditingId(s.id); setEditVal(s.customName || s.name); };
  const commitEdit = (id: number) => { onRename?.(id, editVal); setEditingId(null); };

  const tabMenu = (s: TermSession): MenuProps['items'] => [
    { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => startEdit(s) },
    // 打开资产是「聚焦已有终端」，要开第二个同主机终端走这里
    { key: 'dup', icon: <CopyOutlined />, label: '复制终端', onClick: () => onDuplicate?.(s.id) },
    { key: 'moveLeft', icon: <LeftOutlined />, label: '← 左移一位', disabled: sessions.findIndex((x) => x.id === s.id) <= 0, onClick: () => moveTab(s, -1) },
    { key: 'moveRight', icon: <RightOutlined />, label: '右移一位 →', disabled: sessions.findIndex((x) => x.id === s.id) >= sessions.length - 1, onClick: () => moveTab(s, 1) },
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
    height: 26,
    padding: '0 10px',
    borderRadius: 6,
    fontSize: 12.5,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    border: '1px solid transparent',
    transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
  };

  // 深色标签栏：选中项提亮为壳体的活动色 + 亮蓝字
  const activeStyle: React.CSSProperties = {
    background: palette.chromeActive,
    border: `1px solid ${palette.chromeBorder}`,
    color: palette.siderTextActive,
    fontWeight: 600,
  };
  const idleStyle: React.CSSProperties = { color: palette.chromeText, background: 'transparent' };

  return (
    <div
      style={{
        height: TAB_BAR_HEIGHT,
        background: palette.chromeBg,
        borderBottom: `1px solid ${palette.chromeBorder}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* 只让标签区横向滚动。此前整条都是 overflowX:auto，右侧的实时指标/
          文件/重连等控件跟标签挤在同一个滚动容器里，窗口一窄就被推出可视区，
          看着像「实时指标不见了」。现在右侧控件钉在外面，永远可见。 */}
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
        overflowX: 'auto', overflowY: 'hidden', height: '100%',
      }}>
      {/* 当前页面标签：与顶栏品牌区的页名确有重复，但终端模式下顶栏是隐藏的，
          这是唯一能退回页面的入口，故保留。 */}
      <div style={{ ...tabBase, ...(activeId === null ? activeStyle : idleStyle) }} onClick={onSelectPage}>
        <AppstoreOutlined style={{ fontSize: 14 }} />
        {currentPageLabel}
      </div>

      <span style={{ width: 1, height: 18, background: palette.chromeBorder, margin: '0 2px' }} />

      {/* 终端会话标签（HTML5 拖拽重排） */}
      {sessions.map((s) => {
        const active = activeId === s.id;
        const isLocal = s.assetId < 0;   // 负数资产 id = 本地终端；s.id 现在是会话 id
        const isDropTarget = overId === s.id && dragId !== s.id;
        const editing = editingId === s.id;
        const iconColor = s.color || (active ? palette.siderTextActive : isLocal ? palette.accent : palette.chromeTextMute);
        return (
          <Dropdown key={s.id} trigger={['contextMenu']} menu={{ items: tabMenu(s) }}>
          <div
            ref={(el) => { tabRefs.current[s.id] = el; }}
            onPointerDown={(e) => onTabPointerDown(e, s)}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
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
            <span
              data-no-drag="1"
              style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 2 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
            >
              <CloseOutlined style={{ fontSize: 11, color: palette.chromeTextMute }} />
            </span>
          </div>
          </Dropdown>
        );
      })}

      {/* 「+」新建连接：直接弹 SSH 登录框，不用先去资产页录入 */}
      {onNewConnection && (
        <Tooltip title="新建连接 (Ctrl/⌘+Shift+N)" placement="bottom">
          <div
            onClick={onNewConnection}
            style={{
              flexShrink: 0, width: 26, height: 24, marginLeft: 2, borderRadius: 4, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: palette.chromeTextMute,
            }}
          >
            <PlusOutlined style={{ fontSize: 13 }} />
          </div>
        </Tooltip>
      )}
      </div>

      {/* 单分屏时，活动会话的状态/操作从窗格头部搬到这里（见 TERM_TAB_SLOT_ID）。
          在滚动容器之外，窗口再窄也不会被标签挤走。 */}
      <div id={TERM_TAB_SLOT_ID} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 6 }} />

      {/* 多屏工具栏的展开把手（收起时才有内容） */}
      <div id={TERM_TOOLBAR_SLOT_ID} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 4 }} />

      {/* 终端模式开关（Ctrl/⌘+Shift+Enter 同效） */}
      {onToggleTermMode && (
        <Tooltip title={termMode ? '退出终端模式 (Ctrl/⌘+Shift+Enter)' : '终端模式：只留标签栏与终端 (Ctrl/⌘+Shift+Enter)'} placement="bottomRight">
          <div
            onClick={onToggleTermMode}
            style={{
              flexShrink: 0, marginLeft: 6, width: 26, height: 24, borderRadius: 4, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: termMode ? palette.siderTextActive : palette.chromeTextMute,
              background: termMode ? palette.siderActive : 'transparent',
            }}
          >
            {termMode ? <CompressOutlined style={{ fontSize: 13 }} /> : <ExpandOutlined style={{ fontSize: 13 }} />}
          </div>
        </Tooltip>
      )}
    </div>
  );
};
