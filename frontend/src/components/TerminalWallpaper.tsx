import React, { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// jwwu6 专属终端背景（三套，都是给自己看的情绪价值）
//
//   wjw-bg   爱意    大心 + jwwu6 你是最棒的 + 小动物 + 上浮心心
//   wjw-bg1  星海    月亮山脊 + 星空 + 流星 + 今天也辛苦了
//   wjw-bg2  安心    大树 + 蜷着的猫 + 萤火虫 + 慢慢来
//   wjw-bg-hide  收起
//
// 选择记在 localStorage，下次打开还是上次那套。默认隐藏——
// 不打招呼就给人铺一层壁纸太打扰。
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
const IMG_KEY = 'wjw_bg_img';
const OPACITY_KEY = 'wjw_bg_opacity';

/** 空串表示关闭；custom = 用户自己传的图片 */
export type WallpaperId = '' | 'love' | 'dense' | 'calm' | 'custom';

export const DEFAULT_OPACITY = 0.14;
export const MIN_OPACITY = 0.02;
export const MAX_OPACITY = 0.85;

/**
 * data URL 的长度上限，单位是「字符」而不是字节。
 * localStorage 整个域大约 5MB，但 Chromium 按 UTF-16 计量，一个字符占 2 字节——
 * 原来这里拿 3*1024*1024 当「3MB」比 out.length，实际占用是 6MB，
 * 稳超配额，大图必然走到 QuotaExceededError。
 * 1.6M 字符 ≈ 3.2MB 占用，给其它键留出余量。
 */
const MAX_IMG_CHARS = 1_600_000;
/** 超过这个宽度先缩，手机随手拍的图动辄 4000px，原样存必爆配额 */
const MAX_IMG_WIDTH = 1920;
/**
 * 源文件体积上限。这是防崩溃的闸门，不是省空间的优化：
 * img.src = objectURL 会把整张图解码进内存，一张 20000×15000 的图就是
 * 3 亿像素 × 4 字节 ≈ 1.2GB 像素缓冲，WebView2 直接 OOM——整个应用消失，
 * 不是抛异常，JS 层什么都接不住。所以必须在解码之前按体积拦掉。
 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/**
 * 解码后的像素总数上限。体积小但尺寸极大的图（高压缩比的长图、
 * 恶意构造的 PNG）能绕过体积闸门，所以解码完成后再按面积兜一道。
 */
const MAX_SOURCE_PIXELS = 60_000_000;

export const WALLPAPER_EVENT = 'wjw-wjw-wallpaper';

/** 终端口令。show 的正则要能捕获尾号：wjw-bg / wjw-bg1 / wjw-bg2 */
export const WALLPAPER_SHOW_RE = /^\s*wjw-bg([12])?\s*$/i;
export const WALLPAPER_HIDE_RE = /^\s*wjw-bg-hide\s*$/i;

/** 把口令尾号映射到具体哪一套 */
export const wallpaperIdFromCmd = (suffix?: string): WallpaperId =>
  (suffix === '1' ? 'dense' : suffix === '2' ? 'calm' : 'love');

const VALID: WallpaperId[] = ['love', 'dense', 'calm', 'custom'];

/** 内置三套的展示名，设置面板和口令提示共用 */
export const WALLPAPER_OPTIONS: { value: WallpaperId; label: string }[] = [
  { value: '', label: '关闭' },
  { value: 'love', label: '爱意（wjw-bg）' },
  { value: 'dense', label: '满屏情话（wjw-bg1）' },
  { value: 'calm', label: '安心（wjw-bg2）' },
  { value: 'custom', label: '自定义图片' },
];

/** 口令回执用的短名，写清楚每套长什么样，免得切了还不知道切成了啥 */
export const WALLPAPER_LABELS: Record<string, string> = {
  love: '爱意 · jwwu6 你是最棒的',
  dense: '满屏情话 · 老婆爱你',
  calm: '安心 · 慢慢来',
  custom: '自定义图片',
};

/**
 * 读当前选择。
 * 早先这个键存的是 '1' / '0'（只有一套背景），升级后要认得，
 * 否则老用户一打开发现壁纸没了。
 */
export const currentWallpaper = (): WallpaperId => {
  const v = localStorage.getItem(KEY);
  if (v === '1') return 'love';
  return VALID.includes(v as WallpaperId) ? (v as WallpaperId) : '';
};

/** 切换背景。写 localStorage 后广播，让所有分屏/标签同时生效 */
export const setWallpaper = (id: WallpaperId) => {
  localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent<WallpaperId>(WALLPAPER_EVENT, { detail: id }));
};

