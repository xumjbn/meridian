import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined, KeyOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { getUsers, createUser, updateUser, deleteUser, type User } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { palette, cardStyle } from '../theme';

const { Option } = Select;

export const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  // 新增用户
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();

  // 重置密码
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetForm] = Form.useForm();

  const currentUser = localStorage.getItem('mrd-user') || '';

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setUsers(await getUsers());
    } catch (e: any) {
      message.error(e?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = async (values: { username: string; password: string; role: string }) => {
    try {
      await createUser(values);
      message.success('用户创建成功');
      setAddOpen(false);
      addForm.resetFields();
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    }
  };

  const handleReset = async (values: { password: string }) => {
    if (!resetUser) return;
    try {
      await updateUser(resetUser.id, { password: values.password });
      message.success(`已重置 ${resetUser.username} 的密码`);
      setResetUser(null);
      resetForm.resetFields();
    } catch (e: any) {
      message.error(e?.message || '重置失败');
    }
  };

  const toggleStatus = async (record: User) => {
    const next = record.status === 'active' ? 'disabled' : 'active';
    try {
      await updateUser(record.id, { status: next });
      message.success(next === 'active' ? '已启用账号' : '已禁用账号');
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const changeRole = async (record: User, role: string) => {
    try {
      await updateUser(record.id, { role });
      message.success('角色已更新');
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDelete = async (record: User) => {
    try {
      await deleteUser(record.id);
      message.success('用户已删除');
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => (
        <Space>
          <UserOutlined style={{ color: palette.primary }} />
          <span style={{ fontWeight: 500 }}>{text}</span>
          {text === currentUser && <Tag color="blue" style={{ borderRadius: 4 }}>当前</Tag>}
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string, record: User) => (
        <Select
          size="small"
          value={role}
          style={{ width: 110 }}
          onChange={(val) => changeRole(record, val)}
        >
          <Option value="admin">管理员</Option>
          <Option value="user">普通用户</Option>
        </Select>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'active' ? (
          <Tag color="green" style={{ borderRadius: 4 }}>启用</Tag>
        ) : (
          <Tag color="red" style={{ borderRadius: 4 }}>禁用</Tag>
        ),
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
      render: (_: unknown, record: User) => (
        <Space size="middle">
          <Button
            type="link"
            size="small"
            icon={<KeyOutlined />}
            onClick={() => setResetUser(record)}
            style={{ padding: 0, fontWeight: 500, color: palette.primary }}
          >
            重置密码
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => toggleStatus(record)}
            style={{ padding: 0, fontWeight: 500, color: record.status === 'active' ? '#d97706' : '#16a34a' }}
          >
            {record.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Popconfirm
            title={`确认删除用户 ${record.username} 吗？`}
            onConfirm={() => handleDelete(record)}
            okText="是"
            cancelText="否"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ padding: 0 }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="用户管理"
        subtitle="管理平台登录账户的角色、状态与密码"
        icon={<TeamOutlined />}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            新增用户
          </Button>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        <div style={{ ...cardStyle, padding: 4 }}>
          <Table
            columns={columns}
            dataSource={users}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </div>
      </div>

      {/* 新增用户 */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8, color: palette.primary }} />新增用户</span>}
        open={addOpen}
        onCancel={() => { setAddOpen(false); addForm.resetFields(); }}
        onOk={() => addForm.submit()}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd} initialValues={{ role: 'user' }} style={{ marginTop: 12 }}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }, { min: 3, max: 32, message: '用户名长度需为 3–32 个字符' }]}
          >
            <Input placeholder="登录用户名" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }, { min: 6, max: 64, message: '密码长度需为 6–64 个字符' }]}
          >
            <Input.Password placeholder="6–64 位密码" autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select>
              <Option value="user">普通用户</Option>
              <Option value="admin">管理员</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={<span><KeyOutlined style={{ marginRight: 8, color: palette.primary }} />重置密码</span>}
        open={!!resetUser}
        onCancel={() => { setResetUser(null); resetForm.resetFields(); }}
        onOk={() => resetForm.submit()}
        okText="确认重置"
        cancelText="取消"
        destroyOnHidden
      >
        <p style={{ color: palette.textSub, fontSize: 13, marginTop: 8 }}>
          为用户 <strong>{resetUser?.username}</strong> 设置一个新密码（无需原密码）。
        </p>
        <Form form={resetForm} layout="vertical" onFinish={handleReset}>
          <Form.Item
            label="新密码"
            name="password"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, max: 64, message: '密码长度需为 6–64 个字符' }]}
          >
            <Input.Password placeholder="6–64 位新密码" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Users;
