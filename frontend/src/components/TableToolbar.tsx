import React from 'react';
import { Button, Tooltip } from 'antd';
import { ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { palette } from '../theme';
import { useI18n } from '../i18n';

interface Props {
  /** 页标题：并入工具栏同一行，省掉独立的页标题横条（顶部本已有全局导航栏） */
  title?: string;
  /** 标题右侧的浅色说明；过长时收进 ⓘ 提示 */
  subtitle?: string;
  /** 标题前的小图标 */
  icon?: React.ReactNode;
  /** 左侧：主操作 + 批量操作按钮组 */
  left?: React.ReactNode;
  /** 右侧：搜索框 / 筛选器 */
  right?: React.ReactNode;
  /** 传入则在最右侧渲染刷新按钮 */
  onRefresh?: () => void;
  loading?: boolean;
  /** 已勾选行数：>0 时在左侧显示「已选 N 项」并给出清空入口 */
  selectedCount?: number;
  onClearSelection?: () => void;
}

// ─────────────────────────────────────────────────────────────
// 表格页统一工具栏（控制台风格）：
//   左：新建/批量操作 → 已选提示；右：筛选/搜索 → 刷新
// 位于页标题与表格之间，白底与表格同卡，不额外描边。
// ─────────────────────────────────────────────────────────────
export const TableToolbar: React.FC<Props> = ({
  title,
  subtitle,
  icon,
  left,
  right,
  onRefresh,
  loading,
  selectedCount = 0,
  onClearSelection,
}) => {
  const { text } = useI18n();
  return (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      padding: '12px 16px',
      background: palette.surface,
      borderBottom: `1px solid ${palette.border}`,
    }}
  >
    {title && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8, minWidth: 0 }}>
        {icon && <span style={{ color: palette.primary, fontSize: 15, display: 'inline-flex' }}>{icon}</span>}
        <span style={{ fontSize: 15, fontWeight: 500, color: palette.text, whiteSpace: 'nowrap' }}>{title}</span>
        {subtitle && (
          <Tooltip title={subtitle}>
            <InfoCircleOutlined style={{ color: palette.textMute, fontSize: 12, cursor: 'help' }} />
          </Tooltip>
        )}
        <span style={{ width: 1, height: 16, background: palette.border, marginLeft: 4 }} />
      </div>
    )}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{left}</div>

    {selectedCount > 0 && (
      <span style={{ fontSize: 13, color: palette.textSub, marginLeft: 4 }}>
        {text('common.itemsSelected', { count: selectedCount })}
        {onClearSelection && (
          <a onClick={onClearSelection} style={{ marginLeft: 8, fontSize: 12 }}>
            {text('common.clear')}
          </a>
        )}
      </span>
    )}

    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {right}
      {onRefresh && (
        <Tooltip title={text('common.refresh')}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh} />
        </Tooltip>
      )}
    </div>
  </div>
  );
};

/** 表格外层卡片：与工具栏共用一张白卡，表格自身不再重复描边 */
export const tablePanelStyle: React.CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  overflow: 'hidden',
};
