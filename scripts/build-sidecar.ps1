# Build the Go backend as a Tauri sidecar (named with the Rust host triple so externalBin matches).
# Usage: powershell -File scripts/build-sidecar.ps1
# NOTE: keep this script ASCII-only. Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI (GBK on
#       Chinese systems), which corrupts non-ASCII bytes and breaks quote/brace parsing.
$ErrorActionPreference = "Stop"

# Rust host triple (e.g. x86_64-pc-windows-msvc)
$triple = ((rustc -Vv) | Select-String "^host:").ToString().Split(" ")[1]
$ext = if ($triple -like "*windows*") { ".exe" } else { "" }

$repo = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $repo "frontend/src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$out = Join-Path $binDir "meridian-backend-$triple$ext"

Write-Host "Building backend sidecar -> $out"
$env:CGO_ENABLED = "0"
$env:GOTOOLCHAIN = "local"
& go -C (Join-Path $repo "backend") build -mod=mod -o $out ./cmd/server
Write-Host "Done."
