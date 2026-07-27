import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Popconfirm, Upload, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined, ApiOutlined, UploadOutlined } from '@ant-design/icons';
import { getCredentials, createCredential, updateCredential, deleteCredential, testCredential, type Credential, type CredTestResult } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
const { Option } = Select;
const { TextArea } = Input;

export const Credentials: React.FC = () => {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCred, setEditingCred] = useState<Credential | null>(null);
  const [form] = Form.useForm();
  const [credType, setCredType] = useState<'ssh_password' | 'ssh_key' | 'telnet'>('ssh_password');

  // 连通性测试
  const [testCred, setTestCred] = useState<Credential | null>(null);
  const [testHost, setTestHost] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CredTestResult | null>(null);

  const openTest = (record: Credential) => {
    setTestCred(record);
    setTestHost('');
    setTestResult(null);
    setTesting(false);
  };

  const runTest = async () => {
    if (!testCred?.id || !testHost.trim()) {
      message.warning('请输入目标主机 IP');
      return;
    }
    try {
      setTesting(true);
      setTestResult(null);
      const res = await testCredential(testCred.id, testHost.trim());
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || '测试请求失败' });
    } finally {
      setTesting(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const data = await getCredentials();
      setCredentials(data);
    } catch (e) {
      message.error('获取凭据列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  // 从本地文件读取 SSH 私钥填入表单。私钥全程只在浏览器内读取，
  // 不做任何额外上传请求，随表单一起提交（与手工粘贴等价）。
  const handlePickKeyFile = (file: File) => {
    if (file.size > 64 * 1024) {
      message.error('文件过大，SSH 私钥通常不超过几 KB，请确认选对了文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '').trim();
      if (!/-----BEGIN [\w ]*PRIVATE KEY-----/.test(text)) {
        message.warning('该文件看起来不是 PEM/OpenSSH 私钥（缺少 BEGIN PRIVATE KEY 标记），已仍然填入，请自行确认');
      }
      form.setFieldsValue({ private_key: text });
      message.success(`已导入私钥文件：${file.name}`);
    };
    reader.onerror = () => message.error('读取文件失败');
    reader.readAsText(file);
  };

  const handleOpenAdd = () => {
    setEditingCred(null);
    setCredType('ssh_password');
    form.resetFields();
    setModalVisible(true);
  };

  const handleOpenEdit = (record: Credential) => {
    setEditingCred(record);
    setCredType(record.type);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCredential(id);
      message.success('凭据已成功删除');
      fetchCredentials();
    } catch (e) {
      message.error('删除凭据失败');
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingCred && editingCred.id) {
        await updateCredential(editingCred.id, values);
        message.success('凭据更新成功');
      } else {
        await createCredential(values);
        message.success('凭据创建成功');
      }
      setModalVisible(false);
      fetchCredentials();
    } catch (e) {
      message.error('操作失败，请重试');
    }
  };

  const columns = [
    {
      title: '凭证名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '登录方式',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          ssh_password: 'SSH 密码',
          ssh_key: 'SSH 密钥',
          telnet: 'Telnet 登录',
        };
        return <span style={{ color: '#2563eb', fontWeight: 500 }}>{typeMap[type] || type}</span>;
      },
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <span>{text || '-'}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => <span>{text ? new Date(text).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Credential) => (
        <Space size="middle">
          <Button
            type="link"
            size="small"
            icon={<ApiOutlined />}
            onClick={() => openTest(record)}
            style={{ padding: 0, fontWeight: 500, color: palette.primary }}
          >
            测试连接
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ color: '#475569' }} />}
            onClick={() => handleOpenEdit(record)}
            style={{ padding: 0 }}
          />
          <Popconfirm
            title="确认要删除该凭据吗？"
            onConfirm={() => handleDelete(record.id!)}
            okText="是"
            cancelText="否"
            okButtonProps={{ danger: true }}
          >
            <Button 
              type="text" 
              danger 
              size="small"
              icon={<DeleteOutlined />} 
              style={{ padding: 0 }}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100%' }}>
      <PageHeader
        title="凭据保管箱"
        subtitle="集中管理服务器与网络设备的 SSH/Telnet 账号及证书，用于自动发现与一键连接"
        icon={<SafetyCertificateOutlined />}
      />

      <div style={{ padding: pagePadding }} className="lynx-page-in">
        <div style={tablePanelStyle}>
          <TableToolbar
            onRefresh={fetchCredentials}
            loading={loading}
            left={
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
                添加登录凭证
              </Button>
            }
          />
          <Table
            className="lynx-table"
            columns={columns}
            dataSource={credentials}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
          />
        </div>
      </div>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            {editingCred ? '编辑凭据' : '创建凭据'}
          </div>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ type: 'ssh_password' }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="凭据别名"
            name="name"
            rules={[{ required: true, message: '请输入凭据名称' }]}
          >
            <Input placeholder="例如: 腾讯云测试机, 核心交换机" />
          </Form.Item>

          <Form.Item
            label="登录方式"
            name="type"
            rules={[{ required: true, message: '请选择登录方式' }]}
          >
            <Select onChange={(val) => setCredType(val)}>
              <Option value="ssh_password">SSH 密码登录</Option>
              <Option value="ssh_key">SSH 密钥登录</Option>
              <Option value="telnet">Telnet 登录 (遗留硬件)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入登录用户名' }]}
          >
            <Input placeholder="例如: root, admin" />
          </Form.Item>

          {credType !== 'ssh_key' ? (
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="密码在 SQLite 数据库中以明文保存" />
            </Form.Item>
          ) : (
            <Form.Item
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  SSH 私钥
                  {/* 支持直接选本地私钥文件（id_rsa / id_ed25519 / *.pem），读出文本填入下方 */}
                  <Upload
                    accept=".pem,.key,.ppk,.txt,application/x-pem-file"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handlePickKeyFile(file as File);
                      return false; // 阻止 antd 自动上传：私钥只在本地读取，不经额外请求
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />}>从文件导入</Button>
                  </Upload>
                </span>
              }
              name="private_key"
              rules={[{ required: true, message: '请输入或导入私钥内容' }]}
            >
              <TextArea
                rows={6}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;… 可粘贴，或点右上「从文件导入」选择 id_rsa / id_ed25519 / *.pem"
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                确认
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 凭据连通性测试 */}
      <Modal
        title={<span><ApiOutlined style={{ marginRight: 8, color: palette.primary }} />测试凭据连通性</span>}
        open={!!testCred}
        onCancel={() => setTestCred(null)}
        footer={null}
        destroyOnHidden
      >
        <p style={{ color: palette.textSub, fontSize: 13, marginTop: 8 }}>
          使用凭据 <strong>{testCred?.name}</strong>（{testCred?.username}）尝试连接指定主机，校验账号/端口是否有效。
        </p>
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          <Input
            placeholder="目标主机 IP，如 192.168.1.10"
            value={testHost}
            onChange={(e) => setTestHost(e.target.value)}
            onPressEnter={runTest}
            autoFocus
          />
          <Button type="primary" loading={testing} onClick={runTest}>测试</Button>
        </Space.Compact>
        {testResult && (
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 8, fontSize: 13,
            background: testResult.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${testResult.ok ? '#bbf7d0' : '#fecaca'}`,
            color: testResult.ok ? '#15803d' : '#b91c1c',
          }}>
            {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
          </div>
        )}
      </Modal>
    </div>
  );
};
