import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Popconfirm, Upload, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined, ApiOutlined, UploadOutlined } from '@ant-design/icons';
import { getCredentials, createCredential, updateCredential, deleteCredential, testCredential, type Credential, type CredTestResult } from '../services/api';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';
const { Option } = Select;
const { TextArea } = Input;

export const Credentials: React.FC = () => {
  const { text } = useI18n();
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
      message.warning(text('cred.needHost'));
      return;
    }
    try {
      setTesting(true);
      setTestResult(null);
      const res = await testCredential(testCred.id, testHost.trim());
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || text('cred.testRequestFailed') });
    } finally {
      setTesting(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const data = await getCredentials();
      setCredentials(data);
    } catch {
      message.error(text('cred.loadFailed'));
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
      message.error(text('cred.keyFileTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // 变量原名 text，会遮蔽 i18n 的 text()，改叫 pem
      const pem = String(reader.result || '').trim();
      if (!/-----BEGIN [\w ]*PRIVATE KEY-----/.test(pem)) {
        message.warning(text('cred.keyFileNotPem'));
      }
      form.setFieldsValue({ private_key: pem });
      message.success(text('cred.keyFileImported', { name: file.name }));
    };
    reader.onerror = () => message.error(text('cred.readFileFailed'));
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
    // 秘密字段不回显（接口也不再返回），留空即保持原值
    form.setFieldsValue({ ...record, password: '', private_key: '' });
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCredential(id);
      message.success(text('cred.deleted'));
      fetchCredentials();
    } catch {
      message.error(text('cred.deleteFailed'));
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingCred && editingCred.id) {
        await updateCredential(editingCred.id, values);
        message.success(text('cred.updated'));
      } else {
        await createCredential(values);
        message.success(text('cred.created'));
      }
      setModalVisible(false);
      fetchCredentials();
    } catch {
      message.error(text('cred.opFailed'));
    }
  };

  const columns = [
    {
      title: text('cred.col.name'),
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: text('cred.col.type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const known = ['ssh_password', 'ssh_key', 'telnet'];
        const label = known.includes(type) ? text(`cred.type.${type}`) : type;
        return <span style={{ color: '#2563eb', fontWeight: 500 }}>{label}</span>;
      },
    },
    {
      title: text('cred.col.username'),
      dataIndex: 'username',
      key: 'username',
      render: (v: string) => <span>{v || '-'}</span>,
    },
    {
      title: text('cred.col.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => <span>{v ? new Date(v).toLocaleString() : '-'}</span>,
    },
    {
      title: text('users.col.action'),
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
            {text('cred.test')}
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ color: '#475569' }} />}
            onClick={() => handleOpenEdit(record)}
            style={{ padding: 0 }}
          />
          <Popconfirm
            title={text('cred.deleteConfirm')}
            onConfirm={() => handleDelete(record.id!)}
            okText={text('common.yes')}
            cancelText={text('common.no')}
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

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        <div style={tablePanelStyle}>
          <TableToolbar
            title={text('nav.credentials')}
            subtitle={text('cred.subtitle')}
            icon={<SafetyCertificateOutlined />}
            onRefresh={fetchCredentials}
            loading={loading}
            left={
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
                {text('cred.add')}
              </Button>
            }
          />
          <Table
            className="wjw-table"
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
            {editingCred ? text('cred.editTitle') : text('cred.createTitle')}
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
            label={text('cred.form.alias')}
            name="name"
            rules={[{ required: true, message: text('cred.form.aliasRequired') }]}
          >
            <Input placeholder={text('cred.form.aliasPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={text('cred.col.type')}
            name="type"
            rules={[{ required: true, message: text('cred.form.typeRequired') }]}
          >
            <Select onChange={(val) => setCredType(val)}>
              <Option value="ssh_password">{text('cred.typeOpt.ssh_password')}</Option>
              <Option value="ssh_key">{text('cred.typeOpt.ssh_key')}</Option>
              <Option value="telnet">{text('cred.typeOpt.telnet')}</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label={text('cred.col.username')}
            name="username"
            rules={[{ required: true, message: text('cred.form.usernameRequired') }]}
          >
            <Input placeholder={text('cred.form.usernamePlaceholder')} />
          </Form.Item>

          {credType !== 'ssh_key' ? (
            <Form.Item
              label={text('login.password')}
              name="password"
              // 编辑已有凭据时留空 = 保持原密码；新建时必填
              rules={editingCred ? [] : [{ required: true, message: text('login.password.required') }]}
              extra={
                editingCred?.has_password
                  ? text('cred.form.passwordSetHint')
                  : text('cred.form.passwordNewHint')
              }
            >
              <Input.Password placeholder={editingCred?.has_password ? text('cred.form.passwordKeep') : text('cred.form.passwordPlaceholder')} />
            </Form.Item>
          ) : (
            <Form.Item
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  {text('cred.form.privateKey')}
                  {/* 支持直接选本地私钥文件（id_rsa / id_ed25519 / *.pem），读出文本填入下方 */}
                  <Upload
                    accept=".pem,.key,.ppk,.txt,application/x-pem-file"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handlePickKeyFile(file as File);
                      return false; // 阻止 antd 自动上传：私钥只在本地读取，不经额外请求
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />}>{text('cred.form.importFromFile')}</Button>
                  </Upload>
                </span>
              }
              name="private_key"
              rules={editingCred ? [] : [{ required: true, message: text('cred.form.privateKeyRequired') }]}
              extra={editingCred?.has_private_key ? text('cred.form.privateKeySetHint') : undefined}
            >
              <TextArea
                rows={6}
                placeholder={text('cred.form.privateKeyPlaceholder')}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>{text('common.cancel')}</Button>
              <Button type="primary" htmlType="submit">
                {text('common.confirm')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 凭据连通性测试 */}
      <Modal
        title={<span><ApiOutlined style={{ marginRight: 8, color: palette.primary }} />{text('cred.testTitle')}</span>}
        open={!!testCred}
        onCancel={() => setTestCred(null)}
        footer={null}
        destroyOnHidden
      >
        <p style={{ color: palette.textSub, fontSize: 13, marginTop: 8 }}>
          {text('cred.testHint', { name: testCred?.name || '', user: testCred?.username || '' })}
        </p>
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          <Input
            placeholder={text('cred.testHostPlaceholder')}
            value={testHost}
            onChange={(e) => setTestHost(e.target.value)}
            onPressEnter={runTest}
            autoFocus
          />
          <Button type="primary" loading={testing} onClick={runTest}>{text('cred.testBtn')}</Button>
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
