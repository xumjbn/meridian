import React from 'react';
import { brand, palette } from '../theme';

// ─────────────────────────────────────────────────────────────
// Lynx Logo —— wjw 字母组合徽标
// 圆角徽章 + 手写感 wjw 连写（圆头描边，小尺寸不糊）；j 的点做成小心形。
// 32×32 网格：左右各留 5.2 边距居中，字母 x 高区间 y=13.5~20.5。
// ─────────────────────────────────────────────────────────────

// 单个 w 的折线（起点 x 为左端，宽 7.6）
const wPath = (x: number) =>
  `M${x},13.5 L${x + 1.9},20.5 L${x + 3.8},16.2 L${x + 5.7},20.5 L${x + 7.6},13.5`;

interface LogoMarkProps {
  size?: number;
  /** badge: 渐变圆角徽标内嵌白色 wjw | glyph: 透明背景渐变 wjw */
  variant?: 'badge' | 'glyph';
  style?: React.CSSProperties;
}

let gradSeq = 0;

export const LogoMark: React.FC<LogoMarkProps> = ({ size = 32, variant = 'badge', style }) => {
  // 每个实例独立 gradient id，避免 SVG defs 冲突
  const gid = React.useMemo(() => `lx-grad-${gradSeq++}`, []);
  const badge = variant === 'badge';
  const grad = `url(#${gid})`;
  const ink = badge ? '#ffffff' : grad; // 字母与心形着色：徽章内用白，透明态用渐变

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="wjw"
    >
      <defs>
        <linearGradient id={gid} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#006eff" />
          <stop offset="0.55" stopColor="#0a8bff" />
          <stop offset="1" stopColor="#00a4ff" />
        </linearGradient>
      </defs>

      {badge && <rect x="0" y="0" width="32" height="32" rx="8.5" fill={grad} />}

      {/* wjw 连写：两个 w 夹一个 j，全部圆头描边 */}
      <g stroke={ink} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d={wPath(5.2)} />
        {/* j：竖笔 + 左下回勾 */}
        <path d="M15.8,13.5 L15.8,19.2 C15.8,21.2 14.4,21.9 13.2,21.2" />
        <path d={wPath(19.2)} />
      </g>

      {/* j 的点做成小心形 */}
      <path
        d="M15.8,10.8 C14.4,9.7 13.6,9.0 13.6,8.2 C13.6,7.5 14.2,7.0 14.8,7.0 C15.3,7.0 15.65,7.3 15.8,7.6 C15.95,7.3 16.3,7.0 16.8,7.0 C17.4,7.0 18.0,7.5 18.0,8.2 C18.0,9.0 17.2,9.7 15.8,10.8 Z"
        fill={ink}
      />
    </svg>
  );
};

interface LogoProps {
  size?: number;
  /** 是否仅显示徽标（折叠态） */
  collapsed?: boolean;
  /** 文字颜色基调：light 用于深色侧栏 */
  tone?: 'light' | 'dark';
}

export const Logo: React.FC<LogoProps> = ({ size = 34, collapsed = false, tone = 'light' }) => {
  // light = 置于深色底（顶栏）：文字用纯白，保证对比度；dark = 置于浅色底
  const onDark = tone === 'light';
  const titleColor = onDark ? '#ffffff' : palette.text;
  const subColor = onDark ? 'rgba(255,255,255,0.55)' : palette.textMute;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <LogoMark size={size} />
      {!collapsed && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.2px', color: titleColor }}>
            {brand.name}
          </span>
          <span style={{ fontSize: 12, color: subColor, whiteSpace: 'nowrap' }}>控制台</span>
        </div>
      )}
    </div>
  );
};
