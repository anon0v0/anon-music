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

        @Volatile private var instance: MainActivity? = null

        /** Rust 收到网页 shell-hello（页面加载完成）后经 JNI 调用，移除启动遮罩。 */
        @JvmStatic
        fun hideSplash() {
            val act = instance ?: return
            act.runOnUiThread { act.removeSplash() }
        }
    }

    private external fun initAndroidContext(activity: android.app.Activity)
    private var webView: WebView? = null
    private var splashView: android.widget.FrameLayout? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        instance = this
        initAndroidContext(this)
        super.onCreate(savedInstanceState)
        showSplash()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 1001)
            } catch (_: Exception) {}
        }
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** 启动遮罩：远程页面加载完成前盖住白屏/黑屏等待（shell-hello 后移除，20s 兜底自动消失）。 */
    private fun showSplash() {
        try {
            val f = android.widget.FrameLayout(this)
            f.setBackgroundColor(0xFF0B0B0F.toInt())
            val ll = android.widget.LinearLayout(this)
            ll.orientation = android.widget.LinearLayout.VERTICAL
            ll.gravity = android.view.Gravity.CENTER
            val tv = android.widget.TextView(this)
            tv.text = "Anon Music"
            tv.setTextColor(0xFFFFFFFF.toInt())
            tv.textSize = 24f
            tv.typeface = android.graphics.Typeface.DEFAULT_BOLD
            tv.gravity = android.view.Gravity.CENTER
            val pb = android.widget.ProgressBar(this)
            val pbLp = android.widget.LinearLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT
            )
            pbLp.topMargin = (26 * resources.displayMetrics.density).toInt()
            pbLp.gravity = android.view.Gravity.CENTER_HORIZONTAL
            ll.addView(tv)
            ll.addView(pb, pbLp)
            f.addView(ll, android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT))
            (window.decorView as android.view.ViewGroup).addView(f,
                android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT))
            splashView = f
            f.postDelayed({ removeSplash() }, 20000)   // 兜底：断网/加载失败也不至于永远挡住
        } catch (_: Exception) {}
    }

    private fun removeSplash() {
        splashView?.let { v -> (v.parent as? android.view.ViewGroup)?.removeView(v) }
        splashView = null
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
        // 悬浮歌词「仅在App外显示」：退到后台时通知补显
        try { LyricOverlay.setAppForeground(false) } catch (_: Exception) {}
    }

    override fun onResume() {
        super.onResume()
        // 从「显示在其它应用上层」授权页返回时，自动补显悬浮歌词；同时驱动「仅在App外显示」。
        try { LyricOverlay.onActivityResume() } catch (_: Exception) {}
    }
}
