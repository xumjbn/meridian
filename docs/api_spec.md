# Meridian 接口定义文档 (API Specification)

> 产品：Meridian · 子午 — 网络资产发现与统一接入平台 · 文档版本 v4.0（2026-06-18）

本文档定义了前后端交互的 RESTful API 接口和 WebSocket 终端协议。所有列出的接口均已实现。

所有 REST API 请求与响应的主体均为 JSON 格式，且响应包含统一的 JSON 结构：
```json
{
  "code": 200,      // 200 为成功，其他为对应错误码
  "message": "msg", // 提示信息
  "data": {}        // 具体返回的数据对象/数组
}
```

---

## 1. 仪表盘相关接口 (Dashboard)

### 1.1 获取系统统计数据
- **请求方式**：`GET`
- **请求路径**：`/api/dashboard/stats`
- **响应数据** (`data`)：
```json
{
  "total_assets": 120,
  "servers": 45,
  "switches": 35,
  "routers": 20,
  "other": 20,
  "online_assets": 98,
  "offline_assets": 22,
  "running_tasks": 1
}
```

---

## 2. 凭据管理接口 (Credentials)

### 2.1 获取凭据列表
- **请求方式**：`GET`
- **请求路径**：`/api/credentials`
- **响应数据** (`data`)：
```json
[
  {
    "id": 1,
    "name": "默认 Linux Root 账号",
    "type": "ssh_password", // ssh_password | ssh_key | telnet
    "username": "root",
    "password": "my-secret-password",
    "private_key": "",
    "created_at": "2026-06-17T12:00:00Z"
  }
]
```

### 2.2 创建凭据
- **请求方式**：`POST`
- **请求路径**：`/api/credentials`
- **请求体**：
```json
{
  "name": "默认 Linux Root 账号",
  "type": "ssh_password",
  "username": "root",
  "password": "my-secret-password",
  "private_key": ""
}
```

### 2.3 更新凭据
- **请求方式**：`PUT`
- **请求路径**：`/api/credentials/:id`
- **请求体**：同创建凭据（只传递需要更新的字段即可，部分更新）

### 2.4 删除凭据
- **请求方式**：`DELETE`
- **请求路径**：`/api/credentials/:id`

---

## 3. 资产管理接口 (Assets)

### 3.1 获取资产列表
- **请求方式**：`GET`
- **请求路径**：`/api/assets`
- **查询参数** (可选)：
  - `q`: 搜索关键字 (匹配 IP/名称)
  - `type`: 资产类型过滤 (`server` | `switch` | `router` | `other`)
  - `status`: 状态过滤 (`online` | `offline` | `unknown`)
- **响应数据** (`data`)：
```json
[
  {
    "id": 101,
    "name": "Web-Server-01",
    "ip": "192.168.1.50",
    "type": "server",
    "status": "online",
    "vendor": "Ubuntu",
    "os_version": "Linux 5.15.0-91-generic",
    "arch": "x86_64",                  // 认证采集得到：x86_64 / aarch64 ...
    "virtualization": "kvm",           // 认证采集得到：physical/vmware/kvm/hyper-v/xen/qemu/aws/gcp/aliyun/openstack/container:* ...
    "ports": "[22, 80, 443]",          // 字符串化 JSON 数组
    "tags": "[\"生产\",\"DMZ\"]",      // 字符串化 JSON 数组
    "description": "生产 Web 主机 1",
    "credential_id": 1,
    "last_scanned_at": "2026-06-17T14:30:00Z",
    "created_at": "2026-06-17T10:00:00Z"
  }
]
```

### 3.2 手动创建资产
- **请求方式**：`POST`
- **请求路径**：`/api/assets`
- **请求体**：
```json
{
  "name": "手动服务器",
  "ip": "192.168.1.60",
  "type": "server",
  "description": "手动录入",
  "credential_id": 1
}
```

### 3.3 修改资产
- **请求方式**：`PUT`
- **请求路径**：`/api/assets/:id`
- **请求体**：同创建资产

### 3.4 删除资产
- **请求方式**：`DELETE`
- **请求路径**：`/api/assets/:id`

---

## 4. 自动发现扫描接口 (Scan Tasks)

### 4.1 获取扫描任务列表
- **请求方式**：`GET`
- **请求路径**：`/api/tasks`
- **响应数据** (`data`)：
```json
[
  {
    "id": 1,
    "name": "局域网段扫描",
    "target_range": "192.168.1.1-192.168.1.254", // 支持 CIDR: 192.168.1.0/24
    "ports": "22,23,80,443",
    "kind": "discovery",     // discovery（端口发现） | vuln（nuclei 漏扫）
    "schedule": "@every 1h", // 定时计划：""（仅手动） | "@every 15m" | "daily:HH:MM"
    "status": "idle",        // idle | running | completed | failed
    "last_run_at": "2026-06-17T15:00:00Z",
    "created_at": "2026-06-17T09:00:00Z"
  }
]
```

