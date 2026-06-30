# syntax=docker/dockerfile:1
# Lynx 前端镜像（Vite 构建 → nginx 托管 SPA 并反代 /api）
ARG REGISTRY=docker.m.daocloud.io

# ---------- 构建阶段 ----------
# 用 debian-slim 的 node 以避免 alpine(musl) 下 rollup/esbuild 原生可选依赖的兼容问题
FROM ${REGISTRY}/library/node:20-slim AS builder
WORKDIR /app
# npm 走淘宝 npmmirror 国内源
ENV npm_config_registry=https://registry.npmmirror.com
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY frontend/ ./
RUN npm run build

# ---------- 运行阶段 ----------
FROM ${REGISTRY}/library/nginx:1.27-alpine
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