/** 自定义图片（data URL），没传过就是空串 */
export const customWallpaperImage = (): string => localStorage.getItem(IMG_KEY) || '';

/** 透明度，越界或没存过一律回默认值 */
export const wallpaperOpacity = (): number => {
  const v = parseFloat(localStorage.getItem(OPACITY_KEY) || '');
  return Number.isFinite(v) && v >= MIN_OPACITY && v <= MAX_OPACITY ? v : DEFAULT_OPACITY;
};

export const setWallpaperOpacity = (v: number) => {
  const clamped = Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, v));
  localStorage.setItem(OPACITY_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent<WallpaperId>(WALLPAPER_EVENT, { detail: currentWallpaper() }));
};

/**
 * 把用户选的图片转成可存的 data URL。
 * 必须先缩再存：localStorage 整个域通常只有 5MB，手机拍的图动辄 4000px、好几 MB，
 * 直接塞进去会抛 QuotaExceededError，而且那时候壁纸已经「看起来设置成功」了。
 * 所以这里先按宽度缩、再按质量降，仍然超标就明确报错，不留半吊子状态。
 */
export const readImageAsWallpaper = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    // type 可能为空（从原生对话框拿到的 File 自己拼的 mime、或系统没登记该扩展名），
    // 空就放过去让解码环节自己判断，别把正常图片挡在门外。
    if (file.type && !file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    // 解码之前先按体积拦：超大图解进内存会把 WebView 撑爆，那是进程级崩溃，
    // 到不了 onerror，也 catch 不到。
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error(`图片有 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限。先压一下或换一张。`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    // 无论走哪条分支都要释放 objectURL，否则这张图一直被引用着不回收
    const done = (fn: () => void) => { URL.revokeObjectURL(url); fn(); };
    img.onload = () => {
      const sw = img.naturalWidth, sh = img.naturalHeight;
      if (!sw || !sh) { done(() => reject(new Error('这个文件读不出图像'))); return; }
      if (sw * sh > MAX_SOURCE_PIXELS) {
        done(() => reject(new Error(`图片尺寸 ${sw}×${sh} 太大了，换一张小点的吧。`)));
        return;
      }
      // 同时按宽度和面积缩：只按宽度缩的话，一张 1920×30000 的长图缩完还是
      // 5760 万像素，canvas 分配照样能把内存打满。
      const scale = Math.min(1, MAX_IMG_WIDTH / sw, Math.sqrt(MAX_SOURCE_PIXELS / 16 / (sw * sh)));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) { done(() => reject(new Error('浏览器不支持画布，无法处理图片'))); return; }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // 逐档降质量，直到塞得下为止
      let smallest = '';
      for (const q of [0.82, 0.7, 0.58, 0.45, 0.34]) {
        const out = cv.toDataURL('image/jpeg', q);
        if (!out || out.length < 32) break;   // 画布过大时 toDataURL 会返回 "data:,"
        smallest = out;
        if (out.length <= MAX_IMG_CHARS) { resolve(out); return; }
      }
      reject(new Error(smallest
        ? '图片压到最低质量仍然存不下，换一张尺寸小点的吧'
        : '图片处理失败，画布导出为空'));
    };
    img.onerror = () => done(() => reject(new Error('这个文件读不出图像')));
    img.src = url;
  });

