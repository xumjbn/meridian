import React, { useEffect, useState } from 'react';
import { Table, Tag, Input, Select, Button, Space, message } from 'antd';
import { ReloadOutlined, FileSearchOutlined } from '@ant-design/icons';
import { getAuditLogs, type AuditLog } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';

const { Option } = Select;

// 把「方法 + 路径」翻译成易读的中文动作
const describeAction = (action: string, rawPath: string): string => {
  const p = rawPath.replace(/^\/api/, '');
  const rules: Array<[boolean, string]> = [
    [action === 'POST' && p === '/login', '登录'],
    [action === 'POST' && p === '/logout', '退出登录'],
    [action === 'POST' && p === '/register', '注册账号'],
    [action === 'POST' && p === '/users/change-password', '修改密码'],
    [action === 'POST' && p === '/users', '新增用户'],
    [action === 'PUT' && /^\/users\/\d+$/.test(p), '更新用户'],
    [action === 'DELETE' && /^\/users\/\d+$/.test(p), '删除用户'],
    [action === 'POST' && p === '/assets', '新建资产'],
    [action === 'PUT' && /^\/assets\/\d+$/.test(p), '更新资产'],
    [action === 'DELETE' && /^\/assets\/\d+$/.test(p), '删除资产'],
    [action === 'POST' && /^\/assets\/\d+\/collect$/.test(p), '认证采集'],
    [action === 'POST' && /^\/assets\/\d+\/ping$/.test(p), '资产探测'],
    [action === 'POST' && p === '/assets/batch-ping', '批量探测'],
    [action === 'POST' && p === '/credentials', '新建凭据'],
    [action === 'PUT' && /^\/credentials\/\d+$/.test(p), '更新凭据'],
    [action === 'DELETE' && /^\/credentials\/\d+$/.test(p), '删除凭据'],
    [action === 'POST' && /^\/credentials\/\d+\/test$/.test(p), '测试凭据'],
    [action === 'POST' && p === '/tasks', '新建扫描任务'],
    [action === 'PUT' && /^\/tasks\/\d+$/.test(p), '更新扫描任务'],
    [action === 'DELETE' && /^\/tasks\/\d+$/.test(p), '删除扫描任务'],
    [action === 'POST' && /^\/tasks\/\d+\/run$/.test(p), '运行扫描'],
    [action === 'POST' && /^\/tasks\/\d+\/stop$/.test(p), '停止扫描'],
    [action === 'POST' && p === '/tags', '新建标签'],
    [action === 'PUT' && /^\/tags\/\d+$/.test(p), '更新标签'],
    [action === 'DELETE' && /^\/tags\/\d+$/.test(p), '删除标签'],
    [action === 'PUT' && p === '/settings', '更新系统设置'],
  ];
  const hit = rules.find(([cond]) => cond);
  return hit ? hit[1] : `${action} ${p}`;
};

const methodColor: Record<string, string> = { POST: 'green', PUT: 'blue', DELETE: 'red' };

export const Audit: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState<string | undefined>(undefined);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await getAuditLogs({
        actor: actor.trim() || undefined,
        action,
        limit: 300,
      });
      setLogs(data);
    } catch (e: any) {
      message.error(e?.message || '获取审计日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (t: string) => <span>{t ? new Date(t).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作人',
      dataIndex: 'actor',
      key: 'actor',
      width: 140,
      render: (a: string) => (a ? <span style={{ fontWeight: 500 }}>{a}</span> : <span style={{ color: '#cbd5e1' }}>匿名</span>),
    },
    {
      title: '动作',
      key: 'action',
      render: (_: unknown, r: AuditLog) => (
        <Space size={8}>
          <Tag color={methodColor[r.action] || 'default'} style={{ borderRadius: 4, fontFamily: 'monospace' }}>{r.action}</Tag>
          <span>{describeAction(r.action, r.path)}</span>
        </Space>
      ),
    },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      render: (p: string) => <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{p}</span>,
    },
    {
      title: '结果',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: number) =>
        s === 200 ? (
          <Tag color="green" style={{ borderRadius: 4 }}>成功</Tag>
        ) : (
          <Tag color={s === 401 || s === 403 ? 'red' : 'orange'} style={{ borderRadius: 4 }}>失败 {s || ''}</Tag>
        ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 140,
      render: (ip: string) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{ip || '-'}</span>,
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="审计日志"
        subtitle="记录所有写操作的操作人、动作、结果与来源 IP"
        icon={<FileSearchOutlined />}
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchLogs} loading={loading}>
            刷新
          </Button>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        <Space style={{ marginBottom: 16 }} size={12} wrap>
          <Input
            placeholder="按操作人筛选"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            onPressEnter={fetchLogs}
            allowClear
            style={{ width: 200 }}
          />
          <Select
            placeholder="动作类型"
            value={action}
            onChange={(v) => setAction(v)}
            allowClear
            style={{ width: 160 }}
          >
            <Option value="POST">POST（新增/执行）</Option>
            <Option value="PUT">PUT（更新）</Option>
            <Option value="DELETE">DELETE（删除）</Option>
          </Select>
          <Button type="primary" onClick={fetchLogs}>查询</Button>
        </Space>

        <div style={{ ...cardStyle, padding: 4 }}>
          <Table
            columns={columns}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            size="middle"
            pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </div>
      </div>
    </div>
  );
};

export default Audit;
