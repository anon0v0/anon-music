package li.saki.anonmusic

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Choreographer
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

// App 外系统悬浮歌词（浮于其它 App / 桌面之上）。v2：原生逐字卡拉OK渲染。
// 关键点：
//  1) 歌词整段(含逐字 words)一次性下发，行推进由「最近播放进度 + 经过的真实时间」插值，
//     不依赖 WebView 定时器——WebView 退后台被节流时原生时钟照样走。
//  2) 逐字高亮 = 自定义 KaraokeView 双 Paint：先画未唱色整行，再 clipRect 到进度像素画已唱渐变。
//     播放中且亮屏时用 Choreographer 逐帧刷新(≈60fps)；暂停/息屏退回 300ms 换行 tick。
//  3) 样式(字号/配色/单双行/对齐/透明度/仅后台/锁定)存 SharedPreferences，web 设置经
//     and-lyric-style 事件下发；位置可拖动(垂直)、锁定后完全穿透。
//  4) 悬浮窗轻点弹出小工具条(锁定/关闭)，关闭经 nativeOverlayCommand("lyrics") 回传 web 保持状态一致。
// 仅 framework + WindowManager，无第三方依赖。需要 SYSTEM_ALERT_WINDOW 权限。
object LyricOverlay {
    private const val TAG = "LyricOverlay"
    private const val PREFS = "lyric_overlay"
    private val main = Handler(Looper.getMainLooper())

    private var appCtx: Context? = null
    private var wm: WindowManager? = null
    private var root: LinearLayout? = null
    private var kCur: KaraokeView? = null
    private var kNext: KaraokeView? = null
    private var handle: LinearLayout? = null
    private var playBtn: ImageView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var ticking = false
    private var lastIdx = -2
    private var screenReceiver: BroadcastReceiver? = null
    private val hideHandle = Runnable { handle?.visibility = View.GONE }

    // Rust 经 JNI 调（收词条工具条动作 → and-ctl 回传前端）。类经 proguard -keep 保留。
    private external fun nativeOverlayCommand(cmd: String)
    private fun safeCommand(cmd: String) {
        try { nativeOverlayCommand(cmd) } catch (e: Throwable) { Log.e(TAG, "overlay cmd failed: ${e.message}") }
    }

    // ---- 样式（prefs 持久化，and-lyric-style 更新）----
    @Volatile private var fontSp = 19f
    @Volatile private var hlA = 0xFF2FD06F.toInt()
    @Volatile private var hlB = 0xFFA8FF78.toInt()
    @Volatile private var baseCol = 0x73FFFFFF
    @Volatile private var doubleRow = false
    @Volatile private var align = "center"
    @Volatile private var overlayAlpha = 1f
    @Volatile private var locked = false
    @Volatile private var onlyBackground = false
    @Volatile private var appForeground = true
    // 从媒体卡片点「词」时 App 在后台，Android 10+ 禁止后台启动 Activity，权限页拉不起来。
    // 这时置位，等用户下次打开 App（onActivityResume）再补引导。
    @Volatile private var pendingPermRequest = false

    // ---- 播放数据（JNI 线程写 / 主线程读）----
    private class Line(val t: Double, val text: String,
                       val wt: DoubleArray?, val wd: DoubleArray?, val wlen: IntArray?)
    @Volatile private var wantShow = false
    @Volatile private var lines: Array<Line> = emptyArray()
    @Volatile private var posBaseMs = 0.0
    @Volatile private var posBaseWall = 0L
    @Volatile private var playing = false
    @Volatile private var screenOn = true
    private var smooth = false
    // 当前行逐字缓存（主线程）
    private var curWt: DoubleArray? = null
    private var curWd: DoubleArray? = null
    private var curPrefix: FloatArray? = null   // 每词起点像素(前缀和)
    private var curWidths: FloatArray? = null

    @JvmStatic
    fun canDraw(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx.applicationContext)

