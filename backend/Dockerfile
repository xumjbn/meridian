# syntax=docker/dockerfile:1
# Lynx 后端镜像（Go，纯 Go SQLite，无需 cgo）
# 基础镜像默认走 DaoCloud 的 Docker Hub 国内镜像，可用 --build-arg REGISTRY=... 覆盖
ARG REGISTRY=docker.m.daocloud.io

# ---------- 构建阶段 ----------
FROM ${REGISTRY}/library/golang:1.22-alpine AS builder
WORKDIR /src
# Go 模块走七牛 goproxy.cn，校验和走 google.cn 镜像
ENV GOPROXY=https://goproxy.cn,direct \
    GOSUMDB=sum.golang.google.cn \
    CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64
# 先拉依赖，利用层缓存
COPY backend/go.mod backend/go.sum ./
RUN go mod download
# 再拷源码编译
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/meridian ./cmd/server

# ---------- 运行阶段 ----------
FROM ${REGISTRY}/library/alpine:3.20
# Alpine 软件源切到阿里云镜像，装 CA 证书与时区
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories \
    && apk add --no-cache ca-certificates tzdata wget
ENV TZ=Asia/Shanghai \
    LISTEN_ADDR=0.0.0.0:8080 \
    MERIDIAN_DB=/data/assets.db
WORKDIR /app
COPY --from=builder /out/meridian /app/meridian
# SQLite 数据落在挂载卷里，保证容器重建不丢数据
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/app/meridian"]
