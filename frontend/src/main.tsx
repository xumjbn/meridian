import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import App from './App.tsx';

// ── 旧版本本地状态迁移（mrd- → lynx- → wjw- 两次更名）─────────────────
// 本地存储键前缀历经两次更名。不迁移的话，老用户升级后会被登出，
// 并丢掉「最近连接主机」「终端标签名/颜色」「壁纸/字号/面板宽度」等全部本地设置。
// 这里在渲染前按「从旧到新」逐级搬迁：mrd- 先并入 lynx-，再统一并入 wjw-，
// 这样跨两个版本直接升级的用户也不会漏。
//
// 注意：下面这两个历史前缀是字面量，不要跟着全局改名一起替换掉——
// 之前批量替换时就把它们改成了 wjw-，迁移变成「自己搬给自己」，等于没有。
(() => {
  const migratePrefix = (from: string, to: string) => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(from));
    for (const oldKey of keys) {
      const newKey = `${to}${oldKey.slice(from.length)}`;
      // 只在新键还没有值时搬：已经用过新版的人，其当前设置优先
      if (localStorage.getItem(newKey) === null) {
        const v = localStorage.getItem(oldKey);
        if (v !== null) localStorage.setItem(newKey, v);
      }
      localStorage.removeItem(oldKey);
    }
  };
  try {
    migratePrefix('mrd-', 'lynx-');
    migratePrefix('lynx-', 'wjw-');
  } catch {
    // localStorage 不可用（隐私模式等）时忽略：大不了重新登录一次
  }
})();

// 平台标记：字体抗锯齿要按平台区分（见 index.css 里 data-plat 的注释）。
// 必须在首屏渲染前打上，否则会先按非 Windows 的规则画一帧再切，字重会闪一下。
(() => {
  try {
    const ua = navigator.userAgent || '';
    const plat = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || '';
    const isWin = /Windows|Win32|Win64|WOW64/i.test(`${ua} ${plat}`);
    document.documentElement.dataset.plat = isWin ? 'win' : 'other';
  } catch {
    // 取不到就当非 Windows：保持和改动前一致的观感，不会更糟
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
