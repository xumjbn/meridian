# Lynx 接口定义文档 (API Specification)

> 产品：Lynx · 猞猁 — 网络资产发现与统一接入平台 · 对应应用版本 **v0.64**

本文档定义前后端交互的 RESTful API、WebSocket 终端协议与 SSE 流。内容以后端路由（`backend/cmd/server/main.go`）、各 handler 的请求体绑定与返回结构、`backend/internal/model/models.go` 实体 json tag 为准。

## 0. 通用约定

- 所有路径均以 `/api` 为前缀。请求/响应主体均为 JSON（文件上传/下载、SFTP 下载、SSE、WebSocket 除外）。
- **统一响应结构**（所有 HTTP 接口恒以 HTTP 状态码 `200` 返回，业务结果在 body 的 `code` 中）：
  ```json
  { "code": 200, "message": "success", "data": {} }   // code=200 成功；其它为业务错误码
  ```
  成功由 `SendSuccess` 包装（`code=200`、`message="success"`、`data` 为载荷）；失败由 `SendError` 包装（`code` 为错误码、`message` 为错误信息、无 `data`）。
- **鉴权**：除 `POST /api/login`、`POST /api/register` 外，所有接口需带会话令牌
  `Authorization: Bearer <token>`。浏览器无法为 **WebSocket / SSE / 下载链接** 设置请求头，故这些走查询参数 `?token=<token>`。
  - 令牌为登录时下发的 32 字节随机 hex，保存在后端进程内存，有效期 **7 天**；后端重启后需重新登录。
- **默认账号**：`admin / admin`（刻意设计的开箱默认，首次登录建议改密；非安全缺陷）。
- **业务错误码**：`400` 参数错误 / 业务校验失败；`401` 未登录 / 令牌失效（前端清理本地会话并跳登录）；`403` 越权（非管理员访问管理员接口，或访问非本人归属的资产/凭据/集群/会话）；`404` 资源不存在；`409` 资源冲突（用户名已存在）；`423` 登录锁定；`500` 服务端错误；`502` 上游（AI / kube-apiserver）调用失败。
- **多租户隔离**：资产 / 凭据 / K8s 集群 / 终端 / SFTP / 在线探测 / AI 会话 / 活动按 `owner_id`（或 `requester_id`）隔离，普通用户仅能访问自己的数据；管理员可见全部（`canAccess` = `isAdmin || ownerID==当前用户`）。
- **管理员专属**（下文标注 🔒，由 `AdminMiddleware` 拦截，越权返回 `code=403`）：用户管理、审计、系统设置、`notify/test`、`ai/test`、扫描任务全部、漏洞列表。
- **中间件层次**：`AuditMiddleware`（最外层，审计含登录/注册在内的写操作）→ 公开 `login`/`register` → `AuthMiddleware`（其后全部需登录）→ 个别路由再叠加 `AdminMiddleware`。

---

## 1. 认证与会话 (Auth)

### 1.1 登录
- `POST /api/login` · 公开
- 请求体：`{ "username": "admin", "password": "admin" }`
- 成功 (`data`)：`{ "ok": true, "token": "<hex>", "username": "admin", "role": "admin", "must_change_password": true }`
- 说明：优先校验 `users` 表（bcrypt 哈希）；表中无该用户时回退到 `system_settings` 的 `auth_username`/`auth_password` 单账号（默认 `admin/admin`，回退账号 `role=admin`、`user_id=0`）。
- 失败：用户名/密码错误返回 `code=401`；账号 `pending`（待审批）/`disabled`（禁用）返回 `code=403`；**连续失败 5 次锁定 10 分钟**期间返回 `code=423`；参数错误 `code=400`。
- 首次登录默认账号 `must_change_password=true`，前端应引导先改密。

### 1.2 注册（开放，需审批）
- `POST /api/register` · 公开
- 请求体：`{ "username": "alice", "password": "..." }`
- 成功 (`data`)：`{ "id": 5, "username": "alice", "status": "pending", "message": "注册成功，请等待管理员审批后登录" }`
- 校验：用户名长度 3–32 字符、密码长度 6–64 字符；用户名重复返回 `code=409`。
- 说明：新用户 `role=user`、`status=pending`，**需管理员审批为 active 后方可登录**。

