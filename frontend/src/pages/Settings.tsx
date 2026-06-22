import React, { useEffect, useState } from 'react';
import { Slider, Typography, Divider, Tag, Space, Button, message, Spin, Select, Input, Switch } from 'antd';
import {
  SettingOutlined,
  GithubOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  BellOutlined,
  SendOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { palette, brand } from '../theme';
import { getSettings, updateSettings, testNotify } from '../services/api';

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

  // 告警通知
  const [notifyType, setNotifyType] = useState('none');
  const [notifyUrl, setNotifyUrl] = useState('');
  const [notifyOnScan, setNotifyOnScan] = useState(true);
  const [notifyOnOffline, setNotifyOnOffline] = useState(true);
  const [testing, setTesting] = useState(false);

  // 可用性监控
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorInterval, setMonitorInterval] = useState(5);

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.scan_concurrency) setConcurrency(Number(s.scan_concurrency));
        if (s.scan_timeout) setPortTimeout(Number(s.scan_timeout));
        if (s.ssh_timeout) setSshTimeout(Number(s.ssh_timeout));
        if (s.notify_type) setNotifyType(s.notify_type);
        if (s.notify_url) setNotifyUrl(s.notify_url);
        if (s.notify_on_scan) setNotifyOnScan(s.notify_on_scan === 'true');
        if (s.notify_on_offline) setNotifyOnOffline(s.notify_on_offline === 'true');
        if (s.monitor_enabled) setMonitorEnabled(s.monitor_enabled === 'true');
        if (s.monitor_interval) setMonitorInterval(Number(s.monitor_interval));
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
        notify_type: notifyType,
        notify_url: notifyUrl,
        notify_on_scan: String(notifyOnScan),
        notify_on_offline: String(notifyOnOffline),
        monitor_enabled: String(monitorEnabled),
        monitor_interval: String(monitorInterval),
      });
      message.success('配置已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotify = async () => {
    if (notifyType === 'none') {
      message.warning('请先选择一个通知渠道');
      return;
    }
    if (!notifyUrl.trim()) {
      message.warning('请先填写 Webhook 地址');
      return;
    }
    try {
      setTesting(true);
      await testNotify(notifyType, notifyUrl.trim());
      message.success('测试通知已发送，请查看对应群/渠道');
    } catch (e: any) {
      message.error(e?.message || '发送失败');
    } finally {
      setTesting(false);
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

            {/* 告警通知 */}
            <SettingCard
              icon={<BellOutlined style={{ fontSize: 16 }} />}
              title="告警通知"
              description="扫描任务完成/失败时，向企业微信、钉钉群机器人或自定义 Webhook 推送通知"
            >
              <SettingRow label="通知渠道" hint="选择群机器人类型，或使用通用 Webhook（POST JSON）">
                <Select value={notifyType} onChange={setNotifyType} style={{ width: 200 }}>
                  <Select.Option value="none">不启用</Select.Option>
                  <Select.Option value="wecom">企业微信群机器人</Select.Option>
                  <Select.Option value="dingtalk">钉钉群机器人</Select.Option>
                  <Select.Option value="webhook">通用 Webhook</Select.Option>
                </Select>
              </SettingRow>
              <SettingRow label="Webhook 地址" hint="群机器人的 Webhook URL，或自定义接收地址">
                <Input
                  value={notifyUrl}
                  onChange={(e) => setNotifyUrl(e.target.value)}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  style={{ width: 360 }}
                  disabled={notifyType === 'none'}
                />
              </SettingRow>
              <SettingRow label="扫描完成时通知" hint="扫描任务结束（成功或失败）时推送结果摘要">
                <Switch checked={notifyOnScan} onChange={setNotifyOnScan} disabled={notifyType === 'none'} />
              </SettingRow>
              <SettingRow label="资产离线时通知" hint="可用性监控发现资产离线或恢复在线时推送">
                <Switch checked={notifyOnOffline} onChange={setNotifyOnOffline} disabled={notifyType === 'none'} />
              </SettingRow>
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button icon={<SendOutlined />} loading={testing} onClick={handleTestNotify} disabled={notifyType === 'none'}>
                  发送测试通知
                </Button>
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                <Text style={{ fontSize: 12, color: '#1d4ed8' }}>
                  提示：配置后请点击右上角「保存配置」持久化；测试按钮使用当前编辑中的地址即时发送。
                </Text>
              </div>
            </SettingCard>

            {/* 可用性监控 */}
            <SettingCard
              icon={<DashboardOutlined style={{ fontSize: 16 }} />}
              title="可用性监控"
              description="定时探测全部资产在线状态，记录在线率历史，并在离线时触发告警"
            >
              <SettingRow label="启用可用性监控" hint="开启后后台按下方间隔自动探测所有资产并记录历史">
                <Switch checked={monitorEnabled} onChange={setMonitorEnabled} />
              </SettingRow>
              <SettingRow label="探测间隔" hint="每隔多少分钟探测一轮，建议 5–30 分钟">
                <div style={{ width: 220 }}>
                  <Slider
                    min={1} max={60} value={monitorInterval} onChange={setMonitorInterval}
                    marks={{ 1: '1', 5: '5', 30: '30', 60: '60' }}
                    tooltip={{ formatter: (v) => `${v} 分钟` }}
                    disabled={!monitorEnabled}
                  />
                </div>
              </SettingRow>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                <Text style={{ fontSize: 12, color: '#15803d' }}>
                  在资产详情中可查看各资产近 24 小时在线率；状态从在线变为离线时会按「告警通知」配置推送。
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
