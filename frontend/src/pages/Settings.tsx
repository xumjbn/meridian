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
  RobotOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { palette, brand, pagePadding } from '../theme';
import { getSettings, updateSettings, testNotify, aiTest } from '../services/api';
import { useI18n } from '../i18n';

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
        <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{title}</div>
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
      {hint && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
    <div style={{ flexShrink: 0, marginLeft: 24 }}>{children}</div>
  </div>
);

// 渲染环境读数：缩放比例 / 窗口逻辑像素 / 实际设备像素 / 内核版本。
// 缩放比例是关键那一项——桌面端如果显示 1 而系统实际是 125%，
// 就说明窗口不是按 DPI 感知创建的，整屏在被位图拉伸，那才是「发虚」的根因；
// 若和浏览器一样是 1.25，问题就在抗锯齿/渲染路径而不是缩放。
const readDisplayInfo = (): string => {
  try {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    const m = /(Edg|Chrome)\/([\d.]+)/.exec(navigator.userAgent || '');
    const core = m ? `${m[1]} ${m[2].split('.')[0]}` : '未知内核';
    return `缩放 ${dpr}× · ${w}×${h} 逻辑 / ${Math.round(w * dpr)}×${Math.round(h * dpr)} 物理 · ${core}`;
  } catch {
    return '读取失败';
  }
};

