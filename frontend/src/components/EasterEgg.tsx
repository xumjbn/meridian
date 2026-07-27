import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogoMark } from './Logo';

// ─────────────────────────────────────────────────────────────
// 彩蛋：输入「wjw i love u」放一场烟花
//
// 触发有两条路径，覆盖全部输入场景：
//   1. 终端里：由 TerminalPage 在回车时拦截（匹配则清行、不下发 shell），
//      通过 window 事件 lynx-easter-egg 通知这里，避免留下 command not found。
//   2. 其它页面：这里挂全局 keydown，维护一个滚动字符缓冲做序列匹配。
// 动画是纯 canvas 粒子，无第三方依赖；尊重 prefers-reduced-motion。
// ─────────────────────────────────────────────────────────────

export const EASTER_EGG_EVENT = 'lynx-easter-egg';
/** 终端里触发：单独一行 love，或完整的 wjw i love u */
export const EASTER_EGG_RE = /^\s*(love|wjw\s*i\s*love\s*u)\s*$/i;

/** 任意位置手动触发彩蛋 */
export const fireEasterEgg = () => window.dispatchEvent(new Event(EASTER_EGG_EVENT));

// Konami 码：↑↑↓↓←→←→BA。用的是按键名而非可见字符，
// 因此不会把内容打进搜索框/表单，也不挑当前焦点在哪。
const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

const DURATION_MS = 6000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 剩余寿命（帧）
  max: number;
  color: string;
  size: number;
}

/** 组成文字的粒子：从随机位置缓动飞向目标点，拼出字形 */
interface TextParticle {
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  size: number;
}

// 把文字画到离屏 canvas 后逐像素采样，得到组成字形的目标点集合。
// 比直接写一行字更有"烟花拼字"的感觉，且完全不依赖字体文件。
const sampleTextPoints = (text: string, maxWidth: number): { x: number; y: number }[] => {
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  if (!octx) return [];
  const fontSize = Math.max(48, Math.min(150, Math.floor(maxWidth / (text.length * 0.62))));
  off.width = Math.min(1400, Math.floor(maxWidth));
  off.height = Math.floor(fontSize * 1.6);
  octx.fillStyle = '#fff';
  octx.font = `700 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(text, off.width / 2, off.height / 2);

  const img = octx.getImageData(0, 0, off.width, off.height).data;
  const pts: { x: number; y: number }[] = [];
  const step = 5; // 采样步长：越小越密，粒子也越多
  for (let y = 0; y < off.height; y += step) {
    for (let x = 0; x < off.width; x += step) {
      if (img[(y * off.width + x) * 4 + 3] > 128) {
        pts.push({ x: x - off.width / 2, y: y - off.height / 2 });
      }
    }
  }
  return pts;
};

const COLORS = ['#ff5c8a', '#ffd166', '#06d6a0', '#4da3ff', '#c77dff', '#ff8fab'];

export const EasterEgg: React.FC = () => {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    setOpen(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  // ── 触发：Konami 码 + 徽标连点/终端命令转发过来的事件 ──
  // 刻意不做「连续可见字符」匹配：那样会把口令实实在在打进搜索框和表单里。
  useEffect(() => {
    let idx = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      const expect = KONAMI[idx];
      const hit = expect.length === 1 ? e.key.toLowerCase() === expect : e.key === expect;
      if (hit) {
        idx += 1;
        if (idx === KONAMI.length) {
          idx = 0;
          setOpen(true);
        }
      } else {
        // 允许把当前键当作新序列的开头（连按 ↑↑↑↑ 也能正常起步）
        idx = e.key === KONAMI[0] ? 1 : 0;
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(EASTER_EGG_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(EASTER_EGG_EVENT, onEvent);
    };
  }, [close]);

  // ── 烟花动画 ──
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
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
    let particles: Particle[] = [];

    // 一次绽放：在 (x,y) 处向四周抛出一圈粒子
    const burst = (x: number, y: number) => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const count = reduced ? 26 : 58;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 1.6 + Math.random() * 3.4;
        const max = 48 + Math.random() * 34;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: max, max,
          color: Math.random() < 0.22 ? '#ffffff' : color,
          size: 1.4 + Math.random() * 1.8,
        });
      }
    };

    // 开场先来三束，之后按节奏持续放
    burst(W() * 0.5, H() * 0.42);
    const shoot = () => burst(W() * (0.15 + Math.random() * 0.7), H() * (0.2 + Math.random() * 0.4));
    setTimeout(shoot, 260);
    setTimeout(shoot, 520);
    const interval = window.setInterval(shoot, reduced ? 1400 : 620);

    // 约 0.9s 后，粒子从四面八方飞过来拼出「I LOVE U」
    let textParts: TextParticle[] = [];
    const textTimer = window.setTimeout(() => {
      const cx = W() / 2;
      const cy = H() * 0.5;
      const pts = sampleTextPoints('I LOVE U', Math.min(W() * 0.8, 1100));
      textParts = pts.map((pt) => ({
        // 起点撒在屏幕外圈，飞入时形成"聚拢"的观感
        x: cx + (Math.random() - 0.5) * W() * 1.4,
        y: cy + (Math.random() - 0.5) * H() * 1.4,
        tx: cx + pt.x,
        ty: cy + pt.y,
        color: Math.random() < 0.18 ? '#ffffff' : '#ff5c8a',
        size: 2.0,
      }));
    }, 900);

    const tick = () => {
      // 拖尾：每帧压暗而非清空，粒子自然拉出尾迹
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(6, 9, 17, 0.22)';
      ctx.fillRect(0, 0, W(), H());
      ctx.globalCompositeOperation = 'lighter';

      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;      // 重力
        p.vx *= 0.985;      // 空气阻力
        p.vy *= 0.985;
        p.life -= 1;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      // 文字粒子：缓动飞向目标点拼出字形。
      // 这里必须切回 source-over —— lighter 叠加会把密集的粉色点洗成白色，字就没颜色了。
      ctx.globalCompositeOperation = 'source-over';
      for (const p of textParts) {
        p.x += (p.tx - p.x) * 0.085;
        p.y += (p.ty - p.y) * 0.085;
        const d = Math.hypot(p.tx - p.x, p.ty - p.y);
        ctx.globalAlpha = d < 120 ? 1 : 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(close, DURATION_MS);

    return () => {
      window.removeEventListener('resize', resize);
      window.clearInterval(interval);
      window.clearTimeout(textTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        cursor: 'pointer',
        background: 'rgba(6,9,17,0.55)',
        backdropFilter: 'blur(1px)',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '22%',
          transform: 'translate(-50%,-50%)',
          textAlign: 'center',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <LogoMark size={72} />
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: 2,
            color: 'rgba(255,255,255,0.92)',
            textShadow: '0 2px 20px rgba(255,92,138,0.6)',
          }}
        >
          wjw <span style={{ color: '#ff5c8a' }}>❤</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          点击任意处或按 Esc 关闭
        </div>
      </div>
    </div>
  );
};
