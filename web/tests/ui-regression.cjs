#!/usr/bin/env node
/* anonmusic 前端 Playwright 回归测试（可重复运行）。
 * 用法: NODE_PATH=<...>/browser-tests/node_modules node anonmusic/tests/ui-regression.cjs
 * 环境变量: BASE_URL(默认 http://127.0.0.1:8765/music)、BROWSER_PATH(默认系统 Chrome)、PI_SCRATCH_DIR(截图/日志目录)
 * 所有 /api/** 请求均由 route.fulfill 提供 fixture（含动态生成 WAV 音频），不访问真实后端/生产库。
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
let BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
let staticServer;
async function startStaticServer() {
  if (BASE_URL) return;
  const http = require('node:http'), root = path.resolve(__dirname, '../static');
  const types = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.webmanifest':'application/manifest+json' };
  staticServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = ['/music','/','/app'].includes(url.pathname) ? 'app.html' : url.pathname.startsWith('/static/') ? url.pathname.slice(8) : 'manifest.webmanifest';
    const file = path.resolve(root, decodeURIComponent(rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, body) => { res.writeHead(err ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(err ? '' : body); });
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  BASE_URL = `http://127.0.0.1:${staticServer.address().port}/music`;
}
const BROWSER_PATH = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'anon-ui-regression');
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  const cands = [];
  if (process.env.PI_SCRATCH_DIR) cands.push(path.join(process.env.PI_SCRATCH_DIR, 'browser-tests', 'node_modules', 'playwright'));
  for (const c of cands) { try { return require(path.resolve(c)); } catch (e) {} }
  console.error('无法加载 playwright：请用 NODE_PATH=<scratch>/browser-tests/node_modules 运行');
  process.exit(2);
}
const { chromium } = loadPlaywright();

/* ---------- fixtures ---------- */
const DUR = 30; // 音频时长(秒)，20~60s 之间
function makeWav() {
  const rate = 8000, n = DUR * rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * env * 11000), 44 + i * 2);
  }
  return buf;
}
const WAV = makeWav();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const song = (id, name, artist) => ({ id, name, artist, artists: [{ id: id.slice(0, id.indexOf(':')) + ':11', name: artist }], pic: '', album: '回归专辑', duration: DUR, sources: [id.indexOf('qq:') === 0 ? 'qq' : 'netease'] });
const QQ = [song('qq:9001', '回归测试甲', '歌手甲'), song('qq:9002', '回归测试乙', '歌手甲'), song('qq:9003', '回归测试丙', '歌手乙')];
const NCM = [song('netease:9004', '回归测试丁', '歌手丙')];
const ALL = QQ.concat(NCM);
const cards = (src, n) => Array.from({ length: n }, (_, i) => ({ source: src, id: 'card' + i, name: `卡片${src}${i}`, cover: '', desc: 'fixture', playCount: 9, songCount: 8, creator: '测试者', group: '榜单' }));
const LRC = [1, 5, 10, 15, 20, 25].map((t, i) => `[00:${t < 10 ? '0' + t : t}.00]测试歌词第${i + 1}行`).join('\n');
const TLRC = [1, 5, 10, 15, 20, 25].map((t, i) => `[00:${t < 10 ? '0' + t : t}.00]Translation ${i + 1}`).join('\n');
const COMMENTS = { code: 0, data: { hot: [{ user: '测试用户A', content: '回归测试热评内容', liked: 12, time: '昨天', ip: '127.0.0.1' }], list: [{ user: '测试用户B', content: '回归测试最新评论', liked: 2, time: '今天', ip: '' }], total: 2, hasMore: false } };
const STATS = { code: 0, data: { range: '30d', total_secs: 5400, total_plays: 20, song_count: 3, top_songs: [{ song: ALL[0], plays: 8, secs: 240 }], top_artists: [{ name: '歌手甲', plays: 8, secs: 240 }], days: [{ day: '2026-08-01', secs: 1800 }, { day: '2026-08-02', secs: 900 }] } };
const MYPLS = [{ id: 'p1', name: '回归歌单', cover: '', songCount: 2, source: '' }];

