#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const h = require('./ui-regression.cjs');

const OUT_DIR = path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'anon-ios-tests');
fs.mkdirSync(OUT_DIR, { recursive: true });

const stats = { pass: 0, fail: 0 };
const results = [];
const bugs = [];

function rec(name, ok, msg) {
  stats[ok ? 'pass' : 'fail']++;
  const line = `${ok ? 'PASS' : 'FAIL'} [iOS] ${name}${msg ? ' — ' + msg : ''}`;
  results.push(line);
  console.log(line);
  if (!ok && msg) bugs.push(`${name}: ${msg}`);
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg || '断言失败'); };

async function runCase(name, fn) {
  let browser, ctx, page;
  const pageErrs = [];
  try {
    browser = await h.chromium.launch({
      executablePath: h.BROWSER_PATH,
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
    });
    ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      serviceWorkers: 'block'
    });
    ctx.setDefaultTimeout(3500);
    ctx.setDefaultNavigationTimeout(3500);
    await h.installRoutes(ctx);
    page = await ctx.newPage();
    page.on('pageerror', e => pageErrs.push(String((e && e.message) || e)));

    await fn(page, ctx);

    if (pageErrs.length > 0) throw new Error('捕获到 pageerror: ' + pageErrs.join('; '));
    rec(name, true, '');
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (page) {
      try { await page.screenshot({ path: path.join(OUT_DIR, `fail-${stats.fail}-${Date.now() % 100000}.png`) }); } catch (_) {}
    }
    rec(name, false, msg);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

