import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogoMark } from './Logo';
import { heartPoints, textPoints } from './EasterEgg';

// ─────────────────────────────────────────────────────────────
// 结婚纪念日彩蛋：一场比生日版更「有仪式感」的粒子演出
//
// 复用 EasterEgg 那套骨架（全屏 canvas、同一批粒子在形态间变形、
// 打字机字幕、心跳波纹），但换成婚礼语汇，节奏也刻意放得更慢：
//   0.0s 星光开场 → 2.8s 交叠的双戒指（带旋转高光）→ 7.0s 两颗心
//   → 9.7s 两心合一 → 12.2s WJW → 16.0s ALWAYS → 19.4s 化作花雨 → 22.0s 收场
// 全程叠加：香槟金星空、飘落花瓣、上升的香槟气泡、金色心跳波纹。
//
// 触发：终端里单独敲一行 wedding（在回车处拦截，不下发 shell）。
// ─────────────────────────────────────────────────────────────

export const WEDDING_EGG_EVENT = 'lynx-wedding-egg';

/** 终端里触发：wedding / 260222 / 20260222 / 结婚快乐 / 纪念日快乐。
 *  日期口令沿用生日那套的 YYMMDD 写法（生日是 921129），
 *  同时收下 YYYYMMDD 的写法，免得记成哪种都得试一遍。 */
export const WEDDING_EGG_RE = /^\s*(wedding|260222|20260222|结婚快乐|纪念日快乐)\s*$/i;

export const fireWeddingEgg = () => window.dispatchEvent(new Event(WEDDING_EGG_EVENT));

// 演出时间轴（毫秒）——七幕，总长约 22s。
// 每一幕都留够停顿：粒子飞到位就要 0.6s 左右，实测截图发现双心只留 1.5s
// 根本来不及看清就散了，所以合心单独占一拍，形状停够 2.3s 再动。
const T_RINGS = 2800;     // 幕一：两枚交叠的戒指
const T_HEART = 7000;     // 幕二：并排的两颗心
const T_MERGE = 9700;     // 幕三：两心合一
const T_NAME = 12200;     // 幕四：WJW
const T_ALWAYS = 16000;   // 幕五：ALWAYS
const T_DISSOLVE = 19400; // 幕六：化作花雨星尘
const T_END = 22000;

type Stage = 'open' | 'rings' | 'heart' | 'text' | 'dissolve';

/** 香槟金 / 胭脂粉 / 纯白：婚礼三色，主粒子与火花都从这里取 */
const GOLD = ['#ffd98e', '#f7c76a', '#ffe9bd', '#e0a94a'];
const BLUSH = ['#ffd6e0', '#ffb3c6', '#ff8fab', '#ffffff'];
const PARTICLE = [...GOLD, ...BLUSH, '#ffffff', '#ffffff'];
const SPARK = ['#ffd98e', '#ffffff', '#ff8fab', '#ffe9bd'];

const CAPTIONS = [
  '今天，是我们的结婚纪念日',
  '两枚戒指，从此扣成一双',
  '两颗心，本来隔着山海',
  '后来，跳成了同一个节拍',
  '无论顺境逆境，我都在',
  '一年又一年，还是想牵着你的手',
  '纪念日快乐，余生请多指教 ❤',
];

interface P {
  x: number; y: number;
  vx: number; vy: number;
  /** 目标点（相对画面中心），为 null 时自由飞行 */
  tx: number | null; ty: number | null;
  color: string;
  size: number;
  /** 相位，用于错开抖动/闪烁 */
  ph: number;
}

interface Spark {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; color: string; size: number;
}

interface Ripple { r: number; alpha: number }

interface Star { x: number; y: number; z: number; ph: number }

/** 花瓣：下落 + 自转 + 横向摆动 */
interface Petal { x: number; y: number; v: number; r: number; rot: number; spin: number; sway: number; ph: number; color: string }

/** 香槟气泡：从底部上升，越往上越淡 */
interface Bubble { x: number; y: number; v: number; r: number; ph: number }

/**
 * 双戒指点集：两个左右交叠的圆环，带一点环宽（不是一条细线）。
 * 交叠量取 0.78R——再近会糊成一坨，再远就不像「扣在一起」。
 */
