import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input } from 'antd';
import { loadSnippets, matchSnippets, type CmdSnippet } from '../commandSnippets';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (cmd: string) => void;
}

// 命令面板（Ctrl/⌘+Shift+P）：模糊搜命令库，回车/单击插入到终端。
export const CommandPalette: React.FC<Props> = ({ open, onClose, onPick }) => {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo<CmdSnippet[]>(() => {
    const all = loadSnippets();
    return q.trim() ? matchSnippets(q, all, 50) : all.slice(0, 60);
  }, [q, open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus?.(), 50);
    }
  }, [open]);
  useEffect(() => { setIdx(0); }, [q]);

  const pick = (s?: CmdSnippet) => { if (s) { onPick(s.cmd); onClose(); } };

  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={640} styles={{ body: { padding: 0 } }} destroyOnHidden>
      <Input
        ref={inputRef}
        size="large"
        variant="borderless"
        placeholder="搜索命令（名称 / 缩写 / 说明）… ↑↓ 选择 · Enter 插入 · Esc 关闭"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(list[idx]); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{ padding: '14px 16px', fontSize: 15, borderBottom: '1px solid #f0f0f0' }}
      />
      <div ref={listRef} style={{ maxHeight: 380, overflowY: 'auto' }}>
        {list.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>无匹配命令</div>
        ) : (
          list.map((s, i) => (
            <div
              key={s.id}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '8px 16px', cursor: 'pointer',
                background: i === idx ? 'rgba(99,102,241,0.10)' : 'transparent',
                borderLeft: i === idx ? '2px solid #6366f1' : '2px solid transparent',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                {s.keyword && <span style={{ color: '#6366f1', marginRight: 8 }}>{s.keyword}</span>}
                {s.cmd}
              </span>
              {s.desc && <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.desc}</span>}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};
