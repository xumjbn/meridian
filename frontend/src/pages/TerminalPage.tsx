import React, { useEffect, useRef, useState } from 'react';
import { Form, Input, Button, Space, message, Spin, Modal } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getAsset, getTerminalWsUrl, type Asset } from '../services/api';
import { CloseOutlined, CheckCircleOutlined, SyncOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette } from '../theme';
import '@xterm/xterm/css/xterm.css';

interface TerminalPageProps {
  assetId: number;
  /** 在 App 内部以标签页形式嵌入（填满容器，关闭走回调而非关闭浏览器窗口） */
  embedded?: boolean;
  onClose?: () => void;
}

export const TerminalPage: React.FC<TerminalPageProps> = ({ assetId, embedded = false, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statusText, setStatusText] = useState('正在加载资产信息...');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [fullscreen, setFullscreen] = useState(false);
  const [form] = Form.useForm();

  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // 1. 获取资产详情
  useEffect(() => {
    const fetchAsset = async () => {
      try {
        const data = await getAsset(assetId);
        setAsset(data);
      } catch (e) {
        message.error('加载资产信息失败');
        setStatusText('资产加载失败，请检查 ID 是否正确');
        setErrorDetail('接口请求失败，未找到该 ID 的资产');
        setStatus('error');
      }
    };
    fetchAsset();
  }, [assetId]);

  // 2. 建立终端连接
  useEffect(() => {
    if (!asset) return;

    setConnecting(true);
    setAuthRequired(false);
    setStatus('connecting');
    setStatusText('正在建立 WebSocket 隧道...');
    setErrorDetail('');

    let resizeRaf = 0; // ResizeObserver 的 requestAnimationFrame 句柄
    let onMouseUp: (() => void) | null = null;       // 选中即复制
    let onContextMenu: ((e: MouseEvent) => void) | null = null; // 右键粘贴
    const containerEl = terminalRef.current;

    // 创建 WebSocket 实例
    const wsUrl = getTerminalWsUrl(asset.id!);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;

    // 初始化 Xterm
    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000, // 回看历史行数
      fontSize: 14,
      fontFamily: 'Fira Code, Menlo, Monaco, Courier New, monospace',
      theme: {
        background: '#0B0F19', // 黑曜石暗黑背景
        foreground: '#F3F4F6', // 亮灰色字体
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

    // 键盘复制/粘贴：Ctrl+Shift+C 复制选区，Ctrl+Shift+V 粘贴（不与终端内 Ctrl+C 中断信号冲突）
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

    // 挂载 DOM
    if (terminalRef.current) {
      term.open(terminalRef.current);

      // 首屏多次适配尺寸：rAF + 延时 + 等 Web 字体（Fira Code）加载完成后再校正一次，
      // 防止字体晚加载导致行高变化、最后一行被裁掉一半
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

      // 鼠标复制/粘贴：选中文本松开即复制；右键把剪贴板内容粘贴进终端
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

      // 监听容器尺寸变化；用 rAF 把 fit() 推迟到下一帧，
      // 打断 ResizeObserver「回调里同步改布局 → 再次触发回调」的死循环
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          const el = terminalRef.current;
          if (!el || el.clientWidth === 0 || el.clientHeight === 0) return; // 隐藏(display:none)时跳过
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

    // 发送心跳定时器（每20秒发送一次 ping，防止中转代理如 nginx 或 vite proxy 断连）
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);

    socket.onopen = () => {
      setStatusText('通道开启，正在进行 SSH 连接拨号...');
      term.write('\x1b[36m[SYSTEM]\x1b[0m WebSocket 通道连接成功，开始拨号远程主机端口 22...\r\n');
      
      // 发送首次 resize
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
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
              // 捕获异常的连接拨号失败状态
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
        // 直接渲染终端字符流
        term.write(new Uint8Array(event.data));
      }
    };

    const dataListener = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        const encoder = new TextEncoder();
        socket.send(encoder.encode(data));
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
        // 尝试通过之前的状态文案判断失败原因
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
    // 依赖 asset?.id（稳定主键）而非 asset 对象引用：
    // 避免资产信息被重复 setAsset（如严格模式重复请求）时误触发重连、把刚弹出的凭据框重置掉
  }, [asset?.id]);

  // 全屏切换后重新适配终端尺寸并同步给后端
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
        const ws = wsRef.current;
        const term = termRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {
        // ignore
      }
    }, 80);
    return () => clearTimeout(t);
  }, [fullscreen]);

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

  const handleClose = () => {
    if (onClose) onClose();
    else window.close();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0B0F19', // 终端主体依然保持极客深色
      color: '#F9FAFB',
      overflow: 'hidden',
      // 内嵌态用绝对定位精确填满（带 position:relative 的）父容器，
      // 避免 height:100% 在 flex 链上无法解析导致终端被撑到内容高度而裁切
      ...(fullscreen
        ? { position: 'fixed' as const, inset: 0, zIndex: 2000, height: '100vh' }
        : embedded
        ? { position: 'absolute' as const, inset: 0 }
        : { height: '100vh' }),
    }}>
      {/* 顶部状态栏 */}
      <div style={{
        height: '48px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 5,
      }}>
        <Space size="middle">
          <LogoMark size={22} />
          <span style={{ fontWeight: 600, fontSize: 14, color: palette.text }}>
            Meridian 远程终端：{asset ? `${asset.name} (${asset.ip})` : '正在加载...'}
          </span>

          {status === 'connecting' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: '#475569' }}>
              <SyncOutlined spin style={{ marginRight: 6, color: palette.primary }} /> 连接中
            </span>
          )}
          {status === 'connected' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: '#10B981' }}>
              <CheckCircleOutlined style={{ marginRight: 6 }} /> 已连接
            </span>
          )}
          {(status === 'disconnected' || status === 'error') && (
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: '#EF4444' }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#EF4444', marginRight: 6, display: 'inline-block'
              }} /> 已断开
            </span>
          )}
        </Space>
        
        <Space>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            选中复制 · 右键粘贴 · Ctrl+Shift+C / V
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
        {(connecting || status === 'error' || status === 'disconnected') && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(6px)', zIndex: 10
          }}>
            {connecting ? (
              <>
                <Spin size="large" />
                <div style={{ marginTop: 16, fontSize: 14, color: '#475569', fontWeight: 500 }}>{statusText}</div>
              </>
            ) : (
              <div style={{
                textAlign: 'center', padding: '32px', background: '#ffffff', borderRadius: '12px',
                border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05)',
                width: '100%', maxWidth: '420px'
              }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
                <h3 style={{ margin: '0 0 8px 0', color: '#0f172a', fontWeight: 600, fontSize: 16 }}>会话连接已断开</h3>
                <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
                  无法建立远程连接。您可以核对目标主机的状态、网络端口 22 或关联凭据配置是否正确。
                </p>
                {/* 显式打印捕获到的后端错误明细 */}
                <div style={{
                  margin: '0 0 24px 0',
                  color: '#be123c',
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  wordBreak: 'break-all',
                  lineHeight: '1.4'
                }}>
                  <strong>失败原因:</strong> {errorDetail || '未知（无明确握手回复，请检查网络）'}
                </div>
                <Space style={{ width: '100%', justifyContent: 'center' }}>
                  <Button onClick={handleClose} style={{ borderRadius: 6 }}>关闭窗口</Button>
                  <Button type="primary" onClick={() => {
                    setAsset(null);
                    getAsset(assetId).then(setAsset);
                  }} style={{ borderRadius: 6 }}>
                    重新连接
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        <Modal
          open={authRequired}
          onCancel={handleClose}
          footer={null}
          closable={false}
          maskClosable={false}
          centered
          width={400}
          destroyOnHidden
          title={<span style={{ fontSize: 16, fontWeight: 600 }}>🔑 SSH 登录凭证</span>}
        >
          <p style={{ margin: '0 0 20px 0', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
            资产 <strong>{asset?.name}</strong> 未绑定可用凭证，请输入临时登录账号及口令以建立会话。
          </p>
          <Form form={form} layout="vertical" onFinish={handleAuthSubmit} initialValues={{ username: 'root' }}>
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input placeholder="例如: root" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password placeholder="请输入密码" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Button type="primary" htmlType="submit" block>立即连接</Button>
              <Button type="text" onClick={handleClose} block style={{ marginTop: 8, color: '#64748b' }}>
                取消并关闭
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        <div
          ref={terminalRef}
          className="terminal-container"
          style={{
            width: '100%',
            height: '100%',
            padding: '12px',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
};