### 4.2 创建扫描任务
- **请求方式**：`POST`
- **请求路径**：`/api/tasks`
- **请求体**：
```json
{
  "name": "办公网扫描",
  "target_range": "192.168.2.0/24",
  "ports": "22,80,443"
}
```

### 4.3 修改扫描任务
- **请求方式**：`PUT`
- **请求路径**：`/api/tasks/:id`

### 4.4 删除扫描任务
- **请求方式**：`DELETE`
- **请求路径**：`/api/tasks/:id`

### 4.5 启动扫描任务 (异步)
- **请求方式**：`POST`
- **请求路径**：`/api/tasks/:id/run`
- **说明**：立即开始后台扫描任务。接口会立即返回 200 成功，后台通过 goroutine 执行。

### 4.6 获取任务执行日志列表
- **请求方式**：`GET`
- **请求路径**：`/api/tasks/:id/logs`
- **响应数据** (`data`)：
```json
[
  {
    "id": 50,
    "task_id": 1,
    "status": "success", // success | failed
    "started_at": "2026-06-17T15:00:00Z",
    "finished_at": "2026-06-17T15:02:15Z",
    "summary": "扫描完成。检测 IP 数：254，存活主机数：12，新增资产数：3"
  }
]
```

---

## 5. WebSSH WebSocket 协议

### 5.1 建立连接
- **WebSocket 路径**：`ws://<host>:<port>/api/ws/terminal/:asset_id`
- **鉴权**：可以通过 Query 参数传递 Token，本系统首版先不开启 Token 强制鉴权。

### 5.2 数据传输协议（双向 JSON / Binary）
建立 WebSocket 连接后，分为以下几种消息交互类型。

#### 1. 后端索要临时凭据 (Auth Request)
若资产在 CMDB 中未绑定任何 Credential，后端连接 SSH 前会通过 WebSocket 发送请求：
- **后端 -> 前端 (JSON)**:
```json
{
  "type": "auth_request",
  "message": "此资产未关联有效凭证，请输入登录信息"
}
```
- **前端 -> 后端 (JSON)**:
```json
{
  "type": "auth_response",
  "username": "root",
  "password": "user-input-password"
}
```

#### 2. 终端数据传输 (Terminal Data)
一旦 SSH 握手成功并建立 session，后续数据均为交互字符：
- **前端 -> 后端 (二进制/字符串)**：键盘输入序列（如字符 `l`, `s`, `\n`，或快捷键转义序列）。
- **后端 -> 前端 (二进制/字符串)**：目标机器的 Stdout 输出，前端收到后直接调用 `xterm.write()` 渲染。

#### 3. 窗口调整大小控制 (Resize Event)
- **前端 -> 后端 (JSON)**：当浏览器调整终端大小时发送。
```json
{
  "type": "resize",
  "cols": 120,
  "rows": 35
}
```

#### 4. 异常与关闭 (Error/Close)
- 后端关闭连接或 SSH 断开时，直接关闭 WebSocket 连接，前端应捕获 close 事件，在界面上展示“会话已断开”。

---

## 6. 资产在线探测接口 (Ping)

### 6.1 单资产 TCP 在线探测
- **请求方式**：`POST`
- **请求路径**：`/api/assets/:id/ping`
- **说明**：对指定资产依次探测常见端口（22、23、80、443、8080、3389），只要有一个端口响应即判定为在线，并自动更新数据库中的 `status` 和 `last_scanned_at` 字段。
- **响应数据** (`data`)：
```json
{
  "ip": "192.168.1.50",
  "status": "online"   // "online" 或 "offline"
}
```

---

## 7. 活动日志接口 (Activity)

### 7.1 获取最近操作日志
- **请求方式**：`GET`
- **请求路径**：`/api/activity/recent`
- **说明**：返回最近 20 条系统操作记录，按时间倒序排列。
- **响应数据** (`data`)：
```json
[
  {
    "id": 42,
    "type": "asset_created",
    "message": "资产 Web-Server-01 (192.168.1.50) 已创建",
    "ref_id": 17,
    "created_at": "2026-06-17T18:00:00Z"
  },
  {
    "id": 41,
    "type": "scan_started",
    "message": "扫描任务「局域网段扫描」已启动，目标网段: 192.168.1.0/24",
    "ref_id": 3,
    "created_at": "2026-06-17T17:55:00Z"
  }
]
```

**活动类型枚举（`type` 字段）：**

| 类型值 | 触发时机 |
|--------|----------|
| `asset_created` | 创建新资产时 |
| `asset_updated` | 更新资产信息时 |
| `asset_deleted` | 删除资产时 |
| `scan_started` | 启动扫描任务时 |
| `scan_completed` | 扫描任务完成时 |
| `scan_failed` | 扫描任务失败时 |