### 1.3 注销
- `POST /api/logout` → `{ "ok": true }`（吊销当前令牌）

### 1.4 修改本人密码
- `POST /api/users/change-password`
- 请求体：`{ "username": "admin", "old_password": "...", "new_password": "..." }`
- 成功：`{ "ok": true }`。
- 说明：仅能改当前登录用户自己的密码（以会话身份为准，忽略请求体用户名）；`must_change_password=true` 的首登强制改密场景免校验旧密码；新密码长度 6–64；改密后吊销该用户全部旧会话。

---

## 2. 用户管理 (Users) 🔒

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/users` | 用户列表 |
| POST | `/api/users` | 新增用户 `{ username, password, role? }` → `{ id, username, role }` |
| PUT | `/api/users/:id` | 改角色/启禁用/重置密码 `{ role?, status?, password? }` → `{ ok: true }` |
| DELETE | `/api/users/:id` | 删除用户 → `{ ok: true }` |

- 用户对象：`{ id, username, role(admin|user), status(active|disabled|pending), must_change_password, last_login_at, last_login_ip, created_at, updated_at }`（`password` 带 `json:"-"`，永不返回）。
- 新增：用户名 3–32、密码 6–64；`role` 仅取 `admin`/`user`（其它归一为 `user`）；`status=active`；用户名重复 `code=409`。
- 更新：`role`/`status`/`password` 均为可选指针，仅传需更新项；`status` 仅接受 `active`/`disabled`；非空 `password` 即重置（长度校验）。
- 安全护栏：禁止把**最后一个管理员**降级/禁用/删除；禁用或重置密码后强制吊销该用户全部会话。

---

## 3. 审计日志 (Audit) 🔒

- `GET /api/audit?actor=&action=&limit=`
  - `limit` 默认 200，范围 1–1000（越界回落 200）；`actor` 精确匹配操作人；`action` 精确匹配动作。
- 响应：`AuditLog[]`，倒序：`[{ id, actor, action, path, status, ip, created_at }]`
  - `action` 取值含 HTTP 写方法（`POST`/`PUT`/`DELETE`）以及处理器显式写入的细粒度动作：`AI_CMD` / `AI_AGENT*` / `AUTO_BIND_CRED` / `K8S_ASSIGN` / `K8S_CONSOLE` / `K8S_API` / `K8S_AUTOCLASSIFY` / SFTP 的 `LIST|DOWNLOAD|UPLOAD|MKDIR|DELETE|RENAME` 等。
  - `status` 为业务返回 `code`（200 成功，4xx/5xx 失败）。
- 说明：`AuditMiddleware` 记录所有写操作（含 login/register）；`/sftp/` 与 `/ai/` 路径由各自处理器显式审计（含路径/命令明细），中间件跳过以免重复。

---

## 4. 仪表盘 (Dashboard)

- `GET /api/dashboard/stats` → `{ total_assets, servers, switches, routers, other, online_assets, offline_assets, running_tasks }`
- 说明：数据按当前用户归属统计（管理员为全量）；`other` 涵盖除 server/switch/router 外的全部类型，保证四类之和等于 `total_assets`；`running_tasks` 为管理员功能，普通用户恒为 0。

---

## 5. 凭据管理 (Credentials)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/credentials` | 列表（按归属，倒序） |
| POST | `/api/credentials` | 创建（归属创建者）→ 返回凭据对象 |
| PUT | `/api/credentials/:id` | 更新（归属校验，归属不被请求体覆盖）→ 返回凭据对象 |
| DELETE | `/api/credentials/:id` | 删除（同时解除资产上的悬空 `credential_id` 引用）→ `data: null` |
| POST | `/api/credentials/:id/test` | 连通性测试 |

- 凭据对象：`{ id, owner_id, name, type, username, password, private_key, created_at, updated_at }`
  - `type`：`ssh_password` | `ssh_key` | `telnet`；`password` / `private_key` **明文存储并随接口返回**（刻意取舍）。
- 创建/更新校验：`name`、`type` 不能为空。
- 连通性测试：请求 `{ "host": "192.168.1.10", "port": 0 }`（`port=0` 时按类型默认 SSH 22 / Telnet 23）。
  - 成功响应 `{ "ok": true, "message": "连接成功，凭据有效 ✓" }`；失败时仍以 `code=200` 返回 `{ "ok": false, "message": "..." }`（连接失败/私钥解析失败等不作为 HTTP 错误码）。
  - Telnet 仅校验端口连通性（不做登录验证）；SSH 用 `InsecureIgnoreHostKey()`。

