# Meridian — 产品设计与实施计划

> **产品名称**: Meridian · 子午
> **定位**: 网络资产发现与统一接入平台（Network Asset Discovery & Unified Access Platform）
> **文档版本**: v5.0 · 对应应用版本 **v0.30**
> **更新时间**: 2026-06-23
> **状态**: Phase 1–4 已落地；Phase 5（多用户/多租户/审计/接入增强）已落地

---

## 〇、版本演进概览

| 版本 | 主题 | 状态 |
|------|------|------|
| v2.0 | AssetManager 基础：CMDB / 凭据 / 发现扫描 / WebSSH | ✅ |
| v3.0 | 品牌重塑（Meridian）· 界面重构 · 设计令牌 | ✅ |
| v4.0 | Phase 2/3 落地 + 登录、漏洞扫描、定时调度、认证采集、健壮性加固 | ✅ |
| **v5.0** | **多用户/多租户、SFTP、可用性监控、告警、AI 命令助手、终端多屏/补全** | ✅ |

### v5.0 内的应用迭代（app 版本号）

| app 版本 | 内容 |
|----------|------|
| v0.21 | 多租户数据隔离 + 注册审批制 |
| v0.22 / v0.24 | SFTP 上传/下载 → 目录新建/删除/重命名 + 拖拽上传 |
| v0.23 | 管理员分配资产归属；移除登录页默认密码提示 |
| v0.25 | 自动发现按类型前缀命名（server-/router-/switch-） |
| v0.26 | SSH 非标端口（终端/SFTP/采集） |
| v0.27 | 收尾修复多租户隔离/权限漏洞 |
| v0.28 | AI 命令助手（自然语言转 shell，确认后执行） |
| v0.29 | 终端命令**同步发送**（多屏广播） |
| **v0.30** | 命令**自动补全**（内置 200+ 运维命令）+ 分屏**独立关闭/自由拖拽缩放** |

### 命名与品牌

**Meridian（子午线）** 是航海与测绘中的基准经线——呼应「为网络资产测绘、定位、导航」的核心价值，
对应三段式工作流：**发现（雷达扫描）→ 测绘（CMDB 入库）→ 接入（一键 SSH/Telnet/SFTP）**。

- **Logo**：中心实心节点 + 外层轨道环 + 三颗均布卫星节点。
- **渐变**：`#6366f1 → #7c5cfb → #22d3ee`（靛蓝→紫→青），青色端呼应「雷达发现」语义。
- **落地**：`frontend/public/favicon.svg` + `frontend/src/components/Logo.tsx`。

---

## 一、设计系统（Design System）

集中维护于 `frontend/src/theme.ts`，所有页面统一引用，杜绝散落 hex。

### 1.1 品牌色板

| 令牌 | 值 | 用途 |
|------|-----|------|
| `primary` | `#6366f1` | 主操作、链接、选中态 |
| `accent` | `#06b6d4` | 发现/雷达语义、进度渐变端 |
| `brandGradient` | `135deg #6366f1→#7c5cfb→#22d3ee` | Logo、图标徽章、强调元素 |
| `bg` / `surface` / `border` | `#f5f6fb` / `#ffffff` / `#eef1f6` | 背景 / 卡片面 / 描边 |
| `siderBg` | `#0b1020` | 深空蓝侧边栏 |
| `success/warning/danger` | `#10b981/#f59e0b/#ef4444` | 语义状态 |

> 表面/文本/边框令牌以 CSS 变量（`var(--mrd-*)`）实现，为主题切换预留；Antd algorithm token 使用字面 hex。

### 1.2 复用组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `LogoMark` / `Logo` | `components/Logo.tsx` | 品牌标识 |
| `PageHeader` | `components/PageHeader.tsx` | 统一页面头部 + 右上角用户菜单 |
| `UserMenu` | `components/UserMenu.tsx` | 当前用户 + 退出登录 |
| `GlobalSearch` | `components/GlobalSearch.tsx` | 全局搜索（Ctrl/Cmd + K） |
| `TerminalTabBar` + `terminalSessions` | `components/TerminalTabBar.tsx` · `terminalSessions.tsx` | 应用内终端标签页（多会话保活 + 同步广播控制） |
| `SftpDrawer` | `components/SftpDrawer.tsx` | SFTP 文件管理抽屉 |
| `SnippetManager` + `commandSnippets` | `components/SnippetManager.tsx` · `commandSnippets.ts` | 命令补全片段库管理 + 内置命令 |
| `cardStyle` | `theme.ts` | 统一卡片样式 |

