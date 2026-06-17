import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import App from './App.tsx';

// 屏蔽浏览器无害的 "ResizeObserver loop ..." 报错，避免触发 Vite 开发期错误浮层覆盖界面
const swallowResizeObserverError = (e: ErrorEvent) => {
  if (e.message && e.message.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
};
window.addEventListener('error', swallowResizeObserverError);

// 不启用 StrictMode：终端/WebSocket 等命令式生命周期在严格模式的双挂载下会产生重连竞态
createRoot(document.getElementById('root')!).render(<App />);
