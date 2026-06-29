// 统一剪贴板：桌面端(Tauri)优先用原生剪贴板插件（WebView 的 navigator.clipboard /
// execCommand 常被限制，尤其粘贴 readText 在 WKWebView 基本不可用）；Web 端用
// 同步 execCommand（用户手势内最稳）+ Clipboard API 兜底。
import { isTauri } from './services/api';

// 同步 execCommand 复制：在用户手势内执行，兼容非安全上下文；返回是否成功，并还原焦点。
const execCopy = (text: string): boolean => {
  try {
    const prev = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (prev && typeof prev.focus === 'function') prev.focus();
    return ok;
  } catch {
    return false;
  }
};

export function copyText(text: string): void {
  if (!text) return;
  if (isTauri) {
    import('@tauri-apps/plugin-clipboard-manager')
      .then((m) => m.writeText(text))
      .catch(() => {
        if (!execCopy(text) && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
      });
    return;
  }
  if (execCopy(text)) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
}

export async function pasteText(): Promise<string> {
  if (isTauri) {
    try {
      const m = await import('@tauri-apps/plugin-clipboard-manager');
      return (await m.readText()) || '';
    } catch {
      /* fall through to web */
    }
  }
  try {
    if (navigator.clipboard?.readText) return (await navigator.clipboard.readText()) || '';
  } catch {
    /* ignore */
  }
  return '';
}
