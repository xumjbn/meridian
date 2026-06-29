# Meridian 构建入口
# 桌面端（Tauri + Go sidecar）+ 普通服务端构建。详见 docs/desktop.md
#
# macOS 上出桌面包：
#   make deps                      # 装前端依赖（含 Tauri CLI），一次即可
#   make icons SRC=路径/1024.png    # 生成并提交 src-tauri/icons/（首次必须）
#   make desktop                   # 当前架构 .app（可靠）+ 分发用 zip
#   make desktop-dmg               # 额外打 .dmg（依赖 Finder 自动化权限，偶发失败可重试）
#   make desktop-universal         # Intel + Apple Silicon 通用 .app

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT     := $(shell pwd)
BINDIR   := frontend/src-tauri/binaries
APP_NAME := Meridian
BUNDLE   := frontend/src-tauri/target/release/bundle
UBUNDLE  := frontend/src-tauri/target/universal-apple-darwin/release/bundle
# Rust 宿主三元组（如 aarch64-apple-darwin / x86_64-apple-darwin）
HOST     := $(shell rustc -Vv 2>/dev/null | sed -n 's/^host: //p')
GOENV    := CGO_ENABLED=0 GOTOOLCHAIN=local

.PHONY: help deps icons sidecar desktop desktop-dmg desktop-dev desktop-universal server backend frontend clean

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

desktop: sidecar ## 打桌面 .app（可靠，跳过易失败的 dmg）+ 分发用 zip
	cd frontend && npm run desktop:build -- --bundles app
	@ditto -c -k --keepParent "$(BUNDLE)/macos/$(APP_NAME).app" "$(BUNDLE)/macos/$(APP_NAME)-mac.zip" 2>/dev/null || true
	@echo ""
	@echo "✅ App : $(BUNDLE)/macos/$(APP_NAME).app"
	@echo "📦 Zip : $(BUNDLE)/macos/$(APP_NAME)-mac.zip （未签名，首次打开右键→打开）"

desktop-dmg: sidecar ## 额外打 .dmg（依赖 Finder 自动化权限；先清残留卷再打，偶发失败重试即可）
	-hdiutil detach "/Volumes/$(APP_NAME)" -force >/dev/null 2>&1
	cd frontend && npm run desktop:build -- --bundles app dmg
	@echo "✅ DMG : $(BUNDLE)/dmg/"

desktop-dev: sidecar ## 桌面端开发模式（热重载前端 + 起后端 sidecar）
	cd frontend && npm run desktop:dev

desktop-universal: ## macOS 通用 .app：同时支持 Intel + Apple Silicon（自动 lipo 合并 sidecar + zip）
	@command -v lipo >/dev/null || { echo "lipo 仅 macOS 可用"; exit 1; }
	@rustup target add aarch64-apple-darwin x86_64-apple-darwin
	mkdir -p $(BINDIR)
	cd backend && $(GOENV) GOOS=darwin GOARCH=arm64 go build -mod=mod -o ../$(BINDIR)/mb-arm64 ./cmd/server
	cd backend && $(GOENV) GOOS=darwin GOARCH=amd64 go build -mod=mod -o ../$(BINDIR)/mb-amd64 ./cmd/server
	lipo -create -output $(BINDIR)/meridian-backend-universal-apple-darwin $(BINDIR)/mb-arm64 $(BINDIR)/mb-amd64
	rm -f $(BINDIR)/mb-arm64 $(BINDIR)/mb-amd64
	cd frontend && npm run desktop:build -- --target universal-apple-darwin --bundles app
	@ditto -c -k --keepParent "$(UBUNDLE)/macos/$(APP_NAME).app" "$(UBUNDLE)/macos/$(APP_NAME)-universal-mac.zip" 2>/dev/null || true
	@echo ""
	@echo "✅ Universal App : $(UBUNDLE)/macos/$(APP_NAME).app"
	@echo "📦 Zip          : $(UBUNDLE)/macos/$(APP_NAME)-universal-mac.zip"

server: ## 仅构建服务端二进制（非桌面，给容器/裸机部署用）
	cd backend && $(GOENV) go build -mod=mod -o meridian-server ./cmd/server

backend: server ## 同 server

frontend: ## 仅构建前端 dist
	cd frontend && npm run build

clean: ## 清理桌面构建产物
	rm -rf frontend/src-tauri/target frontend/dist
	rm -f $(BINDIR)/meridian-backend-* backend/meridian-server
