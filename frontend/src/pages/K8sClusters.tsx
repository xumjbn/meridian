import React, { useEffect, useState } from 'react';
import {
  Button, Card, Modal, Form, Input, InputNumber, Select, message, Table, Tag, Space,
  Popconfirm, Drawer, Empty, Tooltip,
} from 'antd';
import {
  CloudServerOutlined, PlusOutlined, ReloadOutlined, LinkOutlined, EditOutlined,
  DeleteOutlined, CodeOutlined, ClusterOutlined, ApiOutlined,
} from '@ant-design/icons';
import {
  getK8sClusters, createK8sCluster, updateK8sCluster, deleteK8sCluster, getK8sCluster,
  getUnassignedK8sNodes, assignK8sNodes, unassignK8sNode, getK8sConsole, getCredentials,
  type K8sCluster, type Asset, type Credential,
} from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';
import { useTerminals } from '../terminalSessions';

const roleTag = (role?: string) => {
  if (role === 'control-plane') return <Tag color="blue">control-plane</Tag>;
  if (role === 'worker') return <Tag>worker</Tag>;
  return <Tag>-</Tag>;
};

const statusDot = (status?: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: status === 'online' ? '#10b981' : '#ef4444' }} />
    {status === 'online' ? '在线' : '离线'}
  </span>
);

