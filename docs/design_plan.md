# Meridian — 产品设计与实施计划

> **产品名称**: Meridian · 子午
> **定位**: 网络资产发现与统一接入平台（Network Asset Discovery & Unified Access Platform）
> **文档版本**: v3.0
> **更新时间**: 2026-06-17
> **状态**: Phase 1 已完成（含品牌重塑与界面重构）；Phase 2 待启动

---

## 〇、本次变更摘要（v2.0 → v3.0）

本轮一次性完成三件事：**重新命名与 Logo 设计**、**重做实施计划**、**界面重新设计优化**。

| 维度 | v2.0（AssetManager） | v3.0（Meridian） |
|------|----------------------|------------------|
| 产品名 | AssetManager | **Meridian · 子午** |
| 标识 | Emoji 🖥️ + 纯文字 | **星座/中枢几何标识**（中心节点 + 轨道环 + 卫星节点），靛蓝→紫罗兰→青渐变 |
| 主色 | 单一蓝 `#2563eb` | **靛蓝 `#6366f1` + 青 `#06b6d4` 渐变体系** |
| 设计实现 | 内联散落的 hex 与样式 | **集中式设计令牌**（`theme.ts`）+ 复用组件（`Logo`、`PageHeader`） |
| 侧边栏 | 静态、不可折叠 | **可折叠、分组导航、品牌辉光、底部服务状态/版本/源码** |
| 页面头部 | 各页样式不一（20/22px、600/700） | **统一 `PageHeader`**（渐变图标徽章 + 标题 + 副标题 + 操作区） |
| 终端页 | 通用监视器图标 | **品牌化标识 + Meridian 远程终端** |

### 命名缘由

**Meridian（子午线）** 是航海与测绘中的基准经线——既呼应「为网络资产测绘、定位、导航」的核心价值，
也与产品三段式工作流自然对应：**发现（雷达扫描）→ 测绘（CMDB 入库）→ 接入（一键 SSH/Telnet）**。

### Logo 设计说明

- **几何构型**：中心实心节点（统一管理平台）+ 外层轨道环（治理边界）+ 三颗均布卫星节点（被发现的资产），节点间以连线表达「中枢—边缘」拓扑。
- **渐变**：`#6366f1 → #7c5cfb → #22d3ee`（靛蓝→紫→青），青色端呼应「雷达发现」语义。
- **可伸缩**：单一 32×32 `viewBox`，16px favicon 至大尺寸均清晰；提供 `badge`（渐变圆角徽标）与 `glyph`（透明描线）两种变体。
- **落地**：`frontend/public/favicon.svg`（站点图标）+ `frontend/src/components/Logo.tsx`（`LogoMark` / `Logo` 组件，供侧栏、终端页复用）。

---

## 一、设计系统（Design System）

集中维护于 `frontend/src/theme.ts`，所有页面统一引用，杜绝散落 hex。

### 1.1 品牌色板

| 令牌 | 值 | 用途 |
|------|-----|------|
| `primary` | `#6366f1` | 主操作、链接、选中态 |
| `primaryHover` | `#4f46e5` | 主色悬浮 |
| `accent` | `#06b6d4` | 发现/雷达语义、进度渐变端 |
| `violet` | `#8b5cf6` | 渐变中段 |
| `brandGradient` | `135deg #6366f1→#7c5cfb→#22d3ee` | Logo、图标徽章、强调元素 |
| `bg` | `#f5f6fb` | 应用背景 |
| `surface` / `border` | `#ffffff` / `#eef1f6` | 卡片面与描边 |
| `siderBg` | `#0b1020` | 深空蓝侧边栏 |
| `success/warning/danger` | `#10b981/#f59e0b/#ef4444` | 语义状态 |

### 1.2 复用组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `LogoMark` / `Logo` | `components/Logo.tsx` | 品牌标识（徽标 + 渐变文字 + 副标） |
| `PageHeader` | `components/PageHeader.tsx` | 统一页面头部（图标徽章/标题/副标题/操作区） |
| `cardStyle` | `theme.ts` | 统一卡片样式（圆角 12 / 细描边 / 轻阴影） |

