// 发行版下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// 保存后端子进程句柄，应用退出时一并结束
struct Backend(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            // 数据库放到系统应用数据目录，持久化、避免写到安装目录
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let db_path = data_dir.join("lynx.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // ── 旧版本数据迁移（Meridian → Lynx 更名）──────────────────────
            // 应用标识符由 cn.meridian.desktop 改为 cn.lynx.desktop，数据目录随之改变；
            // 库文件名也由 meridian.db 改为 lynx.db。这里在新库不存在时，
            // 依次尝试「同目录旧文件名」与「旧标识符目录」，把老库迁过来，避免升级后数据凭空消失。
            if !db_path.exists() {
                let legacy_same_dir = data_dir.join("meridian.db");
                let legacy_old_dir = data_dir
                    .parent()
                    .map(|p| p.join("cn.meridian.desktop").join("meridian.db"));

                let legacy = if legacy_same_dir.exists() {
                    Some(legacy_same_dir)
                } else {
                    legacy_old_dir.filter(|p| p.exists())
                };

                if let Some(src) = legacy {
                    match std::fs::copy(&src, &db_path) {
                        Ok(_) => println!("[migrate] 已迁移旧数据库 {:?} -> {:?}", src, db_path),
                        Err(e) => eprintln!("[migrate] 旧数据库迁移失败（将以空库启动）: {}", e),
                    }
                }
            }

            let db_str = db_path.to_string_lossy().to_string();

            // 启动 Go 后端 sidecar，监听本地端口；前端经 BACKEND_ORIGIN 连它
            let sidecar = app
                .shell()
                .sidecar("lynx-backend")
                .expect("未找到 lynx-backend sidecar（请先构建 Go 后端到 binaries/）")
                .env("LISTEN_ADDR", "127.0.0.1:8765")
                .env("LYNX_DB", db_str)
                .env("LYNX_LOCAL_SHELL", "1") // 桌面端=本机，启用本地终端
                .env("TZ", "Asia/Shanghai");

            let (mut rx, child) = sidecar.spawn().expect("启动后端 sidecar 失败");
            app.state::<Backend>().0.lock().unwrap().replace(child);

            // 透传后端日志到 stdout，便于排查
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[backend] {}", String::from_utf8_lossy(&line))
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[backend] {}", String::from_utf8_lossy(&line))
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Lynx 桌面端失败");
}
