# AssetManager — 详细设计与功能完善计划

> **文档版本**: v2.0  
> **更新时间**: 2026-06-17  
> **状态**: 执行中（Phase 1 进行中）

---

## 一、现状分析

### 已实现功能

| 模块 | 已有功能 | 缺失/不足 |
|------|----------|-----------|
| 资产管理 (CMDB) | CRUD、搜索、过滤、关联凭据、连接终端 | 无批量操作、无资产标签、无变更历史、详情抽屉信息不完整 |
| 凭据管理 | SSH密码/密钥/Telnet CRUD | 无连通性测试、密码明文存储无警告 |
| 自动发现扫描 | CIDR扫描、端口识别、停止、日志 | 无实时进度推送、无定时调度、发现后无自动去重合并 |
| WebSSH 终端 | xterm.js + WebSocket + SSH代理 | React StrictMode 双挂载竞态导致不稳定、无 Telnet 支持 |
| Dashboard | 统计卡片、在线率环形图 | 无图表趋势、无最近活动时间线、数据静态无实时轮询 |
| 导航侧边栏 | 深色 Obsidian 主题 | 无路由、无用户信息区域、无折叠状态记忆 |

### 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Go 1.24 · Gin · GORM · SQLite · gorilla/websocket · golang.org/x/crypto/ssh |
| 前端 | React 18 · TypeScript · Ant Design 5 · xterm.js · Vite 8 · react-router-dom v6 |

---

## 二、数据模型设计

### 2.1 现有模型变更

**Asset 新增字段：**

```go
Tags string `gorm:"type:text" json:"tags"` // JSON 字符串数组，如 ["生产", "DMZ"]
```

**ScanTask 新增字段：**

```go
Schedule string `gorm:"size:50" json:"schedule"` // 可选 Cron 表达式，如 "0 2 * * *"
```

### 2.2 新增模型

**ActivityLog（操作活动日志）：**

```go
type ActivityLog struct {
    ID        uint      `gorm:"primaryKey" json:"id"`
    Type      string    `gorm:"size:50;not null" json:"type"`
    // 类型枚举: asset_created | asset_updated | asset_deleted
    //          scan_started | scan_completed | scan_failed
    Message   string    `gorm:"type:text" json:"message"`
    RefID     uint      `json:"ref_id"` // 关联资产或任务 ID
    CreatedAt time.Time `json:"created_at"`
}
```

**SystemSetting（系统配置，Phase 3）：**

```go
type SystemSetting struct {
    Key   string `gorm:"primaryKey;size:100" json:"key"`
    Value string `gorm:"type:text" json:"value"`
}
```

---

## 三、后端接口扩充

### 3.1 已有接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/dashboard/stats` | 获取仪表盘统计数据 |
| GET/POST | `/api/credentials` | 凭据列表/创建 |
| PUT/DELETE | `/api/credentials/:id` | 更新/删除凭据 |
| GET/POST | `/api/assets` | 资产列表/创建 |
| GET/PUT/DELETE | `/api/assets/:id` | 资产详情/更新/删除 |
| GET/POST | `/api/tasks` | 扫描任务列表/创建 |
| PUT/DELETE | `/api/tasks/:id` | 更新/删除任务 |
| POST | `/api/tasks/:id/run` | 启动扫描任务 |
| POST | `/api/tasks/:id/stop` | 停止扫描任务 |
| GET | `/api/tasks/:id/logs` | 获取任务日志列表 |
| WS | `/api/ws/terminal/:id` | WebSSH 终端连接 |

### 3.2 Phase 1 新增接口

| 方法 | 路径 | 功能 | 状态 |
|------|------|------|------|
| POST | `/api/assets/:id/ping` | 单资产 TCP 在线探测，更新状态 | ✅ 已实现 |
| GET | `/api/activity/recent` | 最近 20 条操作活动日志 | ✅ 已实现 |

**PingAsset 响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": { "ip": "192.168.1.50", "status": "online" }
}
```

**GetRecentActivity 响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "id": 42,
      "type": "asset_created",
      "message": "资产 Web-Server-01 (192.168.1.50) 已创建",
      "ref_id": 17,
      "created_at": "2026-06-17T18:00:00Z"
    }
  ]
}
```

### 3.3 Phase 2 新增接口（待实现）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/tasks/:id/stream` | SSE 实时扫描进度流 |
| GET | `/api/tasks/:id/progress` | 扫描进度轮询备选方案 |
| POST | `/api/credentials/:id/test` | 用指定凭据测试连接至资产 |

### 3.4 Phase 3 新增接口（待实现）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/settings` | 读取系统配置 |
| PUT | `/api/settings/:key` | 更新系统配置项 |

---

## 四、前端页面与组件设计

