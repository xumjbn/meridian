import React, { useState } from 'react';
import { Form, Input, Button, Tabs, message } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, ThunderboltOutlined, ClusterOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { brand, palette } from '../theme';
import { login, registerUser } from '../services/api';

interface LoginProps {
  onSuccess: () => void;
}

interface LoginValues {
  username: string;
  password: string;
  confirm?: string;
}

// 左侧品牌区的能力点（控制台登录页惯例：产品价值三连）
const HIGHLIGHTS = [
  { icon: <ThunderboltOutlined />, title: '一键连接', desc: '主机树直达 SSH / SFTP，会话常驻不掉线' },
  { icon: <ClusterOutlined />, title: '集群纳管', desc: '自动识别 K8s 节点与控制台，归类即可跳转' },
  { icon: <SafetyCertificateOutlined />, title: '凭据集中', desc: '账号密钥统一保管，操作全程审计留痕' },
];

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form] = Form.useForm<LoginValues>();

  const handleFinish = async (values: LoginValues) => {
    setLoading(true);
    try {
      if (mode === 'register') {
        await registerUser(values.username, values.password);
        message.success({ content: '注册成功，请等待管理员审批后再登录', duration: 5 });
        setMode('login');
        form.setFieldsValue({ username: 'admin', password: '', confirm: '' });
        return;
      }
      const res = await login(values.username, values.password);
      localStorage.setItem('mrd-auth', '1');
      localStorage.setItem('mrd-token', res.token || '');
      localStorage.setItem('mrd-user', res.username || values.username);
      localStorage.setItem('mrd-role', res.role || 'admin');
      if (res.must_change_password) {
        localStorage.setItem('mrd-must-change', '1');
      } else {
        localStorage.removeItem('mrd-must-change');
      }
      onSuccess();
    } catch (e: any) {
      message.error(e?.message || (mode === 'register' ? '注册失败' : '用户名或密码错误'));
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
        <span style={{ fontSize: 16, fontWeight: 600, color: palette.text }}>{brand.name}</span>
        <span style={{ fontSize: 12.5, color: palette.textMute }}>控制台</span>
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
            {brand.tagline}
          </h1>
          <p style={{ margin: '12px 0 30px', fontSize: 14, color: palette.textSub, lineHeight: 1.7 }}>
            发现资产 · 纳管集群 · 一键接入 —— 把分散的主机、集群与凭据收敛到同一个控制台。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {HIGHLIGHTS.map((h) => (
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
          className="mrd-page-in"
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
              { key: 'login', label: '账号登录' },
              { key: 'register', label: '注册账号' },
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
              label="用户名"
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                ...(mode === 'register' ? [{ min: 3, max: 32, message: '用户名长度需为 3–32 个字符' }] : []),
              ]}
            >
              <Input prefix={<UserOutlined style={{ color: palette.textMute }} />} placeholder="用户名" size="large" autoComplete="username" />
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
                prefix={<LockOutlined style={{ color: palette.textMute }} />}
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
                  prefix={<LockOutlined style={{ color: palette.textMute }} />}
                  placeholder="确认密码"
                  size="large"
                  autoComplete="new-password"
                />
              </Form.Item>
            )}

            <Form.Item style={{ marginBottom: 8, marginTop: 24 }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                {mode === 'register' ? '注册' : '登录'}
              </Button>
            </Form.Item>
          </Form>

          <div style={{ fontSize: 12, color: palette.textMute, textAlign: 'center' }}>
            {mode === 'login' ? '注册账号需管理员审批后方可登录' : '注册后请联系管理员审批开通'}
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
        {brand.name} {brand.zh} · {brand.version}
      </div>
    </div>
  );
};

export default Login;