### 1.3 全局样式（`index.css`）

- 字体平滑、`PingFang SC`/`Microsoft YaHei` 中文回退、选区配色。
- 精致滚动条（8px、内缩圆角）。
- 动效工具类：`.mrd-fade-up`（进场上浮）、`.mrd-hover-card`（悬浮微抬升）。
- 侧栏选中项左侧渐变指示条 `.mrd-sider`。

---

## 二、现状分析（v3.0 基线）

### 已实现功能

| 模块 | 已有能力 | 待补强 |
|------|----------|--------|
| 资产管理 (CMDB) | CRUD、搜索/过滤、标签、端口 Tag 展示、关联凭据、详情抽屉、在线探测、连接终端 | 批量操作、变更历史、资产去重合并 |
| 凭据管理 Vault | SSH 密码/密钥/Telnet CRUD | 连通性测试、加密存储 |
| 自动发现 | CIDR 扫描、端口识别、停止、历史日志轮询 | 实时进度推送(SSE)、定时调度、发现后自动合并 |
| WebSSH 终端 | xterm.js + WebSocket + SSH 代理 + 凭据交互 + 重连 | Telnet 通道、会话录制 |
| 控制台 | 统计卡片、存活率环图、活动时间线、5s 轮询、快速开始 | 趋势图、类型分布饼图、运行中任务实时进度 |
| 导航与品牌 | **可折叠分组侧栏、统一头部、Meridian 品牌、设计令牌** | 用户/权限区、全局搜索(Cmd+K)、暗色模式 |

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.24 · Gin · GORM · SQLite · gorilla/websocket · golang.org/x/crypto/ssh |
| 前端 | React 18 · TypeScript · Ant Design 5 · xterm.js · Vite 8 · react-router-dom v7 |

---

## 三、数据模型

| 模型 | 表 | 关键字段 | 状态 |
|------|----|----------|------|
| Asset | assets | id, name, ip, type, status, vendor, os_version, ports, tags, description, credential_id, last_scanned_at | ✅ |
| Credential | credentials | id, name, type, username, password, private_key | ✅ |
| ScanTask | scan_tasks | id, name, target_range, ports, schedule, status, last_run_at | ✅（schedule 预留） |
| ScanLog | scan_logs | id, task_id, status, started_at, finished_at, summary, detail | ✅ |
| ActivityLog | activity_logs | id, type, message, ref_id, created_at | ✅ |
| SystemSetting | system_settings | key, value | 🔜 Phase 3 |

---

## 四、接口清单

