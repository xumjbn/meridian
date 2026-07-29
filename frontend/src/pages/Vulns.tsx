import React, { useEffect, useState } from 'react';
import { Table, Tag, Typography, message } from 'antd';
import { BugOutlined } from '@ant-design/icons';
import { getVulns, type VulnFinding } from '../services/api';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';

const { Text } = Typography;

// 严重程度只保留颜色，文案走词条（vuln.sev.*）
const severityColor: Record<string, string> = {
  critical: 'red',
  high: 'volcano',
  medium: 'gold',
  low: 'blue',
  info: 'default',
};

export const Vulns: React.FC = () => {
  const { text } = useI18n();
  const [findings, setFindings] = useState<VulnFinding[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data = await getVulns();
      setFindings(data);
    } catch {
      message.error(text('vuln.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // 注意：render 的入参原来叫 text，会把 i18n 的 text() 遮蔽掉，统一改名为 v
  const columns = [
    {
      title: text('vuln.col.severity'),
      dataIndex: 'severity',
      key: 'severity',
      render: (severity: string) => {
        const color = severityColor[severity] || 'default';
        const label = severityColor[severity] ? text(`vuln.sev.${severity}`) : severity;
        return <Tag color={color} style={{ borderRadius: 4 }}>{label}</Tag>;
      },
    },
    {
      title: text('vuln.col.name'),
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500, color: palette.text }}>{v}</span>,
    },
    {
      title: text('vuln.col.template'),
      dataIndex: 'template_id',
      key: 'template_id',
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: palette.textSub }}>{v}</span>,
    },
    {
      title: text('vuln.col.target'),
      dataIndex: 'target',
      key: 'target',
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#334155' }}>{v}</span>,
    },
    {
      title: text('vuln.col.engine'),
      dataIndex: 'engine',
      key: 'engine',
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
    {
      title: text('vuln.col.foundAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => (v ? new Date(v).toLocaleString() : <Text type="secondary">-</Text>),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100%' }}>

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        <div style={tablePanelStyle}>
          <TableToolbar title={text('vuln.title')} subtitle={text('vuln.subtitle')} icon={<BugOutlined />} onRefresh={load} loading={loading} />
          <Table
            className="wjw-table"
            columns={columns}
            dataSource={findings}
            rowKey="id"
            loading={loading}
            locale={{ emptyText: text('vuln.empty') }}
            pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
          />
        </div>
      </div>
    </div>
  );
};