export const K8sClusters: React.FC = () => {
  const [clusters, setClusters] = useState<K8sCluster[]>([]);
  const [unassigned, setUnassigned] = useState<Asset[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<K8sCluster | null>(null);
  const [form] = Form.useForm();

  const [drawerCluster, setDrawerCluster] = useState<K8sCluster | null>(null);
  const [drawerNodes, setDrawerNodes] = useState<Asset[]>([]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<React.Key[]>([]);
  const [assignClusterId, setAssignClusterId] = useState<number | undefined>();

  const { open: openTerminal } = useTerminals();

  const load = async () => {
    setLoading(true);
    try {
      const [cl, un] = await Promise.all([getK8sClusters(), getUnassignedK8sNodes()]);
      setClusters(cl);
      setUnassigned(un);
    } catch (e: any) {
      message.error(e?.message || '加载 Kubernetes 集群失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getCredentials().then(setCreds).catch(() => {});
  }, []);

  // 一键打开控制台：
  // - console_path 含 {username}/{password} 占位符 → 用绑定凭据替换，真·一键免登
  // - 否则复制绑定密码 + 新标签打开（浏览器不能跨域自动填表单）
  const openConsole = async (id: number) => {
    try {
      const { url, username, password } = await getK8sConsole(id);
      const hasTpl = url.includes('{username}') || url.includes('{password}');
      const finalUrl = url
        .replace(/\{username\}/g, encodeURIComponent(username || ''))
        .replace(/\{password\}/g, encodeURIComponent(password || ''));
      if (!hasTpl && password) await navigator.clipboard?.writeText(password).catch(() => {});
      window.open(finalUrl, '_blank', 'noopener');
      message.success(
        hasTpl
          ? '已打开控制台（已用绑定凭据自动登录）'
          : password
          ? `已打开控制台，密码已复制到剪贴板（账号：${username || '-'}），粘贴即可登录`
          : '已打开控制台（该集群未绑定凭据）',
      );
    } catch (e: any) {
      message.error(e?.message || '打开控制台失败');
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ console_port: 443, console_path: '/' });
    setModalOpen(true);
  };
  const openEdit = (cl: K8sCluster) => {
    setEditing(cl);
    form.setFieldsValue(cl);
    setModalOpen(true);
  };
  const submit = async (values: K8sCluster) => {
    try {
      if (editing?.id) await updateK8sCluster(editing.id, values);
      else await createK8sCluster(values);
      message.success('已保存');
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    }
  };
  const remove = async (id: number) => {
    try {
      await deleteK8sCluster(id);
      message.success('集群已删除（节点保留）');
      load();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const openNodes = async (cl: K8sCluster) => {
    try {
      const { cluster, nodes } = await getK8sCluster(cl.id!);
      setDrawerCluster(cluster);
      setDrawerNodes(nodes);
    } catch (e: any) {
      message.error(e?.message || '加载节点失败');
    }
  };
  const unassign = async (assetId: number) => {
    if (!drawerCluster) return;
    await unassignK8sNode(drawerCluster.id!, assetId);
    message.success('已移出集群');
    openNodes(drawerCluster);
    load();
  };

  const doAssign = async () => {
    if (!assignClusterId || selectedNodeIds.length === 0) {
      message.warning('请勾选节点并选择目标集群');
      return;
    }
    try {
      await assignK8sNodes(assignClusterId, selectedNodeIds as number[]);
      message.success(`已归类 ${selectedNodeIds.length} 个节点`);
      setSelectedNodeIds([]);
      load();
    } catch (e: any) {
      message.error(e?.message || '归类失败');
    }
  };

  const toTerminal = (a: Asset) => a.id && openTerminal({ id: a.id, name: a.name, ip: a.ip });

  const unassignedCols = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
    { title: '角色', dataIndex: 'k8s_role', key: 'role', width: 130, render: roleTag },
    { title: 'K8s 版本', dataIndex: 'os_version', key: 'ver', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: statusDot },
    {
      title: '操作', key: 'act', width: 90,
      render: (_: unknown, a: Asset) => (
        <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => toTerminal(a)}>终端</Button>
      ),
    },
  ];

  const nodeCols = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
    { title: '角色', dataIndex: 'k8s_role', key: 'role', width: 130, render: roleTag },
    { title: 'K8s 版本', dataIndex: 'os_version', key: 'ver', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: statusDot },
    {
      title: '操作', key: 'act', width: 150,
      render: (_: unknown, a: Asset) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => toTerminal(a)}>终端</Button>
          <Popconfirm title="移出该集群？（资产保留）" onConfirm={() => unassign(a.id!)} okText="移出" cancelText="取消">
            <Button type="link" size="small" danger>移出</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="Kubernetes 集群"
        subtitle="把扫描发现的 K8s 节点归类为集群，一键跳转控制台（VIP:443）"
        icon={<CloudServerOutlined />}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建集群</Button>
          </Space>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        {/* 集群卡片 */}
        {clusters.length === 0 ? (
          <div style={{ ...cardStyle, padding: 40, textAlign: 'center', marginBottom: 24 }}>
            <Empty description="还没有集群，先「新建集群」并把下方探测到的 K8s 节点归类进来" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
            {clusters.map((cl) => (
              <Card key={cl.id} style={{ width: 360, ...cardStyle }} styles={{ body: { padding: 16 } }} className="mrd-hover-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <ClusterOutlined style={{ color: '#326ce5', fontSize: 18 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: palette.text }}>{cl.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textSub }}>{statusDot(cl.online ? 'online' : 'offline')}</span>
                </div>
                <div style={{ fontSize: 13, color: palette.textSub, marginBottom: 4 }}>
                  <ApiOutlined /> VIP <span style={{ fontFamily: 'monospace' }}>{cl.vip}:{cl.console_port}</span>
                </div>
                <div style={{ fontSize: 13, color: palette.textSub, marginBottom: 4 }}>
                  节点 {cl.node_count}（master {cl.master_count} / worker {(cl.node_count || 0) - (cl.master_count || 0)}）
                </div>
                <div style={{ fontSize: 12, color: palette.textMute, marginBottom: 12 }}>
                  凭据：{cl.cred_name || <span style={{ color: '#f59e0b' }}>未绑定</span>}
                </div>
                <Space wrap>
                  <Tooltip title="打开 VIP:443 控制台并复制绑定密码">
                    <Button type="primary" size="small" icon={<LinkOutlined />} onClick={() => openConsole(cl.id!)}>打开控制台</Button>
                  </Tooltip>
                  <Button size="small" onClick={() => openNodes(cl)}>节点</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(cl)} />
                  <Popconfirm title={`删除集群「${cl.name}」？节点会被解除归属但保留`} onConfirm={() => remove(cl.id!)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </Card>
            ))}
          </div>
        )}

        {/* 未归类 K8s 节点 */}
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: palette.text }}>
              未归类 K8s 节点（{unassigned.length}）
            </span>
            <Space>
              <Select
                placeholder="归类到集群…"
                size="small"
                style={{ width: 200 }}
                value={assignClusterId}
                onChange={setAssignClusterId}
                options={clusters.map((c) => ({ label: `${c.name} (${c.vip})`, value: c.id }))}
                disabled={clusters.length === 0}
              />
              <Button size="small" type="primary" onClick={doAssign} disabled={selectedNodeIds.length === 0}>
                归类（{selectedNodeIds.length}）
              </Button>
            </Space>
          </div>
          <Table
            columns={unassignedCols}
            dataSource={unassigned}
            rowKey="id"
            size="small"
            loading={loading}
            rowSelection={{ selectedRowKeys: selectedNodeIds, onChange: setSelectedNodeIds }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: '暂无未归类的 K8s 节点（在「自动发现」任务里勾选「探测 Kubernetes 节点」即可发现）' }}
          />
        </div>
      </div>

      {/* 新建/编辑集群 */}
      <Modal
        open={modalOpen}
        title={editing ? '编辑集群' : '新建集群'}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ console_port: 443, console_path: '/' }}>
          <Form.Item label="集群名称" name="name" rules={[{ required: true, message: '请输入集群名称' }]}>
            <Input placeholder="如 prod-cluster" />
          </Form.Item>
          <Form.Item label="VIP（控制台/控制平面虚拟 IP）" name="vip" rules={[{ required: true, message: '请输入 VIP' }]}>
            <Input placeholder="如 10.0.0.250" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="控制台端口" name="console_port" style={{ width: 140 }}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="控制台路径" name="console_path" style={{ flex: 1, minWidth: 260 }}
              tooltip="如 /#/login、/dashboard/，默认 /。支持占位符 {username}/{password}：控制台若接受 URL 传凭据/Token（如 /login?token={password}），即可真·一键免登；否则点开后自动复制密码粘贴登录。">
              <Input placeholder="/  或  /login?token={password}" />
            </Form.Item>
          </Space>
          <Form.Item label="绑定登录凭据" name="credential_id" tooltip="点「打开控制台」时复制该凭据的密码到剪贴板">
            <Select allowClear placeholder="选择控制台登录凭据（账号/密码）"
              options={creds.map((c) => ({ label: `${c.name} (${c.username})`, value: c.id }))} />
          </Form.Item>
          <Form.Item label="API Server（可选）" name="api_server" tooltip="默认 VIP:6443">
            <Input placeholder="如 10.0.0.250:6443" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="备注用途、环境等" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 集群节点抽屉 */}
      <Drawer
        open={!!drawerCluster}
        onClose={() => setDrawerCluster(null)}
        width={680}
        title={drawerCluster ? `集群节点 · ${drawerCluster.name}` : ''}
        extra={drawerCluster && (
          <Button type="primary" icon={<LinkOutlined />} onClick={() => openConsole(drawerCluster.id!)}>打开控制台</Button>
        )}
      >
        {drawerCluster && (
          <div style={{ marginBottom: 12, fontSize: 13, color: palette.textSub }}>
            VIP <span style={{ fontFamily: 'monospace' }}>{drawerCluster.vip}:{drawerCluster.console_port}</span>
            　·　凭据 {drawerCluster.cred_name || '未绑定'}
          </div>
        )}
        <Table columns={nodeCols} dataSource={drawerNodes} rowKey="id" size="small"
          pagination={false} locale={{ emptyText: '该集群暂无节点，请在「未归类 K8s 节点」中归类' }} />
      </Drawer>
    </div>
  );
};

export default K8sClusters;
