import React from 'react';
import { Modal } from 'antd';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export const ShortcutHelp: React.FC<Props> = ({ open, onClose }) => {
  const { text } = useI18n();
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: text('shortcut.group.window'),
      items: [
        [`${MOD}+Shift+D`, text('shortcut.newSplit')],
        [`${MOD}+Shift+W`, text('shortcut.closePane')],
        [`${MOD}+1 ~ 9`, text('shortcut.switchTab')],
        ['Middle click tab', text('shortcut.middleClose')],
        ['Drag tab', text('shortcut.dragTab')],
      ],
    },
    {
      title: text('shortcut.group.command'),
      items: [
        [`${MOD}+Shift+P`, text('shortcut.commandPalette')],
        ['→ / Tab', text('shortcut.acceptCompletion')],
        ['Tab', text('shortcut.nativeCompletion')],
        ['Ctrl+Space', text('shortcut.showCandidates')],
        ['↑ ↓ + Enter', text('shortcut.pickCandidate')],
        ['Esc', text('shortcut.closeCandidates')],
      ],
    },
    {
      title: text('shortcut.group.edit'),
      items: [
        ['Select text', text('shortcut.autoCopy')],
        [`${MOD}+Shift+C / V`, text('shortcut.copyPaste')],
        ['Right click', text('shortcut.contextMenu')],
      ],
    },
    {
      title: text('shortcut.group.view'),
      items: [
        [`${MOD}+Wheel`, text('shortcut.zoomWheel')],
        [`${MOD}+ + / -`, text('shortcut.zoomInOut')],
        [`${MOD}+0`, text('shortcut.zoomReset')],
        ['Ctrl+F', text('shortcut.searchTerminal')],
        [`${MOD}+Shift+/`, text('shortcut.openHelp')],
        ['↑↑↓↓←→←→BA', '?'],
      ],
    },
  ];

  return (
  <Modal open={open} onCancel={onClose} footer={null} title={text('shortcut.title')} width={560} centered>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#006eff', marginBottom: 6 }}>{g.title}</div>
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
};
