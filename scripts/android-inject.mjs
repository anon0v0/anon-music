// 在 `tauri android init` 生成 gen/android 之后运行：注入原生媒体控制所需文件。
//  1) 用我们的 MainActivity.kt（加载 Rust 库 + JNI）覆盖生成的版本
//  2) 拷入 MusicService.kt（前台服务 + MediaSession）
//  3) 给 AndroidManifest.xml 补权限与 <service> 声明
// 这样不必把整个 gen/android 入库，CI 每次重新生成后打补丁即可。
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const root = new URL('..', import.meta.url);
const conf = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'));
const pkgPath = conf.identifier.replace(/-/g, '_').split('.').join('/'); // li.saki.anonmusic -> li/saki/anonmusic

const genJava = new URL(`src-tauri/gen/android/app/src/main/java/${pkgPath}/`, root);
const manifestPath = new URL('src-tauri/gen/android/app/src/main/AndroidManifest.xml', root);

if (!existsSync(genJava)) {
  console.error('[android-inject] 未找到 gen 目录，请先运行 `tauri android init`:', genJava.pathname);
  process.exit(1);
}

// 1) + 2) 拷贝 Kotlin 源
for (const f of ['MainActivity.kt', 'MusicService.kt']) {
  const src = new URL(`src-tauri/mobile/${f}`, root);
  const dst = new URL(f, genJava);
  mkdirSync(dirname(dst.pathname), { recursive: true });
  copyFileSync(src, dst);
  console.log('[android-inject] copied', f, '->', dst.pathname);
}

// 3) 打补丁 AndroidManifest.xml
let mani = readFileSync(manifestPath, 'utf8');

if (!mani.includes('MusicService')) {
  const perms = [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.WAKE_LOCK',
    'android.permission.POST_NOTIFICATIONS',
  ]
    .map((p) => `    <uses-permission android:name="${p}" />`)
    .join('\n');

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

// 打印最终 manifest，便于在 CI 日志里核对权限/服务确实写进去了。
console.log('[android-inject] ----- final AndroidManifest.xml -----');
console.log(readFileSync(manifestPath, 'utf8'));
console.log('[android-inject] done.');
