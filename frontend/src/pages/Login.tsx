import React, { useState } from 'react';
import { Form, Input, Button, Tabs, message } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, ThunderboltOutlined, ClusterOutlined } from '@ant-design/icons';
import { LogoMark, LogoWordmark } from '../components/Logo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { brand, palette } from '../theme';
import { errorMessage, login, registerUser } from '../services/api';
import { useI18n } from '../i18n';

interface LoginProps {
  onSuccess: () => void;
}

interface LoginValues {
  username: string;
  password: string;
  confirm?: string;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const { text } = useI18n();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form] = Form.useForm<LoginValues>();
  // 左侧品牌区的能力点（控制台登录页惯例：产品价值三连）
  const highlights = [
    { icon: <ThunderboltOutlined />, title: text('login.highlight.connect.title'), desc: text('login.highlight.connect.desc') },
    { icon: <ClusterOutlined />, title: text('login.highlight.cluster.title'), desc: text('login.highlight.cluster.desc') },
    { icon: <SafetyCertificateOutlined />, title: text('login.highlight.credential.title'), desc: text('login.highlight.credential.desc') },
  ];

  const handleFinish = async (values: LoginValues) => {
    setLoading(true);
    try {
      if (mode === 'register') {
        await registerUser(values.username, values.password);
        message.success({ content: text('login.registerSuccess'), duration: 5 });
        setMode('login');
        form.setFieldsValue({ username: 'admin', password: '', confirm: '' });
        return;
      }
      const res = await login(values.username, values.password);
      localStorage.setItem('wjw-auth', '1');
      localStorage.setItem('wjw-token', res.token || '');
      localStorage.setItem('wjw-user', res.username || values.username);
      localStorage.setItem('wjw-role', res.role || 'admin');
      if (res.must_change_password) {
        localStorage.setItem('wjw-must-change', '1');
      } else {
        localStorage.removeItem('wjw-must-change');
      }
      onSuccess();
    } catch (e: unknown) {
      message.error(errorMessage(e) || (mode === 'register' ? text('login.registerFailed') : text('login.loginFailed')));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    form.setFieldsValue({ username: next === 'login' ? 'admin' : '', password: '', confirm: '' });
  };

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部品牌条（与控制台顶栏呼应，但登录页用浅色） */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 28px',
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <LogoMark size={26} />
        <LogoWordmark height={17} color={palette.primary} />
        <span style={{ fontSize: 12.5, color: palette.textMute }}>{text('brand.console')}</span>
        <div style={{ marginLeft: 'auto' }}>
          <LanguageSwitch />
        </div>
      </div>

      {/* 主体：左品牌 + 右登录卡 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 72,
          padding: '40px 28px',
          flexWrap: 'wrap',
          background: 'linear-gradient(180deg, #f7faff 0%, #ffffff 60%)',
        }}
      >
        {/* 左：品牌与能力点（窄屏自动折行到上方） */}
        <div style={{ maxWidth: 420, minWidth: 300 }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, color: palette.text, letterSpacing: '-0.5px' }}>
            {text('brand.tagline')}
          </h1>
          <p style={{ margin: '12px 0 30px', fontSize: 14, color: palette.textSub, lineHeight: 1.7 }}>
            {text('login.subtitle')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {highlights.map((h) => (
              <div key={h.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 6,
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    color: palette.primary,
                    background: 'rgba(0,110,255,0.08)',
                  }}
                >
                  {h.icon}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: palette.text }}>{h.title}</div>
                  <div style={{ fontSize: 12.5, color: palette.textMute, marginTop: 2 }}>{h.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右：登录卡片 */}
        <div
          className="wjw-page-in"
          style={{
            width: 380,
            maxWidth: '100%',
            background: '#ffffff',
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            padding: '8px 32px 28px',
            boxShadow: '0 8px 28px -12px rgba(15,23,42,0.18)',
          }}
        >
          <Tabs
            activeKey={mode}
            onChange={(k) => switchMode(k as 'login' | 'register')}
            items={[
              { key: 'login', label: text('login.mode.login') },
              { key: 'register', label: text('login.mode.register') },
            ]}
          />

          <Form<LoginValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ username: 'admin' }}
            onFinish={handleFinish}
          >
            <Form.Item
              label={text('login.username')}
              name="username"
              rules={[
                { required: true, message: text('login.username.required') },
                ...(mode === 'register' ? [{ min: 3, max: 32, message: text('login.username.length') }] : []),
              ]}
            >
              <Input prefix={<UserOutlined style={{ color: palette.textMute }} />} placeholder={text('login.username.placeholder')} size="large" autoComplete="username" />
            </Form.Item>

            <Form.Item
              label={text('login.password')}
              name="password"
              rules={[
                { required: true, message: text('login.password.required') },
                ...(mode === 'register' ? [{ min: 6, max: 64, message: text('login.password.length') }] : []),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: palette.textMute }} />}
                placeholder={text('login.password.placeholder')}
                size="large"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </Form.Item>

            {mode === 'register' && (
              <Form.Item
                label={text('login.confirmPassword')}
                name="confirm"
                dependencies={['password']}
                rules={[
                  { required: true, message: text('login.confirmPassword.required') },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error(text('login.confirmPassword.mismatch')));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: palette.textMute }} />}
                  placeholder={text('login.confirmPassword.placeholder')}
                  size="large"
                  autoComplete="new-password"
                />
              </Form.Item>
            )}

            <Form.Item style={{ marginBottom: 8, marginTop: 24 }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                {mode === 'register' ? text('login.submit.register') : text('login.submit.login')}
              </Button>
            </Form.Item>
          </Form>

          <div style={{ fontSize: 12, color: palette.textMute, textAlign: 'center' }}>
            {mode === 'login' ? text('login.loginHint') : text('login.registerHint')}
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <div
        style={{
          flexShrink: 0,
          padding: '14px 28px',
          borderTop: `1px solid ${palette.border}`,
          fontSize: 12,
          color: palette.textMute,
          textAlign: 'center',
        }}
      >
        {brand.name} · {brand.version}
      </div>
    </div>
  );
};

export default Login;
