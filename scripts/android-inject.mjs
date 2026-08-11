// 在 `tauri android init` 生成 gen/android 之后运行：注入原生媒体控制所需文件。
//  1) 用我们的 MainActivity.kt（加载 Rust 库 + JNI）覆盖生成的版本
//  2) 拷入 MusicService.kt（前台服务 + MediaSession）
//  3) 给 AndroidManifest.xml 补权限与 <service> 声明
//  4) 给 proguard-rules.pro 补 keep 规则（release 默认 isMinifyEnabled=true，
//     R8 会删掉「只被 JNI 调用、Kotlin 侧无引用」的静态方法 start/updateNowPlaying/
//     setPlaying → 运行时 NoSuchMethodError 闪退。必须 -keep。）
// 这样不必把整个 gen/android 入库，CI 每次重新生成后打补丁即可。
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, appendFileSync, cpSync } from 'node:fs';
import { dirname } from 'node:path';

const root = new URL('..', import.meta.url);
const conf = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'));
const pkg = conf.identifier.replace(/-/g, '_');            // li.saki.anonmusic（点分包名）
const pkgPath = pkg.split('.').join('/');                  // li/saki/anonmusic（路径）

const genJava = new URL(`src-tauri/gen/android/app/src/main/java/${pkgPath}/`, root);
const manifestPath = new URL('src-tauri/gen/android/app/src/main/AndroidManifest.xml', root);
const proguardPath = new URL('src-tauri/gen/android/app/proguard-rules.pro', root);

if (!existsSync(genJava)) {
  console.error('[android-inject] 未找到 gen 目录，请先运行 `tauri android init`:', genJava.pathname);
  process.exit(1);
}

// 1) + 2) 拷贝 Kotlin 源
for (const f of ['MainActivity.kt', 'MusicService.kt', 'LyricOverlay.kt', 'DownloadHelper.kt']) {
  const src = new URL(`src-tauri/mobile/${f}`, root);
  const dst = new URL(f, genJava);
  mkdirSync(dirname(dst.pathname), { recursive: true });
  copyFileSync(src, dst);
  console.log('[android-inject] copied', f, '->', dst.pathname);
}

// 2.5) 媒体卡片自定义动作的图标。
// PlaybackState.CustomAction 的图标只接受 drawable 资源 id，不能用运行时生成的 Bitmap
// （通知按钮那套 Canvas 画图只对 Notification.Action 有效）。所以这些矢量图必须进 res/drawable。
const drawSrc = new URL('src-tauri/mobile/res/drawable/', root);
const drawDst = new URL('src-tauri/gen/android/app/src/main/res/drawable/', root);
if (existsSync(drawSrc)) {
  mkdirSync(drawDst.pathname, { recursive: true });
  cpSync(drawSrc, drawDst, { recursive: true, force: true });
  console.log('[android-inject] media custom-action drawables copied');
} else {
  console.error('[android-inject] 致命：缺少 src-tauri/mobile/res/drawable，媒体卡片按钮会编译失败');
  process.exit(1);
}

// 2.6) 启动图标：把 src-tauri/icons/android 的整套 mipmap 覆盖进 gen res，
// 确保安卓桌面图标=网站 logo（默认生成可能用的是 Tauri 占位图标）。
const iconsSrc = new URL('src-tauri/icons/android/', root);
const resDst = new URL('src-tauri/gen/android/app/src/main/res/', root);
if (existsSync(iconsSrc)) {
  cpSync(iconsSrc, resDst, { recursive: true, force: true });
  console.log('[android-inject] launcher icons overwritten with anon logo');
} else {
  console.log('[android-inject] no src-tauri/icons/android, skip icon override');
}

// 3) 打补丁 AndroidManifest.xml
let mani = readFileSync(manifestPath, 'utf8');

if (!mani.includes('MusicService')) {
  const perms = [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.WAKE_LOCK',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SYSTEM_ALERT_WINDOW', // App 外悬浮歌词
    // 没有它 WebView 的 navigator.onLine 恒为 false（一直被当成离线），
    // 页面里任何 online/offline 判断都会误判。
    'android.permission.ACCESS_NETWORK_STATE',
  ]
    .map((p) => `    <uses-permission android:name="${p}" />`)
    .join('\n')
    // 系统下载到公共 Music 目录：API 24-28 需要写权限，29+ 不需要（P6 DownloadHelper）
    + '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />';

  // 权限：插在 <application 之前
  mani = mani.replace(/(\n\s*<application)/, `\n${perms}\n$1`);

  // 服务：插在 </application> 之前
  const service =
    '        <service\n' +
    '            android:name=".MusicService"\n' +
    '            android:foregroundServiceType="mediaPlayback"\n' +
    '            android:exported="false" />\n';
  mani = mani.replace(/(\s*<\/application>)/, `\n${service}$1`);

  // 断言：注入若失败（生成结构变化导致正则不匹配），宁可让 CI 红，也不要产出会崩溃的 APK。
  if (!mani.includes('FOREGROUND_SERVICE_MEDIA_PLAYBACK') || !/<service[\s\S]*?\.MusicService/.test(mani)) {
    console.error('[android-inject] 致命：Manifest 注入未生效（未找到锚点）。当前内容：\n' + mani);
    process.exit(1);
  }
  writeFileSync(manifestPath, mani);
  console.log('[android-inject] AndroidManifest.xml patched (perms + MusicService)');
} else {
  console.log('[android-inject] manifest already patched, skip');
}

// 4) ProGuard/R8 keep 规则：保留被 JNI 调用的类与方法，防止 release 构建剥离。
//    （release 的 proguardFiles 会 glob 所有 *.pro，所以追加到 proguard-rules.pro 即生效。）
const pgMarker = `# === Anon Music JNI keep (${pkg}) ===`;
const pgExisting = existsSync(proguardPath) ? readFileSync(proguardPath, 'utf8') : '';
if (!pgExisting.includes(pgMarker)) {
  const rules = `
${pgMarker}
# MusicService / MainActivity 的 start/updateNowPlaying/setPlaying 等只被 Rust 经 JNI 调用，
# R8 看不到 Kotlin 侧引用会删除/重命名 → 运行时 NoSuchMethodError 崩溃。整类保留。
-keep class ${pkg}.MusicService { *; }
-keep class ${pkg}.MainActivity { *; }
-keep class ${pkg}.MainActivity$* { *; }
-keep class ${pkg}.LyricOverlay { *; }
-keep class ${pkg}.LyricOverlay$* { *; }
-keep class ${pkg}.DownloadHelper { *; }
-keepclassmembers class ${pkg}.MusicService {
    public static *;
    private native *;
}
-keepclassmembers class ${pkg}.LyricOverlay {
    public static *;
    private native *;
}
`;
  appendFileSync(proguardPath, rules);
  console.log('[android-inject] proguard-rules.pro patched (JNI keep rules)');
} else {
  console.log('[android-inject] proguard rules already present, skip');
}

// 打印最终 manifest + proguard，便于在 CI 日志里核对确实写进去了。
console.log('[android-inject] ----- final AndroidManifest.xml -----');
console.log(readFileSync(manifestPath, 'utf8'));
console.log('[android-inject] ----- final proguard-rules.pro -----');
console.log(readFileSync(proguardPath, 'utf8'));
console.log('[android-inject] done.');
