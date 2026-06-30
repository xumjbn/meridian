# One-command Windows desktop installer build (Go sidecar + Tauri build).
# Windows packages must be built on Windows. Prereqs: Rust (MSVC) + VS C++ Build Tools, Node, Go,
# WebView2 (bundled on Win11). Usage: powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
# NOTE: keep this script ASCII-only. Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI (GBK on
#       Chinese systems), which corrupts non-ASCII bytes and makes the whole script fail to parse.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# 1) Prerequisite checks
foreach ($t in @("rustc", "cargo", "go", "npm")) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $t" -ForegroundColor Red
    if ($t -in @("rustc", "cargo")) {
      Write-Host "  Install Rust (MSVC):" -ForegroundColor Yellow
      Write-Host '  winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
      Write-Host "  winget install Rustlang.Rustup ; rustup default stable-msvc"
    }
    exit 1
  }
}

# 2) Frontend deps (incl. Tauri CLI)
Push-Location (Join-Path $repo "frontend")
if (-not (Test-Path "node_modules/@tauri-apps/cli")) {
  Write-Host "Installing frontend deps..." -ForegroundColor Cyan
  npm install
}
Pop-Location

# 3) Build Go backend sidecar (named with Rust triple into src-tauri/binaries)
& (Join-Path $PSScriptRoot "build-sidecar.ps1")

# 4) Bundle (beforeBuildCommand runs the frontend build first, then tauri build)
Push-Location (Join-Path $repo "frontend")
npm run desktop:build
Pop-Location

Write-Host ""
Write-Host "Installers: frontend/src-tauri/target/release/bundle/" -ForegroundColor Green
Write-Host "  NSIS: nsis/*-setup.exe (recommended for distribution)"
Write-Host "  MSI : msi/*.msi"