---

## 二、现状（v5.0 基线）

### 已实现功能

| 模块 | 已有能力 | 后续可补强 |
|------|----------|-----------|
| 资产管理 (CMDB) | CRUD、搜索/过滤、标签、端口 Tag、关联凭据、详情抽屉、在线探测、连接终端、分组、批量探测/删除、**CSV 导入/导出**、字段级变更历史、认证采集（架构/虚拟化）、**管理员分配归属**、**SFTP 文件管理** | 自定义字段、资产合并去重细化 |
| 可用性监控 | **后台定时探测 + 在线率历史（uptime）+ 离线/恢复告警** | 趋势图、SLA 报表 |
| 凭据管理 Vault | SSH 密码/密钥/Telnet CRUD、连通性测试、**非标端口** | 加密存储（明文 → AES，待定） |
| 自动发现 | CIDR/范围扫描、端口指纹、停止、历史日志、SSE 实时进度、定时调度、增量入库与离线清扫、**按类型前缀命名** | 发现后合并去重的更细策略 |
| 漏洞发现 | 可插拔引擎（discovery/vuln）、nuclei 接入（优雅降级）、漏洞列表页 | 详情/模板管理、联动看板 |
| WebSSH / Telnet 终端 | xterm.js + WebSocket + SSH/Telnet 代理 + 凭据交互 + 重连、应用内多标签、全屏、滚动回看、**多屏分屏（单/双/四分，独立关闭 + 自由拖拽缩放）**、**命令同步广播**、**命令自动补全**、**AI 命令助手** | 会话录制 |
| AI 命令助手 | **自然语言 → shell（OpenAI 兼容），仅生成不执行，高危标红 + 二次确认，全程审计** | 多轮对话、上下文记忆 |
| 告警通知 | **企业微信 / 钉钉 / 通用 Webhook；扫描完成 / 资产离线触发；可测试** | 更多渠道、模板自定义 |
| 控制台 | 统计卡、存活率环图、类型分布、活动时间线、5s 轮询（按归属隔离） | 趋势图 |
| 系统设置 | 扫描并发/超时、SSH 超时、**监控开关/间隔、告警、AI 配置** 真实读写 | 更多可配置项 |
| 多用户 / 多租户 | **会话鉴权（bcrypt + 令牌中间件）、注册审批、RBAC（admin/user）、按归属数据隔离、登录锁定、首登强制改密、操作审计** | 外置会话存储、更细 RBAC |

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | **Go 1.22** · Gin · GORM · **glebarez/sqlite（纯 Go，免 cgo）** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · `bcrypt` + 内存会话令牌 |
| 前端 | React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6（+ fit addon）· Vite 8 · react-router-dom v7 · axios |
| 扫描/调度/监控 | 自研并发 Worker Pool · 自包含调度器（无 cron 依赖）· 后台可用性监控 · nuclei（可选外部二进制）· 告警通知器 |

---

## 三、数据模型（v5.0，共 12 表）

| 模型 | 表 | 关键字段 | 状态 |
|------|----|----------|------|
| User | users | id, username, password(bcrypt), role, status, must_change_password, last_login_at, last_login_ip | ✅ |
| AuditLog | audit_logs | id, actor, action, path, status, ip, created_at | ✅ |
| AssetCheck | asset_checks | id, asset_id, status, checked_at | ✅ |
| Asset | assets | id, **owner_id**, name, ip, type, status, **ssh_port**, vendor, os_version, arch, virtualization, ports, tags, description, credential_id, last_scanned_at | ✅ |
| Credential | credentials | id, **owner_id**, name, type, username, password, private_key | ✅ |
| ScanTask | scan_tasks | id, name, target_range, ports, kind, schedule, status, last_run_at | ✅ |
| ScanLog | scan_logs | id, task_id, status, started_at, finished_at, summary, detail | ✅ |
| ActivityLog | activity_logs | id, type, message, ref_id, created_at | ✅ |
| SystemSetting | system_settings | key, value, updated_at | ✅ |
| VulnFinding | vuln_findings | id, asset_id, target, template_id, name, severity, matched_at, engine | ✅ |
| AssetHistory | asset_histories | id, asset_id, field, old_value, new_value, created_at | ✅ |
| Tag | tags | id, name, color | ✅ |

> `owner_id` 驱动多租户隔离；`ssh_port` 支持非标端口；`arch`/`virtualization` 由认证采集写入。完整接口详见 [api_spec.md](api_spec.md)。

