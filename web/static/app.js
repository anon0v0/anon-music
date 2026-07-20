/* 深色整页播放器控制器 —— 复用 window.player 引擎 + window.NowPlaying 全屏歌词 + 服务端库 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const view = $('#view');

  const ICONS = {
    discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-4 0 2-6z" fill="currentColor"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="10" width="4" height="10"/><rect x="10" y="4" width="4" height="16"/><rect x="16" y="13" width="4" height="7"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h13v2H4zm0 5h13v2H4zm0 5h9v2H4zm15-9l3 4-3 4z"/></svg>',
    qadd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h13M3 12h13M3 18h7"/><path d="M18 13v8M14 17h8"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    heartF: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  };

  // ---------- 工具 ----------
  // 无封面/封面加载失败的占位图（深色方块 + 音符），避免浏览器裂图
  const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#26262f"/><path d="M52 36v30a9 9 0 1 1-5-8V44l26-6v26a9 9 0 1 1-5-8V32z" fill="#5b5b66"/></svg>');
  window.IMG_PLACEHOLDER = IMG_PLACEHOLDER;
  // 把 http 图片地址升级为 https：安卓 WebView 默认拦截 https 页面里的 http 图(混合内容)，
  // 导致部分封面加载不出来（PC 的 WebView2 会自动升级所以正常）。126.net / y.qq.com 等 CDN 均支持 https。
  const httpsify = (u) => (typeof u === 'string' && u.indexOf('http://') === 0) ? ('https://' + u.slice(7)) : u;
  window.httpsify = httpsify;
  // 全局：<img> 加载失败 → 先尝试升级到 https 重试，仍失败再换占位图（兜底，连背景图之外的都覆盖）
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.src !== IMG_PLACEHOLDER) {
      if (t.src.indexOf('http://') === 0) t.src = httpsify(t.src);
      else t.src = IMG_PLACEHOLDER;
    }
  }, true);
  const fmtDur = (s) => { s = Math.floor(s || 0); if (!s) return '-'; const m = Math.floor(s / 60); const ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; };
  // 播放栏进度时间专用：无歌/时长未知时显示 0:00（不用 '-'）
  const fmtTime = (s) => { s = Math.floor(s || 0); if (s < 0) s = 0; const m = Math.floor(s / 60); const ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; };
  const fmtCount = (n) => { n = +n || 0; if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'; if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万'; return String(n); };
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; };
  const picOf = (s) => esc(httpsify(s.pic || s.picUrl) || IMG_PLACEHOLDER);
  async function api(path, opts) {
    const r = await fetch(path, opts);
    return r.json();
  }
  // 统一通知/确认框：替代浏览器原生 alert/confirm/prompt。
  let _noticeT = null;
  function notice(msg, type = 'info', ms = 2600) {
    let el = document.getElementById('appNotice');
    if (!el) { el = document.createElement('div'); el.id = 'appNotice'; el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true'); el.innerHTML = '<i></i><span></span><button aria-label="关闭">×</button>'; document.body.appendChild(el); el.querySelector('button').onclick = () => el.classList.remove('show'); }
    el.setAttribute('role', type === 'error' ? 'alert' : 'status'); el.className = `app-notice ${type}`; el.querySelector('span').textContent = msg || '操作失败'; el.classList.add('show');
    clearTimeout(_noticeT); if (ms > 0) _noticeT = setTimeout(() => el.classList.remove('show'), ms);
  }
  function appConfirm({ title = '请确认', message = '', okText = '确定', danger = false, value = null, placeholder = '', maxLength = 60 } = {}) {
    return new Promise(resolve => {
      let mask = document.getElementById('appConfirm');
      if (!mask) { mask = document.createElement('div'); mask.id = 'appConfirm'; mask.className = 'confirm-mask'; document.body.appendChild(mask); }
      const previousFocus = document.activeElement;
      mask.innerHTML = `<div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmDesc"><h3 id="appConfirmTitle">${esc(title)}</h3><p id="appConfirmDesc">${esc(message)}</p>${value !== null ? `<input maxlength="${maxLength}" placeholder="${esc(placeholder)}">` : ''}<div class="confirm-actions"><button data-a="cancel">取消</button><button data-a="ok" class="${danger ? 'danger' : 'ok'}">${esc(okText)}</button></div></div>`;
      const input = mask.querySelector('input'); if (input) input.value = value || '';
      let done = false; const finish = v => { if (done) return; done = true; mask.classList.remove('show'); document.querySelector('.layout')?.removeAttribute('inert'); if (previousFocus && previousFocus.focus) setTimeout(() => previousFocus.focus(), 0); resolve(v); };
      mask.querySelector('[data-a="cancel"]').onclick = () => finish(value !== null ? null : false);
      mask.querySelector('[data-a="ok"]').onclick = () => finish(value !== null ? ((input.value || '').trim() || null) : true);
      mask.onclick = e => { if (e.target === mask) finish(value !== null ? null : false); };
      mask.onkeydown = e => { if (e.key === 'Escape') finish(value !== null ? null : false); if (e.key === 'Enter' && input) mask.querySelector('[data-a="ok"]').click(); if (e.key === 'Tab') { const focusable = [...mask.querySelectorAll('button,input')]; if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } };
      document.querySelector('.layout')?.setAttribute('inert', ''); mask.classList.add('show'); setTimeout(() => (input || mask.querySelector('[data-a="ok"]')).focus(), 30);
    });
  }
  window.appNotice = notice; window.appConfirm = appConfirm;
  const srcOf = (s) => (s.sources && s.sources[0]) || ((s.id || '').startsWith('qq:') ? 'qq' : 'netease');
  const badge = (s) => srcOf(s) === 'qq' ? '<span class="badge qq">QQ</span>' : '<span class="badge ncm">网易</span>';
  // artists 现在可能是数组（P5 norm 加了 artists:[{id,name}]）——转字符串统一在这兜底
  function artistStr(s) {
    if (s.artist) return s.artist;
    if (Array.isArray(s.artists)) return s.artists.map(a => a && a.name || '').filter(Boolean).join(', ');
    return s.artists || '';
  }
  // 保留带 id 的 artists 数组（供歌手名可点跳歌手页）；无 id 的丢弃
  function artistArr(s) {
    if (Array.isArray(s.artists) && s.artists.length && s.artists[0] && s.artists[0].id) return s.artists;
    if (Array.isArray(s.artistList) && s.artistList.length && s.artistList[0] && s.artistList[0].id) return s.artistList;
    return null;
  }
  function toEngine(s) {
    const o = { id: s.id, name: s.name, artists: artistStr(s), album: s.album || '', picUrl: s.pic || s.picUrl || '', url: null, duration: s.duration || 0 };
    const arr = artistArr(s); if (arr) o.artistList = arr;   // 引擎只用 artists 字符串，artistList 透传给全屏页做可点歌手
    // 本地音乐：保留 blob URL（否则引擎无 mid 可请求）；loadSongUrl 的 local: 分支还会从 LocalMusic 兜底
    if (String(s.id || '').indexOf('local:') === 0) { o.url = s.url || s._localUrl || null; o._localUrl = s._localUrl || s.url || null; }
    return o;
  }
  function toStore(s) {
    const o = {
      id: s.id, name: s.name, artist: artistStr(s), pic: s.pic || s.picUrl || '',
      album: s.album || '', duration: s.duration || 0,
      sources: s.sources || [(s.id || '').startsWith('qq:') ? 'qq' : 'netease'],
    };
    const arr = artistArr(s); if (arr) o.artists = arr;   // 存回带 id 的歌手数组 → 最近播放/我喜欢/听歌报告可点跳歌手页
    return o;
  }

  // ---------- 服务端库 ----------
  const Library = {
    likedSet: new Set(),
    playlists: [],
    async init() { await Promise.all([this.refreshLiked(), this.refreshPlaylists(), this.refreshFavPlaylists()]); },
    async refreshLiked() {
      const r = await api('/api/library/liked');
      this.likedSet = new Set((r.data || []).map(s => s.id));
    },
    isLiked(id) { return this.likedSet.has(id); },
    async toggleLike(song) {
      const id = song.id;
      if (this.likedSet.has(id)) {
        await api('/api/library/liked?mid=' + encodeURIComponent(id), { method: 'DELETE' });
        this.likedSet.delete(id);
      } else {
        await api('/api/library/liked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toStore(song)) });
        this.likedSet.add(id);
      }
      refreshLikedUI();
    },
    async addRecent(song) {
      try { await api('/api/library/recent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toStore(song)) }); } catch (e) {}
    },
    async refreshPlaylists() {
      const r = await api('/api/library/playlists');
      this.playlists = r.data || [];
      renderSidebarPlaylists();
    },
    favPlaylists: [],
    async refreshFavPlaylists() {
      try { const r = await api('/api/library/fav_playlists'); this.favPlaylists = r.data || []; } catch (e) { this.favPlaylists = []; }
      renderSidebarFav();
    },
    async createPlaylist(name) {
      const r = await api('/api/library/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      await this.refreshPlaylists();
      return r.data;
    },
    async addToPlaylist(pid, song) {
      await api('/api/library/playlists/' + pid + '/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toStore(song)) });
    },
  };
  window.Library = Library;

  function refreshLikedUI() {
    $$('[data-like-id]').forEach(b => {
      const liked = Library.isLiked(b.dataset.likeId);
      b.classList.toggle('liked', liked);
      b.innerHTML = liked ? ICONS.heartF : ICONS.heart;
    });
    const cur = window.player && window.player.currentSong;
    const pl = $('#pbLike');
    if (cur) { pl.dataset.likeId = cur.id; pl.classList.toggle('liked', Library.isLiked(cur.id)); }
  }

  // ---------- 播放 ----------
  let state = { currentId: null };
  function playSongs(songs, index, opts) {
    if (!songs || !songs.length) return;
    if (!opts || !opts.keepFM) fmMode = false;   // 播放非 FM 内容 = 退出私人FM电台
    const list = songs.map(toEngine);
    const start = index || 0;
    const p = window.player;
    // FM 启动强制替换队列（append 模式下把电台歌插进旧列表没有意义）
    const mode = (opts && opts.replace) ? 'replace'
      : ((window.AppSettings && window.AppSettings.queueMode) || 'replace');
    // 追加模式：不清空当前列表，把新内容插到当前歌曲之后，跳到所选歌曲播放，原列表其余保留在其后
    if (mode === 'append' && p && p.playlist && p.playlist.length) {
      const insertAt = (p.currentIndex || 0) + 1;
      p.playlist.splice(insertAt, 0, ...list);
      p.playQQMusicPlaylist(p.playlist, insertAt + start);
      return;
    }
    p.playQQMusicPlaylist(list, start);
  }
  function markPlaying() {
    $$('.song-row').forEach(r => r.classList.toggle('playing', r.dataset.id === state.currentId));
  }
  // 队列为空时点播放 → 随机挑一个歌单/榜单播放（优先用页面上已有的卡片）
  let _randomBusy = false;
  async function playRandom() {
    if (_randomBusy) return; _randomBusy = true;
    try {
      const cands = [];
      $$('.cslide[data-id]').forEach(s => cands.push({ source: s.dataset.source, id: s.dataset.id, kind: 'playlist' }));
      $$('.card[data-kind]').forEach(c => cands.push({ source: c.dataset.source, id: c.dataset.id, kind: c.dataset.kind }));
      let pick = cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
      if (!pick) {
        const src = Math.random() < 0.5 ? 'netease' : 'qq';
        const r = await api(`/api/recommend/playlists?source=${src}&limit=20`);
        const list = r.data || [];
        if (list.length) { const p = list[Math.floor(Math.random() * list.length)]; pick = { source: p.source, id: p.id, kind: 'playlist' }; }
      }
      if (!pick) return;
      const ep = pick.kind === 'chart' ? '/api/chart/detail' : (pick.kind === 'album' ? '/api/album/detail' : '/api/playlist/detail');
      const d = await api(`${ep}?source=${pick.source}&id=${encodeURIComponent(pick.id)}`);
      const songs = (d.data && d.data.songs) || [];
      if (songs.length) playSongs(songs, Math.floor(Math.random() * songs.length));
    } catch (e) {} finally { _randomBusy = false; }
  }
  window.playRandom = playRandom;
  const queueEmpty = () => { const p = window.player; return !p || !p.currentSong || !p.playlist || !p.playlist.length; };
  window.queueEmpty = queueEmpty;
  async function downloadSong(s, btn) {
    if (btn && btn.classList.contains('busy')) return;
    const q = (window.player && window.player.quality) || 'standard';
    const ext = (q === 'flac' || q === 'master') ? 'flac' : 'mp3';
    if (btn) { btn.classList.add('busy'); btn.innerHTML = '…'; }
    try {
      const r = await api('/api/song_url?mid=' + encodeURIComponent(s.id) + '&quality=' + q);
      if (!r || r.code !== 0 || !r.url) { throw new Error('no url'); }
      const artistName = String(artistStr(s) || '').trim();
      const fname = `${artistName ? artistName + ' - ' : ''}${String(s.name || 'song').trim()}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
      // P6：统一投递到下载中心（按平台走 浏览器Blob / PC原生 / 安卓系统下载），#/downloads 可看进度
      // 传 mid+quality 供失败重试时重新解析 CDN 直链（旧直链有签名时效）
      if (window.DownloadCenter) { window.DownloadCenter.add(s, r.url, fname, { mid: s.id, quality: q }); return; }
      // r.url 现在是官方 CDN 直链（QQ/网易都直连，不经服务器）。浏览器内直连 CDN 取流→Blob 保存：
      // 下载流量不过本服务器、同时保留正确文件名（QQ/网易 CDN 均 CORS 全开，fetch 可跨域读取）。
      try {
        const resp = await fetch(r.url);
        if (!resp.ok) throw new Error('http ' + resp.status);
        const blob = await resp.blob();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj; a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(obj), 60000);
      } catch (err) {
        console.warn('直连下载失败:', err);
        throw err;  // 交给外层 catch 弹「下载失败」提示
        // ===== 回退（按要求先注释；直连下载出问题时：删掉上面那行 throw、并取消注释下面，即恢复经服务器 /api/download 代理下载，安卓也用它兜底）=====
        // const a = document.createElement('a');
        // a.href = '/api/download?url=' + encodeURIComponent(r.url) + '&filename=' + encodeURIComponent(fname);
        // a.download = fname;
        // document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) {
      notice('下载失败：歌曲可能受版权限制，或当前音质不可用', 'error', 4200);
    } finally {
      if (btn) { btn.classList.remove('busy'); btn.innerHTML = ICONS.download; }
    }
  }

  // ---------- 轻量 toast ----------
  let _toastT = null;
  function toast(msg) {
    let el = document.getElementById('appToast');
    if (!el) { el = document.createElement('div'); el.id = 'appToast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove('show'), 1800);
  }
  window.toast = toast;

  // 加入播放列表（追加到队尾，不打断当前播放；空队列直接开播）
  function addToQueue(s) {
    const p = window.player; if (!p) return;
    if (window.__togetherFollowing) { toast('跟随房主中，暂不能加入播放列表'); return; }   // 否则房主歌曲结束时会脱离同步强播自己的歌
    if (!p.playlist || !p.playlist.length) { playSongs([s], 0); toast('已开始播放'); return; }
    if (p.playlist.some(x => x.id === s.id)) { toast('已在播放列表中'); return; }
    p.playlist.push(toEngine(s));
    if (window.Queue) window.Queue.save();
    if ($('#queuePanel').classList.contains('open')) renderQueue();
    toast('已加入播放列表');
  }

  // ---------- 渲染：歌曲列表 ----------
  // 歌手名可点：带 id 的 artists 数组 → 歌手页；否则（旧库存/纯字符串）→ 可点搜索该歌手
  function artistLinks(s) {
    const arr = Array.isArray(s.artists) ? s.artists : null;
    if (arr && arr.length && arr[0] && arr[0].id) return arr.map(a =>
      `<span class="artist-link" data-aid="${esc(a.id)}">${esc(a.name)}</span>`).join('<span class="ar-sep">, </span>');
    const txt = artistStr(s);
    return txt ? `<span class="ar-search" title="搜索该歌手">${esc(txt)}</span>` : '';
  }
  function songRow(s, i, ctx) {
    const liked = Library.isLiked(s.id);
    return `<div class="song-row ${ctx && ctx.manage ? 'manageable' : ''}" data-id="${esc(s.id)}" data-i="${i}">
      <div class="idx"><span class="row-number">${i + 1}</span>${ctx && ctx.manage ? `<input class="song-check" type="checkbox" aria-label="选择 ${esc(s.name)}"><span class="drag-handle" title="拖动排序">⋮⋮</span>` : ''}</div>
      <img class="rc" loading="lazy" src="${picOf(s)}" alt="">
      <div class="ti"><div class="nm">${badge(s)}${esc(s.name)}</div><div class="ar">${artistLinks(s)}</div></div>
      <div class="al">${esc(s.album || '')}</div>
      <div class="act">
        <button class="iconbtn like ${liked ? 'liked' : ''}" data-like-id="${esc(s.id)}" title="喜欢">${liked ? ICONS.heartF : ICONS.heart}</button>
        <button class="iconbtn qadd" title="加入播放列表">${ICONS.qadd}</button>
        <button class="iconbtn dl" title="下载">${ICONS.download}</button>
        <button class="iconbtn addpl" title="加入歌单">${ICONS.plus}</button>
        ${ctx && ctx.removable ? `<button class="iconbtn rm" title="移出">${ICONS.trash}</button>` : ''}
        <span class="dur">${fmtDur(s.duration)}</span>
      </div>
    </div>`;
  }
  function bindSongList(container, songs, ctx) {
    container.querySelectorAll('.song-row').forEach(row => {
      const i = +row.dataset.i; const s = songs[i];
      row.addEventListener('click', (e) => {
        if (e.target.closest('button,input,.drag-handle,a')) return;
        const current = songs.findIndex(x => String(x.id) === String(row.dataset.id));
        playSongs(songs, current >= 0 ? current : i);
      });
      const like = row.querySelector('.like');
      like && like.addEventListener('click', () => Library.toggleLike(s));
      const add = row.querySelector('.addpl');
      add && add.addEventListener('click', () => openAddModal(s));
      const qa = row.querySelector('.qadd');
      qa && qa.addEventListener('click', () => addToQueue(s));
      const dl = row.querySelector('.dl');
      dl && dl.addEventListener('click', () => downloadSong(s, dl));
      const rm = row.querySelector('.rm');
      rm && rm.addEventListener('click', async () => { const ok = await appConfirm({ title: '移出歌曲', message: `确定从歌单移出「${s.name}」吗？`, okText: '移出', danger: true }); if (ok) { await ctx.onRemove(s); row.remove(); notice('已移出歌单'); } });
      if (ctx && ctx.manage) {
        row.addEventListener('dragstart', e => { if (!container.classList.contains('batch-mode')) { e.preventDefault(); return; } row.classList.add('dragging'); });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', e => { e.preventDefault(); const dragging = container.querySelector('.dragging'); if (dragging && dragging !== row) container.querySelector('.songlist').insertBefore(dragging, row); });
        row.addEventListener('drop', async e => { e.preventDefault(); if (!container.classList.contains('batch-mode')) return; const rows = [...container.querySelectorAll('.song-row')], mids = rows.map(x => x.dataset.id); try { await ctx.onReorder(mids); const byId = new Map(songs.map(s2 => [String(s2.id), s2])); songs.splice(0, songs.length, ...mids.map(mid => byId.get(String(mid))).filter(Boolean)); rows.forEach((x, index) => { x.dataset.i = String(index); const n = x.querySelector('.row-number'); if (n) n.textContent = String(index + 1); }); notice('歌单顺序已保存'); } catch (err) { notice('排序保存失败，正在恢复', 'error'); renderMyPlaylist(ctx.playlistId); } });
      }
      // 无 id 的歌手（旧库存/纯字符串）→ 搜索该歌手
      row.querySelectorAll('.ar-search').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = (el.textContent || '').split(/[\/、,]/)[0].trim();
        if (q) location.hash = '#/search/' + encodeURIComponent(q);
      }));
      // 歌手名 → 歌手主页
      row.querySelectorAll('.artist-link').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation();
        const aid = el.dataset.aid || ''; const p2 = aid.indexOf(':');
        if (p2 > 0) location.hash = `#/artist/${aid.slice(0, p2)}/${encodeURIComponent(aid.slice(p2 + 1))}`;
      }));
    });
    markPlaying();
  }
  function renderSongList(songs, ctx) {
    if (!songs.length) return '<div class="empty-tip">这里还没有歌曲</div>';
    const head = `<div class="song-head"><div class="idx">#</div><div></div><div>标题</div><div class="al">专辑</div><div class="dur-h">时长</div></div>`;
    return `<div class="songlist">${head}${songs.map((s, i) => songRow(s, i, ctx)).join('')}</div>`;
  }

  // ---------- 渲染：卡片 ----------
  function card(item, kind) {
    const isPl = kind !== 'chart';
    const sub = kind === 'chart' ? (item.desc || '')
      : (item.creator ? (item.creator + (item.songCount ? ' · ' + item.songCount + '首' : ''))
        : (item.songCount ? item.songCount + ' 首' : (item.desc || '')));
    const countBadge = (isPl && item.playCount) ? `<span class="cover-count">${ICONS.play}${fmtCount(item.playCount)}</span>` : '';
    return `<div class="card" role="link" tabindex="0" aria-label="${esc(item.name || '打开歌单')}" data-kind="${kind}" data-source="${item.source}" data-id="${esc(String(item.id))}">
      <div class="cover"><img loading="lazy" decoding="async" src="${esc(httpsify(item.cover) || IMG_PLACEHOLDER)}" alt="">${countBadge}
        <div class="play-fab">${ICONS.play}</div></div>
      <div class="name">${item.source === 'qq' ? '<span class="badge qq">QQ</span>' : '<span class="badge ncm">网易</span>'}${esc(item.name)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>`;
  }
  function bindCards(container) {
    container.querySelectorAll('.card').forEach(c => {
      if (!c.dataset.kind) return;             // 特殊卡（每日推荐/私人FM）自带 onclick，不走通用路由
      if (c._bound) return; c._bound = true;   // 幂等：避免重复绑定（rec 网格单独刷新时）
      const kind = c.dataset.kind, source = c.dataset.source, id = c.dataset.id;
      const route = kind === 'chart' ? `#/chart/${source}/${id}` : (kind === 'album' ? `#/album/${source}/${id}` : `#/playlist/${source}/${id}`);
      c.addEventListener('click', (e) => {
        if (e.target.closest('.play-fab')) { e.stopPropagation(); loadAndPlay(kind, source, id); return; }
        location.hash = route;
      });
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = route; }
      });
    });
  }
  async function loadAndPlay(kind, source, id) {
    const ep = kind === 'chart' ? '/api/chart/detail' : (kind === 'album' ? '/api/album/detail' : '/api/playlist/detail');
    const r = await api(`${ep}?source=${source}&id=${encodeURIComponent(id)}`);
    const songs = (r.data && r.data.songs) || [];
    playSongs(songs, 0);
  }

  // ---------- 视图 ----------
  async function renderDiscover() {
    const g = navGen;
    view.innerHTML = '<div class="loading">加载发现页…</div>';
    const [ncmRec, qqRec, ncmTop, qqTop] = await Promise.all([
      api('/api/recommend/playlists?source=netease&limit=28'),
      api('/api/recommend/playlists?source=qq&limit=28'),
      api('/api/charts?source=netease'),
      api('/api/charts?source=qq'),
    ]);
    if (g !== navGen) return;
    const qq = (qqRec.data || []).slice(0, 12), ncm = (ncmRec.data || []).slice(0, 12);
    const fmSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 16 0"/><path d="M7.6 13.2a5 5 0 0 1 8.8 0"/><circle cx="12" cy="17" r="2.5"/></svg>`;
    const specCard = (kind, src) => {
      const isD = kind === 'daily';
      return `<div class="card spec-card home-feature-card" role="button" tabindex="0" aria-label="${src === 'qq' ? 'QQ' : '网易'}${isD ? '每日推荐' : '私人 FM'}" data-spec="${kind}" data-src="${src}">
        <div class="cover"><div class="spec-cover ${isD ? 'sc-daily' : 'sc-fm'}" data-sc="${kind}-${src}">${isD ? `<span class="sp-day">${new Date().getDate()}</span>` : fmSvg}<span class="sp-lb">${isD ? '每日推荐' : '私人FM'}</span></div>
          <img class="src-logo" src="${src === 'qq' ? '/static/qqmusic.png' : '/static/wyyyy.jpg'}" alt=""><div class="play-fab">${ICONS.play}</div></div>
        <div class="name"><span class="badge ${src === 'qq' ? 'qq' : 'ncm'}">${src === 'qq' ? 'QQ' : '网易'}</span>${isD ? '每日推荐' : '私人FM'}</div><div class="sub">${isD ? '根据你的口味 · 每天 30 首' : '无尽电台 · 越听越懂你'}</div></div>`;
    };
    const recommendSection = (title, source, items) => `<section class="home-rec-section"><div class="row-head"><h2>${title}</h2><span class="rh-actions"><button class="refresh-btn" data-rec="${source}">${ICONS.refresh}<span>换一批</span></button><a class="see-all" href="#/playlists?source=${source}">查看全部 ›</a></span></div><div class="cards home-rec-grid" id="rec-${source}">${items.map(x => card(x, 'playlist')).join('')}</div></section>`;
    const chartSection = (title, source, items) => `<section class="home-chart-section"><div class="row-head"><h2>${title}</h2><a class="see-all" href="#/charts?source=${source}">查看全部 ›</a></div><div class="cards home-chart-grid">${items.slice(0, 8).map(x => card(x, 'chart')).join('')}</div></section>`;
    view.innerHTML = `<div class="row-head home-for-you"><h2>为你推荐</h2></div><div class="cards home-feature-grid">${specCard('daily','qq')}${specCard('daily','netease')}${specCard('fm','qq')}${specCard('fm','netease')}</div>
      <div class="source-panels home-recommend-panels"><div class="source-panel">${recommendSection('QQ · 推荐歌单','qq',qq)}</div><div class="source-panel">${recommendSection('网易云 · 推荐歌单','netease',ncm)}</div></div>
      <div class="source-panels home-chart-panels"><div class="source-panel">${chartSection('QQ · 排行榜','qq',qqTop.data || [])}</div><div class="source-panel">${chartSection('网易云 · 排行榜','netease',ncmTop.data || [])}</div></div>`;
    bindCards(view);
    const activateSpecial = async (c, e) => { const kind = c.dataset.spec, src = c.dataset.src; if (kind === 'fm') return startFM(src); if (e && e.target.closest('.play-fab')) { const r = await api('/api/recommend/daily?source=' + src); const songs = (r && r.data) || []; if (songs.length) playSongs(songs, 0); return; } location.hash = '#/daily/' + src; };
    view.querySelectorAll('.spec-card').forEach(c => { c.onclick = e => activateSpecial(c,e); c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateSpecial(c,e); } }; });
    ['qq','netease'].forEach(async src => { try { const r = await api('/api/recommend/daily?source=' + src); const list = (r && r.data) || []; const setBg = (sel,pic) => { if(pic) view.querySelectorAll(sel).forEach(el => { el.style.backgroundImage=`url('${pic}')`; el.classList.add('has-img'); }); }; setBg(`[data-sc="daily-${src}"]`,httpsify((list[0]||{}).pic||'')); setBg(`[data-sc="fm-${src}"]`,httpsify((list[Math.min(list.length-1,7)]||list[0]||{}).pic||'')); } catch(e){} });
    $$('.refresh-btn[data-rec]').forEach(b => b.onclick = () => refreshRec(b.dataset.rec,b));
  }
  function fillRec(source, items) {
    const grid = $('#rec-' + source); if (!grid) return;
    grid.innerHTML = items.length ? items.map(x => card(x, 'playlist')).join('') : '<div class="empty-tip">暂无歌单</div>';
    bindCards(grid);
  }
  async function refreshRec(source, btn) {
    if (btn) btn.classList.add('spinning');
    const grid = $('#rec-' + source); if (grid) grid.style.opacity = '.4';
    try {
      const r = await api(`/api/recommend/playlists?source=${source}&limit=28`);
      fillRec(source, (r.data || []).slice(0, 12));
    } catch (e) {}
    if (grid) grid.style.opacity = '';
    if (btn) btn.classList.remove('spinning');
  }

  // ---------- 首页轮播（连续轨道横向滑动 + 居中卡 + 无限流续接） ----------
  // 重构自旧的"绝对定位叠层 + 环绕跨接缝修正"（易横飞/闪烁）：改成一条 flex 轨道，
  // translateX 让当前卡居中、两侧卡缩小压暗露边；前进时尾部按需补卡、头部裁掉已滑过的，
  // 轨道永远单向前进、永不环绕 → 没有跨接缝跳变，动画始终连续。内容来自 pool 循环投喂。
  let carouselTimer = null;
  function slideHTML(it) {
    const cover = esc(httpsify(it.cover) || IMG_PLACEHOLDER);
    const desc = esc((it.desc || '').replace(/<br\s*\/?>/gi, ' ') || (it.songCount ? it.songCount + ' 首' : ''));
    return `<div class="cslide" data-source="${it.source}" data-id="${esc(String(it.id))}">
      <div class="cs-bg" style="background-image:url('${cover}')"></div>
      <div class="cs-main" style="background-image:url('${cover}')">
        <div class="cs-mask"></div>
        ${it.playCount ? `<span class="cs-count">${ICONS.play} ${fmtCount(it.playCount)}</span>` : ''}
        <div class="cs-info">
          <div class="cs-title">${esc(it.name)}</div>
          <div class="cs-desc">${desc}</div>
        </div>
        <button class="cs-play cplay" title="播放">${ICONS.play}</button>
      </div>
      <div class="cs-side">
        <div class="cs-side-h">推荐人</div>
        <div class="cs-rec"><img class="cs-av" src="${it.source === 'qq' ? '/static/qqmusic.png' : '/static/wyyyy.jpg'}" alt=""><span class="cs-rec-n">${it.creator ? esc(it.creator) : (it.source === 'qq' ? 'QQ 音乐' : '网易云音乐')}</span></div>
        <div class="cs-side-desc">简介：${esc((it.desc || '').replace(/<br\s*\/?>/gi, ' ') || '为你推荐的精选歌单')}</div>
      </div>
    </div>`;
  }
  function carouselHTML() {
    return `<div class="carousel" id="carousel">
      <div class="cs-viewport"><div class="cs-track"></div></div>
      <button class="cnav cnav-l" aria-label="上一个"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button class="cnav cnav-r" aria-label="下一个"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>`;
  }
  function initCarousel(pool) {
    pool = (pool || []).filter(Boolean);
    const root = document.getElementById('carousel');
    if (!root || !pool.length) return;
    setupCarousel(root, pool);
  }
  function setupCarousel(root, pool) {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
    const track = root.querySelector('.cs-track');
    if (!track) return;
    const KEEP_BEHIND = 2;   // 当前卡之前保留几张（做左侧露边），更早的裁掉
    let feed = 0, pos = 0, animating = false;
    const take = () => pool[(feed++) % pool.length];   // 循环投喂（pool 大 + 每次进页重新打散 → 重复感低）
    const bind = (el) => {
      el.addEventListener('click', (e) => {
        const idx = [...track.children].indexOf(el);
        if (idx !== pos) { pos = idx; ensureAhead(); paint(true); restart(); return; }   // 点非当前卡：先居中
        if (e.target.closest('.cs-play') || e.target.closest('.cplay')) { e.stopPropagation(); loadAndPlay('playlist', el.dataset.source, el.dataset.id); return; }
        location.hash = `#/playlist/${el.dataset.source}/${el.dataset.id}`;
      });
    };
    const append = () => { track.insertAdjacentHTML('beforeend', slideHTML(take())); bind(track.lastElementChild); };
    const ensureAhead = () => { while (track.children.length - pos < 4) append(); };   // 当前卡之后至少留 3 张
    // 居中定位：让第 pos 张卡水平居中；相邻卡叠进两侧；只显示中心+左右各1，更外侧淡出
    const paint = (animate) => {
      const slides = track.children; if (!slides.length) return;
      const vp = root.querySelector('.cs-viewport'); const vpW = vp.clientWidth;
      if (!vpW) return;   // 未布局/detached：宽度 0 会把当前卡定位到错位，跳过
      const cur = slides[pos]; if (!cur) return;
      // ⚠️ 居中必须用内容宽度(减左右 padding)——viewport 有对称 padding，
      // 用含 padding 的 clientWidth 会让当前卡偏右 padding 量（此前"不居中"的根因）
      const cs = getComputedStyle(vp);
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const contentW = vpW - pad;
      const offset = cur.offsetLeft + cur.offsetWidth / 2 - contentW / 2;
      track.style.transition = animate ? 'transform .55s cubic-bezier(.22,.61,.36,1)' : 'none';
      track.style.transform = `translateX(${-offset}px)`;
      const T = animate ? 'transform .55s cubic-bezier(.22,.61,.36,1), opacity .55s ease' : 'none';
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i]; const d = i - pos; const ad = Math.abs(d);
        s.classList.toggle('active', d === 0);
        s.style.transition = T;
        if (d === 0) {
          s.style.transform = 'scale(1)'; s.style.opacity = '1'; s.style.zIndex = '10'; s.style.pointerEvents = '';
        } else if (ad === 1) {
          s.style.transform = `translateX(${-Math.sign(d) * 30}%) scale(.86)`;
          s.style.opacity = '.55'; s.style.zIndex = '9'; s.style.pointerEvents = '';
        } else {
          // 中心左右各 1 之外（第一/第五张…）淡出不显示；进出时靠 opacity 过渡形成淡入淡出
          s.style.transform = `translateX(${-Math.sign(d) * 42}%) scale(.72)`;
          s.style.opacity = '0'; s.style.zIndex = '1'; s.style.pointerEvents = 'none';
        }
      }
    };
    const trimBehind = () => {
      while (pos > KEEP_BEHIND) { track.removeChild(track.firstElementChild); pos--; }
    };
    const go = (dir) => {
      // 发现页被路由缓存切走 → 轨道 detached：跳过本次 tick（不 append 防泄漏、不 paint 防错位），
      // 不清 timer——缓存恢复重新挂载后 isConnected 变真、自动继续轮播
      if (!root.isConnected) return;
      if (animating && dir > 0) return;   // 防连点/定时叠加
      if (dir < 0 && pos <= 0) return;    // 已在最左（裁剪后极少发生）
      pos += dir;
      ensureAhead();
      animating = true;
      paint(true);
      // 过渡结束：前进时裁掉左侧超窗卡（无过渡瞬间重排，视觉无感）
      setTimeout(() => {
        animating = false;
        if (dir > 0) { trimBehind(); paint(false); }
      }, 580);
    };
    root.querySelector('.cnav-l').onclick = () => { go(-1); restart(); };
    root.querySelector('.cnav-r').onclick = () => { go(1); restart(); };
    // 初始铺 KEEP_BEHIND + 1(当前) + 3(前瞻) 张，定位到第一张居中
    for (let i = 0; i < KEEP_BEHIND + 4 && i < 200; i++) append();
    pos = Math.min(KEEP_BEHIND, track.children.length - 1);   // 让首张前面也有露边卡
    // 重排布局需要真实宽度：下一帧再定位（此刻 offsetWidth 已可用，但保险起见 rAF）
    requestAnimationFrame(() => paint(false));
    const restart = () => { if (carouselTimer) clearInterval(carouselTimer); carouselTimer = setInterval(() => go(1), 5000); };
    restart();
    // 视口尺寸变化时重新居中
    if (!setupCarousel._resizeHooked) {
      setupCarousel._resizeHooked = true;
      window.addEventListener('resize', () => { const r = document.getElementById('carousel'); if (r && r._paint) r._paint(); });
    }
    root._paint = () => paint(false);
  }

  // 排行榜 / 歌单广场：与搜索结果一致的双源双栏（左 QQ、右 网易云），窄屏纵向堆叠
  async function renderList(kind) {
    const g = navGen;
    const ep = kind === 'charts' ? '/api/charts' : '/api/recommend/playlists';
    const cardKind = kind === 'charts' ? 'chart' : 'playlist';
    view.innerHTML = `<div class="row-head"><h2>${kind === 'charts' ? '排行榜' : '歌单广场'}</h2></div>
      <div class="src-switch list-srcbar">
        <button data-s="qq" class="active">QQ 音乐</button>
        <button data-s="netease">网易云</button>
      </div>
      <div class="search-cols dual-list chart-compare-body show-qq">
        <div class="search-col col-qq"><div class="sc-head sc-qq">QQ 音乐</div><div class="sc-body" id="lsQQ"><div class="loading">加载中…</div></div></div>
        <div class="search-col col-ncm"><div class="sc-head sc-ncm">网易云音乐</div><div class="sc-body" id="lsNCM"><div class="loading">加载中…</div></div></div>
      </div>`;
    // 窄屏：src-switch 手动切源（单列，与搜索页一致）；宽屏两列同显、按钮由 CSS 隐藏
    $$('.src-switch button').forEach(b => b.onclick = () => {
      const sc = $('.search-cols.dual-list');
      if (sc) { sc.classList.toggle('show-qq', b.dataset.s === 'qq'); sc.classList.toggle('show-netease', b.dataset.s === 'netease'); }
      $$('.src-switch button').forEach(x => x.classList.toggle('active', x === b));
    });
    const fill = async (src, sel) => {
      const box = $(sel); if (!box) return;
      try {
        const r = await api(`${ep}?source=${src}&limit=60`);
        // 排行榜与歌单广场用同一组 #lsQQ/#lsNCM id：切页后慢响应会经全局 $ 命中新页容器，必须丢弃
        if (g !== navGen) return;
        const items = r.data || [];
        if (!items.length) { box.innerHTML = '<div class="empty-tip">暂无数据</div>'; return; }
        if (kind === 'charts') {
          // 两侧都使用单一连续栅格；分组名称作为卡片角标，不再插入不同高度的分组标题。
          box.innerHTML = `<div class="cards chart-flat-grid">${items.map(x => { const html = card(x, cardKind); return html.replace('<div class="cover">', `<div class="cover"><span class="chart-group-tag">${esc(x.group || '榜单')}</span>`); }).join('')}</div>`;
        } else {
          box.innerHTML = `<div class="cards list-flat-grid">${items.map(x => card(x, cardKind)).join('')}</div>`;
        }
        bindCards(box);
      } catch (e) { box.innerHTML = '<div class="empty-tip">加载失败</div>'; }
    };
    fill('qq', '#lsQQ'); fill('netease', '#lsNCM');
  }

  async function renderDetail(kind, source, id) {
    const g = navGen;
    view.innerHTML = '<div class="loading">加载中…</div>';
    const ep = kind === 'chart' ? '/api/chart/detail' : (kind === 'album' ? '/api/album/detail' : '/api/playlist/detail');
    const r = await api(`${ep}?source=${source}&id=${encodeURIComponent(id)}`);
    if (g !== navGen) return;
    const meta = (r.data && r.data.meta) || {}; const songs = (r.data && r.data.songs) || [];
    const kindLabel = kind === 'chart' ? '排行榜' : (kind === 'album' ? '专辑' : '歌单');
    // P4：大封面 hero（模糊封面渐变底），封面缺失回退第一首歌的图
    const cover = httpsify(meta.cover || (songs[0] && songs[0].pic) || '') || IMG_PLACEHOLDER;
    view.innerHTML = `
      <div class="detail-hero">
        <div class="dh-bg" style="background-image:url('${esc(cover)}')"></div>
        <button class="btn-back" id="goBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回</button>
        <div class="dh-main">
          <img class="dh-cover" loading="lazy" src="${esc(cover)}" alt="">
          <div class="dh-info">
            <div class="dh-kind">${source === 'qq' ? 'QQ 音乐' : '网易云音乐'} · ${kindLabel}</div>
            <h1>${esc(meta.name || '')}</h1>
            ${meta.desc ? `<div class="dh-desc">${esc((meta.desc || '').replace(/<br\s*\/?>/gi, ' '))}</div>` : ''}
            <div class="lh-bar">
              <button class="btn-play" id="playAll">${ICONS.play} 播放全部</button>
              ${kind === 'playlist' ? `<button class="btn-ghost" id="favPl">${ICONS.heart} 收藏</button>` : ''}
              <span class="lh-count">共 ${songs.length} 首</span>
            </div>
          </div>
        </div>
      </div>
      <div id="songs">${renderSongList(songs)}</div>`;
    bindSongList($('#songs'), songs);
    $('#playAll').onclick = () => playSongs(songs, 0);
    // 歌单收藏（收藏别人的歌单 → 侧栏「收藏歌单」分组，只存引用不导入歌曲）
    if (kind === 'playlist') {
      const favBtn = $('#favPl');
      let faved = false;
      const syncFav = () => { if (!favBtn) return; favBtn.innerHTML = (faved ? ICONS.heartF + ' 已收藏' : ICONS.heart + ' 收藏'); favBtn.classList.toggle('faved', faved); };
      api(`/api/library/fav_playlists/check?source=${source}&id=${encodeURIComponent(id)}`).then(r => { faved = !!(r && r.faved); syncFav(); }).catch(() => {});
      if (favBtn) favBtn.onclick = async () => {
        try {
          if (faved) { await api(`/api/library/fav_playlists?source=${source}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }); faved = false; toast('已取消收藏'); }
          else { await api('/api/library/fav_playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, id, name: meta.name || '', cover: meta.cover || cover, creator: meta.creator || '', songCount: songs.length }) }); faved = true; toast('已收藏到「收藏歌单」'); }
          syncFav();
          if (window.Library && Library.refreshFavPlaylists) Library.refreshFavPlaylists();
        } catch (e) { toast('操作失败，请稍后再试'); }
      };
    }
    bindBack();
  }
  // 返回按钮：优先浏览器历史，否则回发现页
  function bindBack() {
    const gb = $('#goBack');
    if (gb) gb.onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/discover'; };
  }

  // ---------- 歌手主页（P5）：头像 hero + 热门歌曲/专辑 tab ----------
  async function renderArtist(source, id) {
    const g = navGen;
    view.innerHTML = '<div class="loading">加载歌手…</div>';
    const r = await api(`/api/artist/detail?source=${source}&id=${encodeURIComponent(id)}`);
    if (g !== navGen) return;   // 期间用户已切走：慢响应不写页面
    if (!r || r.code !== 0 || !r.data || !r.data.name) { view.innerHTML = '<div class="empty-tip">歌手信息加载失败</div>'; return; }
    const a = r.data;
    const hot = a.hot_songs || [];
    view.innerHTML = `
      <div class="detail-hero artist-hero">
        <div class="dh-bg" style="background-image:url('${esc(httpsify(a.bg || a.pic) || '')}')"></div>
        <button class="btn-back" id="goBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回</button>
        <div class="dh-main">
          <img class="dh-cover dh-avatar" loading="lazy" src="${esc(httpsify(a.pic) || IMG_PLACEHOLDER)}" alt="">
          <div class="dh-info">
            <div class="dh-kind">${source === 'qq' ? 'QQ 音乐' : '网易云音乐'} · 歌手</div>
            <h1>${esc(a.name)}</h1>
            ${a.desc ? `<div class="dh-desc">${esc(a.desc)}</div>` : ''}
            <div class="lh-bar">
              <button class="btn-play" id="playAll">${ICONS.play} 播放热门</button>
              ${a.song_total ? `<span class="lh-count">单曲 ${a.song_total}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="search-tabs artist-tabs" id="artTabs">
        <button data-t="songs" class="active">热门歌曲</button>
        <button data-t="albums">专辑</button>
      </div>
      <div id="artBody">${renderSongList(hot)}</div>`;
    bindSongList($('#artBody'), hot);
    $('#playAll').onclick = () => playSongs(hot, 0);
    bindBack();
    let albumsCache = null;
    view.querySelectorAll('#artTabs button').forEach(b => b.onclick = async () => {
      view.querySelectorAll('#artTabs button').forEach(x => x.classList.toggle('active', x === b));
      const body = $('#artBody');
      if (b.dataset.t === 'songs') { body.innerHTML = renderSongList(hot); bindSongList(body, hot); return; }
      if (!albumsCache) {
        body.innerHTML = '<div class="loading">加载专辑…</div>';
        const ar = await api(`/api/artist/albums?source=${source}&id=${encodeURIComponent(id)}&num=60`);
        albumsCache = (ar && ar.data) || [];
      }
      body.innerHTML = albumsCache.length
        ? `<div class="cards">${albumsCache.map(x => card(x, 'album')).join('')}</div>`
        : '<div class="empty-tip">暂无专辑</div>';
      bindCards(body);
    });
  }

  // ---------- 每日推荐（P5）：种子=收藏∪最近播放，服务端按 天×音源 缓存 ----------
  async function renderDaily(source) {
    source = (source === 'qq' || source === 'netease') ? source : '';
    const srcLabel = source === 'qq' ? 'QQ 音乐' : (source === 'netease' ? '网易云音乐' : '双音源');
    const g = navGen;
    view.innerHTML = '<div class="loading">生成每日推荐…</div>';
    const r = await api('/api/recommend/daily?source=' + source);
    if (g !== navGen) return;
    const songs = (r && r.data) || [];
    const calIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M9 16l2 2 4-4"/></svg>`;
    view.innerHTML = `
      <div class="detail-hero dh-lib dh-daily">
        <div class="dh-bg"></div>
        <div class="dh-main">
          <div class="dh-cover dh-icon">${calIcon}</div>
          <div class="dh-info">
            <div class="dh-kind">${srcLabel} · 根据你的收藏和最近播放生成 · 每天更新</div>
            <h1>每日推荐</h1>
            <div class="lh-bar">
              <button class="btn-play" id="playAll">${ICONS.play} 播放全部</button>
              <span class="lh-count">共 ${songs.length} 首</span>
              <span style="flex:1"></span>
              <button class="btn-ghost" id="dailyRefresh">换一批</button>
            </div>
          </div>
        </div>
      </div>
      <div id="songs">${renderSongList(songs)}</div>`;
    bindSongList($('#songs'), songs);
    $('#playAll').onclick = () => playSongs(songs, 0);
    $('#dailyRefresh').onclick = async () => {
      view.innerHTML = '<div class="loading">重新生成…</div>';
      await api('/api/recommend/daily?refresh=1&source=' + source);
      renderDaily(source);
    };
  }

  // ---------- 私人FM（P5）：无尽电台，队列快听完自动续歌；可按音源分台 ----------
  let fmMode = false, fmLoading = false, fmSource = '';
  async function startFM(source) {
    fmSource = (source === 'qq' || source === 'netease') ? source : '';
    const r = await api(`/api/fm/next?n=8&source=${fmSource}`);
    const songs = (r && r.data) || [];
    if (!songs.length) { notice('FM 暂时没有可播放歌曲，先收藏或多听几首吧', 'warning'); return; }
    fmMode = true;
    playSongs(songs, 0, { keepFM: true, replace: true });
  }
  function setupFM() {
    const p = window.player; if (!p || !p.on) return;
    p.on('songchange', async () => {
      if (window.__togetherFollowing) return;   // 一起听跟随中：不续 FM，避免打断房主同步
      if (!fmMode || fmLoading) return;
      const pl = p.playlist || [];
      if (pl.length - 1 - (p.currentIndex || 0) > 2) return;   // 还剩 >2 首不用补
      fmLoading = true;
      try {
        const r = await api(`/api/fm/next?n=6&source=${fmSource}`);
        const more = ((r && r.data) || []).map(toEngine);
        if (more.length && fmMode) { p.playlist.push(...more); Queue.save(); }
      } catch (e) {}
      fmLoading = false;
    });
  }

  // ---------- 听歌统计上报（P5）：累计有效收听秒数，切歌/离开页面时上报 ----------
  function setupStats() {
    const p = window.player; if (!p || !p.on) return;
    let cur = null, acc = 0, last = 0;
    const flush = () => {
      if (cur && acc >= 5) {
        const payload = JSON.stringify({ song: { id: cur.id, name: cur.name || '', artist: cur.artists || '', pic: cur.picUrl || '' }, secs: Math.round(acc) });
        try {
          if (navigator.sendBeacon) navigator.sendBeacon('/api/stats/play', new Blob([payload], { type: 'application/json' }));
          else fetch('/api/stats/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        } catch (e) {}
      }
      acc = 0;
    };
    p.on('timeupdate', () => {
      const t = (p.audio && p.audio.currentTime) || 0;
      if (last && t > last && t - last < 5) acc += t - last;   // seek/换歌的大跳变不计入
      last = t;
    });
    p.on('songchange', () => { flush(); cur = p.currentSong; last = 0; });
    window.addEventListener('pagehide', flush);
  }

  // ---------- 听歌报告（P7）：总时长/最常听的歌·歌手/每日时长条形 ----------
  function fmtStatDur(s) {
    s = Math.round(s || 0);
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} 小时 ${m} 分` : (m ? `${m} 分钟` : `${s} 秒`);
  }
  async function renderStats(range) {
    range = (range === '7d' || range === 'all') ? range : '30d';
    const g = navGen;
    view.innerHTML = '<div class="loading">生成听歌报告…</div>';
    const r = await api('/api/stats/summary?range=' + range);
    if (g !== navGen) return;
    const d = (r && r.data) || {};
    const days = d.days || [], maxDay = Math.max(1, ...days.map(x => x.secs || 0));
    const topSongs = d.top_songs || [], topArtists = d.top_artists || [];
    const statIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16v1.5H4zM6 10h3v8H6zm5-5h3v13h-3zm5 8h3v5h-3z"/></svg>';
    view.innerHTML = `
      <div class="detail-hero dh-lib dh-stats">
        <div class="dh-bg"></div>
        <div class="dh-main">
          <div class="dh-cover dh-icon">${statIcon}</div>
          <div class="dh-info">
            <div class="dh-kind">你的听歌足迹</div>
            <h1>听歌报告</h1>
            <div class="stats-nums">
              <span><b>${fmtStatDur(d.total_secs)}</b>总时长</span>
              <span><b>${d.total_plays || 0}</b>次播放</span>
              <span><b>${d.song_count || 0}</b>首歌曲</span>
            </div>
          </div>
        </div>
      </div>
      <div class="search-tabs st-range" id="stRange">
        <button data-r="7d" class="${range === '7d' ? 'active' : ''}">近 7 天</button>
        <button data-r="30d" class="${range === '30d' ? 'active' : ''}">近 30 天</button>
        <button data-r="all" class="${range === 'all' ? 'active' : ''}">全部</button>
      </div>
      ${days.length ? `<div class="row-head"><h2>每日时长</h2></div>
        <div class="stats-bars">${days.map(x => {
          const mins = Math.round((x.secs || 0) / 60);
          const vlabel = mins >= 60 ? (Math.floor(mins / 60) + 'h' + (mins % 60 ? (mins % 60) + 'm' : '')) : (mins + 'm');
          return `<div class="stbar" title="${x.day} · ${fmtStatDur(x.secs)}"><i style="height:${Math.max(3, Math.round((x.secs || 0) / maxDay * 100))}%"><b class="stbar-v">${vlabel}</b></i><span>${(x.day || '').slice(5)}</span></div>`;
        }).join('')}</div>` : ''}
      <div class="row-head"><h2>最常听的歌</h2></div>
      ${topSongs.length ? `<div class="songlist" id="stSongs">${topSongs.map((it, i) => {
        const s = it.song || {};
        // 有带 id 的 artists 数组 → 可点跳歌手页；否则回退纯文本搜索该歌手
        const arr = artistArr(s);
        const arHTML = arr ? artistLinks(s) : `<span class="st-ar" data-ar="${esc(s.artist || '')}" title="搜索该歌手">${esc(s.artist || '')}</span>`;
        return `<div class="song-row stat-row" data-i="${i}"><div class="idx">${i + 1}</div>
          <img class="rc" loading="lazy" src="${esc(picOf(s))}"><div class="ti"><div class="nm">${esc(s.name || '')}</div><div class="ar">${arHTML}</div></div>
          <div class="al">${it.plays} 次 · ${fmtStatDur(it.secs)}</div><div class="act"></div></div>`;
      }).join('')}</div>` : '<div class="empty-tip">还没有足够的收听记录，多听几首吧</div>'}
      <div class="row-head"><h2>最常听的歌手</h2></div>
      ${topArtists.length ? `<div class="stat-artists">${topArtists.map((a, i) => `<div class="stat-ar"><span class="sti">${i + 1}</span><span class="stn">${esc(a.name)}</span><span class="stc">${a.plays} 次</span></div>`).join('')}</div>` : '<div class="empty-tip">暂无</div>'}`;
    view.querySelectorAll('#stRange button').forEach(b => b.onclick = () => renderStats(b.dataset.r));
    // 歌手名可点：有 id 的 → 歌手页；无 id 的（st-ar / 最常听歌手）→ 搜索该歌手
    view.querySelectorAll('.artist-link').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const aid = el.dataset.aid || ''; const p2 = aid.indexOf(':');
      if (p2 > 0) location.hash = `#/artist/${aid.slice(0, p2)}/${encodeURIComponent(aid.slice(p2 + 1))}`;
    }));
    view.querySelectorAll('.st-ar, .stat-ar .stn').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = (el.dataset.ar || el.textContent || '').split(/[\/、,]/)[0].trim();
      if (q) location.hash = '#/search/' + encodeURIComponent(q);
    }));
    const sc = $('#stSongs');
    if (sc) sc.querySelectorAll('.stat-row').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.artist-link, .st-ar')) return;   // 点歌手名不触发整行播放
      const it = topSongs[+row.dataset.i]; if (it && it.song) playSongs([it.song], 0);
    }));
  }

  // ---------- 本地音乐（IndexedDB 持久化，blob URL 播放） ----------
  async function renderLocal() {
    const g = navGen;
    view.innerHTML = '<div class="section-title">本地音乐</div><div class="loading">读取本地音乐…</div>';
    const songs = (window.LocalMusic ? await window.LocalMusic.list() : []);
    if (g !== navGen) return;
    const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="15" cy="13.5" r="2"/><path d="M17 13.5V8.6l-4 .9v4"/></svg>';
    const removeCtx = { removable: true, onRemove: async (s) => { if (window.LocalMusic) await window.LocalMusic.remove(s.id); } };
    view.innerHTML = `
      <div class="detail-hero dh-lib dh-local">
        <div class="dh-bg"></div>
        <div class="dh-main">
          <div class="dh-cover dh-icon">${folderIcon}</div>
          <div class="dh-info">
            <div class="dh-kind">我的音乐</div>
            <h1>本地音乐</h1>
            <div class="lh-bar">
              <button class="btn-play" id="playAllLocal">${ICONS.play} 播放全部</button>
              <button class="btn-ghost" id="importLocal">＋ 导入本地文件</button>
              <span class="lh-count">共 ${songs.length} 首</span>
            </div>
          </div>
        </div>
      </div>
      <input type="file" id="localFileInput" accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.wav,.opus" multiple hidden>
      <div id="localList">${songs.length ? renderSongList(songs, removeCtx) : '<div class="empty-tip">还没有本地音乐，点上方「导入本地文件」从设备添加音频（保存在浏览器本地，不上传）</div>'}</div>`;
    if (songs.length) bindSongList($('#localList'), songs, removeCtx);
    const pa = $('#playAllLocal'); if (pa) pa.onclick = () => { if (songs.length) playSongs(songs, 0); else toast('还没有本地音乐'); };
    const imp = $('#importLocal'), inp = $('#localFileInput');
    if (imp && inp) {
      imp.onclick = () => inp.click();
      inp.onchange = async () => {
        if (!inp.files || !inp.files.length || !window.LocalMusic) return;
        toast('正在导入本地音乐…');
        const n = await window.LocalMusic.import(inp.files);
        inp.value = '';
        toast(n ? `已导入 ${n} 首` : '没有识别到音频文件');
        if (n) renderLocal();
      };
    }
  }

  async function renderSearch(q) {
    const g = navGen;
    const state = { tab: 'song', src: 'qq', pages: { song: { qq: 1, netease: 1 }, playlist: { qq: 1, netease: 1 } } };
    const cache = { song: { qq: new Map(), netease: new Map() }, playlist: { qq: new Map(), netease: new Map() } };
    const controllers = { qq: null, netease: null };

    const sourceName = src => src === 'qq' ? 'QQ 音乐' : '网易云音乐';
    function shell() {
      Object.values(controllers).forEach(c => c && c.abort());
      view.innerHTML = `<div class="section-title search-title">搜索 “${esc(q)}”</div>
        <div class="search-bar2"><div class="search-tabs"><button data-t="song" class="${state.tab === 'song' ? 'active' : ''}">歌曲</button><button data-t="playlist" class="${state.tab === 'playlist' ? 'active' : ''}">歌单</button></div>
        <div class="src-switch"><button data-s="qq" class="${state.src === 'qq' ? 'active' : ''}">QQ 音乐</button><button data-s="netease" class="${state.src === 'netease' ? 'active' : ''}">网易云</button></div></div>
        <div class="search-cols source-panels show-${state.src}">
          <section class="search-col source-panel col-qq"><div class="sc-head sc-qq">QQ 音乐</div><div class="sc-body" id="scQQ"></div></section>
          <section class="search-col source-panel col-ncm"><div class="sc-head sc-ncm">网易云音乐</div><div class="sc-body" id="scNCM"></div></section>
        </div>`;
      $$('.search-tabs button').forEach(b => b.onclick = () => { if (state.tab !== b.dataset.t) { state.tab = b.dataset.t; shell(); } });
      $$('.src-switch button').forEach(b => b.onclick = () => { state.src = b.dataset.s; const sc = $('.search-cols'); sc.classList.toggle('show-qq', state.src === 'qq'); sc.classList.toggle('show-netease', state.src === 'netease'); $$('.src-switch button').forEach(x => x.classList.toggle('active', x === b)); });
      loadSource('qq'); loadSource('netease');
    }
    async function fetchPage(tab, page, src, signal) {
      const key = `${page}`, sourceCache = cache[tab][src];
      if (!sourceCache.has(key)) {
        const endpoint = tab === 'song' ? '/api/search/split' : '/api/search/playlists';
        const data = await api(`${endpoint}?keyword=${encodeURIComponent(q)}&limit=15&page=${page}`, { signal });
        sourceCache.set(key, (data || {})[src] || []);
      }
      return sourceCache.get(key) || [];
    }
    async function loadSource(src) {
      const tab = state.tab, page = state.pages[tab][src];
      const box = $(src === 'qq' ? '#scQQ' : '#scNCM'); if (!box) return;
      if (controllers[src]) controllers[src].abort();
      controllers[src] = new AbortController(); box.innerHTML = '<div class="loading">搜索中…</div>';
      let items = [], failed = false;
      try { items = await fetchPage(tab, page, src, controllers[src].signal); }
      catch (e) { if (e.name === 'AbortError') return; failed = true; }
      if (g !== navGen || state.tab !== tab || !box.isConnected) return;
      const pager = `<div class="search-more"><button data-p="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${sourceName(src)} · 第 ${page} 页</span><button data-p="next" ${items.length < 15 ? 'disabled' : ''}>下一页</button></div>`;
      if (failed) box.innerHTML = `<div class="empty-tip">搜索失败，请稍后重试</div>${pager}`;
      else if (tab === 'song') { box.innerHTML = (items.length ? renderSongList(items) : '<div class="empty-tip">这一页没有结果</div>') + pager; if (items.length) bindSongList(box, items); }
      else { box.innerHTML = (items.length ? `<div class="cards search-card-grid">${items.map(p => card(p, 'playlist')).join('')}</div>` : '<div class="empty-tip">这一页没有结果</div>') + pager; bindCards(box); }
      box.querySelectorAll('.search-more button').forEach(b => b.onclick = () => { state.pages[tab][src] = Math.max(1, page + (b.dataset.p === 'next' ? 1 : -1)); loadSource(src); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }
    shell();
  }

  const LIBRARY_PAGE_SIZE = 12;
  async function renderLibrarySongs(which) {
    const g = navGen;
    const title = which === 'liked' ? '我喜欢的音乐' : '最近播放';
    view.innerHTML = `<div class="section-title">${title}</div><div class="loading">加载中…</div>`;
    const r = await api('/api/library/' + which + (which === 'recent' ? '?limit=500' : ''));
    if (g !== navGen) return;
    const songs = r.data || [];
    const split = {
      qq: songs.filter(s => srcOf(s) === 'qq'),
      netease: songs.filter(s => srcOf(s) !== 'qq'),
    };
    const pages = { qq: 1, netease: 1 };
    const heroIcon = which === 'liked'
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`;
    const hero = `<div class="detail-hero dh-lib ${which === 'liked' ? 'dh-liked' : 'dh-recent'}"><div class="dh-bg"></div><div class="dh-main"><div class="dh-cover dh-icon">${heroIcon}</div><div class="dh-info"><div class="dh-kind">我的音乐</div><h1>${title}</h1><div class="lh-bar"><button class="btn-play" id="playAll">${ICONS.play} 播放全部</button><span class="lh-count">共 ${songs.length} 首</span></div></div></div></div>`;
    view.innerHTML = `${hero}<div class="source-panels recent-source-panels library-source-panels"><section class="source-panel"><div class="sc-head sc-qq">QQ 音乐 · ${split.qq.length} 首</div><div id="libraryQQ"></div></section><section class="source-panel"><div class="sc-head sc-ncm">网易云音乐 · ${split.netease.length} 首</div><div id="libraryNCM"></div></section></div>`;
    const libraryPager = (src, page, total) => { const max = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE)); return `<div class="search-more library-pager"><button data-p="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} / ${max} 页</span><button data-p="next" ${page >= max ? 'disabled' : ''}>下一页</button></div>`; };
    const paintSource = src => {
      const all = split[src], page = pages[src], start = (page - 1) * LIBRARY_PAGE_SIZE, current = all.slice(start, start + LIBRARY_PAGE_SIZE);
      const box = $(src === 'qq' ? '#libraryQQ' : '#libraryNCM'); if (!box) return;
      box.innerHTML = renderSongList(current) + libraryPager(src, page, all.length);
      bindSongList(box, current);
      box.querySelectorAll('.library-pager button').forEach(b => b.onclick = () => { pages[src] = Math.max(1, page + (b.dataset.p === 'next' ? 1 : -1)); paintSource(src); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    };
    paintSource('qq'); paintSource('netease');
    const pa = $('#playAll'); if (pa) pa.onclick = () => playSongs(songs, 0);
  }

  async function renderMyPlaylist(id) {
    const g = navGen;
    view.innerHTML = '<div class="loading">加载中…</div>';
    const r = await api('/api/library/playlists/' + id);
    if (g !== navGen) return;
    const meta = (r.data && r.data.meta) || {}; const songs = (r.data && r.data.songs) || [];
    // P4：hero——有歌用第一首封面做模糊底+大封面，空歌单用绿渐变+音符
    const plCover = httpsify(meta.cover || (songs[0] && songs[0].pic) || '');
    const noteIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`;
    view.innerHTML = `
      <div class="detail-hero my-playlist-hero ${plCover ? '' : 'dh-lib dh-mypl'}">
        ${plCover ? `<div class="dh-bg" style="background-image:url('${esc(plCover)}')"></div>` : '<div class="dh-bg"></div>'}
        <button class="btn-back" id="goBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回</button>
        <div class="dh-main">
          ${plCover ? `<img class="dh-cover" loading="lazy" src="${esc(plCover)}" alt="">` : `<div class="dh-cover dh-icon">${noteIcon}</div>`}
          <div class="dh-info">
            <div class="dh-kind">自建歌单</div>
            <h1>${esc(meta.name || '')}</h1>
            <div class="lh-bar playlist-main-actions"><span class="playlist-primary"><button class="btn-play" id="playAll">${ICONS.play} 播放全部</button><span class="lh-count">共 ${songs.length} 首</span></span><span class="playlist-secondary"><button class="btn-ghost" id="managePl">批量管理</button><button class="btn-ghost" id="renamePl">重命名</button><button class="btn-ghost" id="delPl">删除</button></span></div>
          </div>
        </div>
      </div>
      <div class="playlist-batchbar" id="batchBar" hidden><button id="selectAll">全选</button><span id="selectedCount">已选 0 首</span><button id="batchQueue">加入播放列表</button><button id="batchDownload">下载</button><button class="danger" id="batchRemove">移出歌单</button></div>
      <div id="songs">${renderSongList(songs, { removable: true, manage: true })}</div>`;
    const manageCtx = { removable: true, manage: true, playlistId: id,
      onRemove: async s => api(`/api/library/playlists/${id}/songs?mid=${encodeURIComponent(s.id)}`, { method: 'DELETE' }),
      onReorder: async mids => api(`/api/library/playlists/${id}/songs/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mids }) }) };
    bindSongList($('#songs'), songs, manageCtx);
    $('#playAll').onclick = () => playSongs(songs, 0);
    const batch = $('#batchBar'), updateSelected = () => { const n = $$('.song-check:checked').length; $('#selectedCount').textContent = `已选 ${n} 首`; };
    $('#managePl').onclick = () => { const enabled = batch.hidden; batch.hidden = !enabled; const list = $('#songs'); list.classList.toggle('batch-mode', enabled); list.querySelectorAll('.song-row').forEach(row => { row.draggable = enabled; }); $('#managePl').textContent = enabled ? '完成管理' : '批量管理'; if (!enabled) { $$('.song-check').forEach(x => x.checked = false); updateSelected(); } };
    $$('.song-check').forEach(x => x.onchange = updateSelected);
    $('#selectAll').onclick = () => { const checks = $$('.song-check'), all = checks.every(x => x.checked); checks.forEach(x => x.checked = !all); updateSelected(); };
    const selectedSongs = () => $$('.song-check:checked').map(x => songs[+x.closest('.song-row').dataset.i]).filter(Boolean);
    $('#batchQueue').onclick = () => selectedSongs().forEach(addToQueue);
    $('#batchDownload').onclick = () => selectedSongs().forEach(s => downloadSong(s));
    $('#batchRemove').onclick = async () => { const ss = selectedSongs(); if (!ss.length) return notice('请先选择歌曲', 'warning'); const ok = await appConfirm({ title: '批量移出', message: `确定移出选中的 ${ss.length} 首歌曲吗？`, okText: '移出', danger: true }); if (ok) { await api(`/api/library/playlists/${id}/songs/batch-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mids: ss.map(s => s.id) }) }); notice(`已移出 ${ss.length} 首歌曲`); renderMyPlaylist(id); } };
    $('#renamePl').onclick = async () => { const n = await appConfirm({ title: '重命名歌单', message: '输入新的歌单名称', value: meta.name, placeholder: '歌单名称', maxLength: 40 }); if (n) { await api('/api/library/playlists/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }); await Library.refreshPlaylists(); notice('歌单已重命名'); renderMyPlaylist(id); } };
    $('#delPl').onclick = async () => { const ok = await appConfirm({ title: '删除歌单', message: `确定删除「${meta.name || ''}」吗？\n歌单中的歌曲不会从“我喜欢的”中删除。`, okText: '删除', danger: true }); if (ok) { await api('/api/library/playlists/' + id, { method: 'DELETE' }); await Library.refreshPlaylists(); notice('歌单已删除'); location.hash = '#/discover'; } };
    bindBack();
  }

  // ---------- 路由 ----------
  // 视图 DOM 缓存：可缓存路由切走时保留整棵活节点（事件监听随节点保留），切回瞬时恢复不重新加载；
  // 顶栏刷新按钮手动清缓存重载。我的音乐类页面（喜欢/最近/自建歌单/下载）内容常变，不缓存。
  const viewCache = new Map();
  let curRouteHash = null;
  let navGen = 0;   // 导航代次：async 渲染函数在 await 后校验，慢响应不再写错页面/污染缓存
  const CACHEABLE_HEADS = { '': 1, discover: 1, charts: 1, playlists: 1, chart: 1, playlist: 1, album: 1, search: 1, artist: 1, daily: 1, stats: 1 };
  function routeCacheable(hash) { return !!CACHEABLE_HEADS[(hash.slice(2).split('/')[0] || '')]; }
  function router(force) {
    force = force === true;   // 只认显式 true（hashchange 若把事件对象传进来不算强刷）
    navGen++;
    const hash = location.hash || '#/discover';
    const raw = hash.slice(2);
    const queryAt = raw.indexOf('?');
    const h = queryAt >= 0 ? raw.slice(0, queryAt) : raw;
    const routeQuery = new URLSearchParams(queryAt >= 0 ? raw.slice(queryAt + 1) : '');
    const parts = h.split('/').map(decodeURIComponent);
    setActiveNav(parts[0] || 'discover');
    const mainEl = document.querySelector('.main');
    // 离开当前页：把 DOM 与滚动位置存进缓存（LRU 上限 20，防长会话 detached DOM 无界增长）
    if (curRouteHash !== null && curRouteHash !== hash && routeCacheable(curRouteHash) && view.childNodes.length) {
      viewCache.delete(curRouteHash);
      viewCache.set(curRouteHash, { nodes: Array.from(view.childNodes), scroll: mainEl ? mainEl.scrollTop : 0 });
      while (viewCache.size > 20) viewCache.delete(viewCache.keys().next().value);
    }
    curRouteHash = hash;
    if (force) viewCache.delete(hash);
    const cached = !force && routeCacheable(hash) && viewCache.get(hash);
    if (cached) {
      view.replaceChildren(...cached.nodes);
      if (mainEl) mainEl.scrollTop = cached.scroll || 0;
      // 缓存期间可能切歌/点喜欢，恢复后同步高亮
      try { markPlaying(); refreshLikedUI(); } catch (e) {}
      return;
    }
    if (mainEl) mainEl.scrollTop = 0;
    switch (parts[0]) {
      case '': case 'discover': return renderDiscover();
      case 'charts': return renderList('charts');
      case 'playlists': return renderList('playlists');
      case 'chart': return renderDetail('chart', parts[1], parts[2]);
      case 'playlist': return renderDetail('playlist', parts[1], parts[2]);
      case 'album': return renderDetail('album', parts[1], parts[2]);
      case 'search': return renderSearch(parts.slice(1).join('/'));
      case 'liked': return renderLibrarySongs('liked');
      case 'recent': return renderLibrarySongs('recent');
      case 'my': return renderMyPlaylist(parts[1]);
      case 'artist': return renderArtist(parts[1], parts[2]);
      case 'daily': return renderDaily(parts[1] || '');
      case 'downloads': return window.DownloadCenter && window.DownloadCenter.renderPage(view);
      case 'stats': return renderStats(parts[1] || '');
      case 'together': return (window.Together && window.Together.renderPage) ? window.Together.renderPage(view, routeQuery.get('room') || '') : renderDiscover();
      case 'local': return renderLocal();
      default: return renderDiscover();
    }
  }
  // 顶栏手动刷新：清当前路由缓存并重载（所有界面通用）
  {
    const rb = $('#refreshBtn');
    if (rb) rb.onclick = () => {
      rb.classList.add('spinning');
      setTimeout(() => rb.classList.remove('spinning'), 900);
      router(true);
    };
  }

  // ---------- 侧边栏 ----------
  const NAV = [
    ['discover', '发现', ICONS.discover], ['charts', '排行榜', ICONS.chart],
    ['playlists', '歌单广场', ICONS.list], ['liked', '我喜欢的', ICONS.heart], ['recent', '最近播放', ICONS.clock],
    ['together', '一起听', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'],
    ['local', '本地音乐', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="15" cy="13.5" r="1.6"/><path d="M16.6 13.5V9.2l-3.2.7v3.9"/></svg>'],
    ['downloads', '下载管理', ICONS.download],
    ['stats', '听歌报告', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16v1.5H4zM6 10h3v8H6zm5-5h3v13h-3zm5 8h3v5h-3z"/></svg>'],
  ];
  function renderNav() {
    $('#nav').innerHTML = NAV.map(([k, label, icon]) =>
      `<a class="item" data-nav="${k}" href="#/${k}">${icon}<span>${label}</span></a>`).join('');
  }
  function setActiveNav(k) { $$('#nav .item').forEach(i => i.classList.toggle('active', i.dataset.nav === k)); }
  const _plSrcBadge = (s) => s === 'qq' ? '<img class="pl-src" src="/static/qqmusic.png" alt="QQ" title="QQ 音乐">'
    : (s === 'netease' ? '<img class="pl-src" src="/static/wyyyy.jpg" alt="网易" title="网易云音乐">' : '');
  const _plNoteIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
  const _plCover = (cover) => cover ? `<img class="pl-cov" loading="lazy" decoding="async" src="${esc(httpsify(cover))}" alt="">` : `<div class="pl-cov pl-cov-ph">${_plNoteIcon}</div>`;
  function renderSidebarPlaylists() {
    $('#myPlaylists').innerHTML = Library.playlists.map(p =>
      `<div class="pl" onclick="location.hash='#/my/${p.id}'"><div class="pl-cw">${_plCover(p.cover)}${_plSrcBadge(p.source)}</div><span class="pl-nm">${esc(p.name)}</span><span class="pl-ct">${p.songCount}</span></div>`
    ).join('') || '<div class="pl pl-empty">还没有歌单，点上方 ＋ 新建</div>';
  }
  // 收藏歌单分组（收藏别人的 QQ/网易云歌单）：无收藏则整组隐藏
  function renderSidebarFav() {
    const box = $('#favPlaylists'), title = $('#favTitle'); if (!box) return;
    const favs = (Library.favPlaylists || []);
    if (!favs.length) { box.innerHTML = ''; if (title) title.style.display = 'none'; return; }
    if (title) title.style.display = '';
    box.innerHTML = favs.map(p =>
      `<div class="pl" onclick="location.hash='#/playlist/${p.source}/${encodeURIComponent(p.id)}'"><div class="pl-cw">${_plCover(p.cover)}${_plSrcBadge(p.source)}</div><span class="pl-nm">${esc(p.name)}</span></div>`
    ).join('');
  }

  // ---------- 导入外部歌单（QQ / 网易云）：美化弹窗 + 后端 resolve（支持短链跟随） ----------
  let impMask = null;
  function importExtPlaylist() {
    if (!impMask) {
      impMask = document.createElement('div'); impMask.id = 'impMask'; impMask.className = 'imp-mask';
      impMask.innerHTML = `
        <div class="imp-modal">
          <div class="imp-hd"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>导入歌单<button class="imp-x" title="关闭">×</button></div>
          <div class="imp-bd">
            <p class="imp-desc">在 QQ 音乐 / 网易云 App 里点歌单「分享 → 复制链接」，粘贴到这里；也可直接输入纯数字歌单 ID。</p>
            <input id="impInput" class="imp-input" placeholder="粘贴歌单链接，或输入歌单 ID" autocomplete="off" autocapitalize="off" spellcheck="false">
            <div id="impStatus" class="imp-status"></div>
            <div id="impSrc" class="imp-src" hidden>
              <span class="imp-src-q">这个 ID 属于哪个平台？</span>
              <div class="imp-src-row">
                <button data-s="qq" class="imp-srcbtn"><img src="/static/qqmusic.png" alt="">QQ 音乐</button>
                <button data-s="netease" class="imp-srcbtn"><img src="/static/wyyyy.jpg" alt="">网易云音乐</button>
              </div>
            </div>
          </div>
          <div class="imp-ft"><button class="imp-cancel">取消</button><button class="imp-go" disabled>导入</button></div>
        </div>`;
      document.body.appendChild(impMask);
    }
    const $$$ = (s) => impMask.querySelector(s);
    const input = $$$('#impInput'), status = $$$('#impStatus'), srcPick = $$$('#impSrc'), goBtn = $$$('.imp-go');
    let resolved = null, rseq = 0;
    clearTimeout(impMask._deb);   // 清掉上次会话残留的防抖定时器（否则旧 doResolve 会写脏当前会话状态）
    const setResolved = (pl, label, cls) => { resolved = pl; status.className = 'imp-status ' + (cls || ''); status.textContent = label || ''; goBtn.disabled = !pl; };
    const doResolve = async (txt) => {
      txt = (txt || '').trim();
      srcPick.hidden = true;
      if (!txt) { setResolved(null, '', ''); return; }
      const my = ++rseq;
      setResolved(null, '识别中…', 'loading');
      try {
        const r = await api('/api/playlist/resolve?url=' + encodeURIComponent(txt));
        if (my !== rseq) return;   // 用户又改了输入，丢弃旧结果
        if (r.code === 0 && r.ambiguous) {
          setResolved(null, '', ''); srcPick.hidden = false; srcPick.dataset.id = r.id;
        } else if (r.code === 0 && r.source) {
          const name = r.source === 'qq' ? 'QQ 音乐' : '网易云音乐';
          setResolved({ source: r.source, id: r.id }, `✓ 已识别：${name}歌单`, 'ok');
        } else {
          setResolved(null, '没能识别这个链接，换个歌单分享链接或纯数字 ID 试试', 'err');
        }
      } catch (e) { if (my === rseq) setResolved(null, '识别失败，请检查网络后重试', 'err'); }
    };
    input.oninput = () => { clearTimeout(impMask._deb); impMask._deb = setTimeout(() => doResolve(input.value), 400); };
    srcPick.querySelectorAll('.imp-srcbtn').forEach(b => b.onclick = () => {
      srcPick.querySelectorAll('.imp-srcbtn').forEach(x => x.classList.toggle('active', x === b));
      const name = b.dataset.s === 'qq' ? 'QQ 音乐' : '网易云音乐';
      setResolved({ source: b.dataset.s, id: srcPick.dataset.id }, `✓ 将从 ${name} 导入`, 'ok');
    });
    const close = () => { clearTimeout(impMask._deb); rseq++; impMask.classList.remove('show'); };   // 关闭作废在途 resolve
    $$$('.imp-x').onclick = close; $$$('.imp-cancel').onclick = close;
    impMask.onclick = (e) => { if (e.target === impMask) close(); };
    goBtn.onclick = async () => {
      if (!resolved) return;
      goBtn.disabled = true; goBtn.textContent = '导入中…';
      try {
        const r = await api('/api/library/playlists/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resolved) });
        if (r && r.code === 0) {
          toast(`已导入「${r.data.name}」，共 ${r.data.count} 首`);
          await Library.refreshPlaylists();
          close();
          location.hash = '#/my/' + r.data.id;
        } else { status.className = 'imp-status err'; status.textContent = '导入失败：' + ((r && r.msg) || '未知错误'); goBtn.disabled = false; goBtn.textContent = '导入'; }
      } catch (e) { status.className = 'imp-status err'; status.textContent = '导入失败，请稍后再试'; goBtn.disabled = false; goBtn.textContent = '导入'; }
    };
    // 打开：重置
    input.value = ''; srcPick.hidden = true; setResolved(null, '', ''); goBtn.textContent = '导入';
    impMask.classList.add('show');
    setTimeout(() => input.focus(), 60);
  }
  // ＋ 按钮：小菜单（新建 / 导入）
  // 新建歌单弹窗（替代原生 prompt）：resolve 用户输入的名字，取消 resolve null
  function newPlaylistPrompt() {
    return new Promise((resolve) => {
      const mask = $('#npModal'), input = $('#npName'), ok = $('#npOk'), cancel = $('#npCancel');
      let done = false;
      const finish = (val) => { if (done) return; done = true; mask.classList.remove('open'); resolve(val); };
      input.value = '';
      ok.onclick = () => { const n = input.value.trim(); if (n) finish(n); else input.focus(); };
      cancel.onclick = () => finish(null);
      mask.onclick = (e) => { if (e.target === mask) finish(null); };
      input.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); else if (e.key === 'Escape') finish(null); };
      mask.classList.add('open');
      setTimeout(() => input.focus(), 60);
    });
  }
  window.newPlaylistPrompt = newPlaylistPrompt;
  function mountPlMenu() {
    const btn = $('#createPlaylist'); if (!btn) return;
    let menu = document.getElementById('plMenu');
    if (!menu) {
      menu = document.createElement('div'); menu.id = 'plMenu';
      menu.innerHTML = '<div data-a="new">新建歌单</div><div data-a="import">导入外部歌单</div>';
      document.body.appendChild(menu);
      menu.addEventListener('click', async (e) => {
        const a = e.target.dataset.a; menu.classList.remove('show');
        if (a === 'new') { const n = await newPlaylistPrompt(); if (n) await Library.createPlaylist(n); }
        else if (a === 'import') importExtPlaylist();
      });
      document.addEventListener('click', (e) => { if (!e.target.closest('#plMenu, #createPlaylist')) menu.classList.remove('show'); });
    }
    btn.onclick = (e) => {
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      menu.style.left = Math.min(r.left, window.innerWidth - 170) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.classList.toggle('show');
    };
  }
  mountPlMenu();
  // 调试：?imp=1 自动打开导入弹窗（无头截图用）
  if (/[?&]imp=1\b/.test(location.search)) setTimeout(importExtPlaylist, 1400);

  // ---------- 加入歌单弹窗 ----------
  let modalSong = null;
  async function openAddModal(song) {
    modalSong = song;
    // 没有任何歌单时：直接引导新建，建完把这首歌加进去（不必先看空列表）
    if (!Library.playlists.length) {
      const n = await newPlaylistPrompt();
      if (n) { const pl = await Library.createPlaylist(n); if (pl && modalSong) { await Library.addToPlaylist(pl.id, modalSong); toast('已加入「' + n + '」'); } }
      return;
    }
    const list = $('#plModalList');
    list.innerHTML = Library.playlists.map(p => `<div class="pl-opt" data-pid="${p.id}">${esc(p.name)}</div>`).join('');
    list.querySelectorAll('.pl-opt').forEach(o => o.onclick = async () => {
      await Library.addToPlaylist(o.dataset.pid, modalSong); await Library.refreshPlaylists(); closeModal(); toast('已加入歌单');
    });
    $('#plModal').classList.add('open');
  }
  function closeModal() { $('#plModal').classList.remove('open'); }
  window.openAddModal = openAddModal;   // 供播放栏/全屏页给"当前播放歌曲"加入歌单
  $('#plModal').addEventListener('click', (e) => { if (e.target.id === 'plModal') closeModal(); });
  $('#plModalNew').onclick = async () => { const n = await newPlaylistPrompt(); if (n) { const pl = await Library.createPlaylist(n); if (pl && modalSong) { await Library.addToPlaylist(pl.id, modalSong); } closeModal(); toast('已加入「' + n + '」'); } };

  // ---------- 底部播放条 ----------
  const PB = {
    cover: $('#pbCover'), name: $('#pbName'), artist: $('#pbArtist'), like: $('#pbLike'),
    play: $('#pbPlay'), prev: $('#pbPrev'), next: $('#pbNext'), mode: $('#pbMode'),
    cur: $('#pbCur'), dur: $('#pbDur'), bar: $('#pbBar'), fill: $('#pbFill'), tip: $('#pbTip'), ring: $('#pbRing'),
    expand: $('#pbExpand'), lyric: $('#pbLyric'), queue: $('#pbQueue'),
    comment: $('#pbComment'), lyricLine: $('#pbLyricLine'), download: $('#pbDownload'), addpl: $('#pbAddpl'), viz: $('#pbViz'),
    qWrap: $('#pbQ'), qBtn: $('#pbQualityBtn'), qLabel: $('#pbQualityLabel'), qMenu: $('#pbQualityMenu'),
    speedWrap: $('#pbSpeed'), speedBtn: $('#pbSpeedBtn'), speedMenu: $('#pbSpeedMenu'),
    volWrap: $('#pbVolWrap'), volBtn: $('#pbVolBtn'), volTrack: $('#pbVolTrack'),
    volFill: $('#pbVolFill'), volThumb: $('#pbVolThumb'), volNum: $('#pbVolNum'), volMute: $('#pbVolMute'),
  };
  let curSpeed = parseFloat(localStorage.getItem('player_speed') || '1') || 1;
  const QUALITY_LABEL = { standard: '标准', hq: 'HQ', flac: '无损', master: '母带' };
  const MODE_ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    single: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="9.2" y="15.5" font-size="8.5" fill="currentColor" stroke="none">1</text></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
  };
  const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  const COMMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4.5A2 2 0 0 1 3 15V7a2 2 0 0 1 2-2z"/><path d="M7 8h10M7 12h7M7 16h4"/></svg>';

  function setQualityLabel(q) { PB.qLabel.textContent = QUALITY_LABEL[q] || '标准'; PB.qMenu.querySelectorAll('.pb-q-item').forEach(it => it.classList.toggle('active', it.dataset.q === q)); }
  function initPlaybar() {
    const p = window.player;
    PB.cover.src = IMG_PLACEHOLDER;
    setQualityLabel(p.quality || 'standard');
    PB.play.onclick = () => {
      if (p._needLoad && p.playlist && p.playlist.length) { p._needLoad = false; p.playQQMusicPlaylist(p.playlist, p.currentIndex); return; }
      if (queueEmpty()) { playRandom(); return; }
      p.togglePlay();
    };
    PB.prev.onclick = () => p.previousSong();
    PB.next.onclick = () => p.nextSong();
    PB.mode.onclick = () => { p.togglePlayMode(); setMode(); };
    PB.qBtn.onclick = (e) => { e.stopPropagation(); PB.qWrap.classList.toggle('open'); };
    PB.qMenu.querySelectorAll('.pb-q-item').forEach(it => it.onclick = () => { const q = it.dataset.q; p.setQuality(q); setQualityLabel(q); PB.qWrap.classList.remove('open'); });
    document.addEventListener('click', (e) => {
      PB.qWrap.classList.remove('open'); PB.speedWrap.classList.remove('open');
      if (PB.volWrap) PB.volWrap.classList.remove('open');
      // 点击播放列表面板外部关闭（排除队列按钮与面板自身）
      const qp = $('#queuePanel');
      if (qp && qp.classList.contains('open') && !qp.contains(e.target) && !(PB.queue && PB.queue.contains(e.target))) {
        qp.classList.remove('open');
      }
    });
    // 倍速
    const fmtSpeed = (s) => (Number.isInteger(s) ? s.toFixed(1) : String(s)) + 'x';
    const applySpeed = (s) => { curSpeed = s; try { p.audio.playbackRate = s; } catch (e) {} PB.speedBtn.textContent = fmtSpeed(s); PB.speedMenu.querySelectorAll('div').forEach(d => d.classList.toggle('active', parseFloat(d.dataset.s) === s)); };
    PB.speedBtn.onclick = (e) => { e.stopPropagation(); PB.speedWrap.classList.toggle('open'); };
    PB.speedMenu.querySelectorAll('div').forEach(it => it.onclick = () => { const s = parseFloat(it.dataset.s); applySpeed(s); try { localStorage.setItem('player_speed', s); } catch (e) {} PB.speedWrap.classList.remove('open'); });
    applySpeed(curSpeed);
    // 暴露给全屏播放页的倍速控件，保持与底栏一致
    window.setPlaybackSpeed = (s) => { s = parseFloat(s) || 1; applySpeed(s); try { localStorage.setItem('player_speed', s); } catch (e) {} };
    window.getPlaybackSpeed = () => curSpeed;
    // 音量：喇叭按钮弹出竖向调节条（默认 100）
    const VOL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    const VOL_MUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>';
    let lastVol = parseFloat(localStorage.getItem('player_vol') || '1');
    const renderVol = (v) => {
      const pct = Math.round(v * 100);
      PB.volFill.style.height = pct + '%';
      PB.volThumb.style.bottom = pct + '%';
      PB.volNum.textContent = pct + '%';
      PB.volBtn.innerHTML = v === 0 ? VOL_MUTE_ICON : VOL_ICON;
      PB.volMute.innerHTML = v === 0 ? VOL_MUTE_ICON : VOL_ICON;
      PB.volMute.classList.toggle('muted', v === 0);
    };
    const applyVol = (v, save) => { v = Math.max(0, Math.min(1, v)); p.audio.volume = v; p.volume = v; renderVol(v); if (save) try { localStorage.setItem('player_vol', v); } catch (e) {} };
    // 音量真值 = 逻辑音量 p.volume：切歌加载期引擎会把 audio.volume 淡出置 0（'playing' 才淡回），
    // 读 audio.volume 会在该窗口把"静音"误判成"已静音→恢复"。
    const logicalVol = () => (typeof p.volume === 'number' && !isNaN(p.volume)) ? Math.max(0, Math.min(1, p.volume)) : (p.audio.volume || 0);
    applyVol(lastVol);
    PB.volBtn.onclick = (e) => { e.stopPropagation(); PB.volWrap.classList.toggle('open'); };
    PB.volPopStop = $('#pbVolPop'); PB.volPopStop.onclick = (e) => e.stopPropagation();
    PB.volMute.onclick = (e) => { e.stopPropagation(); const cur = logicalVol(); if (cur > 0) { lastVol = cur; applyVol(0, true); } else { applyVol(lastVol || 1, true); } };
    const volFromEvent = (ev) => {
      const r = PB.volTrack.getBoundingClientRect();
      const y = (ev.touches && ev.touches[0]) ? ev.touches[0].clientY : ev.clientY;
      return 1 - Math.max(0, Math.min(1, (y - r.top) / r.height));
    };
    PB.volTrack.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); applyVol(volFromEvent(ev), true);
      const mv = (e2) => applyVol(volFromEvent(e2), true);
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    PB.volTrack.addEventListener('touchstart', (ev) => {
      ev.preventDefault(); applyVol(volFromEvent(ev), true);
      const mv = (e2) => applyVol(volFromEvent(e2), true);
      const up = () => { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); };
      document.addEventListener('touchmove', mv); document.addEventListener('touchend', up);
    }, { passive: false });
    PB.volPopStop.addEventListener('wheel', (ev) => { ev.preventDefault(); applyVol(logicalVol() + (ev.deltaY < 0 ? 0.05 : -0.05), true); }, { passive: false });
    PB.expand.onclick = () => window.NowPlaying && window.NowPlaying.open(false);
    // 「词」按钮 = 桌面歌词显示/隐藏（合并原桌面歌词按钮）
    PB.lyric.onclick = () => { if (window.DeskLyric) { const on = window.DeskLyric.toggle(); PB.lyric.classList.toggle('active', on); } };
    setTimeout(() => { if (window.DeskLyric) PB.lyric.classList.toggle('active', window.DeskLyric.isOn()); }, 800);
    const positionQueuePanel = () => {
      const panel = $('#queuePanel'); if (!panel || !PB.queue) return;
      const button = PB.queue.getBoundingClientRect(), width = panel.offsetWidth || 360;
      panel.style.width = Math.min(300, window.innerWidth - 16) + 'px';
      const actualWidth = panel.offsetWidth || width;
      panel.style.left = Math.max(8, Math.min(window.innerWidth - actualWidth - 8, button.left + button.width / 2 - actualWidth / 2)) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = Math.max(84, window.innerHeight - button.top + 12) + 'px'; panel.style.transform = 'none';
    };
    window.addEventListener('resize', () => { if ($('#queuePanel').classList.contains('open')) positionQueuePanel(); });
    PB.queue.onclick = () => { toggleQueue(); if ($('#queuePanel').classList.contains('open')) requestAnimationFrame(positionQueuePanel); };
    $('#qpClear').onclick = clearQueue;
    { const qc = $('#qpClose'); if (qc) qc.onclick = () => $('#queuePanel').classList.remove('open'); }
    PB.cover.onclick = PB.expand.onclick;
    PB.name.onclick = PB.expand.onclick;
    PB.like.onclick = () => { if (p.currentSong) Library.toggleLike(p.currentSong); };
    if (PB.comment) { PB.comment.innerHTML = COMMENT_ICON; PB.comment.onclick = () => openComments(); }
    if (PB.download) PB.download.onclick = () => { if (p.currentSong) downloadSong(p.currentSong, PB.download); };
    if (PB.addpl) PB.addpl.onclick = () => { if (p.currentSong) openAddModal(p.currentSong); };
    pbStartLyric();   // 底部播放条逐字歌词
    startViz();       // 律动波形
    // 进度条：点击 + 拖动 + 悬停预览（左侧时间随光标变化，点击/松开即跳到该时间）
    const pbRatio = (e) => { const r = PB.bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    const pbDur = () => { const st = p.getState(); return st.duration || (p.audio && p.audio.duration) || 0; };
    // 光标位置对应的歌词文本（悬停气泡用）
    const pbLyricAt = (t) => { const ly = p.lyrics || []; let txt = ''; for (let i = 0; i < ly.length; i++) { if (ly[i].time <= t) txt = ly[i].text || ''; else break; } return txt; };
    PB.bar.addEventListener('mousedown', (e) => { PB._drag = true; const rt = pbRatio(e); PB.fill.style.width = rt * 100 + '%'; PB.cur.textContent = fmtTime(rt * pbDur()); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (!PB._drag) return; const rt = pbRatio(e); PB.fill.style.width = rt * 100 + '%'; PB.cur.textContent = fmtTime(rt * pbDur()); });
    window.addEventListener('mouseup', (e) => { if (!PB._drag) return; PB._drag = false; p.seekTo(pbRatio(e) * pbDur()); });
    // 触摸拖动（触屏/安卓）：touch 事件在 touchstart 后持续派发到 bar，无需绑到 window
    const pbTouchRatio = (e) => { const t = e.touches[0] || e.changedTouches[0]; return t ? pbRatio(t) : 0; };
    PB.bar.addEventListener('touchstart', (e) => { PB._drag = true; const rt = pbTouchRatio(e); PB.fill.style.width = rt * 100 + '%'; PB.cur.textContent = fmtTime(rt * pbDur()); e.preventDefault(); }, { passive: false });
    PB.bar.addEventListener('touchmove', (e) => { if (!PB._drag) return; const rt = pbTouchRatio(e); PB.fill.style.width = rt * 100 + '%'; PB.cur.textContent = fmtTime(rt * pbDur()); e.preventDefault(); }, { passive: false });
    PB.bar.addEventListener('touchend', (e) => { if (!PB._drag) return; PB._drag = false; p.seekTo(pbTouchRatio(e) * pbDur()); });
    // 悬停（非拖动）：左侧时间随光标 + 光标位置歌词气泡（无圆点游标），移开恢复实际播放时间
    PB.bar.addEventListener('mousemove', (e) => {
      if (PB._drag) return;
      PB._hover = true;
      const rt = pbRatio(e);
      PB.cur.textContent = fmtTime(rt * pbDur());
      if (PB.tip) { const tx = pbLyricAt(rt * pbDur()); PB.tip.textContent = tx; PB.tip.style.left = (rt * 100) + '%'; PB.tip.classList.toggle('show', !!tx); }
    });
    PB.bar.addEventListener('mouseleave', () => {
      PB._hover = false;
      if (PB.tip) PB.tip.classList.remove('show');
      if (PB._drag) return;
      const t = (p.audio && p.audio.currentTime) || (p.getState().currentTime) || 0;
      PB.cur.textContent = fmtTime(t);
    });

    p.on('songchange', (s) => {
      state.currentId = s.id;
      PB.cover.src = httpsify(s.picUrl || s.pic) || IMG_PLACEHOLDER;
      PB.name.textContent = s.name || '未知歌曲';
      PB.artist.textContent = s.artists || s.artist || '';
      PB.like.dataset.likeId = s.id;
      updateVizColor(s.picUrl || s.pic);
      refreshLikedUI(); markPlaying();
      Library.addRecent(s);
      setTimeout(() => { try { p.audio.playbackRate = curSpeed; } catch (e) {} }, 200);
      if ($('#queuePanel').classList.contains('open')) renderQueue();
      p._needLoad = false;   // 已真正加载播放
      Queue.save();          // 队列/进度变化 → 持久化
      pbLyrIdx = -2;   // 强制刷新底部逐字歌词
      // 评论面板打开时，切歌自动刷新评论
      if (CM.panel.classList.contains('open')) { cmState.mid = s.id; cmState.sort = 'hot'; $$('#commentPanel .cm-tabs button').forEach(t => t.classList.toggle('active', t.dataset.s === 'hot')); loadComments(true); }
    });
    p.on('playstate', () => { try { p.audio.playbackRate = curSpeed; } catch (e) {} });
    p.on('timeupdate', (d) => {
      if (!PB._drag && !PB._hover) PB.cur.textContent = fmtTime(d.currentTime);   // 悬停时不被拉回
      PB.dur.textContent = fmtTime(d.duration);
      const pct = d.duration ? (d.currentTime / d.duration * 100) : 0;
      if (!PB._drag) {
        PB.fill.style.width = pct + '%';
        if (PB.ring) PB.ring.style.strokeDashoffset = (100 - pct);   // 封面环形进度（移动端）
      }
    });
    p.on('playstate', (pl) => { PB.play.innerHTML = pl ? PAUSE_ICON : PLAY_ICON; });
    p.on('qualitychange', (q) => setQualityLabel(q));
    setMode();

    // 移动端：播放栏左右滑动切歌（左滑下一首 / 右滑上一首）。排除按钮/进度条/封面，避免误触。
    const pbContent = document.querySelector('.playbar .pb-content');
    if (pbContent) {
      let sx = 0, sy = 0, tracking = false;
      pbContent.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) { tracking = false; return; }   // 多指（缩放等）不算滑动
        if (e.target.closest('button, a, input, .pb-progress, .pb-cover-wrap, .pb-q-menu, .pb-speed-menu')) { tracking = false; return; }
        const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = true;
      }, { passive: true });
      pbContent.addEventListener('touchend', (e) => {
        if (!tracking || e.touches.length) return; tracking = false;
        const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;   // 主要横向且够长才算切歌
        if (window.__togetherFollowing) return;   // 一起听跟随中不切歌（房主制）
        if (queueEmpty()) { playRandom(); return; }   // 空队列滑动=随手来一首（与双击播放键一致）
        if (dx < 0) p.nextSong(); else p.previousSong();
      }, { passive: true });
    }
    // 移动端：点封面直接进全屏播放页（无 hover）
    PB.cover.addEventListener('click', () => { if (window.NowPlaying) window.NowPlaying.open(); });
  }
  function setMode() { const m = (window.player && window.player.playMode) || 'list'; PB.mode.innerHTML = MODE_ICON[m] || MODE_ICON.list; PB.mode.title = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' }[m]; PB.mode.classList.toggle('active', m !== 'list'); }

  // ---------- 播放队列面板 ----------
  function renderQueue() {
    const p = window.player; const list = p.playlist || [];
    $('#qpCount').textContent = list.length ? `${list.length} 首` : '';
    const box = $('#qpList');
    if (!list.length) { box.innerHTML = '<div class="empty-tip" style="padding:24px">队列是空的</div>'; return; }
    box.innerHTML = list.map((s, i) => `<div class="qp-row ${i === p.currentIndex ? 'playing' : ''}" data-i="${i}">
      <span class="qi">${i === p.currentIndex ? '▶' : (i + 1)}</span>
      <div class="qt"><div class="qn">${esc(s.name || '')}</div><div class="qa">${esc(s.artists || s.artist || '')}</div></div>
      <button class="qx" title="移除">×</button></div>`).join('');
    box.querySelectorAll('.qp-row').forEach(r => {
      r.onclick = (e) => { if (e.target.closest('.qx')) return; window.player.playQQMusicPlaylist(window.player.playlist, +r.dataset.i); setTimeout(renderQueue, 100); };
      r.querySelector('.qx').onclick = (e) => { e.stopPropagation(); removeFromQueue(+r.dataset.i); };
    });
    const cur = box.querySelector('.qp-row.playing'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function removeFromQueue(i) {
    const p = window.player; if (!p.playlist || !p.playlist[i]) return;
    if (i === p.currentIndex) {
      p.playlist.splice(i, 1);
      if (!p.playlist.length) { clearQueue(); return; }
      p.playQQMusicPlaylist(p.playlist, i % p.playlist.length);
      setTimeout(renderQueue, 100); return;
    }
    p.playlist.splice(i, 1);
    if (i < p.currentIndex) p.currentIndex--;
    renderQueue();
    if (window.Queue) window.Queue.save();
  }
  function clearQueue() {
    const p = window.player;
    try { p.audio.pause(); p.audio.removeAttribute('src'); p.audio.load(); } catch (e) {}
    p.playlist = []; p.currentIndex = 0; p.currentSong = null; state.currentId = null; p._needLoad = false;
    PB.name.textContent = '未在播放'; PB.artist.textContent = ''; PB.cover.src = IMG_PLACEHOLDER;
    PB.fill.style.width = '0%'; if (PB.ring) PB.ring.style.strokeDashoffset = 100; PB.cur.textContent = '0:00'; PB.dur.textContent = '0:00';
    renderQueue();
    if (window.Queue) window.Queue.save();
  }
  function toggleQueue() {
    const panel = $('#queuePanel');
    const open = panel.classList.toggle('open');
    if (open) { renderQueue(); if (window.Comments) window.Comments.close(); }   // 互斥：开播放列表关评论
  }
  // 暴露给全屏播放页的播放列表使用
  window.QueueCtl = {
    list: () => (window.player && window.player.playlist) || [],
    index: () => (window.player ? window.player.currentIndex : -1),
    play: (i) => { const p = window.player; if (p && p.playlist && p.playlist[i]) p.playQQMusicPlaylist(p.playlist, i); },
    remove: (i) => removeFromQueue(i),
    clear: () => clearQueue(),
  };

  // ---------- 播放队列持久化（按账号独立，未登录=公共账号；刷新不丢） ----------
  const Queue = {
    _t: null,
    save() {
      if (window.__togetherFollowing) return;   // 一起听跟随中：不把同步的歌覆盖用户自己的队列
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        const p = window.player; if (!p) return;
        const songs = (p.playlist || []).map(s => ({ id: s.id, name: s.name, artist: s.artists || s.artist || '', pic: s.picUrl || s.pic || '', album: s.album || '', duration: s.duration || 0 }));
        api('/api/library/queue', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songs, index: p.currentIndex || 0 }) }).catch(() => {});
      }, 700);
    },
    async restore() {
      try { const r = await api('/api/library/queue'); const d = (r && r.data) || {}; if (d.songs && d.songs.length) restoreQueue(d.songs, d.index || 0); } catch (e) {}
    },
  };
  window.Queue = Queue;
  // 把保存好的队列恢复到引擎（不自动播放；首次点播放再加载音频）
  function restoreQueue(songs, index) {
    const p = window.player; if (!p || !songs || !songs.length) return;
    p.playlist = songs.map(toEngine);
    p.currentIndex = Math.max(0, Math.min(index || 0, p.playlist.length - 1));
    p.currentSong = p.playlist[p.currentIndex];
    p._needLoad = true;
    state.currentId = p.currentSong.id;
    PB.cover.src = httpsify(p.currentSong.picUrl) || IMG_PLACEHOLDER;
    PB.name.textContent = p.currentSong.name || '未知歌曲';
    PB.artist.textContent = p.currentSong.artists || '';
    PB.like.dataset.likeId = p.currentSong.id;
    updateVizColor(p.currentSong.picUrl);
    refreshLikedUI(); markPlaying();
  }

  // ---------- 底部播放条逐字歌词 ----------
  let pbLyrRAF = null, pbLyrIdx = -2, pbLyrSpans = null, pbLyrWords = null;
  function pbUpdateLyric() {
    const p = window.player, el = PB.lyricLine;
    if (!el) return;
    const info = el.parentElement;
    if (!p || !p.currentSong) { if (pbLyrIdx !== -3) { el.textContent = ''; info && info.classList.remove('has-lyric'); pbLyrIdx = -3; pbLyrSpans = pbLyrWords = null; } return; }
    const ly = p.lyrics || [], idx = p.currentLyricIndex;
    if (!ly.length) { if (pbLyrIdx !== -4) { el.textContent = ''; info && info.classList.remove('has-lyric'); pbLyrIdx = -4; pbLyrSpans = pbLyrWords = null; } return; }
    const c = idx >= 0 ? ly[idx] : null, n = idx >= 0 ? ly[idx + 1] : null;
    const wbw = window.AppSettings && window.AppSettings.wordByWord && window.AppSettings.wordByWord.enabled;
    const hasWords = !!(c && c.words && c.words.length && wbw);
    info && info.classList.add('has-lyric');
    if (idx !== pbLyrIdx) {
      pbLyrIdx = idx;
      el.classList.remove('marquee'); el.style.removeProperty('--pbl-dist'); el.style.removeProperty('--pbl-dur');
      if (!c) { el.classList.remove('wbw'); el.innerHTML = '<span class="pbl-in">♪</span>'; pbLyrSpans = pbLyrWords = null; }
      else if (hasWords) { el.classList.add('wbw'); el.innerHTML = '<span class="pbl-in">' + c.words.map(w => `<span class="kw">${esc(w.text)}</span>`).join('') + '</span>'; pbLyrSpans = el.querySelectorAll('.kw'); pbLyrWords = c.words; }
      else { el.classList.remove('wbw'); el.innerHTML = '<span class="pbl-in">' + esc(c.text || '♪') + '</span>'; pbLyrSpans = pbLyrWords = null; }
      // 歌词过长不省略：溢出则横向来回滚动完整显示
      const inner = el.querySelector('.pbl-in');
      if (inner && el.clientWidth > 20) {
        const over = inner.scrollWidth - el.clientWidth;
        if (over > 6) { el.classList.add('marquee'); el.style.setProperty('--pbl-dist', (-(over + 8)) + 'px'); el.style.setProperty('--pbl-dur', Math.max(5, (over + 8) / 28) + 's'); }
      }
    }
    if (hasWords && pbLyrSpans && pbLyrWords) {
      const t = (p.audio && p.audio.currentTime) || p.currentTime || 0;   // 实时 audio 时间(60fps)，避免 4fps 卡顿
      for (let i = 0; i < pbLyrWords.length; i++) {
        const start = pbLyrWords[i].time;
        const end = i + 1 < pbLyrWords.length ? pbLyrWords[i + 1].time : (n ? n.time : start + 0.6);
        let pct = end > start ? (t - start) / (end - start) : (t >= start ? 1 : 0);
        pct = pct < 0 ? 0 : pct > 1 ? 1 : pct;
        const sp = pbLyrSpans[i];
        if (sp) { const v = (pct * 100).toFixed(1) + '%'; if (sp._p !== v) { sp._p = v; sp.style.setProperty('--p', v); } }
      }
    }
  }
  function pbStartLyric() { if (pbLyrRAF) return; const loop = () => { pbUpdateLyric(); pbLyrRAF = requestAnimationFrame(loop); }; loop(); }

  // ---------- 律动波形可视化（封面取色，进度条上方；底栏 + 全屏共用） ----------
  let vizColor = [90, 170, 255], vizRAF = null;
  function updateVizColor(picUrl) {
    if (!picUrl) return;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); const w = cv.width = 24, h = cv.height = 24; const cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0, w, h); const data = cx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0, fr = 0, fg = 0, fb = 0, fn = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i], G = data[i + 1], B = data[i + 2], A = data[i + 3]; if (A < 125) continue;
          r += R; g += G; b += B; n++;
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B), s = mx ? (mx - mn) / mx : 0;
          if (s > 0.28 && mx > 55 && mx < 250) { fr += R; fg += G; fb += B; fn++; }
        }
        let c = fn > n * 0.05 ? [fr / fn, fg / fn, fb / fn] : (n ? [r / n, g / n, b / n] : null);
        // 深色条上提亮更醒目；浅色主题播放条是白底 → 反向压暗保证可见
        const lightTheme = window.Theme && window.Theme.get && window.Theme.get() === 'light';
        if (c) vizColor = lightTheme
          ? c.map(v => Math.round(Math.max(0, v * 0.72 - 6)))
          : c.map(v => Math.round(Math.min(255, v * 1.1 + 35)));
      } catch (e) {}
    };
    img.src = '/api/img?url=' + encodeURIComponent(picUrl);
  }
  function sizeViz(cv) { if (!cv) return; const w = cv.clientWidth || cv.offsetWidth, hh = cv.clientHeight || cv.offsetHeight; if (w && (cv.width !== w || cv.height !== hh)) { cv.width = w; cv.height = hh || 40; } }
  // 频谱样式（设置 → 播放器样式）：off/classic/wave/lines/columns/flame/radial/particles
  function vizStyleName() { const ps = window.AppSettings && window.AppSettings.playerStyle; return (ps && ps.viz) || 'wave'; }
  // 确定性伪噪声（无 analyser，纯程序化律动；同参数同输出，暂停即静止）
  const vizNz = (i, p) => Math.sin(i * 12.9898 + p * 2.3) * Math.sin(i * 78.233 + p * 1.7);
  function rgbHue(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const VIZ_DRAW = {
    // 梦幻波浪：三层正弦叠波（原经典实现）
    wave(ctx, W, H, ph0, en, [r, g, b]) {
      const cy = H / 2, ampBase = H * 0.28;
      const waves = [
        { amp: 1.0, freq: 1.6, sp: 1.0, op: 0.95, lw: 2.4 },
        { amp: 0.72, freq: 2.4, sp: -0.7, op: 0.55, lw: 1.8 },
        { amp: 0.5, freq: 3.3, sp: 1.5, op: 0.32, lw: 1.5 },
      ];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < waves.length; i++) {
        const wv = waves[i]; ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const ph = ph0 * wv.sp * 3.2 + i * 1.3;
          const taper = Math.sin((x / W) * Math.PI);
          const y = cy + Math.sin((x / W) * Math.PI * wv.freq * 2 + ph) * ampBase * wv.amp * en * (0.62 + 0.38 * taper);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${wv.op})`; ctx.lineWidth = wv.lw;
        ctx.shadowColor = `rgba(${r},${g},${b},.9)`; ctx.shadowBlur = 8;
        ctx.stroke();
      }
    },
    // 经典：底部竖条频谱
    classic(ctx, W, H, ph, en, [r, g, b]) {
      const n = Math.max(16, Math.floor(W / 14)), step = W / n, bw = step * 0.62;
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.abs(Math.sin(i * 0.35 + ph * 3.1) * 0.6 + vizNz(i, ph) * 0.4));
        const h = Math.max(2, H * 0.92 * v * Math.min(1.2, en));
        ctx.fillStyle = `rgba(${r},${g},${b},${0.3 + 0.65 * v})`;
        ctx.fillRect(i * step + (step - bw) / 2, H - h, bw, h);
      }
    },
    // 动感线条：双层折线示波
    lines(ctx, W, H, ph, en, [r, g, b]) {
      ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
      for (let l = 0; l < 2; l++) {
        ctx.beginPath();
        const seg = 26;
        for (let i = 0; i <= seg; i++) {
          const x = i / seg * W;
          const v = vizNz(i + l * 40, ph * (1.5 + l * 0.6));
          const y = H / 2 + v * H * 0.42 * en * (0.5 + 0.5 * Math.sin(i / seg * Math.PI));
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${l ? 0.4 : 0.9})`;
        ctx.lineWidth = l ? 1.4 : 2.2;
        ctx.stroke();
      }
    },
    // 魔幻光柱：中线对称发光柱，色相随位置/时间流转
    columns(ctx, W, H, ph, en, [r, g, b]) {
      const hue = rgbHue(r, g, b);
      const n = Math.max(10, Math.floor(W / 34)), step = W / n, bw = step * 0.5, cy = H / 2;
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.abs(Math.sin(i * 0.9 + ph * 2.6) + vizNz(i, ph)) / 2);
        const h = Math.max(2, H * 0.46 * v * Math.min(1.25, en));
        const col = `hsla(${(hue + i * 14 + ph * 46) % 360},85%,62%,.85)`;
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
        ctx.fillRect(i * step + (step - bw) / 2, cy - h, bw, h * 2);
      }
      ctx.shadowBlur = 0;
    },
    // 热情火焰：底部火苗（红→橙→黄渐变，快速抖动）
    flame(ctx, W, H, ph, en) {
      const n = Math.max(20, Math.floor(W / 10)), bw = W / n;
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.abs(Math.sin(i * 0.55 + ph * 4.2) * 0.55 + vizNz(i, ph * 1.9) * 0.45));
        const h = Math.max(2, H * 0.95 * v * Math.min(1.15, en));
        const g2 = ctx.createLinearGradient(0, H, 0, H - h);
        g2.addColorStop(0, 'rgba(220,38,38,.9)'); g2.addColorStop(0.55, 'rgba(249,115,22,.85)'); g2.addColorStop(1, 'rgba(253,224,71,.7)');
        ctx.fillStyle = g2;
        ctx.fillRect(i * bw, H - h, bw * 0.7, h);
      }
    },
    // 旋转音波：环形射线绕中心旋转
    radial(ctx, W, H, ph, en, [r, g, b]) {
      const cx = W / 2, cy = H / 2, r0 = Math.min(W, H) * 0.26, n = 60;
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + ph * 0.9;
        const v = Math.min(1, Math.abs(Math.sin(i * 0.7 + ph * 3.4) + vizNz(i, ph)) / 2);
        const len = r0 * 0.22 + r0 * 0.85 * v * Math.min(1.2, en);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.28 + 0.62 * v})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        ctx.stroke();
      }
    },
    // 旋转粒子：椭圆轨道环绕的光点
    particles(ctx, W, H, ph, en, [r, g, b]) {
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < 28; i++) {
        const sp = 0.5 + (i % 5) * 0.22;
        const a = ph * sp + i * 2.399;
        const k = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.3 + ph * 0.8));
        const x = cx + Math.cos(a) * W * 0.44 * k;
        const y = cy + Math.sin(a) * H * 0.38 * k;
        const s = 1.2 + 2.4 * Math.abs(vizNz(i, ph * 0.5)) * Math.min(1.2, en);
        ctx.fillStyle = `rgba(${r},${g},${b},${0.22 + 0.6 * Math.abs(Math.sin(a))})`;
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
  // phase 只在播放时推进（暂停=静止）；energy 是振幅（含节拍泵 → 动次打次）
  function drawViz(cv, phase, energy) {
    if (!cv || !cv.clientWidth) return;
    sizeViz(cv);
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const st = vizStyleName();
    if (st === 'off') return;
    (VIZ_DRAW[st] || VIZ_DRAW.wave)(ctx, W, H, phase, energy, vizColor);
  }
  let vizPhase = 0, vizEnergy = 0, vizLast = 0, vizWasOff = false;
  function startViz() {
    if (vizRAF) return;
    const loop = (t) => {
      if (!vizLast) vizLast = t; const dt = Math.min(60, t - vizLast); vizLast = t;
      const p = window.player;
      const playing = !!(p && p.audio && !p.audio.paused && p.currentSong);
      let target;
      if (playing) {
        // 节拍泵：每拍开头猛冲、快速衰减 → 动次打次（约 124BPM）
        const beat = (vizPhase * 2.07) % 1;
        const pump = Math.pow(1 - beat, 2.6);
        target = 0.7 + 0.9 * pump + 0.15 * Math.sin(vizPhase * 6.0);
        vizPhase += dt / 1000;                 // 只有播放才推进 → 暂停静止
      } else {
        target = 0.18;                         // 未播放：静止的浅波（不动）
      }
      vizEnergy += (target - vizEnergy) * (playing ? 0.22 : 0.05);
      // 频谱样式为「无频谱」时隐藏底栏画布（全屏页画布由 data-viz CSS 隐藏）
      const vizOff = vizStyleName() === 'off';
      if (vizOff !== vizWasOff) { vizWasOff = vizOff; if (PB.viz) PB.viz.style.visibility = vizOff ? 'hidden' : ''; }
      if (PB.viz && !vizOff) drawViz(PB.viz, vizPhase, vizEnergy);
      const npViz = document.querySelector('.np-viz');
      if (npViz && window.NowPlaying && window.NowPlaying.el && window.NowPlaying.el.classList.contains('open')) drawViz(npViz, vizPhase, vizEnergy);
      vizRAF = requestAnimationFrame(loop);
    };
    vizRAF = requestAnimationFrame(loop);
    window.addEventListener('resize', () => { sizeViz(PB.viz); sizeViz(document.querySelector('.np-viz')); });
  }

  // ---------- 评论面板 ----------
  const CM = { panel: $('#commentPanel'), list: $('#cmList'), count: $('#cmCount'), close: $('#cmClose') };
  let cmState = { sort: 'hot', mid: null, page: 1, loading: false, done: false };
  function cmRow(c) {
    return `<div class="cm-row">
      <img class="cm-av" loading="lazy" src="${esc(httpsify(c.avatar) || IMG_PLACEHOLDER)}" alt="">
      <div class="cm-body">
        <div class="cm-top"><span class="cm-user">${esc(c.user || '匿名')}</span>${c.liked ? `<span class="cm-like">${ICONS.heart} ${fmtCount(c.liked)}</span>` : ''}</div>
        <div class="cm-text">${esc(c.content || '')}</div>
        <div class="cm-meta">${esc(c.time || '')}${c.ip ? ' · ' + esc(c.ip) : ''}</div>
      </div>
    </div>`;
  }
  async function loadComments(reset) {
    const s = window.player && window.player.currentSong; if (!s) return;
    if (cmState.loading || (cmState.done && !reset)) return;
    cmState.loading = true;
    if (reset) { cmState.page = 1; cmState.done = false; CM.list.innerHTML = '<div class="cm-loading">加载评论中…</div>'; }
    try {
      const r = await api(`/api/comments?mid=${encodeURIComponent(s.id)}&sort=${cmState.sort}&page=${cmState.page}&limit=20`);
      const d = (r && r.data) || {};
      if (reset) {
        CM.count.textContent = d.total ? fmtCount(d.total) : '';
        let html = '';
        if (cmState.sort === 'hot' && d.hot && d.hot.length) html += '<div class="cm-section">热门评论</div>' + d.hot.map(cmRow).join('');
        if (d.list && d.list.length) html += `<div class="cm-section">${cmState.sort === 'hot' ? '最新评论' : ''}</div>` + d.list.map(cmRow).join('');
        CM.list.innerHTML = html || `<div class="cm-empty">${d.msg || '暂无评论'}</div>`;
        CM.list.scrollTop = 0;
      } else {
        CM.list.insertAdjacentHTML('beforeend', (d.list || []).map(cmRow).join(''));
      }
      cmState.done = !d.hasMore;
      cmState.page++;
    } catch (e) { if (reset) CM.list.innerHTML = '<div class="cm-empty">评论加载失败</div>'; }
    cmState.loading = false;
  }
  function openComments() {
    const s = window.player && window.player.currentSong;
    if (!s) { notice('请先播放一首歌曲，再查看评论', 'warning'); return; }
    $('#queuePanel').classList.remove('open');   // 互斥：开评论关播放列表
    if (window.NowPlaying && window.NowPlaying.closeQueue) window.NowPlaying.closeQueue();
    // 互斥：开评论关一起听面板（评论遮罩与面板同层，同时开会糊在一起）
    document.querySelectorAll('.tg-panel.open').forEach(el => el.classList.remove('open'));
    const mask = $('#cmMask'); if (mask) mask.classList.add('open');
    CM.panel.classList.add('open');
    if (cmState.mid !== s.id) { cmState.mid = s.id; cmState.sort = 'hot'; $$('#commentPanel .cm-tabs button').forEach(t => t.classList.toggle('active', t.dataset.s === 'hot')); loadComments(true); }
  }
  function closeComments() { CM.panel.classList.remove('open'); const mask = $('#cmMask'); if (mask) mask.classList.remove('open'); }
  // 暴露给全屏播放页的评论按钮
  window.Comments = { open: openComments, close: closeComments, toggle: () => { CM.panel.classList.contains('open') ? closeComments() : openComments(); } };
  if (CM.close) CM.close.onclick = closeComments;
  { const mask = $('#cmMask'); if (mask) mask.onclick = closeComments; }
  $$('#commentPanel .cm-tabs button').forEach(b => b.onclick = () => { cmState.sort = b.dataset.s; $$('#commentPanel .cm-tabs button').forEach(x => x.classList.toggle('active', x === b)); loadComments(true); });
  if (CM.list) CM.list.addEventListener('scroll', () => { if (CM.list.scrollTop + CM.list.clientHeight >= CM.list.scrollHeight - 120) loadComments(false); });
  document.addEventListener('click', (e) => {
    if (!CM.panel.classList.contains('open')) return;
    if (CM.panel.contains(e.target) || (PB.comment && PB.comment.contains(e.target)) || e.target.closest('.np-cbtn, .tg-panel, #tgBtn')) return;
    closeComments();
  });

  // ---------- 顶部搜索 ----------
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const q = e.target.value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); }
  });
  // #createPlaylist 的点击已由 mountPlMenu()（新建/导入菜单）接管

  // ---------- 移动端：侧边栏抽屉 ----------
  const sidebarEl = $('#sidebar'), backdrop = $('#sidebarBackdrop'), menuBtn = $('#menuBtn');
  function closeSidebar() { sidebarEl && sidebarEl.classList.remove('open'); backdrop && backdrop.classList.remove('show'); }
  function openSidebar() { sidebarEl && sidebarEl.classList.add('open'); backdrop && backdrop.classList.add('show'); }
  if (menuBtn) menuBtn.onclick = () => (sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar());
  if (backdrop) backdrop.onclick = closeSidebar;
  if (sidebarEl) sidebarEl.addEventListener('click', (e) => { if (e.target.closest('.item, .pl, .back-link, .login-btn, .lo')) closeSidebar(); });
  window.addEventListener('hashchange', closeSidebar);
  // 桌面：收起 / 展开侧边栏（body.sidebar-collapsed，状态持久化）
  {
    const setCollapsed = (on) => { document.body.classList.toggle('sidebar-collapsed', on); try { localStorage.setItem('sidebar_collapsed', on ? '1' : '0'); } catch (e) {} };
    if (localStorage.getItem('sidebar_collapsed') === '1' || /[?&]collapsed=1\b/.test(location.search)) document.body.classList.add('sidebar-collapsed');
    const cb = $('#sideCollapse'); if (cb) cb.onclick = () => setCollapsed(true);
    const ex = $('#sideExpand'); if (ex) ex.onclick = () => setCollapsed(false);
    const exb = $('#sideExpandBtm'); if (exb) exb.onclick = () => setCollapsed(false);
  }

  // ---------- 启动 ----------
  async function boot() {
    renderNav();
    initPlaybar();
    setupFM();      // 私人FM 自动续歌
    setupStats();   // 听歌统计上报
    await Library.init();
    Queue.restore();   // 恢复上次的播放队列（按账号）
    window.addEventListener('hashchange', () => router(false));   // 不能直挂 router：事件对象会被当成 force=true
    if (!location.hash) location.hash = '#/discover';
    router();
  }
  boot();
})();
