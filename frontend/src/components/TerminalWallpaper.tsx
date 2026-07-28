import React, { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// wjw 专属终端背景
//
// 终端里敲 wjw-bg 显示、wjw-bg-hide 隐藏，开关记在 localStorage，
// 下次打开还是上次的状态。默认隐藏——不打招呼就铺一层壁纸太打扰。
//
// 三条硬约束，决定了这里为什么不用 canvas：
//   1. 它躺在 xterm 画布「下层」（z-index:0），整体透明度压到 0.14，
//      只做氛围，绝不能和终端文字抢对比度；
//   2. pointer-events:none，选中 / 右键 / 点击全部照常落到终端上；
//   3. 全部动画只动 transform / opacity，交给合成器，不重排不重绘。
//      终端刚为了性能换成 WebGL 渲染，这层背景不能把省下的 CPU 又吃回去，
//      所以一帧 rAF 都不跑（keyframes 见 index.css）。
//
// 注意：要让这层透出来，xterm 自己画的底色必须是透明的——
// 见 TerminalPage 里 allowTransparency + theme.background 的处理。
// ─────────────────────────────────────────────────────────────

const KEY = 'wjw_bg';
export const WALLPAPER_EVENT = 'lynx-wjw-wallpaper';

/** 终端口令：显示 / 隐藏 */
export const WALLPAPER_SHOW_RE = /^\s*wjw-bg\s*$/i;
export const WALLPAPER_HIDE_RE = /^\s*wjw-bg-hide\s*$/i;

export const isWallpaperOn = () => localStorage.getItem(KEY) === '1';

/** 切换背景。写 localStorage 后广播，让所有分屏/标签同时生效 */
export const setWallpaper = (on: boolean) => {
  localStorage.setItem(KEY, on ? '1' : '0');
  window.dispatchEvent(new CustomEvent<boolean>(WALLPAPER_EVENT, { detail: on }));
};

/** 订阅背景开关（每个终端面板各订阅一份） */
export const useWallpaper = (): boolean => {
  const [on, setOn] = useState(isWallpaperOn);
  useEffect(() => {
    const h = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(WALLPAPER_EVENT, h);
    return () => window.removeEventListener(WALLPAPER_EVENT, h);
  }, []);
  return on;
};

// ── 小动物：统一 64×64 视野的描边线稿，只用 stroke，不填色 ──────
// 线稿而不是 emoji：emoji 是彩色位图，压到 0.14 透明度会糊成一团脏色块。
const PET_PATHS: Record<string, React.ReactNode> = {
  cat: (
    <>
      <circle cx="32" cy="36" r="17" />
      <path d="M18 25 L15 10 L29 19" />
      <path d="M46 25 L49 10 L35 19" />
      <path d="M24 35 q3.5 -4.5 7 0" />
      <path d="M33 35 q3.5 -4.5 7 0" />
      <path d="M32 41 l-3 3 M32 41 l3 3" />
      <path d="M14 38 h-9 M14 44 h-9 M50 38 h9 M50 44 h9" />
      <path d="M49 50 q13 5 8 -11" />
    </>
  ),
  rabbit: (
    <>
      <circle cx="32" cy="41" r="15" />
      <ellipse cx="25" cy="16" rx="5" ry="13" transform="rotate(-12 25 16)" />
      <ellipse cx="39" cy="16" rx="5" ry="13" transform="rotate(12 39 16)" />
      <path d="M23 39 q3.5 -4.5 7 0" />
      <path d="M34 39 q3.5 -4.5 7 0" />
      <path d="M32 46 l-3 3 M32 46 l3 3" />
      <path d="M12 44 h-6 M12 49 h-6 M52 44 h6 M52 49 h6" />
    </>
  ),
  bear: (
    <>
      <circle cx="32" cy="37" r="17" />
      <circle cx="17" cy="21" r="7" />
      <circle cx="47" cy="21" r="7" />
      <ellipse cx="32" cy="45" rx="10" ry="7.5" />
      <path d="M25 33 q3 -4 6 0" />
      <path d="M33 33 q3 -4 6 0" />
      <path d="M32 42 v3 M32 45 q-3 3 -5 1 M32 45 q3 3 5 1" />
    </>
  ),
  butterfly: (
    <>
      <ellipse cx="20" cy="25" rx="13" ry="9.5" transform="rotate(-25 20 25)" />
      <ellipse cx="44" cy="25" rx="13" ry="9.5" transform="rotate(25 44 25)" />
      <ellipse cx="23" cy="43" rx="9.5" ry="7" transform="rotate(-15 23 43)" />
      <ellipse cx="41" cy="43" rx="9.5" ry="7" transform="rotate(15 41 43)" />
      <path d="M32 16 v34" />
      <path d="M32 18 q-7 -6 -9 -10 M32 18 q7 -6 9 -10" />
    </>
  ),
  paw: (
    <>
      <ellipse cx="32" cy="42" rx="13" ry="11" />
      <ellipse cx="17" cy="26" rx="5.5" ry="7" transform="rotate(-18 17 26)" />
      <ellipse cx="27" cy="19" rx="5.5" ry="7.5" />
      <ellipse cx="38" cy="19" rx="5.5" ry="7.5" />
      <ellipse cx="48" cy="26" rx="5.5" ry="7" transform="rotate(18 48 26)" />
    </>
  ),
};

/** 小动物摆位：位置 / 大小 / 摆动周期都手工错开，避免看出规律 */
const PETS: { k: keyof typeof PET_PATHS | string; top: string; left: string; size: number; dur: number; delay: number; color: string }[] = [
  { k: 'cat', top: '14%', left: '9%', size: 76, dur: 7.5, delay: 0, color: '#ffd98e' },
  { k: 'rabbit', top: '62%', left: '15%', size: 66, dur: 8.8, delay: -2.1, color: '#ffb3c6' },
  { k: 'bear', top: '20%', left: '80%', size: 80, dur: 9.6, delay: -1.2, color: '#ffb3c6' },
  { k: 'butterfly', top: '68%', left: '76%', size: 60, dur: 6.4, delay: -3.4, color: '#ffd98e' },
  { k: 'butterfly', top: '8%', left: '58%', size: 44, dur: 5.6, delay: -1.8, color: '#ffb3c6' },
  { k: 'paw', top: '84%', left: '45%', size: 38, dur: 8.2, delay: -4.0, color: '#ffd98e' },
  { k: 'cat', top: '78%', left: '30%', size: 44, dur: 7.0, delay: -2.7, color: '#ffb3c6' },
  { k: 'rabbit', top: '10%', left: '33%', size: 46, dur: 9.1, delay: -5.2, color: '#ffd98e' },
];

/**
 * 上浮的小心心。
 * 起点 bottom 直接散在整个面板高度上，而不是全堆在底边靠动画推上来——
 * 这样在「减少动态效果」下动画被停掉时，它们仍旧是铺开的，不会全挤到面板外面看不见。
 * 负延迟则让它们一挂载就处在飘升的不同阶段，不会「一起从底下冒出来」。
 */
const HEARTS = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 6.3 + (i % 3) * 4 + 3) % 94}%`,
  bottom: `${(i * 11 + (i % 4) * 7) % 76}%`,
  size: 12 + ((i * 7) % 16),
  dur: 14 + ((i * 5) % 11),
  delay: -((i * 3.1) % 14),
  color: i % 3 === 0 ? '#ffd98e' : '#ff8fab',
}));

/** 心形路径（480×300 视野里居中的一颗，兼作小心心的形状源） */
const HEART_D =
  'M240 268 C150 200 70 152 70 100 C70 62 100 34 138 34 C172 34 205 56 240 100 '
  + 'C275 56 308 34 342 34 C380 34 410 62 410 100 C410 152 330 200 240 268 Z';

interface Props {
  /** 整体透明度：默认 0.14，实测这个量级既看得见又不影响读字 */
  opacity?: number;
}

export const TerminalWallpaper: React.FC<Props> = ({ opacity = 0.14 }) => (
  <div className="wjw-wp" style={{ opacity }} aria-hidden>
    <div className="wjw-wp-glow" />

    {/* 中心：一颗大心里装着 wjw */}
    <div className="wjw-wp-center">
      <svg viewBox="0 0 480 300" width="100%" fill="none">
        <path d={HEART_D} stroke="#ff8fab" strokeWidth="3" />
        <path d={HEART_D} stroke="#ffd98e" strokeWidth="1" transform="translate(240 150) scale(0.88) translate(-240 -150)" />
        <text
          x="240" y="118" textAnchor="middle" dominantBaseline="middle"
          fill="#ffe4ec" fontSize="104" fontWeight="700" letterSpacing="6"
          fontFamily='"Segoe UI", -apple-system, Roboto, sans-serif'
        >
          wjw
        </text>
        <text
          x="240" y="196" textAnchor="middle" dominantBaseline="middle"
          fill="#ffd98e" fontSize="26" letterSpacing="10"
          fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif'
        >
          永远爱你
        </text>
      </svg>
    </div>

    {/* 上浮的小心心 */}
    {HEARTS.map((h, i) => (
      <div
        key={i}
        className="wjw-wp-heart"
        style={{ left: h.left, bottom: h.bottom, width: h.size, animationDuration: `${h.dur}s`, animationDelay: `${h.delay}s` }}
      >
        <svg viewBox="0 0 480 300" width="100%" fill={h.color}>
          <path d={HEART_D} />
        </svg>
      </div>
    ))}

    {/* 小动物点缀 */}
    {PETS.map((p, i) => (
      <div
        key={i}
        className="wjw-wp-pet"
        style={{ top: p.top, left: p.left, width: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
      >
        <svg
          viewBox="0 0 64 64" width="100%" fill="none"
          stroke={p.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          {PET_PATHS[p.k]}
        </svg>
      </div>
    ))}
  </div>
);
