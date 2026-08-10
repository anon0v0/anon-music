// 把原生外壳要加载的远程地址写入配置：
//  - tauri.conf.json  → 主窗口加载的完整地址(含 /music)
//  - capabilities/remote.json → 桌面歌词 IPC 白名单(同源 origin，去掉路径)
// 域名不入库：仓库里是占位 music.example.com，CI 用仓库变量 APP_URL 在构建时注入。
// 用法: node scripts/set-app-url.mjs https://music.yourdomain.com/music
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('用法: node scripts/set-app-url.mjs <https://你的域名/music>');
  process.exit(1);
}
const parsed = new URL(url);
const origin = parsed.origin;
const secureScheme = parsed.protocol === 'https:' ? 'https' : 'http';

// 1) 主窗口直接加载播放器地址，不再经过本地“网站维护中”页面。
const confPath = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.app.windows[0].url = url;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
console.log('window url ->', url);

// 2) 远程 IPC 白名单（仅同源 origin）
const capPath = new URL('../src-tauri/capabilities/remote.json', import.meta.url);
const cap = JSON.parse(readFileSync(capPath, 'utf8'));
// Tauri remote URL patterns do not include the port component.
// Keep scheme + hostname here; the main-window URL still retains :4443.
cap.remote.urls = [`${secureScheme}://${parsed.hostname}`];
writeFileSync(capPath, JSON.stringify(cap, null, 2) + '\n');
console.log('remote ipc allowlist ->', cap.remote.urls[0]);
