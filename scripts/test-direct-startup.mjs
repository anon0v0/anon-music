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
  const run = spawnSync(process.execPath, ['scripts/set-app-url.mjs', url], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const conf = JSON.parse(readFileSync(join(tmp, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(
    conf.app.windows[0].url,
    url,
    '客户端主窗口应直接加载播放器，不应再从本地网站维护页启动',
  );

  const script = readFileSync(join(tmp, 'scripts', 'set-app-url.mjs'), 'utf8');
  assert.ok(!script.includes("conf.app.windows[0].url = 'index.html'"));
  assert.ok(!script.includes('maintenance target ->'));
  console.log('PASS client starts directly at configured player URL');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
