import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Button, Space, message, Spin } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getTerminalWsUrl, type Asset } from '../services/api';

interface TerminalModalProps {
  visible: boolean;
  asset: Asset | null;
  onClose: () => void;
}

export const TerminalModal: React.FC<TerminalModalProps> = ({ visible, asset, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [form] = Form.useForm();

  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!visible || !asset) {
      cleanup();
      return;
    }

    setConnecting(true);
    setAuthRequired(false);
    setStatusText('正在初始化 WebSocket 连接...');

    // 1. 创建 WebSocket 连接
    const wsUrl = getTerminalWsUrl(asset.id!);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    setWs(socket);

    // 2. 初始化 Xterm 终端
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Courier New, monospace',
      theme: {
        background: '#000000',
        foreground: '#f8f8f2',
        cursor: '#f8f8f0',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bbbbbb',
      },
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // 立即在 DOM 中挂载并自适应大小，保证连接日志可展示
    if (terminalRef.current) {
      term.open(terminalRef.current);
      fitAddon.fit();
      term.focus();

      // 监听终端窗口自适应变化
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows
            }));
          }
        } catch (e) {
          // ignore
        }
      });
      observer.observe(terminalRef.current);
      resizeObserverRef.current = observer;
    }

    term.write('\x1b[36m[SYSTEM]\x1b[0m 正在初始化 WebSocket 连接隧道...\r\n');

    // 3. 监听 WebSocket 事件
    socket.onopen = () => {
      setStatusText('WebSocket 连接成功，等待握手...');
      term.write('\x1b[36m[SYSTEM]\x1b[0m WebSocket 连接成功，开始建立远程 SSH 拨号...\r\n');
      
      // 发送首次终端大小
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
        // 收到控制文本消息
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'auth_request') {
            setAuthRequired(true);
            setConnecting(false);
            term.write('\x1b[33m[SYSTEM] 此设备未关联凭证，等待输入临时凭据...\x1b[0m\r\n');
          } else if (msg.type === 'status') {
            if (msg.message === 'connected') {
              setConnecting(false);
              setAuthRequired(false);
              term.write('\x1b[32m[SYSTEM] SSH 终端会话建立成功，交互开始！\x1b[0m\r\n\r\n');
            } else {
              setStatusText(msg.message);
              term.write(`\x1b[36m[SYSTEM]\x1b[0m ${msg.message}\r\n`);
            }
          }
        } catch (e) {
          term.write(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 收到终端二进制数据，直接写入
        term.write(new Uint8Array(event.data));
      }
    };

    // 监听键盘输入
    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        // 将按键输入以二进制形式发送
        const encoder = new TextEncoder();
        socket.send(encoder.encode(data));
      }
    });

    socket.onclose = (event) => {
      setConnecting(false);
      term.write('\r\n\x1b[31m[SYSTEM] 连接已关闭/断开\x1b[0m\r\n');
      if (event.reason) {
        term.write(`\x1b[31m[REASON] ${event.reason}\x1b[0m\r\n`);
      }
    };

    socket.onerror = () => {
      setConnecting(false);
      message.error('WebSocket 连接发生错误');
    };

    return () => {
      cleanup();
    };
  }, [visible, asset]);

  const cleanup = () => {
    if (ws) {
      ws.close();
      setWs(null);
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    form.resetFields();
  };

  const handleAuthSubmit = (values: any) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      setConnecting(true);
      setAuthRequired(false);
      setStatusText('正在验证凭据并连接 SSH...');
      ws.send(JSON.stringify({
        type: 'auth_response',
        username: values.username,
        password: values.password,
      }));
    }
  };

  return (
    <Modal
      title={`远程控制台 - ${asset?.name} (${asset?.ip})`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
      style={{ top: 50 }}
      bodyStyle={{
        padding: '16px',
        minHeight: '450px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* 状态加载页 */}
      {connecting && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.9)', zIndex: 10, color: 'rgba(0,0,0,0.65)'
        }}>
          <Spin size="large" />
          <div style={{ marginTop: 20, fontSize: 16 }}>{statusText}</div>
        </div>
      )}

      {/* 登录凭据索要页 */}
      {authRequired && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          backgroundColor: '#ffffff', zIndex: 10
        }}>
          <div style={{ width: '100%', maxWidth: '380px', padding: '24px', background: '#fcfcfc', borderRadius: '4px', border: '1px solid #e8e8e8' }}>
            <h3 style={{ marginTop: 0, marginBottom: 20, textAlign: 'center', fontWeight: 500, color: '#1677ff' }}>
              输入 SSH 登录凭证
            </h3>
            <Form form={form} layout="vertical" onFinish={handleAuthSubmit} initialValues={{ username: 'root' }}>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input placeholder="ssh 登录用户名" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password placeholder="ssh 登录密码" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
                <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <Button onClick={onClose}>取消</Button>
                  <Button type="primary" htmlType="submit">
                    立即连接
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        </div>
      )}

      {/* Xterm 终端容器 */}
      <div 
        ref={terminalRef} 
        className="terminal-container"
        style={{ 
          width: '100%', 
          height: '480px', 
          backgroundColor: '#000000',
          flexGrow: 1
        }} 
      />
    </Modal>
  );
};
