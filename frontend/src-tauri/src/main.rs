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
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            // 数据库放到系统应用数据目录，持久化、避免写到安装目录
            let db_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("meridian.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let db_str = db_path.to_string_lossy().to_string();

            // 启动 Go 后端 sidecar，监听本地端口；前端经 BACKEND_ORIGIN 连它
            let sidecar = app
                .shell()
                .sidecar("meridian-backend")
                .expect("未找到 meridian-backend sidecar（请先构建 Go 后端到 binaries/）")
                .env("LISTEN_ADDR", "127.0.0.1:8765")
                .env("MERIDIAN_DB", db_str)
                .env("MERIDIAN_LOCAL_SHELL", "1") // 桌面端=本机，启用本地终端
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
        .expect("运行 Meridian 桌面端失败");
}
