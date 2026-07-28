import React, { useRef } from 'react';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { SearchOutlined, DownOutlined, QuestionCircleOutlined, GithubOutlined } from '@ant-design/icons';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { brand, palette, HEADER_H } from '../theme';
import { fireEasterEgg } from './EasterEgg';

export interface HeaderNavItem {
  key: string;
  label: string;
  /** 有 children 则渲染为下拉菜单，无则为直接跳转项 */
  children?: { key: string; label: string; icon?: React.ReactNode }[];
}

interface Props {
  items: HeaderNavItem[];
  /** 当前选中的路由 key，用于高亮所属顶级项 */
  activeKey: string;
  onNavigate: (path: string) => void;
  /** 打开快捷键帮助 */
  onHelp?: () => void;
  /** 左侧栏当前宽度：品牌区与之等宽，保证两条竖直分界线对齐 */
  siderWidth: number;
  /** 侧栏是否收起：收起时品牌区改用固定窄宽、不再跟着塌到 64px */
  siderCollapsed?: boolean;
}

/** 侧栏收起时品牌区的固定宽度：容得下「徽标 + WJW」字标，且不跟侧栏等宽 */
const BRAND_W_COLLAPSED = 152;

// ─────────────────────────────────────────────────────────────
// 全局顶栏（对齐公有云控制台）：
//   左：品牌 → 一级导航（下拉展开二级）
//   右：全局搜索 → 帮助/源码 → 账号菜单
// 深色底 + 白字，是全站唯一的深色区块，用来压住页面顶部。
// ─────────────────────────────────────────────────────────────
export const AppHeader: React.FC<Props> = ({ items, activeKey, onNavigate, onHelp, siderWidth, siderCollapsed }) => {
  const isActive = (it: HeaderNavItem) =>
    it.children ? it.children.some((c) => c.key === activeKey) : it.key === activeKey;

  // 徽标连点计数：2 秒内点满 5 次放彩蛋，其余情况照常回总览
  const clicksRef = useRef<number[]>([]);
  const onBrandClick = () => {
    const now = Date.now();
    clicksRef.current = [...clicksRef.current, now].filter((t) => now - t < 2000);
    if (clicksRef.current.length >= 5) {
      clicksRef.current = [];
      fireEasterEgg();
      return;
    }
    onNavigate('/');
  };

  return (
    <div
      style={{
        height: HEADER_H,
        flexShrink: 0,
        background: palette.headerBg,
        borderBottom: `1px solid ${palette.headerBorder}`,
        display: 'flex',
        alignItems: 'center',
        paddingRight: 12,
        position: 'relative',
        zIndex: 120,
      }}
    >
      {/* 品牌区：展开时与侧栏等宽、共用同一条竖直分界线，左上角是一条完整色带。
          侧栏收起后若也跟着缩到 64px，这里就只剩一个被竖线框住的孤零零图标，
          左上角凭空多出个方块、字标也没了——所以收起时改为固定窄宽 + 保留字标 +
          不画竖线，让顶栏保持连续的一条。 */}
      <div
        style={{
          width: siderCollapsed ? BRAND_W_COLLAPSED : siderWidth,
          flexShrink: 0,
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: siderCollapsed ? '0 12px 0 14px' : '0 12px 0 16px',
          borderRight: siderCollapsed ? 'none' : `1px solid ${palette.headerBorder}`,
          cursor: 'pointer',
          transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
        }}
        onClick={onBrandClick}
      >
        <Logo size={26} tone="light" />
      </div>

      {/* 一级导航 */}
      <nav style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
        {items.map((it) =>
          it.children ? (
            <Dropdown
              key={it.key}
              placement="bottomLeft"
              menu={{
                items: it.children.map((c) => ({ key: c.key, label: c.label, icon: c.icon })) as MenuProps['items'],
                onClick: ({ key }) => onNavigate(key),
                selectedKeys: [activeKey],
              }}
            >
              <button type="button" className={`lynx-topnav-item${isActive(it) ? ' is-active' : ''}`}>
                {it.label}
                <DownOutlined style={{ fontSize: 10, opacity: 0.7 }} />
              </button>
            </Dropdown>
          ) : (
            <button
              key={it.key}
              type="button"
              className={`lynx-topnav-item${isActive(it) ? ' is-active' : ''}`}
              onClick={() => onNavigate(it.key)}
            >
              {it.label}
            </button>
          ),
        )}
      </nav>

      <div style={{ flex: 1, minWidth: 12 }} />

      {/* 全局搜索：点开与 Ctrl+K 同一个面板 */}
      <div
        onClick={() => window.dispatchEvent(new Event('lynx-open-search'))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 30,
          width: 210,
          padding: '0 10px',
          marginRight: 8,
          borderRadius: 4,
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.62)',
          fontSize: 13,
        }}
      >
        <SearchOutlined />
        <span style={{ flex: 1 }}>搜索资产 / 页面</span>
        <span style={{ fontSize: 11, opacity: 0.75, fontFamily: 'monospace' }}>Ctrl K</span>
      </div>

      <Tooltip title="快捷键帮助">
        <button type="button" className="lynx-topnav-item" style={{ padding: '0 10px' }} onClick={onHelp}>
          <QuestionCircleOutlined style={{ fontSize: 15 }} />
        </button>
      </Tooltip>
      <Tooltip title="项目源码">
        <a
          href={brand.repo}
          target="_blank"
          rel="noreferrer"
          className="lynx-topnav-item"
          style={{ padding: '0 10px' }}
        >
          <GithubOutlined style={{ fontSize: 15 }} />
        </a>
      </Tooltip>

      <div style={{ marginLeft: 6 }}>
        <UserMenu tone="light" />
      </div>
    </div>
  );
};
