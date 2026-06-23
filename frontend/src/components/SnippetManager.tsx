import React, { useEffect, useState } from 'react';
import { Modal, Input, Button, Space, Tooltip, Empty, message } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { loadSnippets, saveSnippets, resetSnippets, type CmdSnippet } from '../commandSnippets';

interface SnippetManagerProps {
  open: boolean;
  onClose: () => void;
}

const newId = () => `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * 命令库管理弹窗：增删改终端自动补全片段。
 * 每行 = 关键字（短别名）+ 命令（插入终端）+ 说明。
 */
export const SnippetManager: React.FC<SnippetManagerProps> = ({ open, onClose }) => {
  const [items, setItems] = useState<CmdSnippet[]>([]);

  // 每次打开时从存储重新载入，避免编辑中途的脏数据残留
  useEffect(() => {
    if (open) setItems(loadSnippets().map((s) => ({ ...s })));
  }, [open]);

  const update = (id: string, patch: Partial<CmdSnippet>) => {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((s) => s.id !== id));
  };

  const add = () => {
    setItems((prev) => [...prev, { id: newId(), keyword: '', cmd: '', desc: '' }]);
  };

  const handleReset = () => {
    Modal.confirm({
      title: '恢复默认命令库？',
      content: '将清除所有自定义片段并还原为内置默认集，此操作不可撤销。',
      okText: '恢复默认',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        const defaults = resetSnippets();
        setItems(defaults.map((s) => ({ ...s })));
        message.success('已恢复默认命令库');
      },
    });
  };

  const handleSave = () => {
    const cleaned = items
      .map((s) => ({
        id: s.id,
        cmd: s.cmd.trim() ? s.cmd : s.cmd, // 命令保留原样（可能含尾随空格用于补参数）
        keyword: (s.keyword || '').trim(),
        desc: (s.desc || '').trim(),
      }))
      .filter((s) => s.cmd.trim().length > 0);
    saveSnippets(cleaned);
    message.success(`已保存 ${cleaned.length} 条命令片段`);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="命令库 · 自动补全片段"
      width={680}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>恢复默认</Button>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave}>保存</Button>
          </Space>
        </div>
      }
    >
      <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>
        在终端输入时按「关键字」或「命令前缀」匹配并提示，按 <strong>Tab</strong> 补全（仅填入，需手动回车执行）。
        关键字为可选短别名，例如 <code>g</code> → <code>git log</code>。命令结尾留空格可方便继续补充参数。
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 4px 6px', fontSize: 12, color: '#94a3b8' }}>
        <span style={{ width: 90 }}>关键字</span>
        <span style={{ flex: 1 }}>命令</span>
        <span style={{ width: 130 }}>说明</span>
        <span style={{ width: 28 }} />
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
        {items.length === 0 && <Empty description="暂无片段，点击下方「新增」添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {items.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <Input
              size="small"
              style={{ width: 90 }}
              placeholder="g"
              value={s.keyword}
              maxLength={12}
              onChange={(e) => update(s.id, { keyword: e.target.value })}
            />
            <Input
              size="small"
              style={{ flex: 1, fontFamily: 'monospace' }}
              placeholder="git log --oneline"
              value={s.cmd}
              onChange={(e) => update(s.id, { cmd: e.target.value })}
            />
            <Input
              size="small"
              style={{ width: 130 }}
              placeholder="说明（可选）"
              value={s.desc}
              onChange={(e) => update(s.id, { desc: e.target.value })}
            />
            <Tooltip title="删除">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => remove(s.id)}
              />
            </Tooltip>
          </div>
        ))}
      </div>

      <Button block type="dashed" icon={<PlusOutlined />} onClick={add} style={{ marginTop: 8 }}>
        新增片段
      </Button>
    </Modal>
  );
};
