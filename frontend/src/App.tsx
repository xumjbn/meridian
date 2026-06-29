import React, { useState, Suspense, lazy } from 'react';
import { Layout, Menu, ConfigProvider, theme, Tooltip, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  FileSearchOutlined,
  GithubOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './components/Logo';
import { TerminalTabBar } from './components/TerminalTabBar';
import { QuickConnect } from './components/QuickConnect';
import { GlobalSearch } from './components/GlobalSearch';
import { TerminalProvider, useTerminals } from './terminalSessions';
import { brand, palette, antdLightToken } from './theme';

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const ForcePasswordChange = lazy(() => import('./pages/ForcePasswordChange').then((m) => ({ default: m.ForcePasswordChange })));

// 按路由懒加载页面，重型依赖（xterm.js）不再进入首屏主包
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Assets = lazy(() => import('./pages/Assets').then((m) => ({ default: m.Assets })));
const ScanTasks = lazy(() => import('./pages/ScanTasks').then((m) => ({ default: m.ScanTasks })));
const Vulns = lazy(() => import('./pages/Vulns').then((m) => ({ default: m.Vulns })));
const Credentials = lazy(() => import('./pages/Credentials').then((m) => ({ default: m.Credentials })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })));
const K8sClusters = lazy(() => import('./pages/K8sClusters').then((m) => ({ default: m.K8sClusters })));
const TerminalPage = lazy(() => import('./pages/TerminalPage').then((m) => ({ default: m.TerminalPage })));

const { Sider, Content } = Layout;

const PageFallback: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

const EXPANDED = 224;
const COLLAPSED = 76;

// 完整导航项（含仅管理员可见的「用户管理」），用于路由高亮与标题解析
const navItems = [
  { key: '/', icon: <DashboardOutlined style={{ fontSize: 16 }} />, label: '控制台' },
  { key: '/assets', icon: <DatabaseOutlined style={{ fontSize: 16 }} />, label: '资产清单 (CMDB)' },
  { key: '/k8s', icon: <CloudServerOutlined style={{ fontSize: 16 }} />, label: 'Kubernetes 集群' },
  { key: '/tasks', icon: <RadarChartOutlined style={{ fontSize: 16 }} />, label: '自动发现' },
  { key: '/credentials', icon: <SafetyCertificateOutlined style={{ fontSize: 16 }} />, label: '凭据保管箱' },
  { key: '/users', icon: <TeamOutlined style={{ fontSize: 16 }} />, label: '用户管理' },
  { key: '/audit', icon: <FileSearchOutlined style={{ fontSize: 16 }} />, label: '审计日志' },
  { key: '/settings', icon: <SettingOutlined style={{ fontSize: 16 }} />, label: '系统设置' },
];

// 仅管理员可见的菜单项（自动发现涉及全网扫描；系统设置含平台级敏感配置）
const adminOnlyKeys = ['/tasks', '/users', '/audit', '/settings'];

// 按角色过滤侧边栏：普通用户隐藏管理员专属项（分组子项亦随之过滤）
// shell 优先：管理导航降级为可折叠子菜单，默认收起，给「快速连接」让位
const buildMenu = (isAdmin: boolean) => {
  const flat = isAdmin ? navItems : navItems.filter((i) => !adminOnlyKeys.includes(i.key));
  const pick = (keys: string[]) => flat.filter((i) => keys.includes(i.key));
  const submenu = (key: string, label: string, icon: React.ReactNode, keys: string[]) => {
    const children = pick(keys);
    return children.length ? [{ key, label, icon, children }] : [];
  };
  const grouped: MenuProps['items'] = [
    ...pick(['/']),
    ...submenu('g-asset', '资产中心', <DatabaseOutlined style={{ fontSize: 16 }} />, ['/assets', '/k8s', '/tasks']),
    ...submenu('g-sys', '接入与系统', <SettingOutlined style={{ fontSize: 16 }} />, ['/credentials', '/users', '/audit', '/settings']),
  ];
  return { flat, grouped };
};

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { sessions, activeId, close, setActive, reorder } = useTerminals();

  const isAdmin = (localStorage.getItem('mrd-role') || 'admin') === 'admin';
  const { flat: menuNavItems, grouped: groupedItems } = buildMenu(isAdmin);

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
              colorBgBase: palette.siderBg,
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
                itemHeight: 34,
                fontSize: 13,
                itemBorderRadius: 9,
                itemMarginInline: 0,
                groupTitleColor: '#5b6680',
                groupTitleFontSize: 11,
                iconSize: 15,
                subMenuItemBg: 'transparent',
              },
              Tooltip: {
                colorBgSpotlight: '#1e293b',
                colorTextLightSolid: '#f8fafc',
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

            {/* 主体：快速连接（展开时）+ 管理导航 */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: collapsed ? '12px 10px' : '12px 12px' }}>
              {!collapsed && (
                <div style={{ flex: 1, minHeight: 0, marginBottom: 8 }}>
                  <QuickConnect />
                </div>
              )}
              <div
                style={{
                  flexShrink: 0,
                  ...(collapsed ? {} : { borderTop: `1px solid ${palette.siderBorder}`, paddingTop: 8 }),
                }}
              >
                {!collapsed && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#5b6680', padding: '0 6px 4px', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    管理
                  </div>
                )}
                <Menu
                  mode="inline"
                  inlineCollapsed={collapsed}
                  selectedKeys={[selectedKey]}
                  items={collapsed ? menuNavItems : groupedItems}
                  onClick={(info) => {
                    navigate(info.key);
                    setActive(null); // 离开终端、显示所选页面（否则终端常驻挡住页面）
                  }}
                  style={{ background: 'transparent', borderRight: 0 }}
                />
              </div>
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
                onReorder={reorder}
              />
            )}

            {/* 普通页面：激活终端时仅隐藏（display:none），保留页面状态；自身可滚动 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: activeId === null ? 'block' : 'none' }}>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/assets" element={<Assets />} />
                  <Route path="/k8s" element={<K8sClusters />} />
                  {isAdmin && <Route path="/tasks" element={<ScanTasks />} />}
                  {isAdmin && <Route path="/vulns" element={<Vulns />} />}
                  <Route path="/credentials" element={<Credentials />} />
                  {isAdmin && <Route path="/users" element={<Users />} />}
                  {isAdmin && <Route path="/audit" element={<Audit />} />}
                  {isAdmin && <Route path="/settings" element={<Settings />} />}
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
  const [mustChange, setMustChange] = useState(localStorage.getItem('mrd-must-change') === '1');

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
          <Login
            onSuccess={() => {
              setMustChange(localStorage.getItem('mrd-must-change') === '1');
              setAuthed(true);
            }}
          />
        </Suspense>
      </ConfigProvider>
    );
  }

  // 首次登录强制改密：改密完成前无法进入系统（刷新也会拦截）
  if (mustChange) {
    return (
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken }}>
        <Suspense fallback={<PageFallback />}>
          <ForcePasswordChange onDone={() => setMustChange(false)} />
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
