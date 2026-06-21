import React, { useState, Suspense, lazy } from 'react';
import { Layout, Menu, ConfigProvider, theme, Tooltip, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  GithubOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './components/Logo';
import { TerminalTabBar } from './components/TerminalTabBar';
import { GlobalSearch } from './components/GlobalSearch';
import { TerminalProvider, useTerminals } from './terminalSessions';
import { brand, palette, antdLightToken } from './theme';

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));

// 按路由懒加载页面，重型依赖（xterm.js）不再进入首屏主包
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Assets = lazy(() => import('./pages/Assets').then((m) => ({ default: m.Assets })));
const ScanTasks = lazy(() => import('./pages/ScanTasks').then((m) => ({ default: m.ScanTasks })));
const Vulns = lazy(() => import('./pages/Vulns').then((m) => ({ default: m.Vulns })));
const Credentials = lazy(() => import('./pages/Credentials').then((m) => ({ default: m.Credentials })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const TerminalPage = lazy(() => import('./pages/TerminalPage').then((m) => ({ default: m.TerminalPage })));

const { Sider, Content } = Layout;

const PageFallback: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

const EXPANDED = 224;
const COLLAPSED = 76;

const navItems = [
  { key: '/', icon: <DashboardOutlined style={{ fontSize: 16 }} />, label: '控制台' },
  { key: '/assets', icon: <DatabaseOutlined style={{ fontSize: 16 }} />, label: '资产清单 (CMDB)' },
  { key: '/tasks', icon: <RadarChartOutlined style={{ fontSize: 16 }} />, label: '自动发现' },
  { key: '/credentials', icon: <SafetyCertificateOutlined style={{ fontSize: 16 }} />, label: '凭据保管箱' },
  { key: '/settings', icon: <SettingOutlined style={{ fontSize: 16 }} />, label: '系统设置' },
];

const groupedItems: MenuProps['items'] = [
  { type: 'group', label: '概览', children: [navItems[0]] },
  { type: 'group', label: '资产中心', children: [navItems[1], navItems[2]] },
  { type: 'group', label: '接入与系统', children: [navItems[3], navItems[4]] },
];

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { sessions, activeId, close, setActive } = useTerminals();

  const selectedKey = (() => {
    const path = location.pathname;
    if (path === '/' || path === '') return '/';
    const found = navItems.find((item) => item.key !== '/' && path.startsWith(item.key));
    return found ? found.key : '/';
  })();

  const currentLabel = navItems.find((i) => i.key === selectedKey)?.label ?? '工作台';
  const siderWidth = collapsed ? COLLAPSED : EXPANDED;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: antdLightToken,
        components: {
          Button: { controlHeight: 36, borderRadius: 8, fontWeight: 500, primaryShadow: 'none' },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            headerBorderRadius: 10,
            rowHoverBg: '#f7f8fc',
            borderColor: palette.border,
            cellPaddingBlock: 14,
          },
          Card: { borderRadiusLG: 12 },
          Modal: { borderRadiusLG: 14 },
          Drawer: { colorBgElevated: '#ffffff' },
          Segmented: { borderRadius: 8 },
        },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: palette.bg }}>
        {/* 深色侧边栏 */}
        <ConfigProvider
          theme={{
            algorithm: theme.darkAlgorithm,
            token: {
              colorBgContainer: palette.siderBg,
              colorText: palette.siderText,
              colorBorder: palette.siderBorder,
              borderRadius: 8,
            },
            components: {
              Menu: {
                itemBg: 'transparent',
                itemSelectedBg: palette.siderActive,
                itemSelectedColor: '#ffffff',
                itemColor: palette.siderText,
                itemHoverBg: palette.siderHover,
                itemHoverColor: '#ffffff',
                itemActiveBg: palette.siderActive,
                itemHeight: 42,
                itemBorderRadius: 9,
                itemMarginInline: 0,
                groupTitleColor: '#5b6680',
                groupTitleFontSize: 11,
                iconSize: 16,
              },
            },
          }}
        >
          <Sider
            width={siderWidth}
            theme="light"
            className="mrd-sider"
            style={{
              background: `linear-gradient(180deg, ${palette.siderBg2} 0%, ${palette.siderBg} 100%)`,
              position: 'fixed',
              height: '100vh',
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 100,
              borderRight: `1px solid ${palette.siderBorder}`,
              transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
           <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Logo 区域 */}
            <div
              style={{
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? 0 : '0 18px',
                borderBottom: `1px solid ${palette.siderBorder}`,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* 顶部品牌辉光 */}
              <div
                style={{
                  position: 'absolute',
                  top: -40,
                  left: collapsed ? '50%' : 24,
                  width: 120,
                  height: 90,
                  transform: collapsed ? 'translateX(-50%)' : 'none',
                  background: 'radial-gradient(closest-side, rgba(99,102,241,0.35), transparent)',
                  pointerEvents: 'none',
                }}
              />
              <Logo size={34} collapsed={collapsed} />
            </div>

            {/* 导航菜单 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '12px 10px' : '12px 12px' }}>
              <Menu
                mode="inline"
                inlineCollapsed={collapsed}
                selectedKeys={[selectedKey]}
                items={collapsed ? navItems : groupedItems}
                onClick={(info) => navigate(info.key)}
                style={{ background: 'transparent', borderRight: 0 }}
              />
            </div>

            {/* 底部：源码 / 版本 / 折叠 */}
            <div style={{ borderTop: `1px solid ${palette.siderBorder}`, padding: collapsed ? '10px' : '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: collapsed ? 'center' : 'space-between' }}>
                {!collapsed && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <Tooltip title="项目源码">
                      <a
                        href={brand.repo}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: palette.siderText, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                      >
                        <GithubOutlined /> 源码
                      </a>
                    </Tooltip>
                    <span style={{ fontSize: 11, color: palette.siderText, fontFamily: 'monospace' }}>{brand.version}</span>
                  </span>
                )}
                <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
                  <button
                    onClick={() => setCollapsed((c) => !c)}
                    style={{
                      cursor: 'pointer',
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: `1px solid ${palette.siderBorder}`,
                      background: 'rgba(148,163,184,0.08)',
                      color: palette.siderText,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  </button>
                </Tooltip>
              </div>
            </div>
           </div>
          </Sider>
        </ConfigProvider>

        <Layout style={{ marginLeft: siderWidth, background: palette.bg, transition: 'margin-left 0.2s cubic-bezier(0.4,0,0.2,1)' }}>
          <Content style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {sessions.length > 0 && (
              <TerminalTabBar
                sessions={sessions}
                activeId={activeId}
                currentPageLabel={currentLabel}
                onSelectPage={() => setActive(null)}
                onSelect={setActive}
                onClose={close}
              />
            )}

            {/* 普通页面：激活终端时仅隐藏（display:none），保留页面状态；自身可滚动 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: activeId === null ? 'block' : 'none' }}>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/assets" element={<Assets />} />
                  <Route path="/tasks" element={<ScanTasks />} />
                  <Route path="/vulns" element={<Vulns />} />
                  <Route path="/credentials" element={<Credentials />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </div>

            {/* 终端会话：常驻挂载，仅显示激活的；flex 撑满剩余高度，避免底部被裁切 */}
            {sessions.map((s) => (
              <div key={s.id} style={{ flex: 1, minHeight: 0, position: 'relative', display: activeId === s.id ? 'block' : 'none' }}>
                <Suspense fallback={<PageFallback />}>
                  <TerminalPage assetId={s.id} embedded onClose={() => close(s.id)} />
                </Suspense>
              </div>
            ))}
          </Content>
        </Layout>

        {/* 全局搜索（Ctrl/Cmd + K） */}
        <GlobalSearch />
      </Layout>
    </ConfigProvider>
  );
};

export const App: React.FC = () => {
  const [authed, setAuthed] = useState(localStorage.getItem('mrd-auth') === '1');

  // 独立标签页打开的全屏终端模式
  const isTerminalView = window.location.pathname.startsWith('/terminal/');
  const terminalAssetId = isTerminalView ? window.location.pathname.split('/').pop() : null;

  if (isTerminalView && terminalAssetId) {
    return (
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken }}>
        <Suspense fallback={<PageFallback />}>
          <TerminalPage assetId={parseInt(terminalAssetId)} />
        </Suspense>
      </ConfigProvider>
    );
  }

  // 登录门禁：未登录时渲染登录页
  if (!authed) {
    return (
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken }}>
        <Suspense fallback={<PageFallback />}>
          <Login onSuccess={() => setAuthed(true)} />
        </Suspense>
      </ConfigProvider>
    );
  }

  return (
    <BrowserRouter>
      <TerminalProvider>
        <AppLayout />
      </TerminalProvider>
    </BrowserRouter>
  );
};

export default App;
