package li.saki.anonmusic

import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

// 覆盖 Tauri 生成的 MainActivity：
//  1) 加载 Rust 原生库，注册 JNI（initAndroidContext / nativePlayerCommand / nativePlayerSeek）。
//  2) 启动时缓存 JavaVM 与 MusicService 类引用（FindClass 须在主线程）。
//  3) onPause 时若仍在播放，调用 webView.onResume() 让 <audio> 在后台/锁屏继续播放。
//  4) Android 13+ 申请通知权限（否则前台服务通知不可见）。
class MainActivity : TauriActivity() {
    companion object {
        init { System.loadLibrary("music_app_lib") }
    }

    private external fun initAndroidContext(activity: android.app.Activity)
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        initAndroidContext(this)
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 1001)
            } catch (_: Exception) {}
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        this.webView = webView
        // 系统返回键/侧滑：交给网页逐层处理（关弹窗/面板/全屏、返回上一级）；
        // 只有网页判定已在一级页面时才退到后台(moveTaskToBack，不杀进程；划掉后台卡片才真退)。
        // 在这里(onWebViewCreate)注册——它在 WryActivity 注册自己的返回回调之后才被调用，
        // 而 dispatcher 后注册者优先(LIFO)，故我们的回调会先执行、覆盖 Tauri 默认的返回行为。
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = this@MainActivity.webView
                if (wv == null) { moveTaskToBack(true); return }
                wv.evaluateJavascript("(window.__androidBack&&window.__androidBack())||'exit'") { res ->
                    if (res == null || res.contains("exit")) moveTaskToBack(true)
                }
            }
        })
    }

    override fun onPause() {
        super.onPause()
        // 后台/锁屏保活：仅在确有播放时让 WebView 继续运行音频，避免无谓耗电。
        if (MusicService.instance?.isPlaying() == true) {
            webView?.onResume()
        }
    }

    override fun onResume() {
        super.onResume()
        // 从「显示在其它应用上层」授权页返回时，自动补显悬浮歌词。
        try { LyricOverlay.onActivityResume() } catch (_: Exception) {}
    }
}
