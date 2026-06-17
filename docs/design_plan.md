# Meridian — 产品设计与实施计划

> **产品名称**: Meridian · 子午
> **定位**: 网络资产发现与统一接入平台（Network Asset Discovery & Unified Access Platform）
> **文档版本**: v4.0
> **更新时间**: 2026-06-18
> **状态**: Phase 1 / 2 / 3 均已完成并落地；已扩展登录、漏洞扫描、定时调度、认证采集（架构 / 虚拟化）等能力

---

## 〇、版本演进概览

| 版本 | 主题 | 状态 |
|------|------|------|
| v2.0 | AssetManager 基础：CMDB / 凭据 / 发现扫描 / WebSSH | ✅ |
| v3.0 | 品牌重塑（Meridian）· 界面重构 · 设计令牌 | ✅ |
| **v4.0** | **Phase 2/3 落地 + 登录、漏洞扫描、定时调度、认证采集、健壮性加固** | ✅ |

### 命名与品牌

**Meridian（子午线）** 是航海与测绘中的基准经线——呼应「为网络资产测绘、定位、导航」的核心价值，
对应三段式工作流：**发现（雷达扫描）→ 测绘（CMDB 入库）→ 接入（一键 SSH/Telnet）**。

- **Logo**：中心实心节点（统一管理平台）+ 外层轨道环（治理边界）+ 三颗均布卫星节点（被发现的资产）。
- **渐变**：`#6366f1 → #7c5cfb → #22d3ee`（靛蓝→紫→青），青色端呼应「雷达发现」语义。
- **落地**：`frontend/public/favicon.svg` + `frontend/src/components/Logo.tsx`（`LogoMark` / `Logo`）。

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
> 暗色模式的令牌与样式已保留在代码中（`index.css` 的 `:root[data-theme='dark']`），但**入口开关已隐藏**（评估后认为观感不佳，暂收起）。

### 1.2 复用组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `LogoMark` / `Logo` | `components/Logo.tsx` | 品牌标识 |
| `PageHeader` | `components/PageHeader.tsx` | 统一页面头部（图标徽章/标题/副标题/操作区 + 右上角用户菜单） |
| `UserMenu` | `components/UserMenu.tsx` | 右上角当前用户 + 退出登录 |
| `GlobalSearch` | `components/GlobalSearch.tsx` | 全局搜索（Ctrl/Cmd + K） |
| `TerminalTabBar` + `terminalSessions` | `components/TerminalTabBar.tsx` · `terminalSessions.tsx` | 应用内终端标签页（多会话保活） |
| `cardStyle` | `theme.ts` | 统一卡片样式 |

---

## 二、现状（v4.0 基线）

### 已实现功能

| 模块 | 已有能力 | 后续可补强 |
|------|----------|-----------|
| 资产管理 (CMDB) | CRUD、搜索/过滤、标签、端口 Tag、关联凭据、详情抽屉、在线探测、连接终端、**分组（类型/状态/标签）、批量探测/删除、导出 CSV、字段级变更历史、认证采集（架构/虚拟化）** | 资产去重合并策略细化、自定义字段 |
| 凭据管理 Vault | SSH 密码/密钥/Telnet CRUD、**连通性测试** | 加密存储（明文 → AES，待定） |
| 自动发现 | CIDR/范围扫描、端口指纹、停止、历史日志、**SSE 实时进度、定时调度（@every / 每日定时）、发现即增量入库与离线清扫、设置驱动并发/超时** | 发现后自动合并去重的更细粒度策略 |
| 漏洞发现 | **可插拔扫描引擎（discovery/vuln 分发）、nuclei 漏扫接入（缺二进制优雅降级）、漏洞发现列表页** | 漏洞详情、模板管理、与资产联动 |
| WebSSH / Telnet 终端 | xterm.js + WebSocket + SSH 代理 + 凭据交互 + 重连、**Telnet 通道、应用内多标签、全屏、滚动回看** | 会话录制 |
| 控制台 | 统计卡、存活率环图、**资产类型分布、活动时间线（定高滚动）**、5s 轮询、快速开始 | 趋势图 |
| 系统设置 | **真实读写（扫描并发/超时/SSH 超时），居中布局、滑块** | 更多可配置项 |
| 登录 / 导航 | **登录门禁（默认 admin/admin）、右上角用户菜单/登出**、可折叠分组侧栏、统一头部、品牌、设计令牌、全局搜索 | 多用户 / RBAC |

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | **Go 1.22**（已从 1.24 降级以适配本地构建）· Gin · GORM · **glebarez/sqlite（纯 Go，免 cgo）** · gorilla/websocket · `golang.org/x/crypto/ssh` |
| 前端 | React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6 · Vite 8 · react-router-dom v7 · axios |
| 扫描/调度 | 自研并发 Worker Pool · 自包含调度器（无 cron 依赖）· nuclei（可选外部二进制） |