### 4.1 路由规划（react-router-dom v6）

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | `Dashboard` | 控制台首页（重定向至此） |
| `/assets` | `Assets` | 资产管理 (CMDB) |
| `/tasks` | `ScanTasks` | 自动发现扫描任务 |
| `/credentials` | `Credentials` | 凭据管理 Vault |
| `/settings` | `Settings` | 系统设置（Phase 1 骨架） |
| `/terminal/:id` | `TerminalPage` | 独立标签页 WebSSH 终端 |

### 4.2 Dashboard 增强设计

```
┌────────────────────────────────────────────────────────────┐
│  Header: 控制台首页  [正在扫描... 旋转指示]  [刷新按钮]      │
├────────────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                       │
│ │总资产│ │服务器│ │交换机│ │路由器│  ← 统计卡片（5s 轮询）  │
│ └──────┘ └──────┘ └──────┘ └──────┘                       │
├─────────────────────────┬──────────────────────────────────┤
│  资产在线率环形图 (已有)  │  最近活动时间线 (新)              │
│                         │  · 18:00 资产 Web-01 已创建      │
│    ◎  78%               │  · 17:55 扫描任务「局域网」已启动  │
│    在线比例              │  · 17:40 资产 SW-02 信息已更新   │
│                         │  · 17:30 扫描完成，发现 12 台    │
├─────────────────────────┴──────────────────────────────────┤
│  新手指南 (已有)                                            │
└────────────────────────────────────────────────────────────┘
```

### 4.3 资产管理增强设计

**资产列表表格新增列：**
- `tags` 字段：以 `<Tag>` 组件展示，颜色随机（已持久化）
- `ports` 字段：从 JSON 字符串解析后，以端口号 Tag 形式展示（修复现有 raw string 问题）
- 操作列新增：**探测** 按钮（调用 POST /api/assets/:id/ping，即时反馈）

**资产详情抽屉（完善）：**

```
┌─────────────────────────────────┐
│ ● Web-Server-01   [编辑] [删除] │
│   192.168.1.50                  │
│   状态: ● 在线   类型: 服务器    │
├─────────────────────────────────┤
│ 标签  [生产] [DMZ]              │
│ 厂商  Ubuntu / Linux            │
│ 系统  Ubuntu 20.04.1 LTS       │
│ 端口  [22] [80] [443]           │
│ 凭据  默认Linux Root账号         │
│ 描述  生产 Web 主机 1            │
│ 扫描  2026-06-17 18:00:00       │
├─────────────────────────────────┤
│ [连接终端]  [探测在线状态]        │
└─────────────────────────────────┘
```

### 4.4 系统设置页（Settings）骨架

```
┌──────────────────────────────────────────────┐
│ Header: 系统设置                              │
├──────────────────────────────────────────────┤
│ 扫描引擎配置                                  │
│   并发连接数  [──────●──────] 100             │
│   端口超时    [──●──────────] 2s              │
│                                              │
│ 关于                                          │
│   版本  v1.0.0                               │
│   GitHub  github.com/.../AssetManager        │
└──────────────────────────────────────────────┘
```

### 4.5 新增组件清单

| 文件 | 功能 | 优先级 |
|------|------|--------|
| `src/pages/Settings.tsx` | 系统设置页面 | Phase 1 |
| `src/components/ActivityTimeline.tsx` | Dashboard 最近活动时间线 | Phase 1 |
| `src/components/AssetDetailDrawer.tsx` | 资产详情完整抽屉 | Phase 1 |
| `src/components/ScanProgress.tsx` | 扫描实时进度条 | Phase 2 |
| `src/components/AssetPieChart.tsx` | 资产类型分布图 | Phase 2 |
| `src/components/EmbeddedTerminal.tsx` | 内嵌小终端（抽屉内） | Phase 3 |
| `src/components/GlobalSearch.tsx` | Command+K 全局搜索 | Phase 3 |

---

## 五、实施分期计划

### Phase 1：基础稳定 & 核心增强

**目标**：解决已有 Bug，完成高频使用功能。预计工作量：1–2 天。

**后端任务：**
- [x] `model/models.go` — Asset 新增 `Tags`，ScanTask 新增 `Schedule`，新增 `ActivityLog` 模型
- [x] `store/db.go` — AutoMigrate 添加 ActivityLog
- [x] `handler/handlers.go` — 新增 `PingAsset` 处理器
- [x] `handler/handlers.go` — 新增 `GetRecentActivity` 处理器
- [x] `handler/handlers.go` — 资产增删改时写入 ActivityLog
- [x] `handler/handlers.go` — 扫描任务启动时写入 ActivityLog
- [x] `main.go` — 注册新路由 `/api/assets/:id/ping`、`/api/activity/recent`
- [ ] `go build` 编译验证

