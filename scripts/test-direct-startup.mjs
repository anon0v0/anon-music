// 客户端启动回归测试。
//
// 历史背景：客户端曾经卡在本地"网站维护中"页面启动，用户要多点一次才进播放器。
// 当时的修法是让窗口直接加载远程播放器地址，本测试断言 window.url === 远程地址。
//
// v0.8 起前端随包分发：窗口加载本地 src/index.html，但那个 index.html **就是播放器本体**
// （由 web/static/app.html 生成），不是维护页/跳板页。所以断言改为：
//   1) 窗口 URL 是本地 index.html（而不是任何远程地址）
//   2) 该 index.html 确实是播放器：引了 apibase.js / app.js / player.js
//   3) 里面没有维护页/跳板页的痕迹
//   4) API 根地址被正确注入成传入的 origin（含端口），前端才连得上后端
//   5) 远程 IPC 白名单不含端口（Tauri 的 remote URL pattern 不支持端口）
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = new URL('..', import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'anon-direct-startup-'));
try {
  cpSync(repo, tmp, {
    recursive: true,
    filter(source) {
      return !source.includes(`${join('', '.git')}`) &&
        !source.includes(`${join('', 'node_modules')}`) &&
        !source.includes(`${join('', 'target')}`);
    },
  });

  const url = 'https://dl.2407365.xyz:4443/music';
  const node = (script, ...args) => {
    const run = spawnSync(process.execPath, [join('scripts', script), ...args], { cwd: tmp, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return run;
  };

  node('build-frontend.mjs');
  node('set-app-url.mjs', url);

  // 1) 窗口加载本地入口
  const conf = JSON.parse(readFileSync(join(tmp, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(conf.app.windows[0].url, 'index.html', '主窗口应加载随包分发的本地入口');
  assert.equal(conf.build.frontendDist, '../src');

  // 2)(3) 本地入口就是播放器本体，不是维护页/跳板页
  const html = readFileSync(join(tmp, 'src', 'index.html'), 'utf8');
  for (const need of ['/static/apibase.js', '/static/app.js', '/static/player.js']) {
    assert.ok(html.includes(need), `本地入口应引用 ${need}，否则它不是播放器`);
  }
  assert.ok(!/网站维护中|maintenance\.js|正在连接 Anon Music/.test(html),
    '本地入口不应是维护页或跳板页');
  assert.ok(!/<link rel="manifest"/.test(html), '安装包里不需要 PWA manifest');

  // 4) API 根地址注入正确（必须含端口，否则 4443 这类入口连不上）
  const m = html.match(/window\.__ANON_API_BASE__\s*=\s*"([^"]*)"/);
  assert.ok(m, '缺少 __ANON_API_BASE__ 注入');
  assert.equal(m[1], 'https://dl.2407365.xyz:4443', 'API 根地址应为含端口的 origin');

  // 5) 远程 IPC 白名单不含端口
  const cap = JSON.parse(readFileSync(join(tmp, 'src-tauri', 'capabilities', 'remote.json'), 'utf8'));
  assert.deepEqual(cap.remote.urls, ['https://dl.2407365.xyz']);

  console.log('PASS client starts directly at the packaged player, API base injected');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
