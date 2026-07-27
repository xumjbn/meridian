import React from 'react';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { SearchOutlined, DownOutlined, QuestionCircleOutlined, GithubOutlined } from '@ant-design/icons';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { brand, palette, HEADER_H } from '../theme';

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
}

// ─────────────────────────────────────────────────────────────
// 全局顶栏（对齐公有云控制台）：
//   左：品牌 → 一级导航（下拉展开二级）
//   右：全局搜索 → 帮助/源码 → 账号菜单
// 深色底 + 白字，是全站唯一的深色区块，用来压住页面顶部。
// ─────────────────────────────────────────────────────────────
export const AppHeader: React.FC<Props> = ({ items, activeKey, onNavigate, onHelp }) => {
  const isActive = (it: HeaderNavItem) =>
    it.children ? it.children.some((c) => c.key === activeKey) : it.key === activeKey;

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
      {/* 品牌 */}
      <div
        style={{ display: 'flex', alignItems: 'center', padding: '0 20px 0 16px', cursor: 'pointer' }}
        onClick={() => onNavigate('/')}
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
              <button type="button" className={`mrd-topnav-item${isActive(it) ? ' is-active' : ''}`}>
                {it.label}
                <DownOutlined style={{ fontSize: 10, opacity: 0.7 }} />
              </button>
            </Dropdown>
          ) : (
            <button
              key={it.key}
              type="button"
              className={`mrd-topnav-item${isActive(it) ? ' is-active' : ''}`}
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
        onClick={() => window.dispatchEvent(new Event('mrd-open-search'))}
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
        <button type="button" className="mrd-topnav-item" style={{ padding: '0 10px' }} onClick={onHelp}>
          <QuestionCircleOutlined style={{ fontSize: 15 }} />
        </button>
      </Tooltip>
      <Tooltip title="项目源码">
        <a
          href={brand.repo}
          target="_blank"
          rel="noreferrer"
          className="mrd-topnav-item"
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
