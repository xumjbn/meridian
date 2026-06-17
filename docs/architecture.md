# 资产管理系统 架构设计文档 (Architecture Design)

本文档描述了资产管理系统的整体技术架构、模块职责、以及关键机制的实现逻辑。

---

## 1. 整体架构图

本系统采用经典的前后端分离架构，但整体作为单体（Monorepo）方式部署，依赖轻量级的 SQLite 存储数据，实现全栈自包含。

```mermaid
graph TD
    UserBrowser([用户浏览器 - React + Antd 5]) <-->|REST API / HTTP| GoBackend[Go 后端服务 - Gin]
    UserBrowser <-->|WebSocket| GoBackend
    
    subgraph GoBackend [Go 后端服务]
        APIHandler[API 控制器]
        ScannerEngine[并发扫描引擎]
        SSHProxy[SSH / Telnet 代理]
        GORM[GORM ORM 层]
    end
    
    GORM <--> DB[(SQLite 数据库 - assets.db)]
    ScannerEngine -->|TCP Dial / Ping| TargetNetwork[目标网络 IP & 端口]
    SSHProxy <-->|SSH Protocol| TargetHost[远程服务器 / 交换机 / 路由器]
```

---

## 2. 模块职责说明

### 2.1 前端 (Frontend)
- **UI 框架**：React 18 + TypeScript + Vite + Ant Design 5。
- **Dashboard**：显示当前资产的分类数据、在线率统计以及最近扫描任务的状态。
- **资产列表 (CMDB)**：提供资产的列表展示、详情抽屉、手动录入与修改，以及一键调起终端（WebSSH）。
- **任务管理**：配置扫描的 IP 网段和端口，手动启动扫描，查看扫描日志。
- **凭据保管箱**：集中录入并管理用于扫描与连接的账号密码或私钥。
- **网页终端 (WebSSH)**：集成 `xterm.js`，通过 WebSocket 与后端进行双向输入输出交互，支持终端自适应缩放（Resize）。

### 2.2 后端 (Backend)
- **Web 服务与 API**：Gin 框架负责路由分发、API 鉴权与业务接口。
- **扫描引擎 (Scanner Engine)**：
  - **网段解析**：将 IP 范围/掩码（如 `192.168.1.0/24` 或 `10.0.0.1-10.0.0.50`）转换为待扫描 of IP 列表。
  - **并发调度**：采用 Go Worker Pool 并发模型，控制最大并发连接数（如同时扫描 100 个 IP/端口），避免耗尽系统句柄。
  - **服务探测与类型判定**：通过 TCP 三次握手测试端口存活，并获取连接的初始 Banner（如 OpenSSH 标识、交换机登录 Banner 等），推断设备类型。
- **WebSSH 代理 (SSH Proxy)**：
  - 作为桥梁接收来自前端的 WebSocket 流量。
  - 利用 `golang.org/x/crypto/ssh` 建立到目标资产的真实 SSH 连接。
  - 启动远程 PTY 并建立双向管道。
  - 当资产没有绑定凭据时，在 WebSocket 连接建立之初交互式询问用户凭据。
- **数据持久化 (Store & ORM)**：使用 GORM 配合 SQLite 存储资产、凭据、任务和日志数据。

---

## 3. 核心流程设计

### 3.1 资产自动发现流程 (Auto-Discovery Flow)

```mermaid
sequenceDiagram
    participant Web as 前端
    participant App as 后端扫描器
    participant Host as 目标主机
    
    Web->>App: 触发扫描任务 (Task ID)
    activate App
    App->>App: 解析网段 IP 列表
    App->>App: 启动并发扫描协程池 (Worker Pool)
    
    par 对每个 IP
        App->>Host: 常用端口探测 (22, 23, 80, 443, 161)
        alt 端口开放 (如 22)
            Host-->>App: TCP 握手成功 & 返回 Banner (如 OpenSSH)
            App->>App: 指纹匹配，识别类型为 Server
        else 端口全部关闭
            App->>App: 标记主机为离线
        end
    end
    
    App->>App: 持久化发现的资产至 SQLite
    App->>App: 更新任务状态为已完成
    App-->>Web: 推送/通知扫描完成
    deactivate App
```

### 3.2 WebSSH 交互流程 (WebSSH Proxy Flow)

