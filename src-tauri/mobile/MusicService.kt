package li.saki.anonmusic

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.net.URL
import kotlin.concurrent.thread

// 前台服务 + 系统 MediaSession：承载锁屏/通知/媒体键控制。
// 音频本体在 WebView 的 <audio> 里播放，本服务只负责「显示元数据 + 把控制意图
// 通过 JNI(nativePlayerCommand/Seek)回传给 Rust → 前端去操作 <audio>」。
// 仅用 framework API（android.media.* / Notification.MediaStyle），不依赖 androidx.media，
// 因此无需改 build.gradle 依赖。
class MusicService : Service() {
    companion object {
        const val CHANNEL_ID = "anon_music_playback"
        const val NOTIFICATION_ID = 1001
        const val ACTION_PLAY = "li.saki.anonmusic.PLAY"
        const val ACTION_PAUSE = "li.saki.anonmusic.PAUSE"
        const val ACTION_NEXT = "li.saki.anonmusic.NEXT"
        const val ACTION_PREV = "li.saki.anonmusic.PREV"
        const val ACTION_STOP = "li.saki.anonmusic.STOP"
        const val ACTION_LIKE = "li.saki.anonmusic.LIKE"
        const val ACTION_LYRICS = "li.saki.anonmusic.LYRICS"

        @Volatile var instance: MusicService? = null

        // 服务尚未创建时先暂存，onCreate 后补发。
        @Volatile private var pendingTitle = ""
        @Volatile private var pendingArtist = ""
        @Volatile private var pendingAlbum = ""
        @Volatile private var pendingDurationMs = 0L
        @Volatile private var pendingCoverUrl = ""
        @Volatile private var pendingLiked = false
        @Volatile private var pendingLyrics = false

        @JvmStatic
        fun start(context: Context) {
            try {
                val intent = Intent(context, MusicService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (e: Exception) {
                Log.e("MusicService", "start failed: ${e.message}")
            }
        }

        @JvmStatic
        fun stop(context: Context) {
            context.stopService(Intent(context, MusicService::class.java))
        }

        @JvmStatic
        fun updateNowPlaying(title: String, artist: String, album: String, durationMs: Long, coverUrl: String) {
            pendingTitle = title; pendingArtist = artist; pendingAlbum = album
            pendingDurationMs = durationMs; pendingCoverUrl = coverUrl
            instance?.updateNowPlayingInternal(title, artist, album, durationMs, coverUrl)
        }

        @JvmStatic
        fun setPlaying(playing: Boolean) { instance?.setPlayingInternal(playing) }

        @JvmStatic
        fun updatePlaybackPosition(positionMs: Long, durationMs: Long) {
            instance?.updatePositionInternal(positionMs, durationMs)
        }

        // 当前歌是否已收藏（控制爱心实心/空心）
        @JvmStatic
        fun setLiked(liked: Boolean) { pendingLiked = liked; instance?.setLikedInternal(liked) }

        // 悬浮歌词是否开启（控制「词」按钮打勾）
        @JvmStatic
        fun setLyricsActive(active: Boolean) { pendingLyrics = active; instance?.setLyricsInternal(active) }
    }

    private external fun nativePlayerCommand(cmd: String)
    private external fun nativePlayerSeek(positionMs: Long)

    fun isPlaying(): Boolean = nowPlaying

    private var mediaSession: MediaSession? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var coverBitmap: Bitmap? = null
    private var coverUrlLoaded = ""
    private var isForeground = false
    private var nowTitle = ""
    private var nowArtist = ""
    private var nowAlbum = ""
    private var nowPlaying = false
    private var lastPositionMs = 0L
    private var lastDurationMs = 0L
    private var liked = false
    private var lyricsActive = false

    fun setLikedInternal(v: Boolean) { liked = v; updateNotification() }
    fun setLyricsInternal(v: Boolean) { lyricsActive = v; updateNotification() }

    // ---- 生命周期 ----
    override fun onCreate() {
        super.onCreate()
        instance = this
        liked = pendingLiked
        lyricsActive = pendingLyrics
        try {
            createChannel()
            setupSession()
            setupWakeLock()
            if (pendingTitle.isNotEmpty()) {
                updateNowPlayingInternal(pendingTitle, pendingArtist, pendingAlbum, pendingDurationMs, pendingCoverUrl)
            }
        } catch (e: Exception) {
            Log.e("MusicService", "onCreate failed: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 必须先进前台：startForegroundService 后 5s 内不 startForeground 会 ANR 崩溃。
        if (!isForeground) {
            if (!startAsForeground()) { stopSelf(); return START_NOT_STICKY }
        }
        intent?.let { try { handleIntent(it) } catch (_: Exception) {} }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        mediaSession?.release(); mediaSession = null
        coverBitmap?.recycle(); coverBitmap = null
        isForeground = false; instance = null
        super.onDestroy()
    }

    // ---- 通知渠道 ----
    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "音乐播放", NotificationManager.IMPORTANCE_LOW).apply {
                description = "显示当前播放的歌曲"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    // ---- MediaSession（锁屏 + 媒体键 + 蓝牙） ----
    private fun setupSession() {
        mediaSession = MediaSession(this, "AnonMusic").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { nativePlayerCommand("play") }
                override fun onPause() { nativePlayerCommand("pause") }
                override fun onSkipToNext() { nativePlayerCommand("next") }
                override fun onSkipToPrevious() { nativePlayerCommand("prev") }
                override fun onStop() { nativePlayerCommand("stop") }
                override fun onSeekTo(pos: Long) { nativePlayerSeek(pos) }
            })
            setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
            isActive = true
        }
    }

    // ---- WakeLock ----
    @Suppress("DEPRECATION")
    private fun setupWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AnonMusic::Playback")
    }
    private fun acquireWakeLock() { wakeLock?.let { if (!it.isHeld) it.acquire(4 * 60 * 60 * 1000L) } }
    private fun releaseWakeLock() { wakeLock?.let { if (it.isHeld) it.release() } }