---

## 6. 资产管理 (Assets)

### 6.1 列表 / CRUD
- `GET /api/assets?q=&type=&status=` → `Asset[]`（按 `ip` 升序；`q` 模糊匹配 name/ip）
- `POST /api/assets`：创建，支持 IP 范围/CIDR 批量（如 `192.168.1.21-23`、`192.168.1.0/24`）；多 IP 时名称自动追加 `-<ip>` 后缀；已存在的 IP 跳过；返回**创建的第一个** Asset。管理员可在请求体带 `owner_id` 代为分配归属。
- `GET /api/assets/:id`（归属校验，附 `owner_name`） · `PUT /api/assets/:id`（记录字段级历史） · `DELETE /api/assets/:id`（不存在返回 404，成功 `data: null`）
- 创建/更新跨租户防护：不可把资产绑定到他人凭据（`assertCredentialOwned`，违规 `code=403`）。

资产对象（json tag 全集）：
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
  "k8s_role": "control-plane", "k8s_cluster_id": 3,
  "last_scanned_at": "2026-06-17T14:30:00Z",
  "created_at": "...", "updated_at": "..."
}
```
> `type`：`server`/`switch`/`router`/`other`；`status`：`online`/`offline`/`unknown`；`arch`/`virtualization` 由认证采集写入；`ssh_port` 支持非标端口（0 时默认 22）；`k8s_role`（`""`/`control-plane`/`worker`）与 `k8s_cluster_id` 由扫描/归类写入；`ports`/`tags` 为 JSON 字符串数组；`owner_name` 为展示字段（非持久化）。

### 6.2 CSV 批量导入
- `POST /api/assets/import` · `multipart/form-data`，字段 `file`
- 响应：`{ "created": 3, "updated": 2, "failed": 1, "errors": ["第 3 行：IP 为空，已跳过", ...] }`
- 说明：按 **IP upsert**（仅写入 CSV 实际存在的列，避免子集列覆盖已有数据）；新建归属导入者、名称缺省用 IP、类型缺省 `other`；非管理员不能更新他人已存在的同 IP 资产（计入 failed）。
- 表头支持中英文别名：名称/name、ip（地址/ip地址）、类型/type、状态/status、厂商/vendor、系统/操作系统/os/os_version、架构/arch、虚拟化/virtualization、端口/ports、标签/tags、描述/备注/description；缺少 IP 列直接 `code=400`。

### 6.3 在线探测
- `POST /api/assets/:id/ping` → `{ "status": "online", "ip": "192.168.1.50" }`
  - 依次探测 `22/23/80/443/8080/3389`（各 2s 超时），任一响应即在线，并更新 `status` 与 `last_scanned_at`。
- `POST /api/assets/batch-ping` 请求 `{ "ids": [1,2,3] }` → `{ "processed": 3 }`
  - 并发探测（上限 50），仅探测本人资产（管理员全量）；空 `ids` 返回 `processed: 0`。

### 6.4 可用性 / 在线率
- `GET /api/assets/:id/uptime?hours=24`（`hours` 默认 24，范围 1–720，越界回落 24）
- 响应：`{ "hours": 24, "total": 288, "online": 280, "uptime_percent": 97.2, "checks": [{ id, asset_id, status, checked_at }] }`
- 数据源：后台监控写入的 `AssetCheck` 历史（探测开关由 `monitor_enabled`、间隔由 `monitor_interval` 设置决定）。

### 6.5 认证采集 / 变更历史
- `POST /api/assets/:id/collect`（需绑定 SSH 凭据；Telnet 不支持）
  → `{ "ok": true, "arch": "aarch64", "os": "Linux 4.19...", "virtualization": "kvm", "message": "采集成功: ..." }`
  - 执行 `uname -m; uname -sr` + 虚拟化探测（优先 `systemd-detect-virt`，回退 CPUID hypervisor 位 + DMI product_name）；结果归一化写入 `arch`/`os_version`/`virtualization`。
  - SSH 连接/命令失败时仍以 `code=200` 返回 `{ "ok": false, "message": "..." }`；未绑定凭据/Telnet 凭据返回 `code=400`。
- `GET /api/assets/:id/history` → 最近 100 条（倒序）`{ id, asset_id, field, old_value, new_value, created_at }`（归属校验）。

---

## 7. 标签 (Tags)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 全局标签列表（倒序） |
| POST | `/api/tags` | 新增 `{ name, color? }`（color 缺省 `#1890ff`，重名 `code=400`）→ 标签对象 |
| PUT | `/api/tags/:id` | 重命名/改色（改名异步同步到引用资产）→ 标签对象 |
| DELETE | `/api/tags/:id` | 删除（异步从资产移除该标签）→ `data: "标签已删除"` |

