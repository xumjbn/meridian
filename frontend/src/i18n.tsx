/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Locale as AntdLocale } from 'antd/es/locale';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';

export type LocaleCode = 'zh-CN' | 'en-US';

const STORAGE_KEY = 'wjw-locale';

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
];

const resources: Record<LocaleCode, Record<string, string>> = {
  'zh-CN': {
    'app.language': '语言',
    'app.language.zhCN': '简体中文',
    'app.language.enUS': 'English',
    'brand.console': '控制台',
    'brand.tagline': '网络资产发现与统一接入平台',

    'common.cancel': '取消',
    'common.clear': '清空',
    'common.connect': '连接',
    'common.default': '默认',
    'common.loading': '加载中',
    'common.refresh': '刷新',
    'common.search': '搜索',
    'common.itemsSelected': '已选 {count} 项',

    'nav.console': '控制台',
    'nav.assets': '资产清单',
    'nav.k8s': 'K8s 集群',
    'nav.discovery': '自动发现',
    'nav.credentials': '凭据保管箱',
    'nav.users': '用户管理',
    'nav.audit': '审计日志',
    'nav.settings': '系统设置',
    'nav.overview': '总览',
    'nav.assetCenter': '资产中心',
    'nav.accessSystem': '接入与系统',
    'nav.workbench': '工作台',

    'app.boot.starting': '正在启动本机服务…',
    'app.boot.backendAddress': '后端地址',
    'app.boot.slowHelp': '连不上通常是端口被上一个未退出的实例占用，或本平台的 sidecar 未随包构建。',
    'app.boot.skipLogin': '跳过，直接进入登录页',
    'app.boot.backendExited': '后端进程已退出',
    'app.boot.localTimeout': '连接本机服务超时',
    'app.boot.defaultPasswordUnavailable': '默认口令不可用',
    'app.boot.cannotConnect': '无法连接本机服务',
    'app.boot.retry': '{message}（第 {current}/{total} 次重试）',
    'app.boot.serviceNotReady': '本机服务未就绪：{message}',
    'app.sidebar.expand': '展开侧栏',
    'app.sidebar.collapse': '收起侧栏',

    'header.search': '搜索资产 / 页面',
    'header.help': '快捷键帮助',
    'header.source': '项目源码',

    'login.mode.login': '账号登录',
    'login.mode.register': '注册账号',
    'login.username': '用户名',
    'login.username.placeholder': '用户名',
    'login.username.required': '请输入用户名',
    'login.username.length': '用户名长度需为 3–32 个字符',
    'login.password': '密码',
    'login.password.placeholder': '密码',
    'login.password.required': '请输入密码',
    'login.password.length': '密码长度需为 6–64 个字符',
    'login.confirmPassword': '确认密码',
    'login.confirmPassword.placeholder': '确认密码',
    'login.confirmPassword.required': '请再次输入密码',
    'login.confirmPassword.mismatch': '两次输入的密码不一致',
    'login.submit.login': '登录',
    'login.submit.register': '注册',
    'login.registerSuccess': '注册成功，请等待管理员审批后再登录',
    'login.registerFailed': '注册失败',
    'login.loginFailed': '用户名或密码错误',
    'login.loginHint': '注册账号需管理员审批后方可登录',
    'login.registerHint': '注册后请联系管理员审批开通',
    'login.subtitle': '发现资产 · 纳管集群 · 一键接入 —— 把分散的主机、集群与凭据收敛到同一个控制台。',
    'login.highlight.connect.title': '一键连接',
    'login.highlight.connect.desc': '主机树直达 SSH / SFTP，会话常驻不掉线',
    'login.highlight.cluster.title': '集群纳管',
    'login.highlight.cluster.desc': '自动识别 K8s 节点与控制台，归类即可跳转',
    'login.highlight.credential.title': '凭据集中',
    'login.highlight.credential.desc': '账号密钥统一保管，操作全程审计留痕',

    'password.changeSuccess': '密码修改成功',
    'password.changeFailed': '修改失败',
    'password.forceTitle': '首次登录，请修改密码',
    'password.forceDesc': '当前账号 {user} 仍在使用默认密码，出于安全考虑请先设置新密码',
    'password.new': '新密码',
    'password.new.placeholder': '6–64 位新密码',
    'password.new.required': '请输入新密码',
    'password.confirmNew': '确认新密码',
    'password.confirmNew.placeholder': '再次输入新密码',
    'password.confirmNew.required': '请再次输入新密码',
    'password.submitForce': '设置新密码并进入系统',
    'password.old': '原密码',
    'password.old.placeholder': '当前登录密码',
    'password.old.required': '请输入原密码',
    'password.confirmChange': '确认修改',

    'user.current': '当前用户：{user}',
    'user.changePassword': '修改密码',
    'user.logout': '退出登录',

    'globalSearch.placeholder': '搜索资产、跳转页面…',
    'globalSearch.quickJump': '快捷跳转',
    'globalSearch.assets': '资产',
    'globalSearch.noAssets': '未找到匹配的资产',
    'globalSearch.noMatches': '无匹配项',
    'globalSearch.vulns': '漏洞发现',

    'quickConnect.ungrouped': '未分组',
    'quickConnect.title': '快速连接',
    'quickConnect.refreshHosts': '刷新主机',
    'quickConnect.searchPlaceholder': '搜索主机 / IP / 标签',
    'quickConnect.localTerminal': '本地终端',
    'quickConnect.localHost': '本机',
    'quickConnect.localTerminalN': '本地终端 {count}',
    'quickConnect.localTooltip': '新建本地终端（{shell}）· 右键换 Shell',
    'quickConnect.localTitle': '新建本地终端（连接运行本程序的这台机器，可同时开多个）\n当前 Shell：{shell}',
    'quickConnect.pickShell': '选择 Shell（当前：{shell}）',
    'quickConnect.recent': '最近',
    'quickConnect.noMatchedHosts': '无匹配主机',
    'quickConnect.noHosts': '暂无主机',
    'quickConnect.hostTitle': '{name} · {ip}{tags}\n单击连接 · 右键更多 · 可拖到分屏',
    'quickConnect.menu.connect': '连接（新标签）',
    'quickConnect.menu.split': '在新分屏打开',
    'quickConnect.menu.sftp': '文件传输 (SFTP)',
    'quickConnect.menu.assets': '在资产清单查看',

    'newConnection.title': '新建连接',
    'newConnection.pickKnown': '从已有主机选（可跳过）',
    'newConnection.searchKnown': '搜索已纳管的主机…',
    'newConnection.hostIp': '主机 IP',
    'newConnection.hostIp.required': '请输入主机 IP',
    'newConnection.port': '端口',
    'newConnection.username': '用户名',
    'newConnection.password': '密码',
    'newConnection.password.extra': '仅用于本次会话，不会保存到数据库；留空则使用该资产已绑定的凭据',
    'newConnection.password.placeholder': '留空表示用已绑定凭据',
    'newConnection.name': '备注名（可选）',
    'newConnection.name.placeholder': '不填则用 IP 作为名称',
    'newConnection.assetCreateMissingId': '资产创建失败：未返回 ID',
    'newConnection.failed': '连接失败',

    'shortcut.title': '键盘快捷键',
    'shortcut.group.window': '窗口 / 标签',
    'shortcut.group.command': '命令 / 补全',
    'shortcut.group.edit': '编辑 / 剪贴板',
    'shortcut.group.view': '视图',
    'shortcut.newSplit': '新建分屏',
    'shortcut.closePane': '关闭当前分屏（仅一个时关闭标签）',
    'shortcut.switchTab': '切换到第 N 个终端标签',
    'shortcut.middleClose': '关闭该标签',
    'shortcut.dragTab': '调整标签顺序',
    'shortcut.commandPalette': '命令面板（模糊搜命令库并插入）',
    'shortcut.acceptCompletion': '接受光标后的灰色补全提示（优先该主机历史命令）',
    'shortcut.nativeCompletion': '无灰字提示时交给 Shell 原生补全',
    'shortcut.showCandidates': '弹出候选命令列表',
    'shortcut.pickCandidate': '在候选列表中选择并接受',
    'shortcut.closeCandidates': '关闭候选列表',
    'shortcut.autoCopy': '自动复制',
    'shortcut.copyPaste': '复制 / 粘贴',
    'shortcut.contextMenu': '有选区则复制，否则粘贴',
    'shortcut.zoomWheel': '缩放字号',
    'shortcut.zoomInOut': '放大 / 缩小字号',
    'shortcut.zoomReset': '字号复位',
    'shortcut.searchTerminal': '终端内搜索',
    'shortcut.openHelp': '打开本速查表',

    'terminalTab.rename': '重命名',
    'terminalTab.duplicate': '复制终端',
    'terminalTab.moveLeft': '← 左移一位',
    'terminalTab.moveRight': '右移一位 →',
    'terminalTab.color': '标签颜色',
    'terminalTab.clearColor': '清除颜色',
    'terminalTab.close': '关闭标签',
    'terminalTab.localTitle': '本地终端（双击重命名 · 右键改色）',
    'terminalTab.remoteTitle': '{name} ({ip})　双击重命名 · 右键改色',
    'terminalTab.newOutput': '有新输出',
    'terminalTab.newConnection': '新建连接 (Ctrl/⌘+Shift+N)',
    'terminalTab.exitTermMode': '退出终端模式 (Ctrl/⌘+Shift+Enter)',
    'terminalTab.enterTermMode': '终端模式：只留标签栏与终端 (Ctrl/⌘+Shift+Enter)',
  },
  'en-US': {
    'app.language': 'Language',
    'app.language.zhCN': '简体中文',
    'app.language.enUS': 'English',
    'brand.console': 'Console',
    'brand.tagline': 'Network Asset Discovery and Unified Access Platform',

    'common.cancel': 'Cancel',
    'common.clear': 'Clear',
    'common.connect': 'Connect',
    'common.default': 'Default',
    'common.loading': 'Loading',
    'common.refresh': 'Refresh',
    'common.search': 'Search',
    'common.itemsSelected': '{count} selected',

    'nav.console': 'Console',
    'nav.assets': 'Assets',
    'nav.k8s': 'K8s Clusters',
    'nav.discovery': 'Discovery',
    'nav.credentials': 'Credentials',
    'nav.users': 'Users',
    'nav.audit': 'Audit Logs',
    'nav.settings': 'Settings',
    'nav.overview': 'Overview',
    'nav.assetCenter': 'Assets',
    'nav.accessSystem': 'Access & System',
    'nav.workbench': 'Workbench',

    'app.boot.starting': 'Starting local service...',
    'app.boot.backendAddress': 'Backend',
    'app.boot.slowHelp': 'Connection issues are usually caused by a port held by a previous instance, or a sidecar that was not bundled for this platform.',
    'app.boot.skipLogin': 'Skip and open login',
    'app.boot.backendExited': 'Backend process exited',
    'app.boot.localTimeout': 'Timed out connecting to local service',
    'app.boot.defaultPasswordUnavailable': 'Default credentials are unavailable',
    'app.boot.cannotConnect': 'Unable to connect to local service',
    'app.boot.retry': '{message} (retry {current}/{total})',
    'app.boot.serviceNotReady': 'Local service is not ready: {message}',
    'app.sidebar.expand': 'Expand sidebar',
    'app.sidebar.collapse': 'Collapse sidebar',

    'header.search': 'Search assets / pages',
    'header.help': 'Keyboard shortcuts',
    'header.source': 'Source code',

    'login.mode.login': 'Sign in',
    'login.mode.register': 'Create account',
    'login.username': 'Username',
    'login.username.placeholder': 'Username',
    'login.username.required': 'Enter a username',
    'login.username.length': 'Username must be 3-32 characters',
    'login.password': 'Password',
    'login.password.placeholder': 'Password',
    'login.password.required': 'Enter a password',
    'login.password.length': 'Password must be 6-64 characters',
    'login.confirmPassword': 'Confirm password',
    'login.confirmPassword.placeholder': 'Confirm password',
    'login.confirmPassword.required': 'Enter the password again',
    'login.confirmPassword.mismatch': 'The two passwords do not match',
    'login.submit.login': 'Sign in',
    'login.submit.register': 'Register',
    'login.registerSuccess': 'Registration submitted. Please wait for administrator approval before signing in.',
    'login.registerFailed': 'Registration failed',
    'login.loginFailed': 'Invalid username or password',
    'login.loginHint': 'New accounts require administrator approval before sign-in',
    'login.registerHint': 'After registering, contact an administrator for approval',
    'login.subtitle': 'Discover assets, manage clusters, and connect in one click. Bring scattered hosts, clusters, and credentials into one console.',
    'login.highlight.connect.title': 'One-click access',
    'login.highlight.connect.desc': 'Open SSH / SFTP from the host tree and keep sessions alive',
    'login.highlight.cluster.title': 'Cluster management',
    'login.highlight.cluster.desc': 'Identify K8s nodes and consoles automatically, then organize and open them',
    'login.highlight.credential.title': 'Centralized credentials',
    'login.highlight.credential.desc': 'Keep accounts and keys in one vault with audit trails for operations',

    'password.changeSuccess': 'Password changed',
    'password.changeFailed': 'Change failed',
    'password.forceTitle': 'Change your password to continue',
    'password.forceDesc': 'Account {user} is still using the default password. Set a new password before continuing.',
    'password.new': 'New password',
    'password.new.placeholder': 'New password, 6-64 characters',
    'password.new.required': 'Enter a new password',
    'password.confirmNew': 'Confirm new password',
    'password.confirmNew.placeholder': 'Enter the new password again',
    'password.confirmNew.required': 'Enter the new password again',
    'password.submitForce': 'Set password and enter',
    'password.old': 'Current password',
    'password.old.placeholder': 'Current password',
    'password.old.required': 'Enter the current password',
    'password.confirmChange': 'Confirm',

    'user.current': 'Current user: {user}',
    'user.changePassword': 'Change password',
    'user.logout': 'Sign out',

    'globalSearch.placeholder': 'Search assets or jump to a page...',
    'globalSearch.quickJump': 'Quick links',
    'globalSearch.assets': 'Assets',
    'globalSearch.noAssets': 'No matching assets',
    'globalSearch.noMatches': 'No matches',
    'globalSearch.vulns': 'Vulnerabilities',

    'quickConnect.ungrouped': 'Ungrouped',
    'quickConnect.title': 'Quick Connect',
    'quickConnect.refreshHosts': 'Refresh hosts',
    'quickConnect.searchPlaceholder': 'Search hosts / IP / tags',
    'quickConnect.localTerminal': 'Local Terminal',
    'quickConnect.localHost': 'Local',
    'quickConnect.localTerminalN': 'Local Terminal {count}',
    'quickConnect.localTooltip': 'New local terminal ({shell}) · Right-click to change shell',
    'quickConnect.localTitle': 'New local terminal (connected to the machine running this app; multiple sessions are supported)\nCurrent shell: {shell}',
    'quickConnect.pickShell': 'Choose shell (current: {shell})',
    'quickConnect.recent': 'Recent',
    'quickConnect.noMatchedHosts': 'No matching hosts',
    'quickConnect.noHosts': 'No hosts',
    'quickConnect.hostTitle': '{name} · {ip}{tags}\nClick to connect · Right-click for more · Drag into a split pane',
    'quickConnect.menu.connect': 'Connect in new tab',
    'quickConnect.menu.split': 'Open in new split',
    'quickConnect.menu.sftp': 'File transfer (SFTP)',
    'quickConnect.menu.assets': 'View in assets',

    'newConnection.title': 'New Connection',
    'newConnection.pickKnown': 'Pick an existing host (optional)',
    'newConnection.searchKnown': 'Search managed hosts...',
    'newConnection.hostIp': 'Host IP',
    'newConnection.hostIp.required': 'Enter host IP',
    'newConnection.port': 'Port',
    'newConnection.username': 'Username',
    'newConnection.password': 'Password',
    'newConnection.password.extra': 'Used only for this session. It will not be saved. Leave empty to use credentials already bound to this asset.',
    'newConnection.password.placeholder': 'Leave empty to use bound credentials',
    'newConnection.name': 'Display name (optional)',
    'newConnection.name.placeholder': 'Use IP as name when empty',
    'newConnection.assetCreateMissingId': 'Asset was created without an ID',
    'newConnection.failed': 'Connection failed',

    'shortcut.title': 'Keyboard Shortcuts',
    'shortcut.group.window': 'Window / Tabs',
    'shortcut.group.command': 'Commands / Completion',
    'shortcut.group.edit': 'Editing / Clipboard',
    'shortcut.group.view': 'View',
    'shortcut.newSplit': 'New split pane',
    'shortcut.closePane': 'Close current split; close tab when it is the only split',
    'shortcut.switchTab': 'Switch to terminal tab N',
    'shortcut.middleClose': 'Middle-click a tab to close it',
    'shortcut.dragTab': 'Drag to reorder tabs',
    'shortcut.commandPalette': 'Command palette: fuzzy-search snippets and insert',
    'shortcut.acceptCompletion': 'Accept the gray inline completion after the cursor, prioritizing host command history',
    'shortcut.nativeCompletion': 'Use native shell completion when no gray hint is shown',
    'shortcut.showCandidates': 'Open command candidates',
    'shortcut.pickCandidate': 'Pick and accept a candidate',
    'shortcut.closeCandidates': 'Close candidates',
    'shortcut.autoCopy': 'Copy automatically',
    'shortcut.copyPaste': 'Copy / paste',
    'shortcut.contextMenu': 'Copy when text is selected, otherwise paste',
    'shortcut.zoomWheel': 'Zoom font size',
    'shortcut.zoomInOut': 'Increase / decrease font size',
    'shortcut.zoomReset': 'Reset font size',
    'shortcut.searchTerminal': 'Search in terminal',
    'shortcut.openHelp': 'Open this shortcut sheet',

    'terminalTab.rename': 'Rename',
    'terminalTab.duplicate': 'Duplicate terminal',
    'terminalTab.moveLeft': 'Move left',
    'terminalTab.moveRight': 'Move right',
    'terminalTab.color': 'Tab color',
    'terminalTab.clearColor': 'Clear color',
    'terminalTab.close': 'Close tab',
    'terminalTab.localTitle': 'Local terminal (double-click to rename · right-click to color)',
    'terminalTab.remoteTitle': '{name} ({ip})  Double-click to rename · right-click to color',
    'terminalTab.newOutput': 'New output',
    'terminalTab.newConnection': 'New connection (Ctrl/⌘+Shift+N)',
    'terminalTab.exitTermMode': 'Exit terminal mode (Ctrl/⌘+Shift+Enter)',
    'terminalTab.enterTermMode': 'Terminal mode: keep only tabs and terminal (Ctrl/⌘+Shift+Enter)',
  },
};