---

## 三、数据模型（v4.0）

| 模型 | 表 | 关键字段 | 状态 |
|------|----|----------|------|
| Asset | assets | id, name, ip, type, status, vendor, os_version, **arch**, **virtualization**, ports, tags, description, credential_id, last_scanned_at | ✅ |
| Credential | credentials | id, name, type, username, password, private_key | ✅ |
| ScanTask | scan_tasks | id, name, target_range, ports, **kind**, **schedule**, status, last_run_at | ✅ |
| ScanLog | scan_logs | id, task_id, status, started_at, finished_at, summary, detail | ✅ |
| ActivityLog | activity_logs | id, type, message, ref_id, created_at | ✅ |
| SystemSetting | system_settings | key, value | ✅ |
| VulnFinding | vuln_findings | id, asset_id, target, template_id, name, severity, matched_at, engine | ✅ |
| AssetHistory | asset_histories | id, asset_id, field, old_value, new_value, created_at | ✅ |

> 说明：`arch`（x86_64 / aarch64 …）与 `virtualization`（physical / vmware / kvm / hyper-v / xen / qemu / aws / gcp / aliyun / openstack / container:* …）均由**认证采集**（SSH `uname` + `systemd-detect-virt`）写入；
> 列表以小标签展示「系统 · 架构 + 虚拟化标签 + 业务标签」，完整内核 banner 仅在详情抽屉展示。

---

## 四、接口清单（v4.0）

> 统一响应：`{ code, message, data }`。详见 `docs/api_spec.md`。

| 方法 | 路径 | 功能 | 状态 |
|------|------|------|------|
| GET | `/api/dashboard/stats` | 仪表盘统计 | ✅ |
| GET/POST | `/api/credentials` · PUT/DELETE `/:id` | 凭据 CRUD | ✅ |
| POST | `/api/credentials/:id/test` | 凭据连通性测试 | ✅ |
| GET/PUT | `/api/settings` | 系统配置读写 | ✅ |
| GET/POST | `/api/assets` · GET/PUT/DELETE `/:id` | 资产 CRUD | ✅ |
| POST | `/api/assets/:id/ping` | TCP 在线探测 | ✅ |
| POST | `/api/assets/:id/collect` | 认证采集（架构 / 虚拟化 / 内核） | ✅ |
| GET | `/api/assets/:id/history` | 资产字段变更历史 | ✅ |
| GET/POST | `/api/tasks` · PUT/DELETE `/:id` | 扫描任务 CRUD | ✅ |
| POST | `/api/tasks/:id/run` · `/stop` | 启动/停止扫描 | ✅ |
| GET | `/api/tasks/:id/logs` | 任务日志列表 | ✅ |
| GET | `/api/tasks/:id/stream` | **SSE 实时扫描日志/状态流** | ✅ |
| GET | `/api/vulns` | 漏洞发现列表（可 `?asset_id=` 过滤） | ✅ |
| POST | `/api/login` | 登录校验（默认 admin/admin） | ✅ |
| GET | `/api/activity/recent` | 最近操作活动 | ✅ |
| WS | `/api/ws/terminal/:id` | WebSSH / Telnet 终端 | ✅ |

---

## 五、实施分期（完成情况）

### Phase 1：品牌重塑 · 界面重构 ✅ 已完成
- [x] 重命名 AssetManager → **Meridian · 子午**，全站文案/标题/favicon
- [x] 品牌 Logo（`LogoMark`/`Logo` + favicon.svg）
- [x] 集中式设计令牌 `theme.ts`
- [x] 侧边栏：可折叠、分组导航、品牌辉光
- [x] 统一 `PageHeader`；控制台重做；各页接入令牌；终端页品牌化

### Phase 2：发现能力 · 可视化增强 ✅ 已完成
- [x] `GET /api/tasks/:id/stream` SSE 实时推流；前端日志弹窗 SSE 实时追加（替代 2s 轮询）
- [x] 资产写入按 IP 增量去重合并（端口/状态/厂商）+ 离线资产清扫
- [x] `SystemSetting` 模型与迁移；扫描并发/超时由设置驱动
- [x] 控制台「资产类型分布」；活动时间线定高滚动
- [x] 资产标签编辑

### Phase 3：安全/接入增强 · 高级终端 ✅ 已完成
- [x] `POST /api/credentials/:id/test` 凭据连通性测试
- [x] `GET/PUT /api/settings` 系统配置持久化 + 设置页真实读写
- [x] sshproxy 增加 **Telnet** 通道（IAC 协商处理）
- [x] 全局搜索 `GlobalSearch`（Ctrl/Cmd + K）
- [x] 应用内终端多标签（不再新开浏览器标签页）、全屏、滚动回看
- [~] 暗色模式：令牌已预留，**入口隐藏**（观感欠佳，暂收起）

