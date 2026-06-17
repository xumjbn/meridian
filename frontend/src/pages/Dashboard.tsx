import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Progress, Spin, message, Space, Button, Timeline, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  DesktopOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  LinkOutlined,
  ReloadOutlined,
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { getStats, getRecentActivity, type Stats, type ActivityLog } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';

const activityConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  asset_created: { color: 'green', icon: <PlusCircleOutlined />, label: '资产创建' },
  asset_updated: { color: 'blue', icon: <EditOutlined />, label: '资产更新' },
  asset_deleted: { color: 'red', icon: <DeleteOutlined />, label: '资产删除' },
  scan_started: { color: 'blue', icon: <PlayCircleOutlined />, label: '扫描启动' },
  scan_completed: { color: 'green', icon: <CheckCircleOutlined />, label: '扫描完成' },
  scan_failed: { color: 'red', icon: <CloseCircleOutlined />, label: '扫描失败' },
};

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts) || ts < 0) return '-';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const [s, a] = await Promise.all([getStats(), getRecentActivity()]);
      setStats(s);
      setActivity(a);
    } catch (e) {
      if (showLoading) message.error('获取数据失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(true);
    // 标签页隐藏时暂停轮询，避免后台无谓请求
    const interval = setInterval(() => {
      if (!document.hidden) fetchAll(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const onlineRate =
    stats && stats.total_assets > 0 ? Math.round((stats.online_assets / stats.total_assets) * 100) : 0;
  const unknown = (stats?.total_assets ?? 0) - (stats?.online_assets ?? 0) - (stats?.offline_assets ?? 0);

  const statCards = [
    { label: '纳管资产总数', value: stats?.total_assets, icon: <DatabaseOutlined />, accent: palette.primary, bg: 'rgba(99,102,241,0.1)' },
    { label: '物理服务器', value: stats?.servers, icon: <DesktopOutlined />, accent: '#0d9488', bg: 'rgba(13,148,136,0.1)' },
    { label: '网络交换机', value: stats?.switches, icon: <ApartmentOutlined />, accent: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
    { label: '核心路由器', value: stats?.routers, icon: <LinkOutlined />, accent: '#ea580c', bg: 'rgba(234,88,12,0.1)' },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="控制台"
        subtitle="实时资产态势监控与自动发现扫描概览"
        icon={<DashboardOutlined />}
        extra={
          <Space size="middle">
            {stats?.running_tasks && stats.running_tasks > 0 ? (
              <span style={{ fontSize: 13, color: palette.success, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                <Spin size="small" /> 扫描执行中…
              </span>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => fetchAll(true)}>
              刷新
            </Button>
          </Space>
        }
      />

      <div style={{ padding: 32 }} className="mrd-fade-up">
        {/* 统计卡片行 */}
        <Row gutter={[20, 20]}>
          {statCards.map((card) => (
            <Col xs={24} sm={12} xl={6} key={card.label}>
              <div className="mrd-hover-card" style={{ ...cardStyle, padding: 20, position: 'relative', overflow: 'hidden' }}>
                <div
                  style={{
                    position: 'absolute',
                    right: -18,
                    top: -18,
                    width: 70,
                    height: 70,
                    borderRadius: '50%',
                    background: card.bg,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: palette.textSub }}>{card.label}</span>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      fontSize: 17,
                      background: card.bg,
                      color: card.accent,
                    }}
                  >
                    {card.icon}
                  </div>
                </div>
                <div style={{ marginTop: 14, position: 'relative' }}>
                  <span style={{ fontSize: 30, fontWeight: 800, color: palette.text, letterSpacing: '-1px' }}>
                    {card.value ?? 0}
                  </span>
                  <span style={{ fontSize: 13, color: palette.textMute, marginLeft: 6 }}>台</span>
                </div>
              </div>
            </Col>
          ))}
        </Row>

        {/* 在线率 + 活动时间线 */}
        <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
          <Col xs={24} lg={12}>
            <div style={{ ...cardStyle, padding: 24, height: '100%' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, color: palette.text }}>资产存活率分析</h3>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', minHeight: 168, flexWrap: 'wrap', gap: 16 }}>
                <Progress
                  type="circle"
                  percent={onlineRate}
                  strokeColor={{ '0%': palette.accent, '100%': palette.primary }}
                  trailColor="#eef1f6"
                  size={136}
                  format={(percent) => (
                    <div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: palette.text, letterSpacing: '-1px' }}>{percent}%</div>
                      <div style={{ fontSize: 11, color: palette.textSub, marginTop: 2 }}>在线比例</div>
                    </div>
                  )}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { dot: palette.success, name: '在线', val: stats?.online_assets ?? 0, hint: '端口探测响应正常' },
                    { dot: palette.danger, name: '离线', val: stats?.offline_assets ?? 0, hint: '检测不到端口响应' },
                    { dot: palette.textMute, name: '未知', val: unknown, hint: '尚未进行探测' },
                  ].map((r) => (
                    <div key={r.name}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.dot, display: 'inline-block' }} />
                        <span style={{ fontWeight: 600, fontSize: 14, color: palette.text }}>
                          {r.name} ({r.val})
                        </span>
                      </div>
                      <div style={{ color: palette.textSub, fontSize: 12, paddingLeft: 16, marginTop: 2 }}>{r.hint}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Col>

          <Col xs={24} lg={12}>
            <div style={{ ...cardStyle, padding: 24, height: '100%', minHeight: 220 }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, color: palette.text }}>最近操作活动</h3>
              {activity.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: palette.textMute, fontSize: 13 }}>
                  暂无活动记录，创建资产或发起扫描后将在此显示
                </div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 8 }}>
                <Timeline
                  items={activity.slice(0, 20).map((item) => {
                    const cfg = activityConfig[item.type] ?? { color: 'gray', icon: null, label: item.type };
                    return {
                      color: cfg.color,
                      dot: cfg.icon ? <span style={{ fontSize: 12 }}>{cfg.icon}</span> : undefined,
                      children: (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <Tag style={{ borderRadius: 4, fontSize: 11, lineHeight: '18px', padding: '0 5px', margin: 0 }} color={cfg.color}>
                              {cfg.label}
                            </Tag>
                            <span style={{ fontSize: 11, color: palette.textMute }}>{formatRelativeTime(item.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{item.message}</div>
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

        {/* 资产类型分布 */}
        <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
          <Col xs={24}>
            <div style={{ ...cardStyle, padding: 24 }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, color: palette.text }}>资产类型分布</h3>
              {(() => {
                const types = [
                  { label: '物理服务器', val: stats?.servers ?? 0, color: '#0d9488' },
                  { label: '网络交换机', val: stats?.switches ?? 0, color: '#16a34a' },
                  { label: '核心路由器', val: stats?.routers ?? 0, color: '#ea580c' },
                  { label: '其他设备', val: stats?.other ?? 0, color: palette.primary },
                ];
                const total = types.reduce((a, t) => a + t.val, 0) || 1;
                return (
                  <>
                    <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#eef1f6' }}>
                      {types.map((t) =>
                        t.val > 0 ? (
                          <div key={t.label} style={{ width: `${(t.val / total) * 100}%`, background: t.color }} title={`${t.label}: ${t.val}`} />
                        ) : null
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 16 }}>
                      {types.map((t) => (
                        <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, display: 'inline-block' }} />
                          <span style={{ fontSize: 14, color: palette.text, fontWeight: 700 }}>{t.val}</span>
                          <span style={{ fontSize: 12, color: palette.textSub }}>{t.label}</span>
                          <span style={{ fontSize: 11, color: palette.textMute }}>({Math.round((t.val / total) * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </Col>
        </Row>

        {/* 快速开始 */}
        <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
          <Col xs={24}>
            <div style={{ ...cardStyle, padding: 24 }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, color: palette.text }}>快速开始</h3>
              <Row gutter={[16, 16]}>
                {[
                  { step: 1, title: '配置登录凭据', desc: '在凭据保管箱创建 SSH 密码或证书私钥，用于自动发现与一键接入。', path: '/credentials' },
                  { step: 2, title: '运行自动发现', desc: '设定 IP 范围（CIDR，如 10.0.0.0/24）与端口，并发扫描搜寻存活资产。', path: '/tasks' },
                  { step: 3, title: '管理 CMDB 资产', desc: '发现的资产自动入库，可绑定凭据、编辑信息、探测在线状态。', path: '/assets' },
                  { step: 4, title: '一键 WebSSH', desc: '绑定凭据后，在资产清单点击「连接终端」即开启网页 SSH 会话。', path: '/assets' },
                ].map(({ step, title, desc, path }) => (
                  <Col xs={24} sm={12} xl={6} key={step}>
                    <div
                      className="mrd-hover-card"
                      onClick={() => navigate(path)}
                      style={{
                        display: 'flex',
                        gap: 12,
                        padding: 16,
                        borderRadius: 10,
                        border: `1px solid ${palette.border}`,
                        background: '#fbfcfe',
                        cursor: 'pointer',
                        height: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          color: '#fff',
                          background: palette.brandGradient,
                          fontWeight: 700,
                          fontSize: 12,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {step}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: palette.text, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {title}
                          <ArrowRightOutlined style={{ fontSize: 11, color: palette.textMute }} />
                        </div>
                        <div style={{ fontSize: 12, color: palette.textSub, lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
};