(async () => {
  await h.startServer();

  // 1. 手机 390x844: 点击 #studioNowPlaying 切 cover/lyrics; .np-bar CDP touch 25%->60%; touchcancel 取消且不 seek
  await runCase('1. 手机视图切换、进度条拖动手势与取消', async (page, ctx) => {
    await h.startPlayback(page);
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });

    // 切 cover / lyrics
    await page.click('.np-dots span[data-p="lyrics"]');
    assert((await page.getAttribute('.np-overlay', 'data-mpage')) === 'lyrics', '未能切换到 lyrics 视图');
    await page.click('.np-dots span[data-p="cover"]');
    assert((await page.getAttribute('.np-overlay', 'data-mpage')) === 'cover', '未能切换回 cover 视图');

    // 拖动进度条 25% 到 60%
    const bar = await page.locator('.np-bar').boundingBox();
    assert(bar, '找不到 .np-bar');
    const cdp = await ctx.newCDPSession(page);
    const cy = bar.y + bar.height / 2;
    const x25 = bar.x + bar.width * 0.25;
    const x60 = bar.x + bar.width * 0.60;

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x25, y: cy }] });
    const dragging = await page.evaluate(() => document.querySelector('.np-bar').classList.contains('dragging'));
    assert(dragging, 'touchStart 后未添加 .dragging 类');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x60, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await page.waitForTimeout(150);
    const curTime = await page.evaluate(() => window.player.audio.currentTime);
    const isOpen = await page.evaluate(() => document.querySelector('.np-overlay').classList.contains('open'));
    const isPlaying = await page.evaluate(() => !window.player.audio.paused);
    const prog = parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector('.np-bar')).getPropertyValue('--progress')));

    assert(isOpen, '拖拽后全屏播放页被意外关闭');
    assert(isPlaying, '拖拽后播放中断');
    assert(Math.abs(curTime - 18) <= 2.5, `currentTime=${curTime.toFixed(2)} 未在 18s 附近`);
    assert(Math.abs(prog - 0.6) <= 0.1, `--progress=${prog} 未在 0.6 附近`);

    // touchcancel 撤销拖拽且不触发 seek
    const tBeforeCancel = await page.evaluate(() => window.player.audio.currentTime);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x25, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    const stillDragging = await page.evaluate(() => document.querySelector('.np-bar').classList.contains('dragging'));
    assert(!stillDragging, 'touchcancel 后未移除 .dragging 类');
    await page.waitForTimeout(100);
    const tAfterCancel = await page.evaluate(() => window.player.audio.currentTime);
    assert(Math.abs(tAfterCancel - tBeforeCancel) < 1.0, `touchcancel 触发了异常 seek (delta=${(tAfterCancel - tBeforeCancel).toFixed(2)}s)`);
  });

  // 2. 下拉空白 np-topbar >90px 关闭，与进度条/queue手势互不误关
  await runCase('2. 下拉空白顶栏手势关闭与互斥隔离', async (page, ctx) => {
    await h.startPlayback(page);
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });
    const cdp = await ctx.newCDPSession(page);

    // 下拉 np-topbar 120px (>90px)
    const tb = await page.locator('.np-topbar').boundingBox();
    assert(tb, '找不到 .np-topbar');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tb.x + tb.width / 2, y: tb.y + 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tb.x + tb.width / 2, y: tb.y + 130 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const closed = await page.evaluate(() => !document.querySelector('.np-overlay').classList.contains('open'));
    assert(closed, '下拉顶栏 >90px 未关闭播放页');

    // 重新打开，测试进度条下拉手势不误关
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });
    const bar = await page.locator('.np-bar').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 + 110 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => document.querySelector('.np-overlay').classList.contains('open')), '滑动进度条导致播放页误关闭');

    // 打开全屏队列，测试队列下拉手势不误关播放页
    await page.click('.np-qbtn');
    await page.waitForSelector('.np-queue.show', { timeout: 3500 });
    const qb = await page.locator('.np-queue-list').boundingBox();
    if (qb) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: qb.x + qb.width / 2, y: qb.y + 50 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: qb.x + qb.width / 2, y: qb.y + 170 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => document.querySelector('.np-overlay').classList.contains('open')), '队列面板内滑动导致播放页误关闭');
  });

  // 3. ESC 层级关闭 + focus 恢复到 studioNowPlaying；Tab 焦点困在 overlay，不 focus 隐藏项
  await runCase('3. ESC 层级退出与 Tab 焦点捕获管理', async (page) => {
    await h.startPlayback(page);
    await page.focus('#studioNowPlaying');
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });

    // 1) 打开队列 -> ESC 关队列
    await page.click('.np-qbtn');
    await page.waitForSelector('.np-queue.show', { timeout: 3500 });
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.np-queue').classList.contains('show')), 'ESC 未先关闭队列面板');
    assert(await page.evaluate(() => document.querySelector('.np-overlay').classList.contains('open')), 'ESC 关队列时误关闭了全屏页');

    // 2) 打开 more 菜单 -> ESC 关 more
    await page.click('.np-more-btn');
    await page.waitForSelector('.np-more.open', { timeout: 3500 });
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.np-more').classList.contains('open')), 'ESC 未先关闭 more 菜单');

    // 3) 打开 style 面板 -> ESC 关 style
    await page.click('.np-more-btn');
    await page.click('.np-more-menu [data-a="style"]');
    await page.waitForSelector('.np-style-panel.show', { timeout: 3500 });
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.np-style-panel').classList.contains('show')), 'ESC 未先关闭 style 面板');

    // 4) 最后一层 ESC 关全屏，焦点恢复到 #studioNowPlaying
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.np-overlay').classList.contains('open')), 'ESC 未能关闭全屏页');
    const focusedId = await page.evaluate(() => document.activeElement ? document.activeElement.id : '');
    assert(focusedId === 'studioNowPlaying', `关闭后焦点未恢复到 studioNowPlaying, 当前: ${focusedId}`);

    // 5) Tab 循环与不可见元素测试
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });
    let trapped = true;
    let hitHiddenMore = false;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        const ov = document.querySelector('.np-overlay');
        return {
          inside: ov.contains(a),
          inMoreMenu: !!(a && a.closest('.np-more-menu'))
        };
      });
      if (!info.inside) trapped = false;
      if (info.inMoreMenu) hitHiddenMore = true;
    }
    assert(trapped, 'Tab 键焦点脱离了全屏播放页');
    assert(!hitHiddenMore, 'Tab 键聚焦到了折叠隐藏的 .np-more-menu 子元素');
  });

  // 4. resize 390x844 -> 744x1024 -> 1440x900 歌词 active 居中±20px
  await runCase('4. 多视口尺寸重排与歌词居中对齐精度', async (page) => {
    await h.startPlayback(page);
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });
    await page.click('.np-dots span[data-p="lyrics"]');

    const checkCenter = async (w, hPx) => {
      await page.setViewportSize({ width: w, height: hPx });
      // 鼠标先移歌词外释放 _hoverHold
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
      return await page.evaluate(() => {
        const box = document.querySelector('.np-right');
        const active = document.querySelector('.np-lyrics .ln.active') || document.querySelector('.np-lyrics .ln');
        if (!box || !active) return { ok: false, msg: '未找到歌词盒或高亮行' };
        const bb = box.getBoundingClientRect();
        const ab = active.getBoundingClientRect();
        const boxMid = bb.top + bb.height / 2;
        const activeMid = ab.top + ab.height / 2;
        const diff = Math.abs(boxMid - activeMid);
        return { ok: diff <= 20, diff, boxMid, activeMid };
      });
    };

    for (const [w, hPx] of [[390, 844], [744, 1024], [1440, 900]]) {
      const res = await checkCenter(w, hPx);
      assert(res.ok, `视口 ${w}x${hPx} 歌词未居中 (diff=${res.diff ? res.diff.toFixed(1) : 'N/A'}px > 20px)`);
    }
  });

  // 5. play/pause/close 时 RAF 启动与停止，reduced-motion 与轨道规格
  await runCase('5. RAF 驱动生命周期与无障碍降级轨道规范', async (page) => {
    await h.startPlayback(page);
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });

    // 播放中 RAF 运行
    assert(await page.evaluate(() => NowPlaying._raf !== null), '播放状态下 NowPlaying._raf 未启动');

    // 暂停后 RAF 停止
    await page.click('.np-play');
    await page.waitForFunction(() => player.audio.paused, { timeout: 3500 });
    await page.waitForFunction(() => window.NowPlaying && window.NowPlaying._raf === null, { timeout: 3500 });
    assert(await page.evaluate(() => NowPlaying._raf === null), '暂停后 NowPlaying._raf 未停止');

    // 重启播放 RAF 恢复
    await page.click('.np-play');
    await page.waitForFunction(() => !player.audio.paused, { timeout: 3500 });
    await page.waitForFunction(() => window.NowPlaying && window.NowPlaying._raf !== null, { timeout: 3500 });
    assert(await page.evaluate(() => NowPlaying._raf !== null), '重新播放后 NowPlaying._raf 未恢复');

    // 关闭全屏 RAF 停止
    await page.evaluate(() => NowPlaying.close());
    assert(await page.evaluate(() => NowPlaying._raf === null), '全屏关闭后 NowPlaying._raf 未停止');

    // 重新打开并验证 reduced-motion
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const checks = await page.evaluate(() => {
      const ov = document.querySelector('.np-overlay');
      const cs = getComputedStyle(ov);
      const wave = document.querySelector('.np-wave, canvas.np-wave');
      const track = document.querySelector('.np-bar-track');
      return {
        transitionDur: cs.transitionDuration,
        hasWave: !!wave,
        trackHeight: track ? track.getBoundingClientRect().height : 0
      };
    });

    assert(!checks.hasWave, '存在废弃的 .np-wave (canvas) 元素');
    assert(checks.trackHeight > 0 && checks.trackHeight <= 6, `直线 track 高度=${checks.trackHeight}px 超过 6px`);
    assert(parseFloat(checks.transitionDur) <= 0.05, `prefers-reduced-motion 下 transitionDuration=${checks.transitionDur} 未降级`);
  });

  // 6. 全屏 queue 抽屉在 375/820/1024 视口内且音质/倍速保持
  await runCase('6. 全屏队列响应式边界与音质倍速持久性', async (page) => {
    await h.startPlayback(page);
    await page.click('#studioNowPlaying');
    await page.waitForSelector('.np-overlay.open', { timeout: 3500 });

    // 设置倍速为 1.25
    await page.click('.np-more-btn');
    await page.selectOption('.np-speed-select', '1.25');
    assert(await page.evaluate(() => Math.abs(player.audio.playbackRate - 1.25) < 0.01), '倍速未能设置到 1.25');

    // 设置音质为 flac
    await page.click('.np-q-btn');
    await page.click('.np-q-menu [data-q="flac"]');
    await page.waitForFunction(() => player.quality === 'flac', { timeout: 3500 });

    // 打开队列
    await page.click('.np-qbtn');
    await page.waitForSelector('.np-queue.show', { timeout: 3500 });

    for (const w of [375, 820, 1024]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(200);
      const qBox = await page.locator('.np-queue').boundingBox();
      assert(qBox, `视口 ${w} 下未找到 .np-queue`);
      const inScreen = qBox.x >= -2 && (qBox.x + qBox.width) <= (w + 2) && qBox.y >= -2 && (qBox.y + qBox.height) <= 802;
      assert(inScreen, `视口 ${w} 下全屏队列溢出屏幕: x=${qBox.x}, w=${qBox.width}, y=${qBox.y}, h=${qBox.height}`);
      const curSpeed = await page.evaluate(() => player.audio.playbackRate);
      const curQuality = await page.evaluate(() => player.quality);
      assert(Math.abs(curSpeed - 1.25) < 0.01, `视口 ${w} 下倍速未保持为 1.25 (实际: ${curSpeed})`);
      assert(curQuality === 'flac', `视口 ${w} 下音质未保持为 flac (实际: ${curQuality})`);
    }
  });

  await runCase('7. 音量触摸取消与背景焦点隔离', async (page, ctx) => {
    await h.startPlayback(page); await page.click('#studioNowPlaying'); await page.waitForTimeout(500);
    assert(await page.evaluate(() => document.querySelector('.layout').inert && document.querySelector('.playbar').inert), '背景未隔离');
    await page.click('.np-vol-btn');
    const r = await page.locator('.np-vol-track').boundingBox(), cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert(await page.evaluate(() => !NowPlaying._volDragCleanup), '取消后音量监听未清理');
    const v = await page.evaluate(() => player.volume);
    await page.evaluate(() => document.dispatchEvent(new TouchEvent('touchmove', { touches: [new Touch({ identifier: 9, target: document.body, clientX: 100, clientY: 200 })] })));
    assert(Math.abs((await page.evaluate(() => player.volume)) - v) < .001, '其它触摸仍误调音量');
    await page.click('.np-close');
    assert(await page.evaluate(() => !document.querySelector('.layout').inert && !document.querySelector('.playbar').inert), '关闭后背景未恢复');
  });

  await h.stopServer();

  const total = stats.pass + stats.fail;
  const summaryLine = `共 ${total} 项：PASS ${stats.pass} / FAIL ${stats.fail}`;
  console.log('\n' + summaryLine);
  fs.writeFileSync(path.join(OUT_DIR, 'summary.log'), `${results.join('\n')}\n${summaryLine}\n`);

  if (bugs.length > 0) {
    console.log('\n[待修复问题清单]:');
    bugs.forEach((b, i) => console.log(`${i + 1}. ${b}`));
  }
  process.exit(stats.fail ? 1 : 0);
})().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(2);
});
