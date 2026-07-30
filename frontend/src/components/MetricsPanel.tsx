import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { getMetricsWsUrl, type LiveMetrics } from '../services/api';

// ─────────────────────────────────────────────────────────────
// 终端内的资源监控面板（对标 FinalShell / xterminal 的侧栏监控）
//
// 贴在终端左侧常驻。一屏要能回答「这台机器现在到底忙不忙」：
//   CPU（含负载与核数）· 内存（含缓存与 swap）· 网络上下行 · 磁盘 IO
//   · 各分区占用 · 吃 CPU 的进程 · TCP 连接数 · 开机时长
// 光有三根百分比条是不够的——真正判断瓶颈靠的是网络吞吐、磁盘 IO 和负载。
//
// 只有面板打开时才建 WebSocket：后端每 2 秒要在目标机跑一次采样脚本，
// 常驻会白吃两边的 CPU。
// ─────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
  onClose: () => void;
}

const HISTORY = 60;
const MIN_W = 220;
const MAX_W = 460;
const DEFAULT_W = 268;
const WIDTH_KEY = 'term_metrics_w';

// 面板配色。原来的灰阶在 #111827 上对比度不够：次要文字 #64748b 只有 3.73，
// 「采样中…」用的 #475569 更是只有 2.34（WCAG 小字要求 ≥4.5）——实际就是看不清。
// 这里整体提亮一档，全部拉到 5 以上；底色仍跟终端一路，避免深色终端旁边杵一块白板。
const C = {
  bg: '#111827',
  head: '#1e293b',
  line: '#1f2937',
  headLine: '#334155',
  label: '#b8c4d4',  // 10.04
  mute: '#9fb0c4',   // 7.95
  text: '#e2e8f0',   // 14.39
  faint: '#8a9ab0',  // 5.98：最次要的说明文字，仍要看得清
  cpu: '#4ade80',
  mem: '#38bdf8',
  rx: '#22d3ee',
  tx: '#f472b6',
  read: '#a78bfa',
  write: '#fbbf24',
  warn: '#fbbf24',
  bad: '#f87171',
};

const pct = (used?: number, total?: number) =>
  total && total > 0 ? Math.min(100, Math.round(((used || 0) / total) * 100)) : 0;

const heat = (p: number) => (p >= 90 ? C.bad : p >= 70 ? C.warn : C.cpu);

/** KB 数转人类可读；输入单位是 KB */
const fmtKB = (kb?: number): string => {
  const v = kb || 0;
  if (v >= 1048576) return (v / 1048576).toFixed(1) + 'G';
  if (v >= 1024) return (v / 1024).toFixed(0) + 'M';
  return v + 'K';
};

/** 字节/秒 转人类可读速率 */
const fmtBps = (bps?: number): string => {
  const v = bps || 0;
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB/s';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB/s';
  return Math.round(v) + ' B/s';
};

const fmtUptime = (sec?: number): string => {
  const s = sec || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
};

/** 分区标题 */
const Section: React.FC<{ title: string; extra?: React.ReactNode }> = ({ title, extra }) => (
  <div style={{
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 5,
  }}>
    <span style={{ fontSize: 11, color: C.label, letterSpacing: 0.5 }}>{title}</span>
    {extra != null && <span style={{ fontSize: 10, color: C.mute }}>{extra}</span>}
  </div>
);

/** 单序列走势图（带填充） */
const Spark: React.FC<{ data: number[]; w: number; h: number; c: string; max?: number }> = ({ data, w, h, c, max }) => {
  if (data.length < 2) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', fontSize: 10, color: C.faint }}>采样中…</div>;
  }
  // 百分比类固定 0-100；速率类用窗口内峰值做自适应缩放，否则小流量永远贴底看不出变化
  const top = max ?? Math.max(1, ...data);
  const step = w / (HISTORY - 1);
  const off = HISTORY - data.length;
  const y = (v: number) => h - Math.min(1, v / top) * h;
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i + off) * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L${(off * step).toFixed(1)},${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={area} fill={c} opacity="0.15" />
      <path d={line} fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
};

