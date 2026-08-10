// 构建期生成安装包要装的前端：web/static → src/static + src/index.html。
//
// v0.8 起前端随包分发：窗口加载本地 index.html，网络上只剩 API 请求
// （原先每次冷启动都要重下整站，未压缩约 945KB）。
// 前端源码就在本仓库 web/ 下，所以这一步在 CI 里跑即可，产物不入库（见 .gitignore）。
//
// 与网页版的差异只有三点：
//   1) 入口由 web/static/app.html 生成，并留出 __ANON_API_BASE__ 注入点
//      （由 set-app-url.mjs 填成真实域名，域名不入库）
//   2) 去掉 PWA manifest 引用（安装包里没有 PWA 一说；SW 注册前端已按 IS_PACKED 跳过）
//   3) 剥掉资源 URL 上的 ?v=xxx —— 那是给 HTTP 缓存用的，本地资源协议不需要，
//      且不同 Tauri 版本对带 query 的资源路径处理不一致
//
// 用法: node scripts/build-frontend.mjs
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const srcStatic = new URL('web/static/', root);
const dstStatic = new URL('src/static/', root);
const dstIndex = new URL('src/index.html', root);
const appHtml = new URL('app.html', srcStatic);

if (!existsSync(srcStatic) || !existsSync(appHtml)) {
  console.error('[build-frontend] 找不到 web/static/app.html，仓库结构不对？');
  process.exit(1);
}

// 1) 镜像整个 static（先清空，避免上一次构建的残留混进包里）
rmSync(dstStatic, { recursive: true, force: true });
mkdirSync(dstStatic, { recursive: true });
cpSync(srcStatic, dstStatic, { recursive: true });
console.log('[build-frontend] web/static -> src/static');

// 2) 生成本地入口
let html = readFileSync(appHtml, 'utf8');
html = html.replace(/^[^\S\r\n]*<link rel="manifest"[^>]*>[^\S\r\n]*\r?\n/m, '');
html = html.replace(/(["'])(\/static\/[^"'?]+)\?[^"']*\1/g, '$1$2$1');

const anchor = '<script src="/static/apibase.js"></script>';
if (!html.includes(anchor)) {
  console.error('[build-frontend] 致命：app.html 里找不到 apibase.js 引用，无法注入 API base。');
  console.error('  期望锚点：' + anchor);
  process.exit(1);
}
html = html.replace(anchor, '<script>window.__ANON_API_BASE__ = "https://music.example.com";</script>\n  ' + anchor);
writeFileSync(dstIndex, html);
console.log('[build-frontend] src/index.html 已生成');

// 3) 自检：这几样缺一个，装出来就是白屏或功能残缺
const must = ['apibase.js', 'app.js', 'appext.js', 'player.js', 'bridge.js', 'app.css'];
const missing = must.filter((f) => !existsSync(new URL(f, dstStatic)));
if (missing.length) {
  console.error('[build-frontend] 致命：缺少关键文件：', missing.join(', '));
  process.exit(1);
}
if (!html.includes('__ANON_API_BASE__')) {
  console.error('[build-frontend] 致命：index.html 里没有 __ANON_API_BASE__ 注入点。');
  process.exit(1);
}
if (/<link rel="manifest"/.test(html)) {
  console.error('[build-frontend] 致命：PWA manifest 引用没去干净。');
  process.exit(1);
}
console.log('[build-frontend] done.');
