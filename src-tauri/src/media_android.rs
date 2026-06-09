// 安卓原生媒体控制桥接
// ----------------------------------------------------------------------------
// 本应用是「瘦壳」：音频在 WebView 里用 <audio> 播放。系统的锁屏/通知/媒体键
// 控制需要一个原生前台服务 + MediaSession 来承载，于是：
//
//   JS(远程页) --Tauri事件(and-now/and-state/and-pos)--> Rust --JNI--> MusicService
//   MusicService(通知按钮/锁屏/媒体键) --JNI(nativePlayerCommand/Seek)--> Rust
//        --Tauri事件(and-ctl/and-seek)--> JS(控制 <audio>)
//
// 该模块仅在 target_os = "android" 编译。桌面端不受影响。
// 设计参考 Mio-Music 的 MusicService + JNI 思路，但播放器在 WebView，故 native
// 命令只负责把控制意图转发回前端，不直接驱动任何原生播放器。

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static ANDROID_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static MUSIC_SERVICE_CLASS: OnceLock<jni::objects::GlobalRef> = OnceLock::new();

/// 在 setup 阶段保存 AppHandle，供 JNI 回调里 emit 事件给前端。
pub fn set_app_handle(app: AppHandle) {
    let _ = ANDROID_APP_HANDLE.set(app);
}

// ---------------------------------------------------------------------------
// JNI: MainActivity 启动时调用，缓存 JavaVM/Activity 与 MusicService 类引用。
// FindClass 必须在主线程(应用 ClassLoader)执行，后续从子线程 attach 才能找到。
// ---------------------------------------------------------------------------
#[no_mangle]
pub extern "system" fn Java_li_saki_anonmusic_MainActivity_initAndroidContext(
    mut env: jni::JNIEnv,
    _this: jni::objects::JObject,
    activity: jni::objects::JObject,
) {
    use std::os::raw::c_void;

    let vm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => {
            eprintln!("[Android] get_java_vm failed: {e}");
            return;
        }
    };
    let global_activity = match env.new_global_ref(&activity) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[Android] new_global_ref(activity) failed: {e}");
            return;
        }
    };
    let vm_ptr = vm.get_java_vm_pointer() as *mut c_void;
    let activity_ptr = global_activity.as_obj().as_raw() as *mut c_void;
    std::mem::forget(global_activity);

    if let Ok(class) = env.find_class("li/saki/anonmusic/MusicService") {
        if let Ok(global_ref) = env.new_global_ref(&class) {
            let _ = MUSIC_SERVICE_CLASS.set(global_ref);
        }
    }

    unsafe {
        ndk_context::initialize_android_context(vm_ptr, activity_ptr);
    }
    eprintln!("[Android] ndk-context + MusicService class cached");
}

// ---------------------------------------------------------------------------
// JNI: 服务把媒体按钮/锁屏控制回传给 Rust → 转成 Tauri 事件发给前端。
// ---------------------------------------------------------------------------
#[no_mangle]
pub extern "system" fn Java_li_saki_anonmusic_MusicService_nativePlayerCommand(
    mut env: jni::JNIEnv,
    _this: jni::objects::JObject,
    cmd: jni::objects::JString,
) {
    let cmd_str: String = match env.get_string(&cmd) {
        Ok(s) => s.into(),
        Err(e) => {
            eprintln!("[Android] nativePlayerCommand get_string failed: {e}");
            return;
        }
    };
    if let Some(app) = ANDROID_APP_HANDLE.get() {
        let _ = app.emit("and-ctl", &cmd_str);
    }
}

#[no_mangle]
pub extern "system" fn Java_li_saki_anonmusic_MusicService_nativePlayerSeek(
    _env: jni::JNIEnv,
    _this: jni::objects::JObject,
    position_ms: jni::sys::jlong,
) {
    if let Some(app) = ANDROID_APP_HANDLE.get() {
        let _ = app.emit("and-seek", (position_ms as f64) / 1000.0);
    }
}

// ---------------------------------------------------------------------------
// Rust → Kotlin：调用 MusicService 的静态方法。
// ---------------------------------------------------------------------------
fn with_env<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&mut jni::JNIEnv, &jni::objects::JClass) -> R,
{
    let cached = MUSIC_SERVICE_CLASS.get()?;
    let vm_ptr = ndk_context::android_context().vm() as *mut _;
    let vm = unsafe { jni::JavaVM::from_raw(vm_ptr) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let obj = cached.as_obj();
    let class: &jni::objects::JClass = obj.into();
    Some(f(&mut env, class))
}

fn call_start(env: &mut jni::JNIEnv, class: &jni::objects::JClass) {
    let activity = unsafe {
        jni::objects::JObject::from_raw(
            ndk_context::android_context().context() as jni::sys::jobject
        )
    };
    let _ = env.call_static_method(
        class,
        "start",
        "(Landroid/content/Context;)V",
        &[jni::objects::JValue::Object(&activity)],
    );
}

pub fn update_now_playing(title: &str, artist: &str, album: &str, duration_secs: f64, cover: &str) {
    with_env(|env, class| {
        call_start(env, class);
        let t = env.new_string(title).unwrap_or_default();
        let a = env.new_string(artist).unwrap_or_default();
        let al = env.new_string(album).unwrap_or_default();
        let c = env.new_string(cover).unwrap_or_default();
        let _ = env.call_static_method(
            class,
            "updateNowPlaying",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;JLjava/lang/String;)V",
            &[
                jni::objects::JValue::Object(&t),
                jni::objects::JValue::Object(&a),
                jni::objects::JValue::Object(&al),
                jni::objects::JValue::Long((duration_secs * 1000.0) as i64),
                jni::objects::JValue::Object(&c),
            ],
        );
    });
}

pub fn set_playing(playing: bool) {
    with_env(|env, class| {
        let _ = env.call_static_method(
            class,
            "setPlaying",
            "(Z)V",
            &[jni::objects::JValue::Bool(if playing { 1 } else { 0 })],
        );
    });
}

pub fn update_position(position_secs: f64, duration_secs: f64) {
    with_env(|env, class| {
        let _ = env.call_static_method(
            class,
            "updatePlaybackPosition",
            "(JJ)V",
            &[
                jni::objects::JValue::Long((position_secs * 1000.0) as i64),
                jni::objects::JValue::Long((duration_secs * 1000.0) as i64),
            ],
        );
    });
}
