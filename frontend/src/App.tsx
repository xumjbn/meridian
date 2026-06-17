import React from 'react';
import { Layout, Menu, ConfigProvider, theme } from 'antd';
import {
  DashboardOutlined,
  BuildOutlined,
  ScanOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Assets } from './pages/Assets';
import { ScanTasks } from './pages/ScanTasks';
import { Credentials } from './pages/Credentials';
import { Settings } from './pages/Settings';
import { TerminalPage } from './pages/TerminalPage';

const { Sider, Content } = Layout;

const menuItems = [
  {
    key: '/',
    icon: <DashboardOutlined style={{ fontSize: 16 }} />,
    label: '控制台首页',
  },
  {
    key: '/assets',
    icon: <BuildOutlined style={{ fontSize: 16 }} />,
    label: '资产管理 (CMDB)',
  },
  {
    key: '/tasks',
    icon: <ScanOutlined style={{ fontSize: 16 }} />,
    label: '自动发现任务',
  },
  {
    key: '/credentials',
    icon: <SafetyOutlined style={{ fontSize: 16 }} />,
    label: '凭据管理 Vault',
  },
  {
    key: '/settings',
    icon: <SettingOutlined style={{ fontSize: 16 }} />,
    label: '系统设置',
  },
];

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = (() => {
    const path = location.pathname;
    if (path === '/' || path === '') return '/';
    const found = menuItems.find(item => item.key !== '/' && path.startsWith(item.key));
    return found ? found.key : '/';
  })();

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorBgBase: '#f8fafc',
          colorBgContainer: '#ffffff',
          colorText: '#0f172a',
          colorTextDescription: '#64748b',
          colorBorder: '#f1f5f9',
          borderRadius: 6,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        components: {
          Button: {
            controlHeight: 34,
            borderRadius: 6,
            fontWeight: 500,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            headerBorderRadius: 0,
            rowHoverBg: '#f8fafc',
          },
          Card: {
            borderRadiusLG: 8,
          },
        },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <ConfigProvider
          theme={{
            algorithm: theme.darkAlgorithm,
            token: {
              colorBgContainer: '#0f172a',
              colorText: '#94a3b8',
              colorBorder: '#1e293b',
              borderRadius: 6,
            },
            components: {
              Layout: {
                siderBg: '#0f172a',
                triggerBg: '#1e293b',
              },
              Menu: {
                itemBg: 'transparent',
                itemSelectedBg: '#1e293b',
                itemSelectedColor: '#ffffff',
                itemColor: '#94a3b8',
                itemHoverBg: '#1e293b',
                itemHoverColor: '#ffffff',
                itemActiveBg: '#1e293b',
                itemHeight: 38,
                itemBorderRadius: 6,
              },
            },
          }}
        >
          <Sider
            breakpoint="lg"
            collapsedWidth="0"
            width={220}
            theme="light"
            style={{
              background: '#0f172a',
              position: 'fixed',
              height: '100vh',
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 100,
              borderRight: '1px solid #1e293b',
            }}
          >
            {/* Logo 区域 */}
            <div style={{
              height: 60,
              display: 'flex',
              alignItems: 'center',
              padding: '0 20px',
              background: '#0f172a',
              borderBottom: '1px solid #1e293b',
            }}>
              <span style={{
                fontSize: '14px',
                fontWeight: 700,
                color: '#ffffff',
                letterSpacing: '0.2px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                🖥️ <span style={{ background: 'linear-gradient(120deg, #ffffff, #cbd5e1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AssetManager</span>
              </span>
            </div>

            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={(info) => navigate(info.key)}
              style={{
                background: 'transparent',
                borderRight: 0,
                padding: '16px 12px',
              }}
            />
          </Sider>
        </ConfigProvider>

        <Layout style={{ marginLeft: 220, background: '#f8fafc' }}>
          <Content style={{ minHeight: '100vh', padding: '0px', overflowY: 'auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/tasks" element={<ScanTasks />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};

export const App: React.FC = () => {
  // 检查是否为独立标签页打开的全屏终端模式
  const isTerminalView = window.location.pathname.startsWith('/terminal/');
  const terminalAssetId = isTerminalView ? window.location.pathname.split('/').pop() : null;

  if (isTerminalView && terminalAssetId) {
    return (
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#2563eb',
            borderRadius: 8,
            colorBgBase: '#f8fafc',
            colorBgContainer: '#ffffff',
          },
        }}
      >
        <TerminalPage assetId={parseInt(terminalAssetId)} />
      </ConfigProvider>
    );
  }

  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
};

export default App;
