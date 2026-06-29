# 构建 Go 后端为 Tauri sidecar（命名带 Rust 目标三元组，供 externalBin 匹配）
# 用法：powershell -File scripts/build-sidecar.ps1
$ErrorActionPreference = "Stop"

# 取 Rust 宿主三元组（如 x86_64-pc-windows-msvc）
$triple = ((rustc -Vv) | Select-String "^host:").ToString().Split(" ")[1]
$ext = if ($triple -like "*windows*") { ".exe" } else { "" }

$repo = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $repo "frontend/src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$out = Join-Path $binDir "meridian-backend-$triple$ext"

Write-Host "构建后端 sidecar -> $out"
$env:CGO_ENABLED = "0"
$env:GOTOOLCHAIN = "local"
& go -C (Join-Path $repo "backend") build -mod=mod -o $out ./cmd/server
Write-Host "完成。"
