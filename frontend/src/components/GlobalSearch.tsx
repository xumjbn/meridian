import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Input, Empty, Spin } from 'antd';
import {
  SearchOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  BugOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { palette } from '../theme';
import { getAssets } from '../services/api';
import type { Asset } from '../services/api';

interface QuickLink {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  { path: '/', label: '控制台', icon: <DashboardOutlined /> },
  { path: '/assets', label: '资产清单', icon: <DatabaseOutlined /> },
  { path: '/tasks', label: '自动发现', icon: <RadarChartOutlined /> },
  { path: '/vulns', label: '漏洞发现', icon: <BugOutlined /> },
  { path: '/credentials', label: '凭据保管箱', icon: <SafetyCertificateOutlined /> },
  { path: '/settings', label: '系统设置', icon: <SettingOutlined /> },
];

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.4px',
  color: palette.textMute,
  textTransform: 'uppercase',
  padding: '10px 14px 6px',
};

export const GlobalSearch: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const debounceRef = useRef<number | undefined>(undefined);

  // 全局快捷键：Ctrl/Cmd + K 打开
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 防抖检索资产
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current !== undefined) {
      window.clearTimeout(debounceRef.current);
    }
    if (!q) {
      setAssets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      getAssets({ q })
        .then((res) => setAssets(res.slice(0, 8)))
        .catch(() => setAssets([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setAssets([]);
  }, []);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      close();
    },
    [navigate, close]
  );

  const q = query.trim().toLowerCase();
  const filteredLinks = q
    ? QUICK_LINKS.filter((l) => l.label.toLowerCase().includes(q) || l.path.includes(q))
    : QUICK_LINKS;

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    color: palette.text,
    transition: 'background 0.12s ease',
  };

  const onRowEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = palette.bg;
  };
  const onRowLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = 'transparent';
  };

  const hasAssetResults = q.length > 0;

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      closable={false}
      destroyOnHidden
      width={560}
      styles={{ body: { padding: 0 }, content: { padding: 0, overflow: 'hidden' } }}
      style={{ top: 96 }}
    >
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${palette.border}` }}>
        <Input
          autoFocus
          variant="borderless"
          size="large"
          prefix={<SearchOutlined style={{ color: palette.textMute, fontSize: 16 }} />}
          placeholder="搜索资产、跳转页面…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ fontSize: 15 }}
        />
      </div>

      <div style={{ maxHeight: 420, overflowY: 'auto', padding: '6px 8px 12px' }}>
        {/* 快捷跳转 */}
        {filteredLinks.length > 0 && (
          <>
            <div style={sectionTitleStyle}>快捷跳转</div>
            {filteredLinks.map((l) => (
              <div
                key={l.path}
                style={rowStyle}
                onMouseEnter={onRowEnter}
                onMouseLeave={onRowLeave}
                onClick={() => go(l.path)}
              >
                <span style={{ color: palette.primary, fontSize: 15, display: 'inline-flex' }}>{l.icon}</span>
                <span style={{ fontSize: 14 }}>{l.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textMute }}>{l.path}</span>
              </div>
            ))}
          </>
        )}

        {/* 资产搜索结果 */}
        {hasAssetResults && (
          <>
            <div style={sectionTitleStyle}>资产</div>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <Spin />
              </div>
            ) : assets.length > 0 ? (
              assets.map((a) => (
                <div
                  key={a.id ?? `${a.name}-${a.ip}`}
                  style={rowStyle}
                  onMouseEnter={onRowEnter}
                  onMouseLeave={onRowLeave}
                  onClick={() => go('/assets')}
                >
                  <span style={{ color: palette.accent, fontSize: 15, display: 'inline-flex' }}>
                    <DatabaseOutlined />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{a.name}</span>
                  <span style={{ fontSize: 12.5, color: palette.textSub, fontFamily: 'monospace' }}>{a.ip}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textMute }}>{a.type}</span>
                </div>
              ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="未找到匹配的资产"
                style={{ padding: '12px 0', color: palette.textMute }}
              />
            )}
          </>
        )}

        {filteredLinks.length === 0 && !hasAssetResults && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配项" style={{ padding: '20px 0' }} />
        )}
      </div>
    </Modal>
  );
};

export default GlobalSearch;
