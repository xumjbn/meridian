import React, { useEffect, useState } from 'react';
import { Table, Tag, Input, Select, Button, Space, message } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import { getAuditLogs, type AuditLog } from '../services/api';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';

const { Option } = Select;

type TextFn = (key: string, values?: Record<string, string | number>) => string;

// 把「方法 + 路径」翻译成易读的动作描述
const describeAction = (action: string, rawPath: string, text: TextFn): string => {
  const p = rawPath.replace(/^\/api/, '');
  const rules: Array<[boolean, string]> = [
    [action === 'POST' && p === '/login', text('audit.act.login')],
    [action === 'POST' && p === '/logout', text('audit.act.logout')],
    [action === 'POST' && p === '/register', text('audit.act.register')],
    [action === 'POST' && p === '/users/change-password', text('audit.act.changePassword')],
    [action === 'POST' && p === '/users', text('audit.act.userCreate')],
    [action === 'PUT' && /^\/users\/\d+$/.test(p), text('audit.act.userUpdate')],
    [action === 'DELETE' && /^\/users\/\d+$/.test(p), text('audit.act.userDelete')],
    [action === 'POST' && p === '/assets', text('audit.act.assetCreate')],
    [action === 'PUT' && /^\/assets\/\d+$/.test(p), text('audit.act.assetUpdate')],
    [action === 'DELETE' && /^\/assets\/\d+$/.test(p), text('audit.act.assetDelete')],
    [action === 'POST' && /^\/assets\/\d+\/collect$/.test(p), text('audit.act.assetCollect')],
    [action === 'POST' && /^\/assets\/\d+\/ping$/.test(p), text('audit.act.assetPing')],
    [action === 'POST' && p === '/assets/batch-ping', text('audit.act.assetBatchPing')],
    [action === 'POST' && p === '/credentials', text('audit.act.credCreate')],
    [action === 'PUT' && /^\/credentials\/\d+$/.test(p), text('audit.act.credUpdate')],
    [action === 'DELETE' && /^\/credentials\/\d+$/.test(p), text('audit.act.credDelete')],
    [action === 'POST' && /^\/credentials\/\d+\/test$/.test(p), text('audit.act.credTest')],
    [action === 'POST' && p === '/tasks', text('audit.act.taskCreate')],
    [action === 'PUT' && /^\/tasks\/\d+$/.test(p), text('audit.act.taskUpdate')],
    [action === 'DELETE' && /^\/tasks\/\d+$/.test(p), text('audit.act.taskDelete')],
    [action === 'POST' && /^\/tasks\/\d+\/run$/.test(p), text('audit.act.taskRun')],
    [action === 'POST' && /^\/tasks\/\d+\/stop$/.test(p), text('audit.act.taskStop')],
    [action === 'POST' && p === '/tags', text('audit.act.tagCreate')],
    [action === 'PUT' && /^\/tags\/\d+$/.test(p), text('audit.act.tagUpdate')],
    [action === 'DELETE' && /^\/tags\/\d+$/.test(p), text('audit.act.tagDelete')],
    [action === 'PUT' && p === '/settings', text('audit.act.settingsUpdate')],
    [action === 'LIST', text('audit.act.sftpList', { path: p })],
    [action === 'DOWNLOAD', text('audit.act.sftpDownload', { path: p })],
    [action === 'UPLOAD', text('audit.act.sftpUpload', { path: p })],
    [action === 'MKDIR', text('audit.act.sftpMkdir', { path: p })],
    [action === 'RENAME', text('audit.act.sftpRename', { path: p })],
    // 「资产#」是后端写进审计路径的前缀（SFTP 操作），属于数据不是界面文案，不参与翻译
    [action === 'DELETE' && p.startsWith('资产#'), text('audit.act.sftpDelete', { path: p })],
  ];
  const hit = rules.find(([cond]) => cond);
  return hit ? hit[1] : `${action} ${p}`;
};

const methodColor: Record<string, string> = {
  POST: 'green', PUT: 'blue', DELETE: 'red',
  DOWNLOAD: 'geekblue', UPLOAD: 'cyan', LIST: 'default',
  MKDIR: 'purple', RENAME: 'gold',
};

export const Audit: React.FC = () => {
  const { text } = useI18n();
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
      message.error(e?.message || text('audit.loadFailed'));
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
      title: text('audit.col.time'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v: string) => <span>{v ? new Date(v).toLocaleString() : '-'}</span>,
    },
    {
      title: text('audit.col.actor'),
      dataIndex: 'actor',
      key: 'actor',
      width: 140,
      render: (a: string) =>
        a ? <span style={{ fontWeight: 500 }}>{a}</span> : <span style={{ color: '#cbd5e1' }}>{text('audit.anonymous')}</span>,
    },
    {
      title: text('audit.col.action'),
      key: 'action',
      render: (_: unknown, r: AuditLog) => (
        <Space size={8}>
          <Tag color={methodColor[r.action] || 'default'} style={{ borderRadius: 4, fontFamily: 'monospace' }}>{r.action}</Tag>
          <span>{describeAction(r.action, r.path, text)}</span>
        </Space>
      ),
    },
    {
      title: text('audit.col.path'),
      dataIndex: 'path',
      key: 'path',
      render: (p: string) => <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{p}</span>,
    },
    {
      title: text('audit.col.result'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: number) =>
        s === 200 ? (
          <Tag color="green" style={{ borderRadius: 4 }}>{text('audit.success')}</Tag>
        ) : (
          <Tag color={s === 401 || s === 403 ? 'red' : 'orange'} style={{ borderRadius: 4 }}>
            {text('audit.failed')} {s || ''}
          </Tag>
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
    <div style={{ background: palette.bg, minHeight: '100%' }}>

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        <div style={tablePanelStyle}>
          <TableToolbar
            title={text('audit.title')}
            subtitle={text('audit.subtitle')}
            icon={<FileSearchOutlined />}
            onRefresh={fetchLogs}
            loading={loading}
            left={
              <>
                <Input
                  placeholder={text('audit.filterActor')}
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  onPressEnter={fetchLogs}
                  allowClear
                  style={{ width: 190 }}
                />
                <Select
                  placeholder={text('audit.filterAction')}
                  value={action}
                  onChange={(v) => setAction(v)}
                  allowClear
                  style={{ width: 165 }}
                >
                  <Option value="POST">{text('audit.method.post')}</Option>
                  <Option value="PUT">{text('audit.method.put')}</Option>
                  <Option value="DELETE">{text('audit.method.delete')}</Option>
                </Select>
                <Button type="primary" onClick={fetchLogs}>{text('audit.query')}</Button>
              </>
            }
          />
          <Table
            className="wjw-table"
            columns={columns}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            size="middle"
            pagination={{
              pageSize: 15,
              showSizeChanger: false,
              showTotal: (t) => text('common.totalItems', { count: t }),
              style: { padding: '0 16px' },
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Audit;
