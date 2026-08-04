<div align="center">

<img src="frontend/public/favicon.svg" width="76" alt="wjw logo" />

# wjw

**Network Asset Discovery & Unified Access Platform**

Discover → Map → Access, in one self-contained app.

**English · [中文](README.zh-CN.md)**

</div>

---

## Overview

**wjw** is a self-contained, full-stack, lightweight platform for internal network asset management and unified access.
A single command runs a concurrent discovery scan across a subnet, auto-maps live hosts into a CMDB, centrally vaults
login credentials, and lets you **open a full-featured terminal — right inside the browser or desktop app** — to reach
any device. No more bouncing between a CMDB, a jump host, an SSH client and an SFTP tool.

It collapses *discover → inventory → vault → remote access → file transfer → ops automation* into one screen: at once a
queryable CMDB and an always-ready web jump box.

## Core Capabilities

| Module | What it does |
|--------|--------------|
| 💻 **Terminal / Shell** (core) | A **full multi-tab terminal in the browser**: SSH / Telnet / **local shell** in one, with split panes, command broadcast, completion, on-screen search, color themes, reconnect replay and auto credential binding — see [Terminal / Shell in depth](#terminal--shell-in-depth) below |
| 🛰️ Auto-discovery | Concurrent CIDR / IP-range scanning, port probing and device-type fingerprinting, **live SSE progress**, **scheduled scans** (`@every` / daily) |
| 🗂️ CMDB inventory | Asset CRUD, tags, port visualization, liveness probe, detail drawer, **grouping / bulk ops / CSV import-export / change history / ownership assignment** |
| 🧬 Fact collection | Bind an SSH credential to collect **CPU architecture** and **virtualization (VM / cloud / container)** in one click, shown as list tags |
| 🟢 Availability monitor | Background periodic probing + **uptime history**, auto alerts on down / recovery |
| 🐞 Vulnerability scan | Pluggable engines, **nuclei** integration (graceful degradation when the binary is absent) |
| 🔐 Credential vault | Centrally hold SSH passwords / keys / Telnet accounts (**non-standard ports supported**), with **connectivity test** |
| 📁 SFTP file manager | Browse / upload (drag-drop) / download / mkdir / delete / rename, **fully audited** |
| 🤖 AI command assistant / Agent | Natural language → shell (OpenAI-compatible): (1) generate a single command for confirmation; (2) **autonomous Agent** — describe a task and it runs commands, reads output and iterates, with multi-turn memory, pause-on-dangerous-command confirmation and full audit; a **dockable, resizable panel** with **conversation history** and **persistence** across restarts |
| 📣 Notifications | Push scan-complete / asset-offline events to **WeCom / DingTalk / generic Webhook** |
| 📊 Dashboard | Asset posture, live rate, type distribution, recent-activity timeline, real-time polling (ownership-scoped) |
| 👥 Multi-user / multi-tenant | Session auth (bcrypt), **registration approval**, admin / user RBAC, **per-owner data isolation**, login-failure lockout + forced first-login password change |
| 🧾 Audit / search | Full write-operation audit log (admin-visible), global search (Ctrl/Cmd + K) |
| 🖥️ Desktop client | Packaged with **Tauri v2** (Rust), shipping the Go backend as a sidecar for a zero-config launch; system clipboard, external links open in the system browser, and **automatic login** with no credential entry |
| ☸️ Kubernetes | Cluster registration, node classification (manual / auto), cluster-VIP detection, live board (nodes / pods, API token required), web-console entry |

<a name="terminal--shell-in-depth"></a>

## Terminal / Shell in depth

The terminal is the heart of wjw. It isn't a bare-minimum WebSSH — it's a terminal workbench you can use as your daily
driver, built on `@xterm/xterm` v6 + a bidirectional WebSocket stream, backed by `golang.org/x/crypto/ssh` / Telnet /
a native local PTY.

**Three transports, one experience**

- **SSH** — password / private key, non-standard ports, protocol-level keepalive (survives screen-lock / suspend)
- **Telnet** — friendly to legacy gear (switches / routers / firewalls)
- **Local terminal** — spawn a native local shell (Windows / macOS / Linux PTY) without connecting anywhere first

**Multi-tab · split panes**

- In-app **tabs** with drag-reorder, rename + color, duplicate, middle-click close
- **Split panes**: single / dual / quad, each an independent session with its own close, drag-resizable rows/cols, single-pane maximize
- **Quick-connect sidebar**: one-click open a tab for a frequent host; newly added hosts / tabs refresh **live**

**Efficient input**

- **Command completion** — ghost-text hint + candidate list, 200+ built-in ops commands plus history
- **Command broadcast** — type once, broadcast to every synced terminal (great for fleet ops)
- **On-screen search** — `Ctrl+F` to find, highlight and jump within the scrollback
- **Font zoom** — `Ctrl+wheel` / `Ctrl + =/-` / `Ctrl+0` to reset
- **Clipboard** — `Ctrl+Shift+C/V`, URLs auto-detected and clickable

**Look & resilience**

- **7 switchable color themes**, GPU (WebGL) rendering with graceful DOM fallback
- **Reconnect history replay** — auto-reconnect (exponential backoff) and replay of recent output so you pick up context
- **Auto credential binding** — for an unbound asset, tries saved SSH creds by ownership and binds on success, audited
- Fullscreen / terminal mode, scrollback, UTF-8 / GBK encoding, disconnect notices

Paired with **SFTP** (drag-drop upload / download / directory management, fully audited) and the **AI command
assistant / Agent** (run commands straight from natural language), so *log in → operate → transfer files → automate*
all close the loop inside one terminal.

## Tech stack

- **Backend** — Go 1.22 · Gin · GORM · **glebarez/sqlite (pure Go, cgo-free)** · gorilla/websocket · `golang.org/x/crypto/ssh` + `pkg/sftp` · `bcrypt` passwords + in-memory session tokens · self-contained scheduler / availability monitor · nuclei (optional external binary)
- **Frontend** — React 18 · TypeScript · Ant Design 5 · `@xterm/xterm` v6 (+ fit / search addon) · Vite 8 · react-router-dom v7 · axios
- **Desktop** — Tauri v2 (Rust) + Go sidecar (`wjw-backend`), plugins: shell / clipboard-manager

## Security model

- **Auth**: `POST /api/login` verifies the bcrypt password and issues a session token (`Authorization: Bearer <token>`; WebSocket/SSE use `?token=`). Protected routes are checked by server middleware; admin routes additionally check role.
- **Multi-tenancy**: assets / credentials / terminals / SFTP / activity are isolated by `owner_id`; a regular user only sees and operates their own data.
- **Approval & passwords**: open registration but `pending` by default (admin approval required); 5 failed logins → 10-minute lockout; default `admin/admin` with a **forced password change on first login**.
- **Auto credential binding**: when connecting to an asset with no bound credential (on by default), saved SSH credentials are tried by ownership; on success the credential is auto-bound to the asset and audited (`AUTO_BIND_CRED`); if all fail it falls back to manual entry.
- **Deliberately deferred trade-offs** (local-tool positioning, not defects — see the security chapter in [architecture.md](docs/architecture.md)): credentials stored **in plaintext**, SSH host keys **not verified** (`InsecureIgnoreHostKey`). Introduce AES-at-rest and known_hosts verification before production.

## Quick start

```bash
# Backend (listens on 127.0.0.1:8080 by default; pure-Go SQLite, cgo-free)
cd backend
GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go run ./cmd/server

# Frontend (dev mode; Vite proxies /api to the backend)
cd frontend
npm install
npm run dev
```

> Default login **admin / admin** (role: admin); a **password change is forced on first login**. Other users register → admin approval.

Build check:

```bash
cd backend  && GOTOOLCHAIN=local CGO_ENABLED=0 GOFLAGS=-mod=mod go build ./cmd/server
cd frontend && npm run build
```

## Docker deployment

One command brings up the whole stack (Go backend + nginx serving the frontend and reverse-proxying `/api`, including the terminal WebSocket):

```bash
docker compose up -d --build
# Open http://<host-ip>:8088   default admin / admin
```

Base images / Go modules / npm deps / Alpine repos all use China mirrors; see [DEPLOY.md](DEPLOY.md).

## Desktop client (Tauri)

The desktop app is packaged with [Tauri v2](https://tauri.app), shipping the Go backend as a **sidecar** (`wjw-backend`).
Tauri launches it on `127.0.0.1:8765` and the frontend **logs in automatically** with the default admin credentials — zero config, no separate backend to start.

```bash
# macOS (.app + installable .dmg via the Makefile)
make deps          # install frontend deps (incl. Tauri CLI / API), once
make desktop       # .app + .dmg for the current arch
make desktop-dev   # desktop dev mode (frontend hot-reload + auto sidecar)

# Windows (one-shot PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

See [Makefile](Makefile) and [docs/desktop.md](docs/desktop.md) for more build targets.

## Docs

- [Architecture](docs/architecture.md)
- [API spec](docs/api_spec.md)
- [Product design & implementation plan](docs/design_plan.md)
- [Desktop notes](docs/desktop.md)

## License

See [LICENSE](LICENSE).

---

<div align="center">

**wjw** · v1.0.17 · Network Asset Discovery & Unified Access Platform

</div>
