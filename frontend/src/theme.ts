// ─────────────────────────────────────────────────────────────
// Meridian · 设计令牌 (Design Tokens)
// 网络资产发现与统一接入平台 — 统一的品牌色板与 Antd 主题配置
// ─────────────────────────────────────────────────────────────
import type { CSSProperties } from 'react';

export const brand = {
  name: 'Meridian',
  zh: '子午',
  tagline: '网络资产发现与统一接入平台',
  version: 'v0.51',
  repo: 'https://github.com/',
} as const;

export const palette = {
  // 主色（靛蓝 → 紫罗兰 → 青）
  primary: '#6366f1',
  primaryHover: '#4f46e5',
  primaryDeep: '#4338ca',
  violet: '#8b5cf6',
  accent: '#06b6d4', // 青色——用于「发现 / 雷达」语义
  brandGradient: 'linear-gradient(135deg, #6366f1 0%, #7c5cfb 52%, #22d3ee 100%)',
  brandGradientSoft: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(34,211,238,0.12) 100%)',

  // 表面与背景（CSS 变量，随 data-theme 切换浅色/深色）
  bg: 'var(--mrd-bg)',
  surface: 'var(--mrd-surface)',
  border: 'var(--mrd-border)',
  borderStrong: 'var(--mrd-border-strong)',

  // 文本（CSS 变量，随 data-theme 切换浅色/深色）
  text: 'var(--mrd-text)',
  textSub: 'var(--mrd-text-sub)',
  textMute: 'var(--mrd-text-mute)',

  // 侧边栏（深空蓝）
  siderBg: '#0b1020',
  siderBg2: '#0d1426',
  siderBorder: '#1b2438',
  siderHover: '#161e33',
  siderActive: '#202a45',
  siderText: '#94a3b8',

  // 语义状态
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#0ea5e9',
} as const;

// 卡片通用样式（浅色面板）
export const cardStyle: CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 12,
  boxShadow: '0 1px 2px 0 rgba(15,23,42,0.04)',
};

// Antd 字体族（浅/深色共用）
const antdFontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';

// Antd ConfigProvider 主色令牌（浅色主题）
// 注意：antd 主题算法无法解析 CSS 变量 var(...)，因此这里使用字面 hex 值
export const antdLightToken = {
  colorPrimary: palette.primary,
  colorInfo: palette.primary,
  colorSuccess: palette.success,
  colorWarning: palette.warning,
  colorError: palette.danger,
  colorBgBase: '#f5f6fb',
  colorBgContainer: '#ffffff',
  colorBgLayout: '#f5f6fb',
  colorText: '#0f172a',
  colorTextDescription: '#475569',
  colorTextPlaceholder: '#808da2',
  colorBorder: '#e2e8f0',
  colorBorderSecondary: '#eef1f6',
  borderRadius: 8,
  fontFamily: antdFontFamily,
};

// Antd ConfigProvider 主色令牌（深色主题）
// 同样使用字面 hex 值；品牌主色与浅色保持一致
export const antdDarkToken = {
  colorPrimary: palette.primary,
  colorInfo: palette.primary,
  colorSuccess: palette.success,
  colorWarning: palette.warning,
  colorError: palette.danger,
  colorBgBase: '#0b1020',
  colorBgContainer: '#141b2d',
  colorBgLayout: '#0b1020',
  colorText: '#e2e8f0',
  colorTextDescription: '#94a3b8',
  colorBorder: '#26304a',
  colorBorderSecondary: '#1e2740',
  borderRadius: 8,
  fontFamily: antdFontFamily,
};