function apiFixture(url, method) {
  const u = new URL(url), p = u.pathname, q = u.searchParams;
  if (/\.wav$/.test(p)) return { wav: true };
  if (p === '/api/auth/me') return { code: 0, data: null };           // 未登录
  if (p.indexOf('/api/auth/') === 0) return { code: -1, msg: 'offline-fixture' };
  if (p === '/api/settings') return { code: 0, data: {} };
  if (p === '/api/library/liked') return method === 'GET' ? { code: 0, data: ALL.slice(0, 2) } : { code: 0 };
  if (p === '/api/library/recent') return method === 'GET' ? { code: 0, data: ALL.slice(0, 3) } : { code: 0 };
  if (p === '/api/library/playlists') return method === 'GET' ? { code: 0, data: MYPLS } : { code: 0, data: MYPLS[0] };
  if (p === '/api/library/fav_playlists') return p.slice(-6) === '/check' ? { code: 0, faved: false } : { code: 0, data: [] };
  if (p === '/api/library/queue') return method === 'GET' ? { code: 0, data: { songs: [], index: 0 } } : { code: 0 };
  if (p.indexOf('/api/library/') === 0) return { code: 0 };
  if (p === '/api/search/split') return { code: 0, qq: QQ, netease: NCM };
  if (p === '/api/search/playlists') return { code: 0, qq: cards('qq', 2), netease: cards('netease', 2) };
  if (p === '/api/charts') return { code: 0, data: cards(q.get('source') || 'qq', 6) };
  if (p === '/api/recommend/playlists') return { code: 0, data: cards(q.get('source') || 'qq', 8) };
  if (p === '/api/recommend/daily' || p === '/api/fm/next') return { code: 0, data: QQ };
  if (p === '/api/chart/detail' || p === '/api/playlist/detail' || p === '/api/album/detail')
    return { code: 0, data: { meta: { source: 'qq', id: 'x', name: '回归测试详情', cover: '', desc: 'fixture' }, songs: ALL } };
  if (p === '/api/artist/detail') return { code: 0, data: { name: '歌手甲', pic: '', songs: QQ } };
  if (p === '/api/artist/songs' || p === '/api/artist/albums') return { code: 0, data: [] };
  if (p === '/api/song_url') return { code: 0, url: '/api/__audio/' + encodeURIComponent(q.get('mid') || 'x') + '.wav', quality: q.get('quality') || 'standard' };
  if (p === '/api/lyric') return { code: 0, lyric: LRC, tlyric: TLRC };
  if (p === '/api/comments') return COMMENTS;
  if (p === '/api/stats/summary') return STATS;
  if (p === '/api/img') return { png: true };
  if (p.indexOf('/api/together/') === 0) return p === '/api/together/create' ? { code: 0, room: 'AB12CD', view: {}, member_token: 'tk' } : { code: 0 };
  console.log('[fixture] 未匹配的 API(返回空):', method, p);
  return { code: 0, data: [] };
}
async function installRoutes(context) {
  await context.route('**/api/**', async (route) => {
    const f = apiFixture(route.request().url(), route.request().method());
    if (f.wav) return route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV, headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' } });
    if (f.png) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f) });
  });
  await context.route('**/service-worker.js', (r) => r.abort()); // SW 会绕过 route 拦截，阻止注册
}

/* ---------- harness ---------- */
 let browser;
 const stats = { pass: 0, fail: 0 };
 const logLines = [];
 function rec(section, name, ok, info) {
   stats[ok ? 'pass' : 'fail']++;
   const line = `${ok ? 'PASS' : 'FAIL'} [${section}] ${name}${info ? ' — ' + info : ''}`;
   logLines.push(line);
   console.log(line);
 }
