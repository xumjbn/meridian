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
import {
  getAssets,
  getCapabilities,
  getLocalShellPref,
  setLocalShellPref,
  LOCAL_SHELL_OPTIONS,
  type Asset,
} from '../services/api';
import { useTerminals } from '../terminalSessions';
import { palette } from '../theme';
import { useI18n } from '../i18n';

const RECENT_KEY = 'wjw-recent-hosts';
// 「平台默认 Shell」在菜单里的占位 key（真实值是空串，不能直接当 antd 的 key 用）
const DEFAULT_SHELL_KEY = '__default__';

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
  const { text } = useI18n();
  const { open, sessions, activeId } = useTerminals();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [localShell, setLocalShell] = useState(false);
  // 用哪个 Shell 开本地终端（''=平台默认）。只影响之后新建的终端，已开的不变。
  const [shellKind, setShellKind] = useState<string>(getLocalShellPref);
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
    window.addEventListener('wjw-auth-ready', init);
    return () => window.removeEventListener('wjw-auth-ready', init);
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
    open({ assetId: a.id!, name: a.name, ip: a.ip });
    pushRecent(a.id);
  };
  // 每次新建一个独立的本地终端：用更小的负数资产 id 保证后端会话互不干扰
  const connectLocal = () => {
    const localIds = sessions.filter((s) => s.assetId < 0).map((s) => s.assetId);
    const nextId = (localIds.length ? Math.min(...localIds) : 0) - 1;
    const n = localIds.length + 1;
    open({
      assetId: nextId,
      name: n > 1 ? text('quickConnect.localTerminalN', { count: n }) : text('quickConnect.localTerminal'),
      ip: text('quickConnect.localHost'),
    });
  };

  // Shell 选择菜单。antd 的 key 不能是空串（选中态匹配不上），故默认项用 DEFAULT_SHELL_KEY 占位。
  const shellLabel = shellKind || text('common.default');
  const shellMenu: MenuProps = {
    selectable: true,
    selectedKeys: [shellKind || DEFAULT_SHELL_KEY],
    items: LOCAL_SHELL_OPTIONS.map((o) => ({ key: o.value || DEFAULT_SHELL_KEY, label: o.label })),
    onClick: ({ key, domEvent }) => {
      // 下拉是 React portal：DOM 上挂在 body，但事件仍沿 React 树冒泡到「本地终端」那一行，
      // 不拦住的话选个 Shell 会顺手多开一个终端
      domEvent.stopPropagation();
      const v = key === DEFAULT_SHELL_KEY ? '' : key;
      setShellKind(v);
      setLocalShellPref(v); // 记住选择，下次开本地终端沿用
    },
  };

  // 右键菜单动作
  const openInSplit = (a: Asset) => {
    if (activeId !== null) {
      window.dispatchEvent(new CustomEvent('wjw-open-in-split', { detail: a.id }));
      pushRecent(a.id);
    } else {
      connect(a); // 没有活动终端则退化为新标签连接
    }
  };
  const hostMenu = (a: Asset): MenuProps['items'] => [
    { key: 'connect', icon: <CodeOutlined />, label: text('quickConnect.menu.connect'), onClick: () => connect(a) },
    { key: 'split', icon: <BlockOutlined />, label: text('quickConnect.menu.split'), onClick: () => openInSplit(a) },
    { key: 'sftp', icon: <FolderOpenOutlined />, label: text('quickConnect.menu.sftp'), onClick: () => window.dispatchEvent(new CustomEvent('wjw-open-sftp', { detail: a })) },
    { type: 'divider' },
    { key: 'assets', icon: <EditOutlined />, label: text('quickConnect.menu.assets'), onClick: () => window.dispatchEvent(new CustomEvent('wjw-navigate', { detail: '/assets' })) },
  ];

  // 过滤 + 按标签分组（一台主机可出现在多个标签下；无标签归「未分组」）
  const groups = useMemo(() => {
    const ungrouped = text('quickConnect.ungrouped');
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
      const keys = tags.length ? tags : [ungrouped];
      for (const k of keys) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      }
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === ungrouped) return 1;
      if (b === ungrouped) return -1;
      return a.localeCompare(b, 'zh');
    });
    return keys.map((k) => ({ tag: k, hosts: map.get(k)!.sort(byOnlineThenName) }));
  }, [assets, q, text]);

  const recentHosts = useMemo(() => {
    return recentIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a)
      .slice(0, 5);
  }, [recentIds, assets]);

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0.4,
    color: palette.textMute,
    textTransform: 'uppercase',
  };

  const localActive = activeId !== null && activeId < 0;

  const startHostDrag = (e: React.DragEvent, a: Asset) => {
    e.dataTransfer.setData('application/x-wjw-asset', String(a.id));
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
          title={text('quickConnect.hostTitle', {
            name: a.name,
            ip: a.ip,
            tags: tags.length ? ` · ${tags.join(' / ')}` : '',
          })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px 6px 20px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1.2,
            color: active ? palette.siderTextActive : palette.siderText,
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
              boxShadow: opened ? `0 0 0 2px rgba(0,110,255,0.35)` : undefined,
            }}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ fontSize: 10, color: palette.textMute, flexShrink: 0 }}>{a.ip}</span>
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
      background: active ? palette.siderActive : accent ? 'rgba(0,110,255,0.07)' : 'transparent',
      border: `1px solid ${active ? palette.primaryBorder : accent ? 'rgba(0,110,255,0.18)' : 'transparent'}`,
    });
    const sorted = [...assets].sort(byOnlineThenName);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, alignItems: 'center', gap: 6 }}>
        {localShell && (
          // 窄栏放不下 Shell 下拉，改挂到右键菜单上
          <Dropdown menu={shellMenu} trigger={['contextMenu']} placement="bottomLeft">
            <Tooltip title={text('quickConnect.localTooltip', { shell: shellLabel })} placement="right">
              <div onClick={connectLocal} style={iconBtn(localActive, true)}>
                <DesktopOutlined style={{ color: palette.accent, fontSize: 16 }} />
              </div>
            </Tooltip>
          </Dropdown>
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
                    <span style={{ fontSize: 13, fontWeight: 500, color: active ? palette.siderTextActive : palette.siderText }}>
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
          <ThunderboltOutlined style={{ color: palette.accent }} /> {text('quickConnect.title')}
        </span>
        <Tooltip title={text('quickConnect.refreshHosts')} placement="right">
          <ReloadOutlined spin={loading} onClick={load} style={{ color: palette.textMute, cursor: 'pointer', fontSize: 12 }} />
        </Tooltip>
      </div>

      {/* 搜索 */}
      <Input
        size="small"
        allowClear
        placeholder={text('quickConnect.searchPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        prefix={<TagsOutlined style={{ color: palette.textMute, fontSize: 12 }} />}
        // 必须显式给字号：antd 的 size="small" 只调高度和内边距，字号仍是 token 里的
        // 14px——于是这个搜索框成了整条侧栏最大的字（主机行 13、标签 11、IP 10），
        // 一眼就突兀。12.5 与终端标签同号，比它过滤的列表略小，符合「过滤框」的惯例。
        style={{ marginBottom: 8, fontSize: 12.5 }}
      />

      {/* 本地终端入口：点整行开终端，右侧小标签点开可换 Shell（cmd / PowerShell / pwsh） */}
      {localShell && (
        <div
          onClick={connectLocal}
          title={text('quickConnect.localTitle', { shell: shellLabel })}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', marginBottom: 6,
            borderRadius: 8, cursor: 'pointer', fontSize: 13,
            color: localActive ? palette.siderTextActive : palette.siderText,
            background: localActive ? palette.siderActive : 'rgba(0,110,255,0.07)',
            border: `1px solid ${localActive ? palette.primaryBorder : 'rgba(0,110,255,0.18)'}`,
          }}
        >
          <DesktopOutlined style={{ color: palette.accent }} />
          <span style={{ flex: 1 }}>{text('quickConnect.localTerminal')}</span>
          <Dropdown menu={shellMenu} trigger={['click']} placement="bottomRight">
            <span
              // 选 Shell 的点击不能冒泡到整行，否则顺手多开一个终端
              onClick={(e) => e.stopPropagation()}
              title={text('quickConnect.pickShell', { shell: shellLabel })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
                padding: '1px 5px', borderRadius: 5, fontSize: 11, lineHeight: '16px',
                color: palette.textMute, background: 'rgba(127,127,127,0.14)',
              }}
            >
              {shellKind || text('common.default')}
              <CaretDownOutlined style={{ fontSize: 9 }} />
            </span>
          </Dropdown>
          <PlusOutlined style={{ fontSize: 11, color: palette.textMute }} />
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
            description={<span style={{ color: palette.textMute, fontSize: 12 }}>{q ? text('quickConnect.noMatchedHosts') : text('quickConnect.noHosts')}</span>}
            style={{ marginTop: 24 }}
          />
        ) : (
          <>
            {/* 最近连接（不搜索时置顶） */}
            {!q && recentHosts.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', color: '#7c8aa5', fontSize: 12, fontWeight: 500 }}>
                  <HistoryOutlined style={{ fontSize: 11 }} />
                  <span style={{ flex: 1 }}>{text('quickConnect.recent')}</span>
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
                      color: '#7c8aa5', fontSize: 12, fontWeight: 500, userSelect: 'none',
                    }}
                  >
                    {folded ? <CaretRightOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                    <span style={{ fontSize: 10, color: palette.textMute }}>{hosts.length}</span>
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
