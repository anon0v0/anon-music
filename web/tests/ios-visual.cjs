'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), h = require('./ui-regression.cjs');
const OUT_DIR = path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'ios-visual');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SIZES = [[1440, 900], [1280, 800], [1024, 768], [820, 1180], [390, 844], [375, 667], [744, 390]];

const lum = (r, g, b) => {
  const a = [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
  return a[0] * .2126 + a[1] * .7152 + a[2] * .0722;
};
const parseRgb = s => ((s || '').match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);
const getContrast = (c1, c2) => {
  const l1 = lum(...parseRgb(c1)), l2 = lum(...parseRgb(c2));
  return +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2);
};

async function run() {
  await h.startServer();
  const browser = await h.chromium.launch({ executablePath: h.BROWSER_PATH, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const report = { timestamp: new Date().toISOString(), outDir: OUT_DIR, viewports: {}, bugs: [], passed: [] };

  for (const [w, hgt] of SIZES) {
    const key = `${w}x${hgt}`, isDesk = w >= 1024, isMobile = w < 820;
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
    await h.installRoutes(ctx);
    const page = await ctx.newPage();
    await h.openRoute(page, '/discover');

    const m = await page.evaluate(() => {
      const g = document.querySelector('.home-rec-grid'), covers = Array.from(document.querySelectorAll('.home-rec-grid .cover'));
      const featCover = document.querySelector('.spec-card .cover, .home-feature-grid .cover');
      const header = document.querySelector('.topbar'), pb = document.querySelector('.playbar'), view = document.querySelector('#view');
      const srcLogo = document.querySelector('.card .cover .src-logo'), firstCover = covers[0];
      const gapNum = g ? (parseFloat(getComputedStyle(g).columnGap || getComputedStyle(g).gap) || 0) : 0;
      const hitTest = sel => {
        const el = document.querySelector(sel);
        if (!el) return { found: false, hit: false };
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return { found: true, visible: false, hit: false };
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return { found: true, visible: false, hit: false };
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { found: true, visible: true, hit: !!(hit && (hit === el || el.contains(hit))) };
      };
      return {
        coverW: firstCover ? +firstCover.getBoundingClientRect().width.toFixed(1) : 0,
        featW: featCover ? +featCover.getBoundingClientRect().width.toFixed(1) : 0,
        gap: gapNum, headH: header ? +header.getBoundingClientRect().height.toFixed(1) : 0,
        pbH: pb ? +pb.getBoundingClientRect().height.toFixed(1) : 0,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        viewOverflow: view ? view.scrollWidth - view.clientWidth : 0,
        logoRatio: (srcLogo && firstCover) ? +(srcLogo.getBoundingClientRect().width / firstCover.getBoundingClientRect().width).toFixed(2) : 0,
        hits: { search: hitTest('#searchInput'), play: hitTest('#pbPlay'), next: hitTest('#pbNext'), menu: hitTest('#menuBtn') }
      };
    });

    await page.screenshot({ path: path.join(OUT_DIR, `discover-${key}.png`) });

    const [expMin, expMax] = isDesk ? [128, 175] : [110, 155];
    if (m.coverW < expMin || m.coverW > expMax) report.bugs.push(`[${key}] 推荐封面宽 ${m.coverW}px 不在 [${expMin}, ${expMax}]px 区间`);
    else report.passed.push(`[${key}] 推荐封面宽 ${m.coverW}px 合规`);

    if (m.gap < 14) report.bugs.push(`[${key}] 推荐卡片间距 ${m.gap}px 过小 (<14px)`);
    else report.passed.push(`[${key}] 推荐卡片间距 ${m.gap}px 合规`);

    if (m.headH >= 150) report.bugs.push(`[${key}] Topbar 高度 ${m.headH}px 超限 (>=150px)`);
    if (isDesk && m.featW > 100) report.bugs.push(`[${key}] 桌面 Feature 封面宽 ${m.featW}px 超过 100px`);

    const maxPb = w > 1200 ? 90 : (w >= 820 ? 116 : 68);
    if (m.pbH > maxPb) report.bugs.push(`[${key}] Playbar 高度 ${m.pbH}px 超标 (最大 ${maxPb}px)`);
    else report.passed.push(`[${key}] Playbar 高度 ${m.pbH}px 合规`);

    if (m.docOverflow > 1) report.bugs.push(`[${key}] 主文档横向溢出 ${m.docOverflow}px`);
    if (m.viewOverflow > 1) report.bugs.push(`[${key}] #view 内部横向溢出 ${m.viewOverflow}px`);
    if (m.logoRatio >= .8) report.bugs.push(`[${key}] 封面角标 logo 占满整封面 (${(m.logoRatio * 100).toFixed(0)}%)`);

    for (const [name, res] of Object.entries(m.hits)) {
      if (res.visible && !res.hit) report.bugs.push(`[${key}] 关键控件 ${name} 可见但点击穿透/遮挡`);
    }

    if (['1440x900', '390x844', '744x390'].includes(key)) {
      await h.startPlayback(page);
      await page.click('#pbExpand');
      await page.waitForSelector('.np-overlay.open', { timeout: 5000 });
      await page.waitForTimeout(550); // 等待全屏平滑滑入动效完成

      const np = await page.evaluate(sm => {
        const ov = document.querySelector('.np-overlay'), trk = document.querySelector('.np-bar-track');
        const l = document.querySelector('.np-left'), f = document.querySelector('.np-footer'), r = document.querySelector('.np-right');
        const lR = l ? l.getBoundingClientRect() : null, fR = f ? f.getBoundingClientRect() : null, rR = r ? r.getBoundingClientRect() : null;
        const act = document.querySelector('.np-lyrics .ln.active') || document.querySelector('.np-lyrics .ln');
        const cb = document.querySelector('.np-close'), cs = getComputedStyle(ov);
        return {
          trackH: trk ? +trk.getBoundingClientRect().height.toFixed(1) : 0,
          hasWave: !!document.querySelector('.np-wave'),
          trans: cs.transitionProperty,
          overlap: !!(lR && fR && sm && lR.bottom > fR.top + 2),
          lyrH: rR ? +rR.height.toFixed(1) : 0,
          baseBg: cs.backgroundColor,
          lnCol: act ? getComputedStyle(act).color : '',
          closeCol: cb ? getComputedStyle(cb).color : '',
          footBottom: fR ? +fR.bottom.toFixed(1) : 0
        };
      }, isMobile);

      await page.screenshot({ path: path.join(OUT_DIR, `np-${key}.png`) });

      if (hgt >= 600 && !isMobile && np.lyrH < 180) report.bugs.push(`[${key}] 歌词区高度 ${np.lyrH}px 过小 (<180px)`);
      if (np.overlap) report.bugs.push(`[${key}] 播放页 .left 与 controls 重叠`);
      if (np.footBottom > hgt + 2) report.bugs.push(`[${key}] 播放页底栏溢出 (${np.footBottom}px > ${hgt}px)`);
      if (np.trackH > 6 || np.hasWave) report.bugs.push(`[${key}] 进度轨道不合规: height=${np.trackH}px, wave=${np.hasWave}`);
      if (np.trans.includes('all')) report.bugs.push(`[${key}] 播放页动效使用了 transition: all`);

      const cDark = getContrast(np.closeCol, np.baseBg);
      if (cDark < 3.0) report.bugs.push(`[${key}] 深色主题按钮对比度 ${cDark}:1 低于 3.0`);
      else report.passed.push(`[${key}] 深色主题按钮对比度 ${cDark}:1 达标`);

      await page.evaluate(() => Theme.set ? Theme.set('light') : (document.documentElement.dataset.theme = 'light'));
      await page.waitForTimeout(250); // 等待主题颜色过渡动画完成
      const lightNp = await page.evaluate(() => ({
        bg: getComputedStyle(document.querySelector('.np-overlay')).backgroundColor,
        col: getComputedStyle(document.querySelector('.np-close')).color
      }));
      const cLight = getContrast(lightNp.col, lightNp.bg);
      if (cLight < 3.0) report.bugs.push(`[${key}] 浅色主题按钮对比度 ${cLight}:1 低于 3.0`);
      else report.passed.push(`[${key}] 浅色主题按钮对比度 ${cLight}:1 达标`);
    }

    report.viewports[key] = m;
    await ctx.close();
  }

  // prefers-reduced-motion 测试
  const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await h.installRoutes(rmCtx);
  const rmPage = await rmCtx.newPage();
  await h.openRoute(rmPage, '/discover');
  const rmOk = await rmPage.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.card') || document.body);
    return parseFloat(s.transitionDuration || '0') <= .05;
  });
  if (!rmOk) report.bugs.push('prefers-reduced-motion 下动效时长仍 > 0.05s');
  else report.passed.push('prefers-reduced-motion 无动效通过');
  await rmCtx.close();

  await browser.close();
  await h.stopServer();

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n=== 视觉测量 QA 完成 ===\n截图与报告: ${OUT_DIR}`);
  console.log(`合格: ${report.passed.length} | 缺陷: ${report.bugs.length}`);
  report.bugs.forEach(b => console.log('BUG:', b));
  return report;
}

if (require.main === module) {
  run().then(report => process.exit(report.bugs.length ? 1 : 0)).catch(e => { console.error('FATAL', e); process.exit(1); });
}
module.exports = { run };
