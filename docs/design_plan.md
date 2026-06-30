# Lynx — 产品设计与实施说明

> **产品名称**: Lynx · 猞猁
> **定位**: 网络资产发现与统一接入平台（Network Asset Discovery & Unified Access Platform）
> **文档版本**: v6.0 · 对应应用版本 **v0.64**
> **更新时间**: 2026-06-30
> **状态**: Phase 1–6 已落地；K8s 集群管理（含实时看板）已落地

> **文档定位**：本文是**设计说明**——记录产品形态、技术选型与已落地能力的全貌，并标注仍在规划/未实现的部分。
> 凡描述为现在时的内容均为已实现现状；规划项一律以「规划中/未实现」明确标注。
> 接口与字段以仓库源码为准（`backend/internal/handler/*`、`backend/internal/model/models.go`、`backend/cmd/server/main.go`），不臆造。

---

## 〇、版本演进概览

| 版本 | 主题 | 状态 |
|------|------|------|
| v2.0 | AssetManager 基础：CMDB / 凭据 / 发现扫描 / WebSSH | ✅ |
| v3.0 | 品牌重塑（Lynx · 猞猁）· 界面重构 · 设计令牌 | ✅ |
| v4.0 | 登录门禁、漏洞扫描、定时调度、认证采集、健壮性加固 | ✅ |
| v5.0 | 多用户/多租户、SFTP、可用性监控、告警、AI 命令助手、终端多屏/补全 | ✅ |
| v5.1 | AI Agent 自动执行 + 会话持久化、终端搜索/配色/重连历史、凭据自动绑定 | ✅ |
| **v6.0** | **Kubernetes 集群管理（节点归类 / 一键控制台 / 实时看板）+ 命令同步发送** | ✅ |

### 应用迭代（app 版本号，节选）

| app 版本 | 内容 |
|----------|------|
| v0.21 | 多租户数据隔离 + 注册审批制 |
| v0.22 / v0.24 | SFTP 上传/下载 → 目录新建/删除/重命名 + 拖拽上传 |
| v0.23 | 管理员分配资产归属；移除登录页默认密码提示 |
| v0.25 | 自动发现按类型前缀命名（server-/router-/switch-） |
| v0.26 | SSH 非标端口（终端/SFTP/采集） |
| v0.27 | 收尾修复多租户隔离/权限校验 |
| v0.28 | AI 命令助手（自然语言转 shell，确认后执行） |
| v0.29 | 终端命令**同步发送**（多屏广播） |
| v0.30 | 命令**自动补全**（内置运维命令）+ 分屏**独立关闭/自由拖拽缩放** |
| v0.31 | **AI Agent**：一句话自动完成任务（独立 SSH 通道自动执行 + 高危拦截 + 多轮上下文） |
| v0.32–v0.33 | 悬浮 AI 面板 + 历史对话 + 会话持久化；终端 Ctrl+F 搜索 / 配色主题 / 重连历史；凭据自动绑定 |
| v0.5x–v0.6x | **Kubernetes 集群管理**：节点探测/打标、集群归类（手动+自动）、一键控制台、实时看板（overview/nodes/pods） |
| **v0.64** | 当前版本：K8s 实时看板 + 命令同步发送完善，桌面端（Tauri v2）出包 |

> 上表为里程碑节选；中间小版本以仓库 git 历史为准。

### 命名与品牌

**Lynx（猞猁）** 是敏锐的猎手，呼应「为网络资产侦测、定位、接入」的核心价值，对应三段式工作流：
**发现（扫描探测）→ 测绘（CMDB 入库）→ 接入（一键 SSH/Telnet/SFTP/控制台）**。

- **Logo**：中心实心节点 + 外层轨道环 + 卫星节点，落地于 `frontend/public/favicon.svg` + `frontend/src/components/Logo.tsx`。
- **启动横幅**：后端启动日志打印「Lynx · 猞猁 — 网络资产发现与统一接入平台」。
- **保留的技术标识**（底层标识符，非品牌名，改动会破坏数据/兼容，**保持不变**）：
  - Tauri identifier `cn.meridian.desktop`、sidecar 二进制 `meridian-backend`、服务端二进制 `meridian-server`；
  - 默认库名 `meridian.db`、环境变量 `MERIDIAN_DB` / `MERIDIAN_LOCAL_SHELL`；
  - 仓库地址 `git@github.com:xumjbn/meridian.git`（仓库名仍为 meridian）。

