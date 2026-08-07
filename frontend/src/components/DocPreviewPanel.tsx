import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseOutlined, ReloadOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ─────────────────────────────────────────────────────────────
// 终端内的文档预览面板。
//
// 终端里 ls 出来的 .md / .html 直接点开就在右侧渲染，不用先下载再找程序。
// 取文由 TerminalPage 负责（本机走 /local/doc，远程走 SFTP），这里只管渲染——
// 面板不认识「本地/远程」，给什么渲什么。
//
// 渲染分三路：
//   md   —— marked 转 HTML 后过一遍 DOMPurify，再塞进来
//   html —— 丢进 sandbox iframe（srcdoc），脚本一律不放行
//   其它 —— 纯文本 <pre>
//
// 为什么 html 不像 md 那样内联渲染：文档里的 CSS 会漏出来污染整个应用界面
// （html/body 选择器、全局字号、*{} 之类），iframe 才有真正的样式隔离。
// 代价是 srcdoc 里的相对路径资源（图片/外链 css）取不到，属于预期——预览而非托管。
// ─────────────────────────────────────────────────────────────

export type DocKind = 'md' | 'html' | 'text';

interface Props {
  /** 文件名，标题栏显示 */
  name: string;
  /** 完整路径，鼠标悬浮显示 */
  path: string;
  kind: DocKind;
  content: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onReload: () => void;
  /** 交给系统默认程序打开（远程文件没有本地路径，不给这个入口） */
  onOpenExternal?: () => void;
}

const MIN_W = 320;
const MAX_W = 900;
const DEFAULT_W = 520;
const WIDTH_KEY = 'term_doc_w';

const C = {
  bg: '#111827',
  head: '#1e293b',
  headLine: '#334155',
  text: '#e2e8f0',
  mute: '#9fb0c4',
  faint: '#8a9ab0',
  link: '#7cc4ff',
  codeBg: '#0b1220',
  border: '#1f2937',
};

/** markdown 渲染出的 HTML 要一套自己的排版，否则在深色底上默认样式几乎没法读 */
const MD_CSS = `
.wjw-md { color: ${C.text}; font-size: 13.5px; line-height: 1.75; word-wrap: break-word; }
.wjw-md h1, .wjw-md h2, .wjw-md h3, .wjw-md h4 { color: #fff; font-weight: 600; line-height: 1.35; margin: 1.4em 0 .6em; }
.wjw-md h1 { font-size: 1.7em; border-bottom: 1px solid ${C.border}; padding-bottom: .3em; }
.wjw-md h2 { font-size: 1.4em; border-bottom: 1px solid ${C.border}; padding-bottom: .25em; }
.wjw-md h3 { font-size: 1.18em; }
.wjw-md h1:first-child, .wjw-md h2:first-child { margin-top: .2em; }
.wjw-md p { margin: .7em 0; }
.wjw-md a { color: ${C.link}; text-decoration: none; }
.wjw-md a:hover { text-decoration: underline; }
.wjw-md code { background: ${C.codeBg}; padding: .15em .4em; border-radius: 4px; font-size: .9em;
  font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace; color: #ffd9a0; }
.wjw-md pre { background: ${C.codeBg}; padding: 12px 14px; border-radius: 6px; overflow-x: auto;
  border: 1px solid ${C.border}; margin: .9em 0; }
.wjw-md pre code { background: none; padding: 0; color: #cfe3ff; }
.wjw-md blockquote { margin: .9em 0; padding: .1em 1em; border-left: 3px solid #3b82f6;
  background: rgba(59,130,246,.08); color: ${C.mute}; }
.wjw-md ul, .wjw-md ol { padding-left: 1.6em; margin: .7em 0; }
.wjw-md li { margin: .3em 0; }
.wjw-md table { border-collapse: collapse; margin: .9em 0; display: block; overflow-x: auto; }
.wjw-md th, .wjw-md td { border: 1px solid ${C.border}; padding: 6px 12px; }
.wjw-md th { background: ${C.head}; color: #fff; font-weight: 600; }
.wjw-md tr:nth-child(even) td { background: rgba(255,255,255,.02); }
.wjw-md img { max-width: 100%; }
.wjw-md hr { border: 0; border-top: 1px solid ${C.border}; margin: 1.4em 0; }
.wjw-md input[type="checkbox"] { margin-right: .5em; }
`;

export const DocPreviewPanel: React.FC<Props> = ({
  name, path, kind, content, loading, error, onClose, onReload, onOpenExternal,
}) => {
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  });
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      // 面板在右侧：往左拖变宽，所以是起点减当前
      setWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.w + (dragRef.current.x - e.clientX))));
    };
    const up = () => { dragRef.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);

  const html = useMemo(() => {
    if (kind !== 'md') return '';
    try {
      const raw = marked.parse(content, { async: false }) as string;
      // 渲染的是别人机器上的文档，当成不可信输入处理：脚本、事件属性、iframe 一律去掉
      return DOMPurify.sanitize(raw, { FORBID_TAGS: ['script', 'iframe', 'style'], FORBID_ATTR: ['style'] });
    } catch (e) {
      return `<p style="color:#f87171">Markdown 解析失败：${(e as Error).message}</p>`;
    }
  }, [kind, content]);

  return (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      {/* 拖拽改宽：贴在面板左边缘 */}
      <div
        onMouseDown={(e) => { dragRef.current = { x: e.clientX, w: width }; document.body.style.cursor = 'col-resize'; }}
        style={{ width: 4, flexShrink: 0, cursor: 'col-resize' }}
      />
      <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, borderLeft: `1px solid ${C.headLine}` }}>
        {/* 标题栏 */}
        <div style={{
          height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px',
          background: C.head, borderBottom: `1px solid ${C.headLine}`,
        }}>
          <span title={path} style={{
            flex: 1, minWidth: 0, color: C.text, fontSize: 12.5, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </span>
          <span style={{ color: C.faint, fontSize: 11, flexShrink: 0 }}>
            {kind === 'md' ? 'Markdown' : kind === 'html' ? 'HTML' : '文本'}
          </span>
          {onOpenExternal && (
            <FolderOpenOutlined
              title="用系统默认程序打开"
              onClick={onOpenExternal}
              style={{ color: C.mute, cursor: 'pointer', fontSize: 13 }}
            />
          )}
          <ReloadOutlined title="重新读取" onClick={onReload} style={{ color: C.mute, cursor: 'pointer', fontSize: 13 }} />
          <CloseOutlined title="关闭预览" onClick={onClose} style={{ color: C.mute, cursor: 'pointer', fontSize: 13 }} />
        </div>

        {/* 正文 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {loading && <div style={{ padding: 16, color: C.mute, fontSize: 12.5 }}>读取中…</div>}
          {!loading && error && (
            <div style={{ padding: 16, color: '#f87171', fontSize: 12.5, wordBreak: 'break-all' }}>{error}</div>
          )}
          {!loading && !error && kind === 'md' && (
            <>
              <style>{MD_CSS}</style>
              <div className="wjw-md" style={{ padding: '10px 16px 24px' }} dangerouslySetInnerHTML={{ __html: html }} />
            </>
          )}
          {!loading && !error && kind === 'html' && (
            // sandbox 不加任何 allow-*：脚本、表单、跳转全部禁掉，纯看排版
            <iframe
              title={name}
              srcDoc={content}
              sandbox=""
              style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
            />
          )}
          {!loading && !error && kind === 'text' && (
            <pre style={{
              margin: 0, padding: '10px 16px 24px', color: C.text, fontSize: 12.5, lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
            }}>{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
};
