# 在 Windows 本机一条命令出桌面安装包（Go sidecar + Tauri build）。
# Windows 包必须在 Windows 上出。前置：Rust(含 MSVC C++ 生成工具)、Node、Go、WebView2(Win11 自带)。
# 用法: powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# 1) 前置检查
foreach ($t in @("rustc", "cargo", "go", "npm")) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 缺少 $t。" -ForegroundColor Red
    if ($t -in @("rustc", "cargo")) {
      Write-Host "   安装 Rust(MSVC):" -ForegroundColor Yellow
      Write-Host '   winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
      Write-Host "   winget install Rustlang.Rustup ; rustup default stable-msvc"
    }
    exit 1
  }
}

# 2) 前端依赖（含 Tauri CLI）
Push-Location (Join-Path $repo "frontend")
if (-not (Test-Path "node_modules/@tauri-apps/cli")) {
  Write-Host "安装前端依赖..." -ForegroundColor Cyan
  npm install
}
Pop-Location

# 3) 构建 Go 后端 sidecar（按 Rust 三元组命名到 src-tauri/binaries）
& (Join-Path $PSScriptRoot "build-sidecar.ps1")

# 4) 打包（beforeBuildCommand 会先 npm run build 前端，再 tauri build）
Push-Location (Join-Path $repo "frontend")
npm run desktop:build
Pop-Location

Write-Host ""
Write-Host "✅ 安装包: frontend/src-tauri/target/release/bundle/" -ForegroundColor Green
Write-Host "   NSIS:  nsis/*-setup.exe（推荐分发）"
Write-Host "   MSI :  msi/*.msi"