---

## 一、设计系统（Design System）

集中维护于 `frontend/src/theme.ts`，所有页面统一引用，杜绝散落 hex。

### 1.1 品牌色板（节选）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `primary` | `#6366f1` | 主操作、链接、选中态 |
| `accent` | `#06b6d4` | 发现/探测语义、进度渐变端 |
| `brandGradient` | `135deg #6366f1→#7c5cfb→#22d3ee` | Logo、图标徽章、强调元素 |
| `bg` / `surface` / `border` | `#f5f6fb` / `#ffffff` / `#eef1f6` | 背景 / 卡片面 / 描边 |
| `siderBg` | `#0b1020` | 深空蓝侧边栏 |
| `success/warning/danger` | `#10b981/#f59e0b/#ef4444` | 语义状态 |

> 表面/文本/边框令牌以 CSS 变量（`var(--mrd-*)`）实现，为主题切换预留；Antd algorithm token 使用字面 hex。CSS 变量前缀 `--mrd-` 沿用历史命名，不影响品牌呈现。

### 1.2 复用组件（节选）

| 组件 | 文件 | 职责 |
|------|------|------|
| `LogoMark` / `Logo` | `components/Logo.tsx` | 品牌标识 |
| `PageHeader` | `components/PageHeader.tsx` | 统一页面头部 + 右上角用户菜单 |
| `UserMenu` | `components/UserMenu.tsx` | 当前用户 + 退出登录 |
| `GlobalSearch` | `components/GlobalSearch.tsx` | 全局搜索（Ctrl/Cmd + K） |
| `TerminalTabBar` + `terminalSessions` | `components/TerminalTabBar.tsx` · `terminalSessions.tsx` | 应用内终端标签页（多会话保活 + 同步广播控制） |
| `SftpDrawer` | `components/SftpDrawer.tsx` | SFTP 文件管理抽屉 |
| `SnippetManager` + `commandSnippets` | `components/SnippetManager.tsx` · `commandSnippets.ts` | 命令补全片段库管理 + 内置命令 |
| `TerminalAIPanel` | `components/TerminalAIPanel.tsx` | 悬浮可展开 AI 助手面板（调宽 + 历史对话切换） |
| `cardStyle` | `theme.ts` | 统一卡片样式 |

---

## 二、现状（已实现能力）

### 已实现功能

| 模块 | 已有能力 | 后续可补强（规划中/未实现） |
|------|----------|-----------|
| 资产管理 (CMDB) | CRUD、搜索/过滤、标签、端口 Tag、关联凭据、详情抽屉、在线探测、连接终端、分组、批量探测/删除、CSV 导入、字段级变更历史、认证采集（架构/虚拟化）、管理员分配归属、SFTP 文件管理 | 自定义字段、资产合并去重细化 |
| Kubernetes 集群 | K8s 节点扫描探测/打标/定角色、集群手动建/编辑/删除、**手动归类 + 自动归类（读 /etc/hosts）**、一键控制台（复制密码/占位符免登）、**实时看板（overview/节点/Pod，需 API Token）** | Deployment/Service 视图、namespace 过滤、在线 kubectl/exec、控制台类型反代免登 |
| 可用性监控 | 后台定时探测 + 在线率历史（uptime）+ 离线/恢复告警 | 趋势图、SLA 报表 |
| 凭据管理 Vault | SSH 密码/密钥/Telnet CRUD、连通性测试、非标端口 | 加密存储（明文 → AES，**规划中**） |
| 自动发现 | CIDR/范围扫描、端口指纹、停止、历史日志、SSE 实时进度、定时调度、增量入库与离线清扫、按类型前缀命名、**可选 K8s 探测、排除已知集群 VIP** | 发现后合并去重的更细策略 |
| 漏洞发现 | 可插拔引擎（discovery/vuln）、nuclei 接入（优雅降级）、漏洞列表页 | 详情/模板管理、联动看板 |
| WebSSH / Telnet / 本地终端 | xterm.js + WebSocket + SSH/Telnet 代理 + 凭据交互 + 自动重连、**本机 Shell 本地终端**、应用内多标签、全屏、滚动回看、多屏分屏（独立关闭 + 自由拖拽缩放）、命令同步广播、命令自动补全、屏幕搜索(Ctrl+F)、配色主题、重连历史回放、凭据自动绑定、SFTP 拖拽上传、可点击链接、字号缩放、导出日志 | 会话录制 |
| AI 命令助手 / Agent | 生成单条命令人工确认（高危正则标记）；Agent 自动执行（独立 SSH 通道、读输出推进、高危拦截）、多轮上下文、悬浮可展开面板 + 历史对话切换、会话持久化 | 逐步流式(SSE) |
| 告警通知 | 企业微信 / 钉钉 / 通用 Webhook；扫描完成 / 资产离线触发；可测试 | 更多渠道、模板自定义 |
| 控制台 | 统计卡、存活率环图、类型分布、活动时间线、轮询（按归属隔离） | 趋势图 |
| 系统设置 | 扫描并发/超时、SSH 超时、监控开关/间隔、告警、AI 配置 真实读写 | 更多可配置项 |
| 多用户 / 多租户 | 会话鉴权（bcrypt + 令牌中间件）、注册审批、RBAC（admin/user）、按归属数据隔离、登录锁定、首登强制改密、操作审计 | 外置会话存储、更细 RBAC |
| 桌面端 | Tauri v2 + Go sidecar；免登录（自动用默认管理员凭据登录）；系统剪贴板、外链走系统浏览器；本地终端默认开启 | —— |

