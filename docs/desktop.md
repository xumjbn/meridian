# Lynx · 猞猁 桌面端（Tauri v2 + Go sidecar）

> 当前版本 **v0.64**

把 Lynx 打成 **macOS / Windows / Linux** 桌面应用。后端不变，仍是那套 Go 服务，只是作为 **sidecar 子进程**随包分发、监听本地回环端口；前端打包进 WebView 直接连它。架构：

```
桌面窗口 (Tauri v2 / 系统 WebView)
   └─ 加载打包进去的前端 dist（tauri://localhost）
   └─ 启动 sidecar：meridian-backend（Go，监听 127.0.0.1:8765）
          └─ Gin + WebSocket 终端 + SSE + 本机 Shell 终端 + SQLite
             （DB 存系统应用数据目录 app_data_dir/meridian.db）
```

- 前端运行在 Tauri 下时（检测到 `__TAURI_INTERNALS__`），`services/api.ts` 自动把 API / WS 指向 `http://127.0.0.1:8765`（`BACKEND_ORIGIN = DESKTOP_BACKEND`）；Web / 容器部署仍走同源（nginx 反代 `/api`），互不影响。
- 后端是**纯 Go（免 CGO，glebarez/sqlite 纯 Go 驱动）**，可交叉编译到 win / mac / linux，作为外部二进制 `binaries/meridian-backend` 随包分发。
- 数据库落在系统应用数据目录（`app_data_dir/meridian.db`），卸载 / 重装不丢。
- 应用退出时 Tauri 会一并 `kill` sidecar 子进程（见 `main.rs` 的 `WindowEvent::Destroyed`）。

工程关键标识（**底层技术标识符，勿改**）：productName `Lynx`、窗口标题 `Lynx · 猞猁`、Tauri identifier `cn.meridian.desktop`、version `0.64.0`、CSP `null`、sidecar 二进制名 `meridian-backend`。

文件位置：`frontend/src-tauri/`（Tauri 工程）、`scripts/build-sidecar.{sh,ps1}`（构建后端 sidecar）、`scripts/build-desktop.ps1`（Windows 一键）、`scripts/make-dmg.sh`（hdiutil 出 dmg）、`.github/workflows/desktop.yml`（CI 出三平台安装包）。

---

## 一、桌面端特性

- **免登录自动登录**：在 Tauri 下，前端启动时自动用默认管理员凭据登录，依次尝试 `admin/admin` → `admin/123456`，成功即进主界面；都失败才落到登录页（见 `App.tsx`）。桌面端是单机本地实例，不强制改密。
- **原生剪贴板**：复制 / 粘贴走系统剪贴板（`@tauri-apps/plugin-clipboard-manager`，能力里放开 `allow-read-text` / `allow-write-text`）。
- **外部链接走系统浏览器**：终端里可点击的链接用 `shell:allow-open` 由系统默认浏览器打开，不在 WebView 内跳转。
- **本机 Shell 本地终端**：sidecar 注入 `MERIDIAN_LOCAL_SHELL=1`，因此桌面端自带「本机终端」（`/ws/local-terminal`），普通服务端默认关闭。
- 这些权限集中在 `frontend/src-tauri/capabilities/default.json`：`core:default`、`shell:default`、`shell:allow-open`、`clipboard-manager:allow-read-text`、`clipboard-manager:allow-write-text`。

### sidecar 注入的环境变量（`main.rs`）

Tauri 启动 sidecar 时注入下列环境变量：

| 变量 | 值 | 说明 |
|------|----|------|
| `LISTEN_ADDR` | `127.0.0.1:8765` | sidecar 仅监听本地回环 8765 |
| `MERIDIAN_DB` | `app_data_dir/meridian.db` | 数据库放系统应用数据目录，持久化 |
| `MERIDIAN_LOCAL_SHELL` | `1` | 桌面端=本机，启用本地终端 |
| `TZ` | `Asia/Shanghai` | 时区 |

---

## 二、前置工具
- **Rust**（stable，含目标三元组）、**Go 1.22+**、**Node 20+**
- Tauri CLI 与 API 已在 `frontend/package.json`，`cd frontend && npm install`（或 `make deps`）即装。
- Linux 额外系统依赖：`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## 三、一次性：生成图标（必须，否则打包失败）
Tauri 需要多分辨率图标。准备一张 ≥1024×1024 的 PNG（可用 `frontend/public/favicon.svg` 导出），然后任选其一：
```bash
make icons SRC=path/to/logo-1024.png        # 推荐
# 或：
cd frontend && npx @tauri-apps/cli icon path/to/logo-1024.png
```
生成的 `frontend/src-tauri/icons/` 需**提交进仓库**（CI 也依赖它）。

## 四、本地构建（在目标 OS 上）
> macOS 包必须在 macOS 上出；Windows 包必须在 Windows 上出；Linux 包在 Linux 上出（平台 / 签名限制）。

### Makefile 目标速查（macOS / Linux，`make help` 看全部）

| 目标 | 作用 |
|------|------|
| `make deps` | 装前端依赖（含 Tauri CLI / API），一次即可 |
| `make icons SRC=…` | 生成并提交 `src-tauri/icons/`（首次必须） |
| `make sidecar` | 按当前 Rust 宿主三元组交叉编译 Go sidecar |
| `make desktop` | 当前架构 → `.app` + 可安装 `.dmg`（先建 sidecar，再 hdiutil 出 dmg） |
| `make desktop-dmg` | 仅从已构建好的 `.app` 重新生成 `.dmg`（不重新编译） |
| `make desktop-dev` | 桌面开发模式（热重载前端 + 起 sidecar） |
| `make desktop-universal` | Intel + Apple Silicon 通用 `.app` + `.dmg`（lipo 合并 sidecar） |
| `make server` / `make backend` | 仅构建服务端二进制 `meridian-server`（容器 / 裸机用） |
| `make frontend` | 仅构建前端 `dist` |
| `make clean` | 清理 `target/` `dist/` 与二进制 |

### macOS：用 Makefile（推荐）
```bash
make deps                      # 装前端依赖（含 Tauri CLI），一次即可
make icons SRC=path/1024.png   # 首次必须：生成并提交 src-tauri/icons/
make desktop                   # 当前架构 → .app + 可安装 .dmg
make desktop-dmg               # 仅从已构建好的 .app 重新生成 .dmg（不重新编译）
make desktop-universal         # Intel + Apple Silicon 通用 .app + .dmg
```
> **dmg 怎么来的**：不走 Tauri 的 `bundle_dmg.sh`（它用 AppleScript 驱动 Finder，对残留挂载卷 /
> Finder 自动化权限敏感，**易失败**：`failed to run bundle_dmg.sh`）。`make desktop` 先用 `--bundles app` 出 `.app`，
> 再由 `scripts/make-dmg.sh` 用 `hdiutil` 直接打成「拖入 Applications 安装」的 dmg —— 无需 AppleScript，最稳。
> 产物：`frontend/src-tauri/target/release/bundle/dmg/Lynx.dmg`。未签名，首次打开右键→打开。

### Windows：一条命令（在 Windows 本机出 .exe / .msi）
```powershell
# 前置（仅首次）：装 Rust(含 MSVC C++ 生成工具)；Node/Go/WebView2(Win11 自带) 一般已具备
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Rustlang.Rustup
rustup default stable-msvc

