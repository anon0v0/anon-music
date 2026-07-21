fn main() {
    println!("cargo:rerun-if-env-changed=ANON_MUSIC_APP_ORIGIN");
    if let Ok(origin) = std::env::var("ANON_MUSIC_APP_ORIGIN") {
        println!("cargo:rustc-env=ANON_MUSIC_APP_ORIGIN={origin}");
    }
    tauri_build::build()
}
