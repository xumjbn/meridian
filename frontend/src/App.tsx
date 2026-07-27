import React, { useState, useEffect, Suspense, lazy } from 'react';
import { ConfigProvider, theme, Tooltip, Spin } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  RadarChartOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  FileSearchOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { TerminalTabBar } from './components/TerminalTabBar';
import { QuickConnect } from './components/QuickConnect';
import { GlobalSearch } from './components/GlobalSearch';
import { EasterEgg } from './components/EasterEgg';
import { AppHeader, type HeaderNavItem } from './components/AppHeader';
import { ShortcutHelp } from './components/ShortcutHelp';
import { TerminalProvider, useTerminals } from './terminalSessions';
import { login, isTauri, type Asset } from './services/api';
import { SftpDrawer } from './components/SftpDrawer';
import { brand, palette, antdLightToken, antdComponents } from './theme';

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

const PageFallback: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240 }}>
    <Spin size="large" />
  </div>
);

const EXPANDED = 236;
const COLLAPSED = 64;

// 完整导航项（含仅管理员可见的「用户管理」），用于路由高亮与标题解析
const navItems = [
  { key: '/', icon: <DashboardOutlined style={{ fontSize: 15 }} />, label: '控制台' },
  { key: '/assets', icon: <DatabaseOutlined style={{ fontSize: 15 }} />, label: '资产清单' },
  { key: '/k8s', icon: <CloudServerOutlined style={{ fontSize: 15 }} />, label: 'K8s 集群' },
  { key: '/tasks', icon: <RadarChartOutlined style={{ fontSize: 15 }} />, label: '自动发现' },
  { key: '/credentials', icon: <SafetyCertificateOutlined style={{ fontSize: 15 }} />, label: '凭据保管箱' },
  { key: '/users', icon: <TeamOutlined style={{ fontSize: 15 }} />, label: '用户管理' },
  { key: '/audit', icon: <FileSearchOutlined style={{ fontSize: 15 }} />, label: '审计日志' },
  { key: '/settings', icon: <SettingOutlined style={{ fontSize: 15 }} />, label: '系统设置' },
];

// 仅管理员可见的菜单项（自动发现涉及全网扫描；系统设置含平台级敏感配置）
const adminOnlyKeys = ['/tasks', '/users', '/audit', '/settings'];

