import React, { useState } from 'react';
import { Dropdown, Avatar, Modal, Form, Input, message } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, LogoutOutlined, KeyOutlined } from '@ant-design/icons';
import { palette } from '../theme';
import { changePassword, errorMessage, logout } from '../services/api';
import { useI18n } from '../i18n';

interface ChangePasswordValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

interface UserMenuProps {
  /** light = 置于深色顶栏（白字透明底）；dark = 置于浅色页面（描边胶囊） */
  tone?: 'light' | 'dark';
}

// 当前用户菜单：显示登录用户名，提供修改密码、退出登录
export const UserMenu: React.FC<UserMenuProps> = ({ tone = 'dark' }) => {
  const { t, text } = useI18n();
  const user = localStorage.getItem('lynx-user') || 'admin';
  const onDark = tone === 'light';
  const [pwdOpen, setPwdOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ChangePasswordValues>();

  const handleLogout = async () => {
    try {
      await logout(); // 通知后端使会话 token 失效（尽力而为）
    } catch {
      // 忽略：即使后端不可达也要完成本地登出
    }
    localStorage.removeItem('lynx-auth');
    localStorage.removeItem('lynx-token');
    localStorage.removeItem('lynx-user');
    localStorage.removeItem('lynx-role');
    // 标记主动退出：桌面端据此不再自动登录，落到登录页可切换账户
    localStorage.setItem('lynx-logged-out', '1');
    window.location.reload(); // 重新加载后登录门禁会拦截到登录页
  };

  const handleChangePassword = async (values: ChangePasswordValues) => {
    try {
      setSaving(true);
      await changePassword(user, values.oldPassword, values.newPassword);
      message.success(text('password.changeSuccess'));
      setPwdOpen(false);
      form.resetFields();
    } catch (e: unknown) {
      message.error(errorMessage(e) || text('password.changeFailed'));
    } finally {
      setSaving(false);
    }
  };

  const items: MenuProps['items'] = [
    {
      key: 'user',
      disabled: true,
      label: (
        <span style={{ color: palette.textSub }}>
          {t('user.current', { user: <b style={{ color: palette.text }}>{user}</b> })}
        </span>
      ),
    },
    { type: 'divider' },
    { key: 'change-password', icon: <KeyOutlined />, label: text('user.changePassword') },
    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: text('user.logout') },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') handleLogout();
    if (key === 'change-password') setPwdOpen(true);
  };

  return (
    <>
      <Dropdown menu={{ items, onClick }} placement="bottomRight" trigger={['click']}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: onDark ? '4px 10px 4px 6px' : '4px 10px 4px 4px',
            borderRadius: onDark ? 4 : 999,
            border: onDark ? '1px solid transparent' : `1px solid ${palette.border}`,
            background: onDark ? 'transparent' : palette.surface,
          }}
        >
          <Avatar size={24} style={{ background: palette.brandGradient, flexShrink: 0 }} icon={<UserOutlined />} />
          <span style={{ fontSize: 13, fontWeight: 500, color: onDark ? '#e6eaf0' : palette.text }}>{user}</span>
        </span>
      </Dropdown>

      <Modal
        title={<span><KeyOutlined style={{ marginRight: 8, color: palette.primary }} />{text('user.changePassword')}</span>}
        open={pwdOpen}
        onCancel={() => { setPwdOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={text('password.confirmChange')}
        cancelText={text('common.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleChangePassword} style={{ marginTop: 12 }}>
          <Form.Item
            label={text('password.old')}
            name="oldPassword"
            rules={[{ required: true, message: text('password.old.required') }]}
          >
            <Input.Password placeholder={text('password.old.placeholder')} autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label={text('password.new')}
            name="newPassword"
            rules={[
              { required: true, message: text('password.new.required') },
              { min: 6, max: 64, message: text('login.password.length') },
            ]}
          >
            <Input.Password placeholder={text('password.new.placeholder')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label={text('password.confirmNew')}
            name="confirm"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: text('password.confirmNew.required') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error(text('login.confirmPassword.mismatch')));
                },
              }),
            ]}
          >
            <Input.Password placeholder={text('password.confirmNew.placeholder')} autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
