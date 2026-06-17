import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { brand, palette, cardStyle } from '../theme';
import { login } from '../services/api';

interface LoginProps {
  onSuccess: () => void;
}

interface LoginValues {
  username: string;
  password: string;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);

  const handleFinish = async (values: LoginValues) => {
    setLoading(true);
    try {
      const res = await login(values.username, values.password);
      localStorage.setItem('mrd-auth', '1');
      localStorage.setItem('mrd-user', res.username || values.username);
      onSuccess();
    } catch {
      message.error('用户名或密码错误');
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
        style={{
          ...cardStyle,
          background: '#ffffff',
          width: 380,
          maxWidth: '100%',
          padding: '36px 32px',
          boxShadow: '0 24px 60px -20px rgba(15,23,42,0.45)',
        }}
      >
        {/* 品牌区 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <LogoMark size={52} />
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '0.2px',
              marginTop: 14,
              background: palette.brandGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {brand.name}
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6 }}>{brand.tagline}</div>
        </div>

        <Form<LoginValues>
          layout="vertical"
          requiredMark={false}
          initialValues={{ username: 'admin' }}
          onFinish={handleFinish}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="用户名" size="large" autoComplete="username" />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="密码"
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          默认账号 admin / admin
        </div>
      </div>
    </div>
  );
};

export default Login;
