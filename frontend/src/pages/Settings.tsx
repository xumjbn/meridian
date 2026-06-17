import React, { useEffect, useState } from 'react';
import { Slider, Typography, Divider, Tag, Space, Button, message, Spin } from 'antd';
import {
  SettingOutlined,
  GithubOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { palette, brand } from '../theme';
import { getSettings, updateSettings } from '../services/api';

const { Text, Link } = Typography;

interface SettingCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

const SettingCard: React.FC<SettingCardProps> = ({ icon, title, description, children }) => (
  <div style={{
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    padding: '24px',
    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    marginBottom: 20,
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: palette.brandGradient, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        boxShadow: '0 6px 16px -6px rgba(99,102,241,0.55)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{description}</div>
      </div>
    </div>
    <Divider style={{ margin: '0 0 20px 0', borderColor: '#f1f5f9' }} />
    {children}
  </div>
);

const SettingRow: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{hint}</div>}
    </div>
    <div style={{ flexShrink: 0, marginLeft: 24 }}>{children}</div>
  </div>
);

export const Settings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [concurrency, setConcurrency] = useState(100);
  const [portTimeout, setPortTimeout] = useState(2);
  const [sshTimeout, setSshTimeout] = useState(10);

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.scan_concurrency) setConcurrency(Number(s.scan_concurrency));
        if (s.scan_timeout) setPortTimeout(Number(s.scan_timeout));
        if (s.ssh_timeout) setSshTimeout(Number(s.ssh_timeout));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateSettings({
        scan_concurrency: String(concurrency),
        scan_timeout: String(portTimeout),
        ssh_timeout: String(sshTimeout),
      });
      message.success('扫描引擎配置已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="系统设置"
        subtitle="扫描引擎参数、安全配置与系统信息"
        icon={<SettingOutlined />}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        }
      />

      <div style={{ padding: 32 }} className="mrd-fade-up">
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
            {/* 扫描引擎 */}
            <SettingCard
              icon={<ThunderboltOutlined style={{ fontSize: 16 }} />}
              title="扫描引擎配置"
              description="控制并发扫描的性能参数，影响扫描速度与目标主机/网络的压力"
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin /></div>
              ) : (
              <>
              <SettingRow
                label="最大并发连接数"
                hint="同时建立的 TCP 探测连接数，建议 50–200，过大可能导致目标网络告警"
              >
                <div style={{ width: 200 }}>
                  <Slider
                    min={10} max={500} value={concurrency} onChange={setConcurrency}
                    marks={{ 10: '10', 100: '100', 500: '500' }}
                    tooltip={{ formatter: (v) => `${v} 个` }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                label="端口探测超时时间"
                hint="每个 TCP 连接等待响应的最长时间，建议 1–5 秒"
              >
                <div style={{ width: 200 }}>
                  <Slider
                    min={1} max={10} step={0.5} value={portTimeout} onChange={setPortTimeout}
                    marks={{ 1: '1s', 5: '5s', 10: '10s' }}
                    tooltip={{ formatter: (v) => `${v}s` }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                label="SSH 连接超时"
                hint="建立 SSH 会话的最长等待时间"
              >
                <div style={{ width: 200 }}>
                  <Slider
                    min={5} max={60} value={sshTimeout} onChange={setSshTimeout}
                    marks={{ 5: '5s', 10: '10s', 60: '60s' }}
                    tooltip={{ formatter: (v) => `${v}s` }}
                  />
                </div>
              </SettingRow>

              <div style={{ marginTop: 16, padding: '10px 14px', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                <Text style={{ fontSize: 12, color: '#15803d' }}>
                  ✓ 配置已持久化到数据库（system_settings 表），重启后端依然生效。修改后点击右上角「保存配置」应用。
                </Text>
              </div>
              </>
              )}
            </SettingCard>

            {/* 安全 */}
            <SettingCard
              icon={<SafetyOutlined style={{ fontSize: 16 }} />}
              title="安全与凭据"
              description="凭据存储方式与连接安全设置"
            >
              <SettingRow
                label="凭据存储方式"
                hint="当前版本使用 SQLite 明文存储，仅适用于内网测试环境"
              >
                <Tag color="orange" style={{ borderRadius: 4 }}>明文存储（当前）</Tag>
              </SettingRow>
              <SettingRow
                label="SSH Host Key 校验"
                hint="当前版本跳过 Host Key 校验（InsecureIgnoreHostKey）"
              >
                <Tag color="red" style={{ borderRadius: 4 }}>已禁用（不推荐生产使用）</Tag>
              </SettingRow>
              <SettingRow
                label="WebSocket 鉴权"
                hint="终端 WebSocket 连接当前无鉴权"
              >
                <Tag color="orange" style={{ borderRadius: 4 }}>未启用</Tag>
              </SettingRow>

              <div style={{ marginTop: 16, padding: '12px 14px', background: '#fff7ed', borderRadius: 6, border: '1px solid #fed7aa' }}>
                <Text style={{ fontSize: 12, color: '#c2410c' }}>
                  ⚠️ 生产环境建议：启用 SSH 密钥认证代替密码、开启 Host Key 校验、对 WebSocket 端点添加 Token 鉴权。密码加密存储将在 Phase 3 中实现。
                </Text>
              </div>
            </SettingCard>

            {/* 关于 */}
            <SettingCard
              icon={<SettingOutlined style={{ fontSize: 16 }} />}
              title="关于 Meridian"
              description="系统版本信息与项目链接"
            >
              <SettingRow label="产品名称">
                <Text style={{ fontWeight: 600, color: palette.text }}>
                  {brand.name} · {brand.zh}
                </Text>
              </SettingRow>
              <SettingRow label="产品定位" hint={brand.tagline}>
                <Tag color="purple" style={{ borderRadius: 4 }}>资产中枢</Tag>
              </SettingRow>
              <SettingRow label="当前版本">
                <Tag color="blue" style={{ borderRadius: 4, fontFamily: 'monospace' }}>{brand.version}</Tag>
              </SettingRow>
              <SettingRow label="技术栈">
                <Space size={4} wrap>
                  <Tag style={{ borderRadius: 4 }}>Go 1.24</Tag>
                  <Tag style={{ borderRadius: 4 }}>Gin</Tag>
                  <Tag style={{ borderRadius: 4 }}>React 18</Tag>
                  <Tag style={{ borderRadius: 4 }}>Ant Design 5</Tag>
                  <Tag style={{ borderRadius: 4 }}>SQLite</Tag>
                </Space>
              </SettingRow>
              <SettingRow label="数据库文件">
                <Text code style={{ fontSize: 12 }}>backend/assets.db</Text>
              </SettingRow>
              <SettingRow label="项目源码">
                <Link href={brand.repo} target="_blank">
                  <Space size={4}>
                    <GithubOutlined />
                    <span style={{ fontSize: 13 }}>GitHub</span>
                  </Space>
                </Link>
              </SettingRow>
            </SettingCard>
        </div>
      </div>
    </div>
  );
};
