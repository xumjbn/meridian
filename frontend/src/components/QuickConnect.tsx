import React, { useEffect, useMemo, useState } from 'react';
import { Input, Tooltip, Empty, Spin, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  DesktopOutlined,
  ReloadOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  HistoryOutlined,
  CodeOutlined,
  BlockOutlined,
  FolderOpenOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { getAssets, getCapabilities, type Asset } from '../services/api';
import { useTerminals } from '../terminalSessions';
import { palette } from '../theme';

const UNGROUPED = '未分组';
const RECENT_KEY = 'mrd-recent-hosts';

const parseTags = (s?: string): string[] => {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
};

const loadRecent = (): number[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number' && x > 0) : [];
  } catch {
    return [];
  }
};

const statusColor = (s?: string) => (s === 'online' ? palette.success : s === 'offline' ? palette.danger : '#64748b');

// 在线优先、其次未知、最后离线；同档按名称排序——常用的在线主机更易找到
const byOnlineThenName = (a: Asset, b: Asset) => {
  const rank = (s?: string) => (s === 'online' ? 0 : s === 'offline' ? 2 : 1);
  return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'zh');
};

interface Props {
  /** 侧栏折叠态：渲染为窄图标条（仍可快速连接，标签走 tooltip） */
  collapsed?: boolean;
}

