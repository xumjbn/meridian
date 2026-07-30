import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Row, Col, Spin, message, Button, Timeline, Tag, Empty, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  DesktopOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  RadarChartOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { getStats, getRecentActivity, getAssets, type Stats, type ActivityLog, type Asset } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { useTerminals } from '../terminalSessions';
import { palette, cardStyle, pagePadding } from '../theme';
import { useI18n } from '../i18n';

type TextFn = (key: string, values?: Record<string, string | number>) => string;

// 只留颜色与图标，文案统一走词条 dash.act.<type>
const activityConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  asset_created: { color: 'green', icon: <PlusCircleOutlined /> },
  asset_updated: { color: 'blue', icon: <EditOutlined /> },
  asset_deleted: { color: 'red', icon: <DeleteOutlined /> },
  scan_started: { color: 'blue', icon: <PlayCircleOutlined /> },
  scan_completed: { color: 'green', icon: <CheckCircleOutlined /> },
  scan_failed: { color: 'red', icon: <CloseCircleOutlined /> },
  // 后端还会写这些类型，早先没登记，界面上直接漏出 user_registered 这种原始 key
  asset_imported: { color: 'green', icon: <PlusCircleOutlined /> },
  user_registered: { color: 'gold', icon: <PlusCircleOutlined /> },
  user_created: { color: 'green', icon: <PlusCircleOutlined /> },
  user_updated: { color: 'blue', icon: <EditOutlined /> },
  user_deleted: { color: 'red', icon: <DeleteOutlined /> },
  user_password_changed: { color: 'blue', icon: <EditOutlined /> },
};

// 兜底：未登记的类型不要把 snake_case 的 key 直接甩给用户
const activityLabel = (type: string, text: TextFn): string =>
  activityConfig[type] ? text(`dash.act.${type}`) : type.replace(/_/g, ' ');

function formatRelativeTime(iso: string, text: TextFn): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts) || ts < 0) return '-';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return text('time.secondsAgo', { n: diff });
  if (diff < 3600) return text('time.minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return text('time.hoursAgo', { n: Math.floor(diff / 3600) });
  return text('time.daysAgo', { n: Math.floor(diff / 86400) });
}

// 「最近连接」由侧栏快速连接写入，这里复用同一份记录
const RECENT_KEY = 'wjw-recent-hosts';
const loadRecentIds = (): number[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
};

const statusColor = (s?: string) => (s === 'online' ? palette.success : s === 'offline' ? palette.danger : palette.textMute);

// 参数原名 text，会遮蔽 i18n 的 text()，改叫 label
const sectionTitle = (icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
    <span style={{ color: palette.primary, fontSize: 15, display: 'inline-flex' }}>{icon}</span>
    <span style={{ fontSize: 14, fontWeight: 500, color: palette.text }}>{label}</span>
    <span style={{ marginLeft: 'auto' }}>{extra}</span>
  </div>
);