// 顶栏一级导航：总览 + 两个下拉分组；按角色裁剪管理员专属项。
// 页面导航只在顶栏出现一次，侧栏留给「快速连接」主机树。
const buildMenu = (isAdmin: boolean) => {
  const flat = isAdmin ? navItems : navItems.filter((i) => !adminOnlyKeys.includes(i.key));
  const pick = (keys: string[]) => flat.filter((i) => keys.includes(i.key));
  const headerItems: HeaderNavItem[] = [{ key: '/', label: '总览' }];
  const asset = pick(['/assets', '/k8s', '/tasks']);
  if (asset.length) headerItems.push({ key: 'h-asset', label: '资产中心', children: asset.map((i) => ({ key: i.key, label: i.label, icon: i.icon })) });
  const sys = pick(['/credentials', '/users', '/audit', '/settings']);
  if (sys.length) headerItems.push({ key: 'h-sys', label: '接入与系统', children: sys.map((i) => ({ key: i.key, label: i.label, icon: i.icon })) });
  return { headerItems };
};

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { sessions, activeId, close, setActive, reorder, activityIds, renameSession, recolorSession } = useTerminals();

  // 侧栏主机右键菜单触发的全局动作：打开 SFTP / 跳转页面
  const [sftpAsset, setSftpAsset] = useState<Asset | null>(null);
  const [sftpPath, setSftpPath] = useState('');
  const [sftpOpen, setSftpOpen] = useState(false);
  useEffect(() => {
    // 事件载荷兼容两种形态：资产本身（侧栏右键），或 { asset, path }（终端里带当前目录打开）
    const onSftp = (e: Event) => {
      const d = (e as CustomEvent<Asset | { asset: Asset; path?: string }>).detail;
      const isWrapped = !!d && typeof d === 'object' && 'asset' in d;
      setSftpAsset(isWrapped ? (d as { asset: Asset }).asset : (d as Asset));
      setSftpPath(isWrapped ? (d as { path?: string }).path || '' : '');
      setSftpOpen(true);
    };
    const onNav = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (p) { navigate(p); setActive(null); }
    };
    window.addEventListener('lynx-open-sftp', onSftp);
    window.addEventListener('lynx-navigate', onNav);
    return () => {
      window.removeEventListener('lynx-open-sftp', onSftp);
      window.removeEventListener('lynx-navigate', onNav);
    };
  }, [navigate, setActive]);

  const isAdmin = (localStorage.getItem('lynx-role') || 'admin') === 'admin';
  const { headerItems } = buildMenu(isAdmin);

  const selectedKey = (() => {
    const path = location.pathname;
    if (path === '/' || path === '') return '/';
    const found = navItems.find((item) => item.key !== '/' && path.startsWith(item.key));
    return found ? found.key : '/';
  })();

  const currentLabel = navItems.find((i) => i.key === selectedKey)?.label ?? '工作台';
  const siderWidth = collapsed ? COLLAPSED : EXPANDED;

  // 跳转页面并退出终端视图（否则常驻终端会挡住页面）
  const go = (path: string) => { navigate(path); setActive(null); };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: antdLightToken,
        components: antdComponents,
      }}
    >
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: palette.bg, overflow: 'hidden' }}>
        {/* 全局顶栏 */}
        <AppHeader items={headerItems} activeKey={selectedKey} onNavigate={go} onHelp={() => setHelpOpen(true)} />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
          {/* 左侧栏（深色，与顶栏同色）：快速连接主机树 + 管理导航 */}
          <ConfigProvider
            theme={{
              algorithm: theme.darkAlgorithm,
              token: {
                colorBgBase: palette.siderBg,
                colorBgContainer: palette.siderBg,
                colorText: palette.chromeTextStrong,
                colorTextDescription: palette.chromeText,
                colorBorder: palette.siderBorder,
                colorPrimary: palette.primary,
                borderRadius: 4,
              },
              components: {
                Menu: {
                  itemBg: 'transparent',
                  itemSelectedBg: palette.siderActive,
                  itemSelectedColor: palette.siderTextActive,
                  itemColor: palette.siderText,
                  itemHoverBg: palette.siderHover,
                  itemHoverColor: palette.chromeTextStrong,
                  itemHeight: 36,
                  fontSize: 13,
                  itemBorderRadius: 0,
                  itemMarginInline: 0,
                  itemMarginBlock: 0,
                  iconSize: 15,
                  subMenuItemBg: 'transparent',
                  popupBg: palette.headerBg2,
                },
                Tooltip: { colorBgSpotlight: '#1e2740', colorTextLightSolid: '#f1f5f9' },
                Empty: { colorTextDescription: palette.chromeTextMute },
              },
            }}
          >
          <div
            className="lynx-sider"
            style={{
              width: siderWidth,
              flexShrink: 0,
              background: palette.siderBg,
              borderRight: `1px solid ${palette.siderBorder}`,
              display: 'flex',
              flexDirection: 'column',
              transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
              zIndex: 10,
            }}
          >
            {/* 侧栏只放「快速连接」主机树并占满高度：
                页面导航一律走顶栏，不在两处重复同一套路由。 */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: collapsed ? '10px 8px' : '10px' }}>
              <QuickConnect collapsed={collapsed} />
            </div>

            {/* 底部：版本号 */}
            {!collapsed && (
              <div
                style={{
                  borderTop: `1px solid ${palette.siderBorder}`,
                  padding: '8px 16px',
                  fontSize: 11,
                  color: palette.chromeTextMute,
                  fontFamily: 'monospace',
                }}
              >
                {brand.name} {brand.version}
              </div>
            )}
          </div>
          </ConfigProvider>

          {/* 侧栏右缘的展开/收起把手 */}
          <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
            <div
              onClick={() => setCollapsed((c) => !c)}
              style={{
                position: 'absolute',
                left: siderWidth - 1,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 14,
                height: 46,
                zIndex: 20,
                cursor: 'pointer',
                background: palette.headerBg2,
                border: `1px solid ${palette.siderBorder}`,
                borderLeft: 'none',
                borderRadius: '0 6px 6px 0',
                color: palette.chromeText,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '2px 0 6px rgba(0,0,0,0.25)',
                transition: 'left 0.2s cubic-bezier(0.4,0,0.2,1)',
              }}
            >
              {collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <LeftOutlined style={{ fontSize: 10 }} />}
            </div>
          </Tooltip>

          {/* 右侧主区 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {sessions.length > 0 && (
              <TerminalTabBar
                sessions={sessions}
                activeId={activeId}
                currentPageLabel={currentLabel}
                onSelectPage={() => setActive(null)}
                onSelect={setActive}
                onClose={close}
                onReorder={reorder}
                activityIds={activityIds}
                onRename={renameSession}
                onRecolor={recolorSession}
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
                  <TerminalPage
                    assetId={s.id}
                    embedded
                    onClose={() => close(s.id)}
                    onOpenSettings={() => { setActive(null); navigate('/settings'); }}
                  />
                </Suspense>
              </div>
            ))}
          </div>
        </div>

        {/* 全局搜索（Ctrl/Cmd + K） */}
        <GlobalSearch />

        {/* 彩蛋：输入 wjw i love u */}
        <EasterEgg />

        {/* 顶栏「?」打开的快捷键速查表 */}
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

        {/* 侧栏主机右键「文件传输」打开的 SFTP 抽屉 */}
        <SftpDrawer asset={sftpAsset} open={sftpOpen} initialPath={sftpPath} onClose={() => setSftpOpen(false)} />
      </div>
    </ConfigProvider>
  );
};