### 技术栈（与源码一致）

| 层 | 技术 |
|----|------|
| 后端 | **Go 1.22** · **Gin 1.10** · **GORM 1.25** · **glebarez/sqlite（纯 Go SQLite，免 CGO）** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · 本地 PTY（creack/pty for Unix/macOS、conpty for Windows ConPTY）· bcrypt + 内存会话令牌 |
| 前端 | React **18** · TypeScript · **Ant Design 5** · `@xterm/xterm` v6（+ fit / search addon）· **Vite 8** · react-router-dom 7 · axios |
| 桌面端 | **Tauri v2**（Rust）+ Go sidecar（外部二进制 `meridian-backend`）；Tauri 插件 shell / clipboard-manager |
| 扫描/调度/监控 | 自研并发 Worker Pool（有界端口探测池）· 自包含调度器（`@every 1h` / `daily:HH:MM`，无 cron 依赖）· 后台可用性监控 · nuclei（可选外部二进制）· 告警通知器 |

### 运行参数（与源码一致）

| 项 | 值 |
|----|-----|
| 后端监听 | 默认 `127.0.0.1:8080`；`LISTEN_ADDR` 可覆盖（容器内设 `0.0.0.0:8080` 供 nginx 反代） |
| 桌面 sidecar | Tauri 启动，监听 `127.0.0.1:8765`，注入 `MERIDIAN_DB`（用户数据目录）/ `MERIDIAN_LOCAL_SHELL=1` / `TZ` |
| 前端 dev server | `http://localhost:5173` |
| 数据库路径 | `MERIDIAN_DB` 指定，默认 `meridian.db`（见 `backend/internal/store/db.go`） |
| 本地终端开关 | `MERIDIAN_LOCAL_SHELL=1`（桌面 sidecar 默认开；普通服务端默认关，见 `GetCapabilities`） |

---

## 三、数据模型（共 14 表）

| 模型 | 表 | 关键字段 | 状态 |
|------|----|----------|------|
| User | users | id, username, password(bcrypt), role, status, must_change_password, last_login_at, last_login_ip | ✅ |
| AuditLog | audit_logs | id, actor, action, path, status, ip, created_at | ✅ |
| AssetCheck | asset_checks | id, asset_id, status, checked_at | ✅ |
| Asset | assets | id, **owner_id**, name, ip, type, status, **ssh_port**, vendor, os_version, arch, virtualization, ports, tags, description, credential_id, **k8s_role**, **k8s_cluster_id**, last_scanned_at | ✅ |
| Credential | credentials | id, **owner_id**, name, type, username, password, private_key | ✅ |
| ScanTask | scan_tasks | id, name, target_range, ports, kind, **detect_k8s**, schedule, status, last_run_at | ✅ |
| ScanLog | scan_logs | id, task_id, status, started_at, finished_at, summary, detail | ✅ |
| ActivityLog | activity_logs | id, type, message, ref_id, created_at | ✅ |
| SystemSetting | system_settings | key, value, updated_at | ✅ |
| VulnFinding | vuln_findings | id, asset_id, target, template_id, name, severity, matched_at, engine | ✅ |
| AssetHistory | asset_histories | id, asset_id, field, old_value, new_value, created_at | ✅ |
| Tag | tags | id, name, color | ✅ |
| AgentSession | agent_sessions | id, requester_id, asset_id, asset_name, title, os_hint, work_dir, messages(JSON), steps(JSON), status, pending, summary | ✅ |
| K8sCluster | k8s_clusters | id, **owner_id**, name, vip, console_port, console_path, api_server, **api_token(json:"-")**, credential_id, description；展示字段 node_count/master_count/cred_name/online/has_token | ✅ |

