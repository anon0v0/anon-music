// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 桌面端：悬浮歌词窗口 + 托盘 + 关闭最小化 + 锁定悬停解锁。
            // 安卓不支持多窗口/系统托盘，故整段仅 desktop。
            #[cfg(desktop)]
            {
                use std::sync::atomic::{AtomicBool, Ordering};
                use std::sync::Arc;
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

                // 关闭行为：true=最小化到托盘(默认)，false=直接退出（由网页设置项切换）
                let close_to_tray = Arc::new(AtomicBool::new(true));
                // 桌面歌词锁定状态
                let lyric_locked = Arc::new(AtomicBool::new(false));

                // ① 透明置顶悬浮歌词窗（默认隐藏）
                let _ = WebviewWindowBuilder::new(app, "lyrics", WebviewUrl::App("lyrics.html".into()))
                    .title("桌面歌词")
                    .inner_size(900.0, 160.0)
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .resizable(true)
                    .visible(false)
                    .build()?;

                // ② 系统托盘（解锁歌词 / 退出；左键点击恢复主窗）
                let unlock = MenuItem::with_id(app, "unlock", "解锁桌面歌词", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&unlock, &quit])?;
                let ll_tray = lyric_locked.clone();
                let tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Anon Music")
                    .menu(&menu)
                    .on_menu_event(move |app, event| match event.id().as_ref() {
                        "unlock" => {
                            ll_tray.store(false, Ordering::Relaxed);
                            if let Some(w) = app.get_webview_window("lyrics") {
                                let _ = w.set_ignore_cursor_events(false);
                            }
                            let _ = app.emit("lyric-locked-changed", false);
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(w) = tray.app_handle().get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;
                std::mem::forget(tray);

                // ③ 关闭主窗 → 最小化到托盘（设置可切换为直接退出）
                if let Some(main) = app.get_webview_window("main") {
                    let ct = close_to_tray.clone();
                    let ah = app.handle().clone();
                    main.on_window_event(move |ev| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                            if ct.load(Ordering::Relaxed) {
                                api.prevent_close();
                                if let Some(w) = ah.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            }
                        }
                    });
                }
                {
                    let ct = close_to_tray.clone();
                    app.listen("set-close-tray", move |ev| {
                        ct.store(ev.payload().contains("true"), Ordering::Relaxed);
                    });
                }

                // ④ 桌面歌词锁定 + 鼠标悬停解锁
                {
                    let ll = lyric_locked.clone();
                    let ah = app.handle().clone();
                    app.listen("lyric-lock", move |ev| {
                        let locked = ev.payload().contains("true");
                        ll.store(locked, Ordering::Relaxed);
                        if !locked {
                            if let Some(w) = ah.get_webview_window("lyrics") {
                                let _ = w.set_ignore_cursor_events(false);
                            }
                        }
                        let _ = ah.emit("lyric-locked-changed", locked);
                    });
                }
                {
                    // 锁定后悬浮窗鼠标穿透；轮询全局光标，进入窗口区域则临时取消穿透并提示解锁
                    let ll = lyric_locked.clone();
                    let ah = app.handle().clone();
                    std::thread::spawn(move || {
                        let mut inside_prev = false;
                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(160));
                            if !ll.load(Ordering::Relaxed) {
                                inside_prev = false;
                                continue;
                            }
                            if let Some(win) = ah.get_webview_window("lyrics") {
                                if let (Ok(c), Ok(p), Ok(s)) =
                                    (ah.cursor_position(), win.outer_position(), win.outer_size())
                                {
                                    let inside = c.x >= p.x as f64
                                        && c.x <= p.x as f64 + s.width as f64
                                        && c.y >= p.y as f64
                                        && c.y <= p.y as f64 + s.height as f64;
                                    if inside != inside_prev {
                                        inside_prev = inside;
                                        let _ = win.set_ignore_cursor_events(!inside);
                                        let _ = ah.emit("lyric-hover", inside);
                                    }
                                }
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
