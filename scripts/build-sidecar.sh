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
out="$bindir/wjw-backend-$triple$ext"

echo "构建后端 sidecar -> $out"
# -trimpath -ldflags "-s -w"：与 release.yml 的正式构建保持一致。
# 不加的话符号表和 DWARF 都留在二进制里，sidecar 从 15MB 涨到 22MB，
# 安装包白胖 7MB；panic 栈仍然可读，剥掉的只是调试信息。
( cd "$repo/backend" && CGO_ENABLED=0 GOTOOLCHAIN=local \
    go build -mod=mod -trimpath -ldflags "-s -w" -o "$out" ./cmd/server )
ls -l "$out"
echo "完成。"
