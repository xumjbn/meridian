import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { LogoMark } from '../components/Logo';
import { palette, cardStyle } from '../theme';
import { changePassword, errorMessage } from '../services/api';
import { useI18n } from '../i18n';

interface Props {
  onDone: () => void;
}

interface Values {
  newPassword: string;
  confirm: string;
}

// 首次登录（默认账号）强制修改密码页：在改密成功前无法进入系统
export const ForcePasswordChange: React.FC<Props> = ({ onDone }) => {
  const { t, text } = useI18n();
  const [loading, setLoading] = useState(false);
  const user = localStorage.getItem('lynx-user') || 'admin';

  const handleFinish = async (values: Values) => {
    setLoading(true);
    try {
      // 强制改密场景后端免校验原密码，这里传空字符串即可
      await changePassword(user, '', values.newPassword);
      localStorage.removeItem('lynx-must-change');
      message.success(text('password.changeSuccess'));
      onDone();
    } catch (e: unknown) {
      message.error(errorMessage(e) || text('password.changeFailed'));
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
        className="lynx-fade-up"
        style={{ ...cardStyle, background: '#fff', width: 400, maxWidth: '100%', padding: '36px 32px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
          <LogoMark size={48} />
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 14, color: palette.text }}>
            <SafetyOutlined style={{ marginRight: 8, color: palette.primary }} />
            {text('password.forceTitle')}
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
            {t('password.forceDesc', { user: <b>{user}</b> })}
          </div>
        </div>

        <Form<Values> layout="vertical" requiredMark={false} onFinish={handleFinish}>
          <Form.Item
            label={text('password.new')}
            name="newPassword"
            rules={[
              { required: true, message: text('password.new.required') },
              { min: 6, max: 64, message: text('login.password.length') },
            ]}
          >
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder={text('password.new.placeholder')} size="large" autoComplete="new-password" />
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
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder={text('password.confirmNew.placeholder')} size="large" autoComplete="new-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              {text('password.submitForce')}
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default ForcePasswordChange;
