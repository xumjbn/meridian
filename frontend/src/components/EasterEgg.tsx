import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogoMark } from './Logo';

// ─────────────────────────────────────────────────────────────
// 彩蛋：一段有编排的粒子演出（纯 canvas，无第三方依赖）
//
// 单一效果不够看，关键在「同一批粒子在几个形态之间变形」：
//   0.0s 烟花绽放  → 1.2s 聚成会搏动的心形
//   → 4.2s 心形炸开、重组为 I LOVE U → 7.2s 化作星尘上飘 → 9.2s 收场
// 全程叠加：背景星空、心跳扩散波纹、鼠标引力（划过可拨开粒子）。
//
// 触发方式（刻意不做「连续可见字符」匹配——那会把口令实打进搜索框/表单）：
//   1. 顶栏徽标 2 秒内连点 5 次
//   2. Konami 码 ↑↑↓↓←→←→BA（匹配按键名，不产生可见字符）
//   3. 终端里单独敲一行 love / wjw i love u（在回车处拦截，不下发 shell）
// ─────────────────────────────────────────────────────────────

export const EASTER_EGG_EVENT = 'lynx-easter-egg';
/** 终端里触发：单独一行 love，或完整的 wjw i love u */
export const EASTER_EGG_RE = /^\s*(love|wjw\s*i\s*love\s*u)\s*$/i;

/** 任意位置手动触发彩蛋 */
export const fireEasterEgg = () => window.dispatchEvent(new Event(EASTER_EGG_EVENT));

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

// 演出时间轴（毫秒）——四幕表白，总长约 10.5s
const T_HEART = 1100;    // 幕一：聚成会搏动的心
const T_TEXT = 4100;     // 幕二：I LOVE U
const T_NAME = 6900;     // 幕三：WJW
const T_DISSOLVE = 9200; // 幕四：化作星尘
const T_END = 10600;

// 每一幕配一句字幕，逐字打出，凑成一段完整的话
const CAPTIONS: { at: number; text: string }[] = [
  { at: 0, text: '有句话，想借这场烟花说' },
  { at: T_HEART, text: '从遇见你的那天起' },
  { at: T_TEXT, text: '我就没想过要放手' },
  { at: T_NAME, text: '往后余生，风雪是你，平淡是你' },
  { at: T_DISSOLVE, text: '生日快乐，我爱你 ❤' },
];

const PINK = ['#ff5c8a', '#ff8fab', '#ff3d71', '#ffc2d1'];
const SPARK = ['#ff5c8a', '#ffd166', '#06d6a0', '#4da3ff', '#c77dff'];

type Stage = 'burst' | 'heart' | 'text' | 'dissolve';

interface P {
  x: number; y: number;
  vx: number; vy: number;
  /** 目标点（相对画面中心），为 null 时自由飞行 */
  tx: number | null; ty: number | null;
  color: string;
  size: number;
  /** 相位，用于错开抖动/闪烁，避免整体过于整齐 */
  ph: number;
}

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; color: string; size: number;
}

interface Ripple { r: number; alpha: number }

interface Star { x: number; y: number; z: number; ph: number }

/** 心形参数方程（经典 16sin³t），返回以中心为原点的点集 */
const heartPoints = (count: number, scale: number): { x: number; y: number }[] => {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = (Math.PI * 2 * i) / count;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    // 让粒子不只落在轮廓线上，随机往内收一点，形成有厚度的实心心
    const k = 0.55 + Math.random() * 0.45;
    pts.push({ x: x * scale * k, y: y * scale * k });
  }
  return pts;
};

