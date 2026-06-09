// 把原生外壳要加载的远程地址写入 tauri.conf.json。
// 用法: node scripts/set-app-url.mjs https://music.yourdomain.com/music
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('用法: node scripts/set-app-url.mjs <https://你的域名/music>');
  process.exit(1);
}
const f = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const j = JSON.parse(readFileSync(f, 'utf8'));
j.app.windows[0].url = url;
writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
console.log('window url ->', url);
