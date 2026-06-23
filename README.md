<div align="center">

<img src="frontend/public/favicon.svg" width="76" alt="Meridian logo" />

# Meridian · 子午

**网络资产发现与统一接入平台**
*Network Asset Discovery & Unified Access Platform*

发现（雷达扫描） → 测绘（CMDB 入库） → 接入（一键 WebSSH）

</div>

---

## 简介

**Meridian（子午）** 是一个自包含、全栈、轻量的内网资产管理平台。一条命令即可对网段做并发发现扫描，
将存活主机自动测绘入 CMDB，集中托管登录凭据，并直接在浏览器中通过 WebSSH 接入设备——
无需在多个工具间来回切换。

名取自航海与测绘中的基准经线「子午线」，寓意为散落的网络资产建立**统一的定位、测绘与导航坐标系**。

## 核心能力

| 模块 | 说明 |
|------|------|
| 🛰️ 自动发现 | CIDR / IP 范围并发扫描，端口探测与设备类型指纹识别，**SSE 实时进度**、**定时调度**（`@every` / 每日定时） |
| 🗂️ CMDB 资产清单 | 资产 CRUD、标签、端口可视化、在线探测、详情抽屉、**分组 / 批量操作 / CSV 导入导出 / 变更历史 / 归属分配** |
| 🧬 认证采集 | 绑定 SSH 凭据后一键采集 **CPU 架构** 与 **虚拟化（VM / 云 / 容器）**，列表标签展示 |
| 🟢 可用性监控 | 后台定时探测 + **在线率历史（uptime）**，离线/恢复自动告警 |
| 🐞 漏洞发现 | 可插拔扫描引擎，接入 **nuclei** 漏扫（缺二进制优雅降级） |
| 🔐 凭据保管箱 | 集中托管 SSH 密码 / 密钥 / Telnet 账号（**支持非标端口**），**连通性测试** |
| 💻 WebSSH / Telnet 终端 | xterm.js + WebSocket 双向交互，**多屏分屏（单/双/四分，可独立关闭、自由拖拽缩放）、命令同步广播、命令自动补全（内置 200+ 运维命令）、AI 命令助手**、应用内多标签 / 全屏 / 滚动回看、自适应缩放、凭据交互、断线提示 |
| 📁 SFTP 文件管理 | 浏览 / 上传（拖拽）/ 下载 / 新建 / 删除 / 重命名目录，**全程审计** |
| 🤖 AI 命令助手 | 自然语言 → shell（OpenAI 兼容接口），生成后人工确认执行，高危命令标红 + 二次确认 |
| 📣 告警通知 | 扫描完成 / 资产离线推送到 **企业微信 / 钉钉 / 通用 Webhook** |
| 📊 控制台 | 资产态势、存活率、类型分布、最近活动时间线、实时轮询（按归属隔离） |
| 👥 多用户 / 多租户 | 会话鉴权（bcrypt）、**注册审批制**、管理员 / 普通用户 RBAC、**按归属数据隔离**、登录失败锁定 + 首次登录强制改密 |
| 🧾 审计 / 搜索 | 全量写操作审计日志（管理员可查）、全局搜索（Ctrl/Cmd + K） |

## 品牌标识

Logo 为「星座 / 中枢」几何标识：**中心节点**（统一管理平台）+ **轨道环**（治理边界）+ **三颗卫星节点**（被发现的资产），
采用靛蓝 `#6366f1` → 紫 `#7c5cfb` → 青 `#22d3ee` 渐变，青色端呼应雷达发现语义。
源文件见 [`frontend/public/favicon.svg`](frontend/public/favicon.svg) 与组件 [`frontend/src/components/Logo.tsx`](frontend/src/components/Logo.tsx)。

## 技术栈

- **后端** — Go 1.22 · Gin · GORM · **glebarez/sqlite（纯 Go，免 cgo）** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · `bcrypt` 口令 + 内存会话令牌 · 自包含调度器 / 可用性监控 · nuclei（可选外部二进制）
- **前端** — React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6（+ fit addon）· Vite 8 · react-router-dom v7 · axios

## 安全模型

- **鉴权**：`POST /api/login` 校验 bcrypt 口令后签发会话令牌（`Authorization: Bearer <token>`，WebSocket/SSE 走 `?token=`），受保护路由由服务端中间件校验；管理员路由额外校验角色。
- **多租户**：资产 / 凭据 / 终端 / SFTP / 活动按 `owner_id` 隔离，普通用户仅见与操作自己的数据。
- **审批与口令**：开放注册但默认 `pending`，需管理员审批；登录失败 5 次锁定 10 分钟；默认 `admin/admin` **首次登录强制改密**。
- **有意延后的取舍**（本地工具定位，非缺陷，详见 [architecture.md](docs/architecture.md) 安全章节）：凭据**明文**存储、SSH **未校验主机密钥**（`InsecureIgnoreHostKey`）。生产前应引入 AES-at-rest 与 known_hosts 校验。

## 快速开始

```bash
# 后端（默认监听 :8080，纯 Go SQLite 免 cgo）
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

## Docker 部署（国内镜像）

一条命令起一套（Go 后端 + nginx 托管前端并反代 `/api`，含终端 WebSocket）：

```bash
docker compose up -d --build
# 访问 http://<宿主机IP>:8088   默认 admin / admin
```

基础镜像 / Go 模块 / npm 依赖 / Alpine 源**全部走国内镜像**，详见 [DEPLOY.md](DEPLOY.md)。

## 文档

- [架构设计](docs/architecture.md)
- [接口规范](docs/api_spec.md)
- [产品设计与实施计划](docs/design_plan.md)

## 许可

见 [LICENSE](LICENSE)。
