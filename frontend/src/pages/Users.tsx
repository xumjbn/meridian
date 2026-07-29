import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined, KeyOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { getUsers, createUser, updateUser, deleteUser, type User } from '../services/api';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';

const { Option } = Select;

export const Users: React.FC = () => {
  const { text } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  // 新增用户
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();

  // 重置密码
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetForm] = Form.useForm();

  const currentUser = localStorage.getItem('wjw-user') || '';

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setUsers(await getUsers());
    } catch (e: any) {
      message.error(e?.message || text('users.loadFailed'));
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
      message.success(text('users.createSuccess'));
      setAddOpen(false);
      addForm.resetFields();
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || text('users.createFailed'));
    }
  };

  const handleReset = async (values: { password: string }) => {
    if (!resetUser) return;
    try {
      await updateUser(resetUser.id, { password: values.password });
      message.success(text('users.resetSuccess', { user: resetUser.username }));
      setResetUser(null);
      resetForm.resetFields();
    } catch (e: any) {
      message.error(e?.message || text('users.resetFailed'));
    }
  };

  const setStatus = async (record: User, next: 'active' | 'disabled', okMsg: string) => {
    try {
      await updateUser(record.id, { status: next });
      message.success(okMsg);
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || text('users.opFailed'));
    }
  };

  const changeRole = async (record: User, role: string) => {
    try {
      await updateUser(record.id, { role });
      message.success(text('users.roleUpdated'));
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || text('users.opFailed'));
    }
  };

  const handleDelete = async (record: User) => {
    try {
      await deleteUser(record.id);
      message.success(text('users.deleted'));
      fetchUsers();
    } catch (e: any) {
      message.error(e?.message || text('users.deleteFailed'));
    }
  };

  const columns = [
    {
      title: text('users.col.username'),
      dataIndex: 'username',
      key: 'username',
      render: (name: string) => (
        <Space>
          <UserOutlined style={{ color: palette.primary }} />
          <span style={{ fontWeight: 500 }}>{name}</span>
          {name === currentUser && <Tag color="blue" style={{ borderRadius: 4 }}>{text('users.current')}</Tag>}
        </Space>
      ),
    },
    {
      title: text('users.col.role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string, record: User) => (
        <Select
          size="small"
          value={role}
          style={{ width: 110 }}
          onChange={(val) => changeRole(record, val)}
        >
          <Option value="admin">{text('users.role.admin')}</Option>
          <Option value="user">{text('users.role.user')}</Option>
        </Select>
      ),
    },
    {
      title: text('users.col.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'active') return <Tag color="green" style={{ borderRadius: 4 }}>{text('users.status.active')}</Tag>;
        if (status === 'pending') return <Tag color="orange" style={{ borderRadius: 4 }}>{text('users.status.pending')}</Tag>;
        return <Tag color="red" style={{ borderRadius: 4 }}>{text('users.status.disabled')}</Tag>;
      },
    },
    {
      title: text('users.col.lastLogin'),
      key: 'last_login',
      render: (_: unknown, r: User) =>
        r.last_login_at ? (
          <span style={{ fontSize: 12 }}>
            {new Date(r.last_login_at).toLocaleString()}
            {r.last_login_ip && <span style={{ color: '#94a3b8', marginLeft: 6 }}>({r.last_login_ip})</span>}
          </span>
        ) : (
          <span style={{ color: '#cbd5e1' }}>{text('users.neverLoggedIn')}</span>
        ),
    },
    {
      title: text('users.col.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => <span>{v ? new Date(v).toLocaleString() : '-'}</span>,
    },
    {
      title: text('users.col.action'),
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
            {text('users.resetPassword')}
          </Button>
          {record.status === 'pending' ? (
            <Button
              type="link"
              size="small"
              onClick={() => setStatus(record, 'active', text('users.approved', { user: record.username }))}
              style={{ padding: 0, fontWeight: 600, color: '#16a34a' }}
            >
              {text('users.approve')}
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              onClick={() =>
                record.status === 'active'
                  ? setStatus(record, 'disabled', text('users.disabledOk'))
                  : setStatus(record, 'active', text('users.enabledOk'))
              }
              style={{ padding: 0, fontWeight: 500, color: record.status === 'active' ? '#d97706' : '#16a34a' }}
            >
              {record.status === 'active' ? text('users.disable') : text('users.enable')}
            </Button>
          )}
          <Popconfirm
            title={text('users.deleteConfirm', { user: record.username })}
            onConfirm={() => handleDelete(record)}
            okText={text('common.yes')}
            cancelText={text('common.no')}
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ padding: 0 }} />
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
            title={text('users.title')}
            subtitle={text('users.subtitle')}
            icon={<TeamOutlined />}
            onRefresh={fetchUsers}
            loading={loading}
            left={
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
                {text('users.add')}
              </Button>
            }
          />
          <Table
            className="wjw-table"
            columns={columns}
            dataSource={users}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
          />
        </div>
      </div>

      {/* 新增用户 */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8, color: palette.primary }} />{text('users.add')}</span>}
        open={addOpen}
        onCancel={() => { setAddOpen(false); addForm.resetFields(); }}
        onOk={() => addForm.submit()}
        okText={text('users.create')}
        cancelText={text('common.cancel')}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd} initialValues={{ role: 'user' }} style={{ marginTop: 12 }}>
          <Form.Item
            label={text('users.col.username')}
            name="username"
            rules={[
              { required: true, message: text('login.username.required') },
              { min: 3, max: 32, message: text('login.username.length') },
            ]}
          >
            <Input placeholder={text('users.usernamePlaceholder')} autoComplete="off" />
          </Form.Item>
          <Form.Item
            label={text('users.initialPassword')}
            name="password"
            rules={[
              { required: true, message: text('login.password.required') },
              { min: 6, max: 64, message: text('login.password.length') },
            ]}
          >
            <Input.Password placeholder={text('users.passwordPlaceholder')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item label={text('users.col.role')} name="role" rules={[{ required: true }]}>
            <Select>
              <Option value="user">{text('users.role.user')}</Option>
              <Option value="admin">{text('users.role.admin')}</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={<span><KeyOutlined style={{ marginRight: 8, color: palette.primary }} />{text('users.resetPassword')}</span>}
        open={!!resetUser}
        onCancel={() => { setResetUser(null); resetForm.resetFields(); }}
        onOk={() => resetForm.submit()}
        okText={text('users.confirmReset')}
        cancelText={text('common.cancel')}
        destroyOnHidden
      >
        <p style={{ color: palette.textSub, fontSize: 13, marginTop: 8 }}>
          {text('users.resetHint', { user: resetUser?.username || '' })}
        </p>
        <Form form={resetForm} layout="vertical" onFinish={handleReset}>
          <Form.Item
            label={text('password.new')}
            name="password"
            rules={[
              { required: true, message: text('password.new.required') },
              { min: 6, max: 64, message: text('login.password.length') },
            ]}
          >
            <Input.Password placeholder={text('users.newPasswordPlaceholder')} autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Users;