/** 把文字画到离屏 canvas 后逐像素采样，得到组成字形的点集（不依赖字体文件） */
const textPoints = (text: string, maxWidth: number): { x: number; y: number }[] => {
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  if (!octx) return [];
  const fontSize = Math.max(48, Math.min(160, Math.floor(maxWidth / (text.length * 0.6))));
  off.width = Math.min(1500, Math.floor(maxWidth));
  off.height = Math.floor(fontSize * 1.7);
  octx.fillStyle = '#fff';
  octx.font = `800 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(text, off.width / 2, off.height / 2);
  const img = octx.getImageData(0, 0, off.width, off.height).data;
  const pts: { x: number; y: number }[] = [];
  for (let y = 0; y < off.height; y += 4) {
    for (let x = 0; x < off.width; x += 4) {
      if (img[(y * off.width + x) * 4 + 3] > 128) {
        pts.push({ x: x - off.width / 2, y: y - off.height / 2 });
      }
    }
  }
  return pts;
};

export const EasterEgg: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('burst');
  const [caption, setCaption] = useState('');      // 当前整句
  const [typed, setTyped] = useState('');          // 已打出的部分（打字机效果）
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const timersRef = useRef<number[]>([]);

  // 字幕逐字打出：每 62ms 推一个字，打完停住直到下一句
  useEffect(() => {
    if (!caption) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(caption.slice(0, i));
      if (i >= caption.length) window.clearInterval(id);
    }, 62);
    return () => window.clearInterval(id);
  }, [caption]);

  // 动画循环里要读最新阶段，用 ref 避免闭包拿到旧值
  const stageRef = useRef<Stage>('burst');
  useEffect(() => { stageRef.current = stage; }, [stage]);


  const close = useCallback(() => {
    setOpen(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  // ── 触发 ──
  useEffect(() => {
    let idx = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      const expect = KONAMI[idx];
      const hit = expect.length === 1 ? e.key.toLowerCase() === expect : e.key === expect;
      if (hit) {
        idx += 1;
        if (idx === KONAMI.length) { idx = 0; setOpen(true); }
      } else {
        idx = e.key === KONAMI[0] ? 1 : 0;
      }
    };
    const onEvent = () => { setStage('burst'); setCaption(''); setTyped(''); setOpen(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(EASTER_EGG_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(EASTER_EGG_EVENT, onEvent);
    };
  }, [close]);

  // ── 演出主循环 ──
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const cx = () => W() / 2;
    const cy = () => H() * 0.52;

    // 鼠标引力：划过时把附近粒子推开，营造"可拨动"的手感
    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener('mousemove', onMove);

    const COUNT = reduced ? 420 : 1100;
    const parts: P[] = Array.from({ length: COUNT }, () => ({
      x: cx() + (Math.random() - 0.5) * W(),
      y: cy() + (Math.random() - 0.5) * H(),
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      tx: null, ty: null,
      color: PINK[Math.floor(Math.random() * PINK.length)],
      size: 1.5 + Math.random() * 1.5,
      ph: Math.random() * Math.PI * 2,
    }));

    // 背景星空：缓慢闪烁，给画面垫一层深度
    const stars: Star[] = Array.from({ length: reduced ? 60 : 150 }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      z: 0.3 + Math.random() * 0.7, ph: Math.random() * Math.PI * 2,
    }));

    let sparks: Spark[] = [];
    const ripples: Ripple[] = [];

    const burst = (x: number, y: number) => {
      const color = SPARK[Math.floor(Math.random() * SPARK.length)];
      const n = reduced ? 24 : 56;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = 1.8 + Math.random() * 3.6;
        const max = 46 + Math.random() * 32;
        sparks.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: max, max, color: Math.random() < 0.2 ? '#fff' : color,
          size: 1.3 + Math.random() * 1.7,
        });
      }
    };

    // 给粒子指派目标形态
    const assign = (pts: { x: number; y: number }[]) => {
      if (!pts.length) return;
      // 关键：采样点通常远多于粒子数，且是按行扫出来的。
      // 若用 pts[i % len] 取，只会命中最前面的若干行 —— 字会塌成一条扁带。
      // 必须在整个点集上等间隔取样，才能覆盖完整字形。
      parts.forEach((p, i) => {
        const pt = pts[Math.floor((i * pts.length) / parts.length) % pts.length];
        const j = parts.length > pts.length ? 2.6 : 0.9; // 复用同一点时抖开，免得叠成死点
        p.tx = pt.x + (Math.random() - 0.5) * j;
        p.ty = pt.y + (Math.random() - 0.5) * j;
      });
    };
    const scatter = (power: number) => {
      parts.forEach((p) => {
        p.tx = null; p.ty = null;
        const a = Math.random() * Math.PI * 2;
        p.vx += Math.cos(a) * power;
        p.vy += Math.sin(a) * power - 1.2; // 略微上飘，像余烬
      });
    };

    // ── 时间轴编排 ──
    const at = (ms: number, fn: () => void) => timersRef.current.push(window.setTimeout(fn, ms));
    CAPTIONS.forEach((c) => at(c.at, () => { setCaption(c.text); setTyped(''); }));
    burst(cx(), cy() - 40);
    at(240, () => burst(cx() - W() * 0.22, cy() - 60));
    at(480, () => burst(cx() + W() * 0.22, cy() - 20));

    at(T_HEART, () => {
      setStage('heart');
      const scale = Math.min(W(), H()) / 46;
      assign(heartPoints(COUNT, scale));
      ripples.push({ r: 0, alpha: 0.55 });
    });
    at(T_TEXT, () => {
      setStage('text');
      scatter(5.5);                       // 心形先炸开
      at(420, () => assign(textPoints('I LOVE U', Math.min(W() * 0.82, 1150))));
      burst(cx(), cy());
    });
    at(T_NAME, () => {
      setStage('text');
      scatter(5.0);
      at(380, () => assign(textPoints('WJW', Math.min(W() * 0.55, 760))));
      burst(cx(), cy() - 30);
    });
    at(T_DISSOLVE, () => { setStage('dissolve'); scatter(3.2); });
    at(T_END, close);

    const shoot = () => burst(W() * (0.12 + Math.random() * 0.76), H() * (0.16 + Math.random() * 0.4));
    const shootTimer = window.setInterval(shoot, reduced ? 1500 : 700);
    // 心跳：每 ~1.1s 一次「咚-咚」，同时向外推一圈波纹
    const beatTimer = window.setInterval(() => ripples.push({ r: 0, alpha: 0.4 }), 1100);

    let t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      // 拖尾：压暗而非清空，粒子自然留下尾迹
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(6, 9, 17, 0.26)';
      ctx.fillRect(0, 0, W(), H());

      // 背景星空
      for (const s of stars) {
        const tw = 0.35 + 0.35 * Math.sin(elapsed / 700 + s.ph);
        ctx.globalAlpha = tw * s.z;
        ctx.fillStyle = '#cfe0ff';
        ctx.fillRect(s.x, s.y, 1.4 * s.z, 1.4 * s.z);
      }
      ctx.globalAlpha = 1;

      // 心跳波纹
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.r += 6.5;
        r.alpha *= 0.965;
        if (r.alpha < 0.02) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(255,92,138,${r.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx(), cy(), r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 烟花火花（叠加模式，颜色更亮）
      ctx.globalCompositeOperation = 'lighter';
      sparks = sparks.filter((s) => s.life > 0);
      for (const s of sparks) {
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.045; s.vx *= 0.985; s.vy *= 0.985;
        s.life -= 1;
        ctx.globalAlpha = Math.max(0, s.life / s.max);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 主粒子：正常混合，避免密集粉点被 lighter 洗成白色
      ctx.globalCompositeOperation = 'source-over';
      // 心跳缩放：双峰包络，模拟「咚-咚」
      const beat = (elapsed % 1100) / 1100;
      const pulse = 1 + 0.075 * Math.exp(-beat * 9) + 0.045 * Math.exp(-Math.abs(beat - 0.18) * 16);
      const scaleNow = 1;

      for (const p of parts) {
        if (p.tx !== null && p.ty !== null) {
          // 心形阶段整体随心跳缩放；文字阶段保持稳定
          const k = pulse;
          const gx = cx() + p.tx * (stageRef.current === 'heart' ? k : scaleNow);
          const gy = cy() + p.ty * (stageRef.current === 'heart' ? k : scaleNow);
          // 弹簧 + 阻尼，聚拢时有轻微过冲，观感比线性缓动灵动
          p.vx += (gx - p.x) * 0.045;
          p.vy += (gy - p.y) * 0.045;
          p.vx *= 0.80;
          p.vy *= 0.80;
          // 到位后加一点微抖，避免死板
          p.x += p.vx + Math.sin(elapsed / 500 + p.ph) * 0.18;
          p.y += p.vy + Math.cos(elapsed / 520 + p.ph) * 0.18;
        } else {
          p.vy += 0.02;
          p.vx *= 0.99; p.vy *= 0.99;
          p.x += p.vx; p.y += p.vy;
        }

        // 鼠标引力：附近粒子被推开
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 12000) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / 110) * 2.6;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }

        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(elapsed / 400 + p.ph);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    };
    t0 = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.clearInterval(shootTimer);
      window.clearInterval(beatTimer);
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, cursor: 'pointer',
        background: 'radial-gradient(120% 90% at 50% 45%, rgba(40,10,30,0.62) 0%, rgba(6,9,17,0.88) 70%)',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div
        style={{
          position: 'absolute', left: '50%', top: '13%', transform: 'translateX(-50%)',
          textAlign: 'center', pointerEvents: 'none', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <LogoMark size={58} />
        </div>
        <div
          style={{
            fontSize: 19, fontWeight: 500, letterSpacing: 3,
            color: 'rgba(255,255,255,0.92)', textShadow: '0 2px 22px rgba(255,92,138,0.7)',
          }}
        >
          wjw <span style={{ color: '#ff5c8a' }}>❤</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
          移动鼠标可以拨开星尘 · 点击或 Esc 关闭
        </div>
      </div>

      {/* 底部字幕：逐字打出，四幕连成一段话 */}
      <div
        style={{
          position: 'absolute', left: '50%', bottom: '11%', transform: 'translateX(-50%)',
          width: 'min(90vw, 760px)', textAlign: 'center', pointerEvents: 'none', userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 22, fontWeight: 500, letterSpacing: 2, lineHeight: 1.7,
            color: '#ffffff', textShadow: '0 2px 26px rgba(255,92,138,0.8)',
          }}
        >
          {typed}
          {typed.length < caption.length && (
            <span style={{ opacity: 0.75, marginLeft: 2 }}>|</span>
          )}
        </span>
      </div>
    </div>
  );
};
