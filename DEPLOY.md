# Lynx · 猞猁 —— 服务端部署

> **网络资产发现与统一接入平台** · 当前版本 **v0.64**

服务端有两种部署形态，按需选择：

| 形态 | 适用场景 | 入口 |
|------|---------|------|
| **Docker 容器**（推荐） | 一条命令起全套（Go 后端 + nginx 托管前端并反代 `/api`） | [一、Docker 部署](#一docker-部署) |
| **裸机 / 二进制** | 自管进程、已有 nginx、或不便跑容器 | [二、裸机部署（make server + nginx）](#二裸机部署make-server--nginx) |

> 想装成 **桌面应用**（Tauri + Go sidecar，单机本地实例，免登录自动登录）？见 [`docs/desktop.md`](docs/desktop.md)。桌面端与服务端部署相互独立。

技术栈：后端 **Go 1.22 + Gin + GORM**，数据库 **glebarez/sqlite（纯 Go SQLite，免 CGO）**；前端 **React 18 + Vite 8 + Ant Design 5 + xterm.js**，由 nginx 托管。所有基础镜像、Go 模块、npm 依赖、Alpine 软件源**全部走国内镜像**，无需科学上网即可构建。

---

## 一、Docker 部署

一条 `docker compose up` 即可起一套完整环境：**Go 后端** + **nginx 托管前端并反向代理 `/api`（含 WebSocket 终端 / SSE 扫描日志）**。

### 架构

```
                    :8088 (宿主机)
                        │
                  ┌─────▼─────┐   /api/  反代(含 ws/sse)   ┌────────────┐
   浏览器  ───────▶   web      ├───────────────────────────▶   backend   │
                  │ nginx:80  │      meridian 内网          │   :8080    │
                  │  (SPA)    │                            │  Go + SQLite│
                  └───────────┘                            └─────┬──────┘
                                                                 │
                                                        meridian-data 卷
                                                         (/data/assets.db)
```

- 前端构建产物由 nginx 托管，`/api/` 反代到后端；终端 WebSocket 与扫描日志 SSE 均已配置长连接透传（`deploy/nginx.conf`）。
- 后端容器内监听 `0.0.0.0:8080`（由 `LISTEN_ADDR` 设定），但**默认不对外暴露端口**，仅在 compose 内网供 nginx 访问。
- API 已启用**会话鉴权 + 多租户隔离**：登录签发 Bearer 令牌，受保护路由服务端校验，管理员路由再校验角色；资产 / 凭据 / K8s 集群按 `owner_id` 隔离。
- 凭据（密码 / 私钥）按设计**明文**存储、SSH 用 `InsecureIgnoreHostKey()` 不校验主机密钥——这是面向内网运维的刻意取舍，公网暴露前请充分评估。
- SQLite 落在命名卷 `meridian-data`（`/data/assets.db`），容器重建不丢数据。

### 一键启动

```bash
# 在仓库根目录
docker compose up -d --build

# 查看日志
docker compose logs -f
```

访问 `http://<宿主机IP>:8088`，默认登录 **admin / admin**（首次登录强制改密）。

停止 / 清理：

```bash
docker compose down            # 停止并删除容器（数据卷保留）
docker compose down -v         # 连数据卷一起删（清空资产库）
```

### 国内镜像说明

| 环节 | 使用的国内源 | 位置 |
|------|------------|------|
| 基础镜像（golang / node / alpine / nginx） | DaoCloud 透明代理 Docker Hub `docker.m.daocloud.io` | 两个 `Dockerfile` 的 `ARG REGISTRY` |
| Go 模块 | 七牛 `goproxy.cn`，校验和 `sum.golang.google.cn` | `backend/Dockerfile` |
| npm 依赖 | 淘宝 `registry.npmmirror.com` | `frontend/Dockerfile` |
| Alpine apk | 阿里云 `mirrors.aliyun.com` | 两个 `Dockerfile` 运行阶段 |

换用其它镜像仓库——`REGISTRY` 可整体覆盖（例如公司内网 harbor 或阿里云 ACR）：

```bash
REGISTRY=registry.cn-hangzhou.aliyuncs.com/your-ns docker compose build
# 或单独 build：
docker build --build-arg REGISTRY=docker.io -f backend/Dockerfile -t meridian-backend .
```

> 若 Docker daemon 已在 `/etc/docker/daemon.json` 配了 `registry-mirrors`，
> 也可把 `REGISTRY` 设为标准名（`--build-arg REGISTRY=docker.io`）让 daemon 自己转发。

### 可配置项（环境变量）

后端读取以下环境变量（已在 `docker-compose.yml` 设好默认值）：

| 变量 | compose 默认 | 说明 |
|------|------|------|
| `LISTEN_ADDR` | `0.0.0.0:8080` | 监听地址；不设则裸跑默认 `127.0.0.1:8080` |
| `MERIDIAN_DB` | `/data/assets.db` | SQLite 文件路径；指向挂载卷以持久化（不设则默认当前目录 `assets.db`） |
| `TZ` | `Asia/Shanghai` | 时区（影响调度器与日志时间） |
| `MERIDIAN_LOCAL_SHELL` | （未设） | 设 `1` 开启「本机 Shell」本地终端（容器/普通服务端默认关，桌面端默认开） |

### 自定义对外端口

改 `docker-compose.yml` 里 `web` 服务的端口映射，例如对外 80：

```yaml
  web:
    ports:
      - "80:80"
```

### 调试：直连后端 API

默认后端不暴露。需要本机直连排查时，放开 `docker-compose.yml` 中 `backend` 的 `ports`：

```yaml
  backend:
    ports:
      - "8080:8080"
```

> ⚠️ 直连后端会绕过 nginx，且凭据为明文存储——仅用于本机排查，请勿在公网环境暴露 8080。

---

## 二、裸机部署（make server + nginx）

不想跑容器时，可直接编译出服务端二进制 `meridian-server`，配合任意 nginx 反代。

### 1) 构建

需要 **Go 1.22+**（纯 Go SQLite，**无需 CGO / gcc**）和 **Node 20+**（构建前端）。在仓库根目录：

```bash
make server      # 编译服务端二进制 backend/meridian-server（等价 make backend）
make frontend    # 构建前端到 frontend/dist
```

> `make server` 内部用 `CGO_ENABLED=0 GOTOOLCHAIN=local go build -o meridian-server ./cmd/server`。
> 不用 Makefile 也可手动：`cd backend && CGO_ENABLED=0 go build -o meridian-server ./cmd/server`。

### 2) 运行后端

```bash
cd backend
# 监听本机回环（默认）。如需让 nginx 跨机/跨容器反代，改成 0.0.0.0:8080
LISTEN_ADDR=127.0.0.1:8080 \
MERIDIAN_DB=/var/lib/lynx/assets.db \
TZ=Asia/Shanghai \
./meridian-server
```

- 不设 `LISTEN_ADDR` 时默认 `127.0.0.1:8080`；不设 `MERIDIAN_DB` 时默认在当前工作目录生成 `assets.db`。
- 首启自动建库 + 迁移表结构，并创建默认管理员 **admin / admin**（首次登录强制改密）。
- 需要本机 Shell 本地终端时再加 `MERIDIAN_LOCAL_SHELL=1`（普通服务端默认关）。
- 建议用 systemd / supervisor 守护进程，并把上述环境变量写进单元文件的 `Environment=`。

### 3) nginx 托管前端 + 反代 /api

把 `frontend/dist` 拷到 nginx 的站点根目录，反代 `/api`（含 WebSocket 终端与 SSE 扫描日志）。仓库已带一份可直接参考的配置 `deploy/nginx.conf`（容器内用的是 `proxy_pass http://backend:8080`，裸机改成本机地址即可）：

```nginx
# http 上下文里需要这段 map（WebSocket 升级用）
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 80;
    server_name _;
    root /var/www/lynx;          # 这里放 frontend/dist 的内容
    index index.html;

    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 后端 API + WebSocket 终端 + SSE 扫描日志
    location /api/ {
        proxy_pass http://127.0.0.1:8080;   # 裸机后端地址（容器内为 http://backend:8080）
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket 升级
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        # 终端 / SSE 长连接：关缓冲、放长超时
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

重载 nginx 后访问其监听端口即可，默认登录 **admin / admin**。

> 终端走 WebSocket、扫描日志走 SSE，二者都是长连接：`proxy_buffering off` 与长 `proxy_read_timeout` 必不可少，否则会出现「终端连不上 / 日志不刷新」。

---

## 三、常见问题

- **构建拉基础镜像超时** —— 换 `REGISTRY`，或给 daemon 配 `registry-mirrors` 后用 `--build-arg REGISTRY=docker.io`。
- **终端连不上 / WebSocket 握手失败** —— 确认通过 nginx（容器为 `:8088`）访问而非直连后端；nginx 需配 `Upgrade` 透传与长连接（见上）。若被扫目标在另一网段，注意中间防火墙可能拦 22 端口（与本平台无关）。
- **想保留旧的本机裸跑方式** —— 不受影响：不设 `LISTEN_ADDR` / `MERIDIAN_DB` 时行为与之前完全一致（监听 `127.0.0.1:8080`，库落当前目录 `assets.db`）。
- **凭据为何明文 / 为何不校验主机密钥** —— 面向内网运维的刻意设计，非缺陷；公网暴露前请自行评估并加固。
