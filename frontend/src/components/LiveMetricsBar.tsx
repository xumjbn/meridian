import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
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
  const [hist, setHist] = useState<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active || assetId < 0) return;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(getMetricsWsUrl(assetId));
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as LiveMetrics;
          if (!data.ok) { setErr(data.message || '监控不可用'); return; }
          setErr('');
          retryRef.current = 0;
          setM(data);
          setHist((h) => [...h, Math.round(data.cpu_percent || 0)].slice(-HISTORY));
        } catch {
          /* 忽略无法解析的帧 */
        }
      };
      ws.onclose = () => {
        if (closed) return;
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
  }, [assetId, active]);

  if (!active || assetId < 0) return null;
  if (err) {
    return (
      <Tooltip title={err}>
        <span style={{ fontSize: 11, color: palette.chromeTextMute, whiteSpace: 'nowrap' }}>监控不可用</span>
      </Tooltip>
    );
  }
  if (!m) {
    return <span style={{ fontSize: 11, color: palette.chromeTextMute, whiteSpace: 'nowrap' }}>监控连接中…</span>;
  }

  const cpu = Math.round(m.cpu_percent || 0);
  const mem = pct(m.mem_used_kb, m.mem_total_kb);
  const disk = pct(m.disk_used_kb, m.disk_total_kb);

  const item = (label: string, p: number, tip: string) => (
    <Tooltip title={tip}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: palette.chromeTextMute }}>{label}</span>
        <span style={{ width: 42, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${Math.min(100, p)}%`, height: '100%', background: barColor(p) }} />
        </span>
        <span style={{ fontSize: 11, color: palette.chromeText, fontVariantNumeric: 'tabular-nums', width: 30 }}>{p}%</span>
      </span>
    </Tooltip>
  );

  // CPU 迷你走势：把最近的采样画成一条折线，看得出毛刺
  const spark = () => {
    if (hist.length < 2) return null;
    const w = 60, h = 14;
    const step = w / (HISTORY - 1);
    const d = hist
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i + (HISTORY - hist.length)) * step},${h - (v / 100) * h}`)
      .join(' ');
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <path d={d} fill="none" stroke={barColor(cpu)} strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {item('CPU', cpu, `${m.os || ''} CPU ${cpu}%`)}
      {spark()}
      {item('内存', mem, `${fmtGB(m.mem_used_kb)} / ${fmtGB(m.mem_total_kb)} GB`)}
      {!!m.disk_total_kb && item('磁盘', disk, `${fmtGB(m.disk_used_kb)} / ${fmtGB(m.disk_total_kb)} GB`)}
    </span>
  );
};