const assert = (c, m) => { if (!c) throw new Error(m || '断言失败'); };
async function check(section, page, name, fn) {
  try { const info = await fn(); rec(section, name, true, typeof info === 'string' && info ? info : ''); }
  catch (e) {
    rec(section, name, false, (e && e.message) || String(e));
    try { await page.screenshot({ path: path.join(OUT_DIR, `fail-${stats.fail}-${Date.now() % 100000}.png`) }); } catch (_) { }
  }
}
async function withPage(section, viewport, fn) {
  if (process.env.SECTION && !section.startsWith(process.env.SECTION)) return;
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  ctx.setDefaultTimeout(3500); ctx.setDefaultNavigationTimeout(10000);
  await installRoutes(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  try { await fn(page); } catch (e) { rec(section, 'harness', false, (e && e.message) || String(e)); }
  rec(section, 'pageerror none', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
async function openRoute(page, hash) {
  await page.goto(BASE_URL + '#' + hash, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('#nav .item', { timeout: 15000 });
  await page.waitForFunction(() => { const v = document.querySelector('#view'); return v && !v.querySelector('.loading'); }, null, { timeout: 15000 });
}
async function startPlayback(page) {
  await openRoute(page, '/search/回归');
  await page.waitForSelector('#scQQ .song-row', { timeout: 12000 });
  await page.locator('#scQQ .song-row .ti .nm').first().click();
  await page.waitForFunction(() => window.player && window.player.audio && !window.player.audio.paused && window.player.audio.currentTime > 0.3, null, { timeout: 15000 });
}
const VIS = () => {
  const one = (sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return null;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { in: b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1, covered: !(hit && (hit === el || el.contains(hit))) };
  };
  return { search: one('#searchInput'), play: one('#pbPlay'), prev: one('#pbPrev'), next: one('#pbNext'), menu: one('#menuBtn'), bottomNav: one('#mobileBottomNav') };
};

if (require.main === module) (async () => {
  await startStaticServer();
  browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  console.log(`BASE_URL=${BASE_URL}  OUT_DIR=${OUT_DIR}`);

  /* S1 视口：无横向溢出 + 关键控件可见不被遮挡 + 侧栏收起 */
  const SIZES = [[1440, 900], [1024, 768], [375, 667], [390, 844], [430, 932], [820, 1180], [932, 430]];
  for (const [w, h] of SIZES) {
    await withPage('S1-viewport', { width: w, height: h }, async (page) => {
      const tag = `${w}x${h}`;
      await openRoute(page, '/discover');
      await check('S1-viewport', page, `${tag} 无横向溢出`, async () => {
        const d = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(d <= 1, `横向溢出 ${d}px`); return `delta=${d}px`;
      });
      await check('S1-viewport', page, `${tag} 关键控件可见未遮挡`, async () => {
        const v = await page.evaluate(VIS);
        assert(v.search && v.search.in && !v.search.covered, 'searchInput 不可见/被遮挡');
        assert(v.play && v.play.in && !v.play.covered, 'pbPlay 不可见/被遮挡');
        if (w > 820) assert(v.prev && v.next, '桌面上一首/下一首不可见');
        if (w <= 820) { assert(v.next && v.next.in && !v.next.covered, '手机下一首不可见'); assert(v.menu && v.menu.in && !v.menu.covered, 'menuBtn不可见/被遮挡'); assert(v.bottomNav, 'mobileBottomNav 不可见'); }
        return '';
      });
      if (w >= 1024) {
        await check('S1-viewport', page, `${tag} 侧栏收起/展开`, async () => {
          await page.click('#sideCollapse');
          assert(await page.evaluate(() => document.body.classList.contains('sidebar-collapsed')), '未加上 sidebar-collapsed');
          const d = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert(d <= 1, `收起后横向溢出 ${d}px`);
          await page.click('#sideExpandBtm');
          assert(await page.evaluate(() => !document.body.classList.contains('sidebar-collapsed')), '侧栏未恢复展开');
          return '';
        });
      }
    });
  }

  /* S2 路由加载 */
  const ROUTES = [['/discover', '.card'], ['/search/回归', '.song-row'], ['/charts', '.card'], ['/playlists', '.card'], ['/liked', '.song-row'], ['/recent', '.song-row'], ['/local', ''], ['/downloads', '#dlBox'], ['/stats', '.stats-nums']];
  await withPage('S2-routes', { width: 1440, height: 900 }, async (page) => {
    for (const [route, sel] of ROUTES) {
      await check('S2-routes', page, `路由 ${route} 可加载`, async () => {
        await openRoute(page, route);
        const html = await page.evaluate(() => document.querySelector('#view').innerHTML);
        assert(html.length > 20, '视图为空');
        if (sel) { const n = await page.locator(sel).count(); assert(n > 0, `未找到 ${sel}`); return `(${sel} x${n})`; }
        return '';
      });
    }
  });

  /* S3 播放控制（真实 HTMLMediaElement + 动态 WAV） */
  await withPage('S3-playback', { width: 1440, height: 900 }, async (page) => {
    await check('S3-playback', page, '点击搜索结果启动真实播放', async () => {
      await startPlayback(page);
      const t = await page.evaluate(() => ({ name: document.querySelector('#pbName').textContent, dur: document.querySelector('#pbDur').textContent, d: window.player.audio.duration }));
      assert(t.name === '回归测试甲', 'pbName=' + t.name);
      assert(Math.abs(t.d - DUR) < 1, `audio.duration=${t.d}`);
      // 断言底栏播放控件与进度条严格处于视口水平中心（偏差 <= 1px）
      const cDiff = await page.evaluate(() => {
        const play = document.querySelector('#pbPlay');
        const seek = document.querySelector('.pb-seek');
        const winC = window.innerWidth / 2;
        const playC = play.getBoundingClientRect().left + play.getBoundingClientRect().width / 2;
        const seekC = seek.getBoundingClientRect().left + seek.getBoundingClientRect().width / 2;
        return Math.max(Math.abs(playC - winC), Math.abs(seekC - winC));
      });
      assert(cDiff <= 1.5, '播放键/进度条水平未居中，中心偏差: ' + cDiff + 'px');
      return `${t.name} dur=${t.dur}`;
    });
    await check('S3-playback', page, 'pause / resume', async () => {
      await page.click('#pbPlay'); await page.waitForFunction(() => window.player.audio.paused, null, { timeout: 6000 });
      await page.click('#pbPlay'); await page.waitForFunction(() => !window.player.audio.paused, null, { timeout: 6000 });
      return '';
    });
    await check('S3-playback', page, 'next / prev 切歌', async () => {
      await page.click('#pbNext');
      await page.waitForFunction(() => document.querySelector('#pbName').textContent === '回归测试乙', null, { timeout: 8000 });
      await page.click('#pbPrev');
      await page.waitForFunction(() => document.querySelector('#pbName').textContent === '回归测试甲', null, { timeout: 8000 });
      return '';
    });
    await check('S3-playback', page, '播放模式 3 档循环', async () => {
      const modes = [];
      for (let i = 0; i < 3; i++) { await page.click('#pbMode'); modes.push(await page.evaluate(() => window.player.playMode)); }
      assert(modes.join(',') === 'single,shuffle,list', '顺序=' + modes.join(','));
      return modes.join('→');
    });
    await check('S3-playback', page, '倍速 1.5x', async () => {
      await page.click('#pbSpeedBtn'); await page.click('#pbSpeedMenu [data-s="1.5"]');
      await page.waitForFunction(() => Math.abs(window.player.audio.playbackRate - 1.5) < 0.01, null, { timeout: 6000 });
      assert((await page.textContent('#pbSpeedBtn')).trim() === '1.5x', '按钮文案未更新');
      return '';
    });
    await check('S3-playback', page, '音质切换 flac（fixture 同源音频，避免 timeupdate 竞态）', async () => {
      await page.click('#pbQualityBtn'); await page.click('#pbQualityMenu .pb-q-item[data-q="flac"]');
      await page.waitForFunction(() => window.player.quality === 'flac' && !window.player.audio.paused, null, { timeout: 8000 });
      assert((await page.textContent('#pbQualityLabel')).trim() === '无损', '音质标签未更新');
      // 测试底栏音质与倍速弹窗互斥自动关闭
      await page.click('#pbQualityBtn');
      assert(await page.evaluate(() => document.getElementById('pbQ').classList.contains('open')), '音质弹窗未打开');
      await page.click('#pbSpeedBtn');
      assert(await page.evaluate(() => !document.getElementById('pbQ').classList.contains('open') && document.getElementById('pbSpeed').classList.contains('open')), '切换倍速后音质弹窗未自动关闭');
      await page.click('.topbar');
      assert(await page.evaluate(() => !document.getElementById('pbSpeed').classList.contains('open')), '点击空白后倍速弹窗未自动关闭');
      return '';
    });
    await check('S3-playback', page, '鼠标拖动进度条 seek', async () => {
      const b = await page.locator('#pbBar').boundingBox(); assert(b, 'pbBar 无边界盒');
      const x = b.x + b.width * 0.6, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
      await page.waitForFunction(() => window.player.audio.currentTime >= 15, null, { timeout: 8000 });
      return `currentTime=${(await page.evaluate(() => window.player.audio.currentTime)).toFixed(1)}s`;
    });
    await check('S3-playback', page, '音量拖动 + 静音/恢复', async () => {
      await page.click('#pbVolBtn');
      const t = await page.locator('#pbVolTrack').boundingBox(); assert(t, 'pbVolTrack 不可见');
      await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.5); await page.mouse.down(); await page.mouse.up();
      assert(Math.abs((await page.evaluate(() => player.volume)) - .5) < .02, '音量拖动与实际数值不一致');
      assert(Math.abs(parseInt(await page.textContent('#pbVolNum'), 10) - 50) <= 1, '音量标签超出像素取整容差');
      await page.click('#pbVolMute');
      assert((await page.textContent('#pbVolNum')).trim() === '0%', '未静音');
      await page.click('#pbVolMute');
      assert((await page.textContent('#pbVolNum')).trim() !== '0%', '未恢复音量');
      return '';
    });
    await check('S3-playback', page, '队列面板 打开/移除/清空', async () => {
      await page.click('#pbQueue');
      assert(await page.evaluate(() => document.querySelector('#queuePanel').classList.contains('open')), '队列面板未打开');
      assert((await page.locator('#qpList .qp-row').count()) === 3, '队列应有 3 首');
      await page.locator('#qpList .qp-row').first().hover();
      await page.locator('#qpList .qp-row .qx').first().click();
      await page.waitForFunction(() => document.querySelectorAll('#qpList .qp-row').length === 2, null, { timeout: 8000 });
      await page.click('#qpClear');
      await page.waitForFunction(() => (document.querySelector('#qpList').textContent || '').indexOf('队列是空的') >= 0, null, { timeout: 6000 });
      return '';
    });
  });

  /* S4 全屏播放页 */
  await withPage('S4-nowplaying', { width: 1440, height: 900 }, async (page) => {
    await check('S4-nowplaying', page, '全屏打开/标题/播放键 aria-label', async () => {
      await startPlayback(page);
      await page.click('#pbExpand');
      await page.waitForSelector('.np-overlay.open', { timeout: 8000 });
      const t = await page.textContent('.np-title'); assert(t.indexOf('回归测试甲') >= 0, 'np-title=' + t);
      const al = await page.getAttribute('.np-play', 'aria-label'); assert(al && al.length > 0, 'np-play 缺 aria-label(_renderPlay)');
      return '';
    });
    await check('S4-nowplaying', page, '歌词渲染 + 翻译', async () => {
      const n = await page.locator('.np-lyrics .ln').count(); assert(n >= 5, `歌词行数 ${n}`);
      assert((await page.locator('.np-lyrics .ln .tr').count()) >= 3, '无翻译行(.tr)');
      return `${n} 行`;
    });
    await check('S4-nowplaying', page, '歌词点击 seek', async () => {
      await page.evaluate(() => player.seekTo(0));
      await page.mouse.move(10, 10); await page.waitForTimeout(650);
      await page.click('.np-lyrics .ln[data-i="1"]');
      await page.waitForFunction(() => window.player.audio.currentTime >= 4.5, null, { timeout: 4000 });
      return '';
    });
    await check('S4-nowplaying', page, '全屏播放列表', async () => {
      await page.click('.np-qbtn');
      await page.waitForSelector('.np-queue.show', { timeout: 6000 });
      assert((await page.locator('.np-queue .np-q-row').count()) === 3, '全屏队列行数不对');
      await page.click('.np-qbtn');
      return '';
    });
    await check('S4-nowplaying', page, '样式面板 square/lyrics 切换', async () => {
      const hasStyle = await page.isVisible('.np-more-menu [data-a="style"]').catch(() => false);
      if (hasStyle) { await page.click('.np-more-menu [data-a="style"]'); } else { await page.click('#npSkinToggle'); }
      await page.waitForSelector('.np-style-panel.show', { timeout: 6000 });
      await page.click('.np-style-panel .nsp-card[data-k="lyrics"]');
      assert((await page.locator('.np-style-panel .nsp-card[data-k="lyrics"].active').count()) === 1, 'lyrics 皮肤未激活');
      await page.click('.np-style-panel .nsp-card[data-k="square"]');
      assert((await page.locator('.np-style-panel .nsp-card[data-k="square"].active').count()) === 1, 'square 皮肤未激活');
      await page.click('.np-style-panel .nsp-x');
      return '';
    });
    await check('S4-nowplaying', page, '键盘进度 ArrowRight(+5s)', async () => {
      await page.evaluate(() => { player.audio.pause(); player.seekTo(5); }); await page.waitForTimeout(100);
      const before = await page.evaluate(() => window.player.audio.currentTime);
      await page.focus('.np-bar'); await page.keyboard.press('ArrowRight');
      await page.waitForFunction((b) => window.player.audio.currentTime >= b + 4, before, { timeout: 6000 });
      return '';
    });
    await check('S4-nowplaying', page, '全屏关闭', async () => {
      await page.click('.np-close');
      await page.waitForFunction(() => !document.querySelector('.np-overlay').classList.contains('open'), null, { timeout: 6000 });
      return '';
    });
  });
  await withPage('S4-nowplaying', { width: 390, height: 844 }, async (page) => {
    await check('S4-nowplaying', page, '移动端 tabs(封面/歌词) + 键盘音量', async () => {
      await startPlayback(page);
      await page.click('#studioNowPlaying');
      await page.waitForSelector('.np-overlay.open', { timeout: 8000 });
      await page.click('.np-dots span[data-p="lyrics"]');
      assert((await page.getAttribute('.np-overlay', 'data-mpage')) === 'lyrics', '未切到歌词视图');
      await page.click('.np-vol-btn');
      await page.focus('.np-vol-track'); await page.keyboard.press('ArrowDown');
      const vn = (await page.textContent('.np-vol-num')).trim();
      assert(vn === '95%', 'np-vol-num=' + vn + '（ArrowDown 未生效）');
      return '';
    });
  });

  /* S5 未登录弹窗：登录 / 加歌单 / 评论 / 喜欢 */
  await withPage('S5-modals', { width: 1440, height: 900 }, async (page) => {
    await check('S5-modals', page, '未登录登录弹窗 + 注册切换 + 关闭', async () => {
      await openRoute(page, '/discover');
      await page.click('#account .login-btn');
      await page.waitForSelector('.ov-mask.auth.open', { timeout: 6000 });
      assert(await page.isVisible('#auEmail'), '邮箱输入框不可见');
      assert((await page.textContent('#auSubmit')).trim() === '登录', '登录按钮文案');
      await page.click('.ov-mask.auth .link-btn');
      assert((await page.textContent('#authTitle span')).trim() === '注册', '未切到注册');
      assert(await page.isVisible('#auCodeField'), '验证码字段不可见');
      await page.click('.ov-mask.auth .close-x');
      await page.waitForFunction(() => !document.querySelector('.ov-mask.auth').classList.contains('open'), null, { timeout: 4000 });
      return '';
    });
    await check('S5-modals', page, '加入歌单弹窗', async () => {
      await startPlayback(page);
      await page.click('#pbAddpl');
      await page.waitForSelector('#plModal.open', { timeout: 6000 });
      const opt = await page.textContent('#plModalList .pl-opt');
      assert(opt.indexOf('回归歌单') >= 0, '歌单选项=' + opt);
      await page.click('#plModalList .pl-opt');
      await page.waitForFunction(() => !document.querySelector('#plModal').classList.contains('open'), null, { timeout: 6000 });
      return '';
    });
    await check('S5-modals', page, '喜欢(未登录走公共库 fixture)', async () => {
      const before = await page.evaluate(() => Library.isLiked(player.currentSong.id));
      await page.click('#pbLike');
      await page.waitForFunction(b => Library.isLiked(player.currentSong.id) !== b, before, { timeout: 4000 });
      return '';
    });
    await check('S5-modals', page, '评论面板居中无跳动与关闭', async () => {
      await page.click('#pbComment');
      await page.waitForSelector('#commentPanel.open', { timeout: 6000 });
      // 验证在打开动画期间及完成时严格屏幕居中（1440x900 视口中心为 720, 450）
      const center = await page.evaluate(() => {
        const b = document.getElementById('commentPanel').getBoundingClientRect();
        return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
      });
      assert(Math.abs(center.cx - 720) <= 8 && Math.abs(center.cy - 450) <= 8, `评论区中心偏移: (${center.cx}, ${center.cy})`);
      await page.waitForFunction(() => document.querySelector('#cmList').textContent.includes('回归测试热评内容'), null, { timeout: 4000 });
      const txt = await page.textContent('#cmList');
      assert(txt.indexOf('回归测试热评内容') >= 0, '评论内容未渲染');
      await page.click('#cmClose');
      await page.waitForFunction(() => !document.querySelector('#commentPanel').classList.contains('open'), null, { timeout: 4000 });
      return '';
    });
  });

  /* S6 跨组件状态、下载和本地文件。所有网络 API 仍是隔离 fixture。 */
  await withPage('S6-integration', { width: 390, height: 844 }, async page => {
    await startPlayback(page); await page.click('#studioNowPlaying');
    await check('S6-integration', page, '全屏加入歌单弹窗位于播放器上方', async () => {
      if (await page.isVisible('.np-addpl')) { await page.click('.np-addpl'); } else { await page.click('.np-more-btn'); await page.click('.np-more-menu [data-a="add"], .np-addpl'); }
      await page.locator('#plModal.open').waitFor();
      await page.locator('#plModalList .pl-opt').first().click();
      await page.waitForFunction(() => !document.querySelector('#plModal').classList.contains('open'));
    });
    await check('S6-integration', page, '全屏评论面板可操作', async () => {
      await page.click('.np-cbtn'); await page.locator('#commentPanel.open').waitFor();
      await page.click('#cmClose');
    });
    await check('S6-integration', page, '更多菜单倍速同步底栏', async () => {
      await page.click('.np-more-btn'); await page.selectOption('.np-speed-select', '1.25');
      assert(await page.evaluate(() => player.audio.playbackRate === 1.25 && getPlaybackSpeed() === 1.25), '倍速未同步');
    });
    await check('S6-integration', page, '全屏下载复用原下载流程', async () => {
      await page.click('.np-more-btn'); const wait = page.waitForEvent('download', { timeout: 5000 });
      await page.click('.np-more-menu [data-a="download"]'); const download = await wait;
      assert(download.suggestedFilename().includes('回归测试甲'), '下载文件名错误');
      assert(!(await download.failure()), '下载失败');
    });
    await check('S6-integration', page, '清空队列同步歌词、时长和播放态', async () => {
      await page.click('.np-qbtn'); await page.click('.np-q-clear');
      assert(await page.evaluate(() => player.playlist.length === 0 && player.currentSong === null && player.duration === 0 && player.lyrics.length === 0), '引擎未清空');
      assert((await page.textContent('.np-title')).includes('从一首'), '全屏歌名残留');
      assert(await page.locator('.np-lyrics .ln').count() === 0, '全屏歌词残留');
      assert((await page.textContent('.np-dur')) === '0:00', '时长残留');
    });
    await check('S6-integration', page, '本地 WAV 导入、播放、刷新保留', async () => {
      await page.click('.np-close'); await openRoute(page, '/local');
      await page.setInputFiles('#localFileInput', { name: '本地回归.wav', mimeType: 'audio/wav', buffer: WAV });
      await page.locator('#localList .song-row').waitFor(); await page.click('#playAllLocal');
      await page.waitForFunction(() => player.currentSong.id.startsWith('local:') && !player.audio.paused && player.audio.currentTime > .2);
      await page.reload({ waitUntil:'domcontentloaded' }); await page.locator('#localList .song-row').waitFor();
      assert((await page.textContent('#localList')).includes('本地回归'), '刷新丢失本地音乐');
    });
    await check('S6-integration', page, '手机菜单与主题切换', async () => {
      await page.click('#menuBtn'); await page.locator('#sidebar.open').waitFor();
      await page.click('#themeBtn');
      assert(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), '主题未切换');
      await page.click('#sidebarBackdrop', { position: { x: 385, y: 300 } });
      assert(!(await page.locator('#sidebar').getAttribute('class')).includes('open'), '菜单未关闭');
    });
  });


  await withPage('S7-navigation', { width: 1440, height: 900 }, async page => {
    await check('S7-navigation', page, '未完成加载的发现页返回后可重新加载', async () => {
      let started = false;
      await page.route('**/api/recommend/playlists?**', async route => {
        started = true; await new Promise(resolve => setTimeout(resolve, 800));
        await route.fulfill({ json: apiFixture(route.request().url(), 'GET') });
      });
      await page.goto(BASE_URL + '#/discover', { waitUntil: 'domcontentloaded' });
      while (!started) await page.waitForTimeout(20);
      await page.evaluate(() => location.hash = '#/local'); await page.locator('#localFileInput').waitFor({ state: 'attached' });
      await page.evaluate(() => location.hash = '#/discover'); await page.locator('.studio-intro').waitFor({ timeout: 3000 });
      assert(await page.locator('#view .loading').count() === 0, '恢复了过期的加载占位');
    });
    await check('S7-navigation', page, '返回搜索页后歌曲/歌单切换仍可用', async () => {
      await openRoute(page, '/search/回归');
      await page.evaluate(() => location.hash = '#/local'); await page.locator('#localFileInput').waitFor({ state: 'attached' });
      await page.evaluate(() => location.hash = '#/search/回归'); await page.locator('#scQQ .song-row').first().waitFor();
      await page.click('.search-tabs [data-t="playlist"]'); await page.locator('#scQQ .card').first().waitFor();
      await page.click('.search-tabs [data-t="song"]'); await page.locator('#scQQ .song-row').first().waitFor();
    });
    await check('S7-navigation', page, '发现音乐分类 Tab 切换可用', async () => {
      await openRoute(page, '/discover');
      await page.click('.shelf-tab[data-tab="netease"]');
      await page.waitForFunction(() => {
        const active = document.querySelector('.shelf-tab.active');
        return active && active.dataset.tab === 'netease';
      });
      const ncmFirst = await page.locator('#discoverShelfGrid .card .name').first().textContent();
      assert(ncmFirst.includes('网易'), '切换网易云歌单失败');
      await page.click('.shelf-tab[data-tab="qq-top"]');
      await page.waitForFunction(() => {
        const active = document.querySelector('.shelf-tab.active');
        return active && active.dataset.tab === 'qq-top';
      });
      await page.click('.shelf-tab[data-tab="qq"]');
      await page.waitForFunction(() => {
        const active = document.querySelector('.shelf-tab.active');
        return active && active.dataset.tab === 'qq';
      });
    });
  });

   await browser.close();
   if (staticServer) await new Promise(resolve => staticServer.close(resolve));
   const line = `共 ${stats.pass + stats.fail} 项：PASS ${stats.pass} / FAIL ${stats.fail}`;
   console.log('\n' + line);
   fs.writeFileSync(path.join(OUT_DIR, 'results.txt'), `${new Date().toISOString()}\nBASE_URL=${BASE_URL}\n${logLines.join('\n')}\n${line}\n`);
   process.exit(stats.fail ? 1 : 0);
 })().catch((e) => { console.error('FATAL', e); process.exit(3); });

module.exports = { chromium, BROWSER_PATH, WAV, ALL, QQ, NCM, installRoutes, openRoute, startPlayback, apiFixture,
  async startServer() { await startStaticServer(); return BASE_URL; },
  async stopServer() { if (staticServer) await new Promise(resolve => staticServer.close(resolve)); }
};
