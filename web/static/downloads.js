/* 下载管理中心（P6）：任务列表 + 三平台执行器。
   - 浏览器/PWA：fetch 流式读进度 → Blob → <a download> 保存
   - PC 原生壳(shell-info caps 含 "dl"，≥v0.6)：事件桥 dl-start → Rust 下到用户选的目录，
     dl-progress/done/error 回报，可选目录/打开文件夹
   - 安卓壳：and-download → 系统 DownloadManager（通知栏进度，存 Music/AnonMusic/）
   旧壳(≤v0.5)没有 shell-info 握手 → 自动落到浏览器 Blob 路径，行为与之前一致。
   任务持久化 localStorage(dl_tasks_v1，最多留 100 条)。 */
(function () {
  'use strict';
  const KEY = 'dl_tasks_v1';
  const B = window.Bridge || {};
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; };
  // 属性上下文转义：textContent→innerHTML 不编码引号，拼进 src="..." 会被闭合注入。
  const escAttr = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let tasks = [];
  try { tasks = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
  // 上次会话未跑完的任务：浏览器/安卓下载随页面销毁而中断 → 标 error 可重试；
  // PC 原生下载跑在壳进程里、刷新不中断 → 标 'unknown'（不立即当失败，等 dl-done/dl-error 回报翻状态，避免误重试造成同名双写）。
  tasks.forEach(t => {
    if (t.status === 'running' || t.status === 'pending') {
      if (t.plat === 'pc') { t.status = 'unknown'; }
      else { t.status = 'error'; t.msg = '页面刷新中断'; }
    }
  });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tasks.slice(0, 100))); } catch (e) {} };
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let box = null;   // 下载页容器（打开时才渲染）
  let dlDir = '';   // PC 保存目录（Rust 持久化，dl-dir 事件同步）

  function platform() {
    if (B.ANDROID) return 'android';
    if (B.TAURI && B.has && B.has('dl')) return 'pc';
    return 'browser';
  }

  function fmtSize(n) {
    if (!n || !isFinite(n)) return '';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < 3) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + u[i];
  }

  function artistStr(s) {
    if (typeof s.artist === 'string' && s.artist) return s.artist;
    if (Array.isArray(s.artists)) return s.artists.map(a => a && a.name || '').filter(Boolean).join(', ');
    return (typeof s.artists === 'string') ? s.artists : '';
  }
  // song 里带 id(mid)+quality → 重试时重新解析 CDN 直链（旧链有签名时效，隔天必 403）
  function add(song, url, filename, meta) {
    const t = {
      id: uid(), name: song.name || filename, artist: artistStr(song),
      pic: song.pic || song.picUrl || '', url, filename,
      mid: (meta && meta.mid) || song.id || '', quality: (meta && meta.quality) || 'standard',
      status: 'pending', received: 0, total: 0, ts: Date.now(), plat: platform(),
    };
    tasks.unshift(t); save();
    if (t.plat === 'android') {
      // 系统 DownloadManager 接管（通知栏有进度，页面不再跟踪）
      B.emit('and-download', { url, filename, mime: /\.flac$/i.test(filename) ? 'audio/flac' : 'audio/mpeg' });
      t.status = 'system'; save(); rerender();
      return t.id;
    }
    if (t.plat === 'pc') {
      t.status = 'running'; save(); rerender();
      B.emit('dl-start', { id: t.id, url, filename });
      return t.id;
    }
    runBrowser(t); rerender();
    return t.id;
  }

  async function runBrowser(t) {
    t.status = 'running'; save(); rerender();
    try {
      const resp = await fetch(t.url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      t.total = +(resp.headers.get('content-length') || 0);
      let blob;
      if (resp.body && resp.body.getReader) {
        const reader = resp.body.getReader();
        const chunks = []; let last = 0;
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          chunks.push(r.value); t.received += r.value.length;
          const now = Date.now();
          if (now - last > 300) { last = now; rerender(); }
        }
        blob = new Blob(chunks);
      } else {
        blob = await resp.blob();
      }
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj; a.download = t.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 60000);
      t.received = t.total || t.received;
      t.status = 'done';
    } catch (e) {
      t.status = 'error'; t.msg = String((e && e.message) || e);
    }
    save(); rerender();
  }

  // ---- PC 壳事件回报 ----
  if (B.listen) {
    B.listen('dl-progress', (e) => {
      const p = e.payload || {}; const t = tasks.find(x => x.id === p.id);
      if (t) { t.received = p.received || 0; t.total = p.total || t.total; rerender(); }
    });
    B.listen('dl-done', (e) => {
      const p = e.payload || {}; const t = tasks.find(x => x.id === p.id);
      if (t) { t.status = 'done'; t.path = p.path || ''; t.received = t.total || t.received; save(); rerender(); }
    });
    B.listen('dl-error', (e) => {
      const p = e.payload || {}; const t = tasks.find(x => x.id === p.id);
      if (t) { t.status = 'error'; t.msg = p.msg || '下载失败'; save(); rerender(); }
    });
    B.listen('dl-dir', (e) => { dlDir = (e.payload || {}).path || ''; rerender(); });
  }

  // ---- 下载管理页 ----
  const ST = { pending: '等待', running: '下载中', done: '已完成', error: '失败', system: '已交系统下载', unknown: '状态未知（刷新前的下载）' };
  function row(t) {
    const pct = t.total ? Math.min(100, t.received / t.total * 100) : (t.status === 'done' ? 100 : 0);
    const sub = t.status === 'running'
      ? `${fmtSize(t.received)}${t.total ? ' / ' + fmtSize(t.total) : ''}`
      : (t.status === 'error' ? (t.msg || '失败') : ST[t.status] || '');
    return `<div class="dl-row st-${t.status}" data-id="${escAttr(t.id)}">
      <img class="dl-pic" src="${escAttr(t.pic || '')}" onerror="this.style.visibility='hidden'" alt="">
      <div class="dl-mid">
        <div class="dl-nm">${esc(t.name)}<span class="dl-ar">${t.artist ? ' · ' + esc(t.artist) : ''}</span></div>
        <div class="dl-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="dl-sub">${esc(sub)}</div>
      </div>
      <div class="dl-acts">
        ${(t.status === 'error' || t.status === 'unknown') ? '<button class="dl-btn dl-retry">重试</button>' : ''}
        ${t.status === 'done' && t.path ? '<button class="dl-btn dl-reveal">打开位置</button>' : ''}
        <button class="dl-btn dl-x" title="移除记录">✕</button>
      </div>
    </div>`;
  }

  function rerender() {
    if (!box || !document.body.contains(box)) { box = null; return; }
    const pc = platform() === 'pc';
    box.innerHTML = `
      <div class="dl-head">
        ${pc ? `<span class="dl-dir">保存到：${esc(dlDir || '默认下载目录')}</span>
          <button class="dl-btn" id="dlPick">更改目录</button>
          <button class="dl-btn" id="dlOpen">打开文件夹</button>` : ''}
        <span style="flex:1"></span>
        <button class="dl-btn" id="dlClear">清除已完成</button>
      </div>
      <div class="dl-list">${tasks.length ? tasks.map(row).join('') : '<div class="empty-tip">还没有下载任务，去歌曲列表点下载图标试试</div>'}</div>`;
    const pick = box.querySelector('#dlPick'); if (pick) pick.onclick = () => B.emit('dl-pick-dir', {});
    const open = box.querySelector('#dlOpen'); if (open) open.onclick = () => B.emit('dl-open-dir', {});
    box.querySelector('#dlClear').onclick = () => {
      // 只清「已完成」；进行中(running/pending/system/unknown)与失败(留着重试)都保留
      tasks = tasks.filter(t => t.status !== 'done');
      save(); rerender();
    };
    box.querySelectorAll('.dl-row').forEach(r => {
      const t = tasks.find(x => x.id === r.dataset.id); if (!t) return;
      const x = r.querySelector('.dl-x'); if (x) x.onclick = () => { tasks = tasks.filter(y => y.id !== t.id); save(); rerender(); };
      const rt = r.querySelector('.dl-retry'); if (rt) rt.onclick = () => retry(t);
      const rv = r.querySelector('.dl-reveal'); if (rv) rv.onclick = () => B.emit('dl-open-dir', { path: t.path });
    });
  }

  // 重试：优先用 mid+quality 重新解析 CDN 直链（旧直链可能已过签名时效），拿不到再退用旧 url
  async function retry(t) {
    tasks = tasks.filter(y => y.id !== t.id); save();
    let url = t.url;
    if (t.mid) {
      try {
        const r = await fetch('/api/song_url?mid=' + encodeURIComponent(t.mid) + '&quality=' + encodeURIComponent(t.quality || 'standard')).then(x => x.json());
        if (r && r.code === 0 && r.url) url = r.url;
      } catch (e) {}
    }
    add({ name: t.name, artist: t.artist, pic: t.pic, id: t.mid }, url, t.filename, { mid: t.mid, quality: t.quality });
  }

  function renderPage(container) {
    container.innerHTML = `<div class="section-title">下载管理</div><div id="dlBox"></div>`;
    box = container.querySelector('#dlBox');
    if (platform() === 'pc') B.emit('dl-get-dir', {});   // 要一次当前保存目录
    rerender();
  }

  window.DownloadCenter = { add, renderPage, count: () => tasks.length };
})();
