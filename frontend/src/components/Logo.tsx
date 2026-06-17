import React from 'react';
import { brand, palette } from '../theme';

// ─────────────────────────────────────────────────────────────
// Meridian Logo
// 「星座 / 中枢」标识：中心平台节点 + 轨道环 + 三个被发现的卫星节点
// 寓意：发现(radar) → 测绘(meridian) → 接入(connect)
// ─────────────────────────────────────────────────────────────

interface LogoMarkProps {
  size?: number;
  /** badge: 渐变圆角徽标内嵌白色描线 | glyph: 透明背景渐变描线 */
  variant?: 'badge' | 'glyph';
  style?: React.CSSProperties;
}

let gradSeq = 0;

export const LogoMark: React.FC<LogoMarkProps> = ({ size = 32, variant = 'badge', style }) => {
  // 每个实例独立 gradient id，避免 SVG defs 冲突
  const gid = React.useMemo(() => `mrd-grad-${gradSeq++}`, []);
  const badge = variant === 'badge';
  const strokeColor = badge ? '#ffffff' : `url(#${gid})`;

  // 轨道半径 9.5，三颗卫星位于 90° / 210° / 330°
  const nodes = [
    { x: 16, y: 6.5 },
    { x: 7.77, y: 20.75 },
    { x: 24.23, y: 20.75 },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="Meridian"
    >
      <defs>
        <linearGradient id={gid} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#7c5cfb" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>

      {badge && <rect x="0" y="0" width="32" height="32" rx="8.5" fill={`url(#${gid})`} />}

      {/* 轨道环 */}
      <circle cx="16" cy="16" r="9.5" stroke={strokeColor} strokeWidth="1.5" opacity={badge ? 0.92 : 0.85} />

      {/* 中心 → 卫星 连线 */}
      <g stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" opacity={badge ? 0.8 : 0.7}>
        {nodes.map((n, i) => (
          <line key={i} x1="16" y1="16" x2={n.x} y2={n.y} />
        ))}
      </g>

      {/* 中心平台节点 */}
      <circle cx="16" cy="16" r="3.3" fill={badge ? '#ffffff' : `url(#${gid})`} />

      {/* 被发现的卫星节点 */}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r="2.15" fill={badge ? '#ffffff' : `url(#${gid})`} />
      ))}
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
