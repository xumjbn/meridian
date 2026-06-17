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
| 🗂️ CMDB 资产清单 | 资产 CRUD、标签、端口可视化、在线探测、详情抽屉、**分组 / 批量操作 / 导出 CSV / 变更历史** |
| 🧬 认证采集 | 绑定 SSH 凭据后一键采集 **CPU 架构** 与 **虚拟化（VM / 云 / 容器）**，列表标签展示 |
| 🐞 漏洞发现 | 可插拔扫描引擎，接入 **nuclei** 漏扫（缺二进制优雅降级） |
| 🔐 凭据保管箱 | 集中托管 SSH 密码 / 密钥 / Telnet 账号，**连通性测试** |
| 💻 WebSSH / Telnet 终端 | xterm.js + WebSocket 双向交互，**应用内多标签 / 全屏 / 滚动回看**、自适应缩放、凭据交互、断线提示 |
| 📊 控制台 | 资产态势、存活率、类型分布、最近活动时间线、实时轮询 |
| 🔑 登录 / 搜索 | 登录门禁（默认 admin/admin）、右上角用户菜单、全局搜索（Ctrl/Cmd + K） |

## 品牌标识

Logo 为「星座 / 中枢」几何标识：**中心节点**（统一管理平台）+ **轨道环**（治理边界）+ **三颗卫星节点**（被发现的资产），
采用靛蓝 `#6366f1` → 紫 `#7c5cfb` → 青 `#22d3ee` 渐变，青色端呼应雷达发现语义。
源文件见 [`frontend/public/favicon.svg`](frontend/public/favicon.svg) 与组件 [`frontend/src/components/Logo.tsx`](frontend/src/components/Logo.tsx)。

## 技术栈

- **后端** — Go 1.22 · Gin · GORM · **glebarez/sqlite（纯 Go，免 cgo）** · gorilla/websocket · `golang.org/x/crypto/ssh` · 自包含调度器 · nuclei（可选外部二进制）
- **前端** — React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6 · Vite 8 · react-router-dom v7 · axios

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

> 默认登录账号 **admin / admin**（可在系统设置 / `system_settings` 修改）。

构建验证：

```bash
cd backend  && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server
cd frontend && npm run build
```

## 文档

- [架构设计](docs/architecture.md)
- [接口规范](docs/api_spec.md)
- [产品设计与实施计划](docs/design_plan.md)

## 许可

见 [LICENSE](LICENSE)。