const ringPairPoints = (count: number, R: number): { x: number; y: number }[] => {
  const pts: { x: number; y: number }[] = [];
  const dx = R * 0.78;
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = (Math.PI * 2 * i) / count + (side < 0 ? 0 : 0.37);
    // 环宽 ±6%，让轮廓有金属质感的厚度而不是一根发丝
    const r = R * (0.94 + Math.random() * 0.12);
    pts.push({ x: side * dx + Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return pts;
};

/**
 * 双心点集：两颗互相倾斜、左右交叠的心。
 * 直接复用 EasterEgg 的心形方程，只做平移 + 旋转。
 */
const twinHeartPoints = (count: number, scale: number): { x: number; y: number }[] => {
  const base = heartPoints(count, scale);
  const dx = scale * 7.2;
  const tilt = 0.2;
  return base.map((p, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const a = tilt * side;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: p.x * cos - p.y * sin + side * dx, y: p.x * sin + p.y * cos };
  });
};

export const WeddingEgg: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('open');
  const [caption, setCaption] = useState('');   // 当前整句
  const [typed, setTyped] = useState('');       // 已打出的部分（打字机效果）
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const timersRef = useRef<number[]>([]);

  // 字幕逐字打出：打完停住直到下一句
  useEffect(() => {
    if (!caption) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(caption.slice(0, i));
      if (i >= caption.length) window.clearInterval(id);
    }, 88);
    return () => window.clearInterval(id);
  }, [caption]);

  // 动画循环里要读最新阶段，用 ref 避免闭包拿到旧值
  const stageRef = useRef<Stage>('open');
  useEffect(() => { stageRef.current = stage; }, [stage]);

  const close = useCallback(() => {
    setOpen(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  // ── 触发 ──
  // Esc 必须挂捕获阶段：xterm 要把 \x1b 交给 shell，会在 keydown 上 stopPropagation()，
  // 终端有焦点时冒泡阶段的 window 监听一次都收不到（实测 win:0 / cap:1）。
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !openRef.current) return; // 没在放就别拦
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onEvent = () => {
      setStage('open'); setCaption(''); setTyped(''); setOpen(true);
    };
    window.addEventListener('keydown', onEsc, true);
    window.addEventListener(WEDDING_EGG_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onEsc, true);
      window.removeEventListener(WEDDING_EGG_EVENT, onEvent);
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

    // 鼠标引力：划过时把附近粒子推开，和 EasterEgg 一致的手感
    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener('mousemove', onMove);

    // ALWAYS 有 6 个字母，粒子太少字形会散
    const COUNT = reduced ? 520 : 1800;
    const parts: P[] = Array.from({ length: COUNT }, () => ({
      x: cx() + (Math.random() - 0.5) * W(),
      y: cy() + (Math.random() - 0.5) * H(),
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      tx: null, ty: null,
      color: PARTICLE[Math.floor(Math.random() * PARTICLE.length)],
      size: 1.4 + Math.random() * 1.5,
      ph: Math.random() * Math.PI * 2,
    }));

    const stars: Star[] = Array.from({ length: reduced ? 70 : 170 }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      z: 0.3 + Math.random() * 0.7, ph: Math.random() * Math.PI * 2,
    }));

    // 花瓣与气泡：reduced-motion 下整层不生成，省得画面一直在动
    const petals: Petal[] = reduced ? [] : Array.from({ length: 46 }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      v: 0.5 + Math.random() * 1.1,
      r: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.02,
      sway: 0.4 + Math.random() * 1.0,
      ph: Math.random() * Math.PI * 2,
      color: BLUSH[Math.floor(Math.random() * BLUSH.length)],
    }));
    const bubbles: Bubble[] = reduced ? [] : Array.from({ length: 40 }, () => ({
      x: Math.random() * W(), y: H() + Math.random() * H(),
      v: 0.5 + Math.random() * 1.3,
      r: 1.3 + Math.random() * 2.6,
      ph: Math.random() * Math.PI * 2,
    }));

    let sparks: Spark[] = [];
    const ripples: Ripple[] = [];
    // 戒指高光要跟着戒指画，尺寸在幕一确定后记下来给绘制循环用
    let ringR = 0;

    const burst = (x: number, y: number) => {
      const color = SPARK[Math.floor(Math.random() * SPARK.length)];
      const n = reduced ? 24 : 54;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = 1.7 + Math.random() * 3.4;
        const max = 48 + Math.random() * 34;
        sparks.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: max, max, color: Math.random() < 0.25 ? '#fff' : color,
          size: 1.2 + Math.random() * 1.7,
        });
      }
    };

    // 给粒子指派目标形态。等间隔取样，否则字形会塌成一条扁带（见 EasterEgg 里的说明）
    const assign = (pts: { x: number; y: number }[]) => {
      if (!pts.length) return;
      parts.forEach((p, i) => {
        const pt = pts[Math.floor((i * pts.length) / parts.length) % pts.length];
        const j = parts.length > pts.length ? 2.6 : 0.9;
        p.tx = pt.x + (Math.random() - 0.5) * j;
        p.ty = pt.y + (Math.random() - 0.5) * j;
      });
    };
    const scatter = (power: number) => {
      parts.forEach((p) => {
        p.tx = null; p.ty = null;
        const a = Math.random() * Math.PI * 2;
        p.vx += Math.cos(a) * power;
        p.vy += Math.sin(a) * power - 1.1;
      });
    };

    // ── 时间轴编排 ──
    const at = (ms: number, fn: () => void) => timersRef.current.push(window.setTimeout(fn, ms));
    const say = (text: string) => { setCaption(text); setTyped(''); };
    const CUES = [0, T_RINGS, T_HEART, T_MERGE, T_NAME, T_ALWAYS, T_DISSOLVE];
    CAPTIONS.forEach((text, i) => at(CUES[i], () => say(text)));

    burst(cx(), cy() - 40);
    at(260, () => burst(cx() - W() * 0.2, cy() - 60));
    at(520, () => burst(cx() + W() * 0.2, cy() - 20));

    at(T_RINGS, () => {
      setStage('rings');
      ringR = Math.min(W(), H()) * 0.17;
      assign(ringPairPoints(COUNT, ringR));
      ripples.push({ r: 0, alpha: 0.5 });
      // 两枚戒指「扣上」的瞬间各闪一下，像交换戒指时的反光
      at(360, () => { burst(cx() - ringR * 0.78, cy() - ringR); });
      at(560, () => { burst(cx() + ringR * 0.78, cy() - ringR); });
    });
    at(T_HEART, () => {
      setStage('heart');
      scatter(4.8);
      at(420, () => assign(twinHeartPoints(COUNT, Math.min(W(), H()) / 52)));
    });
    // 两颗心并排跳一会儿，再收成一颗大心——这一下是整场的情绪高点
    at(T_MERGE, () => {
      assign(heartPoints(COUNT, Math.min(W(), H()) / 42));
      ripples.push({ r: 0, alpha: 0.62 });
      burst(cx(), cy());
    });
    at(T_NAME, () => {
      setStage('text');
      scatter(4.6);
      at(400, () => assign(textPoints('WJW', Math.min(W() * 0.55, 780))));
      burst(cx(), cy() - 30);
    });
    at(T_ALWAYS, () => {
      setStage('text');
      scatter(4.4);
      at(400, () => assign(textPoints('ALWAYS', Math.min(W() * 0.72, 1020))));
      burst(cx(), cy() - 20);
    });
    at(T_DISSOLVE, () => {
      setStage('dissolve');
      scatter(2.8);
    });
    at(T_END, close);

    const shoot = () => burst(W() * (0.12 + Math.random() * 0.76), H() * (0.14 + Math.random() * 0.42));
    const shootTimer = window.setInterval(shoot, reduced ? 1600 : 760);
    // 心跳：金色波纹，比生日版慢一拍，更像钟声
    const beatTimer = window.setInterval(() => ripples.push({ r: 0, alpha: 0.34 }), 1250);

    let t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      // 拖尾：压暗而非清空，粒子自然留下尾迹（底色偏暖，配合婚礼调）
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(12, 8, 14, 0.24)';
      ctx.fillRect(0, 0, W(), H());

      // 背景星光
      for (const s of stars) {
        const tw = 0.3 + 0.4 * Math.sin(elapsed / 760 + s.ph);
        ctx.globalAlpha = Math.max(0, tw) * s.z;
        ctx.fillStyle = '#ffe9bd';
        ctx.fillRect(s.x, s.y, 1.5 * s.z, 1.5 * s.z);
      }
      ctx.globalAlpha = 1;

      // 花瓣：下落 + 自转，用两段贝塞尔拼一片薄瓣
      for (const p of petals) {
        p.y += p.v;
        p.x += Math.sin(elapsed / 1000 + p.ph) * p.sway;
        p.rot += p.spin;
        if (p.y > H() + 14) { p.y = -14; p.x = Math.random() * W(); }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // 自转到侧面时压扁，模拟薄片翻面
        ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(elapsed / 900 + p.ph)));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.bezierCurveTo(p.r * 0.9, -p.r * 0.5, p.r * 0.7, p.r * 0.7, 0, p.r);
        ctx.bezierCurveTo(-p.r * 0.7, p.r * 0.7, -p.r * 0.9, -p.r * 0.5, 0, -p.r);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // 香槟气泡：贴着底部往上冒，越高越淡
      for (const b of bubbles) {
        b.y -= b.v;
        b.x += Math.sin(elapsed / 700 + b.ph) * 0.35;
        if (b.y < -10) { b.y = H() + 10; b.x = Math.random() * W(); }
        const fade = Math.min(1, b.y / (H() * 0.85));
        ctx.globalAlpha = 0.42 * fade;
        ctx.strokeStyle = '#ffe9bd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 金色波纹
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.r += 6.2;
        r.alpha *= 0.966;
        if (r.alpha < 0.02) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(255,214,140,${r.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx(), cy(), r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 戒指高光：沿环周缓慢扫过的一小段亮弧，让「金属感」立起来
      if (stageRef.current === 'rings' && ringR > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const sweep = elapsed / 900;
        for (const side of [-1, 1]) {
          ctx.strokeStyle = 'rgba(255,236,190,0.55)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx() + side * ringR * 0.78, cy(), ringR, sweep + side, sweep + side + 0.5);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
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

      // 主粒子：正常混合，避免密集亮点被 lighter 洗成一片白
      ctx.globalCompositeOperation = 'source-over';
      // 心跳缩放：双峰包络，模拟「咚-咚」；只在心形幕生效
      const beat = (elapsed % 1250) / 1250;
      const pulse = 1 + 0.07 * Math.exp(-beat * 9) + 0.042 * Math.exp(-Math.abs(beat - 0.18) * 16);

      for (const p of parts) {
        if (p.tx !== null && p.ty !== null) {
          const k = stageRef.current === 'heart' ? pulse : 1;
          const gx = cx() + p.tx * k;
          const gy = cy() + p.ty * k;
          // 弹簧 + 阻尼：聚拢时轻微过冲，比线性缓动灵动
          p.vx += (gx - p.x) * 0.030;
          p.vy += (gy - p.y) * 0.030;
          p.vx *= 0.845;
          p.vy *= 0.845;
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
        // 暖金色的场光，和 EasterEgg 的冷调拉开区别
        background: 'radial-gradient(120% 90% at 50% 45%, rgba(60,28,20,0.60) 0%, rgba(10,7,14,0.90) 70%)',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div
        style={{
          // 比 EasterEgg 再往上提一点：婚礼版的心形/戒指铺得更大，
          // 放在 12% 会被粒子从头顶穿过去，字就看不清了
          position: 'absolute', left: '50%', top: '6%', transform: 'translateX(-50%)',
          textAlign: 'center', pointerEvents: 'none', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <LogoMark size={58} />
        </div>
        {/* 交叠的两枚戒指：画成 svg 而不是用 ⚭ 之类的字符，
            那些符号在 Windows 上多半没有字形，会掉成豆腐块 */}
        <svg width="72" height="30" viewBox="0 0 72 30" fill="none" style={{ display: 'block', margin: '0 auto 6px' }}>
          <circle cx="27" cy="16" r="11" stroke="#ffd98e" strokeWidth="1.8" />
          <circle cx="45" cy="16" r="11" stroke="#ffe9bd" strokeWidth="1.8" />
        </svg>
        <div
          style={{
            fontSize: 20, fontWeight: 500, letterSpacing: 6,
            color: 'rgba(255,244,224,0.94)', textShadow: '0 2px 24px rgba(255,196,110,0.75)',
          }}
        >
          wjw
        </div>
        <div style={{ marginTop: 6, fontSize: 13, letterSpacing: 6, color: 'rgba(255,214,140,0.72)' }}>
          结婚纪念日
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.34)' }}>
          移动鼠标可以拨开花雨 · 点击或 Esc 关闭
        </div>
      </div>

      {/* 底部字幕：逐字打出，六幕连成一段誓词 */}
      <div
        style={{
          position: 'absolute', left: '50%', bottom: '11%', transform: 'translateX(-50%)',
          width: 'min(90vw, 780px)', textAlign: 'center', pointerEvents: 'none', userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 23, fontWeight: 500, letterSpacing: 2, lineHeight: 1.7,
            color: '#fff6e6', textShadow: '0 2px 28px rgba(255,196,110,0.85)',
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
