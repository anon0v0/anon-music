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

// ============ P6 桌面端helpers：下载目录持久化 + 流式下载 ============
#[cfg(desktop)]
fn dl_dir_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    if let Ok(d) = app.path().app_config_dir() {
        if let Ok(s) = std::fs::read_to_string(d.join("dl_dir.txt")) {
            let s = s.trim();
            if !s.is_empty() {
                let pb = std::path::PathBuf::from(s);
                if pb.is_dir() {
                    return pb;
                }
            }
        }
    }
    app.path()
        .download_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

#[cfg(desktop)]
fn save_dl_dir(app: &tauri::AppHandle, dir: &std::path::Path) {
    use tauri::Manager;
    if let Ok(d) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&d);
        let _ = std::fs::write(d.join("dl_dir.txt"), dir.to_string_lossy().as_bytes());
    }
}

#[cfg(desktop)]
async fn dl_run(app: tauri::AppHandle, id: String, url: String, filename: String) {
    use tauri::Emitter;
    match dl_run_inner(&app, &id, &url, &filename).await {
        Ok(path) => {
            let _ = app.emit("dl-done", serde_json::json!({ "id": id, "path": path }));
        }
        Err(m) => {
            let _ = app.emit("dl-error", serde_json::json!({ "id": id, "msg": m }));
        }
    }
}

