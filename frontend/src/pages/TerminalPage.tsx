import React, { useEffect, useRef, useState } from 'react';
import { Form, Input, Button, Space, message, Spin, Select, Radio, Checkbox } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getAsset, getTerminalWsUrl, getAssets, type Asset } from '../services/api';
import { CloseOutlined, SyncOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette } from '../theme';
import { useTerminals } from '../terminalSessions';
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

interface SplitSession {
  id: string;
  assetId: number;
}

type LayoutType = 'single' | 'h-split' | 'quad';

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

  // 全局布局设置
  const [layout, setLayout] = useState<LayoutType>(() => {
    return (localStorage.getItem('term_layout') as LayoutType) || 'single';
  });

  // 分屏会话列表
  const [sessions, setSessions] = useState<SplitSession[]>(() => {
    return [{ id: `session-1-${Date.now()}`, assetId: assetId }];
  });

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

  // 2. 外部传入的初始 assetId 变更时，更新主屏 session
  useEffect(() => {
    setSessions((prev) => {
      const next = [...prev];
      if (next[0]) {
        next[0] = { ...next[0], assetId: assetId };
      }
      return next;
    });
  }, [assetId]);

  // 3. 监听布局变更，同步扩缩会话队列
  useEffect(() => {
    localStorage.setItem('term_layout', layout);
    setSessions((prev) => {
      const targetLength = layout === 'single' ? 1 : layout === 'h-split' ? 2 : 4;
      if (prev.length === targetLength) return prev;
      if (prev.length > targetLength) {
        return prev.slice(0, targetLength);
      }
      // 补充空会话 (默认为 0，展示资产选择卡片)
      const next = [...prev];
      for (let i = prev.length; i < targetLength; i++) {
        next.push({
          id: `session-${Date.now()}-${i}`,
          assetId: 0,
        });
      }
      return next;
    });

    // 如果切换回单屏布局，自动取消当前所有同步，以防止单屏输入误操作后台终端
    if (layout === 'single') {
      syncAllConnected(false);
    }
  }, [layout, syncAllConnected]);

  const handleAssetChange = (index: number, newAssetId: number) => {
    setSessions((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], assetId: newAssetId };
      }
      return next;
    });
  };

  const handleClose = () => {
    if (onClose) onClose();
    else window.close();
  };

  // 计算全局一键同步 Checkbox 的状态
  const allSynced = connectedIds.length > 0 && globalSyncedIds.length === connectedIds.length;
  const isIndeterminate = globalSyncedIds.length > 0 && globalSyncedIds.length < connectedIds.length;

  const renderGrid = () => {
    const containerStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      background: '#0B0F19',
      boxSizing: 'border-box',
      padding: '4px',
    };

    if (layout === 'single') {
      return (
        <div style={containerStyle}>
          {sessions[0] && (
            <TerminalItem
              key={sessions[0].id}
              paneId={sessions[0].id}
              assetId={sessions[0].assetId}
              fontSize={fontSize}
              fontFamily={fontFamily}
              assets={assets}
              onAssetChange={(newId) => handleAssetChange(0, newId)}
            />
          )}
        </div>
      );
    }

    if (layout === 'h-split') {
      return (
        <div style={{ ...containerStyle, display: 'flex', gap: '4px' }}>
          {sessions.slice(0, 2).map((s, index) => (
            <div key={s.id} style={{ flex: 1, height: '100%', minWidth: 0 }}>
              <TerminalItem
                paneId={s.id}
                assetId={s.assetId}
                fontSize={fontSize}
                fontFamily={fontFamily}
                assets={assets}
                onAssetChange={(newId) => handleAssetChange(index, newId)}
              />
            </div>
          ))}
        </div>
      );
    }

    // 四分屏
    return (
      <div style={{
        ...containerStyle,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: '4px',
      }}>
        {sessions.slice(0, 4).map((s, index) => (
          <div key={s.id} style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}>
            <TerminalItem
              paneId={s.id}
              assetId={s.assetId}
              fontSize={fontSize}
              fontFamily={fontFamily}
              assets={assets}
              onAssetChange={(newId) => handleAssetChange(index, newId)}
            />
          </div>
        ))}
      </div>
    );
  };

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
      {/* CSS keyframes pulse 呼吸动画注入 */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
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
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
              style={{ marginLeft: 6 }}
            >
              <Radio.Button value="single">单屏</Radio.Button>
              <Radio.Button value="h-split">左右双分</Radio.Button>
              <Radio.Button value="quad">田字四分</Radio.Button>
            </Radio.Group>
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
  onAssetChange: (id: number) => void;
}

const TerminalItem: React.FC<TerminalItemProps> = ({ paneId, assetId, fontSize, fontFamily, assets, onAssetChange }) => {
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
        
        {status !== 'idle' && (
          <Button size="small" type="link" onClick={handleReconnect} style={{ padding: '0 4px', fontSize: 11, color: '#38bdf8' }}>
            重新连接
          </Button>
        )}
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
      </div>
    </div>
  );
};
