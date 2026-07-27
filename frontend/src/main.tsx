import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import App from './App.tsx';

// ── 旧版本本地状态迁移（Meridian → Lynx 更名）───────────────────────
// 本地存储键由 mrd-* 改为 lynx-*。不迁移的话，老用户升级后会被登出、
// 并丢掉「最近连接主机」「终端标签名/颜色」等本地设置。这里在渲染前一次性搬迁。
(() => {
  try {
    const LEGACY_PREFIX = 'mrd-';
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX));
    for (const oldKey of keys) {
      const newKey = `lynx-${oldKey.slice(LEGACY_PREFIX.length)}`;
      if (localStorage.getItem(newKey) === null) {
        const v = localStorage.getItem(oldKey);
        if (v !== null) localStorage.setItem(newKey, v);
      }
      localStorage.removeItem(oldKey);
    }
  } catch {
    // localStorage 不可用（隐私模式等）时忽略：大不了重新登录一次
  }
})();

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
