import React from 'react';
import { Row, Col, Slider, Typography, Divider, Tag, Space } from 'antd';
import {
  SettingOutlined,
  GithubOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

const { Text, Link } = Typography;

interface SettingCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

const SettingCard: React.FC<SettingCardProps> = ({ icon, title, description, children }) => (
  <div style={{
    background: '#ffffff',
    border: '1px solid #f1f5f9',
    borderRadius: 8,
    padding: '24px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
    marginBottom: 20,
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: '#eff6ff', color: '#2563eb',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        background: '#ffffff',
        padding: '20px 32px',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>系统设置</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>扫描引擎参数、安全配置与系统信息</p>
        </div>
      </div>

      <div style={{ padding: '32px', maxWidth: 860 }}>
        <Row gutter={[0, 0]}>
          <Col span={24}>
            {/* 扫描引擎 */}
            <SettingCard
              icon={<ThunderboltOutlined style={{ fontSize: 16 }} />}
              title="扫描引擎配置"
              description="控制并发扫描的性能参数，影响扫描速度与目标主机/网络的压力"
            >
              <SettingRow
                label="最大并发连接数"
                hint="同时建立的 TCP 探测连接数，建议 50–200，过大可能导致目标网络告警"
              >
                <div style={{ width: 200 }}>
                  <Slider
                    min={10} max={500} defaultValue={100}
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
                    min={1} max={10} defaultValue={2} step={0.5}
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
                    min={5} max={60} defaultValue={10}
                    marks={{ 5: '5s', 10: '10s', 60: '60s' }}
                    tooltip={{ formatter: (v) => `${v}s` }}
                  />
                </div>
              </SettingRow>

              <div style={{ marginTop: 16, padding: '10px 14px', background: '#fafafa', borderRadius: 6, border: '1px solid #f1f5f9' }}>
                <Text style={{ fontSize: 12, color: '#94a3b8' }}>
                  ⚠️ 当前版本配置仅在此会话中生效，重启后端后将恢复默认值。持久化配置将在 Phase 3 版本中实现。
                </Text>
              </div>
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
              title="关于"
              description="系统版本信息与项目链接"
            >
              <SettingRow label="当前版本">
                <Tag color="blue" style={{ borderRadius: 4, fontFamily: 'monospace' }}>v2.0.0-phase1</Tag>
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
                <Link href="https://github.com" target="_blank">
                  <Space size={4}>
                    <GithubOutlined />
                    <span style={{ fontSize: 13 }}>GitHub</span>
                  </Space>
                </Link>
              </SettingRow>
            </SettingCard>
          </Col>
        </Row>
      </div>
    </div>
  );
};
