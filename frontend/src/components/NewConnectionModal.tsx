import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, message, Divider } from 'antd';
import { DesktopOutlined } from '@ant-design/icons';
import { getAssets, createAsset, type Asset } from '../services/api';

import { setPendingAuth } from '../pendingAuth';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 连接目标已就绪：交给上层打开终端会话 */
  onConnect: (s: { id: number; name: string; ip: string }) => void;
}

interface FormVals {
  ip: string;
  port: number;
  username: string;
  password?: string;
  name?: string;
}

// ─────────────────────────────────────────────────────────────
// 「新建连接」：直接填 SSH 登录信息就能开一个终端，不必先去资产页录入。
//
// IP 已存在则复用该资产，避免每次连接都造重复资产。
// 密码只在内存里中转给本次会话（见 pendingAuth），不入库、不落盘。
// ─────────────────────────────────────────────────────────────
export const NewConnectionModal: React.FC<Props> = ({ open, onClose, onConnect }) => {
  const [form] = Form.useForm<FormVals>();
  const [submitting, setSubmitting] = useState(false);
  const [known, setKnown] = useState<Asset[]>([]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    getAssets().then(setKnown).catch(() => setKnown([]));
  }, [open, form]);

  // 选一台已有主机：带出 IP，省得手打
  const pickKnown = (id: number) => {
    const a = known.find((x) => x.id === id);
    if (a) form.setFieldsValue({ ip: a.ip, name: a.name });
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const ip = v.ip.trim();
      let target = known.find((a) => a.ip === ip);
      if (!target) {
        target = await createAsset({
          name: (v.name || '').trim() || ip,
          ip,
          type: 'server',
          ssh_port: v.port,
        });
      }
      if (target.id == null) throw new Error('资产创建失败：未返回 ID');
      if (v.password) {
        setPendingAuth(target.id, { username: v.username.trim(), password: v.password });
      }
      onConnect({ id: target.id, name: target.name || ip, ip });
      onClose();
    } catch (e: any) {
      message.error(e?.message || '连接失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="连接"
      cancelText="取消"
      confirmLoading={submitting}
      title={<span><DesktopOutlined style={{ marginRight: 8 }} />新建连接</span>}
      width={420}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ port: 22, username: 'root' }} onFinish={submit}>
        {known.length > 0 && (
          <>
            <Form.Item label="从已有主机选（可跳过）" style={{ marginBottom: 8 }}>
              <Select
                showSearch
                allowClear
                placeholder="搜索已纳管的主机…"
                onChange={(id) => id && pickKnown(id as number)}
                filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={known.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id }))}
              />
            </Form.Item>
            <Divider style={{ margin: '4px 0 12px' }} />
          </>
        )}

        <Form.Item
          label="主机 IP"
          name="ip"
          rules={[{ required: true, message: '请输入主机 IP' }]}
          style={{ marginBottom: 12 }}
        >
          <Input placeholder="192.168.1.10" autoFocus />
        </Form.Item>

        <Form.Item label="端口" name="port" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="用户名" name="username" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <Input placeholder="root" />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          extra="仅用于本次会话，不会保存到数据库；留空则使用该资产已绑定的凭据"
          style={{ marginBottom: 12 }}
        >
          <Input.Password placeholder="留空表示用已绑定凭据" onPressEnter={submit} />
        </Form.Item>

        <Form.Item label="备注名（可选）" name="name" style={{ marginBottom: 0 }}>
          <Input placeholder="不填则用 IP 作为名称" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