#[cfg(desktop)]
async fn dl_run_inner(
    app: &tauri::AppHandle,
    id: &str,
    url: &str,
    filename: &str,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;
    let dir = dl_dir_path(app);
    let _ = std::fs::create_dir_all(&dir);
    let mut safe: String = filename
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    // 去掉尾部点/空格(Windows 非法) + 保底名
    safe = safe.trim_end_matches([' ', '.']).to_string();
    if safe.is_empty() {
        safe = String::from("song");
    }
    // 同名不覆盖：已存在则追加 (1)/(2)…（不静默截毁用户已下好的完整文件）
    let final_path = {
        let base = dir.join(&safe);
        if !base.exists() {
            base
        } else {
            let (stem, ext) = match safe.rfind('.') {
                Some(i) if i > 0 => (safe[..i].to_string(), safe[i..].to_string()),
                _ => (safe.clone(), String::new()),
            };
            let mut p = base.clone();
            let mut n = 1;
            while p.exists() && n < 1000 {
                p = dir.join(format!("{stem} ({n}){ext}"));
                n += 1;
            }
            p
        }
    };
    // 先下到 .part 临时文件，成功后再 rename → 失败不会留半截"看似完整"的文件
    let part = final_path.with_extension("part");
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60)) // 服务器停发 60s 即报错，不永久卡住
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last = std::time::Instant::now();
    let dl_result = async {
        while let Some(chunk) = stream.next().await {
            let c = chunk.map_err(|e| e.to_string())?;
            file.write_all(&c).map_err(|e| e.to_string())?;
            received += c.len() as u64;
            if last.elapsed().as_millis() > 300 {
                last = std::time::Instant::now();
                let _ = app.emit(
                    "dl-progress",
                    serde_json::json!({ "id": id, "received": received, "total": total }),
                );
            }
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(e) = dl_result {
        drop(file);
        let _ = std::fs::remove_file(&part); // 清掉半截临时文件
        return Err(e);
    }
    drop(file);
    std::fs::rename(&part, &final_path).map_err(|e| e.to_string())?;
    Ok(final_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // 单实例（桌面）：必须最先注册。再次双击 exe 时新进程不建窗口，直接把已在运行的
    // 主窗口显示/取消最小化/聚焦到前台 —— 解决"可以无限打开窗口"的问题。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder = builder.plugin(tauri_plugin_opener::init());
    // 桌面端插件：目录选择对话框 + 全局快捷键（Ctrl+Alt+P/←/→/L → gs-ctl 事件给网页）
    #[cfg(desktop)]
    {
        use tauri::Emitter;
        use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
        builder = builder.plugin(tauri_plugin_dialog::init()).plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let m = Modifiers::CONTROL | Modifiers::ALT;
                    let action = if shortcut.matches(m, Code::KeyP) {
                        "playpause"
                    } else if shortcut.matches(m, Code::ArrowLeft) {
                        "prev"
                    } else if shortcut.matches(m, Code::ArrowRight) {
                        "next"
                    } else if shortcut.matches(m, Code::KeyL) {
                        "lyrics"
                    } else {
                        return;
                    };
                    let _ = app.emit("gs-ctl", serde_json::json!({ "action": action }));
                })
                .build(),
        );
    }
    builder
        .setup(|app| {
            // 桌面端：悬浮歌词窗口 + 托盘 + 关闭最小化 + 锁定悬停解锁。
            // 安卓不支持多窗口/系统托盘，故整段仅 desktop。
            #[cfg(desktop)]
            {
                use std::sync::atomic::{AtomicBool, Ordering};
                use std::sync::{Arc, Mutex};
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

                // ⓪ 启动 splash：主窗口加载远程页面期间给一个本地加载画面（主窗 decorations=false
                // 时期的空窗更显生硬）。网页就绪(shell-hello)后关闭；15s 兜底自动关（断网也不挡人）。
                {
                    let splash = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
                        .title("Anon Music")
                        .decorations(false)
                        .resizable(false)
                        .maximizable(false)
                        .skip_taskbar(true)
                        .always_on_top(true)
                        .center()
                        .inner_size(380.0, 240.0)
                        .build();
                    if let Err(e) = splash {
                        eprintln!("splash window failed: {e}");
                    }
                    // 无边框主窗兜底：网页 bridge.js 挂好自绘标题栏后 emit 'wc-ready'。
                    // 若旧缓存页/错误页拿不到新 bridge → 15s 内收不到 → 给主窗恢复系统标题栏，
                    // 否则用户没有任何拖动/关闭窗口的手柄。
                    let wc_ready = Arc::new(AtomicBool::new(false));
                    {
                        let wr = wc_ready.clone();
                        app.listen("wc-ready", move |_| { wr.store(true, Ordering::SeqCst); });
                    }
                    let ah = app.handle().clone();
                    let wr = wc_ready.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(15));
                        if let Some(s) = ah.get_webview_window("splash") {
                            let _ = s.close();
                        }
                        if !wr.load(Ordering::SeqCst) {
                            if let Some(main) = ah.get_webview_window("main") {
                                let _ = main.set_decorations(true);   // 页面没接管标题栏 → 还给系统栏
                            }
                        }
                    });
                }

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

                // ② 系统托盘右键菜单（仿 QQ 音乐）：播放控制 + 桌面歌词 + 设置 + 退出。
                //   播放/暂停·上一首·下一首·喜欢·显示歌词 → gs-ctl 事件回传网页(与全局快捷键同通道)；
                //   打开主界面·设置·退出 在 Rust 侧直接处理。左键点击托盘图标=打开主窗。
                let mi_play = MenuItem::with_id(app, "playpause", "播放 / 暂停", true, None::<&str>)?;
                let mi_prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
                let mi_next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
                let mi_like = MenuItem::with_id(app, "like", "喜欢当前歌曲", true, None::<&str>)?;
                let mi_lyric = MenuItem::with_id(app, "lyrics", "显示 / 隐藏桌面歌词", true, None::<&str>)?;
                let unlock = MenuItem::with_id(app, "unlock", "解锁桌面歌词", true, None::<&str>)?;
                let mi_show = MenuItem::with_id(app, "show", "打开主界面", true, None::<&str>)?;
                let mi_set = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let sep1 = PredefinedMenuItem::separator(app)?;
                let sep2 = PredefinedMenuItem::separator(app)?;
                let sep3 = PredefinedMenuItem::separator(app)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &mi_play, &mi_prev, &mi_next,
                        &sep1,
                        &mi_like, &mi_lyric, &unlock,
                        &sep2,
                        &mi_show, &mi_set,
                        &sep3,
                        &quit,
                    ],
                )?;
                let ll_tray = lyric_locked.clone();
                let tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Anon Music")
                    .menu(&menu)
                    .on_menu_event(move |app, event| match event.id().as_ref() {
                        "playpause" => {
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "playpause" }));
                        }
                        "prev" => {
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "prev" }));
                        }
                        "next" => {
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "next" }));
                        }
                        "like" => {
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "like" }));
                        }
                        "lyrics" => {
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "lyrics" }));
                        }
                        "unlock" => {
                            ll_tray.store(false, Ordering::Relaxed);
                            if let Some(w) = app.get_webview_window("lyrics") {
                                let _ = w.set_ignore_cursor_events(false);
                            }
                            let _ = app.emit("lyric-locked-changed", false);
                        }
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                            let _ = app.emit("gs-ctl", serde_json::json!({ "action": "settings" }));
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
                                let _ = w.unminimize();
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

                // ⑤ P6：能力握手 + 下载管理事件桥 + 全局快捷键注册。
                // 网页 bridge.js 发 shell-hello，这里回 shell-info{ver,caps}——
                // 旧网页不发=保持沉默；网页在旧壳(≤v0.5)发了没人回=按浏览器路径降级。
                {
                    let ah = app.handle().clone();
                    app.listen("shell-hello", move |_| {
                        // caps: dl=下载桥 gs=全局快捷键 wc=无边框窗口自绘控制（v0.7 起 decorations=false）
                        let _ = ah.emit(
                            "shell-info",
                            serde_json::json!({ "ver": env!("CARGO_PKG_VERSION"), "caps": ["dl", "gs", "wc"] }),
                        );
                        // 网页就绪 → 关掉启动 splash
                        if let Some(s) = ah.get_webview_window("splash") {
                            let _ = s.close();
                        }
                    });
                }
                {
                    let ah = app.handle().clone();
                    app.listen("dl-start", move |ev| {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) {
                            let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                            let url = v.get("url").and_then(|x| x.as_str()).unwrap_or("").to_string();
                            let filename = v.get("filename").and_then(|x| x.as_str()).unwrap_or("song").to_string();
                            if id.is_empty() || url.is_empty() {
                                return;
                            }
                            tauri::async_runtime::spawn(dl_run(ah.clone(), id, url, filename));
                        }
                    });
                }
                {
                    let ah = app.handle().clone();
                    app.listen("dl-get-dir", move |_| {
                        let _ = ah.emit(
                            "dl-dir",
                            serde_json::json!({ "path": dl_dir_path(&ah).to_string_lossy() }),
                        );
                    });
                }
                {
                    let ah = app.handle().clone();
                    app.listen("dl-pick-dir", move |_| {
                        use tauri_plugin_dialog::DialogExt;
                        let ah2 = ah.clone();
                        ah.dialog().file().pick_folder(move |p| {
                            if let Some(fp) = p {
                                if let Ok(pb) = fp.into_path() {
                                    save_dl_dir(&ah2, &pb);
                                    let _ = ah2.emit(
                                        "dl-dir",
                                        serde_json::json!({ "path": pb.to_string_lossy() }),
                                    );
                                }
                            }
                        });
                    });
                }
                {
                    let ah = app.handle().clone();
                    app.listen("dl-open-dir", move |ev| {
                        use tauri_plugin_opener::OpenerExt;
                        let target = serde_json::from_str::<serde_json::Value>(ev.payload())
                            .ok()
                            .and_then(|v| v.get("path").and_then(|x| x.as_str()).map(|s| s.to_string()))
                            .filter(|s| !s.is_empty());
                        match target {
                            Some(p) => {
                                let _ = ah.opener().reveal_item_in_dir(p);
                            }
                            None => {
                                let _ = ah.opener().open_path(
                                    dl_dir_path(&ah).to_string_lossy().to_string(),
                                    None::<&str>,
                                );
                            }
                        }
                    });
                }
                {
                    use tauri_plugin_global_shortcut::GlobalShortcutExt;
                    let gs = app.global_shortcut();
                    for s in ["ctrl+alt+p", "ctrl+alt+left", "ctrl+alt+right", "ctrl+alt+l"] {
                        if let Err(e) = gs.register(s) {
                            eprintln!("[gs] register {s} failed: {e}");
                        }
                    }
                }
            }

            // 安卓：监听前端发来的播放元数据/状态/进度事件 → JNI 驱动前台服务/MediaSession。
            // 前端控制(媒体键回传)经 media_android 的 JNI 回调 emit 'and-ctl'/'and-seek'。
            #[cfg(target_os = "android")]
            {
                use tauri::{Emitter, Listener};
                media_android::set_app_handle(app.handle().clone());

                // 能力握手 + 关启动遮罩：网页 bridge.js 发 shell-hello（页面已就绪）
                {
                    let ah = app.handle().clone();
                    app.listen("shell-hello", move |_| {
                        let _ = ah.emit(
                            "shell-info",
                            serde_json::json!({ "ver": env!("CARGO_PKG_VERSION"), "caps": ["dl"] }),
                        );
                        media_android::hide_splash();
                    });
                }

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
                // 下载：交系统 DownloadManager（通知栏进度，存 Music/AnonMusic/）
                app.listen("and-download", |ev| {
                    media_android::download(ev.payload());
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