> `owner_id` 驱动多租户隔离；`ssh_port` 支持非标端口；`arch`/`virtualization` 由认证采集写入；`k8s_role`/`k8s_cluster_id` 由 K8s 探测与归类驱动；`agent_sessions` 写穿持久化（AI Agent 重启不丢 + 历史对话）；`K8sCluster.api_token` 仅服务端调 kube-apiserver 用，`json:"-"` 不回传前端（前端仅见 `has_token` 布尔）。

---

## 四、接口清单（前缀 /api；除 login/register 外均需登录；🔒=仅管理员）

> 统一响应 `{ code, message, data }`；HTTP 用 `Authorization: Bearer <token>`，WS/SSE/SFTP 下载用 `?token=<token>`（无法设请求头）。

### 认证与用户
| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/login` · `/register` · `/logout` | 登录 / 注册（审批制）/ 注销 |
| POST | `/users/change-password` | 改本人密码 |
| 🔒 GET/POST/PUT/DELETE | `/users` · `/users/:id` | 用户管理 |
| 🔒 GET | `/audit` | 操作审计 |

### 资产 / 凭据 / 标签
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/dashboard/stats` · `/activity/recent` · `/capabilities` | 仪表盘 / 最近活动 / 能力开关 |
| GET/POST/PUT/DELETE | `/credentials` · `/:id` · `/:id/test` | 凭据 CRUD + 连通性测试 |
| GET/POST/PUT/DELETE | `/assets` · `/:id` | 资产 CRUD |
| POST | `/assets/import` | CSV 导入（upsert） |
| POST | `/assets/:id/ping` · `/assets/batch-ping` | 在线探测（单/批量） |
| GET | `/assets/:id/uptime` · `/assets/:id/history` | 在线率历史 / 变更历史 |
| POST | `/assets/:id/collect` | 认证采集（架构/虚拟化） |
| GET/POST | `/assets/:id/sftp/{list,download,upload,mkdir,remove,rename}` | SFTP 文件管理 |
| GET/POST/PUT/DELETE | `/tags` · `/:id` | 全局标签 |

### 扫描 / 漏洞 / 设置 / 通知
| 方法 | 路径 | 功能 |
|------|------|------|
| 🔒 GET/POST/PUT/DELETE | `/tasks` · `/:id` · `/:id/run` · `/:id/stop` · `/:id/logs` | 扫描任务 |
| 🔒 GET | `/tasks/:id/stream` | SSE 实时扫描流 |
| 🔒 GET | `/vulns` | 漏洞发现列表 |
| 🔒 GET/PUT | `/settings` | 系统配置 |
| 🔒 POST | `/notify/test` | 告警测试 |

### AI 助手 / Agent
| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | `/ai/status` · `/ai/command` | AI 状态 / 生成单条命令 |
| 🔒 POST | `/ai/test` | AI 配置测试 |
| POST | `/ai/agent/{start,continue,message,stop}` | Agent 自动执行 / 确认 / 多轮 / 停止 |
| GET | `/ai/agent/sessions` · `/ai/agent/sessions/:id` | Agent 历史会话列表 / 读取 |

### Kubernetes（详见 §五）
| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | `/k8s/clusters` · `/k8s/clusters/:id` (GET) | 集群列表（含节点数/在线态）/ 详情+节点 |
| PUT/DELETE | `/k8s/clusters/:id` | 编辑 / 删除（节点解引用） |
| POST/DELETE | `/k8s/clusters/:id/nodes` · `/k8s/clusters/:id/nodes/:assetId` | 归类节点 / 移出节点 |
| GET | `/k8s/clusters/:id/console` | 一键控制台信息（url+账号+密码，审计 K8S_CONSOLE） |
| GET | `/k8s/nodes/unassigned` | 未归类 K8s 节点 |
| POST | `/k8s/auto-classify` | 自动归类（读节点 /etc/hosts 的 cluster-vip 标记） |
| GET | `/k8s/clusters/:id/overview` · `/live/nodes` · `/live/pods` | 实时看板（需 API Token） |