```mermaid
sequenceDiagram
    participant Web as 前端 (xterm.js)
    participant WS as WebSocket 链路
    participant App as 后端 SSH 代理
    participant Host as 目标主机 SSH 服务
    
    Web->>App: 发起 WS 连接 (携带 Asset ID)
    activate App
    
    alt 资产关联了凭据
        App->>App: 读取数据库中的明文密码/私钥
    else 资产无凭据
        App-->>Web: 发送凭据索要消息 (Auth Request)
        Web-->>App: 输入用户名/密码并发送 (Auth Response)
    end
    
    App->>Host: 建立 SSH TCP 连接与握手
    Host-->>App: 握手成功
    App->>Host: 请求伪终端 (pty-req, xterm) 和 Shell
    Host-->>App: 启动 Shell 成功
    
    loop 交互会话中
        Web->>WS: 发送键盘输入 (字符/控制序列)
        WS->>App: 转发输入
        App->>Host: 写入 SSH Stdin
        Host-->>App: 吐出命令行输出 (Stdout/Stderr)
        App->>WS: 转发输出
        WS->>Web: 渲染至屏幕
    end
    
    Web->>WS: 触发窗口变化事件 (cols, rows)
    WS->>App: 发送 resize 消息
    App->>Host: 调用 session.WindowChange
    
    Web->>WS: 主动断开 或 退出 Shell
    App->>Host: 关闭 SSH 通道
    App->>WS: 断开 WebSocket
    deactivate App
```

---

## 4. 安全性与容错考虑

1. **凭据安全**：本版本直接使用明文字符串保存密码与私钥。在生产环境中应引入 AES 对称加密存储，并使用 KMS 管理密钥。
2. **扫描并发控制**：网络扫描使用超时时间（如 2 秒超时），并对并发连接总数进行限制，防止在扫描大网段时引起系统 OOM 或进程句柄耗尽崩溃。
3. **WebSSH 异常处理**：若目标主机网络闪断或会话超时，后端将及时捕获异常并关闭 WebSocket，通知前端清空终端状态，防止孤儿 SSH 会话占用后端系统资源。

---

## 5. 数据模型总览（v2.0）

| 模型 | 表名 | 主要字段 | 版本 |
|------|------|----------|------|
| Asset | assets | id, name, ip, type, status, vendor, os_version, ports, **tags**, description, credential_id, last_scanned_at | v1 + v2新增 tags |
| Credential | credentials | id, name, type, username, password, private_key | v1 |
| ScanTask | scan_tasks | id, name, target_range, ports, **schedule**, status, last_run_at | v1 + v2新增 schedule |
| ScanLog | scan_logs | id, task_id, status, started_at, finished_at, summary, detail | v1 |
| ActivityLog | activity_logs | id, type, message, ref_id, created_at | **v2 新增** |
| SystemSetting | system_settings | key, value | **v3 计划** |

---

## 6. 前端路由规划（v2.0）

引入 `react-router-dom v6` 后，各页面映射到独立 URL，支持浏览器前进/后退和直接 URL 访问：

| URL 路径 | 组件 | 说明 |
|----------|------|------|
| `/` | `Dashboard` | 控制台首页 |
| `/assets` | `Assets` | 资产管理 (CMDB) |
| `/tasks` | `ScanTasks` | 自动发现扫描任务 |
| `/credentials` | `Credentials` | 凭据管理 Vault |
| `/settings` | `Settings` | 系统设置（Phase 1 骨架） |
| `/terminal/:id` | `TerminalPage` | 独立标签页 WebSSH 终端 |

---

## 7. Phase 2 架构扩展：SSE 实时推送

Phase 2 将在扫描引擎中引入 **Server-Sent Events (SSE)** 单向推流机制，替代前端轮询：

```mermaid
graph LR
    Scanner[扫描引擎 goroutine] -->|每发现一个IP| SseChan[(SSE Channel)]
    SseChan -->|推流| Frontend[前端 EventSource]
    Frontend -->|实时追加| LogModal[日志弹窗 实时渲染]
```

选用 SSE 而非 WebSocket 的原因：
- 扫描进度是**单向**服务端推流，不需要客户端回写
- SSE 自带**断线重连**机制，浏览器原生支持
- 实现更简单，不依赖 gorilla/websocket
