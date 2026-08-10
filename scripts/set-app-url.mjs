// 把对外地址注入构建产物。域名不入库：仓库里是占位 music.example.com，
// CI 用 APP_URL 在构建时注入。
//
// v0.8 起前端随包分发（见 scripts/build-frontend.mjs），窗口加载的是本地 index.html，
// 所以这里注入的不再是"窗口地址"而是"API 根地址"：
//   - src/index.html            → window.__ANON_API_BASE__，前端据此把 /api/... 打到远程站点
//   - capabilities/remote.json  → 远程 IPC 白名单（本地页面用不到，保留同步以备回退远程加载）
//
// 必须在 build-frontend.mjs 之后运行（它才会生成 src/index.html）。
// 用法: node scripts/set-app-url.mjs https://你的域名/music
//   （沿用旧传参形式，带不带 /music 都行，只取 origin）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('用法: node scripts/set-app-url.mjs <https://你的域名/music>');
  process.exit(1);
}
const parsed = new URL(url);
const origin = parsed.origin;                                   // 含端口，如 https://dl.example.com:4443
const secureScheme = parsed.protocol === 'https:' ? 'https' : 'http';

// 1) 前端 API 根地址
const indexPath = new URL('../src/index.html', import.meta.url);
if (!existsSync(indexPath)) {
  console.error('致命：src/index.html 不存在。请先运行 `node scripts/build-frontend.mjs`。');
  process.exit(1);
}
let html = readFileSync(indexPath, 'utf8');
const re = /(window\.__ANON_API_BASE__\s*=\s*")[^"]*(")/;
if (!re.test(html)) {
  console.error('致命：src/index.html 里找不到 __ANON_API_BASE__ 注入点。');
  process.exit(1);
}
writeFileSync(indexPath, html.replace(re, `$1${origin}$2`));
console.log('api base ->', origin);

// 2) 远程 IPC 白名单。Tauri 的 remote URL pattern 不含端口，这里只留 scheme+hostname。
const capPath = new URL('../src-tauri/capabilities/remote.json', import.meta.url);
const cap = JSON.parse(readFileSync(capPath, 'utf8'));
cap.remote.urls = [`${secureScheme}://${parsed.hostname}`];
writeFileSync(capPath, JSON.stringify(cap, null, 2) + '\n');
console.log('remote ipc allowlist ->', cap.remote.urls[0]);