- 标签对象：`{ id, name, color, created_at, updated_at }`（`name` 全局唯一）。

---

## 8. 自动发现 / 漏扫任务 (Scan Tasks) 🔒

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/tasks` | 任务列表（倒序） |
| POST | `/api/tasks` | 创建（`name`/`target_range` 必填，初始 `status=idle`） |
| PUT | `/api/tasks/:id` | 修改（仅更新 name/target_range/ports/kind/detect_k8s/schedule，不可经请求体改写 id/status） |
| DELETE | `/api/tasks/:id` | 删除 |
| POST | `/api/tasks/:id/run` | 启动（异步，立即返回 `data: "扫描任务已在后台启动"`；运行中重复启动 `code=400`） |
| POST | `/api/tasks/:id/stop` | 停止（取消活跃 goroutine 或强制重置残留 running 状态） |
| GET | `/api/tasks/:id/logs` | 历史日志列表（倒序） |
| GET | `/api/tasks/:id/stream` | **SSE 实时日志/状态流**（`?token=` 鉴权） |

- 任务对象：`{ id, name, target_range, ports, kind, detect_k8s, schedule, status, last_run_at, created_at, updated_at }`
  - `ports` 默认 `"22,23,80,443"`；`kind`：`discovery`（端口发现）| `vuln`（nuclei 漏扫）；`detect_k8s`（bool，是否探测 K8s 节点并入 6443/10250）；`schedule`：`""` | `"@every 1h"` | `"daily:HH:MM"`；`status`：`idle`/`running`/`completed`/`failed`。
- 日志对象：`{ id, task_id, status, started_at, finished_at, summary, detail }`（`status`：`running`/`success`/`failed`）。

### SSE 事件格式（`text/event-stream`，每秒轮询最新一条日志增量）
```
data: [14:30:05] 发现存活设备: 192.168.1.50 | 类型: server ...   # 默认 message = detail 每行控制台输出增量

event: status
data: running

event: done
data: 扫描完成。总IP数: 254，存活主机数: 12，新增资产: 3 ...       # 状态非 running 后推送 summary 并关闭连接
```

---

## 9. 漏洞发现 (Vulnerabilities) 🔒

- `GET /api/vulns?asset_id=101`（`asset_id` 可选过滤）→ `VulnFinding[]`，最多 500 条，倒序
- 对象：`{ id, asset_id, target, template_id, name, severity, matched_at, engine, created_at }`
  - `severity`：`info`/`low`/`medium`/`high`/`critical`；`engine`：`nuclei`；`asset_id` 可能为 0（扫描目标不在 CMDB 中）。

---

## 10. 系统设置 (Settings) 🔒

- `GET /api/settings` → `key -> value` 字符串映射
- `PUT /api/settings` 请求 `{ "scan_concurrency": "200" }`（只传需更新键，upsert）→ `{ "updated": 1 }`

常用键（值均为字符串）：
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

- `POST /api/notify/test` 请求 `{ "type": "wecom"|"dingtalk"|"webhook", "url": "..." }` → `{ "ok": true }`（`url` 为空或发送失败返回 `code=400`）
- 实际触发：扫描完成（`notify_on_scan`）/ 资产离线或恢复（`notify_on_offline`）时按 `notify_type` 推送（企业微信 markdown / 钉钉 text / 通用 Webhook JSON）。

---

## 12. AI 命令助手 (AI)

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/ai/status` | 登录用户 | `{ "enabled": true }`（启用且配置完整时为 true；不含任何密钥） |
| POST | `/api/ai/command` | 登录用户 | 自然语言生成单条命令（不执行，按资产归属校验） |
| POST | `/api/ai/test` | 🔒 管理员 | 测试 AI 配置连通性 |
| POST | `/api/ai/agent/start` | 登录用户 | 启动 Agent 任务（自动执行 + 高危拦截） |
| POST | `/api/ai/agent/continue` | 登录用户 | 对高危命令确认/中止 |
| POST | `/api/ai/agent/message` | 登录用户 | 多轮追加指令（带上下文继续） |
| POST | `/api/ai/agent/stop` | 登录用户 | 立即中止运行中的 Agent 任务 |
| GET | `/api/ai/agent/sessions` | 登录用户 | 当前用户历史会话列表 |
| GET | `/api/ai/agent/sessions/:id` | 登录用户 | 单个会话完整状态 |

