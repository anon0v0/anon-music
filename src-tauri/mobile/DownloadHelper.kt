package li.saki.anonmusic

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.util.Log
import android.widget.Toast

// 安卓原生下载（P6）：WebView 里 blob 下载不可靠，改交系统 DownloadManager——
// 通知栏自带进度、断点续传、失败重试，文件存 Music/AnonMusic/。
// 只被 Rust 经 JNI 调用（web 端 and-download 事件 → lib.rs → media_android::download）。
// ⚠️ 必须在 proguard -keep（JNI-only 方法会被 R8 剥离，见 v0.3.2 教训）。
object DownloadHelper {
    private const val TAG = "DownloadHelper"

    @JvmStatic
    fun enqueue(ctx: Context, url: String, filename: String, mime: String) {
        try {
            val app = ctx.applicationContext
            val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val safe = filename.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifEmpty { "song" }
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(safe)
                .setDescription("Anon Music")
                .setMimeType(mime.ifEmpty { "audio/mpeg" })
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, "AnonMusic/$safe")
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            dm.enqueue(req)
            try { Toast.makeText(app, "已加入系统下载（通知栏可见进度）", Toast.LENGTH_SHORT).show() } catch (_: Exception) {}
        } catch (e: Exception) {
            Log.e(TAG, "enqueue failed: ${e.message}")
            try { Toast.makeText(ctx.applicationContext, "下载失败：${e.message}", Toast.LENGTH_LONG).show() } catch (_: Exception) {}
        }
    }
}
