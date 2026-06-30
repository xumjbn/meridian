import React from 'react';
import { Modal } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const groups: { title: string; items: [string, string][] }[] = [
  {
    title: '窗口 / 标签',
    items: [
      [`${MOD}+Shift+D`, '新建分屏'],
      [`${MOD}+Shift+W`, '关闭当前分屏（仅一个时关闭标签）'],
      [`${MOD}+1 ~ 9`, '切换到第 N 个终端标签'],
      ['鼠标中键点标签', '关闭该标签'],
      ['拖拽标签', '调整标签顺序'],
    ],
  },
  {
    title: '命令 / 补全',
    items: [
      [`${MOD}+Shift+P`, '命令面板（模糊搜命令库并插入）'],
      ['Tab', '交给 Shell 原生补全（文件名/路径）'],
      ['↑ ↓ + Enter', '在补全下拉中选择并接受片段'],
      ['Esc', '关闭补全下拉'],
    ],
  },
  {
    title: '编辑 / 剪贴板',
    items: [
      ['选中文本', '自动复制'],
      [`${MOD}+Shift+C / V`, '复制 / 粘贴'],
      ['右键', '有选区则复制，否则粘贴'],
    ],
  },
  {
    title: '视图',
    items: [
      [`${MOD}+滚轮`, '缩放字号'],
      [`${MOD}+ + / -`, '放大 / 缩小字号'],
      [`${MOD}+0`, '字号复位'],
      ['Ctrl+F', '终端内搜索'],
      [`${MOD}+Shift+/`, '打开本速查表'],
    ],
  },
];

export const ShortcutHelp: React.FC<Props> = ({ open, onClose }) => (
  <Modal open={open} onCancel={onClose} footer={null} title="键盘快捷键" width={560} centered>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6366f1', marginBottom: 6 }}>{g.title}</div>
          {g.items.map(([k, d]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <kbd
                style={{
                  fontFamily: 'monospace', fontSize: 11, color: '#0f172a', background: '#f1f5f9',
                  border: '1px solid #e2e8f0', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {k}
              </kbd>
              <span style={{ fontSize: 12, color: '#475569' }}>{d}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Modal>
);