### WebSocket
| 方法 | 路径 | 功能 |
|------|------|------|
| WS | `/ws/terminal/:id` | WebSSH / Telnet 终端 |
| WS | `/ws/local-terminal` | 本机 Shell 本地终端 |

---

## 五、Kubernetes 集群管理（已落地）

> 历史计划见 [plans/2026-06-25-k8s-cluster-management.md](plans/2026-06-25-k8s-cluster-management.md)；本节为现状。

把 K8s 纳入「发现 → 测绘 → 接入」三段式。**节点复用 `Asset`**（多租户、终端、SFTP、凭据全部沿用），仅扩展 `k8s_role` / `k8s_cluster_id` 两个字段；**集群（`K8sCluster`）是用户手动建立的归类单元**（VIP + 控制台端口 + 路径 + 绑定凭据 + 可选 API Token）。

页面 `/k8s`（`frontend/src/pages/K8sClusters.tsx`）挂在侧边栏「资产中心」分组下，**对所有登录用户可见**（非管理员专属），按 `owner_id` 隔离。

### 5.1 扫描时 K8s 探测
- `ScanTask.detect_k8s` 开关：勾选「探测 Kubernetes 节点」后，扫描端口集合并入 **6443 + 非标 2070（apiserver 候选）+ 10250（kubelet）**。
- 判定（`backend/internal/scanner/scanner.go`，强信号优先降误报）：
  - **control-plane**：对 6443/2070 做 TLS 证书 SAN 校验（命中 `kubernetes*` DNSNames），辅以 `/version`（匿名放行取 `gitVersion` 写 `os_version`；匿名拒绝时凭 K8s Status JSON 形状判定）。
  - **worker**（弱判定）：仅 10250 时 TLS 握手 + `GET /healthz`（200/401/403 均算）。
- 命中后写 `K8sRole`，并自动打 `k8s` 标签（颜色 `#326ce5`）；扫描还会**排除已知集群 VIP**，避免 VIP 代答端口生成「幽灵主机」。

### 5.2 集群与节点
- 集群 CRUD（owner 隔离 + 跨租户防护：不可绑定他人凭据）；删除集群时把节点 `k8s_cluster_id` 置空、资产保留。
- 归类：①**手动**在「未归类 K8s 节点」勾选 → 选目标集群（可设角色）；②**自动归类** `POST /k8s/auto-classify`——对有凭据的 K8s 节点逐个 SSH `cat /etc/hosts`，解析 `cluster-vip` 标记下的 VIP，按 (owner, VIP) 分组建/并集群（默认控制台路径 `/uc`）。全程审计（`K8S_ASSIGN` / `K8S_AUTOCLASSIFY`）。

### 5.3 一键控制台
`GET /k8s/clusters/:id/console` 返回 `{url, username, password}` 并审计 `K8S_CONSOLE`。前端：
- `console_path` 含 `{username}`/`{password}` 占位符 → 用绑定凭据替换，**真·一键免登**；
- 否则复制绑定密码到剪贴板 + 新标签打开 `https://VIP:port{path}`（浏览器同源策略下无法跨域自动填表单，故采用「复制+打开」）。

集群列表/详情会并发 TCP 探测 `VIP:console_port` 连通性，卡片显示在线/离线。

### 5.4 实时看板（需 API Token）
集群可配 `api_token`（ServiceAccount Bearer Token，`json:"-"` 不回传前端，仅服务端用）。后端以该 Token 调 kube-apiserver（`InsecureSkipVerify`）：
- `/overview`：节点就绪/总、Pod 运行/总、版本（审计 `K8S_API`）；
- `/live/nodes`：实时节点（就绪/角色/IP/版本/OS/架构）；
- `/live/pods`：实时 Pod（可选 `?namespace=`，命名空间/状态/节点/重启数）。
- 前端集群抽屉据 `has_token` 显示「实时节点 / Pod / 归类节点」Tabs + 概览统计。

> **未实现（规划中）**：Deployment/Service 视图、namespace 过滤面板、在线 `kubectl`/exec、按控制台类型（Dashboard/Rancher/KubeSphere）的后端反代免登。

