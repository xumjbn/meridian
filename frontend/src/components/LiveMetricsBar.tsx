import React, { useEffect, useRef, useState } from 'react';
import { Popover, Tooltip } from 'antd';
import { getMetricsWsUrl, type LiveMetrics } from '../services/api';
import { palette } from '../theme';

// ─────────────────────────────────────────────────────────────
// 终端内的实时资源条（FinalShell 式）
//
// 后端常驻一条 SSH 连接、每 2 秒采一次样并通过 WebSocket 推来，这里只负责渲染：
// CPU / 内存 / 磁盘三条细进度 + CPU 近 60 个采样点的迷你走势。
// 断线按指数退避重连，避免目标主机不可达时疯狂重试。
// ─────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
  /** 终端处于已连接状态时才开监控，避免无谓的 SSH 连接 */
  active: boolean;
}

const HISTORY = 60;

const fmtGB = (kb?: number) => ((kb || 0) / 1024 / 1024).toFixed(1);
const pct = (used?: number, total?: number) => (total ? Math.round(((used || 0) / total) * 100) : 0);
const barColor = (p: number) => (p >= 90 ? palette.danger : p >= 70 ? palette.warning : '#4ade80');

export const LiveMetricsBar: React.FC<Props> = ({ assetId, active }) => {
  const [m, setM] = useState<LiveMetrics | null>(null);
  const [err, setErr] = useState('');
  // 面板是否展开；只有展开时才连 WebSocket，收起即断
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // 只有展开面板时才建监控连接：后端每 2 秒要在目标机上跑一次采样脚本，
    // 常驻着白白吃两边的 CPU。收起即断开。
    if (!open || !active || assetId < 0) return;
    let closed = false;
    // 是否收到过数据帧。没收到就断，说明是连不上/被拒，不能一直显示「连接中」
    let gotFrame = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(getMetricsWsUrl(assetId));
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as LiveMetrics;
          gotFrame = true;
          if (!data.ok) { setErr(data.message || '监控不可用'); return; }
          setErr('');
          retryRef.current = 0;
          setM(data);
          setHist((h) => [...h, Math.round(data.cpu_percent || 0)].slice(-HISTORY));
        } catch {
          /* 忽略无法解析的帧 */
        }
      };
      ws.onclose = (ev) => {
        if (closed) return;
        // 一帧都没收到就被关掉：连不上或被服务端拒绝。此前这里只是静默重连，
        // err 和 m 都是空，界面就永远停在「监控连接中…」，没有任何提示。
        if (!gotFrame) {
          const n = retryRef.current + 1;
          const why = ev.reason ? `：${ev.reason}` : ev.code ? `（code ${ev.code}）` : '';
          setErr(n >= 5
            ? `监控连接失败${why}，已停止重试。请确认该主机凭据可用、SSH 可达。`
            : `监控连接失败${why}，第 ${n} 次重试中…`);
        }
        // 连不上时最多重试 5 轮，避免对不可达主机无限重连
        if (!gotFrame && retryRef.current >= 5) return;
        // 指数退避重连：2s、4s、8s… 上限 30s
        const delay = Math.min(30000, 2000 * 2 ** retryRef.current);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, active, open]);

  if (!active || assetId < 0) return null;

  // 收起态：只是一个入口，不连 WebSocket
  if (!open) {
    return (
      <Popover
        content={<div style={{ width: 240, fontSize: 12, color: palette.chromeTextMute }}>正在建立监控连接…</div>}
        trigger="click"
        placement="bottomRight"
        open={false}
      >
        <span
          onClick={() => setOpen(true)}
          title="查看实时资源（打开才开始采样）"
          style={{ fontSize: 11, color: palette.chromeTextMute, cursor: 'pointer', whiteSpace: 'nowrap', padding: '0 4px' }}
        >
          资源
        </span>
      </Popover>
    );
  }
  if (err) {
    return (
      <Tooltip title={err}>
        <span style={{ fontSize: 11, color: palette.chromeTextMute, whiteSpace: 'nowrap' }}>监控不可用</span>
      </Tooltip>
    );
  }
  if (!m) {
    // 后端每 2s 推一帧，正常情况下这个状态只闪现一下；久留必是连接有问题，
    // 而那种情况已由上面的 err 分支给出原因。
    return (
      <Tooltip title="正在建立监控连接（后端每 2 秒采样一次）">
        <span style={{ fontSize: 11, color: palette.chromeTextMute, whiteSpace: 'nowrap' }}>监控连接中…</span>
      </Tooltip>
    );
  }

  const cpu = Math.round(m.cpu_percent || 0);
  const mem = pct(m.mem_used_kb, m.mem_total_kb);
  const disk = pct(m.disk_used_kb, m.disk_total_kb);

  // 面板里的一行：标签 + 进度条 + 百分比 + 右侧明细
  const row = (label: string, p: number, detail: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: palette.chromeTextMute, width: 30 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${Math.min(100, p)}%`, height: '100%', background: barColor(p), transition: 'width .3s' }} />
      </span>
      <span style={{ fontSize: 13, color: palette.chromeTextStrong, fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right' }}>
        {p}%
      </span>
      <span style={{ fontSize: 11, color: palette.chromeTextMute, width: 92, textAlign: 'right' }}>{detail}</span>
    </div>
  );

  // CPU 走势折线；带填充，趋势比裸线更容易读
  const spark = (w: number, h: number) => {
    if (hist.length < 2) return null;
    const step = w / (HISTORY - 1);
    const pt = (v: number, i: number) => `${(i + (HISTORY - hist.length)) * step},${h - (v / 100) * h}`;
    const line = hist.map((v, i) => `${i === 0 ? 'M' : 'L'}${pt(v, i)}`).join(' ');
    const area = `${line} L${w},${h} L${(HISTORY - hist.length) * step},${h} Z`;
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <path d={area} fill={barColor(cpu)} opacity="0.15" />
        <path d={line} fill="none" stroke={barColor(cpu)} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  };

  // 展开面板：对标 FinalShell/xterminal——标签栏只放最精炼的数字，
  // 详细的进度条、走势与容量明细收进悬浮面板，不再挤在 34px 的横条里。
  const panel = (
    <div style={{ width: 300, padding: '4px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: palette.chromeTextMute }}>{m.os || '实时资源'}</span>
        <span style={{ fontSize: 11, color: palette.chromeTextMute }}>每 2 秒采样</span>
      </div>
      <div style={{ marginBottom: 10 }}>{spark(300, 46)}</div>
      {row('CPU', cpu, '')}
      {row('内存', mem, `${fmtGB(m.mem_used_kb)}/${fmtGB(m.mem_total_kb)} GB`)}
      {!!m.disk_total_kb && row('磁盘', disk, `${fmtGB(m.disk_used_kb)}/${fmtGB(m.disk_total_kb)} GB`)}
    </div>
  );

  // 收起态：只有两个带色号的数字，占位极小
  const num = (label: string, p: number) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
      <span style={{ fontSize: 10, color: palette.chromeTextMute }}>{label}</span>
      <span style={{ fontSize: 12, color: barColor(p), fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{p}%</span>
    </span>
  );

  return (
    <Popover
      content={panel}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}          // 关闭面板即断开监控连接
      overlayInnerStyle={{ background: '#111827' }}
    >
      <span
        title="点击收起（收起后停止采样）"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '0 2px' }}
      >
        {num('CPU', cpu)}
        {spark(36, 12)}
        {num('内存', mem)}
      </span>
    </Popover>
  );
};
