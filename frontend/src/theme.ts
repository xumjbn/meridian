// ─────────────────────────────────────────────────────────────
// wjw · 设计令牌 (Design Tokens)
// 网络资产发现与统一接入平台 — 控制台风格色板与 Antd 主题配置
//
// 视觉基调对齐主流公有云控制台（腾讯云 CVM）：
//   深色全局顶栏 + 白色左侧菜单 + 浅灰内容底 + 蓝色主色 + 小圆角紧凑密度。
// ─────────────────────────────────────────────────────────────
import type { CSSProperties } from 'react';

export const brand = {
  name: 'wjw',
  zh: 'wjw',
  tagline: '网络资产发现与统一接入平台',
  version: 'v1.0.13',
  repo: 'https://github.com/xumjbn/meridian',
} as const;

export const palette = {
  // 主色（控制台蓝）
  primary: '#006eff',
  primaryHover: '#1a7dff',
  primaryDeep: '#0052d9',
  primaryBg: '#e7f0ff', // 选中项/浅色底
  primaryBorder: '#bcd8ff',
  violet: '#7b61ff',
  accent: '#00a4ff', // 青蓝——用于「发现 / 雷达」语义
  brandGradient: 'linear-gradient(135deg, #006eff 0%, #00a4ff 100%)',
  brandGradientSoft: 'linear-gradient(135deg, rgba(0,110,255,0.10) 0%, rgba(0,164,255,0.10) 100%)',

  // 表面与背景（CSS 变量，随 data-theme 切换浅色/深色）
  bg: 'var(--wjw-bg)',
  surface: 'var(--wjw-surface)',
  border: 'var(--wjw-border)',
  borderStrong: 'var(--wjw-border-strong)',

  // 文本（CSS 变量，随 data-theme 切换浅色/深色）
  text: 'var(--wjw-text)',
  textSub: 'var(--wjw-text-sub)',
  textMute: 'var(--wjw-text-mute)',

  // ── 深色外壳（顶栏 / 侧栏 / 终端共用同一套色阶）────────────
  // 同一蓝黑色族按明度递进：终端内容最深 → 外壳次之 → 悬浮/选中提亮，
  // 保证「顶栏 + 侧栏 + 终端」连成一片，不再出现两种打架的黑。
  chromeBg: '#0f1420',       // 外壳主色（顶栏与侧栏同色）
  chromeBgDeep: '#0b0f19',   // 最深：终端内容区
  chromeBorder: '#1c2333',
  chromeHover: '#182034',
  chromeActive: '#1d2740',
  chromeText: '#a8b3c4',
  chromeTextStrong: '#f1f5f9',
  chromeTextMute: '#6b7789',

  // 全局顶栏
  headerBg: '#0f1420',
  headerBg2: '#131926',
  headerBorder: '#1c2333',
  headerText: '#a8b3c4',
  headerTextStrong: '#ffffff',
  headerHover: 'rgba(255,255,255,0.08)',
  headerActive: 'rgba(255,255,255,0.13)',

  // 左侧菜单（与顶栏同色的深色）
  siderBg: '#0f1420',
  siderBg2: '#0f1420',
  siderBorder: '#1c2333',
  siderHover: '#182034',
  siderActive: '#1d2740',
  siderText: '#a8b3c4',
  siderTextActive: '#4da3ff',

  // 语义状态
  success: '#00a870',
  warning: '#ed7b2f',
  danger: '#e34d59',
  info: '#006eff',
} as const;

/** 全局顶栏高度（内容区据此让位） */
export const HEADER_H = 44;

// 卡片通用样式（控制台面板：白底、细边、小圆角、几乎无阴影）
export const cardStyle: CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  boxShadow: '0 1px 2px 0 rgba(15,23,42,0.03)',
};

/** 页面内容区统一内边距（工具栏/表格/卡片外层） */
export const pagePadding = '16px 20px 24px';

// Antd 字体族（浅/深色共用）
// 与 index.css 的 :root 保持同一条链。两处都要改：antd 组件（输入框、表格、
// 下拉…）用的是这里的 token，不继承 :root——左侧搜索框就是 antd Input。
// 'DengXian Light' 排在 'Microsoft YaHei' 之前的理由见 index.css 处的注释。
const antdFontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "DengXian Light", "Microsoft YaHei", Arial, sans-serif';

// Antd ConfigProvider 主色令牌（浅色主题）
// 注意：antd 主题算法无法解析 CSS 变量 var(...)，因此这里使用字面 hex 值
export const antdLightToken = {
  colorPrimary: palette.primary,
  colorInfo: palette.primary,
  colorSuccess: palette.success,
  colorWarning: palette.warning,
  colorError: palette.danger,
  colorBgBase: '#f0f2f5',
  colorBgContainer: '#ffffff',
  colorBgLayout: '#f0f2f5',
  colorText: '#1c2028',
  colorTextDescription: '#5c6b7f',
  colorTextPlaceholder: '#9aa5b5',
  colorBorder: '#dcdfe6',
  colorBorderSecondary: '#e9ecf2',
  borderRadius: 4,
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
  borderRadius: 4,
  fontFamily: antdFontFamily,
};

/** Antd 组件级令牌：统一控制台的紧凑密度与小圆角 */
export const antdComponents = {
  Button: { controlHeight: 32, borderRadius: 4, fontWeight: 400, primaryShadow: 'none' },
  Table: {
    headerBg: '#fafbfc',
    headerColor: '#4c5a67',
    headerBorderRadius: 0,
    rowHoverBg: '#f4f8ff',
    borderColor: '#e9ecf2',
    cellPaddingBlock: 11,
    cellPaddingInline: 14,
    headerSplitColor: 'transparent',
  },
  Card: { borderRadiusLG: 6 },
  Modal: { borderRadiusLG: 6 },
  Drawer: { colorBgElevated: '#ffffff' },
  Segmented: { borderRadius: 4 },
  Input: { borderRadius: 4 },
  Select: { borderRadius: 4 },
  Tabs: { horizontalItemPadding: '10px 0', horizontalMargin: '0 0 12px 0' },
  Tag: { borderRadiusSM: 3 },
};
