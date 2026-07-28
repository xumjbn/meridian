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

const activityConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  asset_created: { color: 'green', icon: <PlusCircleOutlined />, label: '资产创建' },
  asset_updated: { color: 'blue', icon: <EditOutlined />, label: '资产更新' },
  asset_deleted: { color: 'red', icon: <DeleteOutlined />, label: '资产删除' },
  scan_started: { color: 'blue', icon: <PlayCircleOutlined />, label: '扫描启动' },
  scan_completed: { color: 'green', icon: <CheckCircleOutlined />, label: '扫描完成' },
  scan_failed: { color: 'red', icon: <CloseCircleOutlined />, label: '扫描失败' },
  // 后端还会写这些类型，早先没登记，界面上直接漏出 user_registered 这种原始 key
  asset_imported: { color: 'green', icon: <PlusCircleOutlined />, label: '资产导入' },
  user_registered: { color: 'gold', icon: <PlusCircleOutlined />, label: '用户注册' },
  user_created: { color: 'green', icon: <PlusCircleOutlined />, label: '用户创建' },
  user_updated: { color: 'blue', icon: <EditOutlined />, label: '用户更新' },
  user_deleted: { color: 'red', icon: <DeleteOutlined />, label: '用户删除' },
  user_password_changed: { color: 'blue', icon: <EditOutlined />, label: '修改密码' },
};

// 兜底：未登记的类型不要把 snake_case 的 key 直接甩给用户
const activityLabel = (type: string): string =>
  activityConfig[type]?.label ?? type.replace(/_/g, ' ');

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts) || ts < 0) return '-';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// 「最近连接」由侧栏快速连接写入，这里复用同一份记录
const RECENT_KEY = 'lynx-recent-hosts';
const loadRecentIds = (): number[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
};

const statusColor = (s?: string) => (s === 'online' ? palette.success : s === 'offline' ? palette.danger : palette.textMute);

const sectionTitle = (icon: React.ReactNode, text: string, extra?: React.ReactNode) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
    <span style={{ color: palette.primary, fontSize: 15, display: 'inline-flex' }}>{icon}</span>
    <span style={{ fontSize: 14, fontWeight: 500, color: palette.text }}>{text}</span>
    <span style={{ marginLeft: 'auto' }}>{extra}</span>
  </div>
);

export const Dashboard: React.FC = () => {
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
      if (showLoading) message.error('获取数据失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

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
    { label: '纳管资产', value: stats?.total_assets ?? 0, color: palette.text, to: '/assets' },
    { label: '在线', value: stats?.online_assets ?? 0, color: palette.success, to: '/assets' },
    { label: '离线', value: stats?.offline_assets ?? 0, color: palette.danger, to: '/assets' },
    { label: '未探测', value: unknown < 0 ? 0 : unknown, color: palette.textMute, to: '/assets' },
    { label: '服务器', value: stats?.servers ?? 0, color: palette.text, to: '/assets' },
    { label: '运行中扫描', value: stats?.running_tasks ?? 0, color: palette.warning, to: '/tasks' },
  ];

  const quickLinks = [
    { icon: <SafetyCertificateOutlined />, label: '凭据保管箱', desc: '配置 SSH 账号与密钥', to: '/credentials' },
    { icon: <RadarChartOutlined />, label: '自动发现', desc: '扫网段找出存活主机', to: '/tasks' },
    { icon: <DatabaseOutlined />, label: '资产清单', desc: '维护资产台账与标签', to: '/assets' },
    { icon: <CloudServerOutlined />, label: 'K8s 集群', desc: '纳管集群与控制台', to: '/k8s' },
  ];

  return (
    <div ref={rootRef} style={{ background: palette.bg, minHeight: '100%' }}>
      <PageHeader
        title="控制台"
        subtitle="终端工作台"
        icon={<DashboardOutlined />}
        extra={<Button icon={<ReloadOutlined />} onClick={() => fetchAll(true)}>刷新</Button>}
      />

      <div style={{ padding: pagePadding }} className="lynx-page-in">
        {/* 统计条 */}
        <div style={{ ...cardStyle, padding: '14px 20px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 32 }}>
          {statItems.map((s) => (
            <div key={s.label} style={{ cursor: 'pointer' }} onClick={() => navigate(s.to)}>
              <div style={{ fontSize: 12, color: palette.textMute, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <Row gutter={[12, 12]}>
          {/* 打开中的终端会话 */}
          <Col xs={24} xl={12}>
            <div style={{ ...cardStyle, padding: 16, height: '100%' }}>
              {sectionTitle(
                <CodeOutlined />,
                `打开中的终端（${sessions.length}）`,
                sessions.length > 0 && (
                  <a style={{ fontSize: 12 }} onClick={() => setActive(sessions[0].id)}>回到终端 <ArrowRightOutlined /></a>
                ),
              )}
              {sessions.length === 0 ? (
                <div style={{ padding: '22px 0', textAlign: 'center', color: palette.textMute, fontSize: 13 }}>
                  当前没有打开的终端 —— 从左侧主机树或下方「最近连接」点一台机器即可开会话
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
                '最近连接',
                <a style={{ fontSize: 12 }} onClick={() => navigate('/assets')}>全部资产 <ArrowRightOutlined /></a>,
              )}
              {recentHosts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ fontSize: 12, color: palette.textMute }}>还没有连接记录</span>}
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                  {recentHosts.map((a) => (
                    <div
                      key={a.id}
                      className="lynx-hover-card"
                      onClick={() => connect(a)}
                      title={`连接 ${a.name} (${a.ip})`}
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
                      <Tooltip title="文件传输 (SFTP)">
                        <FolderOpenOutlined
                          style={{ color: palette.textMute, fontSize: 13 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('lynx-open-sftp', { detail: a }));
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
              {sectionTitle(<DatabaseOutlined />, '常用入口')}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {quickLinks.map((q) => (
                  <div
                    key={q.to}
                    className="lynx-hover-card"
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
              {sectionTitle(<PlayCircleOutlined />, '最近操作活动')}
              {activity.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: palette.textMute, fontSize: 13 }}>
                  暂无活动记录
                </div>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 6 }}>
                  <Timeline
                    items={activity.slice(0, 12).map((item) => {
                      const cfg = activityConfig[item.type] ?? { color: 'gray', icon: null, label: activityLabel(item.type) };
                      return {
                        color: cfg.color,
                        children: (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <Tag style={{ borderRadius: 3, fontSize: 11, lineHeight: '18px', padding: '0 5px', margin: 0 }} color={cfg.color}>
                                {cfg.label}
                              </Tag>
                              <span style={{ fontSize: 11, color: palette.textMute }}>{formatRelativeTime(item.created_at)}</span>
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
