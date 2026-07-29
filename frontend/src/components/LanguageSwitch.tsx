import React from 'react';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { CheckOutlined, GlobalOutlined } from '@ant-design/icons';
import { palette } from '../theme';
import { SUPPORTED_LOCALES, type LocaleCode, useI18n } from '../i18n';

interface Props {
  tone?: 'light' | 'dark';
}

export const LanguageSwitch: React.FC<Props> = ({ tone = 'dark' }) => {
  const { locale, setLocale, text } = useI18n();
  const onDark = tone === 'light';

  const items: MenuProps['items'] = SUPPORTED_LOCALES.map((item) => ({
    key: item.code,
    label: item.code === 'zh-CN' ? text('app.language.zhCN') : text('app.language.enUS'),
    icon: locale === item.code ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />,
  }));

  return (
    <Dropdown
      placement="bottomRight"
      menu={{ items, selectedKeys: [locale], onClick: ({ key }) => setLocale(key as LocaleCode) }}
      trigger={['click']}
    >
      <Tooltip title={text('app.language')}>
        <button
          type="button"
          className={onDark ? 'wjw-topnav-item' : undefined}
          style={{
            height: 30,
            minWidth: 30,
            padding: onDark ? '0 10px' : '0 9px',
            border: onDark ? 'none' : `1px solid ${palette.border}`,
            borderRadius: 4,
            background: onDark ? 'transparent' : palette.surface,
            color: onDark ? undefined : palette.textSub,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label={text('app.language')}
        >
          <GlobalOutlined style={{ fontSize: 15 }} />
        </button>
      </Tooltip>
    </Dropdown>
  );
};
