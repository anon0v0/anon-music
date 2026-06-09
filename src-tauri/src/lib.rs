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
            // 桌面端：创建一个透明、无边框、永远置顶的「桌面歌词」悬浮窗，
            // 浮于主窗口之外、显示在整个桌面之上。默认隐藏，由网页端事件控制显隐。
            // 安卓不支持多窗口，故仅在 desktop 创建（安卓悬浮歌词是另行的原生方案）。
            #[cfg(desktop)]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let _ = WebviewWindowBuilder::new(
                    app,
                    "lyrics",
                    WebviewUrl::App("lyrics.html".into()),
                )
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
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