- 生成：请求 `{ "asset_id": 101, "prompt": "查找 /var/log 下最大的 5 个文件" }`
  → `{ "command": "du -ah /var/log | sort -rh | head -5", "dangerous": false, "warning": "" }`
  - **仅生成不执行**；正则识别高危命令（`rm -rf`/`mkfs`/`dd`/fork 炸弹/`curl|sh`/重启关机/防火墙清空/卸载软件包等）置 `dangerous=true` 并给 `warning`；按资产归属校验；全程审计（`AI_CMD`）。
  - 未启用或配置不完整 `code=400`；上游调用失败 `code=502`。
- 测试：请求 `{ "base_url", "api_key", "model" }` → `{ "ok": true, "sample": "..." }`（连接失败 `code=400`）。
- 后端走 OpenAI 兼容 `/chat/completions`，`base_url` 可指向自建/本地 LLM。

### 12.1 AI Agent（一句话自动完成任务）
- **模式**：自动执行 + 高危拦截。后端以**独立 SSH 通道**逐条执行 AI 生成的命令、读取退出码与输出回传给模型推进，跨命令保留工作目录；命中高危命令则暂停等待确认。会话保存完整对话历史（多轮上下文记忆）。
- **安全**：归属校验、高危拦截、步数上限（默认 15）、每步超时（默认 30s）、会话归属校验、全程审计（`AI_AGENT_START`/`AI_AGENT`/`AI_AGENT_CONFIRM`/`AI_AGENT_MSG`）；仅 SSH 资产（Telnet/未绑定凭据 `code=400`）。
- `POST /api/ai/agent/start`：请求 `{ "asset_id": 101, "prompt": "清理 /var/log 下大于100M 的日志", "session_id": "agent-..." }`（`session_id` 可由前端预生成，便于首轮即可调用 `/stop`；不合法则后端生成）。
- `POST /api/ai/agent/continue`：请求 `{ "session_id": "agent-...", "approve": true }`（`false`=拒绝并中止本步）。
- `POST /api/ai/agent/message`：请求 `{ "session_id": "agent-...", "prompt": "顺便重启 rsyslog" }`（追加指令，清空挂起高危后重新决策）。
- `POST /api/ai/agent/stop`：请求 `{ "session_id": "agent-..." }` → `{ "ok": true }`（取消在途 LLM/SSH 调用，runLoop 在下一检查点收尾为 `aborted`）。
- start/continue/message 统一返回会话状态 (`data`)：
```json
{
  "session_id": "agent-…",
  "status": "running | awaiting_confirm | done | error | aborted",
  "steps": [{ "index": 1, "thought": "…", "command": "du -ah /var/log|sort -rh|head", "output": "…", "exit_code": 0, "dangerous": false }],
  "pending": "truncate -s 0 /var/log/syslog", "pending_note": "…", "pending_warning": "⚠️ …",
  "summary": "已清理 2 个文件，释放 1.3G", "error": "", "work_dir": "/var/log"
}
```

### 12.2 Agent 历史会话（持久化，重启不丢）
- 会话写穿持久化到 `agent_sessions` 表（按 `requester_id` 归属），作为「历史对话」来源。
- `GET /api/ai/agent/sessions` → 当前用户的会话列表（按 `updated_at` 倒序，最多 50）：
  `[{ session_id, asset_id, asset_name, title, status, summary, updated_at }]`
- `GET /api/ai/agent/sessions/:id` → 单个会话完整状态（同 12.1 的会话状态结构，归属校验，内存未命中则从 DB 重建）。

