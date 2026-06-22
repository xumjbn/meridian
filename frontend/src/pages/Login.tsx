import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { brand, palette, cardStyle } from '../theme';
import { login, registerUser } from '../services/api';

interface LoginProps {
  onSuccess: () => void;
}

interface LoginValues {
  username: string;
  password: string;
  confirm?: string;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form] = Form.useForm<LoginValues>();

  const handleFinish = async (values: LoginValues) => {
    setLoading(true);
    try {
      if (mode === 'register') {
        await registerUser(values.username, values.password);
        message.success('注册成功，请使用新账号登录');
        setMode('login');
        form.setFieldsValue({ password: '', confirm: '' });
        return;
      }
      const res = await login(values.username, values.password);
      localStorage.setItem('mrd-auth', '1');
      localStorage.setItem('mrd-token', res.token || '');
      localStorage.setItem('mrd-user', res.username || values.username);
      localStorage.setItem('mrd-role', res.role || 'admin');
      onSuccess();
    } catch (e: any) {
      message.error(e?.message || (mode === 'register' ? '注册失败' : '用户名或密码错误'));
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
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ username: mode === 'login' ? 'admin' : '' }}
          onFinish={handleFinish}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              ...(mode === 'register' ? [{ min: 3, max: 32, message: '用户名长度需为 3–32 个字符' }] : []),
            ]}
          >
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="用户名" size="large" autoComplete="username" />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              ...(mode === 'register' ? [{ min: 6, max: 64, message: '密码长度需为 6–64 个字符' }] : []),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="密码"
              size="large"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </Form.Item>

          {mode === 'register' && (
            <Form.Item
              label="确认密码"
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                placeholder="确认密码"
                size="large"
                autoComplete="new-password"
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              {mode === 'register' ? '注册' : '登录'}
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          {mode === 'login' ? (
            <>
              还没有账号？
              <a
                onClick={() => { setMode('register'); form.setFieldsValue({ username: '', password: '', confirm: '' }); }}
                style={{ color: palette.primary, fontWeight: 500 }}
              >
                注册新账号
              </a>
              <div style={{ marginTop: 6 }}>默认账号 admin / admin</div>
            </>
          ) : (
            <>
              已有账号？
              <a
                onClick={() => { setMode('login'); form.setFieldsValue({ username: 'admin', password: '', confirm: '' }); }}
                style={{ color: palette.primary, fontWeight: 500 }}
              >
                返回登录
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
