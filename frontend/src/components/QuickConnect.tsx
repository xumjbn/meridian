import React, { useEffect, useMemo, useState } from 'react';
import { Input, Tooltip, Empty, Spin } from 'antd';
import {
  DesktopOutlined,
  ReloadOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { getAssets, getCapabilities, LOCAL_ASSET_ID, type Asset } from '../services/api';
import { useTerminals } from '../terminalSessions';
import { palette } from '../theme';

const UNGROUPED = '未分组';

const parseTags = (s?: string): string[] => {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
};

const statusColor = (s?: string) => (s === 'online' ? palette.success : s === 'offline' ? palette.danger : '#64748b');

// 左侧栏「快速连接」：按标签分组的主机树 + 本地终端，点击即开终端标签并连接
export const QuickConnect: React.FC = () => {
  const { open, sessions, activeId } = useTerminals();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [localShell, setLocalShell] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

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
    load();
    getCapabilities()
      .then((c) => setLocalShell(!!c.local_shell))
      .catch(() => setLocalShell(false));
  }, []);

  const openIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

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
    // 标签名升序，未分组置底
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b, 'zh');
    });
    return keys.map((k) => ({ tag: k, hosts: map.get(k)!.sort((a, b) => a.name.localeCompare(b.name, 'zh')) }));
  }, [assets, q]);

  const connect = (a: Asset) => open({ id: a.id!, name: a.name, ip: a.ip });
  const connectLocal = () => open({ id: LOCAL_ASSET_ID, name: '本地终端', ip: '本机' });

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    color: '#5b6680',
    textTransform: 'uppercase',
  };

  const localActive = activeId === LOCAL_ASSET_ID;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 标题 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 8px' }}>
        <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ThunderboltOutlined style={{ color: palette.accent }} /> 快速连接
        </span>
        <Tooltip title="刷新主机" placement="right">
          <ReloadOutlined
            spin={loading}
            onClick={load}
            style={{ color: '#5b6680', cursor: 'pointer', fontSize: 12 }}
          />
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
          title="本地终端（连接运行本程序的这台机器）"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 8px',
            marginBottom: 6,
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: localActive ? '#ffffff' : palette.siderText,
            background: localActive ? palette.siderActive : 'rgba(34,211,238,0.08)',
            border: `1px solid ${localActive ? palette.accent : 'rgba(34,211,238,0.18)'}`,
          }}
        >
          <DesktopOutlined style={{ color: palette.accent }} />
          <span style={{ flex: 1 }}>本地终端</span>
          <span style={{ fontSize: 10, color: '#5b6680' }}>本机</span>
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
          groups.map(({ tag, hosts }) => {
            const folded = collapsedGroups[tag];
            return (
              <div key={tag} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => setCollapsedGroups((p) => ({ ...p, [tag]: !p[tag] }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    color: '#7c8aa5',
                    fontSize: 12,
                    fontWeight: 600,
                    userSelect: 'none',
                  }}
                >
                  {folded ? <CaretRightOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  <span style={{ fontSize: 10, color: '#5b6680' }}>{hosts.length}</span>
                </div>

                {!folded &&
                  hosts.map((a) => {
                    const active = activeId === a.id;
                    const opened = openIds.has(a.id!);
                    return (
                      <div
                        key={`${tag}-${a.id}`}
                        onClick={() => connect(a)}
                        title={`${a.name} · ${a.ip}${a.status ? ` · ${a.status}` : ''}\n单击连接`}
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
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: statusColor(a.status),
                            flexShrink: 0,
                            boxShadow: opened ? `0 0 0 2px rgba(99,102,241,0.45)` : undefined,
                          }}
                        />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.name}
                        </span>
                        <span style={{ fontSize: 10, color: '#5b6680', flexShrink: 0 }}>{a.ip}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
