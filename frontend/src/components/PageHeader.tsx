import React from 'react';
import { palette } from '../theme';
import { UserMenu } from './UserMenu';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** 右侧操作区（按钮等） */
  extra?: React.ReactNode;
}

// 统一的页面头部：左侧渐变图标徽章 + 标题/副标题，右侧操作区
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, extra }) => {
  return (
    <div
      style={{
        background: palette.surface,
        padding: '20px 32px',
        borderBottom: `1px solid ${palette.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {icon && (
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 11,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 19,
              background: palette.brandGradient,
              boxShadow: '0 6px 16px -6px rgba(99,102,241,0.55)',
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: palette.text, letterSpacing: '-0.2px' }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: '3px 0 0 0', fontSize: 13, color: palette.textSub, lineHeight: 1.5 }}>{subtitle}</p>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {extra}
        <UserMenu />
      </div>
    </div>
  );
};
