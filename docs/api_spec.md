# Meridian 接口定义文档 (API Specification)

> 产品：Meridian · 子午 — 网络资产发现与统一接入平台 · 文档版本 **v5.1**（2026-06-24）· 对应应用版本 **v0.33**

本文档定义前后端交互的 RESTful API、WebSocket 终端协议与 SSE 流。所有列出的接口均已实现。

## 0. 通用约定

- 请求/响应主体均为 JSON（文件上传/下载除外），统一响应结构：
```json
{ "code": 200, "message": "msg", "data": {} }   // code=200 成功；其它为错误码
```
- **鉴权**：除 `POST /api/login`、`POST /api/register` 外，所有接口需带会话令牌
  `Authorization: Bearer <token>`。浏览器无法为 **WebSocket / SSE / 下载链接** 设置请求头，故这些走查询参数 `?token=<token>`。
- **错误码**：`401` 未登录 / 令牌失效（前端清理本地会话并跳登录）；`403` 越权（非管理员访问管理员接口，或访问非本人归属的资产/凭据）；`404` 资源不存在。
- **多租户**：资产 / 凭据 / 终端 / SFTP / 在线探测 / 活动按 `owner_id` 隔离，普通用户仅能访问自己的数据；管理员可见全部。
- **管理员专属**（下文标注 🔒）：用户管理、审计、扫描任务、漏洞、系统设置、`ai/test`、`notify/test`。

---

## 1. 认证与会话 (Auth)

### 1.1 登录
- `POST /api/login` · 公开
- 请求体：`{ "username": "admin", "password": "admin" }`
- 成功 (`data`)：`{ "ok": true, "token": "<hex>", "username": "admin", "role": "admin", "must_change_password": true }`
- 说明：bcrypt 校验；**登录失败 5 次锁定 10 分钟**；默认 `admin/admin`，首次登录 `must_change_password=true` 需先改密；令牌默认有效期 7 天。失败返回 `code=401`。

### 1.2 注册（开放，需审批）
- `POST /api/register` · 公开
- 请求体：`{ "username": "alice", "password": "..." }`
- 成功 (`data`)：`{ "id": 5, "username": "alice" }`
- 说明：新用户 `role=user`、`status=pending`，**需管理员审批为 active 后方可登录**。

### 1.3 注销
- `POST /api/logout` → `{ "ok": true }`（使当前令牌失效）

### 1.4 修改本人密码
- `POST /api/users/change-password`
- 请求体：`{ "username": "admin", "old_password": "...", "new_password": "..." }`
- 成功：`{ "ok": true }`。说明：首登强制改密场景免校验旧密码；改密后吊销该用户全部旧会话。

---

## 2. 用户管理 (Users) 🔒

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/users` | 用户列表 |
| POST | `/api/users` | 新增用户 `{ username, password, role? }` → `{ id }` |
| PUT | `/api/users/:id` | 改角色/启禁用/重置密码 `{ role?, status?, password? }` |
| DELETE | `/api/users/:id` | 删除用户 |

用户对象：`{ id, username, role(admin|user), status(active|disabled|pending), must_change_password, last_login_at, last_login_ip, created_at }`。后端保护「最后一个管理员」不被删除/禁用。

---

## 3. 审计日志 (Audit) 🔒

- `GET /api/audit?actor=&action=&limit=` （limit 默认/上限见后端，约 200–1000）
- 响应：`[{ "id", "actor", "action": "POST|PUT|DELETE", "path", "status": 200, "ip", "created_at" }]`
- 说明：中间件记录所有写操作；SFTP / AI 另有细粒度审计。

---

## 4. 仪表盘 (Dashboard)

- `GET /api/dashboard/stats` → `{ total_assets, servers, switches, routers, other, online_assets, offline_assets, running_tasks }`（数据按当前用户归属统计）

---

## 5. 凭据管理 (Credentials)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/credentials` | 列表（按归属） |
| POST | `/api/credentials` | 创建 |
| PUT | `/api/credentials/:id` | 部分更新（归属校验） |
| DELETE | `/api/credentials/:id` | 删除（同时解除资产上的悬空引用） |
| POST | `/api/credentials/:id/test` | 连通性测试 |