**前端任务：**
- [ ] 安装 `react-router-dom`，路由化所有页面（`App.tsx` 重构）
- [ ] `api.ts` — 新增 `pingAsset()`、`getRecentActivity()` 接口函数
- [ ] `Dashboard.tsx` — 5秒自动轮询 + 最近活动时间线组件
- [ ] `Assets.tsx` — 端口字段 JSON 解析展示、探测按钮、完善详情抽屉
- [ ] `Settings.tsx` — 新建设置页（骨架级别）
- [ ] `npm run build` 编译验证

### Phase 2：发现能力 & 可视化增强

**目标**：扫描体验更专业，数据更直观。预计工作量：2–3 天。

**后端任务：**
- [ ] `handler/handlers.go` — 新增 `GET /api/tasks/:id/stream` SSE 推送接口
- [ ] `scanner/scanner.go` — 扫描引擎写入 SSE Channel（每发现一个 IP 通知一次）
- [ ] `model/models.go` — 新增 `SystemSetting` 模型
- [ ] 资产写入时去重合并逻辑（更新已有 IP 的端口/状态/厂商）

**前端任务：**
- [ ] `ScanTasks.tsx` — 日志弹窗实时 SSE 追加流
- [ ] `Dashboard.tsx` — 资产类型分布饼图组件
- [ ] `Dashboard.tsx` — 运行中扫描任务实时进度展示
- [ ] `Assets.tsx` — Tags 增删编辑功能

### Phase 3：安全性 & 高级终端

**目标**：补完边缘功能，提升专业度。预计工作量：3–4 天。

**后端任务：**
- [ ] `handler/handlers.go` — `POST /api/credentials/:id/test` 凭据测试
- [ ] `handler/handlers.go` — `GET/PUT /api/settings` 系统配置
- [ ] `sshproxy/sshproxy.go` — Telnet 协议支持

**前端任务：**
- [ ] `Settings.tsx` — 完整系统设置页（并发度、超时调节）
- [ ] `Credentials.tsx` — 密码存储安全警示 + 测试连接按钮
- [ ] `components/EmbeddedTerminal.tsx` — 资产抽屉内嵌小终端
- [ ] `components/GlobalSearch.tsx` — Command+K 全局搜索

---

## 六、验证计划

### 自动化验证

```bash
# 后端编译验证
cd backend && go build ./...

# 前端类型检查 + 打包验证
cd frontend && npm run build
```

### 手动验证检查点

| 检查项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| 路由跳转 | 直接访问 `/assets` URL 后刷新浏览器 | 页面保持在资产管理页 |
| 活动时间线 | 创建/删除一个资产后查看 Dashboard | 时间线出现对应活动记录 |
| 在线探测 | 点击资产的"探测"按钮 | 3 秒内状态更新（在线/离线） |
| 端口展示 | 查看资产列表的端口列 | 以 Tag 组件展示，不再是原始字符串 |
| Dashboard 轮询 | 启动一个扫描任务，不刷新页面 | 5 秒内 Dashboard 统计数据自动更新 |
| 终端稳定性 | 连续打开 5 个资产终端 | 无一出现"WebSocket 连接异常断开" |
| 扫描进度（Phase 2） | 启动扫描，观察日志弹窗 | 每发现一个 IP 实时追加，不用等结束 |

---

## 七、目录结构（预期完成后）

```
AssetManager/
├── backend/
│   ├── cmd/server/main.go              # 路由注册
│   └── internal/
│       ├── model/models.go             # Asset(+Tags), ScanTask(+Schedule), ActivityLog
│       ├── store/db.go                 # AutoMigrate 含 ActivityLog
│       ├── handler/handlers.go         # +PingAsset, +GetRecentActivity, +ActivityLog writes
│       ├── scanner/scanner.go          # Phase2: SSE channel 通知
│       └── sshproxy/sshproxy.go        # Phase3: Telnet 支持
├── frontend/
│   └── src/
│       ├── App.tsx                     # react-router-dom 路由
│       ├── pages/
│       │   ├── Dashboard.tsx           # +轮询, +活动时间线
│       │   ├── Assets.tsx              # +探测按钮, +端口Tag, +Tags字段
│       │   ├── ScanTasks.tsx           # Phase2: SSE追加日志
│       │   ├── Credentials.tsx         # Phase3: 测试连接
│       │   └── Settings.tsx            # 新建: 系统设置
│       ├── components/
│       │   ├── ActivityTimeline.tsx    # 活动时间线组件
│       │   ├── AssetDetailDrawer.tsx   # 完整资产详情抽屉
│       │   ├── ScanProgress.tsx        # Phase2: 扫描进度
│       │   ├── AssetPieChart.tsx       # Phase2: 饼图
│       │   ├── EmbeddedTerminal.tsx    # Phase3: 内嵌终端
│       │   └── GlobalSearch.tsx        # Phase3: 全局搜索
│       └── services/api.ts             # +pingAsset, +getRecentActivity
└── docs/
    ├── architecture.md                 # 架构设计文档
    ├── api_spec.md                     # API 接口定义
    └── design_plan.md                  # 本文件：详细设计与功能完善计划
```