---

## 13. SFTP 文件传输

> 仅 SSH 凭据资产；归属校验；每次操作单独审计（动作 LIST/DOWNLOAD/UPLOAD/MKDIR/DELETE/RENAME + 资产/路径/状态/IP）。支持非标 SSH 端口。

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/api/assets/:id/sftp/list?path=` | `path` 空则解析到家目录 | `{ "path", "entries": [{ name, path, size, is_dir, mode, mod_time }] }`（目录在前，按名排序） |
| GET | `/api/assets/:id/sftp/download?path=` | `?token=` 鉴权 | 二进制流（`application/octet-stream`，带 Content-Disposition）；出错则统一 JSON `{ code, message }` |
| POST | `/api/assets/:id/sftp/upload` | `multipart`：`file` + `path`(目标目录，空则当前目录) | `{ "path", "size" }`（上限 2 GiB） |
| POST | `/api/assets/:id/sftp/mkdir` | `{ "path" }`（含父目录） | `{ "ok": true, "path" }` |
| POST | `/api/assets/:id/sftp/remove` | `{ "path" }`（目录递归，禁止删空路径/根） | `{ "ok": true }` |
| POST | `/api/assets/:id/sftp/rename` | `{ "from", "to" }`（禁止源为空/根） | `{ "ok": true, "path": "<to>" }` |

- `mod_time` 为 Unix 秒；`mode` 为权限字符串（如 `-rw-r--r--`）。
- 资产不存在 404；越权 403；未绑定/Telnet 凭据或路径非法 400；以上失败均落审计。

---

## 14. Kubernetes 集群管理 (K8s)

> 集群是用户手动建立的归类单元（VIP + 控制台端口 + 绑定凭据）；节点复用 Asset（`Asset.k8s_cluster_id` 归属）。按 `owner_id` 多租户隔离 + 全程审计。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/k8s/clusters` | 集群列表（含节点数/在线探测，倒序） |
| POST | `/api/k8s/clusters` | 新建（`name`/`vip` 必填，跨租户凭据防护） |
| GET | `/api/k8s/clusters/:id` | 集群详情 + 节点列表 → `{ "cluster", "nodes": Asset[] }` |
| PUT | `/api/k8s/clusters/:id` | 编辑（`api_token` 留空则保持原值不变） |
| DELETE | `/api/k8s/clusters/:id` | 删除（节点解引用，资产本身保留）→ `{ ok: true }` |
| POST | `/api/k8s/clusters/:id/nodes` | 归类节点 `{ asset_ids: [..], role? }` → `{ assigned }`（审计 `K8S_ASSIGN`） |
| DELETE | `/api/k8s/clusters/:id/nodes/:assetId` | 把节点移出集群 → `{ ok: true }` |
| GET | `/api/k8s/clusters/:id/console` | 一键控制台信息 → `{ url, username, password }`（审计 `K8S_CONSOLE`） |
| GET | `/api/k8s/nodes/unassigned` | 已探测为 K8s 但未归类的节点（Asset[]） |
| POST | `/api/k8s/auto-classify` | 读节点 `/etc/hosts` 的 cluster-vip 标记自动归类 → `{ processed, assigned, clusters_created, details }`（审计 `K8S_AUTOCLASSIFY`） |
| GET | `/api/k8s/clusters/:id/overview` | 集群概览（需 API Token） |
| GET | `/api/k8s/clusters/:id/live/nodes` | 实时节点列表（需 API Token） |
| GET | `/api/k8s/clusters/:id/live/pods` | 实时 Pod 列表（需 API Token，可选 `?namespace=`） |

- 集群请求体：`{ name, vip, console_port?, console_path?, api_server?, api_token?, credential_id?, description? }`
  - `console_port` 默认 443，`console_path` 默认 `/`，`api_server` 默认 `VIP:6443`；`api_token` 为 kube-apiserver ServiceAccount Bearer Token，**不回传前端**（响应仅 `has_token` 标志）。
