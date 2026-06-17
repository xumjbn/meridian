import React, { useEffect, useState } from 'react';
import { Table, Button, Tag, Typography, message } from 'antd';
import { BugOutlined, ReloadOutlined } from '@ant-design/icons';
import { getVulns, type VulnFinding } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';

const { Text } = Typography;

const severityMap: Record<string, { label: string; color: string }> = {
  critical: { label: '严重', color: 'red' },
  high: { label: '高危', color: 'volcano' },
  medium: { label: '中危', color: 'gold' },
  low: { label: '低危', color: 'blue' },
  info: { label: '信息', color: 'default' },
};

export const Vulns: React.FC = () => {
  const [findings, setFindings] = useState<VulnFinding[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data = await getVulns();
      setFindings(data);
    } catch (e) {
      message.error('获取漏洞发现列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns = [
    {
      title: '严重程度',
      dataIndex: 'severity',
      key: 'severity',
      render: (severity: string) => {
        const info = severityMap[severity] || { label: severity, color: 'default' };
        return <Tag color={info.color} style={{ borderRadius: 4 }}>{info.label}</Tag>;
      },
    },
    {
      title: '漏洞名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500, color: palette.text }}>{text}</span>,
    },
    {
      title: '模板',
      dataIndex: 'template_id',
      key: 'template_id',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: palette.textSub }}>{text}</span>,
    },
    {
      title: '目标',
      dataIndex: 'target',
      key: 'target',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#334155' }}>{text}</span>,
    },
    {
      title: '引擎',
      dataIndex: 'engine',
      key: 'engine',
      render: (text: string) => <Text type="secondary">{text}</Text>,
    },
    {
      title: '发现时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => (text ? new Date(text).toLocaleString() : <Text type="secondary">-</Text>),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="漏洞发现"
        subtitle="nuclei 漏洞扫描结果"
        icon={<BugOutlined />}
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        <div style={{ ...cardStyle, padding: 4 }}>
          <Table
            columns={columns}
            dataSource={findings}
            rowKey="id"
            loading={loading}
            locale={{ emptyText: '暂无漏洞发现记录' }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </div>
      </div>
    </div>
  );
};
