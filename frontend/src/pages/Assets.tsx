import React, { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Select,
  Drawer,
  Form,
  Badge,
  Tag,
  Popconfirm,
  Typography,
  message,
  Modal,
  Descriptions,
  Card,
  Segmented,
  Collapse,
  Timeline,
  Spin
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  CodeOutlined,
  EditOutlined,
  DeleteOutlined,
  CompassOutlined,
  InfoCircleOutlined,
  SyncOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';
import {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  getCredentials,
  pingAsset,
  collectAsset,
  getAssetHistory,
  type Asset,
  type Credential,
  type AssetHistory
} from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';
import { useTerminals } from '../terminalSessions';

const { Text, Title, Paragraph } = Typography;
const { Option } = Select;

export const Assets: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKey, setSearchKey] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // 正在探测的资产ID映射
  const [pingingIds, setPingingIds] = useState<Record<number, boolean>>({});
  // 正在认证采集的资产ID映射
  const [collectingIds, setCollectingIds] = useState<Record<number, boolean>>({});

  // 在 App 内部打开终端会话（不再新开浏览器标签页）
  const { open: openTerminal } = useTerminals();

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [form] = Form.useForm();

  // 资产详情抽屉
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerAsset, setDrawerAsset] = useState<Asset | null>(null);
  // 抽屉内的变更历史
  const [history, setHistory] = useState<AssetHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 常用功能：批量选择 / 分组
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [groupBy, setGroupBy] = useState<'none' | 'type' | 'status' | 'tag'>('none');

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const data = await getAssets({
        q: searchKey,
        type: filterType,
        status: filterStatus,
      });
      setAssets(data);
    } catch (e) {
      message.error('获取资产列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      const data = await getCredentials();
      setCredentials(data);
    } catch (e) {
      // ignore
    }
  };

  // 搜索输入防抖：停止输入 350ms 后再发起查询，避免逐字符打接口
  useEffect(() => {
    const t = setTimeout(() => setSearchKey(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    fetchAssets();
    fetchCredentials();
  }, [searchKey, filterType, filterStatus]);

  // 抽屉打开时拉取该资产的变更历史
  useEffect(() => {
    if (!drawerVisible || !drawerAsset?.id) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    const id = drawerAsset.id;
    setHistoryLoading(true);
    getAssetHistory(id)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerVisible, drawerAsset?.id]);

  const handleOpenAdd = () => {
    setEditingAsset(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleOpenEdit = (record: Asset) => {
    let formValues = { ...record } as any;
    if (record.tags) {
      try {
        formValues.tags = JSON.parse(record.tags);
      } catch (e) {
        formValues.tags = [];
      }
    } else {
      formValues.tags = [];
    }
    setEditingAsset(record);
    form.setFieldsValue(formValues);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAsset(id);
      message.success('资产已成功删除');
      fetchAssets();
    } catch (e) {
      message.error('删除资产失败');
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      const payload = { ...values };
      if (Array.isArray(values.tags)) {
        payload.tags = JSON.stringify(values.tags);
      } else {
        payload.tags = JSON.stringify([]);
      }

      if (editingAsset && editingAsset.id) {
        await updateAsset(editingAsset.id, payload);
        message.success('资产信息更新成功');
      } else {
        await createAsset(payload);
        message.success('资产添加成功');
      }
      setModalVisible(false);
      fetchAssets();
    } catch (e) {
      message.error('操作失败，IP地址不可重复或格式错误');
    }
  };

  const handleConnectConsole = (record: Asset) => {
    if (record.id == null) return;
    openTerminal({ id: record.id, name: record.name, ip: record.ip });
  };

  const handleShowDetail = (record: Asset) => {
    setDrawerAsset(record);
    setDrawerVisible(true);
  };

  // 单资产在线探测
  const handlePing = async (id: number) => {
    setPingingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await pingAsset(id);
      if (res.status === 'online') {
        message.success(`探测完成：资产 ${res.ip} 在线`);
      } else {
        message.warning(`探测完成：资产 ${res.ip} 离线/不可达`);
      }
      fetchAssets();
      // 如果抽屉正打开且是当前资产，同步更新抽屉内状态
      if (drawerAsset && drawerAsset.id === id) {
        setDrawerAsset((prev) => prev ? { ...prev, status: res.status } : null);
      }
    } catch (e: any) {
      message.error(`探测失败: ${e.message || '网络连接超时'}`);
    } finally {
      setPingingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // 单资产认证采集（采集 CPU 架构 / 系统等信息）
  const handleCollect = async (id: number) => {
    setCollectingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await collectAsset(id);
      if (res.ok) {
        message.success(res.message);
      } else {
        message.warning(res.message);
      }
      fetchAssets();
    } catch (e: any) {
      message.error(`采集失败: ${e.message || '网络连接超时'}`);
    } finally {
      setCollectingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── 常用功能：批量探测 / 批量删除 / 导出 CSV ──────────────
  const handleBatchPing = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    message.loading({ content: `正在批量探测 ${ids.length} 台资产...`, key: 'batch_ping', duration: 0 });
    await Promise.allSettled(ids.map((id) => pingAsset(id)));
    message.success({ content: `已完成 ${ids.length} 台资产探测`, key: 'batch_ping' });
    setSelectedRowKeys([]);
    fetchAssets();
  };

  const handleBatchDelete = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => deleteAsset(id)));
    message.success(`已删除 ${ids.length} 台资产`);
    setSelectedRowKeys([]);
    fetchAssets();
  };

  const handleExportCSV = () => {
    const header = ['名称', 'IP', '类型', '状态', '厂商', '系统', '端口', '标签', '描述'];
    const rows = assets.map((a) => [
      a.name, a.ip, a.type, a.status || '', a.vendor || '', a.os_version || '',
      a.ports || '', a.tags || '', (a.description || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meridian-assets-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${assets.length} 台资产`);
  };

  const typeLabelMap: Record<string, string> = {
    server: 'PC 服务器', switch: '以太网交换机', router: '核心路由器', other: '其他硬件',
  };
  const statusLabelMap: Record<string, string> = { online: '在线', offline: '离线', unknown: '未知' };

  // 按 groupBy 把资产分组 -> [组名, 资产[]][]
  const groupedAssets = (): [string, Asset[]][] => {
    const map = new Map<string, Asset[]>();
    assets.forEach((a) => {
      let keys: string[] = ['其他'];
      if (groupBy === 'type') keys = [typeLabelMap[a.type] || a.type];
      else if (groupBy === 'status') keys = [statusLabelMap[a.status || 'unknown'] || '未知'];
      else if (groupBy === 'tag') {
        let tags: string[] = [];
        try { tags = a.tags ? JSON.parse(a.tags) : []; } catch (e) { tags = []; }
        keys = tags.length ? tags : ['未打标签'];
      }
      keys.forEach((k) => {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      });
    });
    return Array.from(map.entries());
  };

  const renderPorts = (portsStr?: string) => {
    if (!portsStr) return <Text type="secondary">无开放端口</Text>;
    try {
      const ports: number[] = JSON.parse(portsStr);
      if (!Array.isArray(ports) || ports.length === 0) return <Text type="secondary">无开放端口</Text>;
      return (
        <Space size={[0, 4]} wrap>
          {ports.map((port) => {
            let color = 'blue';
            if (port === 22) color = 'green';
            if (port === 23) color = 'red';
            if (port === 80 || port === 443) color = 'cyan';
            if (port === 3306 || port === 5432) color = 'purple';
            return (
              <Tag color={color} key={port} style={{ margin: 0, borderRadius: '4px' }}>
                {port}
              </Tag>
            );
          })}
        </Space>
      );
    } catch (e) {
      return <span style={{ fontFamily: 'monospace' }}>{portsStr}</span>;
    }
  };

  const renderTags = (tagsStr?: string) => {
    if (!tagsStr) return null;
    try {
      const tags: string[] = JSON.parse(tagsStr);
      if (!Array.isArray(tags) || tags.length === 0) return null;
      return (
        <Space size={[0, 4]} wrap>
          {tags.map((tag) => (
            <Tag key={tag} style={{ backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', borderRadius: '4px' }}>
              {tag}
            </Tag>
          ))}
        </Space>
      );
    } catch (e) {
      return null;
    }
  };

  const columns = [
    {
      title: '资产名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Asset) => {
        // 仅展示「系统(厂商) · 架构」与标签：用简洁的 vendor 作为系统，
        // 原始 SSH/Telnet banner（os_version）过于冗长，仅在详情抽屉展示
        const info = [record.vendor, record.arch].filter(Boolean).join(' · ');
        return (
          <Space direction="vertical" size={2}>
            <a onClick={() => handleShowDetail(record)} style={{ fontWeight: 600, color: palette.text }}>
              {text}
            </a>
            <Space size="small" align="center" style={{ flexWrap: 'wrap' }}>
              {info && <Text type="secondary" style={{ fontSize: '11px' }}>{info}</Text>}
              {renderTags(record.tags)}
            </Space>
          </Space>
        );
      },
    },
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      key: 'ip',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500, color: '#334155' }}>{text}</span>,
    },
    {
      title: '设备类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, { label: string; color: string }> = {
          server: { label: 'PC 服务器', color: 'blue' },
          switch: { label: '以太网交换机', color: 'green' },
          router: { label: '核心路由器', color: 'orange' },
          other: { label: '其他硬件', color: 'default' },
        };
        const info = typeMap[type] || { label: type, color: 'default' };
        return <Tag color={info.color} style={{ borderRadius: '4px' }}>{info.label}</Tag>;
      },
    },
    {
      title: '当前状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'online') return <Badge status="success" text="在线" />;
        if (status === 'offline') return <Badge status="error" text="离线" />;
        return <Badge status="default" text="未知" />;
      },
    },
    {
      title: '开放端口',
      dataIndex: 'ports',
      key: 'ports',
      render: (text: string) => renderPorts(text),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Asset) => (
        <Space size="middle">
          <Button
            type="link"
            size="small"
            icon={<CodeOutlined />}
            onClick={() => handleConnectConsole(record)}
            style={{ padding: 0, fontWeight: 500 }}
          >
            连接终端
          </Button>
          <Button
            type="link"
            size="small"
            icon={pingingIds[record.id!] ? <SyncOutlined spin /> : <CompassOutlined />}
            loading={pingingIds[record.id!]}
            onClick={() => handlePing(record.id!)}
            style={{ padding: 0, fontWeight: 500, color: '#0ea5e9' }}
          >
            在线探测
          </Button>
          <Button
            type="link"
            size="small"
            icon={collectingIds[record.id!] ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
            loading={collectingIds[record.id!]}
            onClick={() => handleCollect(record.id!)}
            style={{ padding: 0, fontWeight: 500, color: '#8b5cf6' }}
          >
            采集
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ color: '#475569' }} />}
            onClick={() => handleOpenEdit(record)}
            style={{ padding: 0 }}
          />
          <Popconfirm
            title="确定要删除该资产吗？"
            onConfirm={() => handleDelete(record.id!)}
            okText="是"
            cancelText="否"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} style={{ padding: 0 }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="资产清单 (CMDB)"
        subtitle="登记并维护物理主机与网络设备，支持端口探测与一键交互式 SSH 会话"
        icon={<DatabaseOutlined />}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
            手动录入资产
          </Button>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        {/* 检索 / 过滤 / 分组 / 常用功能 */}
        <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Space wrap size="middle">
              <Input
                placeholder="搜索 IP、设备名称..."
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                style={{ width: 220, borderRadius: 6 }}
                allowClear
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Select placeholder="过滤设备类型" style={{ width: 150 }} allowClear onChange={(val) => setFilterType(val || '')}>
                <Option value="server">PC 服务器</Option>
                <Option value="switch">以太网交换机</Option>
                <Option value="router">核心路由器</Option>
                <Option value="other">其他硬件</Option>
              </Select>
              <Select placeholder="过滤在线状态" style={{ width: 150 }} allowClear onChange={(val) => setFilterStatus(val || '')}>
                <Option value="online">在线</Option>
                <Option value="offline">离线</Option>
                <Option value="unknown">未知</Option>
              </Select>
            </Space>
            <Space wrap size="small">
              <span style={{ fontSize: 12, color: palette.textSub }}>分组</span>
              <Segmented
                value={groupBy}
                onChange={(v) => setGroupBy(v as 'none' | 'type' | 'status' | 'tag')}
                options={[
                  { label: '不分组', value: 'none' },
                  { label: '类型', value: 'type' },
                  { label: '状态', value: 'status' },
                  { label: '标签', value: 'tag' },
                ]}
              />
              <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>导出 CSV</Button>
            </Space>
          </div>

          {/* 批量操作条（选中后出现，未分组视图） */}
          {groupBy === 'none' && selectedRowKeys.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${palette.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: palette.text, fontWeight: 600 }}>已选 {selectedRowKeys.length} 项</span>
              <Button size="small" icon={<CompassOutlined />} onClick={handleBatchPing}>批量探测</Button>
              <Popconfirm
                title={`确认删除选中的 ${selectedRowKeys.length} 台资产？`}
                onConfirm={handleBatchDelete}
                okText="是" cancelText="否" okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>批量删除</Button>
              </Popconfirm>
              <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </div>
          )}
        </div>

        {/* 表格主体 / 分组视图 */}
        {groupBy === 'none' ? (
          <div style={{ ...cardStyle, padding: 4 }}>
            <Table
              columns={columns}
              dataSource={assets}
              rowKey="id"
              loading={loading}
              rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              style={{ borderRadius: 8, overflow: 'hidden' }}
            />
          </div>
        ) : (
          (() => {
            const groups = groupedAssets();
            return (
              <Collapse
                defaultActiveKey={groups.map(([k]) => k)}
                items={groups.map(([k, rows]) => ({
                  key: k,
                  label: (
                    <span style={{ fontWeight: 600, color: palette.text }}>
                      {k} <Tag style={{ marginLeft: 6 }}>{rows.length}</Tag>
                    </span>
                  ),
                  children: (
                    <Table columns={columns} dataSource={rows} rowKey="id" size="small" pagination={false} />
                  ),
                }))}
              />
            );
          })()
        )}

      {/* 手动录入/编辑资产弹窗 */}
      <Modal
        title={editingAsset ? '编辑资产信息' : '手动录入新资产'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnHidden
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item
            label="资产显示名称"
            name="name"
            rules={[{ required: true, message: '请输入资产显示名称' }]}
          >
            <Input placeholder="例如: 腾讯云测试机, 汇聚交换机" />
          </Form.Item>

          <Form.Item
            label="管理 IP 地址"
            name="ip"
            rules={[
              { required: true, message: '请输入有效的 IP 地址' },
              {
                pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
                message: '请输入合法的 IPv4 地址',
              },
            ]}
          >
            <Input placeholder="例如: 192.168.1.100" disabled={!!editingAsset} />
          </Form.Item>

          <Form.Item
            label="资产类型"
            name="type"
            rules={[{ required: true, message: '请选择资产类型' }]}
          >
            <Select placeholder="选择资产硬件类别">
              <Option value="server">PC 服务器</Option>
              <Option value="switch">以太网交换机</Option>
              <Option value="router">核心路由器</Option>
              <Option value="other">其他硬件</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="资产标签"
            name="tags"
          >
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="输入或选择标签，按回车键新增"
              tokenSeparators={[',', ' ']}
            />
          </Form.Item>

          <Form.Item
            label="关联扫描及登录凭证"
            name="credential_id"
          >
            <Select placeholder="选择自动登录凭证 (可留空，连接时手动输入)" allowClear>
              {credentials.map((c) => (
                <Option value={c.id} key={c.id}>
                  {c.name} ({c.username})
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="描述与备忘"
            name="description"
          >
            <Input.TextArea rows={3} placeholder="备注用途、位置、负责人等..." />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 资产详情抽屉 */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <InfoCircleOutlined style={{ color: '#0284c7' }} />
            <span>设备资产详情</span>
          </div>
        }
        placement="right"
        width={520}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        styles={{ body: { padding: '24px' } }}
      >
        {drawerAsset && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingBottom: '24px' }}>
              
              {/* 头部摘要卡片 */}
              <Card style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }} styles={{ body: { padding: '16px' } }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Title level={4} style={{ margin: 0, color: '#0f172a' }}>{drawerAsset.name}</Title>
                    {drawerAsset.status === 'online' ? (
                      <Tag color="green" style={{ borderRadius: '4px', margin: 0 }}>在线</Tag>
                    ) : drawerAsset.status === 'offline' ? (
                      <Tag color="red" style={{ borderRadius: '4px', margin: 0 }}>离线</Tag>
                    ) : (
                      <Tag color="default" style={{ borderRadius: '4px', margin: 0 }}>未知</Tag>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: '13px', color: '#64748b', marginRight: '8px' }}>管理IP:</span>
                    <Text copyable={{ text: drawerAsset.ip }} style={{ fontFamily: 'monospace', fontWeight: 600, color: '#334155', fontSize: '14px' }}>
                      {drawerAsset.ip}
                    </Text>
                  </div>
                  {drawerAsset.tags && (
                    <div style={{ marginTop: '4px' }}>
                      {renderTags(drawerAsset.tags)}
                    </div>
                  )}
                </Space>
              </Card>

              {/* 基础配置项目 */}
              <Descriptions title="基本属性" column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label="硬件类型">
                  {drawerAsset.type === 'server' && 'PC 服务器'}
                  {drawerAsset.type === 'switch' && '以太网交换机'}
                  {drawerAsset.type === 'router' && '核心路由器'}
                  {drawerAsset.type === 'other' && '其他硬件'}
                </Descriptions.Item>
                <Descriptions.Item label="厂商识别">
                  {drawerAsset.vendor || <Text type="secondary">暂无厂商数据 (待扫描)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="系统版本">
                  <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {drawerAsset.os_version || <Text type="secondary">暂无系统信息 (待扫描)</Text>}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="CPU 架构">
                  {drawerAsset.arch ? (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{drawerAsset.arch}</span>
                  ) : (
                    <Text type="secondary">未采集</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="最后扫描时间">
                  {drawerAsset.last_scanned_at ? (
                    new Date(drawerAsset.last_scanned_at).toLocaleString('zh-CN')
                  ) : (
                    <Text type="secondary">从未扫描</Text>
                  )}
                </Descriptions.Item>
              </Descriptions>

              {/* 开放端口 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>探测到开放端口</Title>
                <div style={{ background: '#f8fafc', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {renderPorts(drawerAsset.ports)}
                </div>
              </div>

              {/* 关联凭证和备注 */}
              <Descriptions title="访问凭据与备注" column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label="关联登录凭证">
                  {drawerAsset.credential_id
                    ? credentials.find((c) => c.id === drawerAsset.credential_id)?.name || `凭证 ID: ${drawerAsset.credential_id}`
                    : <Text type="secondary">无绑定 (发起连接时手动输入密码)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="资产备注说明">
                  <Paragraph style={{ margin: 0, fontStyle: drawerAsset.description ? 'normal' : 'italic', color: drawerAsset.description ? '#1e293b' : '#94a3b8' }}>
                    {drawerAsset.description || '无备注说明信息'}
                  </Paragraph>
                </Descriptions.Item>
              </Descriptions>

              {/* 变更历史 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>变更历史</Title>
                <div style={{ background: '#f8fafc', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: '12px' }}><Spin /></div>
                  ) : history.length === 0 ? (
                    <Text type="secondary">暂无变更记录</Text>
                  ) : (
                    <Timeline
                      items={history.map((h) => ({
                        key: h.id,
                        color: 'blue',
                        children: (
                          <div style={{ fontSize: '12px' }}>
                            <div style={{ fontWeight: 600, color: '#334155' }}>{h.field}</div>
                            <div style={{ color: '#475569', margin: '2px 0' }}>
                              <Text delete type="secondary" style={{ fontSize: '12px', marginRight: 4 }}>
                                {h.old_value || '空'}
                              </Text>
                              <span style={{ color: '#94a3b8', margin: '0 4px' }}>→</span>
                              <Text style={{ fontSize: '12px', color: '#0f172a' }}>
                                {h.new_value || '空'}
                              </Text>
                            </div>
                            <div style={{ color: '#94a3b8' }}>
                              {h.created_at ? new Date(h.created_at).toLocaleString('zh-CN') : '-'}
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* 抽屉底部动作栏 */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  style={{ flex: 1, height: '40px', borderColor: '#0ea5e9', color: '#0ea5e9', fontWeight: 500 }}
                  icon={pingingIds[drawerAsset.id!] ? <SyncOutlined spin /> : <CompassOutlined />}
                  loading={pingingIds[drawerAsset.id!]}
                  onClick={() => handlePing(drawerAsset.id!)}
                >
                  在线探测(Ping)
                </Button>
                <Button
                  style={{ height: '40px', width: '45px', padding: 0 }}
                  icon={<EditOutlined />}
                  onClick={() => {
                    handleOpenEdit(drawerAsset);
                  }}
                />
              </div>
              <Button
                type="primary"
                icon={<CodeOutlined />}
                onClick={() => {
                  setDrawerVisible(false);
                  handleConnectConsole(drawerAsset);
                }}
                style={{ width: '100%', height: '42px', fontWeight: 600, background: '#0f172a' }}
              >
                发起 SSH / Telnet 终端会话
              </Button>
            </div>

          </div>
        )}
      </Drawer>
      </div>
    </div>
  );
};
