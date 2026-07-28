import React, { useEffect, useRef, useState } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { getMetricsWsUrl, type LiveMetrics } from '../services/api';

// ─────────────────────────────────────────────────────────────
// 终端内的资源监控面板（对标 FinalShell / xterminal 的侧栏监控）
//
// 贴在终端左侧常驻，比塞在标签栏里的两个数字能承载更多信息：
// 每项一个环形/条形读数 + CPU 与内存各自的历史走势。
// 只有面板打开时才建 WebSocket——后端每 2 秒要在目标机跑一次采样脚本，
// 常驻会白吃两边的 CPU。
// ─────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
  onClose: () => void;
}

const HISTORY = 60;
const MIN_W = 180;
const MAX_W = 420;
const DEFAULT_W = 230;
const WIDTH_KEY = 'term_metrics_w';

const fmtGB = (kb?: number) => ((kb || 0) / 1024 / 1024).toFixed(1);
const pct = (used?: number, total?: number) => (total ? Math.round(((used || 0) / total) * 100) : 0);
const color = (p: number) => (p >= 90 ? '#f87171' : p >= 70 ? '#fbbf24' : '#4ade80');

/** 历史走势：带填充的折线 */
const Spark: React.FC<{ data: number[]; w: number; h: number; c: string }> = ({ data, w, h, c }) => {
  if (data.length < 2) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#475569' }}>采样中…</div>;
  }
  const step = w / (HISTORY - 1);
  const off = HISTORY - data.length;
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i + off) * step},${h - (v / 100) * h}`).join(' ');
  const area = `${line} L${w},${h} L${off * step},${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={area} fill={c} opacity="0.16" />
      <path d={line} fill="none" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
};

/** 一项读数：标题 + 大号百分比 + 进度条 + 明细 */
const Gauge: React.FC<{ label: string; p: number; detail?: string; w: number }> = ({ label, p, detail, w }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: color(p), fontVariantNumeric: 'tabular-nums' }}>{p}%</span>
    </div>
    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.10)', overflow: 'hidden', width: w }}>
      <div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: color(p), transition: 'width .3s' }} />
    </div>
    {detail && <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{detail}</div>}
  </div>
);

export const MetricsPanel: React.FC<Props> = ({ assetId, onClose }) => {
  const [m, setM] = useState<LiveMetrics | null>(null);
  const [err, setErr] = useState('');
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [width, setWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  });
  const retryRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (assetId < 0) return;
    let closed = false;
    let gotFrame = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(getMetricsWsUrl(assetId));
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as LiveMetrics;
          gotFrame = true;
          if (!d.ok) { setErr(d.message || '监控不可用'); return; }
          setErr('');
          retryRef.current = 0;
          setM(d);
          setCpuHist((h) => [...h, Math.round(d.cpu_percent || 0)].slice(-HISTORY));
          setMemHist((h) => [...h, pct(d.mem_used_kb, d.mem_total_kb)].slice(-HISTORY));
        } catch { /* 忽略无法解析的帧 */ }
      };
      ws.onclose = (ev) => {
        if (closed) return;
        // 一帧未收到就断开 = 连不上或被拒绝，必须给出原因而不是干等
        if (!gotFrame) {
          const n = retryRef.current + 1;
          const why = ev.reason ? `：${ev.reason}` : ev.code ? `（code ${ev.code}）` : '';
          setErr(n >= 5 ? `监控连接失败${why}，已停止重试` : `监控连接失败${why}，第 ${n} 次重试…`);
          if (retryRef.current >= 5) return;
        }
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
    };
  }, [assetId]);

  // 拖拽调宽：把手在右缘，向右拖变宽
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.w + (e.clientX - dragRef.current.x))));
    };
    const onUp = () => { dragRef.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);

  const inner = width - 20;
  const cpu = Math.round(m?.cpu_percent || 0);
  const mem = pct(m?.mem_used_kb, m?.mem_total_kb);
  const disk = pct(m?.disk_used_kb, m?.disk_total_kb);

  return (
    <div style={{ width, flexShrink: 0, display: 'flex', height: '100%', background: '#111827' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1f2937' }}>
        <div style={{
          height: 28, flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0 6px 0 10px', background: '#1e293b', borderBottom: '1px solid #334155',
        }}>
          <span style={{ fontSize: 12, color: '#cbd5e1', flex: 1 }}>资源监控</span>
          <span
            onClick={onClose}
            title="关闭（关闭后停止采样）"
            style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8' }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
          {err && <div style={{ fontSize: 12, color: '#f0a35e', lineHeight: 1.7 }}>{err}</div>}
          {!err && !m && <div style={{ fontSize: 12, color: '#64748b' }}>正在建立监控连接…</div>}
          {!err && m && (
            <>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{m.os || ''} · 每 2 秒采样</div>

              <Gauge label="CPU" p={cpu} w={inner} />
              <Spark data={cpuHist} w={inner} h={40} c={color(cpu)} />

              <div style={{ height: 12 }} />
              <Gauge label="内存" p={mem} detail={`${fmtGB(m.mem_used_kb)} / ${fmtGB(m.mem_total_kb)} GB`} w={inner} />
              <Spark data={memHist} w={inner} h={40} c={color(mem)} />

              {!!m.disk_total_kb && (
                <>
                  <div style={{ height: 12 }} />
                  <Gauge label="磁盘" p={disk} detail={`${fmtGB(m.disk_used_kb)} / ${fmtGB(m.disk_total_kb)} GB`} w={inner} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div
        onMouseDown={(e) => { dragRef.current = { x: e.clientX, w: width }; document.body.style.cursor = 'col-resize'; }}
        style={{ width: 4, flexShrink: 0, cursor: 'col-resize' }}
      />
    </div>
  );
};