### 已实现

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/dashboard/stats` | 仪表盘统计 |
| GET/POST | `/api/credentials` | 凭据列表/创建 |
| PUT/DELETE | `/api/credentials/:id` | 更新/删除凭据 |
| GET/POST | `/api/assets` | 资产列表/创建 |
| GET/PUT/DELETE | `/api/assets/:id` | 资产详情/更新/删除 |
| POST | `/api/assets/:id/ping` | 单资产 TCP 在线探测 |
| GET | `/api/activity/recent` | 最近操作活动日志 |
| GET/POST | `/api/tasks` | 扫描任务列表/创建 |
| PUT/DELETE | `/api/tasks/:id` | 更新/删除任务 |
| POST | `/api/tasks/:id/run` · `/stop` | 启动/停止扫描 |
| GET | `/api/tasks/:id/logs` | 任务日志 |
| WS | `/api/ws/terminal/:id` | WebSSH 终端 |

### 待实现

| 阶段 | 方法 | 路径 | 功能 |
|------|------|------|------|
| P2 | GET | `/api/tasks/:id/stream` | SSE 实时扫描进度流 |
| P2 | POST | `/api/credentials/:id/test` | 凭据连通性测试 |
| P3 | GET/PUT | `/api/settings` | 系统配置读写 |

---

## 五、实施分期计划

### Phase 1：品牌重塑 · 界面重构 · 核心增强 ✅ 已完成

- [x] 重命名 **AssetManager → Meridian · 子午**，全站文案/标题/favicon 更新
- [x] 设计并落地品牌 Logo（`LogoMark`/`Logo` 组件 + favicon.svg）
- [x] 建立集中式设计令牌 `theme.ts`（色板 + Antd 主题 + cardStyle）
- [x] 侧边栏重构：可折叠、分组导航、品牌辉光、底部服务状态/版本/源码
- [x] 抽取统一 `PageHeader`，五个页面头部风格归一
- [x] 控制台重做：渐变统计卡 + 悬浮抬升 + 可点击快速开始 + 进场动效
- [x] 资产/凭据/扫描/设置页接入新令牌与组件
- [x] 终端页品牌化（标识 + Meridian 远程终端）
- [x] 后端：Asset.Tags、ScanTask.Schedule、ActivityLog 模型 + PingAsset/GetRecentActivity
- [x] 构建验证：`tsc -b && vite build` 通过

### Phase 2：发现能力 · 可视化增强（预计 2–3 天）

**后端**
- [ ] `GET /api/tasks/:id/stream` SSE 推送，扫描引擎每发现一个 IP 即时通知
- [ ] 资产写入去重合并（按 IP 更新端口/状态/厂商）
- [ ] `SystemSetting` 模型与迁移

**前端**
- [ ] 扫描日志弹窗改为 SSE 实时追加（替代 2s 轮询）
- [ ] 控制台新增「资产类型分布」饼图与「运行中任务实时进度」
- [ ] 资产标签的就地增删编辑

### Phase 3：安全性 · 高级终端（预计 3–4 天）

**后端**
- [ ] `POST /api/credentials/:id/test` 凭据连通性测试
- [ ] `GET/PUT /api/settings` 系统配置持久化
- [ ] sshproxy 增加 Telnet 通道支持

**前端**
- [ ] 设置页接入真实配置读写（并发度、超时）
- [ ] 凭据加密存储提示 + 测试连接按钮
- [ ] 资产抽屉内嵌小终端 `EmbeddedTerminal`
- [ ] 全局搜索 `GlobalSearch`（Cmd/Ctrl + K）
- [ ] 可选：暗色模式（设计令牌已为切换预留）

---

## 六、验证计划

```bash
# 后端
cd backend && go build ./...
# 前端（类型检查 + 打包）
cd frontend && npm run build
```

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| 品牌一致性 | 浏览全站 + 标签页标题 | 处处为 Meridian，favicon 为新标识 |
| 侧栏折叠 | 点击折叠按钮 | 宽度平滑切换，内容区联动，仅图标可达 |
| 头部统一 | 切换五个页面 | 头部图标徽章/标题/副标题风格一致 |
| 控制台动效 | 进入控制台 | 卡片进场上浮，悬浮微抬升，快速开始可点击跳转 |
| 在线探测 | 点击资产「在线探测」 | 3s 内状态更新 |
| 终端稳定性 | 连开 5 个资产终端 | 无 WebSocket 异常断开 |
| 构建 | `npm run build` | tsc + vite 均通过 |

---

## 七、目录结构（v3.0）

```
Meridian/
├── backend/
│   ├── cmd/server/main.go
│   └── internal/{model,store,handler,scanner,sshproxy}
├── frontend/
│   ├── public/favicon.svg              # 新品牌标识
│   └── src/
│       ├── theme.ts                    # 设计令牌（品牌/色板/Antd 主题）
│       ├── App.tsx                     # 可折叠分组侧栏 + 品牌
│       ├── index.css                   # 全局样式与动效工具类
│       ├── components/
│       │   ├── Logo.tsx                # LogoMark / Logo
│       │   └── PageHeader.tsx          # 统一页面头部
│       ├── pages/{Dashboard,Assets,ScanTasks,Credentials,Settings,TerminalPage}.tsx
│       └── services/api.ts
└── docs/{architecture.md, api_spec.md, design_plan.md}
```
