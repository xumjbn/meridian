# Meridian 桌面端（Tauri + Go sidecar）

把 Meridian 打成 **macOS / Windows / Linux** 桌面应用。架构：

```
桌面窗口 (Tauri / 系统 WebView)
   └─ 加载打包进去的前端 dist（tauri://localhost）
   └─ 启动 sidecar：meridian-backend（Go，监听 127.0.0.1:8765）
          └─ Gin + WebSocket 终端 + SSE + SQLite（DB 存系统应用数据目录）
```

- 前端运行在 Tauri 下时，`api.ts` 自动把 API/WS 指向 `http://127.0.0.1:8765`（`BACKEND_ORIGIN`）；Web/容器部署仍走同源（nginx 反代 `/api`），互不影响。
- 后端是**纯 Go（免 cgo）**，可交叉编译到 win/mac/linux，作为 sidecar 二进制随包分发。
- 数据库落在系统应用数据目录（`app_data_dir/meridian.db`），卸载/重装不丢。

文件位置：`frontend/src-tauri/`（Tauri 工程）、`scripts/build-sidecar.*`（构建后端 sidecar）、`.github/workflows/desktop.yml`（CI 出三平台安装包）。

---

## 一、前置工具
- **Rust**（stable，含目标三元组）、**Go 1.22+**、**Node 20+**
- Tauri CLI 与 API 已加入 `frontend/package.json`，`cd frontend && npm install` 即装。
- Linux 额外系统依赖：`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## 二、一次性：生成图标（必须，否则打包失败）
Tauri 需要多分辨率图标。准备一张 ≥1024×1024 的 PNG（可用 `frontend/public/favicon.svg` 导出），然后：
```bash
cd frontend
npm run tauri icon path/to/logo-1024.png    # 生成 src-tauri/icons/ 全套
```
生成的 `src-tauri/icons/` 需**提交进仓库**（CI 也依赖它）。

## 三、本地构建（在目标 OS 上）
> macOS 包必须在 macOS 上出；Windows 包在 Windows 上出（Apple 签名/平台限制）。

### macOS：用 Makefile（推荐，一条命令）
```bash
make deps                      # 装前端依赖（含 Tauri CLI），一次即可
make icons SRC=path/1024.png   # 首次必须：生成并提交 src-tauri/icons/
make desktop                   # 当前架构 → .app（可靠）+ 分发用 zip
make desktop-dmg               # 额外打 .dmg（可选；依赖 Finder 自动化权限，偶发失败可重试）
make desktop-universal         # Intel + Apple Silicon 通用 .app（自动 lipo 合并 sidecar）
```
> **为什么默认只出 `.app`**：Tauri 的 `bundle_dmg.sh` 用 `hdiutil` + AppleScript 驱动 Finder，
> 对残留挂载卷、Finder 自动化权限很敏感，**易在最后一步失败**（`failed to run bundle_dmg.sh`）。
> 而 `.app` 在 dmg 之前就已生成、可直接运行/压缩分发，所以默认目标只出 `.app` + zip，最稳。
> 需要 `.dmg` 再单独 `make desktop-dmg`。

`make help` 看全部目标。下面是等价的手动步骤：

```bash
# 1) 构建 Go 后端 sidecar（按当前 Rust 宿主三元组命名到 src-tauri/binaries/）
#    Windows:
powershell -File scripts/build-sidecar.ps1
#    macOS/Linux:
bash scripts/build-sidecar.sh

# 2) 打包（自动先 npm run build 前端，再 tauri build）
cd frontend
npm install
npm run desktop:build
```
产物在 `frontend/src-tauri/target/release/bundle/`：
- macOS：`dmg/*.dmg`、`macos/*.app`
- Windows：`nsis/*-setup.exe`、`msi/*.msi`
- Linux：`appimage/*.AppImage`、`deb/*.deb`

调试运行：`npm run desktop:dev`（热重载前端 + 起后端 sidecar）。

## 四、推荐：用 CI 一次出齐 mac + win + linux
这台开发机是 Windows，出不了 mac 包。用 GitHub Actions（已配 `.github/workflows/desktop.yml`）：
- 手动触发（Actions → desktop-build → Run）或打 `v*` tag 触发；
- 在 macOS(Apple/Intel)、Windows、Linux runner 上分别：构建 Go sidecar → 前端 → `tauri build`；
- 安装包作为 workflow artifacts 下载。

> 需先把 `src-tauri/icons/` 提交（见第二步），否则各平台 `tauri build` 会因缺图标失败。

## 五、签名 / 公证（生产分发，可选）
- **macOS**：需 Apple Developer 证书做 codesign + notarytool 公证，否则用户首次打开要右键→打开。证书走 CI secrets（`APPLE_CERTIFICATE` 等）。
- **Windows**：需代码签名证书避免 SmartScreen 拦截。
- 未签名也能用（内网分发场景足够），只是首次启动有系统提示。

## 六、故障排查
### `failed to run bundle_dmg.sh`（打 dmg 时）
`.app` 其实已经打好了（在 `target/release/bundle/macos/Meridian.app`，可直接运行）。dmg 步骤失败多为：
1. **残留挂载卷**：上次失败留下 `/Volumes/Meridian`，先卸载再重试：
   ```bash
   hdiutil detach "/Volumes/Meridian" -force 2>/dev/null
   make desktop-dmg
   ```
2. **Finder 自动化权限被拒**：`系统设置 → 隐私与安全性 → 自动化`，允许「终端 / iTerm」控制「访达(Finder)」。
3. **没有图形会话**（纯 SSH/CI 跑）：dmg 的窗口排版用 AppleScript 需要 GUI；CI 用 `tauri-action` 或改出 `.app` 即可。
> 实在不需要 dmg，就用 `make desktop`（只出 `.app` + zip），最稳。

## 七、已知点 / 后续
- 后端 sidecar 固定监听 `127.0.0.1:8765`；若与本机其它服务冲突，可改 `main.rs` 的 `LISTEN_ADDR` 与 `api.ts` 的 `DESKTOP_BACKEND`（后续可做随机端口 + 启动后回传前端）。
- 首启后端迁移 DB 约 <1s，期间登录请求可能短暂失败，重试即可（后续可加就绪探测）。
- 桌面端是**单机本地实例**（自带 SQLite），与服务器/容器多用户部署相互独立。