# 一条命令：前置检查 → 装前端依赖 → 构建 Go sidecar → tauri build
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```
产物在 `frontend/src-tauri/target/release/bundle/`：`nsis/*-setup.exe`（推荐分发）、`msi/*.msi`。
> 本仓库这台开发机即 Windows，可直接出 Win 包。该脚本会先检查 `rustc/cargo/go/npm` 是否齐备，缺啥提示装啥。

### 等价的手动步骤（任意平台）
```bash
# 1) 构建 Go 后端 sidecar（按当前 Rust 宿主三元组命名到 src-tauri/binaries/）
#    Windows:
powershell -File scripts/build-sidecar.ps1
#    macOS/Linux:
bash scripts/build-sidecar.sh

# 2) 打包（tauri build 的 beforeBuildCommand 会先 npm run build 前端，再出包）
cd frontend
npm install
npm run desktop:build
```
产物在 `frontend/src-tauri/target/release/bundle/`：
- macOS：`dmg/*.dmg`、`macos/*.app`
- Windows：`nsis/*-setup.exe`、`msi/*.msi`
- Linux：`appimage/*.AppImage`、`deb/*.deb`

调试运行：`make desktop-dev` 或 `cd frontend && npm run desktop:dev`（热重载前端 + 起 sidecar）。

## 五、推荐：用 CI 一次出齐 mac + win + linux
这台开发机是 Windows，出不了 mac 包。用 GitHub Actions（已配 `.github/workflows/desktop.yml`）：
- 手动触发（Actions → desktop-build → Run）或打 `v*` tag 触发；
- 在 macOS(Apple/Intel)、Windows、Linux runner 上分别：构建 Go sidecar → 前端 → `tauri build`；
- 安装包作为 workflow artifacts 下载。

> 需先把 `frontend/src-tauri/icons/` 提交（见第三步），否则各平台 `tauri build` 会因缺图标失败。

## 六、签名 / 公证（生产分发，可选）
- **macOS**：需 Apple Developer 证书做 codesign + notarytool 公证，否则用户首次打开要右键→打开。证书走 CI secrets（`APPLE_CERTIFICATE` 等）。
- **Windows**：需代码签名证书避免 SmartScreen 拦截。
- 未签名也能用（内网分发场景足够），只是首次启动有系统提示。

## 七、故障排查
### dmg 相关
本仓库的 `make desktop` 用 `hdiutil`（`scripts/make-dmg.sh`）直接出 dmg，已绕开 Tauri 那个易失败的 `bundle_dmg.sh`。若 `hdiutil` 仍报错，基本是**残留挂载卷**占用：
```bash
hdiutil detach "/Volumes/Lynx" -force 2>/dev/null
make desktop-dmg   # 从已构建好的 .app 重新出 dmg，不重新编译
```
> 若你坚持用 Tauri 原生 dmg（带自定义窗口背景），需在 `系统设置 → 隐私与安全性 → 自动化`
> 允许「终端」控制「访达(Finder)」，且必须有图形会话（纯 SSH / CI 跑不了）。

### sidecar / 端口
- sidecar 固定监听 `127.0.0.1:8765`；若与本机其它服务冲突，需同时改 `main.rs` 注入的 `LISTEN_ADDR` 与 `api.ts` 的 `DESKTOP_BACKEND`（后续可做随机端口 + 启动后回传前端）。
- 找不到 sidecar：报「未找到 meridian-backend sidecar」说明 `binaries/` 下没有匹配当前三元组的二进制，先 `make sidecar`（或 `scripts/build-sidecar.*`）。
- 首启后端迁移 DB 约 <1s，期间登录请求可能短暂失败，重试即可（后续可加就绪探测）。

## 八、已知点
- 桌面端是**单机本地实例**（自带 SQLite，库在 `app_data_dir/meridian.db`），与服务器 / 容器多用户部署相互独立。
- 凭据明文存库、SSH 用 `InsecureIgnoreHostKey()` 不校验主机密钥——面向本机 / 内网运维的刻意设计，非缺陷。