/** 存自定义图片并切到 custom。写失败要如实抛出，不能假装设置成功 */
export const setCustomWallpaper = (dataUrl: string) => {
  try {
    localStorage.setItem(IMG_KEY, dataUrl);
  } catch {
    // 大概率是上一张图还占着配额。先腾掉再试一次——
    // 换背景图这个动作本身就意味着旧图不要了，没有保留价值。
    try {
      localStorage.removeItem(IMG_KEY);
      localStorage.setItem(IMG_KEY, dataUrl);
    } catch {
      throw new Error('本地存储空间不足，图片没能保存');
    }
  }
  setWallpaper('custom');
};

/** 桌面端选图的结果。要区分「用户取消」和「这条路走不通」——
 *  取消就该什么都不做，走不通才回落到 <input type="file">。 */
export type PickResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'cancelled' | 'unavailable' };

const inTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif',
};

/**
 * 桌面端用 Tauri 的原生对话框选图，而不是 <input type="file">。
 *
 * 原因：Windows 上 Tauri 默认开着 dragDropEnabled（本应用的 SFTP 拖拽上传要用它，
 * 不能关），它注册的 OLE 拖放目标与 WebView2 弹原生文件对话框相互干扰，
 * 点 file input 会把整个应用拖死/崩掉。走插件的 dialog 就完全绕开了 WebView2
 * 那条路径。Web 端没这个问题，调用方回落到 file input。
 */
export const pickImageFile = async (): Promise<PickResult> => {
  if (!inTauri) return { ok: false, reason: 'unavailable' };
  try {
    const [dialog, fs] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const picked = await dialog.open({
      multiple: false,
      directory: false,
      filters: [{ name: '图片', extensions: Object.keys(MIME_BY_EXT) }],
    });
    if (!picked || typeof picked !== 'string') return { ok: false, reason: 'cancelled' };
    const bytes = await fs.readFile(picked);
    const name = picked.split(/[\\/]/).pop() || 'image';
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      ok: true,
      // File 而不是 Blob：readImageAsWallpaper 要看 size 和 type
      file: new File([bytes], name, { type: MIME_BY_EXT[ext] || 'image/jpeg' }),
    };
  } catch {
    // 插件缺失 / 能力未授权 —— 别把用户卡死，交给 file input 兜底
    return { ok: false, reason: 'unavailable' };
  }
};

export const clearCustomWallpaper = () => {
  localStorage.removeItem(IMG_KEY);
  if (currentWallpaper() === 'custom') setWallpaper('');
};

/** 订阅背景选择（每个终端面板各订阅一份） */
export const useWallpaper = (): WallpaperId => {
  const [id, setId] = useState<WallpaperId>(currentWallpaper);
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent<WallpaperId>).detail);
    window.addEventListener(WALLPAPER_EVENT, h);
    return () => window.removeEventListener(WALLPAPER_EVENT, h);
  }, []);
  return id;
};

/** 订阅透明度（跟着同一个广播走） */
export const useWallpaperOpacity = (): number => {
  const [v, setV] = useState(wallpaperOpacity);
  useEffect(() => {
    const h = () => setV(wallpaperOpacity());
    window.addEventListener(WALLPAPER_EVENT, h);
    return () => window.removeEventListener(WALLPAPER_EVENT, h);
  }, []);
  return v;
};

/**
 * 订阅自定义图片。
 * 图片必须单独订阅：已经处在 custom 状态时再换一张图，广播里的 id 还是 'custom'，
 * useWallpaper 的 setState 拿到相同值 React 直接跳过重渲染——
 * 表现就是「传了图没反应」。清除图片同理。
 */
