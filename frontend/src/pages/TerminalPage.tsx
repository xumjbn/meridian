import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Button, Space, message, Spin, Select, Radio, Checkbox } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getAsset, getTerminalWsUrl, getAssets, aiStatus, aiAgentStart, aiAgentContinue, aiAgentMessage, type Asset, type AgentState } from '../services/api';
import { CloseOutlined, SyncOutlined, FullscreenOutlined, FullscreenExitOutlined, PlusOutlined, RobotOutlined, EnterOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette } from '../theme';
import { useTerminals } from '../terminalSessions';
import { SnippetManager } from '../components/SnippetManager';
import { loadSnippets, matchSnippets, type CmdSnippet } from '../commandSnippets';
import '@xterm/xterm/css/xterm.css';

const fontSizes = [12, 13, 14, 15, 16, 18, 20, 22, 24];
const fontFamilies = [
  { label: 'Fira Code', value: 'Fira Code, Menlo, Monaco, Courier New, monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", Consolas, Monaco, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, Monaco, monospace' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'System Monospace', value: 'Menlo, Monaco, Consolas, monospace' },
];

// 一个终端窗格（行内带宽度权重 flex）
interface PaneNode {
  id: string;
  assetId: number;
  flex: number;
}

// 一行窗格（带行高权重 flex），行内多个窗格左右排布
interface RowNode {
  id: string;
  flex: number;
  panes: PaneNode[];
}

type LayoutType = 'single' | 'h-split' | 'quad';

const MAX_PANES = 4;

let nodeSeq = 0;
const newPaneId = () => `pane-${Date.now().toString(36)}-${nodeSeq++}`;
const newRowId = () => `row-${Date.now().toString(36)}-${nodeSeq++}`;

const flatPanes = (rows: RowNode[]): PaneNode[] => rows.flatMap((r) => r.panes);

// 依据预设构建行结构；尽量复用既有行/窗格 id，避免已连接终端被强制重连
const buildPreset = (type: LayoutType, existing: RowNode[]): RowNode[] => {
  const panePool = flatPanes(existing);
  let pi = 0;
  const takePane = (): PaneNode => {
    const p = panePool[pi++];
    return p ? { ...p, flex: 1 } : { id: newPaneId(), assetId: 0, flex: 1 };
  };
  let ri = 0;
  const takeRowId = (): string => (existing[ri] ? existing[ri++].id : newRowId());

  if (type === 'single') {
    return [{ id: takeRowId(), flex: 1, panes: [takePane()] }];
  }
  if (type === 'h-split') {
    return [{ id: takeRowId(), flex: 1, panes: [takePane(), takePane()] }];
  }
  // 田字四分
  return [
    { id: takeRowId(), flex: 1, panes: [takePane(), takePane()] },
    { id: takeRowId(), flex: 1, panes: [takePane(), takePane()] },
  ];
};

// 由当前结构反推出匹配的预设（用于高亮预设按钮），无法匹配则为自定义
const derivePreset = (rows: RowNode[]): LayoutType | undefined => {
  if (rows.length === 1 && rows[0].panes.length === 1) return 'single';
  if (rows.length === 1 && rows[0].panes.length === 2) return 'h-split';
  if (rows.length === 2 && rows[0].panes.length === 2 && rows[1].panes.length === 2) return 'quad';
  return undefined;
};

interface TerminalPageProps {
  assetId: number;
  /** 在 App 内部以标签页形式嵌入（填满容器，关闭走回调而非关闭浏览器窗口） */
  embedded?: boolean;
  onClose?: () => void;
}