凭据对象：`{ id, name, type: "ssh_password"|"ssh_key"|"telnet", username, password, private_key, created_at }`（password/private_key 明文存储）。

连通性测试：请求 `{ "host": "192.168.1.10", "port": 0 }`（port=0 时按类型默认 SSH 22 / Telnet 23），响应 `{ "ok": true, "message": "连接成功，凭据有效 ✓" }`。

---

## 6. 资产管理 (Assets)

### 6.1 列表 / CRUD
- `GET /api/assets?q=&type=&status=` → `Asset[]`
- `POST /api/assets`：创建，支持 IP 范围/CIDR 批量（如 `192.168.1.21-23`、`192.168.1.0/24`），自动归属当前用户。
- `GET /api/assets/:id` · `PUT /api/assets/:id`（记录字段级历史） · `DELETE /api/assets/:id`（不存在返回 404）

资产对象：
```json
{
  "id": 101, "owner_id": 2, "owner_name": "alice",
  "name": "Web-Server-01", "ip": "192.168.1.50",
  "type": "server", "status": "online",
  "ssh_port": 22,
  "vendor": "Ubuntu", "os_version": "Linux 5.15.0-91-generic",
  "arch": "x86_64", "virtualization": "kvm",
  "ports": "[22, 80, 443]", "tags": "[\"生产\",\"DMZ\"]",
  "description": "生产 Web 主机 1", "credential_id": 1,
  "last_scanned_at": "2026-06-17T14:30:00Z"
}
```
> `arch` / `virtualization` 由认证采集写入；`ssh_port` 支持非标端口；`owner_name` 为展示字段（非持久化）。

### 6.2 CSV 批量导入
- `POST /api/assets/import` · `multipart/form-data`，字段 `file`
- 响应：`{ "created": 3, "updated": 2, "failed": 1, "errors": ["第3行: IP 非法"] }`
- 说明：按 **IP upsert**；表头支持中英文别名（名称/name、ip、类型/type、状态/status、厂商/vendor、系统/os_version、架构/arch、虚拟化/virtualization、端口/ports、标签/tags、描述/description）。

### 6.3 在线探测
- `POST /api/assets/:id/ping` → `{ "ip": "192.168.1.50", "status": "online" }`
  （依次探测 22/23/80/443/8080/3389，任一响应即在线，并更新 `status` 与 `last_scanned_at`）
- `POST /api/assets/batch-ping` 请求 `{ "ids": [1,2,3] }` → `{ "processed": 3 }`（并发探测，上限 50）

### 6.4 可用性 / 在线率
- `GET /api/assets/:id/uptime?hours=24`
- 响应：`{ "hours": 24, "total": 288, "online": 280, "uptime_percent": 97.2, "checks": [{ "id", "asset_id", "status", "checked_at" }] }`
- 数据源：后台监控写入的 `AssetCheck` 历史（间隔由系统设置 `monitor_interval` 决定）。

### 6.5 认证采集 / 变更历史
- `POST /api/assets/:id/collect`（需绑定 SSH 凭据）→ `{ "ok": true, "arch": "aarch64", "os": "Linux 4.19...", "message": "采集成功..." }`
  - 执行 `uname -m; uname -sr` + `systemd-detect-virt`（回退 `/proc/cpuinfo` + DMI）判虚拟化；Telnet 不支持。
- `GET /api/assets/:id/history` → 最近 100 条 `{ id, asset_id, field, old_value, new_value, created_at }`

---

## 7. 标签 (Tags)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 全局标签列表 |
| POST | `/api/tags` | 新增 `{ name, color }` |
| PUT | `/api/tags/:id` | 重命名/改色（同步到引用资产） |
| DELETE | `/api/tags/:id` | 删除（同步从资产移除） |

---

## 8. 自动发现 / 漏扫任务 (Scan Tasks) 🔒

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 创建 |
| PUT | `/api/tasks/:id` | 修改 |
| DELETE | `/api/tasks/:id` | 删除 |
| POST | `/api/tasks/:id/run` | 启动（异步，立即返回） |
| POST | `/api/tasks/:id/stop` | 停止（取消 goroutine 或重置状态） |
| GET | `/api/tasks/:id/logs` | 历史日志列表 |
| GET | `/api/tasks/:id/stream` | **SSE 实时日志/状态流**（`?token=`） |

