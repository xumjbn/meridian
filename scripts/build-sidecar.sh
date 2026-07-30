#!/usr/bin/env bash
# 构建 Go 后端为 Tauri sidecar（命名带 Rust 目标三元组，供 externalBin 匹配）
# 用法：bash scripts/build-sidecar.sh
set -euo pipefail

# 目标三元组优先问 rustc。但不能只靠它：某些 shell（后台任务、CI 的精简
# 环境）PATH 里没有 rustc，脚本会在这一行 set -e 退出，而调用方若用 ; 串起
# tauri build，就会拿着上一次的旧 sidecar 继续打包——包能出、版本号也对，
# 唯独后端是旧的。这种「静默用旧二进制打包」比直接失败难查得多，
# 所以这里给出兜底，并把实际用的三元组打出来。
if triple="$(rustc -Vv 2>/dev/null | sed -n 's/^host: //p')" && [ -n "$triple" ]; then
  echo "目标三元组（rustc）: $triple"
else
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) triple="x86_64-pc-windows-msvc" ;;
    Darwin) [ "$(uname -m)" = "arm64" ] && triple="aarch64-apple-darwin" || triple="x86_64-apple-darwin" ;;
    *)      triple="x86_64-unknown-linux-gnu" ;;
  esac
  echo "警告：找不到 rustc，按当前系统推断三元组: $triple"
fi
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
