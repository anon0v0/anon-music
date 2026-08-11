/* 整页播放器扩展：登录/注册、设置面板（桌面歌词/逐字歌词/音质/播放器背景）、背景应用 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const api = (p, o) => apiFetch(p, o).then(r => r.json());
  // 同时转义引号：昵称/背景 URL 会回填进 value="…" 属性，textContent 不转引号会导致属性注入
  const esc = (t) => (t == null ? '' : String(t)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // 全局可读设置（nowplaying.js / desklyric.html 使用）
  const DESK_DEFAULTS = { enabled: false, fontSize: 18, color: '#ffffff', doubleRow: false,
    scheme: 'green', align: 'center', opacity: 1, shadow: 'soft',
    onlyBackground: false, locked: false,   // onlyBackground/locked 仅安卓悬浮歌词使用
    fontSizeA: 17 };   // 安卓悬浮歌词独立字号(sp)：web px 直接映射 sp 在手机上过大，两端分开设
  // 播放器样式（全屏播放页皮肤）：skin=经典黑胶vinyl/简约方形square/透明彩胶vinyl-color/简约歌词lyrics
  const PS_DEFAULTS = { skin: 'square', vinylColor: '#e14fae', bg: 'auto', lyricAlign: 'left', viz: 'wave' };
  window.AppSettings = {
    desktopLyrics: Object.assign({}, DESK_DEFAULTS),
    wordByWord: { enabled: true },
    quality: 'standard',
    background: { fluid: true },
    playerStyle: Object.assign({}, PS_DEFAULTS),
    queueMode: 'replace',   // 'replace'=播放新内容替换当前列表；'append'=追加到当前列表(不清空)
    theme: 'dark',          // 'dark'|'light'，theme.js 应用，html[data-theme] 驱动 app.css 语义 token
  };
  let me = null; // 当前用户

  // 桌面歌词配色方案（已唱渐变 hlA→hlB / 未唱 base）。与 music-app 的 lyrics.html SCHEMES 保持一致；
  // scheme='custom' 时用 desktopLyrics.color 单色。
  const LYRIC_SCHEMES = {
    green:  { hlA: '#2fd06f', hlB: '#a8ff78', base: 'rgba(255,255,255,.45)' },
    blue:   { hlA: '#38bdf8', hlB: '#a5e8ff', base: 'rgba(255,255,255,.45)' },
    violet: { hlA: '#a78bfa', hlB: '#e3d5ff', base: 'rgba(255,255,255,.45)' },
    orange: { hlA: '#fb923c', hlB: '#ffd9a8', base: 'rgba(255,255,255,.45)' },
    pink:   { hlA: '#f472b6', hlB: '#ffd1e8', base: 'rgba(255,255,255,.45)' },
    gold:   { hlA: '#f5c518', hlB: '#fff3b0', base: 'rgba(255,255,255,.45)' },
    white:  { hlA: '#ffffff', hlB: '#ffffff', base: 'rgba(255,255,255,.38)' },
  };
  function lyricColors() {
    const d = window.AppSettings.desktopLyrics || {};
    const sc = LYRIC_SCHEMES[d.scheme];
    if (sc) return sc;
    const c = d.color || '#ffffff';
    return { hlA: c, hlB: c, base: 'rgba(255,255,255,.42)' };
  }

  // 背景层
  const appBg = document.createElement('div'); appBg.id = 'appBg'; document.body.prepend(appBg);
  const style = document.createElement('style');
  style.textContent = `#appBg{position:fixed;inset:0;z-index:-1;background-size:cover;background-position:center;transition:background-image .6s,background .3s;}
  #appBg.cover{filter:blur(70px) brightness(.5) saturate(1.3);transform:scale(1.2);}
  #appBg.img::after{content:"";position:absolute;inset:0;background:rgba(6,6,10,var(--dim,.55));}
  body.custom-bg{background:transparent!important;} body.custom-bg .layout,body.custom-bg .main{background:transparent!important;}
  body.custom-bg .sidebar{background:rgba(10,10,16,.68)!important;backdrop-filter:blur(18px);}
  /* 顶栏本身透明（不要整条毛玻璃）；毛玻璃只落在搜索框和右侧按钮上 */
  body.custom-bg .topbar{background:transparent!important;}
  /* 浅色主题：暗化层与面板改白色磨砂，否则深色玻璃上浅色文字不可读 */
  html[data-theme="light"] #appBg.img::after{background:rgba(245,246,248,var(--dim,.55));}
  html[data-theme="light"] body.custom-bg .sidebar{background:rgba(245,246,248,.74)!important;}
  html[data-theme="light"] body.custom-bg .topbar{background:transparent!important;}
  .bgurl-row{display:flex;gap:10px;}
  .bgurl-row input{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text-bright);font-size:13px;min-width:0;}
  .bgurl-row button{background:var(--accent);border:none;color:#04210f;font-weight:700;border-radius:10px;padding:0 18px;cursor:pointer;}`;
  document.head.appendChild(style);

  // ---------------- 设置应用 ----------------
  function applyQuality(q) {
    try { localStorage.setItem('player_quality', q); } catch (e) {}
    if (window.player) window.player.quality = q;
  }
  function applyBackground(bg) {
    // 主界面自定义背景图（bg.image 链接）+ 全屏播放页「流体动画」开关（互不影响：
    // 全屏页 z-index 9999 自带取色底，天然盖住主界面背景）
    document.body.classList.remove('custom-bg');
    appBg.className = ''; appBg.style.background = ''; appBg.style.backgroundImage = '';
    if (bg && bg.image) {
      document.body.classList.add('custom-bg');
      appBg.className = 'img';
      appBg.style.backgroundImage = `url("${String(bg.image).replace(/"/g, '%22')}")`;
      appBg.style.setProperty('--dim', String(typeof bg.dim === 'number' ? bg.dim : 0.55));
    }
    if (window.NowPlaying && window.NowPlaying._applyFluidPref) window.NowPlaying._applyFluidPref();
  }
  function applyAll() {
    applyQuality(window.AppSettings.quality);
    applyBackground(window.AppSettings.background);
  }

  // 保存（防抖）
  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.AppSettings) });
      // 安卓：桌面歌词样式随设置保存同步下发原生（原生自己也持久化，重启 App 立即生效）
      if (ANDROID && typeof pushAndroidLyricStyle === 'function') pushAndroidLyricStyle();
    }, 400);
  }

  // ---------------- 桌面歌词（页面内悬浮，直接显示，不开新网页） ----------------
  const deskStyle = document.createElement('style');
  deskStyle.textContent = `
  #deskBar{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:9000;
    min-width:300px;max-width:84vw;padding:14px 30px;border-radius:16px;
    background:transparent;box-shadow:none;
    text-align:center;cursor:grab;user-select:none;display:none;
    transition:background .2s,box-shadow .2s;}
  #deskBar.show{display:block;}
  /* 默认无背景，悬停才出现 */
  #deskBar:hover{background:rgba(10,10,14,.66);backdrop-filter:blur(12px);box-shadow:0 12px 44px rgba(0,0,0,.55);}
  #deskBar.dragging{cursor:grabbing;background:rgba(10,10,14,.66);backdrop-filter:blur(12px);box-shadow:0 12px 44px rgba(0,0,0,.55);}
  /* drop-shadow 才能给逐字渐变文字(透明填充)加阴影，text-shadow 对其无效 */
  #deskBar .db-cur{font-weight:800;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--hl,#fff);filter:drop-shadow(0 2px 8px rgba(0,0,0,.9)) drop-shadow(0 0 2px rgba(0,0,0,.95));}
  #deskBar .db-next{margin-top:6px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;filter:drop-shadow(0 2px 8px rgba(0,0,0,.9)) drop-shadow(0 0 2px rgba(0,0,0,.9));}
  #deskBar .db-cur .kw{background:linear-gradient(90deg,var(--hlA,var(--hl,#fff)) 0%,var(--hlB,var(--hl,#fff)) calc(var(--p,0%) - 1.5%),var(--base,rgba(255,255,255,.42)) calc(var(--p,0%) + 1.5%));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;}
  #deskBar .db-tools{position:absolute;top:6px;right:8px;display:flex;gap:8px;opacity:0;transition:opacity .2s;}
  #deskBar:hover .db-tools{opacity:1;}
  #deskBar .db-tools span{cursor:pointer;color:rgba(255,255,255,.55);font-size:13px;}
  #deskBar .db-tools span:hover{color:#fff;}`;
  document.head.appendChild(deskStyle);

  let deskBar = null, deskRAF = null, dbLineIdx = -2, dbSpans = null, dbWords = null;
  // 壳检测统一走 bridge.js（P3 抽离）：TAURI=桌面壳(原生悬浮歌词窗)、ANDROID=安卓壳(原生媒体/悬浮歌词)，
  // 浏览器/PWA 下两者皆 null、行为不变。语义与旧版完全一致。
  const TAURI = (window.Bridge && window.Bridge.TAURI) || null;
  const ANDROID = (window.Bridge && window.Bridge.ANDROID) || null;
  let _deskEmitT = 0;
  function deskEmit(payload) { if (TAURI) { try { TAURI.event.emit('desk-lyric', payload); } catch (e) {} } }
  // 安卓：把事件发给原生（驱动 App 外系统悬浮歌词）。复用 desktopLyrics.enabled 作为开关。
  function androidEmit(name, payload) { if (ANDROID) { try { ANDROID.event.emit(name, payload); } catch (e) {} } }
  function androidLyricsOn() { const d = window.AppSettings.desktopLyrics; return !!(ANDROID && d && d.enabled); }
  function pushAndroidLyricData() {
    if (!ANDROID) return;
    const p = window.player; if (!p) return;
    // 整段歌词一次性下发，原生用进度插值推进当前行（后台也能滚动）。
    // v2：带逐字 words（{t:起始秒, d:时长秒, w:词文本}）→ 原生 KaraokeView 逐字高亮；
    // 旧壳(≤v0.4.6)的 Kotlin 只读 t/text，忽略 words，安全。
    const lines = (p.lyrics || []).map(l => ({
      t: l.time || 0, text: l.text || '',
      words: (l.words || []).map(w => ({ t: w.time || 0, d: w.duration || 0, w: w.text || '' })),
    }));
    androidEmit('and-lyric-data', lines);
  }
  // 悬浮歌词样式下发（安卓原生持久化到 SharedPreferences）。锁定不随样式推送（见 and-lyric-lock）。
  function pushAndroidLyricStyle() {
    if (!ANDROID) return;
    const d = window.AppSettings.desktopLyrics || {};
    const lc = lyricColors();
    androidEmit('and-lyric-style', {
      fontSize: (typeof d.fontSizeA === 'number' ? d.fontSizeA : 17), hlA: lc.hlA, hlB: lc.hlB, base: lc.base,
      doubleRow: !!d.doubleRow, align: d.align || 'center',
      opacity: (typeof d.opacity === 'number' ? d.opacity : 1),
      onlyBackground: !!d.onlyBackground,
    });
  }

  // 安卓系统返回键/侧滑：由原生 MainActivity 调用，按「层级」逐层关闭，到一级页面才退后台。
  // 返回 'handled'=已在 App 内处理（关弹窗/返回上级）；'exit'=请原生退到后台(不杀进程)。
  window.__androidBack = function () {
    try {
      const q = (sel) => document.querySelector(sel);
      // 1) 下拉菜单（音质/倍速）
      const drop = q('.pb-q-wrap.open') || q('.pb-speed-wrap.open') || q('.np-q.open') || q('.np-speed.open');
      if (drop) { drop.classList.remove('open'); return 'handled'; }
      // 2) 侧边抽屉
      const sb = q('#sidebar.open'); if (sb) { sb.classList.remove('open'); const bd = q('#sidebarBackdrop'); if (bd) bd.classList.remove('show'); return 'handled'; }
      // 3) 弹窗（登录/注册、添加到歌单、导入歌单等）
      const imp = q('.imp-mask.show'); if (imp) { imp.classList.remove('show'); return 'handled'; }
      const mask = q('.ov-mask.open'); if (mask) { mask.classList.remove('open'); return 'handled'; }
      const pl = q('#plModal.open'); if (pl) { pl.classList.remove('open'); return 'handled'; }
      // 4) 评论 / 播放列表 / 一起听 / 播放器样式面板
      // 评论必须走 Comments.close()——直接摘 open 类会留下 #cmMask 孤儿遮罩挡住整页
      const cm = q('.comment-panel.open'); if (cm) { if (window.Comments) window.Comments.close(); else cm.classList.remove('open'); return 'handled'; }
      const qp = q('#queuePanel.open'); if (qp) { qp.classList.remove('open'); return 'handled'; }
      const tg = q('.tg-panel.open'); if (tg) { tg.classList.remove('open'); return 'handled'; }
      const nsp = q('.np-style-panel.show'); if (nsp) { if (window.NowPlaying && window.NowPlaying.closeStylePanel) window.NowPlaying.closeStylePanel(); else nsp.classList.remove('show'); return 'handled'; }
      // 5) 全屏播放器
      if (window.NowPlaying && window.NowPlaying.el && window.NowPlaying.el.classList.contains('open')) { window.NowPlaying.close(); return 'handled'; }
      // 6) 子页面（歌单/排行榜详情、搜索结果、具体歌单）→ 返回上一级
      const hash = location.hash || '#/discover';
      const TOP = ['#/discover', '#/charts', '#/playlists', '#/liked', '#/recent', '#/my'];
      const isTop = TOP.indexOf(hash) >= 0 || hash === '' || hash === '#/';
      if (!isTop) { if (history.length > 1) history.back(); else location.hash = '#/discover'; return 'handled'; }
      // 7) 一级页面 → 退到后台（原生 moveTaskToBack，不杀进程）
      return 'exit';
    } catch (e) { return 'exit'; }
  };
  function buildDeskBar() {
    if (deskBar) return deskBar;
    deskBar = document.createElement('div');
    deskBar.id = 'deskBar';
    deskBar.innerHTML = `<div class="db-tools"><span class="db-x" title="关闭">✕</span></div>
      <div class="db-cur">♪</div><div class="db-next"></div>`;
    document.body.appendChild(deskBar);
    // 恢复位置（x 存的是“中心点”，始终用 translateX(-50%) 居中锚定 → 歌词长度变化时左右对称伸缩、不跳）
    try { const pos = JSON.parse(localStorage.getItem('deskBarPos') || 'null'); if (pos && pos.v === 2) { deskBar.style.left = pos.x + 'px'; deskBar.style.top = pos.y + 'px'; deskBar.style.bottom = 'auto'; deskBar.style.transform = 'translateX(-50%)'; } } catch (e) {}
    // 拖动（按中心锚定）
    let drag = null;
    deskBar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.db-tools')) return;
      const r = deskBar.getBoundingClientRect();
      drag = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - r.top };   // dx = 相对中心的偏移
      deskBar.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      let cx = e.clientX - drag.dx, y = e.clientY - drag.dy;   // cx = 新的中心 x
      const halfW = deskBar.offsetWidth / 2;
      cx = Math.max(halfW, Math.min(window.innerWidth - halfW, cx));
      y = Math.max(0, Math.min(window.innerHeight - deskBar.offsetHeight, y));
      deskBar.style.left = cx + 'px'; deskBar.style.top = y + 'px';
      deskBar.style.bottom = 'auto'; deskBar.style.transform = 'translateX(-50%)';
    });
    window.addEventListener('mouseup', () => {
      if (drag) { deskBar.classList.remove('dragging'); try { localStorage.setItem('deskBarPos', JSON.stringify({ x: parseInt(deskBar.style.left), y: parseInt(deskBar.style.top), v: 2 })); } catch (e) {} }
      drag = null;
    });
    deskBar.querySelector('.db-x').onclick = () => {
      window.AppSettings.desktopLyrics.enabled = false; saveSettings(); hideDeskBar();
      if (setModal.classList.contains('open')) { const _db = setModal.querySelector('#sec-desktop .set-sec-body'); if (_db) renderSection('desktop', _db); }
    };
    return deskBar;
  }
  function updateDeskBar() {
    if (!deskBar) return;
    const d = window.AppSettings.desktopLyrics, p = window.player;
    const cur = deskBar._cur || (deskBar._cur = deskBar.querySelector('.db-cur'));
    const next = deskBar._next || (deskBar._next = deskBar.querySelector('.db-next'));
    // 静态样式只在变化时写（避免每帧 DOM 写入 → 卡顿主因之一）
    if (deskBar._fs !== d.fontSize || deskBar._color !== d.color || deskBar._dr !== d.doubleRow ||
        deskBar._scheme !== d.scheme || deskBar._op !== d.opacity) {
      deskBar._fs = d.fontSize; deskBar._color = d.color; deskBar._dr = d.doubleRow;
      deskBar._scheme = d.scheme; deskBar._op = d.opacity;
      const lc = deskBar._lc = lyricColors();
      cur.style.fontSize = d.fontSize + 'px';
      deskBar.style.setProperty('--hl', lc.hlA);
      deskBar.style.setProperty('--hlA', lc.hlA);
      deskBar.style.setProperty('--hlB', lc.hlB);
      deskBar.style.setProperty('--base', lc.base);
      cur.style.opacity = (typeof d.opacity === 'number' ? d.opacity : 1);
      next.style.fontSize = Math.max(12, d.fontSize - 6) + 'px';
      next.style.color = lc.hlA; next.style.opacity = .6 * (typeof d.opacity === 'number' ? d.opacity : 1);
      next.style.display = d.doubleRow ? 'block' : 'none';
      dbLineIdx = -9;  // 强制重建当前行
    }
    const lc = deskBar._lc || (deskBar._lc = lyricColors());
    if (!p || !p.currentSong) { if (dbLineIdx !== -3) { cur.textContent = '♪ 暂无播放'; cur.style.color = lc.hlA; next.textContent = ''; dbLineIdx = -3; dbSpans = dbWords = null; } return; }
    const ly = p.lyrics || [], idx = p.currentLyricIndex;
    if (!ly.length) { if (dbLineIdx !== -4) { cur.textContent = p.currentSong.name || '♪'; cur.style.color = lc.hlA; next.textContent = p.currentSong.artists || ''; dbLineIdx = -4; dbSpans = dbWords = null; } return; }
    const c = idx >= 0 ? ly[idx] : null, n = idx >= 0 ? ly[idx + 1] : null;
    const wbw = window.AppSettings.wordByWord && window.AppSettings.wordByWord.enabled;
    const hasWords = !!(c && c.words && c.words.length && wbw);
    if (idx !== dbLineIdx) {   // 行变化时才重建 DOM 并缓存 span 引用
      dbLineIdx = idx;
      if (hasWords) {
        cur.style.color = '';
        cur.innerHTML = c.words.map(w => `<span class="kw">${esc(w.text)}</span>`).join('');
        dbSpans = cur.querySelectorAll('.kw'); dbWords = c.words;
      } else {
        cur.style.color = lc.hlA; cur.textContent = c ? (c.text || '♪') : '♪';
        dbSpans = dbWords = null;
      }
      next.textContent = n ? (n.text || '') : '';
    }
    if (hasWords && dbSpans && dbWords) {   // 每帧只更新已缓存 span 的填充比例（带去重）
      const t = (p.audio && p.audio.currentTime) || p.currentTime || 0;   // 用实时 audio 时间(60fps)，不用 4fps 的 player.currentTime
      for (let i = 0; i < dbWords.length; i++) {
        const start = dbWords[i].time;
        const end = i + 1 < dbWords.length ? dbWords[i + 1].time : (n ? n.time : start + 0.6);
        let pct = end > start ? (t - start) / (end - start) : (t >= start ? 1 : 0);
        pct = pct < 0 ? 0 : pct > 1 ? 1 : pct;
        const sp = dbSpans[i];
        if (sp) { const v = (pct * 100).toFixed(1) + '%'; if (sp._p !== v) { sp._p = v; sp.style.setProperty('--p', v); } }
      }
    }
    // 推送到原生悬浮歌词窗口（节流 ~25fps；cur.innerHTML 已含逐字 --p 状态）
    if (TAURI && d.enabled) {
      const now = performance.now();
      if (now - _deskEmitT > 40) {
        _deskEmitT = now;
        const playing = !!(p && p.audio && !p.audio.paused);
        // payload v2：只增不改——旧 lyrics.html(v0.4.6 壳)只认 fontSize/color/html/next/doubleRow/playing，
        // 新字段被其忽略；新 lyrics.html 优先用 hlA/hlB/base/align/opacity/shadow。
        deskEmit({ ver: 2, show: true, html: cur.innerHTML, next: d.doubleRow ? (next.textContent || '') : '',
          fontSize: d.fontSize, color: lc.hlA, doubleRow: !!d.doubleRow, playing,
          scheme: d.scheme || 'green', hlA: lc.hlA, hlB: lc.hlB, base: lc.base,
          align: d.align || 'center', opacity: (typeof d.opacity === 'number' ? d.opacity : 1),
          shadow: d.shadow || 'soft' });
      }
    }
  }
  function syncLyricBtn(on) { const b = document.getElementById('pbLyric'); if (b) b.classList.toggle('active', !!on); }
  function showDeskBar() {
    buildDeskBar();
    if (!TAURI) deskBar.classList.add('show');   // Tauri 下用原生悬浮窗，页内浮层保持隐藏（仅作计算缓冲）
    syncLyricBtn(true);
    dbLineIdx = -2;
    if (deskRAF) cancelAnimationFrame(deskRAF);
    const loop = () => { updateDeskBar(); deskRAF = requestAnimationFrame(loop); };
    loop();
  }
  function hideDeskBar() {
    if (deskBar) deskBar.classList.remove('show');
    if (deskRAF) { cancelAnimationFrame(deskRAF); deskRAF = null; }
    syncLyricBtn(false);
    deskEmit({ show: false });   // 通知原生悬浮窗隐藏
  }
  // 暴露给底部播放条「桌面歌词」按钮使用
  window.DeskLyric = {
    isOn() { return !!(window.AppSettings.desktopLyrics && window.AppSettings.desktopLyrics.enabled); },
    toggle() {
      const d = window.AppSettings.desktopLyrics;
      // 安卓：悬浮歌词已开启且已锁定时，本按钮先充当「解锁」——锁定后原生悬浮窗完全穿透，
      // 播放器/迷你条的这个按钮和媒体卡是仅有的解锁入口。解锁不改变显示状态（仍显示）。
      if (ANDROID && d.enabled && d.locked) {
        d.locked = false;
        androidEmit('and-lyric-lock', { locked: false });
        saveSettings();
        syncLyricBtn(true);
        if (setModal.classList.contains('open')) { const _db = setModal.querySelector('#sec-desktop .set-sec-body'); if (_db) renderSection('desktop', _db); }
        return true;
      }
      d.enabled = !d.enabled;
      if (ANDROID) {
        // 安卓：「词」按钮 = 开关 App 外系统悬浮歌词（首次会跳去授权「显示在其它应用上层」）。
        androidEmit('and-lyric-show', { show: d.enabled });
        androidEmit('and-lyrics-active', { active: d.enabled }); // 同步媒体卡片「词」按钮打勾
        if (d.enabled) pushAndroidLyricData();
        syncLyricBtn(d.enabled);
      } else {
        d.enabled ? showDeskBar() : hideDeskBar();
      }
      saveSettings();
      if (setModal.classList.contains('open')) { const _db = setModal.querySelector('#sec-desktop .set-sec-body'); if (_db) renderSection('desktop', _db); }
      return d.enabled;
    },
  };

  // ---------------- 弹窗外壳 ----------------
  function modal(html, cls) {
    const m = document.createElement('div'); m.className = 'ov-mask ' + (cls || '');
    m.innerHTML = `<div class="ov-card ${cls === 'set' ? 'set-card' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(m);
    // 登录框只能点 × 关闭（点外部空白不关），其余弹窗点外部可关
    if (cls !== 'auth') m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
    return m;
  }

  // ---------------- 登录 / 注册 ----------------
  const authModal = modal(`
    <form id="authForm">
    <h2 id="authTitle"><span>登录</span><button class="close-x" type="button" aria-label="关闭登录窗口">×</button></h2>
    <div class="field"><label for="auEmail">邮箱</label><input id="auEmail" type="email" autocomplete="email" placeholder="you@example.com" required></div>
    <div class="field" id="auCodeField" style="display:none"><label for="auCode">验证码</label>
      <div class="with-btn"><input id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6位验证码"><button class="code-btn" type="button" id="auSend">发送验证码</button></div></div>
    <div class="field"><label for="auPwd">密码</label><input id="auPwd" type="password" autocomplete="current-password" minlength="6" placeholder="至少6位" required></div>
    <div class="ov-msg" id="auMsg"></div>
    <button class="primary" type="submit" id="auSubmit">登录</button>
    <div class="switch-mode" id="auSwitch">还没有账号？<button type="button" class="link-btn">注册</button></div>
    </form>`, 'auth');
  const auE = (s) => $(s, authModal);
  let authMode = 'login';
  function openAuth(mode) {
    authMode = mode || 'login';
    auE('#authTitle span').textContent = authMode === 'login' ? '登录' : '注册';
    auE('#auSubmit').textContent = authMode === 'login' ? '登录' : '注册';
    auE('#auCodeField').style.display = authMode === 'login' ? 'none' : '';
    auE('#auSwitch').innerHTML = authMode === 'login' ? '还没有账号？<button type="button" class="link-btn">注册</button>' : '已有账号？<button type="button" class="link-btn">登录</button>';
    auE('#auPwd').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    auE('#auMsg').textContent = '';
    authModal.classList.add('open');
    setTimeout(() => auE('#auEmail').focus(), 0);
  }
  function authMsg(t, ok) { const m = auE('#auMsg'); m.textContent = t; m.className = 'ov-msg ' + (ok ? 'ok' : 'err'); }
  const closeAuth = () => authModal.classList.remove('open');
  authModal.querySelector('.close-x').onclick = closeAuth;
  auE('#auSwitch').onclick = (e) => { if (e.target.closest('.link-btn')) openAuth(authMode === 'login' ? 'register' : 'login'); };
  authModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAuth(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...authModal.querySelectorAll('button:not([disabled]),input:not([disabled])')].filter(x => x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  auE('#auSend').onclick = async () => {
    const email = auE('#auEmail').value.trim();
    if (!email) return authMsg('请输入邮箱');
    const btn = auE('#auSend'); btn.disabled = true;
    const r = await api('/api/auth/send_code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (r.code === 0) {
      authMsg('验证码已发送，请查收邮箱', true);
      let n = 60; btn.textContent = n + 's';
      const t = setInterval(() => { n--; btn.textContent = n + 's'; if (n <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; } }, 1000);
    } else { btn.disabled = false; authMsg(r.detail || r.msg || '发送失败'); }
  };
  auE('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = auE('#auEmail').value.trim(), pwd = auE('#auPwd').value, code = auE('#auCode').value.trim();
    if (!email || !pwd) return authMsg('请填写邮箱和密码');
    const path = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = authMode === 'login' ? { email, password: pwd } : { email, password: pwd, code };
    const r = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // 壳内（跨源）拿不到 httponly cookie，把服务端回的 token 存起来，之后由 apiFetch 走 header
    if (r.code === 0 && r.data && r.data.token) window.apiToken.set(r.data.token);
    if (r.code === 0) { authMsg('成功，正在进入…', true); setTimeout(() => location.reload(), 500); }
    else authMsg(r.detail || r.msg || '操作失败');
  };

  // ---------------- 账户区 ----------------
  function renderAccount() {
    const box = $('#account'); if (!box) return;
    if (me) {
      const av = me.avatar || '';
      const disp = me.nickname || String(me.email).split('@')[0];
      // 未设 emoji 头像 → 默认用应用 logo（不再用邮箱首字母）
      const avInner = av ? `<div class="av av-emoji" title="编辑资料">${esc(av)}</div>`
        : `<div class="av av-logo" title="编辑资料"><img src="/static/music-logo.png?v=20260721e" alt=""></div>`;
      box.innerHTML = `<div class="user">${avInner}
        <div class="em" title="${esc(me.email)}（点击编辑资料）">${esc(disp)}</div><button class="lo">登出</button></div>`;
      box.querySelector('.lo').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); window.apiToken.set(''); location.reload(); };
      // 点头像/昵称 → 编辑资料（emoji 头像 + 昵称）
      box.querySelector('.av').onclick = openProfile;
      box.querySelector('.em').onclick = openProfile;
    } else {
      box.innerHTML = `<button class="login-btn">登录 / 注册</button>`;
      box.querySelector('.login-btn').onclick = () => openAuth('login');
    }
  }

  // ---------------- 编辑资料（emoji 头像 + 昵称） ----------------
  const PROFILE_EMOJIS = ['🎵','🎧','🎸','🎹','🎤','🥁','🎺','🎻','🌙','⭐','🔥','💿','🍭','🐱','🐶','🐰','🦊','🐼','🐸','🦄','👻','🤖','😎','🥳','🌸','🍀','🍉','🧋','⚡','❤️'];
  let profileModal = null;
  function openProfile() {
    if (!me) return;
    if (!profileModal) {
      profileModal = modal(`
        <h2>编辑资料<button class="close-x" style="margin-left:auto">×</button></h2>
        <div class="set-panel" id="profilePanel"></div>`, 'profile');
      profileModal.querySelector('.close-x').onclick = () => profileModal.classList.remove('open');
    }
    const p = $('#profilePanel', profileModal);
    let curAv = me.avatar || '';
    p.innerHTML = `
      <div class="lbl" style="margin-bottom:10px">emoji 头像</div>
      <div class="emoji-grid">${PROFILE_EMOJIS.map(e2 => `<span class="emoji-opt ${curAv === e2 ? 'active' : ''}" data-e="${e2}">${e2}</span>`).join('')}</div>
      <div class="lbl" style="margin:16px 0 8px">显示昵称（评论区 / 一起听用这个名字）</div>
      <div class="bgurl-row"><input id="pfNick" maxlength="20" placeholder="${esc(String(me.email).split('@')[0])}" value="${esc(me.nickname || '')}"><button id="pfSave">保存</button></div>
      <div style="color:var(--muted);font-size:13px;padding-top:12px">留空昵称则显示邮箱前缀。</div>`;
    p.querySelectorAll('.emoji-opt').forEach(el => el.onclick = () => {
      curAv = (curAv === el.dataset.e) ? '' : el.dataset.e;   // 再点一次取消
      p.querySelectorAll('.emoji-opt').forEach(x => x.classList.toggle('active', x.dataset.e === curAv));
    });
    p.querySelector('#pfSave').onclick = async () => {
      const nick = ($('#pfNick', profileModal).value || '').trim();
      try {
        const r = await api('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, avatar: curAv }) });
        if (r && r.code === 0) {
          me.nickname = nick; me.avatar = curAv; window.AppUser = me;
          renderAccount();
          profileModal.classList.remove('open');
          if (window.toast) window.toast('资料已更新');
        }
      } catch (e) { if (window.appNotice) window.appNotice('资料保存失败，请稍后再试', 'error'); }
    };
    profileModal.classList.add('open');
  }

  // ---------------- 设置面板 ----------------
  const setModal = modal(`
    <h2><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82M4.6 9a1.65 1.65 0 0 0 .33-1.82"/></svg> 设置<button class="close-x" style="margin-left:auto">×</button></h2>
    <div class="set-tabs">
      ${settingTabs().map(([t, name], i) => `<button data-t="${t}"${i === 0 ? ' class="active"' : ''}>${name}</button>`).join('\n      ')}
    </div>
    <div class="set-panel" id="setPanel"></div>`, 'set');
  setModal.querySelector('.close-x').onclick = () => setModal.classList.remove('open');
  // 标签⇄滚动联动状态：点击标签会平滑滚动，滚动期间抑制"滚动高亮"，
  // 否则动画过程中高亮会依次扫过中间标签 → 闪烁/乱飘（并可能停在错误标签上）。
  let _setProgram = false, _setIdle = 0, _setSpyRaf = 0;
  setModal.querySelectorAll('.set-tabs button').forEach(b => b.onclick = () => {
    setModal.querySelectorAll('.set-tabs button').forEach(x => x.classList.toggle('active', x === b));
    const sec = $('#sec-' + b.dataset.t, setModal);
    if (sec) { _setProgram = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  function swHTML(on) { return `<div class="sw ${on ? 'on' : ''}"></div>`; }
  // 渲染单个类目到传入的容器 p（单页设置：所有类目同时渲染成各 section）
  function renderSection(tab, p) {
    const S = window.AppSettings;
    if (tab === 'desktop') {
      const d = S.desktopLyrics;
      const opPct = Math.round((typeof d.opacity === 'number' ? d.opacity : 1) * 100);
      const schemeSw = Object.keys(LYRIC_SCHEMES).map(k => {
        const s = LYRIC_SCHEMES[k];
        return `<span class="swatch scheme-sw ${d.scheme === k ? 'active' : ''}" data-k="${k}" style="background:linear-gradient(135deg,${s.hlA},${s.hlB})"></span>`;
      }).join('');
      // 安卓悬浮歌词用独立字号 fontSizeA(sp，范围小)；PC/浏览器用 fontSize(px)
      const isA = !!ANDROID;
      const fsVal = isA ? (typeof d.fontSizeA === 'number' ? d.fontSizeA : 17) : d.fontSize;
      const fsMin = 12, fsMax = isA ? 28 : 72;
      const fsPresets = isA ? [['小',14],['标准',17],['较大',20],['大',24],['超大',28]]
                            : [['小',14],['较小',16],['标准',18],['较大',22],['大',28],['超大',36]];
      p.innerHTML = `
        <div class="set-row"><span class="set-label">启用桌面歌词</span><div class="sw ${d.enabled ? 'on' : ''}" id="dOn"></div></div>
        <div class="set-block"><div class="lbl">字体大小</div>
          <div class="range-row"><input type="range" min="${fsMin}" max="${fsMax}" value="${fsVal}" id="dFont"><input class="px-box" id="dFontN" value="${fsVal}"> ${isA ? 'sp' : 'px'}</div>
          <div class="presets">${fsPresets.map(([n,v]) => `<button data-v="${v}" class="${fsVal==v?'active':''}">${n}</button>`).join('')}</div>
        </div>
        <div class="set-block"><div class="lbl">配色方案（已唱部分的渐变色）</div>
          <div class="swatches">${schemeSw}<span class="swatch scheme-sw ${d.scheme === 'custom' ? 'active' : ''}" data-k="custom" style="background:${d.color}"></span></div>
          <div class="color-row" style="margin-top:8px"><input type="color" id="dColor" value="${d.color}"><span style="color:var(--muted)">自定义单色（选色后自动生效）</span></div>
        </div>
        <div class="set-row"><span class="set-label">双排歌词</span><div class="sw ${d.doubleRow ? 'on' : ''}" id="dDouble"></div></div>
        <div class="set-block"><div class="lbl">对齐</div><div class="presets" id="dAlign">
          <button data-v="left" class="${d.align === 'left' ? 'active' : ''}">左</button>
          <button data-v="center" class="${(d.align || 'center') === 'center' ? 'active' : ''}">中</button>
          <button data-v="right" class="${d.align === 'right' ? 'active' : ''}">右</button></div></div>
        <div class="set-block"><div class="lbl">文字投影</div><div class="presets" id="dShadow">
          <button data-v="off" class="${d.shadow === 'off' ? 'active' : ''}">关</button>
          <button data-v="soft" class="${(d.shadow || 'soft') === 'soft' ? 'active' : ''}">柔和</button>
          <button data-v="strong" class="${d.shadow === 'strong' ? 'active' : ''}">加强</button></div></div>
        <div class="set-block"><div class="lbl">不透明度</div>
          <div class="range-row"><input type="range" min="30" max="100" value="${opPct}" id="dOpacity"><b id="dOpV" style="min-width:44px">${opPct}%</b></div></div>
        ${ANDROID ? `
        <div class="set-row"><span class="set-label">仅在App外显示悬浮歌词</span><div class="sw ${d.onlyBackground ? 'on' : ''}" id="dOnlyBg"></div></div>
        <div class="set-row"><span class="set-label">锁定悬浮歌词（穿透、不可拖）</span><div class="sw ${d.locked ? 'on' : ''}" id="dLock"></div></div>
        <button class="preview-btn" id="dUnlock" style="margin-top:10px">立即解锁悬浮歌词</button>` : ''}
        <button class="preview-btn" id="dPreview">预览歌词效果</button>`;
      // 绑定（全部用 id，避免依赖 .sw 顺序）
      p.querySelector('#dOn').onclick = (e) => {
        // 安卓：开关=系统悬浮歌词（走 DeskLyric.toggle 的 and-lyric-show 通道），不是页内歌词条
        if (ANDROID && window.DeskLyric) { window.DeskLyric.toggle(); e.target.classList.toggle('on', d.enabled); return; }
        d.enabled = !d.enabled; e.target.classList.toggle('on', d.enabled); d.enabled ? showDeskBar() : hideDeskBar(); saveSettings();
      };
      p.querySelector('#dDouble').onclick = (e) => { d.doubleRow = !d.doubleRow; e.target.classList.toggle('on', d.doubleRow); saveSettings(); };
      const setFont = (v) => { v = Math.max(fsMin, Math.min(fsMax, +v || fsVal)); if (isA) d.fontSizeA = v; else d.fontSize = v; p.querySelector('#dFont').value = v; p.querySelector('#dFontN').value = v; p.querySelectorAll('.presets button[data-v]').forEach(b => { if (b.parentElement.id !== 'dAlign' && b.parentElement.id !== 'dShadow') b.classList.toggle('active', +b.dataset.v === v); }); saveSettings(); };
      p.querySelector('#dFont').oninput = e => setFont(e.target.value);
      p.querySelector('#dFontN').onchange = e => setFont(e.target.value);
      p.querySelectorAll('.set-block .presets button').forEach(b => { if (b.parentElement.id !== 'dAlign' && b.parentElement.id !== 'dShadow') b.onclick = () => setFont(b.dataset.v); });
      p.querySelectorAll('.scheme-sw').forEach(s => s.onclick = () => { d.scheme = s.dataset.k; p.querySelectorAll('.scheme-sw').forEach(x => x.classList.toggle('active', x === s)); saveSettings(); });
      p.querySelector('#dColor').oninput = (e) => {
        d.color = e.target.value; d.scheme = 'custom';
        const cs = p.querySelector('.scheme-sw[data-k="custom"]');
        if (cs) { cs.style.background = d.color; p.querySelectorAll('.scheme-sw').forEach(x => x.classList.toggle('active', x === cs)); }
        saveSettings();
      };
      p.querySelectorAll('#dAlign button').forEach(b => b.onclick = () => { d.align = b.dataset.v; p.querySelectorAll('#dAlign button').forEach(x => x.classList.toggle('active', x === b)); saveSettings(); });
      p.querySelectorAll('#dShadow button').forEach(b => b.onclick = () => { d.shadow = b.dataset.v; p.querySelectorAll('#dShadow button').forEach(x => x.classList.toggle('active', x === b)); saveSettings(); });
      p.querySelector('#dOpacity').oninput = (e) => { d.opacity = (+e.target.value) / 100; p.querySelector('#dOpV').textContent = e.target.value + '%'; saveSettings(); };
      if (ANDROID) {
        p.querySelector('#dOnlyBg').onclick = (e) => { d.onlyBackground = !d.onlyBackground; e.target.classList.toggle('on', d.onlyBackground); saveSettings(); };
        // 锁定/解锁走独立事件（不随样式推送，避免竞态覆盖原生工具条的锁定）
        p.querySelector('#dLock').onclick = (e) => { d.locked = !d.locked; e.target.classList.toggle('on', d.locked); androidEmit('and-lyric-lock', { locked: d.locked }); saveSettings(); };
        // 无状态解锁兜底：不依赖 d.locked 显示状态（原生工具条锁定时 web 可能没同步到），一键必解
        p.querySelector('#dUnlock').onclick = () => { d.locked = false; androidEmit('and-lyric-lock', { locked: false }); saveSettings(); renderTab(); };
      }
      p.querySelector('#dPreview').onclick = showDeskBar;
    } else if (tab === 'word') {
      const w = S.wordByWord;
      p.innerHTML = `<div class="set-row"><span class="set-label">逐字歌词（卡拉OK高亮，需歌曲含逐字数据）</span>${swHTML(w.enabled)}</div>
        <div style="color:var(--muted);font-size:13px;padding-top:10px">开启后，全屏歌词将按字逐个高亮；无逐字数据的歌曲回退为整行高亮。</div>`;
      p.querySelector('.sw').onclick = (e) => { w.enabled = !w.enabled; e.target.classList.toggle('on', w.enabled); saveSettings(); };
    } else if (tab === 'quality') {
      const opts = [['standard', '标准', 'MP3 128k'], ['hq', 'HQ', 'MP3 320k'], ['flac', '无损', 'FLAC'], ['master', '母带', 'Hi-Res / 母带']];
      p.innerHTML = `<div class="lbl" style="margin-bottom:12px">默认播放音质</div><div class="opt-grid">${opts.map(([v, t, dd]) => `<div class="opt ${S.quality===v?'active':''}" data-v="${v}"><div class="t">${t}</div><div class="d">${dd}</div></div>`).join('')}</div>
        <div style="color:var(--muted);font-size:13px;padding-top:14px">高音质（无损/母带）需要对应平台会员 Cookie，否则自动回退。</div>`;
      p.querySelectorAll('.opt').forEach(o => o.onclick = () => { S.quality = o.dataset.v; p.querySelectorAll('.opt').forEach(x => x.classList.toggle('active', x === o)); applyQuality(S.quality); if (window.player) window.player.setQuality(S.quality); saveSettings(); });
    } else if (tab === 'theme') {
      const cur = (window.Theme && window.Theme.get()) || 'dark';
      p.innerHTML = `<div class="lbl" style="margin-bottom:12px">界面主题</div>
        <div class="opt-grid">
          <div class="opt ${cur === 'dark' ? 'active' : ''}" data-v="dark"><div class="t">深色</div><div class="d">默认，全场景已适配</div></div>
          <div class="opt ${cur === 'light' ? 'active' : ''}" data-v="light"><div class="t">浅色</div><div class="d">首版，细节持续打磨中</div></div>
        </div>
        <div style="color:var(--muted);font-size:13px;padding-top:14px">全屏播放页保持专辑取色的沉浸深底，不随主题变化。</div>`;
      p.querySelectorAll('.opt').forEach(o => o.onclick = () => {
        const t = o.dataset.v;
        if (window.Theme) window.Theme.set(t);
        S.theme = t; saveSettings();
        if (window._syncThemeBtn) window._syncThemeBtn();   // 同步侧栏主题按钮图标
        p.querySelectorAll('.opt').forEach(x => x.classList.toggle('active', x === o));
      });
    } else if (tab === 'bgimg') {
      const b = S.background;
      const dimPct = Math.round((typeof b.dim === 'number' ? b.dim : 0.55) * 100);
      p.innerHTML = `
        <div class="lbl" style="margin-bottom:10px">自定义背景图（仅主界面显示，不影响全屏播放页）</div>
        <div class="bgurl-row">
          <input id="bgUrl" type="url" placeholder="粘贴图片链接 https://…" value="${esc(b.image || '')}">
          <button id="bgApply">应用</button>
        </div>
        <div class="set-block"><div class="lbl">暗化程度（越高文字越清晰）</div>
          <div class="range-row"><input type="range" min="20" max="90" id="bgDim" value="${dimPct}"><b id="bgDimV" style="min-width:44px">${dimPct}%</b></div></div>
        <button class="preview-btn" id="bgClear">清除背景，恢复默认</button>
        <div style="color:var(--muted);font-size:13px;padding-top:12px">支持任意公开可访问的图片链接（jpg/png/webp）。背景随账号保存，多端同步。</div>`;
      const applyNow = () => { applyBackground(b); saveSettings(); };
      p.querySelector('#bgApply').onclick = () => {
        const u = (p.querySelector('#bgUrl').value || '').trim();
        if (u && !/^https?:\/\//i.test(u)) { if (window.appNotice) window.appNotice('请填写 http(s) 开头的图片链接', 'warning'); return; }
        b.image = u; applyNow();
      };
      p.querySelector('#bgUrl').onkeydown = (e) => { if (e.key === 'Enter') p.querySelector('#bgApply').click(); };
      p.querySelector('#bgDim').oninput = (e) => {
        b.dim = (+e.target.value) / 100;
        p.querySelector('#bgDimV').textContent = e.target.value + '%';
        applyNow();
      };
      p.querySelector('#bgClear').onclick = () => { b.image = ''; p.querySelector('#bgUrl').value = ''; applyNow(); };
    } else if (tab === 'sleep') {
      const ST = window.SleepTimer;
      const renderSleep = () => {
        if (!ST) { p.innerHTML = '<div style="color:var(--muted);font-size:13px">睡眠定时器未加载</div>'; return; }
        const s = ST.state();
        const modeRows = Object.keys(ST.MODES).map(k =>
          `<button class="sleep-mode${s.active && s.mode === k ? ' active' : ''}" data-m="${k}">${ST.MODES[k]}</button>`).join('');
        const status = s.active
          ? `<div class="set-row"><span class="set-label">${s.pendingFinish ? '本曲播完后暂停' : (s.remainingMs ? '剩余 ' + ST.fmt(s.remainingMs) : ST.MODES[s.mode])}</span><button class="refresh-btn" id="slpCancel">取消</button></div>`
          : '<div style="color:var(--muted);font-size:13px;padding-bottom:8px">到点后自动暂停播放，适合睡前听歌。</div>';
        p.innerHTML = status +
          `<div class="set-block"><div class="lbl">倒计时（分钟）</div>
             <div class="presets">${ST.PRESETS.map(v => `<button data-v="${v}">${v}</button>`).join('')}</div>
             <div class="range-row" style="margin-top:8px"><input class="px-box" id="slpCustom" placeholder="自定义" style="width:88px"> 分钟
               <button class="refresh-btn" id="slpCustomGo" style="margin-left:8px">开始</button></div>
           </div>
           <div class="set-block"><div class="lbl">到点后的行为</div><div class="presets sleep-modes">${modeRows}</div></div>`;
        p.querySelectorAll('.presets [data-v]').forEach(b => b.onclick = () => { ST.start(pickMode(), +b.dataset.v); renderSleep(); });
        const go = p.querySelector('#slpCustomGo');
        if (go) go.onclick = () => { const v = parseInt(p.querySelector('#slpCustom').value, 10); if (v > 0) { ST.start(pickMode(), v); renderSleep(); } };
        const cx = p.querySelector('#slpCancel');
        if (cx) cx.onclick = () => { ST.cancel(); renderSleep(); };
        p.querySelectorAll('.sleep-mode').forEach(b => b.onclick = () => {
          const m = b.dataset.m;
          p.dataset.mode = m;
          // 不需要时长的两种模式点了就立刻生效
          if (m === 'finish-current' || m === 'finish-playlist') ST.start(m, 0);
          renderSleep();
        });
      };
      const pickMode = () => (p.dataset.mode === 'countdown-finish' ? 'countdown-finish' : 'countdown');
      renderSleep();
    } else if (tab === 'play') {
      const append = S.queueMode === 'append';
      p.innerHTML = `<div class="set-row"><span class="set-label">播放新内容时追加到当前列表（不清空）</span>${swHTML(append)}</div>
        <div style="color:var(--muted);font-size:13px;padding-top:12px">关闭（默认）：播放新歌曲/歌单会<b style="color:#ddd">替换</b>当前播放列表。<br>开启：新内容插入到当前歌曲<b style="color:#ddd">之后接着播放</b>，原列表保留、互不清空。</div>`;
      p.querySelector('.sw').onclick = (e) => {
        S.queueMode = (S.queueMode === 'append') ? 'replace' : 'append';
        e.target.classList.toggle('on', S.queueMode === 'append');
        saveSettings();
      };
    } else if (tab === 'app') {
      const tray = localStorage.getItem('closeToTray') !== '0';   // 默认最小化到托盘
      p.innerHTML = `<div class="set-row"><span class="set-label">关闭按钮 = 最小化到托盘</span>${swHTML(tray)}</div>
        <div style="color:var(--muted);font-size:13px;padding-top:12px">开启：点关闭后最小化到系统托盘（托盘可恢复/退出）；关闭：点关闭直接退出程序。</div>`;
      p.querySelector('.sw').onclick = (e) => {
        const on = !(localStorage.getItem('closeToTray') !== '0');
        try { localStorage.setItem('closeToTray', on ? '1' : '0'); } catch (_) {}
        e.target.classList.toggle('on', on);
        if (TAURI) { try { TAURI.event.emit('set-close-tray', { value: on }); } catch (_) {} }
      };
    }
  }

  // 单页设置：所有类目一次渲染成各 section，顶部标签变成锚点导航（点击滚动到对应 section）
  function settingTabs() {
    const tabs = [['desktop', '桌面歌词'], ['word', '逐字歌词'], ['quality', '音质'], ['play', '播放'], ['sleep', '睡眠定时'], ['theme', '主题'], ['bgimg', '背景']];
    if (TAURI) tabs.push(['app', '应用']);
    return tabs;
  }
  // 根据滚动位置高亮对应标签（用 getBoundingClientRect，不受 offsetParent/padding 影响）
  function setSpy() {
    const panel = $('#setPanel', setModal); if (!panel) return;
    const ptop = panel.getBoundingClientRect().top;
    let cur = settingTabs()[0][0];
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) {
      cur = settingTabs()[settingTabs().length - 1][0];   // 滚到底：尾部 section 顶不到顶部，直接高亮最后一个
    } else {
      for (const [t] of settingTabs()) {
        const s = panel.querySelector('#sec-' + t);
        if (s && s.getBoundingClientRect().top - ptop <= 64) cur = t;
      }
    }
    setModal.querySelectorAll('.set-tabs button').forEach(x => x.classList.toggle('active', x.dataset.t === cur));
  }
  function renderTab() {
    const panel = $('#setPanel', setModal);
    panel.innerHTML = settingTabs().map(([t, name]) =>
      `<section class="set-sec" id="sec-${t}"><h4 class="set-sec-h">${name}</h4><div class="set-sec-body"></div></section>`).join('');
    settingTabs().forEach(([t]) => renderSection(t, panel.querySelector(`#sec-${t} .set-sec-body`)));
    if (!panel._scrollHooked) {
      panel._scrollHooked = true;
      panel.addEventListener('scroll', () => {
        // 平滑滚动(点击标签)期间只在停止后收尾一次，不逐帧抢高亮 → 消除闪烁/乱飘
        clearTimeout(_setIdle);
        _setIdle = setTimeout(() => { _setProgram = false; setSpy(); }, 130);
        if (_setProgram || _setSpyRaf) return;
        _setSpyRaf = requestAnimationFrame(() => { _setSpyRaf = 0; setSpy(); });
      });
    }
  }

  $('#settingsBtn') && ($('#settingsBtn').onclick = () => { setModal.classList.add('open'); _setProgram = false; renderTab(); $('#setPanel', setModal).scrollTop = 0; setSpy(); });
  // 调试：?settings=1 自动打开设置（无头截图用）
  if (/[?&]settings=1\b/.test(location.search)) setTimeout(() => { const b = $('#settingsBtn'); if (b) b.click(); }, 1500);

  // 侧栏主题切换按钮（设置按钮旁）：一键深色/浅色
  (function () {
    const tb = $('#themeBtn'); if (!tb) return;
    const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    const sync = () => { const t = (window.Theme && window.Theme.get()) || 'dark'; tb.innerHTML = t === 'dark' ? MOON : SUN; tb.title = t === 'dark' ? '切换到浅色' : '切换到深色'; };
    sync();
    tb.onclick = () => {
      const next = ((window.Theme && window.Theme.get()) === 'dark') ? 'light' : 'dark';
      if (window.Theme) window.Theme.set(next);
      window.AppSettings.theme = next; saveSettings();
      sync();
      // 设置面板开着时同步「主题」类目的选中态
      if (setModal.classList.contains('open')) { const tbody = setModal.querySelector('#sec-theme .set-sec-body'); if (tbody) renderSection('theme', tbody); }
    };
    window._syncThemeBtn = sync;   // 设置面板里改主题时回调同步图标
  })();

  // ---------------- 全屏页「播放器样式」面板（入口在全屏页音质旁的调色盘图标，不放设置里） ----------------
  (function mountStylePanel() {
    const np = window.NowPlaying;
    if (!np || !np.el) return;
    const panel = document.createElement('div');
    panel.className = 'np-style-panel';
    np.el.appendChild(panel);
    np.el.classList.add('has-nsp');   // 面板已挂载 → 显示入口按钮（旧下载页无面板则按钮保持隐藏）
    const btn = np.el.querySelector('.np-style-btn');
    function render() {
      const S = window.AppSettings;
      const ps = S.playerStyle = Object.assign({}, PS_DEFAULTS, S.playerStyle || {});
      const b = S.background; if (b.fluid === undefined) b.fluid = (b.mode !== 'static');
      const SKINS = [
        ['vinyl', '经典黑胶', '<span class="sk-vinyl"></span>'],
        ['square', '简约方形', '<span class="sk-square"></span>'],
        ['lyrics', '简约歌词', '<span class="sk-lyr"><i></i><i></i><i></i></span>'],
      ];
      const VIZ = [['off', '无频谱'], ['classic', '经典'], ['wave', '梦幻波浪'], ['lines', '动感线条'],
        ['columns', '魔幻光柱'], ['flame', '热情火焰'], ['radial', '旋转音波'], ['particles', '旋转粒子']];
      const BGS = [['#101014', '纯黑'], ['#0f1428', '深蓝'], ['#231536', '暗紫'], ['#0d2417', '墨绿'], ['#2a151c', '酒红'], ['#262012', '暗金']];
      // 简约歌词皮肤恒居中，不显示歌词版式选项
      const showAlign = ps.skin !== 'lyrics';
      panel.innerHTML = `
        <div class="nsp-head">播放器样式<button class="nsp-x" title="关闭">×</button></div>
        <div class="nsp-body">
          <div class="nsp-skins">${SKINS.map(([k, n, pv]) => `<div class="nsp-card ${ps.skin === k ? 'active' : ''}" data-k="${k}"><div class="nsp-prev">${pv}</div><div class="nsp-name">${n}</div></div>`).join('')}</div>
          <div class="lbl">背景颜色（默认自动跟随专辑取色）</div>
          <div class="nsp-sw"><span class="bg-sw sw-auto ${ps.bg === 'auto' ? 'active' : ''}" data-c="auto" title="自动（专辑取色）"></span>${BGS.map(([c, n]) => `<span class="bg-sw ${ps.bg === c ? 'active' : ''}" data-c="${c}" title="${n}" style="background:${c}"></span>`).join('')}</div>
          ${showAlign ? `<div class="lbl">歌词版式</div>
          <div class="nsp-row" id="nspAlign"><button data-v="left" class="${ps.lyricAlign === 'left' ? 'active' : ''}">居左</button><button data-v="center" class="${ps.lyricAlign === 'center' ? 'active' : ''}">居中</button></div>` : ''}
          <div class="lbl">频谱样式</div>
          <div class="nsp-row" id="nspViz">${VIZ.map(([k, n]) => `<button data-v="${k}" class="${ps.viz === k ? 'active' : ''}">${n}</button>`).join('')}</div>
          <div class="lbl">流体动画（背景光斑流动）</div>
          <div class="nsp-row" id="nspFluid"><button data-v="1" class="${b.fluid ? 'active' : ''}">开</button><button data-v="0" class="${b.fluid ? '' : 'active'}">关</button></div>
        </div>`;
      const apply = () => { saveSettings(); if (np.applyStyle) np.applyStyle(); };
      panel.querySelector('.nsp-x').onclick = () => { panel.classList.remove('show'); if (btn) btn.classList.remove('active'); };
      panel.querySelectorAll('.nsp-card').forEach(c => c.onclick = () => { ps.skin = c.dataset.k; apply(); render(); });
      panel.querySelectorAll('.bg-sw').forEach(s => s.onclick = () => { ps.bg = s.dataset.c; apply(); render(); });
      panel.querySelectorAll('#nspAlign button').forEach(bn => bn.onclick = () => { ps.lyricAlign = bn.dataset.v; apply(); render(); });
      panel.querySelectorAll('#nspViz button').forEach(bn => bn.onclick = () => { ps.viz = bn.dataset.v; apply(); render(); });
      panel.querySelectorAll('#nspFluid button').forEach(bn => bn.onclick = () => {
        b.fluid = bn.dataset.v === '1'; b.mode = b.fluid ? 'fluid' : 'static';
        applyBackground(b); saveSettings(); render();
      });
    }
    panel.addEventListener('click', (e) => e.stopPropagation());
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !panel.classList.contains('show');
      panel.classList.toggle('show', open);
      btn.classList.toggle('active', open);
      if (open) {
        render();
        if (np.closeQueue) np.closeQueue();
        if (window.Comments) window.Comments.close();
        document.querySelectorAll('.tg-panel.open').forEach(el => el.classList.remove('open'));   // 与一起听面板互斥
      }
    });
    // 点面板外任意处关闭（按钮/面板内部已 stopPropagation）
    np.el.addEventListener('click', (e) => {
      if (e.target.closest('.np-style-panel, .np-style-btn')) return;
      panel.classList.remove('show'); if (btn) btn.classList.remove('active');
    });
    // 调试：?sp=1 自动打开（配合 ?np=1 无头截图）
    if (/[?&]sp=1\b/.test(location.search)) setTimeout(() => { panel.classList.add('show'); render(); }, 1400);
  })();

  // ---------------- 启动 ----------------
  // ── 安卓原生媒体控制桥接 ─────────────────────────────────────────────
  // <audio> 在 WebView 内播放，系统锁屏/通知/媒体键控制需要原生前台服务承载。
  // 这里把歌曲元数据/播放状态/进度推给 Rust(再经 JNI 给前台服务)，并监听原生回传
  // 的控制命令来操作播放器。仅在安卓原生壳(ANDROID 非 null)下生效。
  function setupAndroidMedia() {
    if (!ANDROID) return;
    const p = window.player;
    if (!p || !p.on) return;
    const ev = ANDROID.event;
    const emit = (name, payload) => { try { ev.emit(name, payload); } catch (e) {} };
    let _andPosT = 0, _andDurSent = false;

    const durOf = () => {
      const d = p.audio && p.audio.duration;
      return (typeof d === 'number' && isFinite(d) && d > 0) ? d : (p.duration || 0);
    };
    const pushNow = () => {
      const s = p.currentSong; if (!s) return;
      emit('and-now', {
        title: s.name || '未知歌曲',
        artist: s.artists || '',
        album: s.album || 'Anon Music',
        cover: s.picUrl || '',
        duration: durOf(),
      });
    };
    const pushState = () => emit('and-state', { playing: !!(p.audio && !p.audio.paused) });
    // 我喜欢：把当前歌的收藏状态同步给媒体卡片爱心。
    const emitLiked = () => {
      const lib = window.Library;
      if (lib && p.currentSong) emit('and-liked', { liked: !!lib.isLiked(p.currentSong.id) });
    };
    // 包裹 toggleLike：无论从卡片还是 App 内点收藏，都回传卡片更新爱心。
    if (window.Library && typeof window.Library.toggleLike === 'function' && !window.Library._andWrapped) {
      const _orig = window.Library.toggleLike.bind(window.Library);
      window.Library.toggleLike = async function (song) { const r = await _orig(song); emitLiked(); return r; };
      window.Library._andWrapped = true;
    }

    p.on('songchange', () => { _andDurSent = false; pushNow(); pushState(); emitLiked(); });
    p.on('playstate', () => pushState());
    // App 外悬浮歌词：每首歌词加载好就整段下发（开启时）
    p.on('lyricsloaded', () => { if (androidLyricsOn()) pushAndroidLyricData(); });
    p.on('timeupdate', (d) => {
      const dur = (d && d.duration) || durOf();
      // 时长首次确定后补发一次 now-playing，保证锁屏进度条总时长正确。
      if (!_andDurSent && isFinite(dur) && dur > 0) { _andDurSent = true; pushNow(); }
      const t = Date.now();
      if (t - _andPosT < 1000) return;   // 进度 1 秒上报一次足够
      _andPosT = t;
      emit('and-pos', { position: (d && d.currentTime) || (p.audio && p.audio.currentTime) || 0, duration: isFinite(dur) ? dur : 0 });
    });

    // 原生(通知按钮 / 锁屏 / 蓝牙媒体键) → 操作 <audio>
    ev.listen('and-ctl', (e) => {
      const a = e.payload;
      if (a === 'play') p.play && p.play();
      else if (a === 'pause' || a === 'stop') p.pause && p.pause();
      else if (a === 'playpause') p.togglePlay && p.togglePlay();   // 悬浮歌词工具条的播放/暂停
      else if (a === 'next') p.nextSong && p.nextSong();
      else if (a === 'prev') p.previousSong && p.previousSong();
      else if (a === 'like') { if (window.Library && p.currentSong) window.Library.toggleLike(p.currentSong); }
      else if (a === 'lyrics') { if (window.DeskLyric) window.DeskLyric.toggle(); }
      else if (a === 'lyriclock' || a === 'lyricunlock') {
        // 悬浮歌词工具条/媒体卡片改了锁定：原生已即时生效，这里仅同步设置状态
        const d = window.AppSettings.desktopLyrics; d.locked = (a === 'lyriclock'); saveSettings();
        if (setModal.classList.contains('open')) { const _db = setModal.querySelector('#sec-desktop .set-sec-body'); if (_db) renderSection('desktop', _db); }
      }
    });
    ev.listen('and-seek', (e) => {
      const secs = e.payload;
      if (typeof secs === 'number' && p.audio && isFinite(p.audio.duration)) p.audio.currentTime = secs;
    });

    // 启动时若已有当前歌曲，立即同步一次。
    if (p.currentSong) { pushNow(); pushState(); emitLiked(); }
    // 启动时把「词」按钮状态告诉媒体卡片。
    androidEmit('and-lyrics-active', { active: androidLyricsOn() });
    // 启动时下发悬浮歌词样式与锁定状态（原生 prefs 已持久化，这里对齐 web 设置为准）。
    pushAndroidLyricStyle();
    androidEmit('and-lyric-lock', { locked: !!(window.AppSettings.desktopLyrics || {}).locked });
    // 启动时若悬浮歌词开关是开的，告知原生并下发当前歌词。
    if (androidLyricsOn()) { androidEmit('and-lyric-show', { show: true }); pushAndroidLyricData(); }
  }

  // ---------------- 未登录数据共享提醒（首页悬浮小字） ----------------
  function setupGuestHint() {
    if (me) return;   // 已登录不显示
    try { if (sessionStorage.getItem('guestHintDismissed') === '1') return; } catch (_) {}
    if (document.getElementById('guestHint')) return;
    const el = document.createElement('div');
    el.className = 'guest-hint'; el.id = 'guestHint';
    el.innerHTML = `<span class="gh-ico">ⓘ</span><span class="gh-tx">未登录状态下，收藏 / 歌单 / 播放记录为<b>公共共享</b>数据，<a class="gh-login">登录</a>后独立保存</span><button class="gh-x" title="知道了">×</button>`;
    document.body.appendChild(el);
    const onHome = () => { const h = location.hash || '#/discover'; return h === '' || h === '#/' || h === '#/discover'; };
    const sync = () => el.classList.toggle('show', !me && onHome());
    el.querySelector('.gh-x').onclick = () => { try { sessionStorage.setItem('guestHintDismissed', '1'); } catch (_) {} el.remove(); };
    el.querySelector('.gh-login').onclick = () => openAuth('login');
    window.addEventListener('hashchange', sync);
    sync();
  }

  async function boot() {
    // 鉴权状态
    try { const r = await api('/api/auth/me'); me = r.data; } catch (e) {}
    window.AppUser = me;
    renderAccount();
    setupGuestHint();
    // 设置
    try { const r = await api('/api/settings'); if (r.data) window.AppSettings = Object.assign(window.AppSettings, r.data); } catch (e) {}
    // 服务器存的旧设置可能缺新字段（scheme/align/opacity/shadow）→ 深合并补默认值。
    // 旧版只有 color 没有 scheme 的用户：迁移为 custom 方案，保留他们的自定义颜色不被 green 覆盖。
    const _savedDesk = window.AppSettings.desktopLyrics || {};
    const _legacyColor = !_savedDesk.scheme && _savedDesk.color && String(_savedDesk.color).toLowerCase() !== '#ffffff';
    window.AppSettings.desktopLyrics = Object.assign({}, DESK_DEFAULTS, _savedDesk);
    if (_legacyColor) window.AppSettings.desktopLyrics.scheme = 'custom';
    window.AppSettings.playerStyle = Object.assign({}, PS_DEFAULTS, window.AppSettings.playerStyle || {});
    if (window.AppSettings.playerStyle.skin === 'vinyl-color') window.AppSettings.playerStyle.skin = 'vinyl';   // 透明彩胶已下线：写回真值，否则面板无高亮 + 脏值被回存
    // 主题：服务器设置为准（跨设备同步），theme.js 已先按 localStorage 预置防闪；
    // ?theme= 调试参数（Theme.locked）优先，不被覆盖
    if (window.Theme && !window.Theme.locked && window.AppSettings.theme) window.Theme.set(window.AppSettings.theme);
    applyAll();
    // 安卓不走页内歌词条（原生悬浮窗由 setupAndroidMedia 的 and-lyric-show 恢复），否则双重歌词
    if (window.AppSettings.desktopLyrics && window.AppSettings.desktopLyrics.enabled && !ANDROID) showDeskBar();
    // 原生悬浮歌词窗口的工具条回控（上一句/下一句/关闭）
    if (TAURI) {
      try {
        TAURI.event.listen('lyrics-ctl', (e) => {
          const pl = e.payload || {}, a = pl.action, p = window.player, d = window.AppSettings.desktopLyrics;
          if (a === 'next') { p && p.nextSong && p.nextSong(); }
          else if (a === 'prev') { p && p.previousSong && p.previousSong(); }
          else if (a === 'playpause') { p && p.togglePlay && p.togglePlay(); }
          else if (a === 'fontUp') { d.fontSize = Math.min(72, (d.fontSize || 18) + 2); saveSettings(); }
          else if (a === 'fontDown') { d.fontSize = Math.max(12, (d.fontSize || 18) - 2); saveSettings(); }
          else if (a === 'fontSet') { const v = +pl.value; if (isFinite(v)) { d.fontSize = Math.max(12, Math.min(72, v)); saveSettings(); } }
          else if (a === 'rows') { d.doubleRow = (pl.value === 'double'); saveSettings(); }
          // v2 新增：配色方案/对齐/投影/不透明度（歌词窗设置面板回传，主窗持久化到服务器设置）
          else if (a === 'scheme') { if (LYRIC_SCHEMES[pl.value] || pl.value === 'custom') { d.scheme = pl.value; saveSettings(); } }
          else if (a === 'align') { if (['left', 'center', 'right'].indexOf(pl.value) >= 0) { d.align = pl.value; saveSettings(); } }
          else if (a === 'shadow') { if (['off', 'soft', 'strong'].indexOf(pl.value) >= 0) { d.shadow = pl.value; saveSettings(); } }
          else if (a === 'opacity') { const v = +pl.value; if (isFinite(v)) { d.opacity = Math.max(.3, Math.min(1, v)); saveSettings(); } }
          else if (a === 'off') { if (d && d.enabled) { d.enabled = false; hideDeskBar(); saveSettings(); } }
        });
        // 全局快捷键（新壳 v0.6+ 注册 Ctrl+Alt+P/←/→/L → gs-ctl；旧壳不会发，监听无害）
        TAURI.event.listen('gs-ctl', (e) => {
          const a = ((e.payload || {}).action) || '';
          const p = window.player;
          if (a === 'playpause') { p && p.togglePlay && p.togglePlay(); }
          else if (a === 'prev') { p && p.previousSong && p.previousSong(); }
          else if (a === 'next') { p && p.nextSong && p.nextSong(); }
          else if (a === 'lyrics') { window.DeskLyric && window.DeskLyric.toggle(); }
          else if (a === 'like') { if (window.Library && p && p.currentSong) window.Library.toggleLike(p.currentSong); }
          else if (a === 'settings') { const b = document.getElementById('settingsBtn'); if (b) b.click(); }
        });
        // 启动时把"关闭=最小化托盘"偏好告诉 Rust（默认开）
        try { TAURI.event.emit('set-close-tray', { value: localStorage.getItem('closeToTray') !== '0' }); } catch (e) {}
      } catch (e) {}
    }
    // 跟随封面背景：歌曲切换时更新
    if (window.player && window.player.on) {
      window.player.on('songchange', () => { if (window.AppSettings.background.mode === 'cover') applyBackground(window.AppSettings.background); });
    }
    // 安卓原生媒体控制桥接（锁屏/通知/媒体键）
    setupAndroidMedia();
    // 调试：?np=1 自动打开全屏播放页（无头浏览器截图用，正常用户不会带这个参数）
    if (/[?&]np=1\b/.test(location.search)) setTimeout(() => { try { window.NowPlaying && window.NowPlaying.open(); } catch (e) {} }, 1600);
  }
  boot();
})();