export const Settings: React.FC = () => {
  const { text } = useI18n();
  // 窗口挪到不同缩放的显示器上 dpr 会变，跟着刷新，否则读到的是打开时的旧值
  const [displayInfo, setDisplayInfo] = useState(readDisplayInfo);
  useEffect(() => {
    const h = () => setDisplayInfo(readDisplayInfo());
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
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

  // AI 命令助手
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiTesting, setAiTesting] = useState(false);

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
        if (s.ai_enabled) setAiEnabled(s.ai_enabled === 'true');
        if (s.ai_base_url) setAiBaseUrl(s.ai_base_url);
        if (s.ai_api_key) setAiApiKey(s.ai_api_key);
        if (s.ai_model) setAiModel(s.ai_model);
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
        ai_enabled: String(aiEnabled),
        ai_base_url: aiBaseUrl,
        ai_api_key: aiApiKey,
        ai_model: aiModel,
      });
      message.success(text('set.saved'));
    } catch {
      message.error(text('set.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    if (!aiBaseUrl.trim() || !aiApiKey.trim() || !aiModel.trim()) {
      message.warning(text('set.ai.needFields'));
      return;
    }
    try {
      setAiTesting(true);
      const res = await aiTest(aiBaseUrl.trim(), aiApiKey.trim(), aiModel.trim());
      message.success(text('set.ai.testOk', { sample: res.sample || 'OK' }));
    } catch (e: any) {
      message.error(e?.message || text('set.ai.testFailed'));
    } finally {
      setAiTesting(false);
    }
  };

  const handleTestNotify = async () => {
    if (notifyType === 'none') {
      message.warning(text('set.notify.needChannel'));
      return;
    }
    if (!notifyUrl.trim()) {
      message.warning(text('set.notify.needUrl'));
      return;
    }
    try {
      setTesting(true);
      await testNotify(notifyType, notifyUrl.trim());
      message.success(text('set.notify.sent'));
    } catch (e: any) {
      message.error(e?.message || text('set.notify.sendFailed'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%' }}>
      <PageHeader
        title={text('nav.settings')}
        subtitle={text('set.subtitle')}
        icon={<SettingOutlined />}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            {text('set.save')}
          </Button>
        }
      />

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        <div style={{ maxWidth: 900 }}>
            {/* 扫描引擎 */}
            <SettingCard
              icon={<ThunderboltOutlined style={{ fontSize: 16 }} />}
              title={text('set.scan.title')}
              description={text('set.scan.desc')}
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin /></div>
              ) : (
              <>
              <SettingRow
                label={text('set.scan.concurrency')}
                hint={text('set.scan.concurrencyHint')}
              >
                <div style={{ width: 200 }}>
                  <Slider
                    min={10} max={500} value={concurrency} onChange={setConcurrency}
                    marks={{ 10: '10', 100: '100', 500: '500' }}
                    tooltip={{ formatter: (v) => text('set.scan.countUnit', { n: v ?? 0 }) }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                label={text('set.scan.portTimeout')}
                hint={text('set.scan.portTimeoutHint')}
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
                label={text('set.scan.sshTimeout')}
                hint={text('set.scan.sshTimeoutHint')}
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
                  {text('set.scan.persistNote')}
                </Text>
              </div>
              </>
              )}
            </SettingCard>

            {/* 告警通知 */}
            <SettingCard
              icon={<BellOutlined style={{ fontSize: 16 }} />}
              title={text('set.notify.title')}
              description={text('set.notify.desc')}
            >
              <SettingRow label={text('set.notify.channel')} hint={text('set.notify.channelHint')}>
                <Select value={notifyType} onChange={setNotifyType} style={{ width: 200 }}>
                  <Select.Option value="none">{text('set.notify.ch.none')}</Select.Option>
                  <Select.Option value="wecom">{text('set.notify.ch.wecom')}</Select.Option>
                  <Select.Option value="dingtalk">{text('set.notify.ch.dingtalk')}</Select.Option>
                  <Select.Option value="webhook">{text('set.notify.ch.webhook')}</Select.Option>
                </Select>
              </SettingRow>
              <SettingRow label={text('set.notify.url')} hint={text('set.notify.urlHint')}>
                <Input
                  value={notifyUrl}
                  onChange={(e) => setNotifyUrl(e.target.value)}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  style={{ width: 360 }}
                  disabled={notifyType === 'none'}
                />
              </SettingRow>
              <SettingRow label={text('set.notify.onScan')} hint={text('set.notify.onScanHint')}>
                <Switch checked={notifyOnScan} onChange={setNotifyOnScan} disabled={notifyType === 'none'} />
              </SettingRow>
              <SettingRow label={text('set.notify.onOffline')} hint={text('set.notify.onOfflineHint')}>
                <Switch checked={notifyOnOffline} onChange={setNotifyOnOffline} disabled={notifyType === 'none'} />
              </SettingRow>
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button icon={<SendOutlined />} loading={testing} onClick={handleTestNotify} disabled={notifyType === 'none'}>
                  {text('set.notify.sendTest')}
                </Button>
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                <Text style={{ fontSize: 12, color: '#1d4ed8' }}>
                  {text('set.notify.tip')}
                </Text>
              </div>
            </SettingCard>

            {/* 可用性监控 */}
            <SettingCard
              icon={<DashboardOutlined style={{ fontSize: 16 }} />}
              title={text('set.monitor.title')}
              description={text('set.monitor.desc')}
            >
              <SettingRow label={text('set.monitor.enable')} hint={text('set.monitor.enableHint')}>
                <Switch checked={monitorEnabled} onChange={setMonitorEnabled} />
              </SettingRow>
              <SettingRow label={text('set.monitor.interval')} hint={text('set.monitor.intervalHint')}>
                <div style={{ width: 220 }}>
                  <Slider
                    min={1} max={60} value={monitorInterval} onChange={setMonitorInterval}
                    marks={{ 1: '1', 5: '5', 30: '30', 60: '60' }}
                    tooltip={{ formatter: (v) => text('set.monitor.minuteUnit', { n: v ?? 0 }) }}
                    disabled={!monitorEnabled}
                  />
                </div>
              </SettingRow>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                <Text style={{ fontSize: 12, color: '#15803d' }}>
                  {text('set.monitor.note')}
                </Text>
              </div>
            </SettingCard>

            {/* AI 命令助手 */}
            <SettingCard
              icon={<RobotOutlined style={{ fontSize: 16 }} />}
              title={text('set.ai.title')}
              description={text('set.ai.desc')}
            >
              <SettingRow label={text('set.ai.enable')} hint={text('set.ai.enableHint')}>
                <Switch checked={aiEnabled} onChange={setAiEnabled} />
              </SettingRow>
              <SettingRow label={text('set.ai.baseUrl')} hint={text('set.ai.baseUrlHint')}>
                <Input
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                  style={{ width: 360 }}
                  disabled={!aiEnabled}
                />
              </SettingRow>
              <SettingRow label="API Key" hint={text('set.ai.apiKeyHint')}>
                <Input.Password
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{ width: 360 }}
                  disabled={!aiEnabled}
                />
              </SettingRow>
              <SettingRow label={text('set.ai.model')} hint={text('set.ai.modelHint')}>
                <Input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="deepseek-chat"
                  style={{ width: 220 }}
                  disabled={!aiEnabled}
                />
              </SettingRow>
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button icon={<SendOutlined />} loading={aiTesting} onClick={handleTestAi} disabled={!aiEnabled}>
                  {text('cred.test')}
                </Button>
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff7ed', borderRadius: 6, border: '1px solid #fed7aa' }}>
                <Text style={{ fontSize: 12, color: '#c2410c' }}>
                  {text('set.ai.warn')}
                </Text>
              </div>
            </SettingCard>

            {/* 安全 */}
            <SettingCard
              icon={<SafetyOutlined style={{ fontSize: 16 }} />}
              title={text('set.sec.title')}
              description={text('set.sec.desc')}
            >
              <SettingRow
                label={text('set.sec.storage')}
                hint={text('set.sec.storageHint')}
              >
                <Tag color="green" style={{ borderRadius: 4 }}>{text('set.sec.storageTag')}</Tag>
              </SettingRow>
              <SettingRow
                label={text('set.sec.hostKey')}
                hint={text('set.sec.hostKeyHint')}
              >
                <Tag color="red" style={{ borderRadius: 4 }}>{text('set.sec.hostKeyTag')}</Tag>
              </SettingRow>
              <SettingRow
                label={text('set.sec.wsAuth')}
                hint={text('set.sec.wsAuthHint')}
              >
                <Tag color="orange" style={{ borderRadius: 4 }}>{text('set.sec.wsAuthTag')}</Tag>
              </SettingRow>

              <div style={{ marginTop: 16, padding: '12px 14px', background: '#fff7ed', borderRadius: 6, border: '1px solid #fed7aa' }}>
                <Text style={{ fontSize: 12, color: '#c2410c' }}>
                  {text('set.sec.advice')}
                </Text>
              </div>
            </SettingCard>

            {/* 关于 */}
            <SettingCard
              icon={<SettingOutlined style={{ fontSize: 16 }} />}
              title={text('set.about.title')}
              description={text('set.about.desc')}
            >
              <SettingRow label={text('set.about.product')}>
                <Text style={{ fontWeight: 500, color: palette.text }}>
                  {brand.name}
                </Text>
              </SettingRow>
              <SettingRow label={text('set.about.positioning')} hint={text('brand.tagline')}>
                <Tag color="purple" style={{ borderRadius: 4 }}>{text('set.about.hub')}</Tag>
              </SettingRow>
              <SettingRow label={text('set.about.version')}>
                <Tag color="blue" style={{ borderRadius: 4, fontFamily: 'monospace' }}>{brand.version}</Tag>
              </SettingRow>
              <SettingRow label={text('set.about.stack')}>
                <Space size={4} wrap>
                  <Tag style={{ borderRadius: 4 }}>Go 1.24</Tag>
                  <Tag style={{ borderRadius: 4 }}>Gin</Tag>
                  <Tag style={{ borderRadius: 4 }}>React 18</Tag>
                  <Tag style={{ borderRadius: 4 }}>Ant Design 5</Tag>
                  <Tag style={{ borderRadius: 4 }}>SQLite</Tag>
                </Space>
              </SettingRow>
              <SettingRow label={text('set.about.dbFile')}>
                <Text code style={{ fontSize: 12 }}>backend/assets.db</Text>
              </SettingRow>
              {/* 渲染环境读数。「桌面端字发虚、不如浏览器」这类问题，光看代码定不了位——
                  缩放比例、窗口实际像素、渲染内核版本是判断被位图拉伸还是抗锯齿差异的
                  必要输入。放在「关于」里，用户能直接读出来对比浏览器。 */}
              <SettingRow label={text('set.about.display')} hint={text('set.about.displayHint')}>
                <Text code style={{ fontSize: 12 }}>{displayInfo}</Text>
              </SettingRow>
              <SettingRow label={text('header.source')}>
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