    // ---- 前台通知 ----
    // 返回是否成功进前台。任何异常都吞掉并返回 false（由调用方 stopSelf），绝不让它崩主线程。
    private fun startAsForeground(): Boolean {
        val n = try { buildNotification() } catch (e: Exception) {
            Log.e("MusicService", "buildNotification failed: ${e.message}"); return false
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, n)
            }
        } catch (e: Exception) {
            // Android 14+ 对前台服务类型/权限更严，退化为不带类型再试一次。
            Log.e("MusicService", "startForeground(typed) failed: ${e.message}")
            try {
                startForeground(NOTIFICATION_ID, n)
            } catch (e2: Exception) {
                Log.e("MusicService", "startForeground(plain) failed: ${e2.message}")
                return false
            }
        }
        isForeground = true
        return true
    }

    private fun actionIntent(action: String, req: Int): PendingIntent =
        PendingIntent.getService(
            this, req,
            Intent(this, MusicService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    @Suppress("DEPRECATION")
    private fun buildNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val ppIcon = if (nowPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val ppText = if (nowPlaying) "暂停" else "播放"
        val ppAction = if (nowPlaying) ACTION_PAUSE else ACTION_PLAY

        // 仿 QQ 音乐：[我喜欢] 上一首 播放/暂停 下一首 [词]。
        // 展开视图显示全部 5 键；折叠视图只显示中间 3 键(索引 1/2/3)。
        val actions = listOf(
            Notification.Action.Builder(heartIcon(liked), if (liked) "取消喜欢" else "喜欢", actionIntent(ACTION_LIKE, 4)).build(),
            Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_previous), "上一首", actionIntent(ACTION_PREV, 1)).build(),
            Notification.Action.Builder(Icon.createWithResource(this, ppIcon), ppText, actionIntent(ppAction, 2)).build(),
            Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_next), "下一首", actionIntent(ACTION_NEXT, 3)).build(),
            Notification.Action.Builder(lyricIcon(lyricsActive), "歌词", actionIntent(ACTION_LYRICS, 5)).build()
        )

        val style = Notification.MediaStyle().setShowActionsInCompactView(1, 2, 3)
        mediaSession?.sessionToken?.let { style.setMediaSession(it) }

        val builder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this))
            .setContentTitle(if (nowTitle.isNotEmpty()) nowTitle else "Anon Music")
            .setContentText(nowArtist)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(nowPlaying)
            .setOnlyAlertOnce(true)
            .setStyle(style)
        for (a in actions) builder.addAction(a)
        coverBitmap?.let { builder.setLargeIcon(it) }
        return builder.build()
    }

    // ---- 通知按钮图标（运行时画成 Bitmap；通知 action 图标会被系统染成单色，
    //      故只能靠「形状」区分状态：实心/空心心、词/词+√，颜色无效）----
    private fun dpi(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun heartIcon(filled: Boolean): Icon {
        val s = dpi(24)
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = if (filled) Paint.Style.FILL else Paint.Style.STROKE
            strokeWidth = s * 0.085f
            strokeJoin = Paint.Join.ROUND
        }
        val w = s.toFloat()
        val path = Path().apply {
            moveTo(w * 0.5f, w * 0.30f)
            cubicTo(w * 0.42f, w * 0.12f, w * 0.05f, w * 0.18f, w * 0.05f, w * 0.42f)
            cubicTo(w * 0.05f, w * 0.62f, w * 0.30f, w * 0.78f, w * 0.5f, w * 0.92f)
            cubicTo(w * 0.70f, w * 0.78f, w * 0.95f, w * 0.62f, w * 0.95f, w * 0.42f)
            cubicTo(w * 0.95f, w * 0.18f, w * 0.58f, w * 0.12f, w * 0.5f, w * 0.30f)
            close()
        }
        c.drawPath(path, p)
        return Icon.createWithBitmap(bmp)
    }

    private fun lyricIcon(on: Boolean): Icon {
        val s = dpi(24)
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = s * (if (on) 0.6f else 0.72f)
            isFakeBoldText = true
        }
        val fm = tp.fontMetrics
        val cx = if (on) s * 0.42f else s * 0.5f
        val cy = s / 2f - (fm.ascent + fm.descent) / 2f - (if (on) s * 0.06f else 0f)
        c.drawText("词", cx, cy, tp)
        if (on) {
            val cp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE; style = Paint.Style.STROKE
                strokeWidth = s * 0.09f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
            }
            val path = Path().apply {
                moveTo(s * 0.58f, s * 0.66f)
                lineTo(s * 0.70f, s * 0.82f)
                lineTo(s * 0.97f, s * 0.46f)
            }
            c.drawPath(path, cp)
        }
        return Icon.createWithBitmap(bmp)
    }

    private fun updateNotification() {
        if (!isForeground) return
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.e("MusicService", "updateNotification failed: ${e.message}")
        }
    }

    // ---- 通知按钮 → 回传前端 ----
    private fun handleIntent(intent: Intent) {
        when (intent.action) {
            ACTION_PLAY -> nativePlayerCommand("play")
            ACTION_PAUSE -> nativePlayerCommand("pause")
            ACTION_NEXT -> nativePlayerCommand("next")
            ACTION_PREV -> nativePlayerCommand("prev")
            ACTION_LIKE -> nativePlayerCommand("like")
            ACTION_LYRICS -> nativePlayerCommand("lyrics")
            ACTION_STOP -> {
                nativePlayerCommand("stop")
                stopForeground(STOP_FOREGROUND_REMOVE)
                isForeground = false
                stopSelf()
            }
        }
    }

    // ---- 元数据/状态/进度 ----
    private fun updateNowPlayingInternal(title: String, artist: String, album: String, durationMs: Long, coverUrl: String) {
        nowTitle = title; nowArtist = artist; nowAlbum = album; lastDurationMs = durationMs
        if (coverUrl != coverUrlLoaded) {
            coverBitmap?.recycle(); coverBitmap = null; coverUrlLoaded = coverUrl
            if (coverUrl.isNotEmpty()) { loadCoverAsync(coverUrl); applyMetadata(); return }
        }
        applyMetadata()
    }

    private fun applyMetadata() {
        val md = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, nowTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, nowArtist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, nowAlbum)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, lastDurationMs)
        coverBitmap?.let { md.putBitmap(MediaMetadata.METADATA_KEY_ART, it) }
        try { mediaSession?.setMetadata(md.build()) } catch (_: Exception) {}
        updateNotification()
    }

    private fun setPlayingInternal(playing: Boolean) {
        nowPlaying = playing
        if (playing) acquireWakeLock() else releaseWakeLock()
        pushState()
        updateNotification()
    }

    private fun updatePositionInternal(positionMs: Long, durationMs: Long) {
        lastPositionMs = positionMs
        // 时长首次确定/明显变化时刷新元数据（锁屏进度条总时长）。
        if (durationMs > 0 && Math.abs(durationMs - lastDurationMs) > 1000) {
            lastDurationMs = durationMs
            applyMetadata()
        }
        pushState()
    }

    private fun pushState() {
        val state = if (nowPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        try {
            mediaSession?.setPlaybackState(
                PlaybackState.Builder()
                    .setActions(
                        PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SKIP_TO_NEXT or
                        PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO
                    )
                    .setState(state, lastPositionMs, if (nowPlaying) 1.0f else 0.0f, SystemClock.elapsedRealtime())
                    .build()
            )
        } catch (_: Exception) {}
    }

    // ---- 封面异步加载（http→https，避免明文被拦） ----
    private fun httpsify(u: String): String =
        if (u.startsWith("http://")) "https://" + u.substring(7) else u

    private fun loadCoverAsync(url: String) {
        thread {
            try {
                val conn = URL(httpsify(url)).openConnection()
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36")
                val bmp = BitmapFactory.decodeStream(conn.getInputStream())
                if (bmp != null) {
                    coverBitmap = bmp
                    applyMetadata()
                }
            } catch (e: Exception) {
                Log.w("MusicService", "cover load failed: ${e.message}")
            }
        }
    }
}