/** 双序列走势图：网络上下行 / 磁盘读写共用，两条线共享同一纵向刻度才好比较 */
const DualSpark: React.FC<{ a: number[]; b: number[]; w: number; h: number; ca: string; cb: string }> = ({ a, b, w, h, ca, cb }) => {
  if (a.length < 2) {
    return <div style={{ height: h, display: 'flex', alignItems: 'center', fontSize: 10, color: C.faint }}>采样中…</div>;
  }
  const top = Math.max(1, ...a, ...b);
  const step = w / (HISTORY - 1);
  const path = (d: number[]) => {
    const off = HISTORY - d.length;
    return d.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i + off) * step).toFixed(1)},${(h - Math.min(1, v / top) * h).toFixed(1)}`).join(' ');
  };
  const la = path(a), lb = path(b);
  const offA = (HISTORY - a.length) * step;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path d={`${la} L${w},${h} L${offA.toFixed(1)},${h} Z`} fill={ca} opacity="0.13" />
      <path d={la} fill="none" stroke={ca} strokeWidth="1.3" strokeLinejoin="round" />
      <path d={lb} fill="none" stroke={cb} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
};

/** 一根占比条 */
const Bar: React.FC<{ p: number; w: number; c?: string; h?: number }> = ({ p, w, c, h = 5 }) => (
  <div style={{ height: h, borderRadius: h / 2, background: 'rgba(255,255,255,0.09)', overflow: 'hidden', width: w }}>
    <div style={{ width: `${Math.min(100, Math.max(0, p))}%`, height: '100%', background: c || heat(p), transition: 'width .3s' }} />
  </div>
);

/** 图例上的一个小色点 */
const Dot: React.FC<{ c: string; label: string; value: string }> = ({ c, label, value }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.text }}>
    <i style={{ width: 6, height: 6, borderRadius: 3, background: c, display: 'inline-block' }} />
    <span style={{ color: C.mute }}>{label}</span>
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </span>
);

export const MetricsPanel: React.FC<Props> = ({ assetId, onClose }) => {
  const [m, setM] = useState<LiveMetrics | null>(null);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState<{ cpu: number[]; mem: number[]; rx: number[]; tx: number[]; dr: number[]; dw: number[] }>(
    { cpu: [], mem: [], rx: [], tx: [], dr: [], dw: [] },
  );
  const [width, setWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  });
  const retryRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (assetId < 0) return;
    // 换主机等于全新一次连接，这三样必须归零，它们都是跨 assetId 存活的：
    // - retryRef：前一台失败满 5 次后没清零，新主机只试一次就报「已停止重试」，
    //   明明是台好机器也再不重连。
    // - err：上一台的错误提示会挂在新主机的面板上。
    // - hist：曲线会从上一台的历史接着画，看到的是别人的 CPU。
    retryRef.current = 0;
    setErr('');
    setM(null);
    setHist({ cpu: [], mem: [], rx: [], tx: [], dr: [], dw: [] });
    let closed = false;
    let gotFrame = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(getMetricsWsUrl(assetId));
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as LiveMetrics;
          if (!d.ok) {
            // 后端明确说了「采不了」（没绑凭据 / telnet / 系统不支持），
            // 这是终局不是抖动：不能算作「已收到有效帧」，否则下面的重试上限
            // 永远不生效，会变成每 30 秒无限重连。
            setErr(d.message || '监控不可用');
            closed = true;
            try { ws.close(); } catch { /* 已经在关了 */ }
            return;
          }
          gotFrame = true;
          setErr('');
          retryRef.current = 0;
          setM(d);
          const push = (arr: number[], v: number) => [...arr, v].slice(-HISTORY);
          setHist((h) => ({
            cpu: push(h.cpu, Math.round(d.cpu_percent || 0)),
            mem: push(h.mem, pct(d.mem_used_kb, d.mem_total_kb)),
            rx: push(h.rx, d.net_rx_bps || 0),
            tx: push(h.tx, d.net_tx_bps || 0),
            dr: push(h.dr, d.disk_read_bps || 0),
            dw: push(h.dw, d.disk_write_bps || 0),
          }));
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
      // 必须真的把连接关掉。以前这里只置了标志位，ws 是 connect() 里的局部变量，
      // 拿不到也没关——面板关了、终端标签关了，后端仍会在目标机上每 2 秒跑一次
      // 采集脚本，直到 30 分钟的兜底超时。开关几次就是几条僵尸 SSH 在同时采样。
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;   // 先摘掉重连回调，否则这次主动关闭又会触发一轮重连
        ws.onerror = null;
        ws.onmessage = null;
        try { ws.close(); } catch { /* 已经关了 */ }
      }
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

  const inner = width - 22;
  const cpu = Math.round(m?.cpu_percent || 0);
  const mem = pct(m?.mem_used_kb, m?.mem_total_kb);
  const swap = pct(m?.swap_used_kb, m?.swap_total_kb);

  // 负载超过核数就说明在排队了，标红提示；没有核数时不做判断
  const loadHot = useMemo(() => {
    if (!m?.cpu_cores || !m?.load1) return false;
    return m.load1 > m.cpu_cores;
  }, [m?.cpu_cores, m?.load1]);

  return (
    <div style={{ width, flexShrink: 0, display: 'flex', height: '100%', background: C.bg }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.line}` }}>
        <div style={{
          height: 28, flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0 6px 0 10px', background: C.head, borderBottom: `1px solid ${C.headLine}`,
        }}>
          <span style={{ fontSize: 12, color: C.text, flex: 1 }}>资源监控</span>
          <span
            onClick={onClose}
            title="关闭（关闭后停止采样）"
            style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.label }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 11px 14px' }}>
          {err && <div style={{ fontSize: 12, color: '#f0a35e', lineHeight: 1.7 }}>{err}</div>}
          {!err && !m && <div style={{ fontSize: 12, color: C.mute }}>正在建立监控连接…</div>}

          {!err && m && (
            <>
              {/* 主机身份：出问题时第一眼要确认「我盯的是哪台」 */}
              <div style={{ fontSize: 12, color: C.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.hostname || m.os || '—'}
              </div>
              <div style={{ fontSize: 10, color: C.mute, marginTop: 2, lineHeight: 1.5 }}>
                {m.distro || m.os}
                {m.kernel ? <><br />{m.kernel}</> : null}
                {m.uptime_sec ? <><br />已运行 {fmtUptime(m.uptime_sec)}</> : null}
              </div>

              {/* CPU */}
              <Section title="CPU" extra={m.cpu_cores ? `${m.cpu_cores} 核` : undefined} />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 600, color: heat(cpu), fontVariantNumeric: 'tabular-nums' }}>{cpu}%</span>
                {(m.load1 != null) && (
                  <span style={{ fontSize: 10, color: loadHot ? C.bad : C.mute, fontVariantNumeric: 'tabular-nums' }}>
                    负载 {m.load1?.toFixed(2)} / {m.load5?.toFixed(2)} / {m.load15?.toFixed(2)}
                  </span>
                )}
              </div>
              <Bar p={cpu} w={inner} />
              <div style={{ marginTop: 4 }}><Spark data={hist.cpu} w={inner} h={34} c={heat(cpu)} max={100} /></div>

              {/* 内存 */}
              <Section title="内存" extra={`${fmtKB(m.mem_used_kb)} / ${fmtKB(m.mem_total_kb)}`} />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 600, color: heat(mem), fontVariantNumeric: 'tabular-nums' }}>{mem}%</span>
                {!!m.mem_cache_kb && <span style={{ fontSize: 10, color: C.mute }}>缓存 {fmtKB(m.mem_cache_kb)}</span>}
              </div>
              <Bar p={mem} w={inner} />
              <div style={{ marginTop: 4 }}><Spark data={hist.mem} w={inner} h={34} c={C.mem} max={100} /></div>
              {!!m.swap_total_kb && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.mute, width: 32 }}>Swap</span>
                  <Bar p={swap} w={inner - 76} h={4} c={swap > 0 ? C.warn : C.mem} />
                  <span style={{ fontSize: 10, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>{swap}%</span>
                </div>
              )}

              {/* 网络：FinalShell 侧栏最有用的一块，判断是不是在传东西全靠它 */}
              <Section title="网络" extra={m.tcp_count != null ? `${m.tcp_count} 连接` : undefined} />
              <div style={{ display: 'flex', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <Dot c={C.rx} label="↓" value={fmtBps(m.net_rx_bps)} />
                <Dot c={C.tx} label="↑" value={fmtBps(m.net_tx_bps)} />
              </div>
              <DualSpark a={hist.rx} b={hist.tx} w={inner} h={36} ca={C.rx} cb={C.tx} />

              {/* 磁盘 IO */}
              <Section title="磁盘 IO" />
              <div style={{ display: 'flex', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <Dot c={C.read} label="读" value={fmtBps(m.disk_read_bps)} />
                <Dot c={C.write} label="写" value={fmtBps(m.disk_write_bps)} />
              </div>
              <DualSpark a={hist.dr} b={hist.dw} w={inner} h={36} ca={C.read} cb={C.write} />

              {/* 分区：多盘机器上「哪块盘快满了」比一个总数有用得多 */}
              <Section title="磁盘分区" />
              {(m.mounts && m.mounts.length ? m.mounts : (m.disk_total_kb ? [{ path: '/', used_kb: m.disk_used_kb || 0, total_kb: m.disk_total_kb }] : [])).map((mt) => {
                const p = pct(mt.used_kb, mt.total_kb);
                return (
                  <div key={mt.path} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.mute, marginBottom: 2 }}>
                      <span style={{ color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: inner - 90 }}>{mt.path}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKB(mt.used_kb)} / {fmtKB(mt.total_kb)} · {p}%</span>
                    </div>
                    <Bar p={p} w={inner} h={4} />
                  </div>
                );
              })}

              {/* TOP 进程：知道「谁在吃 CPU」才谈得上处理 */}
              {!!(m.procs && m.procs.length) && (
                <>
                  <Section title="进程 TOP5" extra="CPU%" />
                  {m.procs.map((p, i) => (
                    <div key={`${p.name}-${i}`} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      fontSize: 11, color: C.text, padding: '2px 0',
                    }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: inner - 88 }}>{p.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: C.mute, flexShrink: 0 }}>
                        <span style={{ color: p.cpu >= 50 ? C.bad : C.text }}>{p.cpu.toFixed(1)}</span>
                        <span> / {p.mem.toFixed(1)}%</span>
                      </span>
                    </div>
                  ))}
                </>
              )}

              <div style={{ fontSize: 10, color: C.faint, marginTop: 12, textAlign: 'center' }}>每 2 秒采样</div>
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