export const Dashboard: React.FC = () => {
  const { text } = useI18n();
  const navigate = useNavigate();
  const { sessions, activeId, open: openTerminal, setActive } = useTerminals();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [recentIds, setRecentIds] = useState<number[]>(loadRecentIds);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const [s, a, as] = await Promise.all([getStats(), getRecentActivity(), getAssets().catch(() => [] as Asset[])]);
      setStats(s);
      setActivity(a);
      setAssets(as);
      setRecentIds(loadRecentIds());
    } catch {
      if (showLoading) message.error(text('dash.loadFailed'));
    } finally {
      if (showLoading) setLoading(false);
    }
    // text 进依赖，否则切语言后这里的报错提示还停在旧语种
  }, [text]);

  // 轮询要能判断「本页当前是不是真的看得见」。
  // 切到终端标签时，App 只是给页面容器套了 display:none，本组件仍然挂着——
  // 光靠 document.hidden 判断不出来（窗口是可见的），结果是用户在终端里干活的
  // 整个过程中，控制台每 8 秒照样拉 stats / activity / assets 三个接口。
  // 实测（真实 WebView2，停在终端页静置 30 秒）：确认仍在轮询。
  // display:none 子树里的元素 offsetParent 为 null，用它判断最省。
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAll(true);
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (rootRef.current && !rootRef.current.offsetParent) return; // 被切走了，别白拉
      fetchAll(false);
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  const byId = new Map(assets.map((a) => [a.id!, a]));
  // 最近连接过、且资产仍存在的主机（最多 8 个）
  const recentHosts = recentIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a).slice(0, 8);
  const unknown = (stats?.total_assets ?? 0) - (stats?.online_assets ?? 0) - (stats?.offline_assets ?? 0);

  const connect = (a: Asset) => a.id && openTerminal({ assetId: a.id, name: a.name, ip: a.ip });

  // 顶部统计条：一行紧凑数字，替掉原来四个占半屏的大卡
  const statItems = [
    { label: text('dash.stat.total'), value: stats?.total_assets ?? 0, color: palette.text, to: '/assets' },
    { label: text('dash.stat.online'), value: stats?.online_assets ?? 0, color: palette.success, to: '/assets' },
    { label: text('dash.stat.offline'), value: stats?.offline_assets ?? 0, color: palette.danger, to: '/assets' },
    { label: text('dash.stat.unknown'), value: unknown < 0 ? 0 : unknown, color: palette.textMute, to: '/assets' },
    { label: text('dash.stat.servers'), value: stats?.servers ?? 0, color: palette.text, to: '/assets' },
    { label: text('dash.stat.runningScans'), value: stats?.running_tasks ?? 0, color: palette.warning, to: '/tasks' },
  ];

  const quickLinks = [
    { icon: <SafetyCertificateOutlined />, label: text('nav.credentials'), desc: text('dash.quick.credentials'), to: '/credentials' },
    { icon: <RadarChartOutlined />, label: text('nav.discovery'), desc: text('dash.quick.discovery'), to: '/tasks' },
    { icon: <DatabaseOutlined />, label: text('nav.assets'), desc: text('dash.quick.assets'), to: '/assets' },
    { icon: <CloudServerOutlined />, label: text('nav.k8s'), desc: text('dash.quick.k8s'), to: '/k8s' },
  ];

  return (
    <div ref={rootRef} style={{ background: palette.bg, minHeight: '100%' }}>
      <PageHeader
        title={text('nav.console')}
        subtitle={text('dash.subtitle')}
        icon={<DashboardOutlined />}
        extra={<Button icon={<ReloadOutlined />} onClick={() => fetchAll(true)}>{text('common.refresh')}</Button>}
      />

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        {/* 统计条 */}
        <div style={{ ...cardStyle, padding: '14px 20px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 32 }}>
          {statItems.map((s) => (
            <div key={s.label} style={{ cursor: 'pointer' }} onClick={() => navigate(s.to)}>
              <div style={{ fontSize: 12, color: palette.textMute, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <Row gutter={[12, 12]}>
          {/* 打开中的终端会话 */}
          <Col xs={24} xl={12}>
            <div style={{ ...cardStyle, padding: 16, height: '100%' }}>
              {sectionTitle(
                <CodeOutlined />,
                text('dash.openTerminals', { count: sessions.length }),
                sessions.length > 0 && (
                  <a style={{ fontSize: 12 }} onClick={() => setActive(sessions[0].id)}>{text('dash.backToTerminal')} <ArrowRightOutlined /></a>
                ),
              )}
              {sessions.length === 0 ? (
                <div style={{ padding: '22px 0', textAlign: 'center', color: palette.textMute, fontSize: 13 }}>
                  {text('dash.noTerminals')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sessions.map((s) => {
                    const active = activeId === s.id;
                    return (
                      <div
                        key={s.id}
                        onClick={() => setActive(s.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                          padding: '8px 12px', borderRadius: 6, fontSize: 13,
                          border: `1px solid ${active ? palette.primaryBorder : palette.border}`,
                          background: active ? palette.primaryBg : palette.surface,
                          color: active ? palette.primaryDeep : palette.text,
                        }}
                      >
                        {s.assetId < 0 ? <DesktopOutlined /> : <CodeOutlined />}
                        <span style={{ fontWeight: 500 }}>{s.customName || s.name}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: palette.textMute }}>{s.ip}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Col>

          {/* 最近连接的主机 */}
          <Col xs={24} xl={12}>
            <div style={{ ...cardStyle, padding: 16, height: '100%' }}>
              {sectionTitle(
                <ThunderboltOutlined />,
                text('dash.recentHosts'),
                <a style={{ fontSize: 12 }} onClick={() => navigate('/assets')}>{text('dash.allAssets')} <ArrowRightOutlined /></a>,
              )}
              {recentHosts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ fontSize: 12, color: palette.textMute }}>{text('dash.noRecent')}</span>}
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                  {recentHosts.map((a) => (
                    <div
                      key={a.id}
                      className="wjw-hover-card"
                      onClick={() => connect(a)}
                      title={text('dash.connectTo', { name: a.name, ip: a.ip })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        padding: '9px 11px', borderRadius: 6,
                        border: `1px solid ${palette.border}`, background: palette.surface,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(a.status), flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: palette.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.name}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: palette.textMute }}>{a.ip}</div>
                      </div>
                      <Tooltip title={text('dash.sftp')}>
                        <FolderOpenOutlined
                          style={{ color: palette.textMute, fontSize: 13 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('wjw-open-sftp', { detail: a }));
                          }}
                        />
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Col>

          {/* 常用入口 */}
          <Col xs={24} xl={12}>
            <div style={{ ...cardStyle, padding: 16, height: '100%' }}>
              {sectionTitle(<DatabaseOutlined />, text('dash.quickLinks'))}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {quickLinks.map((q) => (
                  <div
                    key={q.to}
                    className="wjw-hover-card"
                    onClick={() => navigate(q.to)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '10px 12px', borderRadius: 6,
                      border: `1px solid ${palette.border}`, background: palette.surface,
                    }}
                  >
                    <span style={{ color: palette.primary, fontSize: 16, display: 'inline-flex' }}>{q.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: palette.text }}>{q.label}</div>
                      <div style={{ fontSize: 11, color: palette.textMute }}>{q.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Col>

          {/* 最近操作活动 */}
          <Col xs={24} xl={12}>
            <div style={{ ...cardStyle, padding: 16, height: '100%', minHeight: 180 }}>
              {sectionTitle(<PlayCircleOutlined />, text('dash.recentActivity'))}
              {activity.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: palette.textMute, fontSize: 13 }}>
                  {text('dash.noActivity')}
                </div>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 6 }}>
                  <Timeline
                    items={activity.slice(0, 12).map((item) => {
                      const cfg = activityConfig[item.type] ?? { color: 'gray', icon: null };
                      return {
                        color: cfg.color,
                        children: (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <Tag style={{ borderRadius: 3, fontSize: 11, lineHeight: '18px', padding: '0 5px', margin: 0 }} color={cfg.color}>
                                {activityLabel(item.type, text)}
                              </Tag>
                              <span style={{ fontSize: 11, color: palette.textMute }}>{formatRelativeTime(item.created_at, text)}</span>
                            </div>
                            <div style={{ fontSize: 12.5, color: palette.textSub }}>{item.message}</div>
                          </div>
                        ),
                      };
                    })}
                  />
                </div>
              )}
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
};

export default Dashboard;