    @JvmStatic
    fun setShown(ctx: Context, show: Boolean) {
        appCtx = ctx.applicationContext
        wantShow = show
        main.post {
            if (show) {
                // 先查权限再动手。原先是「先 addView，失败了才引导授权」，但 MIUI/HyperOS 上
                // 没授权时 addView 既不抛异常也不显示 —— root != null 成立，引导授权那条分支
                // 永远走不到，表现就是「点了「词」毫无反应，也不弹授权」。
                if (!canDraw(appCtx!!)) { requestPermission(appCtx!!); return@post }
                addView()
                if (root != null) {
                    startTick()
                    // 二次兜底：部分 ROM 上 canDrawOverlays 返回 true 但实际被拦，视图加得进去却
                    // 永远量不出尺寸。给它 800ms 落地，仍是 0 尺寸就当没权限，引导用户去开。
                    val r = root
                    main.postDelayed({
                        if (wantShow && r != null && r === root && r.width == 0 && r.height == 0) {
                            removeView(); stopTick()
                            requestPermission(appCtx!!)
                        }
                    }, 800)
                } else {
                    requestPermission(appCtx!!)
                }
            } else {
                stopTick()
                removeView()
            }
        }
    }

    // 从授权页返回时调用：若已开启但还没显示，自动补上（免去再点一次）。
    @JvmStatic
    fun onActivityResume() {
        appForeground = true
        main.post {
            applyVisibility()
            // 后台时没能弹出的授权引导，回到前台补上（此时启动 Activity 不受限制）
            val ctx = appCtx
            if (pendingPermRequest && ctx != null) {
                pendingPermRequest = false
                if (!canDraw(ctx)) { requestPermission(ctx); return@post }
            }
            if (wantShow && root == null) { addView(); if (root != null) startTick() }
        }
    }

    // MainActivity onPause 调用：驱动「仅在App外显示」
    @JvmStatic
    fun setAppForeground(fg: Boolean) {
        appForeground = fg
        main.post { applyVisibility() }
    }

    // and-lyric-style：{fontSize,hlA,hlB,base,doubleRow,align,opacity,onlyBackground}
    @JvmStatic
    fun setStyle(ctx: Context, json: String) {
        try {
            val o = JSONObject(json)
            if (o.has("fontSize")) fontSp = o.optDouble("fontSize", 17.0).toFloat().coerceIn(12f, 34f)
            if (o.has("hlA")) hlA = parseColor(o.optString("hlA"), hlA)
            if (o.has("hlB")) hlB = parseColor(o.optString("hlB"), hlB)
            if (o.has("base")) baseCol = parseColor(o.optString("base"), baseCol)
            if (o.has("doubleRow")) doubleRow = o.optBoolean("doubleRow", false)
            if (o.has("align")) align = o.optString("align", "center")
            if (o.has("opacity")) overlayAlpha = o.optDouble("opacity", 1.0).toFloat().coerceIn(0.3f, 1f)
            if (o.has("onlyBackground")) onlyBackground = o.optBoolean("onlyBackground", false)
            savePrefs(ctx.applicationContext)
            main.post { applyStyle(); lastIdx = -2; updateLine() }
        } catch (e: Exception) { Log.e(TAG, "setStyle failed: ${e.message}") }
    }

    // 媒体卡片锁定按钮需要读当前状态（同进程直调，不走 JNI）
    @JvmStatic
    fun isLocked(): Boolean = locked

    // and-lyric-lock（web 设置面板）/ 工具条锁定 / 媒体卡片锁定 → 锁定=完全穿透不可拖
    @JvmStatic
    fun setLocked(ctx: Context, v: Boolean) {
        locked = v
        try { prefs(ctx.applicationContext).edit().putBoolean("locked", v).apply() } catch (_: Exception) {}
        main.post {
            applyLockState()
            try { MusicService.pokeNotification() } catch (_: Throwable) {}   // 刷新媒体卡片锁图标
        }
    }