### Phase 4：登录 · 漏洞 · 调度 · 采集 · 加固 ✅ 已完成（超出原计划）
- [x] 登录门禁页（默认 admin/admin）+ 右上角用户菜单/登出
- [x] 可插拔扫描引擎分发（discovery / vuln）+ **nuclei 漏扫**接入（缺二进制优雅降级）+ 漏洞发现页
- [x] 自包含**定时调度器**（`@every 15m` / `daily:HH:MM`，无 cron 依赖）
- [x] **认证采集**：SSH `uname` 取架构/内核 + `systemd-detect-virt` 判**虚拟化/云/容器**，列表标签展示
- [x] 资产**分组 / 批量探测删除 / 导出 CSV / 字段级变更历史**
- [x] 健壮性加固（自查并修复）：
  - 扫描 goroutine `panic` 恢复（单次扫描崩溃不再拖垮整个服务）
  - `DeleteAsset` 不存在返回 404；`CreateAsset` 服务端校验 IP 合法性
  - 删除凭据时解除资产上的悬空引用
  - 仪表盘「其他」类型计数覆盖全部非核心类型（分布饼图合计正确）
  - 清理无用代码与 Antd 弃用告警（`destroyOnHidden` / `styles.body` / Descriptions `styles`）

---

## 六、路线图（后续可选）

> 以下为尚未实现、按需推进的方向。安全相关项属**有意延后**的设计取舍（当前为本地单用户工具），非缺陷。

### 安全加固（需明确启动）
- [ ] 服务端真实鉴权：API/WS 鉴权中间件 + 会话/JWT 校验（当前仅前端门禁，token 为静态占位）
- [ ] 凭据**加密存储**（明文 → AES-at-rest，KMS 管理密钥）
- [ ] SSH **主机密钥校验**（当前 `InsecureIgnoreHostKey`）
- [ ] 多用户与 RBAC

### 能力增强
- [ ] 漏洞详情/模板管理，与资产/严重度联动看板
- [ ] 资产去重合并的可视化与人工确认
- [ ] 趋势图（资产增长 / 在线率历史）
- [ ] WebSSH 会话录制与回放
- [ ] 采集扩展：Windows（WMI）信息、更多设备指纹

---

## 七、验证

```bash
# 后端（纯 Go SQLite，免 cgo）
cd backend
GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server

# 前端（类型检查 + 打包）
cd frontend && npm run build
```

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| 构建 | `go build` · `tsc --noEmit` · `vite build` | 三者均通过 |
| 登录门禁 | 访问任意页 | 未登录跳登录页；admin/admin 进入；登出回登录页 |
| 实时进度 | 运行扫描并打开日志弹窗 | SSE 实时追加控制台行，结束自动收尾 |
| 定时调度 | 配置 `@every 15m` / 每日定时 | 到点自动触发，避免重启即扫描风暴 |
| 认证采集 | 绑定 SSH 凭据后点「采集」 | 架构、虚拟化标签正确写入并展示 |
| 终端稳定性 | 应用内连开多个终端标签 | 切换不串流、滚动回看正常、无异常断开 |
| 浏览器回归 | Puppeteer 走查 | 0 Antd 弃用告警、0 控制台报错 |

---

## 八、目录结构（v4.0）

```
Meridian/
├── backend/
│   ├── cmd/server/main.go                # 路由 + 调度器启动
│   └── internal/
│       ├── model/models.go               # Asset(+arch,virtualization)/Credential/ScanTask(+kind,schedule)/ScanLog/ActivityLog/SystemSetting/VulnFinding/AssetHistory
│       ├── store/db.go                    # AutoMigrate + 默认设置(含 admin/admin)
│       ├── handler/handlers.go            # REST/WS 控制器（含 collect/history/login/settings/test/SSE）
│       ├── scanner/{engine,scanner,nuclei,ip_range}.go  # 引擎分发 / 发现扫描 / nuclei / 网段解析
│       ├── scheduler/scheduler.go         # 自包含定时调度
│       └── sshproxy/{sshproxy,telnet}.go  # SSH / Telnet 代理
├── frontend/
│   ├── public/favicon.svg
│   └── src/
│       ├── theme.ts · index.css · App.tsx · main.tsx
│       ├── components/{Logo,PageHeader,UserMenu,GlobalSearch,TerminalTabBar}.tsx · terminalSessions.tsx
│       ├── pages/{Dashboard,Assets,ScanTasks,Vulns,Credentials,Settings,Login,TerminalPage}.tsx
│       └── services/api.ts
└── docs/{architecture.md, api_spec.md, design_plan.md}
```