export const App: React.FC = () => {
  // 桌面端（Tauri）：本机单用户实例，免登录页——直接进入，token 后台静默获取。
  // 但「主动退出登录」(lynx-logged-out) 时不自动登录，落到登录页可切换账户。
  const desktopAuto = isTauri && localStorage.getItem('lynx-logged-out') !== '1';
  const [authed, setAuthed] = useState(localStorage.getItem('lynx-auth') === '1' || desktopAuto);
  const [mustChange, setMustChange] = useState(!isTauri && localStorage.getItem('lynx-must-change') === '1');

  useEffect(() => {
    if (!desktopAuto || localStorage.getItem('lynx-token')) return;
    // 乐观角色：先按 admin 显示菜单，真实角色登录成功后覆盖
    if (!localStorage.getItem('lynx-role')) localStorage.setItem('lynx-role', 'admin');
    let cancelled = false;
    const creds: Array<[string, string]> = [['admin', 'admin'], ['admin', '123456']];
    const isCredErr = (e: any) => /密码|password|用户|账户|account|credential|invalid/i.test(String(e?.message || ''));
    // 单次登录最多等 8s，避免连接挂死导致永远不返回
    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    (async () => {
      // 后台持续重试（后端 sidecar 晚起也能恢复）；默认密码全部不对则落登录页让用户手动输
      for (let i = 0; i < 40 && !cancelled; i++) {
        let networkErr = false;
        let credErr = false;
        for (const [u, p] of creds) {
          if (cancelled) return;
          try {
            const r = await withTimeout(login(u, p), 8000);
            localStorage.setItem('lynx-auth', '1');
            localStorage.setItem('lynx-token', r.token || '');
            localStorage.setItem('lynx-user', r.username || u);
            localStorage.setItem('lynx-role', r.role || 'admin');
            localStorage.removeItem('lynx-must-change');
            window.dispatchEvent(new CustomEvent('lynx-auth-ready'));
            return;
          } catch (e: any) {
            if (isCredErr(e)) credErr = true;
            else { networkErr = true; break; } // 后端未就绪/超时 → 等待后重试整轮
          }
        }
        if (networkErr) { await new Promise((res) => setTimeout(res, 1000)); continue; }
        // 没有网络错误、也没成功 → 默认账户密码不可用 → 弹登录页让用户手动登录
        if (credErr && !cancelled) { setAuthed(false); return; }
      }
      // 重试次数耗尽仍未拿到 token（后端持续超时/异常）→ 落登录页，避免卡死在空白/转圈
      if (!cancelled && !localStorage.getItem('lynx-token')) setAuthed(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 独立标签页打开的全屏终端模式
  const isTerminalView = window.location.pathname.startsWith('/terminal/');
  const terminalAssetId = isTerminalView ? window.location.pathname.split('/').pop() : null;

  if (isTerminalView && terminalAssetId) {
    return (
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken, components: antdComponents }}>
        {/* TerminalPage/TerminalItem 依赖 useTerminals，必须置于 Provider 内，否则独立标签页打开会白屏 */}
        <TerminalProvider>
          <Suspense fallback={<PageFallback />}>
            <TerminalPage assetId={parseInt(terminalAssetId)} />
          </Suspense>
        </TerminalProvider>
      </ConfigProvider>
    );
  }

  // 登录门禁：未登录时渲染登录页（桌面端 authed 恒为 true，不会走到这里）
  if (!authed) {
    return (
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken, components: antdComponents }}>
        <Suspense fallback={<PageFallback />}>
          <Login
            onSuccess={() => {
              localStorage.removeItem('lynx-logged-out'); // 恢复桌面端自动登录
              setMustChange(localStorage.getItem('lynx-must-change') === '1');
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
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: antdLightToken, components: antdComponents }}>
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
