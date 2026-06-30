# Lynx · 猞猁 — 前端

**网络资产发现与统一接入平台** 的 Web 前端。基于 React 18 + TypeScript + Vite，
配合后端（`backend/`，Go + Gin）提供资产发现、CMDB、WebSSH/Telnet/本地终端、SFTP、
AI 命令助手、K8s 管理、可用性监控与多租户管理等完整界面。既是浏览器 SPA，
也作为 [Tauri v2](https://tauri.app) 桌面客户端的前端（见下文「桌面端」）。

> 本目录是 Lynx 仓库的子模块，独立的整体说明请见仓库根 [`../README.md`](../README.md)。

## 技术栈

- **React 18** + **TypeScript**
- **Vite 8** —— 开发服务器与打包工具
- **Ant Design 5**（`antd` + `@ant-design/icons`）—— UI 组件库
- **react-router-dom v7** —— 路由
- **axios** —— HTTP 客户端（统一封装在 `src/services/api.ts`）
- **@xterm/xterm v6**（+ `addon-fit`、`addon-search`）—— WebSSH / Telnet / 本地终端
- **@tauri-apps/api** + `plugin-shell` / `plugin-clipboard-manager` —— 桌面端原生能力
- **ESLint**（typescript-eslint + react-hooks / react-refresh 插件）

## 目录结构

```
frontend/
├── index.html                  # SPA 入口
├── vite.config.ts              # Vite 配置（dev server :5173，/api 代理到后端 :8080）
├── eslint.config.js
├── tsconfig*.json
├── Dockerfile                  # 构建 dist 并由 nginx 托管 + 反代 /api
├── public/                     # 静态资源（favicon.svg 等）
├── src/
│   ├── main.tsx                # 渲染入口
│   ├── App.tsx                 # 应用骨架、路由、布局
│   ├── theme.ts                # 品牌设计令牌（brand / palette / antd 主题）
│   ├── services/api.ts         # axios 实例、token 注入、接口封装
│   ├── terminalSessions.tsx    # 终端多标签 / 分屏会话状态管理
│   ├── commandSnippets.ts      # 命令库 / 片段
│   ├── clipboard.ts            # 剪贴板适配（浏览器 / Tauri）
│   ├── pages/                  # 路由页面
│   │   ├── Login.tsx / ForcePasswordChange.tsx
│   │   ├── Dashboard.tsx       # 控制台 / 态势
│   │   ├── Assets.tsx          # CMDB 资产清单
│   │   ├── ScanTasks.tsx       # 自动发现扫描任务
│   │   ├── Vulns.tsx           # 漏洞发现
│   │   ├── Credentials.tsx     # 凭据保管箱
│   │   ├── K8sClusters.tsx     # Kubernetes 集群管理
│   │   ├── TerminalPage.tsx    # WebSSH / Telnet / 本地终端
│   │   ├── Users.tsx / Audit.tsx / Settings.tsx
│   └── components/             # 复用组件
│       ├── TerminalTabBar.tsx / TerminalAIPanel.tsx
│       ├── CommandPalette.tsx / SnippetManager.tsx / ShortcutHelp.tsx
│       ├── SftpDrawer.tsx / QuickConnect.tsx / GlobalSearch.tsx
│       └── Logo.tsx / PageHeader.tsx / UserMenu.tsx
└── src-tauri/                  # Tauri v2 桌面端工程（Rust）
    ├── tauri.conf.json         # productName=Lynx，identifier=cn.meridian.desktop
    ├── Cargo.toml / build.rs / src/
    ├── binaries/               # Go 后端 sidecar（meridian-backend）
    ├── capabilities/ / icons/
```

## 开发

前端依赖后端 API。先在 `../backend` 启动后端（默认监听 `127.0.0.1:8080`），再启动前端：

```bash
npm install        # 安装依赖（首次）
npm run dev        # 启动 Vite 开发服务器，访问 http://localhost:5173
```

开发服务器在 `5173` 端口，并把 `/api`（含 WebSocket）代理到 `http://127.0.0.1:8080`（见 `vite.config.ts`）。
默认登录账号 **admin / admin**（首次登录会强制改密）。

## 构建

```bash
npm run build      # tsc -b 类型检查 + vite build，产物输出到 dist/
npm run preview    # 本地预览构建产物
npm run lint       # ESLint 检查
```

也可在仓库根用 `make frontend` 仅构建 `dist`。生产部署通常用本目录的 `Dockerfile`
（多阶段：构建 `dist` → nginx 托管静态资源并反代 `/api` 到后端），详见根 [`../DEPLOY.md`](../DEPLOY.md)。

## 桌面端（Tauri）

同一套前端可打包为桌面客户端：Tauri v2（Rust）将 Go 后端编译为 sidecar（`meridian-backend`）
随包分发，由 Tauri 在 `127.0.0.1:8765` 启动，前端**自动以默认管理员凭据登录**，无需手动起后端。

```bash
npm run desktop:dev      # 桌面开发模式（= tauri dev，热重载 + 起 sidecar）
npm run desktop:build    # 打桌面安装包（= tauri build）
```

推荐用仓库根 Makefile 一键构建：`make desktop`（macOS .app + .dmg）、`make desktop-universal`（通用包）；
Windows 用 `scripts/build-desktop.ps1`。完整说明见根 [`../docs/desktop.md`](../docs/desktop.md)。

## 与后端 / 桌面端的关系

- **浏览器模式**：前端 SPA 经 axios 调用后端 `/api`，终端 / SFTP / 扫描日志走 WebSocket 与 SSE；
  鉴权用会话 token（HTTP 走 `Authorization: Bearer`，WebSocket/SSE/下载走 `?token=`）。
- **桌面模式**：前端通过 `@tauri-apps/api` 使用系统剪贴板、外链走系统浏览器（`shell.open`）；
  后端以 sidecar 形态内嵌，前端自动登录，体验为单机应用。

---

品牌与设计令牌集中在 [`src/theme.ts`](src/theme.ts)（当前版本 **v0.64**）；
注意底层技术标识（`cn.meridian.desktop`、`meridian-backend` 等）沿用历史命名，不属于品牌名，请勿改动。
