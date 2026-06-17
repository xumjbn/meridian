import React from 'react';
import { Dropdown, Avatar } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, LogoutOutlined } from '@ant-design/icons';
import { palette } from '../theme';

// 右上角当前用户菜单：显示登录用户名，提供退出登录
export const UserMenu: React.FC = () => {
  const user = localStorage.getItem('mrd-user') || 'admin';

  const handleLogout = () => {
    localStorage.removeItem('mrd-auth');
    localStorage.removeItem('mrd-user');
    window.location.reload(); // 重新加载后登录门禁会拦截到登录页
  };

  const items: MenuProps['items'] = [
    {
      key: 'user',
      disabled: true,
      label: (
        <span style={{ color: palette.textSub }}>
          当前用户：<b style={{ color: palette.text }}>{user}</b>
        </span>
      ),
    },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: '退出登录' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') handleLogout();
  };

  return (
    <Dropdown menu={{ items, onClick }} placement="bottomRight" trigger={['click']}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          padding: '4px 10px 4px 4px',
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: palette.surface,
        }}
      >
        <Avatar size={28} style={{ background: palette.brandGradient, flexShrink: 0 }} icon={<UserOutlined />} />
        <span style={{ fontSize: 13, fontWeight: 600, color: palette.text }}>{user}</span>
      </span>
    </Dropdown>
  );
};