export const TerminalPage: React.FC<TerminalPageProps> = ({ assetId, embedded = false, onClose }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);

  // 挂载全局终端会话的广播控制
  const { globalSyncedIds, connectedIds, syncAllConnected } = useTerminals();

  // 全局字体设置
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('term_font_size');
    return saved ? parseInt(saved, 10) : 14;
  });
  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem('term_font_family') || 'Fira Code, Menlo, Monaco, Courier New, monospace';
  });

  // 命令自动补全开关 + 命令库管理弹窗
  const [completionEnabled, setCompletionEnabled] = useState<boolean>(() => {
    return localStorage.getItem('term_completion_enabled') !== 'false';
  });
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);

  const toggleCompletion = (checked: boolean) => {
    setCompletionEnabled(checked);
    localStorage.setItem('term_completion_enabled', checked ? 'true' : 'false');
  };

  // 分屏行结构（可变窗格数 + 可拖拽缩放）
  const [rows, setRows] = useState<RowNode[]>(() => {
    const initLayout = (localStorage.getItem('term_layout') as LayoutType) || 'single';
    const first: PaneNode = { id: newPaneId(), assetId, flex: 1 };
    return buildPreset(initLayout, [{ id: newRowId(), flex: 1, panes: [first] }]);
  });

  const totalPanes = flatPanes(rows).length;
  const activePreset = derivePreset(rows);

  // 拖拽缩放状态：记录拖动起点、相邻两元素的基准 flex 与容器像素尺寸
  const dragRef = useRef<null | {
    type: 'col' | 'row';
    rowId?: string;
    aId: string;
    bId: string;
    baseA: number;
    baseB: number;
    start: number;
    size: number;
  }>(null);
  const dragHandlersRef = useRef<{ move?: (e: MouseEvent) => void; up?: () => void }>({});

  // 1. 获取全局资产列表
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const data = await getAssets();
        setAssets(data);
      } catch (e) {
        message.error('获取资产列表失败');
      }
    };
    fetchAssets();
  }, []);

  // 2. 外部传入的初始 assetId 变更时，更新主屏（第一行第一个窗格）
  useEffect(() => {
    setRows((prev) => {
      if (!prev.length || !prev[0].panes.length) return prev;
      return prev.map((r, ri) =>
        ri === 0
          ? { ...r, panes: r.panes.map((p, pi) => (pi === 0 ? { ...p, assetId } : p)) }
          : r,
      );
    });
  }, [assetId]);

  // 应用预设布局（单屏 / 左右双分 / 田字四分）
  const applyPreset = (type: LayoutType) => {
    localStorage.setItem('term_layout', type);
    setRows((prev) => buildPreset(type, prev));
    // 切回单屏时取消所有同步，避免单屏输入误操作后台终端
    if (type === 'single') syncAllConnected(false);
  };

  const handleAssetChange = (paneId: string, newAssetId: number) => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        panes: r.panes.map((p) => (p.id === paneId ? { ...p, assetId: newAssetId } : p)),
      })),
    );
  };

  // 独立关闭某个窗格；行内删空则移除该行；始终至少保留一个窗格
  const closePane = (paneId: string) => {
    setRows((prev) => {
      const next = prev
        .map((r) => ({ ...r, panes: r.panes.filter((p) => p.id !== paneId) }))
        .filter((r) => r.panes.length > 0);
      return next.length > 0 ? next : prev;
    });
  };

  // 添加一个空窗格：优先填补不足 2 列的行，否则新增一行，上限 MAX_PANES
  const addPane = () => {
    setRows((prev) => {
      if (flatPanes(prev).length >= MAX_PANES) return prev;
      const next = prev.map((r) => ({ ...r, panes: [...r.panes] }));
      const rowWithSpace = next.find((r) => r.panes.length < 2);
      if (rowWithSpace) {
        rowWithSpace.panes.push({ id: newPaneId(), assetId: 0, flex: 1 });
      } else if (next.length < 2) {
        next.push({ id: newRowId(), flex: 1, panes: [{ id: newPaneId(), assetId: 0, flex: 1 }] });
      }
      return next;
    });
  };

  // ── 拖拽缩放：相邻两元素按像素位移等量增减 flex 权重 ──────────
  const startDrag = () => {
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || d.size <= 0) return;
      const pos = d.type === 'col' ? ev.clientX : ev.clientY;
      const total = d.baseA + d.baseB;
      const minFlex = total * 0.12; // 防止某一侧被拖到塌缩
      let newA = d.baseA + ((pos - d.start) / d.size) * total;
      newA = Math.max(minFlex, Math.min(total - minFlex, newA));
      const newB = total - newA;
      if (d.type === 'col') {
        setRows((prev) =>
          prev.map((r) =>
            r.id !== d.rowId
              ? r
              : {
                  ...r,
                  panes: r.panes.map((p) =>
                    p.id === d.aId ? { ...p, flex: newA } : p.id === d.bId ? { ...p, flex: newB } : p,
                  ),
                },
          ),
        );
      } else {
        setRows((prev) =>
          prev.map((r) => (r.id === d.aId ? { ...r, flex: newA } : r.id === d.bId ? { ...r, flex: newB } : r)),
        );
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragRef.current = null;
    };
    dragHandlersRef.current = { move, up };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = dragRef.current?.type === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const beginColResize = (
    e: React.MouseEvent,
    rowId: string,
    leftId: string,
    rightId: string,
    baseA: number,
    baseB: number,
  ) => {
    e.preventDefault();
    const rowEl = (e.currentTarget as HTMLElement).parentElement;
    const size = rowEl ? rowEl.getBoundingClientRect().width : 0;
    dragRef.current = { type: 'col', rowId, aId: leftId, bId: rightId, baseA, baseB, start: e.clientX, size };
    startDrag();
  };

  const beginRowResize = (
    e: React.MouseEvent,
    topId: string,
    bottomId: string,
    baseA: number,
    baseB: number,
  ) => {
    e.preventDefault();
    const colEl = (e.currentTarget as HTMLElement).parentElement;
    const size = colEl ? colEl.getBoundingClientRect().height : 0;
    dragRef.current = { type: 'row', aId: topId, bId: bottomId, baseA, baseB, start: e.clientY, size };
    startDrag();
  };

  // 卸载时清理可能残留的拖拽监听
  useEffect(() => {
    return () => {
      const { move, up } = dragHandlersRef.current;
      if (move) window.removeEventListener('mousemove', move);
      if (up) window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const handleClose = () => {
    if (onClose) onClose();
    else window.close();
  };

  // 计算全局一键同步 Checkbox 的状态
  const allSynced = connectedIds.length > 0 && globalSyncedIds.length === connectedIds.length;
  const isIndeterminate = globalSyncedIds.length > 0 && globalSyncedIds.length < connectedIds.length;

  const renderGrid = () => (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#0B0F19',
      boxSizing: 'border-box',
      padding: '4px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {rows.map((row, ri) => (
        <React.Fragment key={row.id}>
          {/* 行间横向分隔条（可上下拖拽调整行高） */}
          {ri > 0 && (
            <div
              className="term-splitter-row"
              onMouseDown={(e) => beginRowResize(e, rows[ri - 1].id, row.id, rows[ri - 1].flex, row.flex)}
              style={{ height: 6, flex: '0 0 auto', cursor: 'row-resize' }}
            />
          )}
          <div style={{ flex: row.flex, minHeight: 0, display: 'flex', width: '100%' }}>
            {row.panes.map((pane, pi) => (
              <React.Fragment key={pane.id}>
                {/* 列间纵向分隔条（可左右拖拽调整列宽） */}
                {pi > 0 && (
                  <div
                    className="term-splitter-col"
                    onMouseDown={(e) =>
                      beginColResize(e, row.id, row.panes[pi - 1].id, pane.id, row.panes[pi - 1].flex, pane.flex)
                    }
                    style={{ width: 6, flex: '0 0 auto', cursor: 'col-resize' }}
                  />
                )}
                <div style={{ flex: pane.flex, minWidth: 0, minHeight: 0, height: '100%' }}>
                  <TerminalItem
                    paneId={pane.id}
                    assetId={pane.assetId}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    assets={assets}
                    completionEnabled={completionEnabled}
                    canClose={totalPanes > 1}
                    onClose={() => closePane(pane.id)}
                    onAssetChange={(newId) => handleAssetChange(pane.id, newId)}
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0B0F19',
      color: '#F9FAFB',
      overflow: 'hidden',
      ...(fullscreen
        ? { position: 'fixed' as const, inset: 0, zIndex: 2000, height: '100vh' }
        : embedded
        ? { position: 'absolute' as const, inset: 0 }
        : { height: '100vh' }),
    }}>
      {/* CSS keyframes pulse 呼吸动画 + 分隔条拖拽样式注入 */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
        .term-splitter-col, .term-splitter-row {
          background: rgba(148,163,184,0.06);
          transition: background 0.15s ease;
          flex-shrink: 0;
        }
        .term-splitter-col:hover, .term-splitter-row:hover {
          background: rgba(99,102,241,0.55);
        }
      `}} />

      {/* 顶部全局状态栏 */}
      <div style={{
        height: '48px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 50,
      }}>
        <Space size="middle">
          <LogoMark size={22} />
          <span style={{ fontWeight: 600, fontSize: 14, color: palette.text }}>
            Meridian 远程终端多屏中心
          </span>
        </Space>
        
        <Space size="middle">
          {/* 分屏布局控制 */}
          <span style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center' }}>
            布局:
            <Radio.Group
              size="small"
              value={activePreset}
              onChange={(e) => applyPreset(e.target.value)}
              style={{ marginLeft: 6 }}
            >
              <Radio.Button value="single">单屏</Radio.Button>
              <Radio.Button value="h-split">左右双分</Radio.Button>
              <Radio.Button value="quad">田字四分</Radio.Button>
            </Radio.Group>
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              onClick={addPane}
              disabled={totalPanes >= MAX_PANES}
              title="添加一个分屏"
              style={{ marginLeft: 6, fontSize: 12, color: '#475569' }}
            >
              添加分屏
            </Button>
          </span>

          {/* 全局命令同步总开关 Checkbox */}
          <Checkbox
            checked={allSynced}
            indeterminate={isIndeterminate}
            disabled={connectedIds.length === 0}
            onChange={(e) => syncAllConnected(e.target.checked)}
            style={{ fontSize: 12, color: '#475569' }}
          >
            同步所有 ({connectedIds.length})
          </Checkbox>

          {/* 命令自动补全开关 + 命令库管理入口 */}
          <span style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center' }}>
            <Checkbox
              checked={completionEnabled}
              onChange={(e) => toggleCompletion(e.target.checked)}
              style={{ fontSize: 12, color: '#475569' }}
            >
              命令补全
            </Checkbox>
            <Button
              type="link"
              size="small"
              onClick={() => setSnippetModalOpen(true)}
              style={{ padding: '0 4px', fontSize: 12 }}
            >
              命令库
            </Button>
          </span>

          <span style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center' }}>
            字体:
            <Select
              size="small"
              value={fontFamily}
              onChange={(val) => setFontFamily(val)}
              options={fontFamilies}
              style={{ width: 130, marginLeft: 6 }}
              popupMatchSelectWidth={false}
            />
          </span>

          <span style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center' }}>
            字号:
            <Select
              size="small"
              value={fontSize}
              onChange={(val) => setFontSize(val)}
              options={fontSizes.map((s) => ({ label: `${s}px`, value: s }))}
              style={{ width: 75, marginLeft: 6 }}
            />
          </span>

          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            右键粘贴 · Ctrl+Shift+C / V
          </span>

          <Button
            type="text"
            icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={() => setFullscreen((f) => !f)}
            style={{ color: '#475569', display: 'flex', alignItems: 'center' }}
          >
            {fullscreen ? '退出全屏' : '全屏'}
          </Button>

          <Button
            type="text"
            danger
            icon={<CloseOutlined />}
            onClick={handleClose}
            style={{ color: '#EF4444', display: 'flex', alignItems: 'center' }}
          >
            关闭终端
          </Button>
        </Space>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', position: 'relative', background: '#0B0F19' }}>
        {renderGrid()}
      </div>

      <SnippetManager open={snippetModalOpen} onClose={() => setSnippetModalOpen(false)} />
    </div>
  );
};

// ── 子组件: 独立终端会话 Split Terminal Item ─────────────────────────
interface TerminalItemProps {
  paneId: string; // 窗格的本地会话标识
  assetId: number;
  fontSize: number;
  fontFamily: string;
  assets: Asset[];
  completionEnabled: boolean;
  canClose?: boolean;      // 是否允许独立关闭该窗格（至少保留一个）
  onClose?: () => void;    // 关闭该窗格
  onAssetChange: (id: number) => void;
}

// 判断一段输入是否为可见字符（含粘贴文本）；控制字符 / 转义序列返回 false
const isPrintableInput = (s: string): boolean => {
  if (s.length === 0) return false;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
};

const TerminalItem: React.FC<TerminalItemProps> = ({ paneId, assetId, fontSize, fontFamily, assets, completionEnabled, canClose, onClose, onAssetChange }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statusText, setStatusText] = useState('正在加载资产信息...');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected' | 'idle'>(
    assetId > 0 ? 'connecting' : 'idle'
  );
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [form] = Form.useForm();

  // 挂载全局注册同步 Hook
  const { globalSyncedIds, setGlobalSyncedIds, registerGlobalWS, broadcastGlobalData } = useTerminals();

  // 为每个物理终端分配一个全局唯一的 instanceId，并在 unmount 时自动注销
  const instanceIdRef = useRef<string>(`term-${paneId}-${Math.random().toString(36).substr(2, 9)}`);
  const instanceId = instanceIdRef.current;

  const isSynced = globalSyncedIds.includes(instanceId);

  const isSyncedRef = useRef(isSynced);
  const broadcastGlobalDataRef = useRef(broadcastGlobalData);

  useEffect(() => {
    isSyncedRef.current = isSynced;
    broadcastGlobalDataRef.current = broadcastGlobalData;
  }, [isSynced, broadcastGlobalData]);

  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // ── AI 助手（Agent 模式：一句话自动完成任务 + 多轮上下文）──────
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [agentState, setAgentState] = useState<AgentState | null>(null);

  useEffect(() => {
    aiStatus().then((s) => setAiEnabled(!!s.enabled)).catch(() => {});
  }, []);

  // ── 命令自动补全（本地输入行追踪 + 片段提示）────────────────
  const [suggestions, setSuggestions] = useState<CmdSnippet[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  // 下拉锚点：锚定到光标所在像素位置，默认在输入行上方展开，避免遮挡输入
  const [anchor, setAnchor] = useState<{ left: number; top: number; cellH: number; cw: number; ch: number } | null>(null);

  const lineBufferRef = useRef('');                       // 本地输入行缓冲（尽力追踪）
  const snippetsRef = useRef<CmdSnippet[]>(loadSnippets());
  const suggestionsRef = useRef<CmdSnippet[]>([]);
  const activeIdxRef = useRef(0);

  // 估算光标在终端容器内的像素位置（用于补全下拉锚定）
  const computeAnchor = useCallback(() => {
    const term = termRef.current;
    const el = terminalRef.current;
    if (!term || !el) return null;
    const pad = 8; // 终端容器 padding
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const cellW = (cw - pad * 2) / cols;
    const cellH = (ch - pad * 2) / rows;
    const cx = term.buffer.active.cursorX;
    const cy = term.buffer.active.cursorY;
    return { left: pad + cx * cellW, top: pad + cy * cellH, cellH, cw, ch };
  }, []);

  useEffect(() => { suggestionsRef.current = suggestions; }, [suggestions]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // 命令库变更时热重载，并刷新当前提示
  useEffect(() => {
    const reload = () => {
      snippetsRef.current = loadSnippets();
      setSuggestions(matchSnippets(lineBufferRef.current, snippetsRef.current));
      setActiveIdx(0);
    };
    window.addEventListener('cmd-snippets-changed', reload);
    return () => window.removeEventListener('cmd-snippets-changed', reload);
  }, []);

  // 关闭补全时清空提示与缓冲
  useEffect(() => {
    if (!completionEnabled) {
      lineBufferRef.current = '';
      setSuggestions([]);
      setActiveIdx(0);
    }
  }, [completionEnabled]);

  // 断开 / 重连时重置补全状态，避免缓冲与实际行错位
  useEffect(() => {
    if (status !== 'connected') {
      lineBufferRef.current = '';
      setSuggestions([]);
      setActiveIdx(0);
    }
  }, [status]);

  const sendToShell = useCallback((data: string) => {
    if (isSyncedRef.current && broadcastGlobalDataRef.current) {
      broadcastGlobalDataRef.current(instanceId, data);
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(new TextEncoder().encode(data));
    }
  }, [instanceId]);

  const acceptSuggestion = useCallback((snippet: CmdSnippet) => {
    // 退格清掉当前已输入缓冲后插入完整命令；行首多余退格会被 readline 安全忽略
    const erase = '\x7f'.repeat(lineBufferRef.current.length);
    sendToShell(erase + snippet.cmd);
    lineBufferRef.current = snippet.cmd;
    setSuggestions([]);
    setActiveIdx(0);
    termRef.current?.focus();
  }, [sendToShell]);

  const refreshSuggestions = useCallback(() => {
    const list = matchSnippets(lineBufferRef.current, snippetsRef.current);
    setSuggestions(list);
    setActiveIdx(0);
    setAnchor(list.length ? computeAnchor() : null);
  }, [computeAnchor]);

  // 处理一段终端输入；返回 true 表示被补全逻辑消费（不再下发到 shell）
  const handleCompletionInput = useCallback((data: string): boolean => {
    const isOpen = suggestionsRef.current.length > 0;
    if (isOpen) {
      if (data === '\t') {
        const sel = suggestionsRef.current[activeIdxRef.current] || suggestionsRef.current[0];
        if (sel) acceptSuggestion(sel);
        return true;
      }
      if (data === '\x1b[A') { // ↑ 上移选择
        const n = suggestionsRef.current.length;
        setActiveIdx((i) => (i - 1 + n) % n);
        return true;
      }
      if (data === '\x1b[B') { // ↓ 下移选择
        const n = suggestionsRef.current.length;
        setActiveIdx((i) => (i + 1) % n);
        return true;
      }
      if (data === '\x1b') { // Esc 关闭下拉（不下发）
        setSuggestions([]);
        setActiveIdx(0);
        return true;
      }
    }

    // 回车 / Ctrl-C / Ctrl-U：提交或清行 → 重置缓冲
    if (data === '\r' || data === '\n' || data === '\x03' || data === '\x15') {
      lineBufferRef.current = '';
      setSuggestions([]);
      setActiveIdx(0);
      return false;
    }
    // 退格
    if (data === '\x7f' || data === '\b') {
      lineBufferRef.current = lineBufferRef.current.slice(0, -1);
      refreshSuggestions();
      return false;
    }
    // 可见字符（含粘贴文本）：追加到缓冲
    if (isPrintableInput(data)) {
      lineBufferRef.current += data;
      refreshSuggestions();
      return false;
    }
    // 其它控制 / 转义序列（方向键移动、Home/End 等）：本地模型已失真，重置
    lineBufferRef.current = '';
    setSuggestions([]);
    setActiveIdx(0);
    return false;
  }, [acceptSuggestion, refreshSuggestions]);

  // 将最新开关与处理函数暴露给 onData，避免连接闭包内引用过期
  const completionApiRef = useRef<{ enabled: boolean; handle: (d: string) => boolean }>({
    enabled: completionEnabled,
    handle: handleCompletionInput,
  });
  useEffect(() => {
    completionApiRef.current = { enabled: completionEnabled, handle: handleCompletionInput };
  }, [completionEnabled, handleCompletionInput]);

  // 1. 注册物理 WebSocket 到全局以实现跨标签页和跨分屏的广播输入
  useEffect(() => {
    if (wsRef.current && status === 'connected') {
      const activeWs = wsRef.current;
      registerGlobalWS(instanceId, {
        send: (data) => {
          if (activeWs.readyState === WebSocket.OPEN) {
            activeWs.send(data as any);
          }
        },
        status: status,
        assetId: assetId,
      });
    } else {
      registerGlobalWS(instanceId, null);
    }
    return () => {
      registerGlobalWS(instanceId, null);
    };
  }, [status, assetId, registerGlobalWS, instanceId]);

  // 2. 同步加载被分配的资产详情
  useEffect(() => {
    if (assetId <= 0) {
      setAsset(null);
      setStatus('idle');
      return;
    }
    const fetchAsset = async () => {
      try {
        const data = await getAsset(assetId);
        setAsset(data);
      } catch (e) {
        message.error('加载资产信息失败');
        setStatusText('资产加载失败，请检查 ID 是否正确');
        setErrorDetail('未找到该资产数据');
        setStatus('error');
      }
    };
    fetchAsset();
  }, [assetId]);

  // 3. 建立 WebSocket 隧道
  useEffect(() => {
    if (!asset || assetId <= 0) return;

    setConnecting(true);
    setAuthRequired(false);
    setStatus('connecting');
    setStatusText('正在建立 WebSocket 隧道...');
    setErrorDetail('');

    let resizeRaf = 0;
    let onMouseUp: (() => void) | null = null;
    let onContextMenu: ((e: MouseEvent) => void) | null = null;
    const containerEl = terminalRef.current;

    const wsUrl = getTerminalWsUrl(asset.id!);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontSize: fontSize,
      fontFamily: fontFamily,
      theme: {
        background: '#0B0F19',
        foreground: '#F3F4F6',
        cursor: '#1677ff',
        black: '#000000',
        red: '#EF4444',
        green: '#10B981',
        yellow: '#F59E0B',
        blue: '#3B82F6',
        magenta: '#8B5CF6',
        cyan: '#06B6D4',
        white: '#FFFFFF',
      },
      allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && key === 'c') {
        const sel = term.getSelection();
        if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
        return false;
      }
      if (e.ctrlKey && e.shiftKey && key === 'v') {
        navigator.clipboard?.readText().then((t) => { if (t) term.paste(t); }).catch(() => {});
        return false;
      }
      return true;
    });

    if (terminalRef.current) {
      term.open(terminalRef.current);

      const fitSafe = () => {
        const el = terminalRef.current;
        if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
        try {
          fitAddon.fit();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch (e) {
          console.warn('Xterm fit failed:', e);
        }
      };
      requestAnimationFrame(fitSafe);
      setTimeout(fitSafe, 80);
      setTimeout(fitSafe, 300);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => fitSafe()).catch(() => {});
      }
      term.focus();

      onMouseUp = () => {
        const sel = term.getSelection();
        if (sel && sel.length > 0) navigator.clipboard?.writeText(sel).catch(() => {});
      };
      onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        navigator.clipboard?.readText().then((t) => { if (t) term.paste(t); }).catch(() => {});
      };
      terminalRef.current.addEventListener('mouseup', onMouseUp);
      terminalRef.current.addEventListener('contextmenu', onContextMenu);

      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          const el = terminalRef.current;
          if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
          try {
            fitAddon.fit();
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }
          } catch (e) {
            // ignore
          }
        });
      });
      observer.observe(terminalRef.current);
      resizeObserverRef.current = observer;
    }

    term.write('\x1b[36m[SYSTEM]\x1b[0m 正在建立远程 WebSocket 连接通道...\r\n');

    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);

    socket.onopen = () => {
      setStatusText('通道开启，正在进行 SSH 连接拨号...');
      term.write('\x1b[36m[SYSTEM]\x1b[0m WebSocket 通道连接成功，开始拨号远程主机端口 22...\r\n');
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'auth_request') {
            setAuthRequired(true);
            setConnecting(false);
            term.write('\x1b[33m[SYSTEM] 该资产未关联凭证，等待输入临时凭据...\x1b[0m\r\n');
          } else if (msg.type === 'status') {
            if (msg.message === 'connected') {
              setConnecting(false);
              setAuthRequired(false);
              setStatus('connected');
              term.write('\x1b[32m[SYSTEM] SSH 会话连接成功，终端开始接受输入！\x1b[0m\r\n\r\n');
            } else {
              setStatusText(msg.message);
              term.write(`\x1b[36m[SYSTEM]\x1b[0m ${msg.message}\r\n`);
              if (
                msg.message.includes('失败') ||
                msg.message.includes('错误') ||
                msg.message.toLowerCase().includes('fail') ||
                msg.message.toLowerCase().includes('error')
              ) {
                setErrorDetail(msg.message);
              }
            }
          }
        } catch (e) {
          term.write(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      }
    };

    const dataListener = term.onData((data) => {
      // 命令补全优先拦截：Tab 接受 / ↑↓ 选择 / Esc 关闭等被消费的输入不下发
      if (completionApiRef.current.enabled && completionApiRef.current.handle(data)) {
        return;
      }
      if (isSyncedRef.current && broadcastGlobalDataRef.current) {
        broadcastGlobalDataRef.current(instanceId, data);
      } else {
        if (socket.readyState === WebSocket.OPEN) {
          const encoder = new TextEncoder();
          socket.send(encoder.encode(data));
        }
      }
    });

    socket.onclose = (event) => {
      setConnecting(false);
      setStatus('disconnected');
      term.write('\r\n\x1b[31m[SYSTEM] SSH 终端会话连接已关闭/断开。\x1b[0m\r\n');
      if (event.reason) {
        term.write(`\x1b[31m[REASON] ${event.reason}\x1b[0m\r\n`);
        setErrorDetail(event.reason);
      } else {
        setErrorDetail((prev) => {
          if (prev) return prev;
          if (statusText && (statusText.includes('失败') || statusText.includes('错误'))) {
            return statusText;
          }
          return 'WebSocket 远程连接意外关闭，请检查目标机 SSH 服务或网络路由。';
        });
      }
    };

    socket.onerror = () => {
      setConnecting(false);
      setStatus('error');
      setErrorDetail('WebSocket 隧道连接发生物理错误，无法与后端握手');
      message.error('WebSocket 连接异常断开');
    };

    return () => {
      clearInterval(pingInterval);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      dataListener.dispose();
      cancelAnimationFrame(resizeRaf);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (containerEl) {
        if (onMouseUp) containerEl.removeEventListener('mouseup', onMouseUp);
        if (onContextMenu) containerEl.removeEventListener('contextmenu', onContextMenu);
      }
      term.dispose();
    };
  }, [asset?.id, assetId, instanceId]);

  // 4. 字体与字号热重载（不重新建联）
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.options.fontSize = fontSize;
    term.options.fontFamily = fontFamily;

    const fitSafe = () => {
      try {
        fitAddonRef.current?.fit();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {
        // ignore
      }
    };
    const rafId = requestAnimationFrame(fitSafe);
    const timeoutId = setTimeout(fitSafe, 50);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [fontSize, fontFamily]);

  const handleAuthSubmit = (values: any) => {
    const activeWs = wsRef.current;
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      setConnecting(true);
      setAuthRequired(false);
      setStatusText('正在验证并初始化凭证交互...');
      activeWs.send(JSON.stringify({
        type: 'auth_response',
        username: values.username,
        password: values.password,
      }));
    }
  };

  const handleReconnect = () => {
    setAsset(null);
    if (assetId > 0) {
      getAsset(assetId).then(setAsset);
    }
  };

  const handleSyncToggle = (checked: boolean) => {
    setGlobalSyncedIds((prev) => {
      if (checked) {
        return prev.includes(instanceId) ? prev : [...prev, instanceId];
      } else {
        return prev.filter((id) => id !== instanceId);
      }
    });
  };

  // AI 助手：把文本直接写入本窗格终端。不带换行 = 仅填入待回车；带换行 = 直接执行
  const sendToTerminal = (text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(text));
      termRef.current?.focus();
    } else {
      message.warning('终端未连接');
    }
  };

  // 启动一次 Agent 任务（一句话 → 自动执行，命中高危暂停确认）
  const startAgent = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    if (assetId <= 0) { message.warning('请先选择资产再发起任务'); return; }
    setAiLoading(true);
    try {
      const st = await aiAgentStart(assetId, prompt);
      setAgentState(st);
      setAiPrompt('');
    } catch (e: any) {
      message.error(e?.message || 'AI 任务启动失败');
    } finally {
      setAiLoading(false);
    }
  };

  // 多轮追加指令（带上下文继续）
  const sendAgentFollowup = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || !agentState) return;
    setAiLoading(true);
    try {
      const st = await aiAgentMessage(agentState.session_id, prompt);
      setAgentState(st);
      setAiPrompt('');
    } catch (e: any) {
      message.error(e?.message || '发送失败');
    } finally {
      setAiLoading(false);
    }
  };

  // 高危命令确认(true) / 中止(false)
  const confirmAgent = async (approve: boolean) => {
    if (!agentState) return;
    setAiLoading(true);
    try {
      const st = await aiAgentContinue(agentState.session_id, approve);
      setAgentState(st);
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    } finally {
      setAiLoading(false);
    }
  };

  const resetAgent = () => { setAgentState(null); setAiPrompt(''); };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      position: 'relative',
      background: '#0B0F19',
      // 当开启同步且连接成功时，提供微微泛发靛蓝光的边框指示
      border: isSynced && status === 'connected' ? '1px solid #6366f1' : '1px solid #1e293b',
      boxShadow: isSynced && status === 'connected' ? '0 0 8px rgba(99, 102, 241, 0.35)' : 'none',
      boxSizing: 'border-box',
      transition: 'all 0.25s ease',
    }}>
      {/* 分屏窗口头部小状态栏 */}
      <div style={{
        height: '32px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        zIndex: 10,
      }}>
        <Space size="small" style={{ flex: 1, minWidth: 0 }}>
          {/* 同步勾选框 */}
          <Checkbox
            checked={isSynced}
            disabled={status !== 'connected'}
            onChange={(e) => handleSyncToggle(e.target.checked)}
            style={{ color: '#94a3b8', fontSize: 11, marginRight: 4 }}
          >
            <span style={{ fontSize: 11, color: isSynced ? '#a5b4fc' : '#94a3b8', fontWeight: isSynced ? 600 : 400 }}>
              同步
            </span>
          </Checkbox>

          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>资产:</span>
          <Select
            showSearch
            size="small"
            placeholder="选择资产..."
            value={assetId > 0 ? assetId : undefined}
            onChange={(val) => onAssetChange(val)}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={assets.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id }))}
            style={{ width: '60%', maxWidth: '180px' }}
            dropdownStyle={{ zIndex: 3000 }}
            popupMatchSelectWidth={false}
          />
          {status === 'connecting' && <SyncOutlined spin style={{ color: '#6366f1', fontSize: 11 }} />}
          {status === 'connected' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />}
          {(status === 'disconnected' || status === 'error') && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />}

          {/* 带呼吸灯动画的同步中标志 */}
          {isSynced && status === 'connected' && (
            <span style={{
              fontSize: 10,
              color: '#818cf8',
              background: 'rgba(99,102,241,0.15)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              animation: 'pulse 2s infinite'
            }}>
              <span style={{
                width: 4, height: 4, borderRadius: '50%', background: '#818cf8', marginRight: 4, display: 'inline-block'
              }} /> 同步中
            </span>
          )}
        </Space>
        
        <Space size={2} style={{ flexShrink: 0 }}>
          {status !== 'idle' && (
            <Button size="small" type="link" onClick={handleReconnect} style={{ padding: '0 4px', fontSize: 11, color: '#38bdf8' }}>
              重新连接
            </Button>
          )}
          {canClose && (
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              title="关闭此分屏"
              style={{ padding: '0 4px', fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center' }}
            />
          )}
        </Space>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Placeholder: 空白未连接状态卡片 */}
        {status === 'idle' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center',
            backgroundColor: '#0F172A', color: '#94a3b8', padding: '16px', zIndex: 5
          }}>
            <div style={{ textAlign: 'center', width: '100%', maxWidth: '260px' }}>
              <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>🖥️</span>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>当前分屏处于闲置状态</p>
              <Select
                showSearch
                placeholder="请选择连接资产..."
                onChange={(val) => onAssetChange(val)}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={assets.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id }))}
                style={{ width: '100%' }}
                dropdownStyle={{ zIndex: 3000 }}
              />
            </div>
          </div>
        )}

        {/* 失败/断开覆盖层 */}
        {(connecting || status === 'error' || status === 'disconnected') && status !== 'idle' && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.9)', zIndex: 12
          }}>
            {connecting ? (
              <>
                <Spin size="default" />
                <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>{statusText}</div>
              </>
            ) : (
              <div style={{
                textAlign: 'center', padding: '16px', background: '#1e293b', borderRadius: '8px',
                border: '1px solid #334155', width: '90%', maxWidth: '300px'
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <h4 style={{ margin: '0 0 4px 0', color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>终端连接已断开</h4>
                <p style={{ margin: '0 0 12px 0', color: '#94a3b8', fontSize: 11, lineHeight: 1.4, wordBreak: 'break-all' }}>
                  {errorDetail || 'WebSocket 意外关闭，请校验主机状态或凭证'}
                </p>
                <Space>
                  <Button size="small" type="primary" onClick={handleReconnect} style={{ borderRadius: 4 }}>重新连接</Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* 局部凭据表单 (Local Overlay) */}
        {authRequired && (
          <div style={{
            position: 'absolute', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.95)',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            zIndex: 15, padding: '16px'
          }}>
            <div style={{ width: '100%', maxWidth: '280px', background: '#1e293b', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc', marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                🔑 SSH 凭据验证
              </div>
              <p style={{ margin: '0 0 12px 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                资产 <strong>{asset?.name}</strong> 未绑定有效凭证，请输入账号密码开始连接：
              </p>
              <Form form={form} layout="vertical" onFinish={handleAuthSubmit} initialValues={{ username: 'root' }}>
                <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 11 }}>用户名</span>} name="username" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
                  <Input size="small" placeholder="root" />
                </Form.Item>
                <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 11 }}>密码 / 密钥密码</span>} name="password" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                  <Input.Password size="small" placeholder="password" />
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button type="primary" size="small" htmlType="submit" block style={{ borderRadius: 4 }}>开始连接</Button>
                </Form.Item>
              </Form>
            </div>
          </div>
        )}

        <div
          ref={terminalRef}
          className="terminal-container"
          style={{
            width: '100%',
            height: '100%',
            padding: '8px',
            boxSizing: 'border-box',
          }}
        />

        {/* 命令自动补全下拉：锚定光标，默认在输入行上方展开，避免遮挡输入 */}
        {completionEnabled && status === 'connected' && suggestions.length > 0 && anchor && (
          <div style={{
            position: 'absolute', zIndex: 14,
            width: 360, maxWidth: '90%',
            left: Math.max(8, Math.min(anchor.left, anchor.cw - 368)),
            // 光标位于容器下半部分时向上展开，否则向下展开
            ...(anchor.top > anchor.ch * 0.45
              ? { bottom: Math.max(8, anchor.ch - anchor.top + 4) }
              : { top: anchor.top + anchor.cellH + 4 }),
            background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
          }}>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {suggestions.map((s, i) => (
                <div
                  key={s.id}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '6px 10px', cursor: 'pointer',
                    background: i === activeIdx ? 'rgba(99,102,241,0.18)' : 'transparent',
                    borderLeft: i === activeIdx ? '2px solid #6366f1' : '2px solid transparent',
                  }}
                >
                  <span style={{
                    fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                  }}>
                    {s.keyword && (
                      <span style={{ color: '#818cf8', marginRight: 8 }}>{s.keyword}</span>
                    )}
                    {s.cmd}
                  </span>
                  {s.desc && (
                    <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {s.desc}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div style={{
              padding: '4px 10px', borderTop: '1px solid #1e293b',
              fontSize: 10, color: '#64748b', background: '#0b1220',
            }}>
              Tab 补全 · ↑↓ 选择 · Esc 关闭
            </div>
          </div>
        )}
      </div>

      {/* AI 助手栏（Agent 模式）：仅在已连接且后端启用时出现 */}
      {aiEnabled && status === 'connected' && (
        <div style={{ background: '#0F172A', borderTop: '1px solid #1e293b', padding: aiOpen ? '8px 10px' : '4px 10px', flexShrink: 0 }}>
          {!aiOpen ? (
            <Button
              type="text"
              size="small"
              icon={<RobotOutlined />}
              onClick={() => setAiOpen(true)}
              style={{ color: '#818cf8', fontSize: 12, padding: '0 4px' }}
            >
              AI 助手 · 自动执行
            </Button>
          ) : (
            <div>
              {/* 头部：标题 + 工作目录 + 新建/收起 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#a5b4fc', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RobotOutlined /> AI 助手 · 自动执行
                  {agentState?.work_dir && (
                    <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>cwd: {agentState.work_dir}</span>
                  )}
                </span>
                <Space size={4}>
                  {agentState && (
                    <Button size="small" type="text" onClick={resetAgent} style={{ fontSize: 11, color: '#94a3b8' }}>新建任务</Button>
                  )}
                  <Button size="small" type="text" onClick={() => setAiOpen(false)} style={{ fontSize: 11, color: '#94a3b8' }}>收起</Button>
                </Space>
              </div>

              {/* 执行记录（transcript） */}
              {agentState && agentState.steps.length > 0 && (
                <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8, paddingRight: 2 }}>
                  {agentState.steps.map((step) => (
                    <div key={step.index} style={{ marginBottom: 8 }}>
                      {step.thought && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>💭 {step.thought}</div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                          <span style={{ color: '#818cf8' }}>▶ </span>{step.command}
                        </span>
                        <span style={{ fontSize: 10, color: step.exit_code === 0 ? '#10B981' : '#f87171', whiteSpace: 'nowrap' }}>
                          exit {step.exit_code}{step.dangerous ? ' ⚠' : ''}
                        </span>
                        <Button size="small" type="text" title="填入可见终端" onClick={() => sendToTerminal(step.command)} style={{ fontSize: 10, color: '#38bdf8', padding: '0 4px' }}>填入</Button>
                      </div>
                      {step.output && (
                        <pre style={{
                          margin: '4px 0 0 0', maxHeight: 120, overflow: 'auto',
                          background: '#020617', border: '1px solid #1e293b', borderRadius: 4,
                          padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        }}>{step.output}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 执行中提示 */}
              {aiLoading && (
                <div style={{ fontSize: 11, color: '#818cf8', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <SyncOutlined spin /> AI 执行中…（自动运行命令并读取输出推进任务）
                </div>
              )}

              {/* 高危命令待确认 */}
              {!aiLoading && agentState?.status === 'awaiting_confirm' && (
                <div style={{ marginBottom: 8, background: '#020617', border: '1px solid #b91c1c', borderRadius: 6, padding: '8px 10px' }}>
                  {agentState.pending_note && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>💭 {agentState.pending_note}</div>
                  )}
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#fca5a5', wordBreak: 'break-all', marginBottom: 4 }}>
                    {agentState.pending}
                  </div>
                  <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8 }}>
                    {agentState.pending_warning || '⚠️ 高危命令，确认后才会执行'}
                  </div>
                  <Space>
                    <Button size="small" danger type="primary" icon={<ThunderboltOutlined />} onClick={() => confirmAgent(true)}>确认执行</Button>
                    <Button size="small" onClick={() => confirmAgent(false)}>中止</Button>
                    <Button size="small" type="text" icon={<EnterOutlined />} onClick={() => sendToTerminal(agentState.pending)} style={{ color: '#38bdf8' }}>仅填入终端</Button>
                  </Space>
                </div>
              )}

              {/* 完成 / 中止总结 */}
              {!aiLoading && (agentState?.status === 'done' || agentState?.status === 'aborted') && agentState.summary && (
                <div style={{
                  marginBottom: 8, fontSize: 12,
                  color: agentState.status === 'done' ? '#34d399' : '#94a3b8',
                }}>
                  {agentState.status === 'done' ? '✓ ' : '■ '}{agentState.summary}
                </div>
              )}

              {/* 出错 */}
              {!aiLoading && agentState?.status === 'error' && (
                <div style={{ marginBottom: 8, fontSize: 12, color: '#f87171' }}>✗ {agentState.error}</div>
              )}

              {/* 输入框：无会话=发起任务，有会话=多轮追加 */}
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  size="small"
                  value={aiPrompt}
                  disabled={aiLoading}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onPressEnter={agentState ? sendAgentFollowup : startAgent}
                  placeholder={agentState ? '追加指令继续（带上下文）…' : '一句话描述要自动完成的运维任务，如：清理 /var/log 下大于100M 的日志'}
                  prefix={<RobotOutlined style={{ color: '#818cf8' }} />}
                  style={{ background: '#1e293b', borderColor: '#334155', color: '#e2e8f0' }}
                />
                <Button size="small" type="primary" loading={aiLoading} onClick={agentState ? sendAgentFollowup : startAgent}>
                  {agentState ? '继续' : '执行'}
                </Button>
              </Space.Compact>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
