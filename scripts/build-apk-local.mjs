// 本地一键出包与安装脚本 (Windows 环境直接出 Release 签名 APK)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cargoBin = 'C:/Users/51135/.cargo/bin';
const mingwBin = 'C:/Users/51135/scoop/apps/mingw/current/bin';
const jbrBin = 'E:/Android studio/jbr/bin';
const androidSdk = 'C:/Users/51135/AppData/Local/Android/Sdk';
const adbBin = join(androidSdk, 'platform-tools');
const ndkHome = join(androidSdk, 'ndk/26.3.11579264');
const buildTools = join(androidSdk, 'build-tools/34.0.0');
const outDir = join(root, 'dist');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const winPath = [cargoBin, mingwBin, jbrBin, adbBin, process.env.PATH].join(';');

const env = {
  ...process.env,
  JAVA_HOME: 'E:/Android studio/jbr',
  ANDROID_HOME: androidSdk,
  NDK_HOME: ndkHome,
  PATH: winPath,
  ANDROID_KEYSTORE_PROPERTIES: join(root, 'src-tauri/gen/android/keystore.properties')
};

console.log('=== [1/6] 构建前端资源 (web/static -> src) ===');
execSync('node scripts/build-frontend.mjs', { stdio: 'inherit', env });

console.log('=== [2/6] 注入后端 API 地址 ===');
execSync('node scripts/set-app-url.mjs "https://dl.2407365.xyz:4443/music"', { stdio: 'inherit', env });

console.log('=== [3/6] 编译 Android aarch64 Rust 动态库 ===');
try {
  execSync('npm run tauri android build -- --apk --target aarch64', { stdio: 'inherit', env });
} catch (e) {
  // Tauri 在 Windows 下尝试创建符号链接时无管理员权限会报错，实际 .so 此时已编译完成
  console.log('   (Rust .so 已编译完成，正在拷贝至 jniLibs...)');
}

const soSrc = join(root, 'src-tauri/target/aarch64-linux-android/release/libmusic_app_lib.so');
const soDstDir = join(root, 'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a');
mkdirSync(soDstDir, { recursive: true });
copyFileSync(soSrc, join(soDstDir, 'libmusic_app_lib.so'));
console.log('✅ libmusic_app_lib.so 已同步到 jniLibs');

console.log('=== [4/6] 执行 Gradle 打包 APK ===');
execSync('gradlew.bat assembleArm64Release', {
  cwd: join(root, 'src-tauri/gen/android'),
  stdio: 'inherit',
  env
});

console.log('=== [5/6] 对齐与签名 APK (zipalign + apksigner) ===');
const unsignedApk = join(root, 'src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk');
const signedApk = join(outDir, 'anon-music-v1.1.7.apk');
const keystore = join(root, 'src-tauri/gen/android/app/anon.keystore');

const zipalign = join(buildTools, 'zipalign.exe');
const apksigner = join(buildTools, 'apksigner.bat');

execSync(`"${zipalign}" -f -p 4 "${unsignedApk}" "${signedApk}"`, { env });
execSync(`"${apksigner}" sign --ks "${keystore}" --ks-pass pass:android --ks-key-alias anon --key-pass pass:android --v1-signing-enabled true --v2-signing-enabled true "${signedApk}"`, { stdio: 'inherit', env });

console.log(`\n🎉 [6/6] APK 出包成功: ${signedApk}`);

// 检查是否有手机通过 USB / Wi-Fi 连接，如果有则自动安装
try {
  const adbExe = join(adbBin, 'adb.exe');
  const adbOut = execSync(`"${adbExe}" devices`, { env, encoding: 'utf8' });
  const lines = adbOut.trim().split('\n').slice(1).filter(l => l.includes('\tdevice'));
  if (lines.length > 0) {
    const dev = lines[0].split('\t')[0];
    console.log(`📱 发现已连接设备: ${dev}，正在自动安装到手机...`);
    execSync(`"${adbExe}" -s ${dev} install -r "${signedApk}"`, { stdio: 'inherit', env });
    console.log('✅ 手机端已完成覆盖安装！');
  } else {
    console.log('💡 当前未检测到已连接手机，APK 可手动安装。');
  }
} catch (e) {
  console.warn('ADB 安装过程提示:', e.message);
}
