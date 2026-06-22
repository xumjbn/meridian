import React, { useState } from 'react';
import { Dropdown, Avatar, Modal, Form, Input, message } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, LogoutOutlined, KeyOutlined } from '@ant-design/icons';
import { palette } from '../theme';
import { changePassword, logout } from '../services/api';

interface ChangePasswordValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

// 右上角当前用户菜单：显示登录用户名，提供修改密码、退出登录
export const UserMenu: React.FC = () => {
  const user = localStorage.getItem('mrd-user') || 'admin';
  const [pwdOpen, setPwdOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ChangePasswordValues>();

  const handleLogout = async () => {
    try {
      await logout(); // 通知后端使会话 token 失效（尽力而为）
    } catch {
      // 忽略：即使后端不可达也要完成本地登出
    }
    localStorage.removeItem('mrd-auth');
    localStorage.removeItem('mrd-token');
    localStorage.removeItem('mrd-user');
    localStorage.removeItem('mrd-role');
    window.location.reload(); // 重新加载后登录门禁会拦截到登录页
  };

  const handleChangePassword = async (values: ChangePasswordValues) => {
    try {
      setSaving(true);
      await changePassword(user, values.oldPassword, values.newPassword);
      message.success('密码修改成功');
      setPwdOpen(false);
      form.resetFields();
    } catch (e: any) {
      message.error(e?.message || '修改失败');
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
          当前用户：<b style={{ color: palette.text }}>{user}</b>
        </span>
      ),
    },
    { type: 'divider' },
    { key: 'change-password', icon: <KeyOutlined />, label: '修改密码' },
    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: '退出登录' },
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

      <Modal
        title={<span><KeyOutlined style={{ marginRight: 8, color: palette.primary }} />修改密码</span>}
        open={pwdOpen}
        onCancel={() => { setPwdOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="确认修改"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleChangePassword} style={{ marginTop: 12 }}>
          <Form.Item
            label="原密码"
            name="oldPassword"
            rules={[{ required: true, message: '请输入原密码' }]}
          >
            <Input.Password placeholder="当前登录密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 64, message: '密码长度需为 6–64 个字符' },
            ]}
          >
            <Input.Password placeholder="6–64 位新密码" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
