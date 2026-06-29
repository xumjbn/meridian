#!/usr/bin/env bash
# 构建 Go 后端为 Tauri sidecar（命名带 Rust 目标三元组，供 externalBin 匹配）
# 用法：bash scripts/build-sidecar.sh
set -euo pipefail

triple="$(rustc -Vv | sed -n 's/^host: //p')"
ext=""
case "$triple" in *windows*) ext=".exe" ;; esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
bindir="$repo/frontend/src-tauri/binaries"
mkdir -p "$bindir"
out="$bindir/meridian-backend-$triple$ext"

echo "构建后端 sidecar -> $out"
( cd "$repo/backend" && CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -o "$out" ./cmd/server )
echo "完成。"
