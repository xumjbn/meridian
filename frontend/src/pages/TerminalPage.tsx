import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Button, Space, message, Spin, Select, Radio, Checkbox, Tooltip, Popover } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { getAsset, getTerminalWsUrl, getLocalTerminalWsUrl, getAssets, LOCAL_ASSET_ID, type Asset } from '../services/api';
import { CloseOutlined, SyncOutlined, FullscreenOutlined, FullscreenExitOutlined, PlusOutlined, SettingOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette } from '../theme';
import { useTerminals } from '../terminalSessions';
import { SnippetManager } from '../components/SnippetManager';
import { TerminalAIPanel } from '../components/TerminalAIPanel';
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

// 终端配色主题（xterm theme + 容器底色），可在顶栏切换并持久化
interface TermTheme { background: string; foreground: string; cursor: string; [k: string]: string }
const termThemes: { label: string; value: string; theme: TermTheme }[] = [
  { label: 'Meridian 深空', value: 'meridian', theme: {
    background: '#0B0F19', foreground: '#F3F4F6', cursor: '#1677ff', black: '#000000', red: '#EF4444',
    green: '#10B981', yellow: '#F59E0B', blue: '#3B82F6', magenta: '#8B5CF6', cyan: '#06B6D4', white: '#FFFFFF' } },
  { label: 'VS Code 暗', value: 'vscode', theme: {
    background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad', black: '#000000', red: '#cd3131',
    green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5' } },
  { label: 'Dracula', value: 'dracula', theme: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', black: '#21222c', red: '#ff5555',
    green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2' } },
  { label: 'Monokai', value: 'monokai', theme: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', black: '#272822', red: '#f92672',
    green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2' } },
  { label: 'Solarized 暗', value: 'sol-dark', theme: {
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', black: '#073642', red: '#dc322f',
    green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5' } },
  { label: 'Solarized 亮', value: 'sol-light', theme: {
    background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', black: '#073642', red: '#dc322f',
    green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5' } },
  { label: 'GitHub 亮', value: 'gh-light', theme: {
    background: '#ffffff', foreground: '#24292e', cursor: '#044289', black: '#24292e', red: '#d73a49',
    green: '#28a745', yellow: '#dbab09', blue: '#0366d6', magenta: '#5a32a3', cyan: '#0598bc', white: '#6a737d' } },
];
const getTermTheme = (v: string): TermTheme => (termThemes.find((t) => t.value === v) || termThemes[0]).theme;

// 复制到剪贴板：优先用 Clipboard API；在非安全上下文 / 桌面 WebView 下回退 execCommand，
// 保证终端选区复制始终可用（解决「无法复制终端」）。
const writeClipboard = (text: string) => {
  if (!text) return;
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      /* ignore */
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
};

// 从剪贴板读取（粘贴）：Clipboard API 不可用时返回空，调用方据此回退
const readClipboard = async (): Promise<string> => {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
  return '';
};

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
  // 顶部工具栏折叠：收起后扩大终端输出区域（持久化）
  const [toolbarCollapsed, setToolbarCollapsed] = useState<boolean>(() => localStorage.getItem('term_toolbar_collapsed') === '1');
  const toggleToolbar = (v: boolean) => {
    setToolbarCollapsed(v);
    localStorage.setItem('term_toolbar_collapsed', v ? '1' : '0');
  };
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

  // 终端配色主题
  const [termThemeKey, setTermThemeKey] = useState<string>(() => localStorage.getItem('term_theme') || 'meridian');
  const termTheme = getTermTheme(termThemeKey);

  // 终端字符编码（默认 UTF-8；连本地 Windows/GBK 主机中文乱码时切 GBK）
  const [termEncoding, setTermEncoding] = useState<string>(() => localStorage.getItem('term_encoding') || 'utf-8');

  // 命令自动补全开关 + 命令库管理弹窗
  const [completionEnabled, setCompletionEnabled] = useState<boolean>(() => {
    return localStorage.getItem('term_completion_enabled') !== 'false';
  });
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);

  // 未绑定凭据时自动尝试已存凭据（默认开）；getTerminalWsUrl 读取 localStorage 决定是否带 autotry=0
  const [autoTryCred, setAutoTryCred] = useState<boolean>(() => {
    return localStorage.getItem('term_auto_cred') !== 'false';
  });
  const toggleAutoTryCred = (checked: boolean) => {
    setAutoTryCred(checked);
    localStorage.setItem('term_auto_cred', checked ? 'true' : 'false');
  };

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
                    termTheme={termTheme}
                    termEncoding={termEncoding}
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
        /* 终端滚动条改深色，避免默认浅色滚动条在终端右侧显示为「白色竖线」 */
        .terminal-container .xterm-viewport {
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.35) transparent;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-track {
          background: transparent;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-thumb {
          background: rgba(148,163,184,0.28);
          border-radius: 6px;
        }
        .terminal-container .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background: rgba(148,163,184,0.5);
        }
      `}} />

      {/* 顶部全局状态栏（可折叠以扩大输出区域） */}
      {!toolbarCollapsed && (
      <div style={{
        minHeight: '48px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 16px',
        zIndex: 50,
      }}>
        <Space size="small" style={{ flexShrink: 0 }}>
          <LogoMark size={22} />
          <span style={{ fontWeight: 600, fontSize: 14, color: palette.text, whiteSpace: 'nowrap' }}>
            Meridian 远程终端多屏中心
          </span>
        </Space>

        <Space size="small" wrap style={{ rowGap: 6, justifyContent: 'flex-end' }}>
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

          <Tooltip title="资产未绑定凭据时，先自动尝试你已保存的 SSH 凭据，成功则自动绑定；全部失败再手动输入">
            <Checkbox
              checked={autoTryCred}
              onChange={(e) => toggleAutoTryCred(e.target.checked)}
              style={{ fontSize: 12, color: '#475569' }}
            >
              自动试凭据
            </Checkbox>
          </Tooltip>

          {/* 外观与编码设置（收进 Popover，避免顶栏拥挤） */}
          <Popover
            trigger="click"
            placement="bottomRight"
            title="外观与编码"
            content={(
              <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>字体</span>
                  <Select
                    size="small"
                    value={fontFamily}
                    onChange={(val) => setFontFamily(val)}
                    options={fontFamilies}
                    style={{ width: 170 }}
                    popupMatchSelectWidth={false}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>字号</span>
                  <Select
                    size="small"
                    value={fontSize}
                    onChange={(val) => setFontSize(val)}
                    options={fontSizes.map((s) => ({ label: `${s}px`, value: s }))}
                    style={{ width: 170 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>配色</span>
                  <Select
                    size="small"
                    value={termThemeKey}
                    onChange={(val) => { setTermThemeKey(val); localStorage.setItem('term_theme', val); }}
                    options={termThemes.map((t) => ({ label: t.label, value: t.value }))}
                    style={{ width: 170 }}
                    popupMatchSelectWidth={false}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Tooltip title="远端中文乱码时切到 GBK（如本地 Windows / GB18030 主机）；切换后建议重新连接">
                    <span style={{ fontSize: 12, color: '#475569', cursor: 'help' }}>编码</span>
                  </Tooltip>
                  <Select
                    size="small"
                    value={termEncoding}
                    onChange={(val) => { setTermEncoding(val); localStorage.setItem('term_encoding', val); }}
                    options={[{ label: 'UTF-8', value: 'utf-8' }, { label: 'GBK', value: 'gbk' }]}
                    style={{ width: 170 }}
                    popupMatchSelectWidth={false}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  右键粘贴 · 复制/粘贴 Ctrl+Shift+C / V
                </div>
              </div>
            )}
          >
            <Button size="small" type="text" icon={<SettingOutlined />} style={{ fontSize: 12, color: '#475569' }}>
              外观
            </Button>
          </Popover>

          <Button
            type="text"
            icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={() => setFullscreen((f) => !f)}
            style={{ color: '#475569', display: 'flex', alignItems: 'center' }}
          >
            {fullscreen ? '退出全屏' : '全屏'}
          </Button>

          <Tooltip title="收起工具栏，扩大输出区域">
            <Button
              type="text"
              icon={<UpOutlined />}
              onClick={() => toggleToolbar(true)}
              style={{ color: '#475569', display: 'flex', alignItems: 'center' }}
            />
          </Tooltip>

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
      )}

      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', position: 'relative', background: '#0B0F19' }}>
        {/* 工具栏收起态：左上角悬浮的展开按钮 */}
        {toolbarCollapsed && (
          <Tooltip title="展开工具栏" placement="right">
            <Button
              size="small"
              icon={<DownOutlined />}
              onClick={() => toggleToolbar(false)}
              style={{
                position: 'absolute', top: 6, left: 6, zIndex: 1400,
                background: 'rgba(30,41,59,0.92)', color: '#cbd5e1', border: '1px solid #334155',
              }}
            />
          </Tooltip>
        )}
        {renderGrid()}
        {/* 悬浮 AI 助手（收起为右下角按钮，展开为可调宽浮层，带历史切换） */}
        <TerminalAIPanel assets={assets} defaultAssetId={assetId} />
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
  termTheme: TermTheme;    // 终端配色主题
  termEncoding: string;    // 终端字符编码：utf-8 | gbk
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

const TerminalItem: React.FC<TerminalItemProps> = ({ paneId, assetId, fontSize, fontFamily, termTheme, termEncoding, assets, completionEnabled, canClose, onClose, onAssetChange }) => {
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

  // 终端搜索（Ctrl+F）
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<any>(null);

  // 终端输出历史缓冲（重连后回放，恢复以前的终端记录）
  const outputBufRef = useRef<Array<string | Uint8Array>>([]);
  const outputBytesRef = useRef(0);
  const termThemeRef = useRef(termTheme);
  useEffect(() => { termThemeRef.current = termTheme; }, [termTheme]);
  const termEncodingRef = useRef(termEncoding);
  useEffect(() => { termEncodingRef.current = termEncoding; }, [termEncoding]);

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

  // 本地终端：任意负数 assetId 都视为本地终端（连后端本机 Shell），
  // 不同负数 id 即不同的本地终端会话/分屏，支持同时开多个。
  const isLocal = assetId < 0;

  // 2. 同步加载被分配的资产详情
  useEffect(() => {
    if (isLocal) {
      // 合成一个「本地终端」资产，驱动下方 WebSocket 建联（不发请求）
      setAsset({ id: assetId, name: '本地终端', ip: '本机', type: 'server' } as Asset);
      return;
    }
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
    if (!asset) return;
    if (!isLocal && assetId <= 0) return;

    setConnecting(true);
    setAuthRequired(false);
    setStatus('connecting');
    setStatusText('正在建立 WebSocket 隧道...');
    setErrorDetail('');

    let resizeRaf = 0;
    let onMouseUp: (() => void) | null = null;
    let onContextMenu: ((e: MouseEvent) => void) | null = null;
    const containerEl = terminalRef.current;

    const wsUrl = isLocal ? getLocalTerminalWsUrl() : getTerminalWsUrl(asset.id!);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontSize: fontSize,
      fontFamily: fontFamily,
      theme: { ...termThemeRef.current },
      allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    searchAddonRef.current = searchAddon;
    term.loadAddon(searchAddon);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && key === 'c') {
        const sel = term.getSelection();
        if (sel) writeClipboard(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && key === 'v') {
        readClipboard().then((t) => { if (t) term.paste(t); });
        return false;
      }
      // Ctrl+F 打开终端内搜索
      if (e.ctrlKey && !e.shiftKey && key === 'f') {
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus?.(), 0);
        return false;
      }
      return true;
    });

    if (terminalRef.current) {
      term.open(terminalRef.current);

      // 重连时回放此前的终端历史输出（恢复以前的终端记录）
      if (outputBufRef.current.length > 0) {
        term.write('\x1b[90m──────── 以下为重连前的历史输出 ────────\x1b[0m\r\n');
        for (const chunk of outputBufRef.current) {
          term.write(chunk as string);
        }
        term.write('\x1b[90m──────── 历史输出结束，下面是新会话 ────────\x1b[0m\r\n');
      }

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
        if (sel && sel.length > 0) writeClipboard(sel);
      };
      onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        // 有选区则右键复制；否则右键粘贴（PuTTY 风格）
        const sel = term.getSelection();
        if (sel && sel.length > 0) {
          writeClipboard(sel);
          term.clearSelection();
        } else {
          readClipboard().then((t) => { if (t) term.paste(t); });
        }
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

    term.write(`\x1b[36m[SYSTEM]\x1b[0m 正在建立${isLocal ? '本地终端' : '远程 WebSocket'}连接通道...\r\n`);

    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);

    socket.onopen = () => {
      setStatusText(isLocal ? '通道开启，正在启动本机 Shell...' : '通道开启，正在进行 SSH 连接拨号...');
      term.write(isLocal
        ? '\x1b[36m[SYSTEM]\x1b[0m WebSocket 通道连接成功，正在启动本机 Shell...\r\n'
        : '\x1b[36m[SYSTEM]\x1b[0m WebSocket 通道连接成功，开始拨号远程主机端口 22...\r\n');
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    // GBK/GB18030 流式解码器（编码=gbk 时用它把字节转成字符串，处理跨帧半个汉字）
    let gbkDecoder: TextDecoder | null = null;
    try { gbkDecoder = new TextDecoder('gb18030'); } catch { gbkDecoder = null; }

    // 累积远端输出到历史缓冲（上限 512KB，超出从头丢弃），供重连回放
    const appendBuf = (chunk: string | Uint8Array) => {
      outputBufRef.current.push(chunk);
      outputBytesRef.current += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
      while (outputBytesRef.current > 512 * 1024 && outputBufRef.current.length > 1) {
        const removed = outputBufRef.current.shift()!;
        outputBytesRef.current -= typeof removed === 'string' ? removed.length : removed.byteLength;
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
              term.write(isLocal
                ? '\x1b[32m[SYSTEM] 本地终端已就绪，开始接受输入！\x1b[0m\r\n\r\n'
                : '\x1b[32m[SYSTEM] SSH 会话连接成功，终端开始接受输入！\x1b[0m\r\n\r\n');
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
          appendBuf(event.data as string);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        if (termEncodingRef.current === 'gbk' && gbkDecoder) {
          // GBK 主机：先解码为字符串再写入（xterm 默认按 UTF-8 解析字节，会乱码）
          const s = gbkDecoder.decode(bytes, { stream: true });
          term.write(s);
          appendBuf(s);
        } else {
          term.write(bytes);
          appendBuf(bytes);
        }
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
    term.options.theme = { ...termTheme };

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
  }, [fontSize, fontFamily, termTheme]);

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
    if (isLocal) {
      // 先卸载再于下一拍重建，触发 WebSocket 重连
      setTimeout(() => setAsset({ id: assetId, name: '本地终端', ip: '本机', type: 'server' } as Asset), 0);
    } else if (assetId > 0) {
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

  // 终端搜索：高亮所有匹配并跳转上一个/下一个
  const doSearch = (forward: boolean) => {
    const q = searchQuery;
    if (!q || !searchAddonRef.current) return;
    const opts = {
      caseSensitive: false,
      decorations: {
        matchBackground: '#f59e0b66', matchBorder: '#f59e0b', matchOverviewRuler: '#f59e0b',
        activeMatchBackground: '#f59e0b', activeMatchBorder: '#b45309', activeMatchColorOverviewRuler: '#fbbf24',
      },
    };
    if (forward) searchAddonRef.current.findNext(q, opts as any);
    else searchAddonRef.current.findPrevious(q, opts as any);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations?.();
    termRef.current?.focus();
  };

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

          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{isLocal ? '终端:' : '资产:'}</span>
          <Select
            showSearch
            size="small"
            placeholder="选择资产..."
            value={assetId > 0 || isLocal ? assetId : undefined}
            onChange={(val) => onAssetChange(val)}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={[
              { label: '💻 本地终端 · 本机', value: isLocal ? assetId : LOCAL_ASSET_ID },
              ...assets.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id })),
            ]}
            style={{ flex: 1, minWidth: 150, maxWidth: 300 }}
            dropdownStyle={{ zIndex: 3000 }}
            popupMatchSelectWidth={280}
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
                options={[
                  { label: '💻 本地终端 · 本机', value: LOCAL_ASSET_ID },
                  ...assets.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id })),
                ]}
                style={{ width: '100%' }}
                dropdownStyle={{ zIndex: 3000 }}
              />
              <div style={{ marginTop: 10 }}>
                <Button size="small" type="primary" ghost block onClick={() => onAssetChange(LOCAL_ASSET_ID)}>
                  💻 打开本地终端
                </Button>
              </div>
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
            background: termTheme.background,
          }}
        />

        {/* 终端搜索框（Ctrl+F） */}
        {searchOpen && (
          <div style={{
            position: 'absolute', top: 6, right: 10, zIndex: 16,
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            padding: '4px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
          }}>
            <Input
              ref={searchInputRef}
              size="small"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); doSearch(!e.shiftKey); }
                else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
              }}
              placeholder="搜索终端内容"
              style={{ width: 170, background: '#0f172a', borderColor: '#334155', color: '#e2e8f0' }}
            />
            <Tooltip title="上一个 (Shift+Enter)">
              <Button size="small" type="text" onClick={() => doSearch(false)} style={{ color: '#94a3b8', padding: '0 4px' }}>↑</Button>
            </Tooltip>
            <Tooltip title="下一个 (Enter)">
              <Button size="small" type="text" onClick={() => doSearch(true)} style={{ color: '#94a3b8', padding: '0 4px' }}>↓</Button>
            </Tooltip>
            <Tooltip title="关闭 (Esc)">
              <Button size="small" type="text" onClick={closeSearch} style={{ color: '#94a3b8', padding: '0 4px' }}>✕</Button>
            </Tooltip>
          </div>
        )}

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

    </div>
  );
};
