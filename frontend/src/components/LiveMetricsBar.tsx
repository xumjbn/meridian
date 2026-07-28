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
