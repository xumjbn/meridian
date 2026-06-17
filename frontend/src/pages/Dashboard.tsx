import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Progress, Spin, message, Space, Button, Timeline, Tag } from 'antd';
import {
  DesktopOutlined,
  ApartmentOutlined,
  BuildOutlined,
  LinkOutlined,
  ReloadOutlined,
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { getStats, getRecentActivity, type Stats, type ActivityLog } from '../services/api';

// 活动类型配置
const activityConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  asset_created:    { color: 'green',  icon: <PlusCircleOutlined />,   label: '资产创建' },
  asset_updated:    { color: 'blue',   icon: <EditOutlined />,          label: '资产更新' },
  asset_deleted:    { color: 'red',    icon: <DeleteOutlined />,        label: '资产删除' },
  scan_started:     { color: 'blue',   icon: <PlayCircleOutlined />,    label: '扫描启动' },
  scan_completed:   { color: 'green',  icon: <CheckCircleOutlined />,   label: '扫描完成' },
  scan_failed:      { color: 'red',    icon: <CloseCircleOutlined />,   label: '扫描失败' },
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
    // 5 秒轮询；若有运行中任务则加快至 2 秒
    const interval = setInterval(() => {
      fetchAll(false);
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

  const onlineRate = stats && stats.total_assets > 0
    ? Math.round((stats.online_assets / stats.total_assets) * 100)
    : 0;

  const statCards = [
    { label: '总资产数量',   value: stats?.total_assets,  icon: <BuildOutlined />,     bg: '#eff6ff', color: '#2563eb' },
    { label: '物理服务器',   value: stats?.servers,        icon: <DesktopOutlined />,   bg: '#f0fdfa', color: '#0d9488' },
    { label: '网络交换机',   value: stats?.switches,       icon: <ApartmentOutlined />, bg: '#f0fdf4', color: '#16a34a' },
    { label: '核心路由器',   value: stats?.routers,        icon: <LinkOutlined />,      bg: '#fff7ed', color: '#ea580c' },
  ];

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
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>控制台首页</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>实时资产状况监控与自动发现扫描任务概览</p>
        </div>
        <Space size="middle">
          {stats?.running_tasks && stats.running_tasks > 0 ? (
            <span style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
              <Spin size="small" /> 自动发现扫描执行中...
            </span>
          ) : null}
          <Button
            type="text"
            icon={<ReloadOutlined style={{ color: '#64748b' }} />}
            onClick={() => fetchAll(true)}
            style={{ borderRadius: 6 }}
          />
        </Space>
      </div>

      <div style={{ padding: '32px' }}>
        {/* 统计卡片行 */}
        <Row gutter={[20, 20]}>
          {statCards.map((card) => (
            <Col xs={24} sm={12} md={6} key={card.label}>
              <div style={{
                background: '#ffffff',
                border: '1px solid #f1f5f9',
                borderRadius: 8,
                padding: '20px',
                boxShadow: '0 1px 2px 0 rgba(0,0,0,0.02)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>{card.label}</span>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: 6,
                    background: card.bg, color: card.color,
                  }}>
                    {React.cloneElement(card.icon as React.ReactElement, { style: { fontSize: 16 } })}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>
                    {card.value ?? 0}
                  </span>
                </div>
              </div>
            </Col>
          ))}
        </Row>

        {/* 在线率 + 活动时间线 */}
        <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
          {/* 在线率 */}
          <Col xs={24} md={12}>
            <div style={{
              background: '#ffffff',
              border: '1px solid #f1f5f9',
              borderRadius: 8,
              padding: '24px',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.02)',
            }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>资产存活率分析</h3>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', minHeight: 160 }}>
                <Progress
                  type="circle"
                  percent={onlineRate}
                  strokeColor={{ '0%': '#10b981', '100%': '#2563eb' }}
                  trailColor="#f1f5f9"
                  width={130}
                  format={(percent) => (
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>{percent}%</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>在线比例</div>
                    </div>
                  )}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>在线 ({stats?.online_assets ?? 0})</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12, paddingLeft: 16, marginTop: 2 }}>端口探测响应正常</div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>离线 ({stats?.offline_assets ?? 0})</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12, paddingLeft: 16, marginTop: 2 }}>检测不到端口响应</div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                        未知 ({(stats?.total_assets ?? 0) - (stats?.online_assets ?? 0) - (stats?.offline_assets ?? 0)})
                      </span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12, paddingLeft: 16, marginTop: 2 }}>尚未进行探测</div>
                  </div>
                </div>
              </div>
            </div>
          </Col>

          {/* 最近活动时间线 */}
          <Col xs={24} md={12}>
            <div style={{
              background: '#ffffff',
              border: '1px solid #f1f5f9',
              borderRadius: 8,
              padding: '24px',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.02)',
              minHeight: 220,
            }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>最近操作活动</h3>
              {activity.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>
                  暂无活动记录，开始创建资产或扫描任务后将在此显示
                </div>
              ) : (
                <Timeline
                  items={activity.slice(0, 8).map((item) => {
                    const cfg = activityConfig[item.type] ?? { color: 'gray', icon: null, label: item.type };
                    return {
                      color: cfg.color,
                      dot: cfg.icon ? (
                        <span style={{ fontSize: 12 }}>{cfg.icon}</span>
                      ) : undefined,
                      children: (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <Tag
                              style={{ borderRadius: 4, fontSize: 11, lineHeight: '18px', padding: '0 5px', margin: 0 }}
                              color={cfg.color}
                            >
                              {cfg.label}
                            </Tag>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatRelativeTime(item.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{item.message}</div>
                        </div>
                      ),
                    };
                  })}
                />
              )}
            </div>
          </Col>
        </Row>

        {/* 使用指南 */}
        <Row gutter={[20, 20]} style={{ marginTop: 20 }}>
          <Col xs={24}>
            <div style={{
              background: '#ffffff',
              border: '1px solid #f1f5f9',
              borderRadius: 8,
              padding: '24px',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.02)',
            }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>快速开始指南</h3>
              <Row gutter={[32, 16]}>
                {[
                  {
                    step: 1,
                    title: '配置登录凭据 Vault',
                    desc: '在凭据管理中创建 SSH 密码或证书私钥，用于远程一键自动连接资产设备。',
                    path: '/credentials',
                  },
                  {
                    step: 2,
                    title: '运行自动发现网络扫描',
                    desc: '设定 IP 范围（支持 CIDR，如 10.0.0.0/24）和端口，一键发起并发扫描，搜寻存活资产。',
                    path: '/tasks',
                  },
                  {
                    step: 3,
                    title: '管理 CMDB 资产',
                    desc: '发现的资产自动同步到资产列表，支持绑定凭据、编辑信息、探测在线状态。',
                    path: '/assets',
                  },
                  {
                    step: 4,
                    title: '直接启动 WebSSH 控制台',
                    desc: '绑定凭据后，在资产列表点击「连接终端」即可一键开启网页 SSH 会话。',
                    path: '/assets',
                  },
                ].map(({ step, title, desc }) => (
                  <Col xs={24} sm={12} md={6} key={step}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        border: '1px solid #e2e8f0', color: '#64748b',
                        fontWeight: 600, fontSize: 12, flexShrink: 0,
                        background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {step}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{title}</div>
                        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{desc}</div>
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