---

## 六、实施分期（完成情况）

### Phase 1：品牌重塑 · 界面重构 ✅
重命名为 Lynx · 猞猁、Logo/favicon、集中式设计令牌、可折叠分组侧栏、统一 `PageHeader`。

### Phase 2：发现能力 · 可视化增强 ✅
SSE 实时推流、按 IP 增量去重 + 离线清扫、`SystemSetting` 驱动并发/超时、类型分布、活动时间线。

### Phase 3：安全/接入增强 · 高级终端 ✅
凭据连通性测试、系统配置持久化、Telnet 通道、本机 Shell 本地终端、全局搜索、应用内终端多标签/全屏/滚动回看。

### Phase 4：登录 · 漏洞 · 调度 · 采集 · 加固 ✅
登录门禁、可插拔引擎 + nuclei、自包含调度器、认证采集（架构/虚拟化）、资产分组/批量/CSV/历史、健壮性加固（panic 恢复、404 校验、悬空引用清理等）。

### Phase 5：多用户 · 接入增强 · 智能化 ✅
- [x] 多用户 + 多租户隔离（bcrypt、内存会话令牌、`AuthMiddleware`/`AdminMiddleware`、`owner_id` 隔离、`canAccess`）
- [x] 注册审批制 / 登录锁定（失败 5 次锁 10 分钟）/ 首登强制改密 / 操作审计
- [x] SFTP 文件管理、可用性监控、告警通知、AI 命令助手、非标 SSH 端口
- [x] 终端接入增强：多屏分屏（独立关闭 + 自由拖拽缩放）、命令同步广播、命令自动补全

### Phase 6：AI Agent 自动化 · 终端体验增强 ✅
- [x] AI Agent：独立 SSH 通道逐条执行（pwd 跨命令保留、每步超时）、读输出推进、高危拦截、多轮上下文
- [x] AI 悬浮面板 + 历史对话切换；`AgentSession` 写穿落库 + `GET /ai/agent/sessions`
- [x] 终端：Ctrl+F 屏幕搜索、配色主题热切换、重连历史回放、凭据自动绑定

### Phase 7：Kubernetes 集群管理 ✅（v0.5x–v0.64）
- [x] 扫描可选探测 K8s（6443/2070/10250、TLS SAN + /version + kubelet 弱判定）、打标定角色、排除集群 VIP
- [x] 集群 CRUD + 手动归类 + **自动归类（读 /etc/hosts cluster-vip）** + 一键控制台（复制密码 / 占位符免登）
- [x] 集群在线探测；**实时看板**（overview/live nodes/pods，绑定 ServiceAccount Token）

---

## 七、路线图（后续可选）

> 安全相关延后项属**有意取舍**（本地/内网工具定位），非缺陷。

### 安全加固（需明确启动，规划中/未实现）
- [ ] 凭据**加密存储**（明文 → AES-at-rest，KMS 管理密钥）
- [ ] SSH **主机密钥校验**（当前 `InsecureIgnoreHostKey`）
- [ ] **登录**会话外置存储（`auth.go` 令牌存进程内存，重启需重新登录；AI Agent 会话已落库）

### 能力增强（规划中/未实现）
- [ ] 漏洞详情/模板管理，与资产/严重度联动看板
- [ ] 趋势图（资产增长 / 在线率历史）、SLA 报表
- [ ] WebSSH 会话录制与回放
- [ ] 采集扩展：Windows（WMI）信息、更多设备指纹
- [ ] AI Agent 逐步流式（SSE）进度
- [ ] K8s：Deployment/Service 视图、namespace 过滤、在线 kubectl/exec、控制台类型反代免登

> ✅ 已落地（曾在路线图）：服务端真实鉴权 + 会话校验、多用户与 RBAC、AI 多轮上下文、AI Agent 会话持久化、**Kubernetes 集群管理与实时看板**。

---

## 八、刻意的安全取舍（如实记录，非待修缺陷）

以下为面向本地/内网运维工具定位的**刻意设计**：
- 默认管理员 **admin / admin**（首登强制改密）；桌面端免登录（前端自动用默认凭据登录）。
- 凭据（密码 / 私钥）**明文存库**；K8s `api_token` 明文存库（仅服务端用，不回前端）。
- SSH 连接用 `InsecureIgnoreHostKey()`；K8s 探测与 kube-apiserver/控制台连接用 `InsecureSkipVerify`（自签证书普遍）。

