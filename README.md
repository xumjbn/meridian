<div align="center">

<img src="frontend/public/favicon.svg" width="76" alt="wjw logo" />

# wjw

**网络资产发现与统一接入平台**
*Network Asset Discovery & Unified Access Platform*

发现（雷达扫描） → 测绘（CMDB 入库） → 接入（一键终端）
Discover → Map → Access, in one self-contained app.

**[中文](#中文) · [English](#english)**

</div>

---

<a name="中文"></a>

## 中文

### 简介

**wjw** 是一个自包含、全栈、轻量的内网资产管理与统一接入平台。一条命令即可对网段做并发发现扫描，
把存活主机自动测绘入 CMDB，集中托管登录凭据，并**直接在浏览器/桌面端内打开一个功能完整的终端**接入设备——
无需在 CMDB、跳板机、SSH 客户端、SFTP 工具之间来回切换。

它把「资产发现 → 资产管理 → 凭据保管 → 远程接入 → 文件传输 → 运维执行」收敛到同一界面，
既是一份可查询的 CMDB，也是一台随时可用的 Web 跳板机。

### 核心能力

| 模块 | 说明 |
|------|------|
| 💻 **终端 / Shell**（核心） | 浏览器内的**完整多标签终端**：SSH / Telnet / **本地终端**三合一，分屏、命令同步广播、命令补全、屏幕搜索、配色主题、重连回放、凭据自动绑定——详见下方 [终端 / Shell 详解](#终端--shell详解) |
| 🛰️ 自动发现 | CIDR / IP 范围并发扫描，端口探测与设备类型指纹识别，**SSE 实时进度**、**定时调度**（`@every` / 每日定时） |
| 🗂️ CMDB 资产清单 | 资产 CRUD、标签、端口可视化、在线探测、详情抽屉、**分组 / 批量操作 / CSV 导入导出 / 变更历史 / 归属分配** |
| 🧬 认证采集 | 绑定 SSH 凭据后一键采集 **CPU 架构** 与 **虚拟化（VM / 云 / 容器）**，列表标签展示 |
| 🟢 可用性监控 | 后台定时探测 + **在线率历史（uptime）**，离线/恢复自动告警 |
| 🐞 漏洞发现 | 可插拔扫描引擎，接入 **nuclei** 漏扫（缺二进制优雅降级） |
| 🔐 凭据保管箱 | 集中托管 SSH 密码 / 密钥 / Telnet 账号（**支持非标端口**），**连通性测试** |
| 📁 SFTP 文件管理 | 浏览 / 上传（拖拽）/ 下载 / 新建 / 删除 / 重命名目录，**全程审计** |
| 🤖 AI 命令助手 / Agent | 自然语言 → shell（OpenAI 兼容）：①生成单条命令人工确认；②**Agent 自动执行**——一句话自动完成运维任务（自动跑命令、读输出、推进，多轮上下文记忆，命中高危命令暂停确认，全程审计）；终端右下角**悬浮可展开面板**，可调宽 + **历史对话切换**，会话**持久化**（重启不丢） |
| 📣 告警通知 | 扫描完成 / 资产离线推送到 **企业微信 / 钉钉 / 通用 Webhook** |
| 📊 控制台 | 资产态势、存活率、类型分布、最近活动时间线、实时轮询（按归属隔离） |
| 👥 多用户 / 多租户 | 会话鉴权（bcrypt）、**注册审批制**、管理员 / 普通用户 RBAC、**按归属数据隔离**、登录失败锁定 + 首次登录强制改密 |
| 🧾 审计 / 搜索 | 全量写操作审计日志（管理员可查）、全局搜索（Ctrl/Cmd + K） |
| 🖥️ 桌面客户端 | 基于 **Tauri v2**（Rust）打包，将 Go 后端作为 sidecar 一同分发，开箱即用；支持系统剪贴板、外链走系统浏览器，桌面端**自动登录免输入凭据** |
| ☸️ Kubernetes 管理 | 集群登记、节点归类（手动 / 自动）、集群 VIP 识别、实时看板（节点 / Pod，需 API Token）、Web 控制台入口 |

<a name="终端--shell详解"></a>

### 终端 / Shell 详解

终端是 wjw 的核心。它不是「聊胜于无」的 WebSSH，而是一套可以当主力用的终端工作台——
基于 `@xterm/xterm` v6 + WebSocket 双向流，后端直连 `golang.org/x/crypto/ssh` / Telnet / 本机 PTY。

**三种接入方式，同一套体验**

- **SSH** — 密码 / 私钥、非标端口、协议级 keepalive（锁屏 / 挂起后不掉线）
- **Telnet** — 老旧网络设备（交换机 / 路由器 / 防火墙）友好
- **本地终端** — 直接开一个本机 shell（Windows / macOS / Linux 原生 PTY），无需先连远端

**多标签 · 分屏**

- 应用内**多标签**，可拖拽排序、重命名 + 配色、复制终端、中键关闭
- **分屏**：单 / 双 / 四分屏，每个窗格独立会话、独立关闭，可拖拽调整行列比例、单窗格最大化
- **快捷连接侧栏**：左侧常用主机一键开标签，新增主机 / 新标签**实时刷新**

**高效输入**

- **命令自动补全** — 幽灵提示 + 候选列表，内置 200+ 运维命令 + 历史命令
- **命令同步广播** — 一次输入，广播到所有已同步的终端（批量运维利器）
- **屏幕搜索** — `Ctrl+F` 在回滚缓冲里检索、高亮、上下跳转
- **字号缩放** — `Ctrl+滚轮` / `Ctrl + =/-` / `Ctrl+0` 复位
- **剪贴板** — `Ctrl+Shift+C/V`，URL 自动识别可点击

**观感与稳定**

- **7 套可切换配色主题**，GPU（WebGL）渲染，DOM 优雅降级
- **重连历史回放** — 断线自动重连（指数退避），重连后回放最近输出，接得上上下文
- **凭据自动绑定** — 连未绑凭据的资产时，按归属逐个尝试已存 SSH 凭据，成功即自动绑定并审计
- 全屏 / 终端模式、滚动回看、UTF-8 / GBK 编码、断线提示

配套 **SFTP**（拖拽上传 / 下载 / 目录管理，全程审计）与 **AI 命令助手 / Agent**（自然语言直接跑命令），
让「登录 → 操作 → 传文件 → 自动化」在一个终端里闭环。

### 技术栈

- **后端** — Go 1.22 · Gin · GORM · **glebarez/sqlite（纯 Go，免 cgo）** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · `bcrypt` 口令 + 内存会话令牌 · 自包含调度器 / 可用性监控 · nuclei（可选外部二进制）
- **前端** — React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6（+ fit / search addon）· Vite 8 · react-router-dom v7 · axios
- **桌面端** — Tauri v2（Rust）+ Go sidecar（`wjw-backend`），插件：shell / clipboard-manager

### 安全模型

- **鉴权**：`POST /api/login` 校验 bcrypt 口令后签发会话令牌（`Authorization: Bearer <token>`，WebSocket/SSE 走 `?token=`），受保护路由由服务端中间件校验；管理员路由额外校验角色。
- **多租户**：资产 / 凭据 / 终端 / SFTP / 活动按 `owner_id` 隔离，普通用户仅见与操作自己的数据。
- **审批与口令**：开放注册但默认 `pending`，需管理员审批；登录失败 5 次锁定 10 分钟；默认 `admin/admin` **首次登录强制改密**。
- **凭据自动绑定**：终端连接未绑定凭据的资产时（开关默认开），按归属逐个尝试已保存的 SSH 凭据，成功即自动绑定到该资产并审计（`AUTO_BIND_CRED`），全失败回退手动输入。
- **有意延后的取舍**（本地工具定位，非缺陷，详见 [architecture.md](docs/architecture.md) 安全章节）：凭据**明文**存储、SSH **未校验主机密钥**（`InsecureIgnoreHostKey`）。生产前应引入 AES-at-rest 与 known_hosts 校验。

### 快速开始

```bash
# 后端（默认监听 127.0.0.1:8080，纯 Go SQLite 免 cgo）
cd backend
GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go run ./cmd/server

# 前端（开发模式，Vite 代理 /api 至后端）
cd frontend
npm install
npm run dev
```

> 默认登录账号 **admin / admin**（角色：管理员）；**首次登录会强制修改密码**。其余用户走注册 → 管理员审批。

构建验证：

```bash
cd backend  && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server
cd frontend && npm run build
```

### Docker 部署（国内镜像）

一条命令起一套（Go 后端 + nginx 托管前端并反代 `/api`，含终端 WebSocket）：

```bash
docker compose up -d --build
# 访问 http://<宿主机IP>:8088   默认 admin / admin
```

基础镜像 / Go 模块 / npm 依赖 / Alpine 源**全部走国内镜像**，详见 [DEPLOY.md](DEPLOY.md)。

### 桌面客户端（Tauri）

桌面端用 [Tauri v2](https://tauri.app) 打包，把 Go 后端编译为 **sidecar**（`wjw-backend`）随包分发，
由 Tauri 在本机 `127.0.0.1:8765` 启动，前端**自动以默认管理员凭据登录**，开箱即用、无需手动起后端。

```bash
# macOS（出 .app + 可安装 .dmg；通过 Makefile 一键）
make deps          # 装前端依赖（含 Tauri CLI / API），首次一次即可
make desktop       # 当前架构 .app + .dmg
make desktop-dev   # 桌面开发模式（热重载前端 + 自动起 sidecar）

# Windows（PowerShell 一键）
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

更多构建目标见 [Makefile](Makefile) 与 [docs/desktop.md](docs/desktop.md)。

### 文档

- [架构设计](docs/architecture.md)
- [接口规范](docs/api_spec.md)
- [产品设计与实施计划](docs/design_plan.md)
- [桌面端说明](docs/desktop.md)

### 许可

见 [LICENSE](LICENSE)。

---

<a name="english"></a>

## English

### Overview

**wjw** is a self-contained, full-stack, lightweight platform for internal network asset management and unified access.
A single command runs a concurrent discovery scan across a subnet, auto-maps live hosts into a CMDB, centrally vaults
login credentials, and lets you **open a full-featured terminal — right inside the browser or desktop app** — to reach
any device. No more bouncing between a CMDB, a jump host, an SSH client and an SFTP tool.

It collapses *discover → inventory → vault → remote access → file transfer → ops automation* into one screen: at once a
queryable CMDB and an always-ready web jump box.

### Core Capabilities

| Module | What it does |
|--------|--------------|
| 💻 **Terminal / Shell** (core) | A **full multi-tab terminal in the browser**: SSH / Telnet / **local shell** in one, with split panes, command broadcast, completion, on-screen search, color themes, reconnect replay and auto credential binding — see [Terminal / Shell in depth](#terminal--shell-in-depth) below |
| 🛰️ Auto-discovery | Concurrent CIDR / IP-range scanning, port probing and device-type fingerprinting, **live SSE progress**, **scheduled scans** (`@every` / daily) |
| 🗂️ CMDB inventory | Asset CRUD, tags, port visualization, liveness probe, detail drawer, **grouping / bulk ops / CSV import-export / change history / ownership assignment** |
| 🧬 Fact collection | Bind an SSH credential to collect **CPU architecture** and **virtualization (VM / cloud / container)** in one click, shown as list tags |
| 🟢 Availability monitor | Background periodic probing + **uptime history**, auto alerts on down / recovery |
| 🐞 Vulnerability scan | Pluggable engines, **nuclei** integration (graceful degradation when the binary is absent) |
| 🔐 Credential vault | Centrally hold SSH passwords / keys / Telnet accounts (**non-standard ports supported**), with **connectivity test** |
| 📁 SFTP file manager | Browse / upload (drag-drop) / download / mkdir / delete / rename, **fully audited** |
| 🤖 AI command assistant / Agent | Natural language → shell (OpenAI-compatible): (1) generate a single command for confirmation; (2) **autonomous Agent** — describe a task and it runs commands, reads output and iterates, with multi-turn memory, pause-on-dangerous-command confirmation and full audit; a **dockable, resizable panel** with **conversation history** and **persistence** across restarts |
| 📣 Notifications | Push scan-complete / asset-offline events to **WeCom / DingTalk / generic Webhook** |
| 📊 Dashboard | Asset posture, live rate, type distribution, recent-activity timeline, real-time polling (ownership-scoped) |
| 👥 Multi-user / multi-tenant | Session auth (bcrypt), **registration approval**, admin / user RBAC, **per-owner data isolation**, login-failure lockout + forced first-login password change |
| 🧾 Audit / search | Full write-operation audit log (admin-visible), global search (Ctrl/Cmd + K) |
| 🖥️ Desktop client | Packaged with **Tauri v2** (Rust), shipping the Go backend as a sidecar for a zero-config launch; system clipboard, external links open in the system browser, and **automatic login** with no credential entry |
| ☸️ Kubernetes | Cluster registration, node classification (manual / auto), cluster-VIP detection, live board (nodes / pods, API token required), web-console entry |

<a name="terminal--shell-in-depth"></a>

### Terminal / Shell in depth

The terminal is the heart of wjw. It isn't a bare-minimum WebSSH — it's a terminal workbench you can use as your daily
driver, built on `@xterm/xterm` v6 + a bidirectional WebSocket stream, backed by `golang.org/x/crypto/ssh` / Telnet /
a native local PTY.

**Three transports, one experience**

- **SSH** — password / private key, non-standard ports, protocol-level keepalive (survives screen-lock / suspend)
- **Telnet** — friendly to legacy gear (switches / routers / firewalls)
- **Local terminal** — spawn a native local shell (Windows / macOS / Linux PTY) without connecting anywhere first

**Multi-tab · split panes**

- In-app **tabs** with drag-reorder, rename + color, duplicate, middle-click close
- **Split panes**: single / dual / quad, each an independent session with its own close, drag-resizable rows/cols, single-pane maximize
- **Quick-connect sidebar**: one-click open a tab for a frequent host; newly added hosts / tabs refresh **live**

**Efficient input**

- **Command completion** — ghost-text hint + candidate list, 200+ built-in ops commands plus history
- **Command broadcast** — type once, broadcast to every synced terminal (great for fleet ops)
- **On-screen search** — `Ctrl+F` to find, highlight and jump within the scrollback
- **Font zoom** — `Ctrl+wheel` / `Ctrl + =/-` / `Ctrl+0` to reset
- **Clipboard** — `Ctrl+Shift+C/V`, URLs auto-detected and clickable

**Look & resilience**

- **7 switchable color themes**, GPU (WebGL) rendering with graceful DOM fallback
- **Reconnect history replay** — auto-reconnect (exponential backoff) and replay of recent output so you pick up context
- **Auto credential binding** — for an unbound asset, tries saved SSH creds by ownership and binds on success, audited
- Fullscreen / terminal mode, scrollback, UTF-8 / GBK encoding, disconnect notices

Paired with **SFTP** (drag-drop upload / download / directory management, fully audited) and the **AI command
assistant / Agent** (run commands straight from natural language), so *log in → operate → transfer files → automate*
all close the loop inside one terminal.

### Tech stack

- **Backend** — Go 1.22 · Gin · GORM · **glebarez/sqlite (pure Go, cgo-free)** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · `bcrypt` passwords + in-memory session tokens · self-contained scheduler / availability monitor · nuclei (optional external binary)
- **Frontend** — React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6 (+ fit / search addon) · Vite 8 · react-router-dom v7 · axios
- **Desktop** — Tauri v2 (Rust) + Go sidecar (`wjw-backend`), plugins: shell / clipboard-manager

### Security model

- **Auth**: `POST /api/login` verifies the bcrypt password and issues a session token (`Authorization: Bearer <token>`; WebSocket/SSE use `?token=`). Protected routes are checked by server middleware; admin routes additionally check role.
- **Multi-tenancy**: assets / credentials / terminals / SFTP / activity are isolated by `owner_id`; a regular user only sees and operates their own data.
- **Approval & passwords**: open registration but `pending` by default (admin approval required); 5 failed logins → 10-minute lockout; default `admin/admin` with a **forced password change on first login**.
- **Auto credential binding**: when connecting to an asset with no bound credential (on by default), saved SSH credentials are tried by ownership; on success the credential is auto-bound to the asset and audited (`AUTO_BIND_CRED`); if all fail it falls back to manual entry.
- **Deliberately deferred trade-offs** (local-tool positioning, not defects — see the security chapter in [architecture.md](docs/architecture.md)): credentials stored **in plaintext**, SSH host keys **not verified** (`InsecureIgnoreHostKey`). Introduce AES-at-rest and known_hosts verification before production.

### Quick start

```bash
# Backend (listens on 127.0.0.1:8080 by default; pure-Go SQLite, cgo-free)
cd backend
GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go run ./cmd/server

# Frontend (dev mode; Vite proxies /api to the backend)
cd frontend
npm install
npm run dev
```

> Default login **admin / admin** (role: admin); a **password change is forced on first login**. Other users register → admin approval.

Build check:

```bash
cd backend  && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server
cd frontend && npm run build
```

### Docker deployment

One command brings up the whole stack (Go backend + nginx serving the frontend and reverse-proxying `/api`, including the terminal WebSocket):

```bash
docker compose up -d --build
# Open http://<host-ip>:8088   default admin / admin
```

Base images / Go modules / npm deps / Alpine repos all use China mirrors; see [DEPLOY.md](DEPLOY.md).

### Desktop client (Tauri)

The desktop app is packaged with [Tauri v2](https://tauri.app), shipping the Go backend as a **sidecar** (`wjw-backend`).
Tauri launches it on `127.0.0.1:8765` and the frontend **logs in automatically** with the default admin credentials — zero config, no separate backend to start.

```bash
# macOS (.app + installable .dmg via the Makefile)
make deps          # install frontend deps (incl. Tauri CLI / API), once
make desktop       # .app + .dmg for the current arch
make desktop-dev   # desktop dev mode (frontend hot-reload + auto sidecar)

# Windows (one-shot PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

See [Makefile](Makefile) and [docs/desktop.md](docs/desktop.md) for more build targets.

### Docs

- [Architecture](docs/architecture.md)
- [API spec](docs/api_spec.md)
- [Product design & implementation plan](docs/design_plan.md)
- [Desktop notes](docs/desktop.md)

### License

See [LICENSE](LICENSE).

---

<div align="center">

**wjw** · v1.0.17 · 网络资产发现与统一接入平台 / Network Asset Discovery & Unified Access Platform

</div>