任务对象：`{ id, name, target_range, ports: "22,23,80,443", kind: "discovery"|"vuln", schedule: ""|"@every 15m"|"daily:HH:MM", status: "idle"|"running"|"completed"|"failed", last_run_at }`。
日志对象：`{ id, task_id, status, started_at, finished_at, summary, detail }`。

### SSE 事件格式（`text/event-stream`）
```
data: [14:30:05] 发现存活设备: 192.168.1.50 | 类型: server ...   # 默认 message = 每行控制台输出

event: status
data: running

event: done
data: 扫描完成。总IP数: 254，存活主机数: 12，新增资产: 3 ...       # 结束后服务端关闭连接
```

---

## 9. 漏洞发现 (Vulnerabilities) 🔒

- `GET /api/vulns?asset_id=101`（可选过滤）→ 最多 500 条，倒序
- 对象：`{ id, asset_id, target: "192.168.1.50:80", template_id, name, severity: "info|low|medium|high|critical", matched_at, engine: "nuclei", created_at }`

---

## 10. 系统设置 (Settings) 🔒

- `GET /api/settings` → `key -> value` 映射
- `PUT /api/settings` 请求 `{ "scan_concurrency": "200" }`（只传需更新键）→ `{ "updated": 1 }`

常用键：
```json
{
  "scan_concurrency": "100", "scan_timeout": "2", "ssh_timeout": "10",
  "auth_username": "admin", "auth_password": "admin",
  "monitor_enabled": "false", "monitor_interval": "5",
  "notify_type": "none", "notify_url": "",
  "notify_on_scan": "true", "notify_on_offline": "true",
  "ai_enabled": "false", "ai_base_url": "", "ai_api_key": "", "ai_model": ""
}
```

---

## 11. 告警通知 (Notify) 🔒

- `POST /api/notify/test` 请求 `{ "type": "wecom"|"dingtalk"|"webhook", "url": "..." }` → `{ "ok": true }`
- 实际触发：扫描完成（`notify_on_scan`）/ 资产离线或恢复（`notify_on_offline`）时按 `notify_type` 推送（企业微信 markdown / 钉钉 text / 通用 Webhook JSON）。

---

## 12. AI 命令助手 (AI)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/status` | `{ "enabled": true }`（仅开关，不含密钥；任意登录用户可查） |
| POST | `/api/ai/command` | 自然语言生成单条命令（不执行） |
| POST 🔒 | `/api/ai/test` | 测试 AI 配置连通性 |
| POST | `/api/ai/agent/start` | 启动 Agent 任务（自动执行 + 高危拦截） |
| POST | `/api/ai/agent/continue` | 对高危命令确认/中止 |
| POST | `/api/ai/agent/message` | 多轮追加指令（带上下文继续） |

- 生成：请求 `{ "asset_id": 101, "prompt": "查找 /var/log 下最大的 5 个文件" }`
  → `{ "command": "du -ah /var/log | sort -rh | head -5", "dangerous": false, "warning": "" }`
  - **仅生成不执行**；正则识别高危命令（`rm -rf`/`mkfs`/`dd`/fork 炸弹/`curl|sh` 等）置 `dangerous=true` 并给 `warning`；按资产归属校验；全程审计。
- 测试：请求 `{ "base_url", "api_key", "model" }` → `{ "ok": true, "sample": "..." }`

### 12.1 AI Agent（一句话自动完成任务）
- **模式**：自动执行 + 高危拦截。后端以**独立 SSH 通道**逐条执行 AI 生成的命令、读取退出码与输出回传给模型推进，跨命令保留工作目录；命中高危命令则暂停等待确认。会话保存完整对话历史（多轮上下文记忆）。
- **安全**：归属校验、高危拦截、步数上限（默认 15）、每步超时（默认 30s）、会话归属校验、全程审计（`AI_AGENT_START`/`AI_AGENT`/`AI_AGENT_CONFIRM`/`AI_AGENT_MSG`）；仅 SSH 资产。
- `POST /api/ai/agent/start`：请求 `{ "asset_id": 101, "prompt": "清理 /var/log 下大于100M 的日志" }`
- `POST /api/ai/agent/continue`：请求 `{ "session_id": "agent-...", "approve": true }`（false=中止）
- `POST /api/ai/agent/message`：请求 `{ "session_id": "agent-...", "prompt": "顺便重启 rsyslog" }`
- 三者统一返回会话状态 (`data`)：
```json
{
  "session_id": "agent-…",
  "status": "awaiting_confirm | done | error | aborted",
  "steps": [{ "index": 1, "thought": "…", "command": "du -ah /var/log|sort -rh|head", "output": "…", "exit_code": 0, "dangerous": false }],
  "pending": "truncate -s 0 /var/log/syslog",  "pending_note": "…", "pending_warning": "⚠️ …",
  "summary": "已清理 2 个文件，释放 1.3G", "error": "", "work_dir": "/var/log"
}
```