中间件层次：`AuditMiddleware`（最外层，审计含登录/注册的写操作）→ 公开 `login`/`register` → `AuthMiddleware`（其后全部需登录）→ 个别路由再加 `AdminMiddleware`。资产 / 凭据 / K8s 集群按 `owner_id` 隔离，`canAccess` / `isAdmin` 校验。

---

## 九、验证

```bash
# 后端（纯 Go SQLite，免 CGO）
cd backend && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server

# 前端（类型检查 + 打包）
cd frontend && npm run build
```

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| 构建 | `go build` · `tsc -b` · `vite build` | 均通过 |
| 鉴权/多租户 | 用两个普通用户登录 | 仅见各自归属资产/集群；越权 403；未登录/失效 401 |
| 审批/锁定 | 注册新用户 / 连续错密码 | 未审批不能登录；失败 5 次锁 10 分钟；首登强制改密 |
| 实时进度 | 运行扫描并打开日志弹窗 | SSE 实时追加，结束自动收尾 |
| 监控/告警 | 开启监控、配置 Webhook | 在线率历史写入；离线/恢复推送到 IM |
| SFTP | 上传/下载/建删改目录 | 操作成功且审计有记录 |
| AI 助手 | 终端输入自然语言生成 | 命令生成、高危标红、确认后填入/执行 |
| 终端接入 | 多屏分屏 + 同步 + 补全 | 拖拽缩放、独立关闭、Tab 补全、同步广播正常 |
| K8s | 勾选探测扫描 → 归类 → 控制台 / 看板 | 节点打标定角色；归类/移出生效；控制台 URL 正确；配 Token 后看板拉取节点/Pod |

---

## 十、目录结构

```
Lynx/（仓库 meridian）
├── backend/
│   ├── cmd/server/main.go                # 路由 + 中间件 + 调度器/监控启动
│   └── internal/
│       ├── model/models.go               # 14 模型（含 K8sCluster、AgentSession，Asset +k8s_role/k8s_cluster_id）
│       ├── store/db.go                    # AutoMigrate + 默认设置 + 默认管理员(admin/admin,首登改密)
│       ├── handler/
│       │   ├── auth.go                    # 会话鉴权/管理员中间件/多租户 canAccess
│       │   ├── users.go                   # 注册审批 + 用户 CRUD + 改密
│       │   ├── audit.go                   # 审计中间件 + 查询
│       │   ├── handlers.go                # 资产/凭据/扫描/终端/设置/采集/仪表盘/活动/漏洞/能力
│       │   ├── assets_io.go               # CSV 导入
│       │   ├── sftp.go                    # SFTP 文件管理
│       │   ├── uptime.go                  # 在线率历史
│       │   ├── ai.go / ai_agent.go        # AI 命令助手 / AI Agent（自动执行 + 持久化 + 历史）
│       │   ├── k8s.go                     # K8s 集群 CRUD/归类/自动归类/控制台/实时看板
│       │   ├── localterm.go               # 本机 Shell 本地终端
│       │   └── notify.go                  # 告警测试
│       ├── scanner/{engine,scanner,nuclei,ip_range}.go   # 扫描（含 K8s 探测）
│       ├── scheduler/scheduler.go         # 自包含定时调度
│       ├── monitor/monitor.go             # 后台可用性监控
│       ├── notifier/notifier.go           # 企业微信/钉钉/Webhook
│       └── sshproxy/{sshproxy,telnet}.go  # SSH / Telnet 代理
├── frontend/
│   ├── public/favicon.svg
│   └── src/
│       ├── theme.ts · index.css · App.tsx · main.tsx · commandSnippets.ts · terminalSessions.tsx
│       ├── components/{Logo,PageHeader,UserMenu,GlobalSearch,TerminalTabBar,SftpDrawer,SnippetManager,TerminalAIPanel}.tsx
│       ├── pages/{Dashboard,Assets,K8sClusters,ScanTasks,Vulns,Credentials,Users,Audit,Settings,Login,ForcePasswordChange,TerminalPage}.tsx
│       └── services/api.ts
├── src-tauri/                             # Tauri v2 桌面壳（sidecar = meridian-backend）
└── docs/{architecture.md, api_spec.md, design_plan.md, plans/}
```
