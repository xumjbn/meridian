import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, message, Divider } from 'antd';
import { DesktopOutlined } from '@ant-design/icons';
import { getAssets, createAsset, errorMessage, type Asset } from '../services/api';
import { useI18n } from '../i18n';

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
  const { text } = useI18n();
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
    // validateFields 校验不通过时抛的是 { errorFields }，放在 try 外会变成
    // 未捕获的 promise 异常；表单本身已经在字段下方标红，这里静默返回即可。
    let v: FormVals;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
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
      if (target.id == null) throw new Error(text('newConnection.assetCreateMissingId'));
      if (v.password) {
        setPendingAuth(target.id, { username: v.username.trim(), password: v.password });
      }
      onConnect({ id: target.id, name: target.name || ip, ip });
      onClose();
    } catch (e: unknown) {
      message.error(errorMessage(e) || text('newConnection.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={text('common.connect')}
      cancelText={text('common.cancel')}
      confirmLoading={submitting}
      title={<span><DesktopOutlined style={{ marginRight: 8 }} />{text('newConnection.title')}</span>}
      width={420}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ port: 22, username: 'root' }} onFinish={submit}>
        {known.length > 0 && (
          <>
            <Form.Item label={text('newConnection.pickKnown')} style={{ marginBottom: 8 }}>
              <Select
                showSearch
                allowClear
                placeholder={text('newConnection.searchKnown')}
                onChange={(id) => id && pickKnown(id as number)}
                filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={known.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id }))}
              />
            </Form.Item>
            <Divider style={{ margin: '4px 0 12px' }} />
          </>
        )}

        <Form.Item
          label={text('newConnection.hostIp')}
          name="ip"
          rules={[{ required: true, message: text('newConnection.hostIp.required') }]}
          style={{ marginBottom: 12 }}
        >
          <Input placeholder="192.168.1.10" autoFocus />
        </Form.Item>

        <Form.Item label={text('newConnection.port')} name="port" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label={text('newConnection.username')} name="username" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <Input placeholder="root" />
        </Form.Item>

        <Form.Item
          label={text('newConnection.password')}
          name="password"
          extra={text('newConnection.password.extra')}
          style={{ marginBottom: 12 }}
        >
          <Input.Password placeholder={text('newConnection.password.placeholder')} onPressEnter={submit} />
        </Form.Item>

        <Form.Item label={text('newConnection.name')} name="name" style={{ marginBottom: 0 }}>
          <Input placeholder={text('newConnection.name.placeholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
