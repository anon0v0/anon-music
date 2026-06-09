package li.saki.anonmusic

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray

// App 外系统悬浮歌词（浮于其它 App / 桌面之上）。
// 关键点：歌词整段一次性下发，行进推进由「最近一次播放进度 + 经过的真实时间」插值算出，
// 不依赖 WebView 的 JS 定时器——WebView 退后台被节流时，这个原生时钟照样走，歌词照常滚动。
// 仅 framework + WindowManager，无需第三方依赖。需要「显示在其它应用上层」权限(SYSTEM_ALERT_WINDOW)。
object LyricOverlay {
    private const val TAG = "LyricOverlay"
    private val main = Handler(Looper.getMainLooper())

    private var appCtx: Context? = null
    private var wm: WindowManager? = null
    private var root: LinearLayout? = null
    private var curTv: TextView? = null
    private var nextTv: TextView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var ticking = false
    private var lastIdx = -2

    // 跨线程：setData/setPosition/setPlaying 由 JNI 线程写，tick 在主线程读。
    @Volatile private var wantShow = false
    @Volatile private var times = DoubleArray(0)
    @Volatile private var texts = arrayOf<String>()
    @Volatile private var posBaseMs = 0.0
    @Volatile private var posBaseWall = 0L
    @Volatile private var playing = false

    @JvmStatic
    fun canDraw(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx.applicationContext)

    @JvmStatic
    fun setShown(ctx: Context, show: Boolean) {
        appCtx = ctx.applicationContext
        wantShow = show
        main.post {
            if (show) {
                if (!canDraw(appCtx!!)) { requestPermission(appCtx!!); return@post }
                addView()
                startTick()
            } else {
                stopTick()
                removeView()
            }
        }
    }

    // 从授权页返回时调用：若已开启且已授权但还没显示，自动补上（免去再点一次）。
    @JvmStatic
    fun onActivityResume() {
        val c = appCtx ?: return
        main.post {
            if (wantShow && canDraw(c) && root == null) {
                addView()
                startTick()
            }
        }
    }

    @JvmStatic
    fun setData(json: String) {
        try {
            val arr = JSONArray(json)
            val t = DoubleArray(arr.length())
            val x = Array(arr.length()) { "" }
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                t[i] = o.optDouble("t", 0.0)
                x[i] = o.optString("text", "")
            }
            times = t; texts = x; lastIdx = -2
        } catch (e: Exception) {
            Log.e(TAG, "setData failed: ${e.message}")
        }
    }

    @JvmStatic
    fun setPosition(secs: Double) {
        posBaseMs = secs * 1000.0
        posBaseWall = SystemClock.elapsedRealtime()
    }

    @JvmStatic
    fun setPlaying(p: Boolean) {
        posBaseMs = curMs()             // 冻结当前推算值，避免暂停/恢复跳变
        posBaseWall = SystemClock.elapsedRealtime()
        playing = p
    }

    private fun curMs(): Double =
        posBaseMs + if (playing) (SystemClock.elapsedRealtime() - posBaseWall).toDouble() else 0.0

    // ---- 主线程：定时刷新当前行 ----
    private val tick = object : Runnable {
        override fun run() {
            if (!ticking) return
            updateLine()
            main.postDelayed(this, 300)
        }
    }
    private fun startTick() { if (!ticking) { ticking = true; main.post(tick) } }
    private fun stopTick() { ticking = false; main.removeCallbacks(tick) }

    private fun updateLine() {
        val tx = texts; val tm = times
        if (tx.isEmpty()) return
        val ms = curMs()
        var idx = -1
        for (i in tm.indices) { if (tm[i] * 1000.0 <= ms) idx = i else break }
        if (idx == lastIdx) return
        lastIdx = idx
        val cur = if (idx in tx.indices) tx[idx] else ""
        val next = if (idx + 1 in tx.indices) tx[idx + 1] else ""
        curTv?.text = if (cur.isEmpty()) "♪" else cur
        nextTv?.text = next
        nextTv?.visibility = if (next.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun requestPermission(ctx: Context) {
        try {
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            Log.e(TAG, "request overlay permission failed: ${e.message}")
        }
    }

    private fun dp(v: Int): Int =
        (v * (appCtx?.resources?.displayMetrics?.density ?: 2f)).toInt()

    private fun addView() {
        if (root != null) return
        val ctx = appCtx ?: return
        try {
            val w = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm = w
            val r = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(18), dp(8), dp(18), dp(8))
            }
            val cv = TextView(ctx).apply {
                setTextColor(Color.WHITE)
                textSize = 18f
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setShadowLayer(8f, 0f, 2f, 0xE6000000.toInt())
                text = "♪ Anon Music"
            }
            val nv = TextView(ctx).apply {
                setTextColor(0xCCFFFFFF.toInt())
                textSize = 14f
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setShadowLayer(6f, 0f, 1f, 0xE6000000.toInt())
                visibility = View.GONE
            }
            r.addView(cv)
            r.addView(nv)
            curTv = cv; nextTv = nv; root = r

            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

            val p = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            )
            p.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            p.y = dp(64)
            lp = p
            enableDrag()
            w.addView(r, p)
            lastIdx = -2
            updateLine()
        } catch (e: Exception) {
            Log.e(TAG, "addView failed: ${e.message}")
        }
    }

    private fun removeView() {
        try { root?.let { wm?.removeView(it) } } catch (_: Exception) {}
        root = null; curTv = null; nextTv = null; lp = null
    }

    private fun enableDrag() {
        val r = root ?: return
        val p = lp ?: return
        val w = wm ?: return
        var ix = 0; var iy = 0; var dx = 0f; var dy = 0f
        r.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { ix = p.x; iy = p.y; dx = e.rawX; dy = e.rawY; true }
                MotionEvent.ACTION_MOVE -> {
                    p.x = ix + (e.rawX - dx).toInt()
                    p.y = iy + (e.rawY - dy).toInt()
                    try { w.updateViewLayout(r, p) } catch (_: Exception) {}
                    true
                }
                else -> false
            }
        }
    }
}
