import React from 'react';
import { brand, palette } from '../theme';

// ─────────────────────────────────────────────────────────────
// Lynx Logo（猞猁）
// 尖耳簇毛 + 颊毛锯齿 + 杏仁眼的猞猁头部剪影
// 寓意：锐利目光 / 夜视 / 机警 —— 发现(scan) → 监控(watch) → 接入(connect)
// ─────────────────────────────────────────────────────────────

interface LogoMarkProps {
  size?: number;
  /** badge: 渐变圆角徽标内嵌白色猞猁 | glyph: 透明背景渐变猞猁 */
  variant?: 'badge' | 'glyph';
  style?: React.CSSProperties;
}

let gradSeq = 0;

export const LogoMark: React.FC<LogoMarkProps> = ({ size = 32, variant = 'badge', style }) => {
  // 每个实例独立 gradient id，避免 SVG defs 冲突
  const gid = React.useMemo(() => `lx-grad-${gradSeq++}`, []);
  const badge = variant === 'badge';
  const grad = `url(#${gid})`;
  const body = badge ? '#ffffff' : grad;       // 猞猁本体填充
  const knock = badge ? grad : '#ffffff';      // 眼/鼻镂空填充

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="Lynx 猞猁"
    >
      <defs>
        <linearGradient id={gid} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#7c5cfb" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>

      {badge && <rect x="0" y="0" width="32" height="32" rx="8.5" fill={grad} />}

      {/* 猞猁头部剪影 */}
      <g fill={body}>
        <path d="M8.6 12.2 L10.6 5.2 L10.7 3.2 L11.7 5.6 L13.6 11.4 Z" />
        <path d="M23.4 12.2 L21.4 5.2 L21.3 3.2 L20.3 5.6 L18.4 11.4 Z" />
        <path d="M16 10.0 C 12.7 10.0, 10.2 11.7, 9.5 14.4 L 7.3 15.0 L 9.0 16.4 C 9.2 18.7, 10.6 20.9, 12.5 22.4 L 11.6 24.8 L 13.9 23.6 C 14.5 24.0, 15.2 24.3, 16 24.3 C 16.8 24.3, 17.5 24.0, 18.1 23.6 L 20.4 24.8 L 19.5 22.4 C 21.4 20.9, 22.8 18.7, 23.0 16.4 L 24.7 15.0 L 22.5 14.4 C 21.8 11.7, 19.3 10.0, 16 10.0 Z" />
      </g>

      {/* 眼睛 + 鼻子 */}
      <g fill={knock}>
        <path d="M11.7 15.6 C 12.4 14.9, 13.6 14.9, 14.3 15.5 C 13.6 16.4, 12.4 16.4, 11.7 15.6 Z" />
        <path d="M20.3 15.6 C 19.6 14.9, 18.4 14.9, 17.7 15.5 C 18.4 16.4, 19.6 16.4, 20.3 15.6 Z" />
        <path d="M16 18.2 L 14.8 19.4 L 16 20.1 L 17.2 19.4 Z" />
      </g>
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
  const subColor = tone === 'light' ? 'rgba(148,163,184,0.85)' : palette.textSub;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <LogoMark size={size} />
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '0.2px',
              background: palette.brandGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {brand.name}
          </span>
          <span style={{ fontSize: 10.5, color: subColor, marginTop: 2, whiteSpace: 'nowrap' }}>
            {brand.zh} · 资产中枢
          </span>
        </div>
      )}
    </div>
  );
};