// 左侧栏「快速连接」：按标签分组的主机树 + 本地终端，点击即开终端标签并连接；
// 支持「最近连接」置顶、右键菜单（新分屏/SFTP/资产）、拖拽主机到分屏直接连。
export const QuickConnect: React.FC<Props> = ({ collapsed = false }) => {
  const { open, sessions, activeId } = useTerminals();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [localShell, setLocalShell] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [recentIds, setRecentIds] = useState<number[]>(loadRecent);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getAssets();
      setAssets(data);
    } catch {
      /* 静默：左侧栏不打断 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = () => {
      load();
      getCapabilities()
        .then((c) => setLocalShell(!!c.local_shell))
        .catch(() => setLocalShell(false));
    };
    init();
    // 桌面端后台登录拿到 token 后会广播，此时再拉一次（首屏可能在拿到 token 前就挂载了）
    window.addEventListener('mrd-auth-ready', init);
    return () => window.removeEventListener('mrd-auth-ready', init);
  }, []);

  const openIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

  const pushRecent = (id?: number) => {
    if (!id || id < 0) return;
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const connect = (a: Asset) => {
    open({ id: a.id!, name: a.name, ip: a.ip });
    pushRecent(a.id);
  };
  // 每次新建一个独立的本地终端：用更小的负数 id 保证唯一（可同时开多个）
  const connectLocal = () => {
    const localIds = sessions.filter((s) => s.id < 0).map((s) => s.id);
    const nextId = (localIds.length ? Math.min(...localIds) : 0) - 1;
    const n = localIds.length + 1;
    open({ id: nextId, name: n > 1 ? `本地终端 ${n}` : '本地终端', ip: '本机' });
  };

  // 右键菜单动作
  const openInSplit = (a: Asset) => {
    if (activeId !== null) {
      window.dispatchEvent(new CustomEvent('mrd-open-in-split', { detail: a.id }));
      pushRecent(a.id);
    } else {
      connect(a); // 没有活动终端则退化为新标签连接
    }
  };
  const hostMenu = (a: Asset): MenuProps['items'] => [
    { key: 'connect', icon: <CodeOutlined />, label: '连接（新标签）', onClick: () => connect(a) },
    { key: 'split', icon: <BlockOutlined />, label: '在新分屏打开', onClick: () => openInSplit(a) },
    { key: 'sftp', icon: <FolderOpenOutlined />, label: '文件传输 (SFTP)', onClick: () => window.dispatchEvent(new CustomEvent('mrd-open-sftp', { detail: a })) },
    { type: 'divider' },
    { key: 'assets', icon: <EditOutlined />, label: '在资产清单查看', onClick: () => window.dispatchEvent(new CustomEvent('mrd-navigate', { detail: '/assets' })) },
  ];

  // 过滤 + 按标签分组（一台主机可出现在多个标签下；无标签归「未分组」）
  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const match = (a: Asset) => {
      if (!kw) return true;
      const tags = parseTags(a.tags).join(' ');
      return (
        a.name.toLowerCase().includes(kw) ||
        a.ip.toLowerCase().includes(kw) ||
        tags.toLowerCase().includes(kw)
      );
    };
    const map = new Map<string, Asset[]>();
    for (const a of assets) {
      if (!match(a)) continue;
      const tags = parseTags(a.tags);
      const keys = tags.length ? tags : [UNGROUPED];
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      }
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b, 'zh');
    });
    return keys.map((k) => ({ tag: k, hosts: map.get(k)!.sort(byOnlineThenName) }));
  }, [assets, q]);

  const recentHosts = useMemo(() => {
    return recentIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a)
      .slice(0, 5);
  }, [recentIds, assets]);

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    color: '#5b6680',
    textTransform: 'uppercase',
  };

  const localActive = activeId !== null && activeId < 0;

  const startHostDrag = (e: React.DragEvent, a: Asset) => {
    e.dataTransfer.setData('application/x-mrd-asset', String(a.id));
    e.dataTransfer.setData('text/plain', a.name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // 展开态的单个主机行（可点连、可右键菜单、可拖到分屏）
  const hostRow = (a: Asset, keyPrefix: string) => {
    const active = activeId === a.id;
    const opened = openIds.has(a.id!);
    const tags = parseTags(a.tags);
    return (
      <Dropdown key={`${keyPrefix}-${a.id}`} trigger={['contextMenu']} menu={{ items: hostMenu(a) }}>
        <div
          draggable
          onDragStart={(e) => startHostDrag(e, a)}
          onClick={() => connect(a)}
          title={`${a.name} · ${a.ip}${tags.length ? ` · ${tags.join(' / ')}` : ''}\n单击连接 · 右键更多 · 可拖到分屏`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px 6px 20px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1.2,
            color: active ? '#ffffff' : palette.siderText,
            background: active ? palette.siderActive : 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!active) (e.currentTarget as HTMLDivElement).style.background = palette.siderHover;
          }}
          onMouseLeave={(e) => {
            if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%', background: statusColor(a.status), flexShrink: 0,
              boxShadow: opened ? `0 0 0 2px rgba(99,102,241,0.45)` : undefined,
            }}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ fontSize: 10, color: '#5b6680', flexShrink: 0 }}>{a.ip}</span>
        </div>
      </Dropdown>
    );
  };

  // ── 折叠态：窄图标条（主机首字母头像 + 状态点，tooltip 显示名称/IP/标签）──
  if (collapsed) {
    const iconBtn = (active: boolean, accent: boolean): React.CSSProperties => ({
      width: 38,
      height: 38,
      borderRadius: 9,
      flexShrink: 0,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      background: active ? palette.siderActive : accent ? 'rgba(34,211,238,0.08)' : 'transparent',
      border: `1px solid ${active ? palette.accent : accent ? 'rgba(34,211,238,0.18)' : 'transparent'}`,
    });
    const sorted = [...assets].sort(byOnlineThenName);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, alignItems: 'center', gap: 6 }}>
        {localShell && (
          <Tooltip title="新建本地终端" placement="right">
            <div onClick={connectLocal} style={iconBtn(localActive, true)}>
              <DesktopOutlined style={{ color: palette.accent, fontSize: 16 }} />
            </div>
          </Tooltip>
        )}
        <div style={{ width: 24, height: 1, background: palette.siderBorder, flexShrink: 0 }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          {sorted.map((a) => {
            const active = activeId === a.id;
            const tags = parseTags(a.tags);
            return (
              <Dropdown key={a.id} trigger={['contextMenu']} menu={{ items: hostMenu(a) }}>
                <Tooltip placement="right" title={`${a.name} · ${a.ip}${tags.length ? ` · ${tags.join(' / ')}` : ''}`}>
                  <div draggable onDragStart={(e) => startHostDrag(e, a)} onClick={() => connect(a)} style={iconBtn(active, false)}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? '#fff' : palette.siderText }}>
                      {(a.name || a.ip).slice(0, 1).toUpperCase()}
                    </span>
                    <span
                      style={{
                        position: 'absolute', right: 3, bottom: 3, width: 8, height: 8, borderRadius: '50%',
                        background: statusColor(a.status), border: `1.5px solid ${palette.siderBg}`,
                      }}
                    />
                  </div>
                </Tooltip>
              </Dropdown>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 标题 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 8px' }}>
        <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ThunderboltOutlined style={{ color: palette.accent }} /> 快速连接
        </span>
        <Tooltip title="刷新主机" placement="right">
          <ReloadOutlined spin={loading} onClick={load} style={{ color: '#5b6680', cursor: 'pointer', fontSize: 12 }} />
        </Tooltip>
      </div>

      {/* 搜索 */}
      <Input
        size="small"
        allowClear
        placeholder="搜索主机 / IP / 标签"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        prefix={<TagsOutlined style={{ color: '#5b6680' }} />}
        style={{ marginBottom: 8 }}
      />

      {/* 本地终端入口 */}
      {localShell && (
        <div
          onClick={connectLocal}
          title="新建本地终端（连接运行本程序的这台机器，可同时开多个）"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', marginBottom: 6,
            borderRadius: 8, cursor: 'pointer', fontSize: 13,
            color: localActive ? '#ffffff' : palette.siderText,
            background: localActive ? palette.siderActive : 'rgba(34,211,238,0.08)',
            border: `1px solid ${localActive ? palette.accent : 'rgba(34,211,238,0.18)'}`,
          }}
        >
          <DesktopOutlined style={{ color: palette.accent }} />
          <span style={{ flex: 1 }}>本地终端</span>
          <PlusOutlined style={{ fontSize: 11, color: '#5b6680' }} />
        </div>
      )}

      {/* 主机树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        {loading && assets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Spin size="small" />
          </div>
        ) : groups.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#5b6680', fontSize: 12 }}>{q ? '无匹配主机' : '暂无主机'}</span>}
            style={{ marginTop: 24 }}
          />
        ) : (
          <>
            {/* 最近连接（不搜索时置顶） */}
            {!q && recentHosts.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', color: '#7c8aa5', fontSize: 12, fontWeight: 600 }}>
                  <HistoryOutlined style={{ fontSize: 11 }} />
                  <span style={{ flex: 1 }}>最近</span>
                </div>
                {recentHosts.map((a) => hostRow(a, 'recent'))}
                <div style={{ height: 1, background: palette.siderBorder, margin: '6px 6px 2px' }} />
              </div>
            )}

            {groups.map(({ tag, hosts }) => {
              const folded = collapsedGroups[tag];
              return (
                <div key={tag} style={{ marginBottom: 4 }}>
                  <div
                    onClick={() => setCollapsedGroups((p) => ({ ...p, [tag]: !p[tag] }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', cursor: 'pointer',
                      color: '#7c8aa5', fontSize: 12, fontWeight: 600, userSelect: 'none',
                    }}
                  >
                    {folded ? <CaretRightOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                    <span style={{ fontSize: 10, color: '#5b6680' }}>{hosts.length}</span>
                  </div>
                  {!folded && hosts.map((a) => hostRow(a, tag))}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
