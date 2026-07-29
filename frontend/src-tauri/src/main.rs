// 发行版下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// 保存后端子进程句柄，应用退出时一并结束
struct Backend(Mutex<Option<CommandChild>>);

// 日志时间戳：不额外引依赖，用自纪元秒数即可定位先后顺序
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "?".into())
}

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
            let db_path = data_dir.join("wjw.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // ── 旧版本数据迁移（meridian → lynx → wjw 两次更名）────────────
            // 应用标识符依次为 cn.meridian.desktop → cn.lynx.desktop → cn.wjw.desktop，
            // 数据目录随标识符变化；库文件名也依次是 meridian.db → lynx.db → wjw.db。
            // 更名最怕的就是「升级后资产凭空消失」，所以这里把历史上所有可能的位置
            // 按「从新到旧」全试一遍，第一个存在的就拷过来。
            // 用 copy 而不是 move：万一新版有问题，用户回退旧版数据还在原处。
            //
            // 注意：下面这些历史名是字面量，不要跟着全局改名一起被替换——
            // 批量改名时就把它们全改成了新名，迁移变成在新目录里找新文件，等于没有。
            if !db_path.exists() {
                let parent = data_dir.parent().map(|p| p.to_path_buf());
                let mut candidates: Vec<std::path::PathBuf> = vec![
                    data_dir.join("lynx.db"),     // 同目录、上一代文件名
                    data_dir.join("meridian.db"), // 同目录、更早的文件名
                ];
                if let Some(p) = parent {
                    candidates.push(p.join("cn.lynx.desktop").join("lynx.db"));
                    candidates.push(p.join("cn.lynx.desktop").join("meridian.db"));
                    candidates.push(p.join("cn.meridian.desktop").join("meridian.db"));
                }

                if let Some(src) = candidates.into_iter().find(|p| p.exists()) {
                    match std::fs::copy(&src, &db_path) {
                        Ok(_) => println!("[migrate] 已迁移旧数据库 {:?} -> {:?}", src, db_path),
                        Err(e) => eprintln!("[migrate] 旧数据库迁移失败（将以空库启动）: {}", e),
                    }

                    // 库搬过来了，密钥也必须跟着搬——否则等于没迁移。
                    //
                    // 凭据密码与 K8s Token 是用 AES-256-GCM 加密后落库的，主密钥放在
                    // 「数据库同目录」的 .wjw_key / .lynx_key 里。后端能回退读旧名，
                    // 但只在同一个目录里找；改名后目录变了，它找不到就会**静默生成一把新钥**，
                    // 于是库里所有已加密的凭据永久解不开——界面上只表现为「密码不对、连不上」，
                    // 没有任何报错，最难排查的那种。
                    if let Some(old_dir) = src.parent() {
                        for name in [".wjw_key", ".lynx_key"] {
                            let old_key = old_dir.join(name);
                            let new_key = data_dir.join(name);
                            if old_key.exists() && !new_key.exists() {
                                match std::fs::copy(&old_key, &new_key) {
                                    Ok(_) => println!("[migrate] 已迁移加密密钥 {:?}", old_key),
                                    Err(e) => eprintln!(
                                        "[migrate] 加密密钥迁移失败，已保存的凭据将无法解密: {}",
                                        e
                                    ),
                                }
                            }
                        }
                    }
                }
            }

            let db_str = db_path.to_string_lossy().to_string();

            // 启动 Go 后端 sidecar，监听本地端口；前端经 BACKEND_ORIGIN 连它
            let sidecar = app
                .shell()
                .sidecar("wjw-backend")
                .expect("未找到 wjw-backend sidecar（请先构建 Go 后端到 binaries/）")
                .env("LISTEN_ADDR", "127.0.0.1:8765")
                .env("WJW_DB", db_str)
                .env("WJW_LOCAL_SHELL", "1") // 桌面端=本机，启用本地终端
                .env("TZ", "Asia/Shanghai");

            let (mut rx, child) = sidecar.spawn().expect("启动后端 sidecar 失败");
            app.state::<Backend>().0.lock().unwrap().replace(child);

            // 后端日志同时落到数据目录下的 backend.log。打包成 .app / .exe 之后
            // stdout 是看不见的，出问题时用户手上没有任何可提供的线索。
            let log_path = data_dir.join("backend.log");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::io::Write;
                let mut log = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .ok();
                let mut write_line = |tag: &str, s: &str| {
                    println!("[backend]{} {}", tag, s);
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "[{}]{} {}", chrono_now(), tag, s);
                        let _ = f.flush();
                    }
                };
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            write_line("", &String::from_utf8_lossy(&line))
                        }
                        CommandEvent::Stderr(line) => {
                            write_line("[err]", &String::from_utf8_lossy(&line))
                        }
                        // sidecar 退出：前端在等 token，必须让它知道后端已经没了，
                        // 否则界面只会一直转圈或进去满屏报错。
                        CommandEvent::Terminated(payload) => {
                            let msg = format!(
                                "后端进程已退出（code={:?} signal={:?}），日志见 {}",
                                payload.code,
                                payload.signal,
                                log_path.to_string_lossy()
                            );
                            write_line("[exit]", &msg);
                            let _ = handle.emit("wjw-backend-exit", msg);
                            break;
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
        .expect("运行 wjw 桌面端失败");
}