const antdLocales: Record<LocaleCode, AntdLocale> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const normalizeLocale = (value?: string | null): LocaleCode | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en-US';
  return null;
};

const detectLocale = (): LocaleCode => {
  try {
    const stored = normalizeLocale(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Ignore storage failures and fall through to browser detection.
  }
  const browserLocale = typeof navigator !== 'undefined' ? normalizeLocale(navigator.language) : null;
  return browserLocale || 'zh-CN';
};

const format = (template: string, values?: Record<string, React.ReactNode>) => {
  if (!values) return template;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    if (match.index > last) parts.push(template.slice(last, match.index));
    parts.push(values[match[1]] ?? match[0]);
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.length === 1 ? parts[0] : parts;
};

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: string, values?: Record<string, React.ReactNode>) => React.ReactNode;
  text: (key: string, values?: Record<string, string | number>) => string;
  antdLocale: AntdLocale;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<LocaleCode>(detectLocale);

  const setLocale = (next: LocaleCode) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can fail in private modes; the in-memory language still changes.
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const dict = resources[locale];
    const fallback = resources['zh-CN'];
    const translateText = (key: string, values?: Record<string, string | number>) => {
      const template = dict[key] ?? fallback[key] ?? key;
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (all, name: string) => String(values[name] ?? all));
    };
    return {
      locale,
      setLocale,
      t: (key, values) => format(dict[key] ?? fallback[key] ?? key, values),
      text: translateText,
      antdLocale: antdLocales[locale],
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