---

## 8. 认证采集与变更历史 (Collect / History)

### 8.1 认证采集（架构 / 虚拟化 / 内核）
- **请求方式**：`POST`
- **请求路径**：`/api/assets/:id/collect`
- **说明**：对**已绑定 SSH 凭据**的资产建立会话，执行 `uname -m; uname -sr` 取架构/内核，并以 `systemd-detect-virt`（回退 `/proc/cpuinfo` hypervisor 位 + DMI `product_name`）判定虚拟化；结果写入 `arch` / `virtualization` / `os_version`。Telnet 凭据不支持采集。
- **响应数据** (`data`)：
```json
{
  "ok": true,
  "arch": "aarch64",
  "os": "Linux 4.19.90-25.10.v2101.ky10.aarch64",
  "virtualization": "kvm",
  "message": "采集成功: aarch64 / Linux 4.19.90... / kvm"
}
```

### 8.2 资产字段变更历史
- **请求方式**：`GET`
- **请求路径**：`/api/assets/:id/history`
- **说明**：返回该资产最近 100 条字段级变更（名称/IP/类型/状态/描述/标签/凭据等），按时间倒序。
- **响应数据** (`data`)：`[{ "id", "asset_id", "field", "old_value", "new_value", "created_at" }]`

---

## 9. 凭据连通性测试 (Test)

- **请求方式**：`POST`
- **请求路径**：`/api/credentials/:id/test`
- **请求体**：`{ "host": "192.168.1.10", "port": 0 }`（`port` 传 0 时按凭据类型取默认：SSH 22 / Telnet 23）
- **说明**：用指定凭据对目标主机发起连接测试（Telnet 仅校验端口连通）。
- **响应数据** (`data`)：`{ "ok": true, "message": "连接成功，凭据有效 ✓" }`

---

## 10. 系统设置 (Settings)

### 10.1 读取
- **请求方式**：`GET` · **路径**：`/api/settings`
- **响应数据** (`data`)：`key -> value` 映射，如：
```json
{ "scan_concurrency": "100", "scan_timeout": "2", "ssh_timeout": "10", "auth_username": "admin", "auth_password": "admin" }
```

### 10.2 更新（upsert）
- **请求方式**：`PUT` · **路径**：`/api/settings`
- **请求体**：`{ "scan_concurrency": "200", "scan_timeout": "3" }`（只传需更新的键）
- **响应数据** (`data`)：`{ "updated": 2 }`

---

## 11. 扫描进度 SSE 流 (Stream)

- **请求方式**：`GET` · **路径**：`/api/tasks/:id/stream`
- **说明**：`text/event-stream` 单向推流。服务端每秒轮询该任务最新一条 `ScanLog`，增量推送新控制台行与状态；前端用 `EventSource` 实时追加。
- **事件格式**：
```
data: [14:30:05] 发现存活设备: 192.168.1.50 | 类型: server ...   # 默认 message 事件 = 每行控制台输出

event: status
data: running

event: done
data: 扫描完成。总IP数: 254，存活主机数: 12，新增资产: 3 ...        # 结束后服务端关闭连接
```

---

## 12. 漏洞发现 (Vulnerabilities)

- **请求方式**：`GET` · **路径**：`/api/vulns`（可选 `?asset_id=101` 过滤）
- **说明**：返回 nuclei 漏扫结果（最多 500 条，倒序）。
- **响应数据** (`data`)：
```json
[
  { "id": 1, "asset_id": 101, "target": "192.168.1.50:80", "template_id": "CVE-2021-XXXX",
    "name": "示例漏洞", "severity": "high", "matched_at": "http://192.168.1.50/...", "engine": "nuclei", "created_at": "2026-06-18T10:00:00Z" }
]
```

---

## 13. 登录 (Login)

- **请求方式**：`POST` · **路径**：`/api/login`
- **请求体**：`{ "username": "admin", "password": "admin" }`（默认 admin/admin，可在 `system_settings` 改）
- **成功响应** (`data`)：`{ "ok": true, "token": "meridian-session", "username": "admin" }`
- **失败**：`code` 为 `401`，`message` 为「用户名或密码错误」。
- **说明**：当前 token 为占位，受保护路由暂未做服务端校验，鉴权由前端门禁实现（详见架构文档第 4 节「有意延后的设计取舍」）。

---

## 14. 其它已实现接口

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/assets/:id/ping` | 单资产 TCP 在线探测（见第 6 节） |
| GET | `/api/activity/recent` | 最近操作活动（见第 7 节） |
| WS | `/api/ws/terminal/:id` | WebSSH / Telnet 终端（见第 5 节，按凭据类型选择 SSH 或 Telnet 代理） |
