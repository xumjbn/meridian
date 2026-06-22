import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette, cardStyle } from '../theme';
import { changePassword } from '../services/api';

interface Props {
  onDone: () => void;
}

interface Values {
  newPassword: string;
  confirm: string;
}

// 首次登录（默认账号）强制修改密码页：在改密成功前无法进入系统
export const ForcePasswordChange: React.FC<Props> = ({ onDone }) => {
  const [loading, setLoading] = useState(false);
  const user = localStorage.getItem('mrd-user') || 'admin';

  const handleFinish = async (values: Values) => {
    setLoading(true);
    try {
      // 强制改密场景后端免校验原密码，这里传空字符串即可
      await changePassword(user, '', values.newPassword);
      localStorage.removeItem('mrd-must-change');
      message.success('密码修改成功');
      onDone();
    } catch (e: any) {
      message.error(e?.message || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: palette.brandGradient,
      }}
    >
      <div
        className="mrd-fade-up"
        style={{ ...cardStyle, background: '#fff', width: 400, maxWidth: '100%', padding: '36px 32px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
          <LogoMark size={48} />
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 14, color: palette.text }}>
            <SafetyOutlined style={{ marginRight: 8, color: palette.primary }} />
            首次登录，请修改密码
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
            当前账号 <b>{user}</b> 仍在使用默认密码，出于安全考虑请先设置新密码
          </div>
        </div>

        <Form<Values> layout="vertical" requiredMark={false} onFinish={handleFinish}>
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 64, message: '密码长度需为 6–64 个字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="6–64 位新密码" size="large" autoComplete="new-password" />
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
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="再次输入新密码" size="large" autoComplete="new-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              设置新密码并进入系统
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default ForcePasswordChange;