---

## 四、接口清单（v5.0）

> 统一响应 `{ code, message, data }`；除 login/register 外均需 `Authorization: Bearer`，WS/SSE 走 `?token=`。🔒=管理员。

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/login` · `/api/register` · `/api/logout` | 登录 / 注册（审批制）/ 注销 |
| POST | `/api/users/change-password` | 改本人密码 |
| GET/POST/PUT/DELETE 🔒 | `/api/users` · `/:id` | 用户管理 |
| GET 🔒 | `/api/audit` | 操作审计 |
| GET | `/api/dashboard/stats` | 仪表盘统计 |
| GET/POST/PUT/DELETE | `/api/credentials` · `/:id` · `/:id/test` | 凭据 CRUD + 测试 |
| GET/POST/PUT/DELETE | `/api/assets` · `/:id` | 资产 CRUD |
| POST | `/api/assets/import` | CSV 导入（upsert） |
| POST | `/api/assets/:id/ping` · `/api/assets/batch-ping` | 在线探测（单/批量） |
| GET | `/api/assets/:id/uptime` | 在线率历史 |
| POST/GET | `/api/assets/:id/collect` · `/history` | 认证采集 / 变更历史 |
| GET/POST/PUT/DELETE | `/api/tags` · `/:id` | 全局标签 |
| GET/POST/PUT/DELETE 🔒 | `/api/tasks` · `/:id` · `/run` · `/stop` · `/logs` | 扫描任务 |
| GET 🔒 | `/api/tasks/:id/stream` | SSE 实时扫描流 |
| GET 🔒 | `/api/vulns` | 漏洞发现列表 |
| GET/PUT 🔒 | `/api/settings` | 系统配置 |
| POST 🔒 | `/api/notify/test` | 告警测试 |
| GET/POST | `/api/ai/status` · `/api/ai/command` | AI 状态 / 生成命令 |
| POST 🔒 | `/api/ai/test` | AI 配置测试 |
| GET/POST | `/api/assets/:id/sftp/{list,download,upload,mkdir,remove,rename}` | SFTP 文件管理 |
| GET | `/api/activity/recent` | 最近操作活动 |
| WS | `/api/ws/terminal/:id` | WebSSH / Telnet 终端 |

---

## 五、实施分期（完成情况）

### Phase 1：品牌重塑 · 界面重构 ✅
重命名为 Meridian · 子午、Logo/favicon、集中式设计令牌、可折叠分组侧栏、统一 `PageHeader`。

### Phase 2：发现能力 · 可视化增强 ✅
SSE 实时推流、按 IP 增量去重 + 离线清扫、`SystemSetting` 驱动并发/超时、类型分布、活动时间线。

### Phase 3：安全/接入增强 · 高级终端 ✅
凭据连通性测试、系统配置持久化、Telnet 通道、全局搜索、应用内终端多标签/全屏/滚动回看。

### Phase 4：登录 · 漏洞 · 调度 · 采集 · 加固 ✅
登录门禁、可插拔引擎 + nuclei、自包含调度器、认证采集（架构/虚拟化）、资产分组/批量/CSV/历史、健壮性加固（panic 恢复、404 校验、悬空引用清理等）。

### Phase 5：多用户 · 接入增强 · 智能化 ✅（v0.21–v0.30）
- [x] **多用户 + 多租户隔离**：bcrypt 口令、内存会话令牌、`AuthMiddleware`/`AdminMiddleware`、`owner_id` 数据隔离、`canAccess` 归属校验
- [x] **注册审批制**：注册默认 `pending`，管理员审批为 `active`
- [x] **登录安全**：失败 5 次锁定 10 分钟、上次登录记录、默认账号首登强制改密
- [x] **操作审计**：写操作中间件审计 + SFTP/AI 细粒度审计 + 审计查询页
- [x] **SFTP 文件管理**：浏览/上传(拖拽)/下载/新建/删除/重命名（仅 SSH、全程审计）
- [x] **可用性监控**：后台定时探测 + `AssetCheck` 在线率历史 + 离线/恢复告警
- [x] **告警通知**：企业微信/钉钉/通用 Webhook，扫描完成/离线触发，可测试
- [x] **AI 命令助手**：OpenAI 兼容自然语言转命令，仅生成不执行，高危标红 + 二次确认
- [x] **非标 SSH 端口**：终端/SFTP/采集/测试统一取 `asset.SSHPort`
- [x] **终端接入增强**：多屏分屏（独立关闭 + 自由拖拽缩放）、命令同步广播、命令自动补全（内置 200+ 运维命令）

---

## 六、路线图（后续可选）

> 安全相关延后项属**有意取舍**（本地工具定位），非缺陷。

### 安全加固（需明确启动）
- [ ] 凭据**加密存储**（明文 → AES-at-rest，KMS 管理密钥）
- [ ] SSH **主机密钥校验**（当前 `InsecureIgnoreHostKey`）
- [ ] 会话**外置存储**（当前存进程内存，重启即失效）

### 能力增强
- [ ] 漏洞详情/模板管理，与资产/严重度联动看板
- [ ] 趋势图（资产增长 / 在线率历史）、SLA 报表
- [ ] WebSSH 会话录制与回放
- [ ] 采集扩展：Windows（WMI）信息、更多设备指纹
- [ ] AI 助手多轮对话与上下文记忆

> ✅ 已落地（曾在本路线图）：服务端真实鉴权 + 会话校验、多用户与 RBAC。

---

## 七、验证

```bash
# 后端（纯 Go SQLite，免 cgo）
cd backend && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server

