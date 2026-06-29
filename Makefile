# Meridian 构建入口
# 桌面端（Tauri + Go sidecar）+ 普通服务端构建。详见 docs/desktop.md
#
# macOS 上出桌面包：
#   make deps                      # 装前端依赖（含 Tauri CLI），一次即可
#   make icons SRC=路径/1024.png    # 生成并提交 src-tauri/icons/（首次必须）
#   make desktop                   # 当前架构 .dmg/.app
#   make desktop-universal         # Intel + Apple Silicon 通用包（推荐分发）

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT     := $(shell pwd)
BINDIR   := frontend/src-tauri/binaries
# Rust 宿主三元组（如 aarch64-apple-darwin / x86_64-apple-darwin）
HOST     := $(shell rustc -Vv 2>/dev/null | sed -n 's/^host: //p')
GOENV    := CGO_ENABLED=0 GOTOOLCHAIN=local

.PHONY: help deps icons sidecar desktop desktop-dev desktop-universal server backend frontend clean

help: ## 显示可用目标
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

deps: ## 安装前端依赖（含 Tauri CLI / API）
	cd frontend && npm install

icons: ## 生成 Tauri 图标：make icons SRC=path/to/1024.png（生成后需提交）
ifndef SRC
	$(error 用法: make icons SRC=path/to/1024.png （≥1024x1024 PNG）)
endif
	cd frontend && npx @tauri-apps/cli icon "$(abspath $(SRC))"

sidecar: ## 按当前 Rust 宿主三元组交叉编译 Go 后端 sidecar
	bash scripts/build-sidecar.sh

desktop: sidecar ## 打桌面包（当前架构）：dmg/app/msi/exe → src-tauri/target/release/bundle
	cd frontend && npm run desktop:build

desktop-dev: sidecar ## 桌面端开发模式（热重载前端 + 起后端 sidecar）
	cd frontend && npm run desktop:dev

desktop-universal: ## macOS 通用包：同一 .dmg 同时支持 Intel + Apple Silicon
	@command -v lipo >/dev/null || { echo "lipo 仅 macOS 可用"; exit 1; }
	@rustup target add aarch64-apple-darwin x86_64-apple-darwin
	mkdir -p $(BINDIR)
	cd backend && $(GOENV) GOOS=darwin GOARCH=arm64 go build -mod=mod -o ../$(BINDIR)/mb-arm64 ./cmd/server
	cd backend && $(GOENV) GOOS=darwin GOARCH=amd64 go build -mod=mod -o ../$(BINDIR)/mb-amd64 ./cmd/server
	lipo -create -output $(BINDIR)/meridian-backend-universal-apple-darwin $(BINDIR)/mb-arm64 $(BINDIR)/mb-amd64
	rm -f $(BINDIR)/mb-arm64 $(BINDIR)/mb-amd64
	cd frontend && npm run desktop:build -- --target universal-apple-darwin

server: ## 仅构建服务端二进制（非桌面，给容器/裸机部署用）
	cd backend && $(GOENV) go build -mod=mod -o meridian-server ./cmd/server

backend: server ## 同 server

frontend: ## 仅构建前端 dist
	cd frontend && npm run build

clean: ## 清理桌面构建产物
	rm -rf frontend/src-tauri/target frontend/dist
	rm -f $(BINDIR)/meridian-backend-* backend/meridian-server