### 12.2 Agent 历史会话（持久化，重启不丢）
- 会话写穿持久化到 `agent_sessions` 表，作为「历史对话」来源。
- `GET /api/ai/agent/sessions` → 当前用户的会话列表（最近在前，最多 50）：
  `[{ "session_id", "asset_id", "asset_name", "title", "status", "summary", "updated_at" }]`
- `GET /api/ai/agent/sessions/:id` → 单个会话完整状态（同 12.1 的会话状态结构，归属校验）。

---

## 13. SFTP 文件传输

> 仅 SSH 凭据资产；归属校验；每次操作单独审计（动作/路径/状态/IP）。支持非标 SSH 端口。

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/api/assets/:id/sftp/list?path=` | `path` 空则用家目录 | `{ "path", "entries": [{ name, path, size, is_dir, mode, mod_time }] }` |
| GET | `/api/assets/:id/sftp/download?path=` | `?token=` | 二进制流（出错则 JSON `{message}`） |
| POST | `/api/assets/:id/sftp/upload` | `multipart`：`file` + `path`(目标目录) | `{ "path", "size" }` |
| POST | `/api/assets/:id/sftp/mkdir` | `{ "path" }`（含父目录） | `{ "ok": true }` |
| POST | `/api/assets/:id/sftp/remove` | `{ "path" }`（递归，禁止删根） | `{ "ok": true }` |
| POST | `/api/assets/:id/sftp/rename` | `{ "from", "to" }` | `{ "ok": true }` |

---

## 14. WebSSH / Telnet 终端协议

### 14.1 建立连接
- WebSocket：`ws(s)://<host>/api/ws/terminal/:asset_id?token=<会话令牌>`
- 后端校验令牌 + 资产归属后，按凭据类型选择 SSH 或 Telnet 代理；非标端口取 `asset.SSHPort`。
- 查询参数 `autotry`（默认开，传 `autotry=0` 关闭）：资产**未绑定凭据**时，先按归属逐个尝试已保存的 SSH 凭据（过程以 `status` 消息回显），**首个连接成功的自动绑定**到该资产并审计（`AUTO_BIND_CRED`）；全部失败再走下方手动输入。

### 14.2 消息交互
- **后端索要临时凭据**（资产未绑定凭据、且自动尝试未成功时）：
  后端→前端 `{ "type": "auth_request", "message": "..." }`；前端→后端 `{ "type": "auth_response", "username", "password" }`
- **终端数据**：前端→后端为键盘输入（二进制/字符串）；后端→前端为目标机输出，前端 `xterm.write()` 渲染。
- **窗口大小**：前端→后端 `{ "type": "resize", "cols": 120, "rows": 35 }`
- **心跳**：前端→后端 `{ "type": "ping" }`
- **关闭**：后端关闭 WS / SSH 时前端捕获 close 事件展示「会话已断开」。

> 多屏分屏、命令同步广播、命令自动补全、AI 命令助手均为**前端能力**，对上述协议透明（同步广播即把同一输入写入多个终端 WS；AI 助手经 `/api/ai/command` 生成后由用户确认再写入 WS）。

---

## 15. 活动日志 (Activity)

- `GET /api/activity/recent` → 最近 20 条 `{ id, type, message, ref_id, created_at }`（非管理员按归属过滤）

活动类型（`type`）：`asset_created` / `asset_updated` / `asset_deleted` / `scan_started` / `scan_completed` / `scan_failed` / `user_registered` 等。