# 前端（类型检查 + 打包）
cd frontend && npm run build
```

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| 构建 | `go build` · `tsc -b` · `vite build` | 均通过 |
| 鉴权/多租户 | 用两个普通用户登录 | 仅见各自归属资产；越权访问返回 403；未登录/失效返回 401 |
| 审批/锁定 | 注册新用户 / 连续错密码 | 未审批不能登录；失败 5 次锁定 10 分钟；首登强制改密 |
| 实时进度 | 运行扫描并打开日志弹窗 | SSE 实时追加，结束自动收尾 |
| 监控/告警 | 开启监控、配置 Webhook | 在线率历史写入；离线/恢复推送到 IM |
| SFTP | 上传/下载/建删改目录 | 操作成功且审计有记录 |
| AI 助手 | 终端输入自然语言生成 | 命令生成、高危标红、确认后填入/执行 |
| 终端接入 | 多屏分屏 + 同步 + 补全 | 拖拽缩放、独立关闭、Tab 补全、同步广播正常 |

---

## 八、目录结构（v5.0）

```
Meridian/
├── backend/
│   ├── cmd/server/main.go                # 路由 + 中间件 + 调度器/监控启动
│   └── internal/
│       ├── model/models.go               # 12 模型（User/AuditLog/AssetCheck/Asset(+owner_id,ssh_port)/Credential/ScanTask/ScanLog/ActivityLog/SystemSetting/VulnFinding/AssetHistory/Tag）
│       ├── store/db.go                    # AutoMigrate + 默认设置 + 默认管理员(admin/admin,首登改密)
│       ├── handler/
│       │   ├── auth.go                    # 会话鉴权/管理员中间件/多租户 canAccess
│       │   ├── users.go                   # 注册审批 + 用户 CRUD + 改密
│       │   ├── audit.go                   # 审计中间件 + 查询
│       │   ├── handlers.go                # 资产/凭据/扫描/终端/设置/采集/仪表盘/活动/漏洞
│       │   ├── assets_io.go               # CSV 导入
│       │   ├── sftp.go                    # SFTP 文件管理
│       │   ├── uptime.go                  # 在线率历史
│       │   ├── ai.go                      # AI 命令助手
│       │   └── notify.go                  # 告警测试
│       ├── scanner/{engine,scanner,nuclei,ip_range}.go
│       ├── scheduler/scheduler.go         # 自包含定时调度
│       ├── monitor/monitor.go             # 后台可用性监控
│       ├── notifier/notifier.go           # 企业微信/钉钉/Webhook
│       └── sshproxy/{sshproxy,telnet}.go  # SSH / Telnet 代理
├── frontend/
│   ├── public/favicon.svg
│   └── src/
│       ├── theme.ts · index.css · App.tsx · main.tsx · commandSnippets.ts · terminalSessions.tsx
│       ├── components/{Logo,PageHeader,UserMenu,GlobalSearch,TerminalTabBar,SftpDrawer,SnippetManager}.tsx
│       ├── pages/{Dashboard,Assets,ScanTasks,Vulns,Credentials,Users,Audit,Settings,Login,ForcePasswordChange,TerminalPage}.tsx
│       └── services/api.ts
└── docs/{architecture.md, api_spec.md, design_plan.md}
```