export const useCustomWallpaperImage = (): string => {
  const [src, setSrc] = useState(customWallpaperImage);
  useEffect(() => {
    const h = () => setSrc(customWallpaperImage());
    window.addEventListener(WALLPAPER_EVENT, h);
    return () => window.removeEventListener(WALLPAPER_EVENT, h);
  }, []);
  return src;
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
  // 蜷着睡觉的猫：安心那套的主角，团成一圈才有「窝着」的感觉
  catCurl: (
    <>
      <path d="M10 44 q0 -20 22 -20 q22 0 22 20 q0 8 -8 8 h-28 q-8 0 -8 -8 Z" />
      <path d="M18 26 l-3 -9 l10 5" />
      <path d="M36 22 l4 -9 l6 8" />
      <path d="M22 38 q3 -3 6 0" />
      <path d="M31 38 q3 -3 6 0" />
      <path d="M27 43 q3 3 6 0" />
      <path d="M54 46 q10 2 6 -8" />
    </>
  ),
};

/** 小动物摆位：位置 / 大小 / 摆动周期都手工错开，避免看出规律 */
const PETS: { k: string; top: string; left: string; size: number; dur: number; delay: number; color: string }[] = [
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

// ── 密集重叠文字用的短句 ─────────────────────────────────────
// 每行反复铺，行与行之间还压着走，越挤越有那种「满屏都是」的劲儿。
const DENSE_A = ['老婆爱你', 'jwwu6 你是最棒的', '么么哒', '你已经很棒了', '老婆爱你', '辛苦啦'];
const DENSE_B = ['永远爱你', '想你', '老婆最好了', '抱抱', '亲亲', '爱你哟'];

/** 一行铺满的文字：短句循环拼到足够长，保证任何宽度都盖满 */
const denseLine = (src: string[], seed: number) =>
  Array.from({ length: 14 }, (_, k) => src[(seed + k) % src.length]).join('  ♥  ');

/** 基础层：正着铺，行距压得比字号小，行与行互相咬住 */
const DENSE_ROWS = Array.from({ length: 16 }, (_, i) => ({
  text: denseLine(DENSE_A, i),
  size: 26 + ((i * 5) % 16),
  top: `${i * 6.6 - 4}%`,
  dur: 26 + ((i * 7) % 22),
  dir: i % 2 === 0 ? 1 : -1,
  delay: -((i * 3.4) % 24),
  color: i % 3 === 0 ? '#ffd98e' : i % 3 === 1 ? '#ff8fab' : '#ffe4ec',
}));

/** 叠加层：整层斜着压上去，和基础层交叉才有「重叠」的观感 */
const DENSE_ROWS_B = Array.from({ length: 12 }, (_, i) => ({
  text: denseLine(DENSE_B, i + 2),
  size: 34 + ((i * 7) % 22),
  top: `${i * 9 - 6}%`,
  dur: 34 + ((i * 5) % 26),
  dir: i % 2 === 0 ? -1 : 1,
  delay: -((i * 4.1) % 30),
  color: i % 2 === 0 ? '#c77dff' : '#8fe3b8',
}));

/** 萤火虫：小幅漂移 + 明暗，安心那套用。
 *  数量和体积都比第一版加大——压到 0.14 透明度后，太小的点根本看不见。 */
const FIREFLIES = Array.from({ length: 38 }, (_, i) => ({
  left: `${(i * 7.3 + (i % 4) * 6) % 96}%`,
  top: `${(i * 9.7 + (i % 5) * 8) % 88}%`,
  size: 5 + ((i * 5) % 6),
  dur: 6 + ((i * 3) % 8),
  delay: -((i * 2.3) % 9),
}));

/** 心形路径（480×300 视野里居中的一颗，兼作小心心的形状源） */
const HEART_D =
  'M240 268 C150 200 70 152 70 100 C70 62 100 34 138 34 C172 34 205 56 240 100 '
  + 'C275 56 308 34 342 34 C380 34 410 62 410 100 C410 152 330 200 240 268 Z';

const SANS = '"Segoe UI", -apple-system, Roboto, sans-serif';
const CJK = '"PingFang SC", "Microsoft YaHei", sans-serif';

interface Props {
  /** 哪一套 */
  variant?: WallpaperId;
  /** 整体透明度：默认 0.14，实测这个量级既看得见又不影响读字 */
  opacity?: number;
}

// ── 第一套：爱意 ────────────────────────────────────────────
const LoveScene: React.FC = () => (
  <>
    <div className="wjw-wp-glow wjw-wp-glow-love" />

    {/* 中心：一颗大心里装着名字和那句话 */}
    <div className="wjw-wp-center">
      <svg viewBox="0 0 480 300" width="100%" fill="none">
        <path d={HEART_D} stroke="#ff8fab" strokeWidth="3" />
        <path d={HEART_D} stroke="#ffd98e" strokeWidth="1" transform="translate(240 150) scale(0.88) translate(-240 -150)" />
        <text
          x="240" y="112" textAnchor="middle" dominantBaseline="middle"
          fill="#ffe4ec" fontSize="78" fontWeight="700" letterSpacing="2"
          fontFamily={SANS}
        >
          jwwu6
        </text>
        <text
          x="240" y="188" textAnchor="middle" dominantBaseline="middle"
          fill="#ffd98e" fontSize="30" letterSpacing="8"
          fontFamily={CJK}
        >
          你是最棒的
        </text>
      </svg>
    </div>

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

    {PETS.map((p, i) => (
      <div
        key={i}
        className="wjw-wp-pet"
        style={{ top: p.top, left: p.left, width: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
      >
        <svg viewBox="0 0 64 64" width="100%" fill="none" stroke={p.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {PET_PATHS[p.k]}
        </svg>
      </div>
    ))}
  </>
);

// ── 第二套：密集重叠文字（老婆爱你）──────────────────────────
// 两层文字交叉铺满：正着一层、斜着一层，行距压到小于字号，
// 让行与行互相咬住，出来才是那种「满屏都是」的效果，而不是规整的字幕条。
// 每行只做水平位移（transform），全部交给合成器，不重排不重绘。
const DenseScene: React.FC = () => (
  <>
    <div className="wjw-wp-glow wjw-wp-glow-love" />

    <div className="wjw-wp-dense">
      {DENSE_ROWS.map((r, i) => (
        <div
          key={i}
          className={`wjw-wp-dense-row ${r.dir > 0 ? 'wjw-wp-dense-l' : 'wjw-wp-dense-r'}`}
          style={{
            top: r.top, fontSize: r.size, color: r.color,
            animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`,
          }}
        >
          {r.text}
        </div>
      ))}
    </div>

    <div className="wjw-wp-dense wjw-wp-dense-tilt">
      {DENSE_ROWS_B.map((r, i) => (
        <div
          key={i}
          className={`wjw-wp-dense-row ${r.dir > 0 ? 'wjw-wp-dense-l' : 'wjw-wp-dense-r'}`}
          style={{
            top: r.top, fontSize: r.size, color: r.color,
            animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`,
          }}
        >
          {r.text}
        </div>
      ))}
    </div>

    {/* 正中压一颗心，给这堆字一个焦点，不然满屏平铺没有落点 */}
    <div className="wjw-wp-center">
      <svg viewBox="0 0 480 300" width="100%" fill="none">
        <path d={HEART_D} stroke="#ff8fab" strokeWidth="4" />
        <text
          x="240" y="128" textAnchor="middle" dominantBaseline="middle"
          fill="#ffe4ec" fontSize="46" fontWeight="700" letterSpacing="4" fontFamily={CJK}
        >
          老婆爱你
        </text>
        <text
          x="240" y="186" textAnchor="middle" dominantBaseline="middle"
          fill="#ffd98e" fontSize="26" letterSpacing="3" fontFamily={SANS}
        >
          jwwu6
        </text>
      </svg>
    </div>
  </>
);

// ── 第三套：安心（慢慢来）────────────────────────────────────
const CalmScene: React.FC = () => (
  <>
    <div className="wjw-wp-glow wjw-wp-glow-calm" />

    {FIREFLIES.map((f, i) => (
      <div
        key={i}
        className="wjw-wp-fly"
        style={{ left: f.left, top: f.top, width: f.size, height: f.size, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }}
      />
    ))}

    {/* 视野高度给到 420：树 / 猫 / 两行字各占一段，谁也不压谁。
        之前 320 的视野里猫正好压在「慢慢来」上，还把第二行挤出了下边缘。 */}
    <div className="wjw-wp-center wjw-wp-center-sway wjw-wp-center-wide">
      <svg viewBox="0 0 480 420" width="100%" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* 一棵大树：树冠三团 + 主干分叉 */}
        <g stroke="#8fe3b8" strokeWidth="3">
          <circle cx="240" cy="86" r="60" />
          <circle cx="172" cy="124" r="45" />
          <circle cx="308" cy="124" r="45" />
          <path d="M240 156 v106" />
          <path d="M240 196 l-44 -32 M240 218 l46 -34" />
        </g>
        {/* 树下蜷着的猫：坐在树干根部，和文字之间留出整整一行的空隙 */}
        <g stroke="#ffd98e" strokeWidth="2.6" transform="translate(178 258) scale(1.9)">
          {PET_PATHS.catCurl}
        </g>
        <text x="240" y="368" textAnchor="middle" dominantBaseline="middle" fill="#d8fbe8" fontSize="38" letterSpacing="12" fontFamily={CJK}>
          慢慢来
        </text>
        <text x="240" y="404" textAnchor="middle" dominantBaseline="middle" fill="#8fe3b8" fontSize="23" letterSpacing="6" fontFamily={CJK}>
          一切都会好起来
        </text>
      </svg>
    </div>

    {/* 飘落的叶子 */}
    {Array.from({ length: 10 }, (_, i) => (
      <div
        key={i}
        className="wjw-wp-leaf"
        style={{
          left: `${(i * 11 + (i % 3) * 6 + 4) % 92}%`,
          top: `${(i * 9 + (i % 4) * 11) % 70}%`,
          width: 16 + ((i * 5) % 12),
          animationDuration: `${9 + ((i * 4) % 8)}s`,
          animationDelay: `-${(i * 2.7) % 10}s`,
        }}
      >
        <svg viewBox="0 0 64 64" width="100%" fill="none" stroke={i % 2 ? '#8fe3b8' : '#ffd98e'} strokeWidth="2.5">
          <path d="M32 8 q22 16 0 48 q-22 -32 0 -48 Z" />
          <path d="M32 14 v40" />
        </svg>
      </div>
    ))}
  </>
);

// ── 自定义图片 ──────────────────────────────────────────────
// cover 铺满、居中。不做任何动画：用户的图什么样就什么样，
// 平移缩放只会让人觉得「我的图被你改了」。
const CustomScene: React.FC<{ src: string }> = ({ src }) => (
  <div className="wjw-wp-img" style={{ backgroundImage: `url(${src})` }} />
);

export const TerminalWallpaper: React.FC<Props> = ({ variant = 'love', opacity }) => {
  const liveOpacity = useWallpaperOpacity();
  const customImg = useCustomWallpaperImage();
  const img = variant === 'custom' ? customImg : '';
  // 选了自定义却没有图（比如清掉了图片但选择还留着）就什么都不画，
  // 画个空壳会让人以为壁纸坏了
  if (variant === 'custom' && !img) return null;
  return (
    <div className={`wjw-wp wjw-wp-${variant}`} style={{ opacity: opacity ?? liveOpacity }} aria-hidden>
      {variant === 'custom' ? <CustomScene src={img} />
        : variant === 'dense' ? <DenseScene />
        : variant === 'calm' ? <CalmScene />
        : <LoveScene />}
    </div>
  );
};