    @JvmStatic
    fun setData(json: String) {
        try {
            val arr = JSONArray(json)
            val ls = Array(arr.length()) { i ->
                val o = arr.getJSONObject(i)
                var wt: DoubleArray? = null
                var wd: DoubleArray? = null
                var wlen: IntArray? = null
                var text = o.optString("text", "")
                val wa = o.optJSONArray("words")
                if (wa != null && wa.length() > 0) {
                    val n = wa.length()
                    wt = DoubleArray(n); wd = DoubleArray(n); wlen = IntArray(n)
                    val sb = StringBuilder()
                    for (j in 0 until n) {
                        val w = wa.getJSONObject(j)
                        wt[j] = w.optDouble("t", 0.0)
                        wd[j] = w.optDouble("d", 0.0)
                        val ws = w.optString("w", "")
                        wlen[j] = ws.length
                        sb.append(ws)
                    }
                    if (sb.isNotEmpty()) text = sb.toString()   // 以逐字拼接为准，保证宽度缓存与渲染一致
                }
                Line(o.optDouble("t", 0.0), text, wt, wd, wlen)
            }
            lines = ls
            // lastIdx 属主线程：JNI 线程直接写有可见性问题（非 volatile），post 到主线程重置并立即刷新
            main.post { lastIdx = -2; if (ticking) updateLine() }
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
        main.post { if (handle?.visibility == View.VISIBLE) refreshPlayIcon() }
    }

    private fun curMs(): Double =
        posBaseMs + if (playing) (SystemClock.elapsedRealtime() - posBaseWall).toDouble() else 0.0

    // ---- 主线程：300ms 换行 tick（逐字平滑另走 Choreographer）----
    private val tick = object : Runnable {
        override fun run() {
            if (!ticking) return
            updateLine()
            main.postDelayed(this, 300)
        }
    }
    private fun startTick() { if (!ticking) { ticking = true; main.post(tick) } }
    private fun stopTick() { ticking = false; main.removeCallbacks(tick); setSmooth(false) }

    private val frameCb = object : Choreographer.FrameCallback {
        override fun doFrame(nanos: Long) {
            if (!smooth) return
            updateProgress()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }
    private fun setSmooth(on: Boolean) {
        if (smooth == on) return
        smooth = on
        val ch = Choreographer.getInstance()
        ch.removeFrameCallback(frameCb)   // 清掉可能仍挂着的旧回调：关→开竞态下会重复注册并逐次累积
        if (on) ch.postFrameCallback(frameCb)
    }

    private fun updateLine() {
        val ls = lines
        if (ls.isEmpty() || root == null) { setSmooth(false); return }
        val ms = curMs()
        var idx = -1
        for (i in ls.indices) { if (ls[i].t * 1000.0 <= ms) idx = i else break }
        if (idx != lastIdx) {
            lastIdx = idx
            val cur = if (idx in ls.indices) ls[idx] else null
            val next = if (idx + 1 in ls.indices) ls[idx + 1] else null
            val curText = cur?.text?.ifEmpty { "♪" } ?: "♪"
            kCur?.setLine(curText)
            rebuildWordCache(cur)
            kNext?.setLine(next?.text ?: "")
            kNext?.visibility = if (doubleRow && !(next?.text.isNullOrEmpty())) View.VISIBLE else View.GONE
        }
        // 逐字平滑只在 播放中+亮屏+可见+当前行有词 时跑（onlyBackground 隐藏时不空转 60fps）
        setSmooth(playing && screenOn && curWt != null && ticking &&
            root?.visibility == View.VISIBLE)
        if (curWt == null) kCur?.setProgress(-1f) else if (!smooth) updateProgress()
    }

    private fun rebuildWordCache(cur: Line?) {
        val v = kCur
        if (cur?.wt == null || cur.wlen == null || v == null) {
            curWt = null; curWd = null; curPrefix = null; curWidths = null; return
        }
        curWt = cur.wt; curWd = cur.wd
        // 逐词按字符长度切片量宽（words 拼接即 text，见 setData）：
        // progressPx = prefix[k] + width[k] * 词内进度
        val n = cur.wt.size
        val widths = FloatArray(n)
        val prefix = FloatArray(n)
        var acc = 0f
        var chIdx = 0
        val txt = cur.text
        for (j in 0 until n) {
            val end = (chIdx + cur.wlen[j]).coerceAtMost(txt.length)
            widths[j] = if (end > chIdx) v.measure(txt, chIdx, end) else 0f
            prefix[j] = acc
            acc += widths[j]
            chIdx = end
        }
        curWidths = widths; curPrefix = prefix
    }

    private fun updateProgress() {
        val wt = curWt ?: return
        val wd = curWd
        val prefix = curPrefix ?: return
        val widths = curWidths ?: return
        val sec = curMs() / 1000.0
        var k = -1
        for (i in wt.indices) { if (wt[i] <= sec) k = i else break }
        val px = if (k < 0) 0f else {
            val start = wt[k]
            val effDur = when {
                wd != null && wd[k] > 0.01 -> wd[k]
                k + 1 < wt.size -> (wt[k + 1] - start).coerceAtLeast(0.05)
                else -> 0.6
            }
            val frac = (((sec - start) / effDur).coerceIn(0.0, 1.0)).toFloat()
            prefix[k] + widths[k] * frac
        }
        kCur?.setProgress(px)
    }

    // 悬浮窗授权引导。
    // 标准的 ACTION_MANAGE_OVERLAY_PERMISSION 在原生 Android 上没问题，但国产 ROM 各有各的
    // 权限中心：小米/红米(MIUI/HyperOS)、OPPO(ColorOS)、vivo(OriginOS/Funtouch) 的悬浮窗开关
    // 都不在系统那个页面里，跳过去用户只会看到一个「已允许」却依然不生效。这里按厂商依次尝试
    // 各自的权限页，全都不可用再退回系统页，最后兜底到应用详情页。
    private fun overlayPermissionIntents(ctx: Context): List<Intent> {
        val pkg = ctx.packageName
        val brand = (Build.MANUFACTURER + " " + Build.BRAND).lowercase()
        val list = mutableListOf<Intent>()

        if (brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")) {
            // MIUI / HyperOS 权限编辑器
            list += Intent("miui.intent.action.APP_PERM_EDITOR")
                .setClassName("com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity")
                .putExtra("extra_pkgname", pkg)
            list += Intent("miui.intent.action.APP_PERM_EDITOR")
                .setClassName("com.miui.securitycenter",
                    "com.miui.permcenter.permissions.AppPermissionsEditorActivity")
                .putExtra("extra_pkgname", pkg)
        }
        if (brand.contains("oppo") || brand.contains("realme") || brand.contains("oneplus")) {
            // ColorOS 各版本安全中心包名换过好几次，全试一遍
            list += Intent().setClassName("com.coloros.safecenter",
                "com.coloros.safecenter.permission.floatwindow.FloatWindowListActivity")
            list += Intent().setClassName("com.coloros.safecenter",
                "com.coloros.safecenter.sysfloatwindow.FloatWindowListActivity")
            list += Intent().setClassName("com.color.safecenter",
                "com.color.safecenter.permission.floatwindow.FloatWindowListActivity")
            list += Intent().setClassName("com.oppo.safe",
                "com.oppo.safe.permission.floatwindow.FloatWindowListActivity")
        }
        if (brand.contains("vivo") || brand.contains("iqoo")) {
            list += Intent().setClassName("com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity")
                .putExtra("packagename", pkg)
            list += Intent().setClassName("com.iqoo.secure",
                "com.iqoo.secure.safeguard.SoftPermissionDetailActivity")
                .putExtra("packagename", pkg)
        }
        if (brand.contains("huawei") || brand.contains("honor")) {
            list += Intent().setClassName("com.huawei.systemmanager",
                "com.huawei.permissionmanager.ui.MainActivity")
        }

        // 系统标准页（原生 Android / 上面全不可用时）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            list += Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$pkg"))
        }
        // 最后兜底：应用详情页，用户自己进「权限」
        list += Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
        return list
    }

    private fun requestPermission(ctx: Context) {
        try {
            Toast.makeText(ctx, "请开启「显示在其他应用上层 / 悬浮窗」权限后，再点一次「词」", Toast.LENGTH_LONG).show()
        } catch (_: Exception) {}
        // 不用 resolveActivity 预判：Android 11+ 的包可见性限制会让它对这些厂商组件返回 null，
        // 反而把国产 ROM 的页面全跳过。直接试，抛异常再退到下一个。
        for (intent in overlayPermissionIntents(ctx)) {
            try {
                ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (e: Exception) {
                Log.e(TAG, "overlay perm intent failed: ${intent.component} ${e.message}")
            }
        }
        pendingPermRequest = true
        Log.e(TAG, "no usable overlay permission page (可能是后台无法启动 Activity)，待回到前台再试")
    }

    private fun dp(v: Int): Int =
        (v * (appCtx?.resources?.displayMetrics?.density ?: 2f)).toInt()
    private fun sp(v: Float): Float =
        v * (appCtx?.resources?.displayMetrics?.scaledDensity ?: 2.6f)

    // ---- 工具条图标（运行时画 Bitmap，白色描边/填充，深色药丸底上清晰）----
    private fun glyphBitmap(kind: String, px: Int): Bitmap {
        val bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val w = px.toFloat()
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; style = Paint.Style.STROKE
            strokeWidth = w * 0.11f; strokeCap = Paint.Cap.ROUND
        }
        when (kind) {
            "prev" -> {
                c.drawRect(w * 0.14f, w * 0.22f, w * 0.24f, w * 0.78f, fill)
                c.drawPath(Path().apply { moveTo(w * 0.86f, w * 0.22f); lineTo(w * 0.86f, w * 0.78f); lineTo(w * 0.34f, w * 0.5f); close() }, fill)
            }
            "next" -> {
                c.drawPath(Path().apply { moveTo(w * 0.14f, w * 0.22f); lineTo(w * 0.14f, w * 0.78f); lineTo(w * 0.66f, w * 0.5f); close() }, fill)
                c.drawRect(w * 0.76f, w * 0.22f, w * 0.86f, w * 0.78f, fill)
            }
            "play" -> c.drawPath(Path().apply { moveTo(w * 0.30f, w * 0.18f); lineTo(w * 0.30f, w * 0.82f); lineTo(w * 0.88f, w * 0.5f); close() }, fill)
            "pause" -> {
                c.drawRect(w * 0.24f, w * 0.20f, w * 0.42f, w * 0.80f, fill)
                c.drawRect(w * 0.58f, w * 0.20f, w * 0.76f, w * 0.80f, fill)
            }
            "lock" -> {
                c.drawRoundRect(w * 0.24f, w * 0.48f, w * 0.76f, w * 0.88f, w * 0.08f, w * 0.08f, fill)
                c.drawArc(RectF(w * 0.32f, w * 0.16f, w * 0.68f, w * 0.56f), 180f, 180f, false, stroke)
            }
            "close" -> {
                c.drawLine(w * 0.27f, w * 0.27f, w * 0.73f, w * 0.73f, stroke)
                c.drawLine(w * 0.73f, w * 0.27f, w * 0.27f, w * 0.73f, stroke)
            }
        }
        return bmp
    }
    private fun refreshPlayIcon() {
        playBtn?.setImageBitmap(glyphBitmap(if (playing) "pause" else "play", dp(20)))
    }
    private fun showHandle() {
        handle?.visibility = View.VISIBLE
        refreshPlayIcon()
        bumpHandleTimer()
    }
    private fun bumpHandleTimer() {   // 5s 无操作自动收起
        main.removeCallbacks(hideHandle)
        main.postDelayed(hideHandle, 5000)
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun loadPrefs(ctx: Context) {
        try {
            val p = prefs(ctx)
            fontSp = p.getFloat("fontSp", 19f)
            hlA = p.getInt("hlA", hlA); hlB = p.getInt("hlB", hlB); baseCol = p.getInt("base", baseCol)
            doubleRow = p.getBoolean("doubleRow", false)
            align = p.getString("align", "center") ?: "center"
            overlayAlpha = p.getFloat("alpha", 1f)
            locked = p.getBoolean("locked", false)
            onlyBackground = p.getBoolean("onlyBackground", false)
        } catch (_: Exception) {}
    }
    private fun savePrefs(ctx: Context) {
        try {
            prefs(ctx).edit()
                .putFloat("fontSp", fontSp)
                .putInt("hlA", hlA).putInt("hlB", hlB).putInt("base", baseCol)
                .putBoolean("doubleRow", doubleRow)
                .putString("align", align)
                .putFloat("alpha", overlayAlpha)
                .putBoolean("locked", locked)
                .putBoolean("onlyBackground", onlyBackground)
                .apply()
        } catch (_: Exception) {}
    }

    private fun parseColor(s: String?, fallback: Int): Int {
        if (s.isNullOrBlank()) return fallback
        return try {
            val t = s.trim()
            if (t.startsWith("rgba", true) || t.startsWith("rgb", true)) {
                val nums = t.substringAfter('(').substringBefore(')').split(',').map { it.trim() }
                val r = nums[0].toFloat().toInt().coerceIn(0, 255)
                val g = nums[1].toFloat().toInt().coerceIn(0, 255)
                val b = nums[2].toFloat().toInt().coerceIn(0, 255)
                val a = if (nums.size > 3) (nums[3].toFloat() * 255).toInt().coerceIn(0, 255) else 255
                Color.argb(a, r, g, b)
            } else Color.parseColor(t)
        } catch (e: Exception) { fallback }
    }

    // ---- 视图 ----
    private fun applyStyle() {
        val ctx = appCtx ?: return
        kCur?.let {
            it.setFontPx(sp(fontSp))
            it.setColors(hlA, hlB, baseCol)
            it.alignMode = align
            it.invalidate()
        }
        kNext?.let {
            it.setFontPx(sp((fontSp - 5f).coerceAtLeast(12f)))
            it.setColors(hlA, hlB, baseCol)
            it.alignMode = align
            it.dimWhole = true
            it.invalidate()
        }
        root?.alpha = overlayAlpha
        if (!doubleRow) kNext?.visibility = View.GONE   // 开启双行由 updateLine(行变化)恢复
        applyVisibility()
    }

    private fun applyVisibility() {
        root?.visibility = if (onlyBackground && appForeground) View.GONE else View.VISIBLE
    }

    private fun applyLockState() {
        val r = root ?: return
        val p = lp ?: return
        if (!locked) {
            // 解锁：部分 ROM(MIUI/HyperOS) 上 updateViewLayout 去掉 FLAG_NOT_TOUCHABLE
            // 偶发不生效 → 表现为"锁定后无法解锁"。改为重建窗口（位置/样式在 prefs，无感）。
            removeView()
            addView()
            if (wantShow && root != null) startTick()
            return
        }
        p.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        try { wm?.updateViewLayout(r, p) } catch (e: Exception) { Log.e(TAG, "updateViewLayout: ${e.message}") }
        handle?.visibility = View.GONE
    }

    private fun addView() {
        if (root != null) return
        val ctx = appCtx ?: return
        loadPrefs(ctx)
        try {
            val w = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val r = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(16), dp(4), dp(16), dp(6))
            }
            val full = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            // 轻点悬浮歌词弹出的小工具条（仿 QQ）：上一首/播放暂停/下一首 ｜ 锁定/关闭，5s 自动收起
            val hd = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                visibility = View.GONE
                background = GradientDrawable().apply {
                    setColor(0xE6141420.toInt()); cornerRadius = dp(16).toFloat()
                }
                setPadding(dp(8), dp(2), dp(8), dp(2))
            }
            fun iconBtn(kind: String, cmd: () -> Unit) = ImageView(ctx).apply {
                setImageBitmap(glyphBitmap(kind, dp(20)))
                setPadding(dp(11), dp(8), dp(11), dp(8))
                setOnClickListener { bumpHandleTimer(); cmd() }
            }
            fun sep() = View(ctx).apply {
                setBackgroundColor(0x33FFFFFF)
                layoutParams = LinearLayout.LayoutParams(dp(1), dp(16)).apply {
                    gravity = Gravity.CENTER_VERTICAL; leftMargin = dp(4); rightMargin = dp(4)
                }
            }
            hd.addView(iconBtn("prev") { safeCommand("prev") })
            val pb = iconBtn(if (playing) "pause" else "play") { safeCommand("playpause") }
            hd.addView(pb)
            hd.addView(iconBtn("next") { safeCommand("next") })
            hd.addView(sep())
            hd.addView(iconBtn("lock") {
                locked = true
                try { prefs(ctx).edit().putBoolean("locked", true).apply() } catch (_: Exception) {}
                applyLockState()
                safeCommand("lyriclock")   // 回传 web 同步设置面板状态
                try { MusicService.pokeNotification() } catch (_: Throwable) {}   // 媒体卡片出现解锁按钮
            })
            hd.addView(iconBtn("close") { safeCommand("lyrics") })   // 走 web 的 DeskLyric.toggle，两端状态一致

            val cv = KaraokeView(ctx)
            val nv = KaraokeView(ctx).apply { dimWhole = true; visibility = View.GONE }
            r.addView(hd, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(4) })
            r.addView(cv, full)
            r.addView(nv, LinearLayout.LayoutParams(full))

            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

