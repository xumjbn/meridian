import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { palette } from '../theme';

interface PageHeaderProps {
  title: string;
  /** 副标题：作为标题右侧的浅色说明文字（过长时收进 ⓘ 提示） */
  subtitle?: string;
  /** 标题左侧小图标（可选，控制台风格只做点缀不做徽章） */
  icon?: React.ReactNode;
  /** 右侧操作区（按钮等） */
  extra?: React.ReactNode;
}

// 统一页标题栏（控制台风格）：白底、单行、左标题右操作，尽量少占垂直空间
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, extra }) => {
  const longSub = !!subtitle && subtitle.length > 28;
  return (
    <div
      style={{
        background: palette.surface,
        padding: '0 20px',
        height: 52,
        borderBottom: `1px solid ${palette.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 500,
            color: palette.text,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          {icon && <span style={{ color: palette.primary, fontSize: 16, display: 'inline-flex' }}>{icon}</span>}
          {title}
        </h1>
        {subtitle &&
          (longSub ? (
            <Tooltip title={subtitle}>
              <InfoCircleOutlined style={{ color: palette.textMute, fontSize: 13, cursor: 'help' }} />
            </Tooltip>
          ) : (
            <span style={{ fontSize: 12.5, color: palette.textMute, whiteSpace: 'nowrap' }}>{subtitle}</span>
          ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{extra}</div>
    </div>
  );
};