- 集群对象（响应）：`{ id, owner_id, name, vip, console_port, console_path, api_server, credential_id, description, created_at, updated_at, node_count, master_count, owner_name, cred_name, online, has_token }`（后六项为非持久化展示字段）。
- **实时看板**（overview/live nodes/pods）由服务端持集群 Token 调 kube-apiserver（跳过 TLS 校验），Token 不出后端：
  - `overview` → `{ has_token, version, nodes_total, nodes_ready, pods_total, pods_running }`（未配置 Token 时 `{ has_token: false }`）。
  - `live/nodes` → `[{ name, ready, role, ip, version, os, arch, created_at }]`。
  - `live/pods` → `[{ name, namespace, phase, node, restarts, created_at }]`。
  - live 接口未配置 Token 返回 `code=400`；连接/调用 kube-apiserver 失败返回 `code=502`。

---

## 15. WebSSH / Telnet 终端协议

### 15.1 SSH/Telnet 终端
- WebSocket：`ws(s)://<host>/api/ws/terminal/:asset_id?token=<会话令牌>`
- 后端校验令牌 + 资产归属（越权返回 HTTP 403 文本）后，按凭据类型选择 SSH 或 Telnet 代理；非标端口取 `asset.ssh_port`。
- 查询参数 `autotry`（默认开，传 `autotry=0` 关闭）：资产**未绑定凭据**时，先按归属逐个尝试已保存的 SSH 凭据（过程以 `status` 消息回显），**首个连接成功的自动绑定**到该资产并审计（`AUTO_BIND_CRED`）；全部失败再走下方手动输入。

### 15.2 本机 Shell 终端（本地终端）
- WebSocket：`ws(s)://<host>/api/ws/local-terminal?token=<会话令牌>`
- 打开运行后端那台机器的本机 Shell（桌面端/回环自用）。是否可用由 `LocalShellEnabled()` 决定：`MERIDIAN_LOCAL_SHELL=1` 显式开启，或后端监听在回环地址时默认开；多用户服务器（`0.0.0.0`）默认关，未启用返回 HTTP 403 文本。前端应先查 `/api/capabilities` 的 `local_shell` 再决定是否展示入口。

### 15.3 消息交互协议（两种终端通用）
- 控制消息为 JSON 文本帧（`{ "type": ... }`），终端数据为二进制帧。
- **后端索要临时凭据**（仅 SSH 终端，资产未绑定凭据、且自动尝试未成功时）：
  后端→前端 `{ "type": "auth_request", "message": "..." }`；前端→后端 `{ "type": "auth_response", "username", "password" }`。
- **状态回显**：后端→前端 `{ "type": "status", "message": "..." }`（连接进度、自动尝试过程；连接成功时 `message` 为 `"connected"`）。
- **终端数据**：前端→后端为键盘输入（二进制帧，亦兼容文本帧）写入目标 stdin；后端→前端为目标机 stdout/stderr 输出（**二进制帧**），前端 `xterm.write()` 渲染。
- **窗口大小**：前端→后端 `{ "type": "resize", "cols": 120, "rows": 35 }`。
- **心跳**：前端每约 15s 发 `{ "type": "ping" }`，后端回 `{ "type": "pong", "message": "pong" }`；服务端读空闲超时 90s（半开连接保护，超时即清理 SSH/PTY/协程）。
- **关闭**：后端关闭 WS / SSH 时前端捕获 close 事件展示「会话已断开」。

> 多屏分屏、命令同步广播、命令自动补全、AI 命令助手均为**前端能力**，对上述协议透明（同步广播即把同一输入写入多个终端 WS；AI 助手经 `/api/ai/command` 生成后由用户确认再写入 WS）。

---

## 16. 能力开关 (Capabilities)

- `GET /api/capabilities` → `{ "local_shell": true }`
- 说明：暴露前端按需展示的能力开关，目前为本机 Shell 终端是否可用（见 15.2 的 `LocalShellEnabled()` 判定）。

---

## 17. 活动日志 (Activity)

- `GET /api/activity/recent` → 最近 20 条（倒序）`{ id, type, message, ref_id, created_at }`
- 数据隔离：非管理员仅返回与本人资产相关的活动（`type LIKE 'asset%'` 且 `ref_id` 属于本人资产）；管理员返回全部类型。
- 活动类型（`type`）：`asset_created` / `asset_updated` / `asset_deleted` / `asset_imported` / `scan_started` / `scan_completed` / `scan_failed` / `user_registered` / `user_created` / `user_updated` / `user_deleted` / `user_password_changed` 等。