            val baseFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            val p = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                if (locked) baseFlags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else baseFlags,
                PixelFormat.TRANSLUCENT
            )
            p.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            p.y = try { prefs(ctx).getInt("posY", dp(56)) } catch (_: Exception) { dp(56) }

            // 未锁定：垂直拖动 + 轻点弹工具条
            var startRawY = 0f; var startLpY = 0; var moved = false
            r.setOnTouchListener { _, e ->
                if (locked) return@setOnTouchListener false
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { startRawY = e.rawY; startLpY = p.y; moved = false; true }
                    MotionEvent.ACTION_MOVE -> {
                        val dy = e.rawY - startRawY
                        if (abs(dy) > dp(4)) moved = true
                        if (moved) { p.y = (startLpY + dy).toInt().coerceAtLeast(0); try { w.updateViewLayout(r, p) } catch (_: Exception) {} }
                        true
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (moved) { try { prefs(ctx).edit().putInt("posY", p.y).apply() } catch (_: Exception) {} }
                        else { if (hd.visibility == View.VISIBLE) hd.visibility = View.GONE else showHandle() }
                        true
                    }
                    else -> false
                }
            }

            w.addView(r, p)                 // 没悬浮窗权限会在这里抛异常
            // 仅在真正加上之后才记录状态；否则 root 保持 null → 上层会去引导授权。
            wm = w; root = r; kCur = cv; kNext = nv; handle = hd; playBtn = pb; lp = p
            lastIdx = -2
            applyStyle()
            cv.setLine("♪ Anon Music")
            registerScreenReceiver(ctx)
            updateLine()
        } catch (e: Exception) {
            Log.e(TAG, "addView failed (可能没有悬浮窗权限): ${e.message}")
            root = null; kCur = null; kNext = null; handle = null; lp = null
        }
    }

    private fun removeView() {
        try { root?.let { wm?.removeView(it) } } catch (_: Exception) {}
        try { screenReceiver?.let { appCtx?.unregisterReceiver(it) } } catch (_: Exception) {}
        screenReceiver = null
        main.removeCallbacks(hideHandle)
        root = null; kCur = null; kNext = null; handle = null; playBtn = null; lp = null
        setSmooth(false)
    }

    // 息屏停 60fps 平滑（省电），亮屏恢复
    private fun registerScreenReceiver(ctx: Context) {
        if (screenReceiver != null) return
        val rec = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) {
                when (i?.action) {
                    Intent.ACTION_SCREEN_OFF -> { screenOn = false; setSmooth(false) }
                    Intent.ACTION_SCREEN_ON -> { screenOn = true; main.post { updateLine() } }
                }
            }
        }
        try {
            ctx.registerReceiver(rec, IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF)
            })
            screenReceiver = rec
        } catch (e: Exception) { Log.e(TAG, "register screen receiver: ${e.message}") }
    }

    // ---- 逐字卡拉OK行 ----
    // 双 Paint：base(未唱色+阴影) 整行打底，再 clipRect(0..progressPx) 画 hl(已唱 hlA→hlB 渐变)。
    // progressPx<0 = 无逐字数据：整行直接用 hl 渐变（当前行）或 base 色（dimWhole=下一行）。
    class KaraokeView(ctx: Context) : View(ctx) {
        private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL; typeface = Typeface.DEFAULT_BOLD
        }
        private val hlPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL; typeface = Typeface.DEFAULT_BOLD
        }
        private var text = ""
        private var textW = 0f
        private var progressPx = -1f
        private var cA = Color.WHITE; private var cB = Color.WHITE
        var alignMode = "center"
        var dimWhole = false

        fun measure(s: String, start: Int, end: Int): Float = basePaint.measureText(s, start, end)

        fun setLine(t: String) {
            if (t == text) return
            text = t; textW = basePaint.measureText(t); progressPx = -1f
            rebuildShader(); requestLayout(); invalidate()
        }
        fun setFontPx(px: Float) {
            basePaint.textSize = px; hlPaint.textSize = px
            basePaint.setShadowLayer(px / 4f, 0f, 2f, 0xE6000000.toInt())
            hlPaint.setShadowLayer(px / 5f, 0f, 1f, 0x99000000.toInt())
            textW = basePaint.measureText(text)
            rebuildShader(); requestLayout(); invalidate()
        }
        fun setColors(a: Int, b: Int, base: Int) {
            cA = a; cB = b; basePaint.color = base
            rebuildShader(); invalidate()
        }
        fun setProgress(px: Float) { if (px != progressPx) { progressPx = px; invalidate() } }

        private fun rebuildShader() {
            hlPaint.shader = if (textW > 0f)
                LinearGradient(0f, 0f, textW, 0f, cA, cB, Shader.TileMode.CLAMP)
            else null
            if (textW <= 0f) hlPaint.color = cA
        }

        override fun onMeasure(widthSpec: Int, heightSpec: Int) {
            val fm = basePaint.fontMetrics
            val h = (fm.bottom - fm.top).toInt() + paddingTop + paddingBottom + 4
            setMeasuredDimension(MeasureSpec.getSize(widthSpec), h)
        }

        override fun onDraw(c: Canvas) {
            if (text.isEmpty()) return
            val fm = basePaint.fontMetrics
            val baseline = paddingTop - fm.top + 2
            var x0 = when (alignMode) {
                "left" -> 0f
                "right" -> width - textW
                else -> (width - textW) / 2f
            }
            // 超宽行：跟随唱到的位置平移，保证高亮点始终可见（类 QQ 走字）
            if (textW > width) {
                x0 = 0f
                if (progressPx > width * 0.55f) {
                    x0 = -(progressPx - width * 0.55f).coerceAtMost(textW - width)
                }
            }
            c.save()
            c.translate(x0, 0f)
            if (progressPx < 0f) {
                c.drawText(text, 0f, baseline, if (dimWhole) basePaint else hlPaint)
            } else {
                c.drawText(text, 0f, baseline, basePaint)
                c.save()
                c.clipRect(0f, 0f, progressPx.coerceIn(0f, textW), height.toFloat())
                c.drawText(text, 0f, baseline, hlPaint)
                c.restore()
            }
            c.restore()
        }
    }
}
