// 安卓原生媒体控制（锁屏/通知/媒体键）桥接，仅 android 编译。
#[cfg(target_os = "android")]
mod media_android;

// 歌词窗几何"待落盘"缓存：Moved/Resized 事件写入(路径+逻辑几何)，
// 800ms 线程周期取出写盘(take=自带脏标记)；退出时(RunEvent::Exit)同步冲刷，
// 避免"移动后 0.8s 内退出 → 最后位置丢失"。
#[cfg(desktop)]
static LYR_GEOM_PENDING: std::sync::OnceLock<
    std::sync::Mutex<Option<(std::path::PathBuf, (f64, f64, f64, f64))>>,
> = std::sync::OnceLock::new();

#[cfg(desktop)]
fn flush_lyr_geom() {
    if let Some(m) = LYR_GEOM_PENDING.get() {
        if let Ok(mut g) = m.lock() {
            if let Some((path, v)) = g.take() {
                let j = serde_json::json!({ "x": v.0, "y": v.1, "w": v.2, "h": v.3 });
                let _ = std::fs::write(path, j.to_string());
            }
        }
    }
}

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
                use std::sync::{Arc, Mutex};
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

                // 关闭行为：true=最小化到托盘(默认)，false=直接退出（由网页设置项切换）
                let close_to_tray = Arc::new(AtomicBool::new(true));
                // 桌面歌词锁定状态
                let lyric_locked = Arc::new(AtomicBool::new(false));
                // 歌词窗可见性（lyrics.html 在 show/hide 时 emit 'lyric-visible'）：
                // 锁定光标轮询只在 锁定+可见 时才跑，其余时间低频空转
                let lyric_visible = Arc::new(AtomicBool::new(false));

                // ① 透明置顶悬浮歌词窗（默认隐藏）。几何(位置/尺寸)持久化在 lyrics_win.json，
                // 启动恢复，移动/缩放后防抖写回；恢复位置落在已拔掉的显示器上时回屏幕中央。
                let cfg_dir = app.path().app_config_dir().ok();
                let geom_path = cfg_dir.as_ref().map(|d| d.join("lyrics_win.json"));
                let saved_geom: Option<(f64, f64, f64, f64)> = geom_path.as_ref().and_then(|p| {
                    let txt = std::fs::read_to_string(p).ok()?;
                    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
                    Some((
                        v.get("x")?.as_f64()?,
                        v.get("y")?.as_f64()?,
                        v.get("w")?.as_f64()?,
                        v.get("h")?.as_f64()?,
                    ))
                });

                // resizable(false)+maximizable(false)：歌词窗不可手动拉伸——否则 Windows 会对它
                // 触发贴边分屏/拖到顶最大化(Aero Snap)。尺寸全部由 lyrics.html 程序化 setSize
                // （字号定高、面板宽度按钮定宽），programmatic resize 不受 resizable(false) 影响。
                let mut lyr_b = WebviewWindowBuilder::new(app, "lyrics", WebviewUrl::App("lyrics.html".into()))
                    .title("桌面歌词")
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .resizable(false)
                    .maximizable(false)
                    .min_inner_size(360.0, 80.0)
                    .visible(false);
                lyr_b = match saved_geom {
                    Some((x, y, w, h)) => lyr_b.inner_size(w.max(360.0), h.max(80.0)).position(x, y),
                    None => lyr_b.inner_size(900.0, 160.0),
                };
                let lyr_win = lyr_b.build()?;

                if saved_geom.is_some() {
                    // 与所有显示器求交，完全不在任何屏幕内则回中央
                    let on_screen = (|| -> Option<bool> {
                        let p = lyr_win.outer_position().ok()?;
                        let s = lyr_win.outer_size().ok()?;
                        let mons = lyr_win.available_monitors().ok()?;
                        Some(mons.iter().any(|m| {
                            let mp = m.position();
                            let ms = m.size();
                            p.x < mp.x + ms.width as i32
                                && p.x + s.width as i32 > mp.x
                                && p.y < mp.y + ms.height as i32
                                && p.y + s.height as i32 > mp.y
                        }))
                    })();
                    if on_screen == Some(false) {
                        let _ = lyr_win.center();
                    }
                }

                if let (Some(gp), Some(dir)) = (geom_path.clone(), cfg_dir.clone()) {
                    let _ = std::fs::create_dir_all(&dir);
                    LYR_GEOM_PENDING.get_or_init(|| Mutex::new(None));
                    {
                        let ah = app.handle().clone();
                        lyr_win.on_window_event(move |e| {
                            if matches!(e, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                                if let Some(w) = ah.get_webview_window("lyrics") {
                                    if let (Ok(p), Ok(s), Ok(sf)) =
                                        (w.outer_position(), w.inner_size(), w.scale_factor())
                                    {
                                        if let Some(m) = LYR_GEOM_PENDING.get() {
                                            if let Ok(mut g) = m.lock() {
                                                *g = Some((
                                                    gp.clone(),
                                                    (
                                                        p.x as f64 / sf,
                                                        p.y as f64 / sf,
                                                        s.width as f64 / sf,
                                                        s.height as f64 / sf,
                                                    ),
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        flush_lyr_geom();
                    });
                }

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
                    // 歌词窗可见性跟踪（lyrics.html 每次 show/hide 都会 emit）
                    let lv = lyric_visible.clone();
                    app.listen("lyric-visible", move |ev| {
                        lv.store(ev.payload().contains("true"), Ordering::Relaxed);
                    });
                }
                {
                    // 锁定后悬浮窗鼠标穿透；轮询全局光标，进入窗口区域则临时取消穿透并提示解锁。
                    // 只在 锁定+可见 时以 160ms 轮询，否则 500ms 空转省 CPU。
                    let ll = lyric_locked.clone();
                    let lv = lyric_visible.clone();
                    let ah = app.handle().clone();
                    std::thread::spawn(move || {
                        let mut inside_prev = false;
                        loop {
                            if !ll.load(Ordering::Relaxed) || !lv.load(Ordering::Relaxed) {
                                if inside_prev {
                                    inside_prev = false;
                                    // 光标停在窗内时窗口被隐藏/解锁 → 已是"可命中"状态。
                                    // 仍锁定的话必须补一次恢复穿透，否则下次显示时
                                    // 锁定窗能被点中/拖动，直到光标再进出一次才自愈。
                                    if ll.load(Ordering::Relaxed) {
                                        if let Some(win) = ah.get_webview_window("lyrics") {
                                            let _ = win.set_ignore_cursor_events(true);
                                        }
                                    }
                                    let _ = ah.emit("lyric-hover", false);
                                }
                                std::thread::sleep(std::time::Duration::from_millis(500));
                                continue;
                            }
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

            // 安卓：监听前端发来的播放元数据/状态/进度事件 → JNI 驱动前台服务/MediaSession。
            // 前端控制(媒体键回传)经 media_android 的 JNI 回调 emit 'and-ctl'/'and-seek'。
            #[cfg(target_os = "android")]
            {
                use tauri::Listener;
                media_android::set_app_handle(app.handle().clone());

                app.listen("and-now", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let dur = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        media_android::update_now_playing(&s("title"), &s("artist"), &s("album"), dur, &s("cover"));
                    }
                });
                app.listen("and-state", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let playing = v.get("playing").and_then(|x| x.as_bool()).unwrap_or(false);
                        media_android::set_playing(playing);
                        media_android::lyric_set_playing(playing); // 同步悬浮歌词时钟
                    }
                });
                app.listen("and-pos", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let pos = v.get("position").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        let dur = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        media_android::update_position(pos, dur);
                        media_android::lyric_set_position(pos); // 同步悬浮歌词时钟
                    }
                });

                // App 外悬浮歌词：整段歌词下发 + 开关
                app.listen("and-lyric-data", |ev| {
                    media_android::lyric_set_data(ev.payload());
                });
                app.listen("and-lyric-show", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let show = v.get("show").and_then(|x| x.as_bool()).unwrap_or(false);
                        media_android::lyric_set_shown(show);
                    }
                });
                // 悬浮歌词样式（字号/配色/单双行/对齐/透明度/仅后台）——JSON 原样透传 Kotlin
                app.listen("and-lyric-style", |ev| {
                    media_android::lyric_set_style(ev.payload());
                });
                // 悬浮歌词锁定（独立于样式，避免竞态）
                app.listen("and-lyric-lock", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let locked = v.get("locked").and_then(|x| x.as_bool()).unwrap_or(false);
                        media_android::lyric_set_locked(locked);
                    }
                });

                // 媒体卡片：我喜欢 / 词 按钮的状态
                app.listen("and-liked", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let liked = v.get("liked").and_then(|x| x.as_bool()).unwrap_or(false);
                        media_android::set_liked(liked);
                    }
                });
                app.listen("and-lyrics-active", |ev| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                        let active = v.get("active").and_then(|x| x.as_bool()).unwrap_or(false);
                        media_android::set_lyrics_active(active);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // 退出前冲刷歌词窗几何（800ms 防抖线程可能来不及最后一轮）
            #[cfg(desktop)]
            {
                if let tauri::RunEvent::Exit = _event {
                    flush_lyr_geom();
                }
            }
        });
}
