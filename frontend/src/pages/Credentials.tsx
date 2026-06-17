import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { getCredentials, createCredential, updateCredential, deleteCredential, type Credential } from '../services/api';
const { Option } = Select;
const { TextArea } = Input;

export const Credentials: React.FC = () => {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCred, setEditingCred] = useState<Credential | null>(null);
  const [form] = Form.useForm();
  const [credType, setCredType] = useState<'ssh_password' | 'ssh_key' | 'telnet'>('ssh_password');

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
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      {/* 顶部大厂 Header */}
      <div style={{
        background: '#ffffff',
        padding: '20px 32px',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>凭据保管箱</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>集中管理服务器或网络设备的 SSH/Telnet 账号与证书，用于自动发现和一键连接</p>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />} 
          onClick={handleOpenAdd}
          style={{ borderRadius: 6 }}
        >
          添加登录凭证
        </Button>
      </div>

      <div style={{ padding: '0 32px 32px 32px' }}>
        <div style={{
          background: '#ffffff',
          border: '1px solid #f1f5f9',
          borderRadius: '8px',
          padding: '4px',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.02)'
        }}>
          <Table 
            columns={columns} 
            dataSource={credentials} 
            rowKey="id" 
            loading={loading}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            style={{ borderRadius: '8px', overflow: 'hidden' }}
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
        destroyOnClose
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
              label="SSH 私钥"
              name="private_key"
              rules={[{ required: true, message: '请输入私钥内容' }]}
            >
              <TextArea rows={6} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n..." style={{ fontFamily: 'monospace' }} />
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
    </div>
  );
};
