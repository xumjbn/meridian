# Meridian · 子午 —— Docker 部署

一条 `docker compose up` 即可起一套完整环境：**Go 后端** + **nginx 托管前端并反向代理 `/api`（含 WebSocket 终端 / SSE 日志）**。
所有基础镜像、Go 模块、npm 依赖、Alpine 软件源**全部走国内镜像**，无需科学上网即可构建。

## 架构

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

- 前端构建产物由 nginx 托管，`/api/` 反代到后端；终端 WebSocket 与扫描日志 SSE 均已配置长连接透传。
- 后端默认**不对外暴露端口**，仅在 compose 内网供 nginx 访问。
- API 已启用**会话鉴权 + 多租户隔离**（登录签发 Bearer 令牌，受保护路由服务端校验，管理员路由再校验角色）；但凭据仍**明文**存储、SSH 未校验主机密钥，公网暴露前请充分评估。
- SQLite 落在命名卷 `meridian-data`，容器重建不丢数据。

## 一键启动

```bash
# 在仓库根目录
docker compose up -d --build

# 查看日志
docker compose logs -f

# 访问：http://<宿主机IP>:8088   默认登录 admin / admin（首次登录强制改密）
```

停止 / 清理：

```bash
docker compose down            # 停止并删除容器（数据卷保留）
docker compose down -v         # 连数据卷一起删（清空资产库）
```

## 国内镜像说明

| 环节 | 使用的国内源 | 位置 |
|------|------------|------|
| 基础镜像（golang / node / alpine / nginx） | DaoCloud 透明代理 Docker Hub `docker.m.daocloud.io` | 两个 `Dockerfile` 的 `ARG REGISTRY` |
| Go 模块 | 七牛 `goproxy.cn`，校验和 `sum.golang.google.cn` | `backend/Dockerfile` |
| npm 依赖 | 淘宝 `registry.npmmirror.com` | `frontend/Dockerfile` |
| Alpine apk | 阿里云 `mirrors.aliyun.com` | 两个 `Dockerfile` 运行阶段 |

### 换用其它镜像仓库

`REGISTRY` 可整体覆盖（例如换成公司内网 harbor 或阿里云 ACR）：

```bash
REGISTRY=registry.cn-hangzhou.aliyuncs.com/your-ns docker compose build
# 或单独 build：
docker build --build-arg REGISTRY=docker.io -f backend/Dockerfile -t meridian-backend .
```

> 若你的 Docker daemon 已在 `/etc/docker/daemon.json` 配了 `registry-mirrors`，
> 也可以把 `REGISTRY` 设为 `library` 前缀的标准名（`--build-arg REGISTRY=docker.io`）让 daemon 自己转发。

## 可配置项（环境变量）

后端读取以下环境变量（已在 `docker-compose.yml` 设好默认值）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `LISTEN_ADDR` | `0.0.0.0:8080` | 监听地址；本地裸跑默认 `127.0.0.1:8080` |
| `MERIDIAN_DB` | `/data/assets.db` | SQLite 文件路径；指向挂载卷以持久化 |
| `TZ` | `Asia/Shanghai` | 时区（影响调度器与日志时间） |

## 自定义对外端口

改 `docker-compose.yml` 里 `web` 服务的端口映射，例如对外 80：

```yaml
  web:
    ports:
      - "80:80"
```

## 调试：直连后端 API

默认后端不暴露。需要本机直连排查时，放开 `docker-compose.yml` 中 `backend` 的 `ports`：

```yaml
  backend:
    ports:
      - "8080:8080"
```

> ⚠️ 直连后端会绕过 nginx，且凭据为明文存储——仅用于本机排查，请勿在公网环境暴露 8080。

## 常见问题

- **构建拉基础镜像超时** —— 换 `REGISTRY`，或给 daemon 配 `registry-mirrors` 后用 `--build-arg REGISTRY=docker.io`。
- **终端连不上 / WebSocket 握手失败** —— 确认通过 `:8088`（nginx）访问而非直连后端；nginx 已配 `Upgrade` 透传。
  若被扫目标本身在另一网段，注意中间防火墙可能拦 22 端口（与本平台无关）。
- **想保留旧的本机裸跑方式** —— 不受影响：不设 `LISTEN_ADDR` / `MERIDIAN_DB` 时行为与之前完全一致。
