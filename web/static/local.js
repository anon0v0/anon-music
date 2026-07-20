/* 本地音乐：导入本地音频文件 → IndexedDB 持久化（File blob）→ blob URL 播放。
   刷新后从 IndexedDB 恢复、重新 createObjectURL。播放走 player 引擎的"有 url 直接播"分支
   （player.js loadSongUrl 对 local: 前缀用 LocalMusic.getUrl）。纯前端，不上传服务器。 */
(function () {
  'use strict';
  const DB_NAME = 'anon_local_music', STORE = 'files', DB_VER = 1;
  const AUDIO_RE = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|weba|webm)$/i;
  let _db = null;
  const urlMap = new Map();   // fileId → objectURL（会话级；ensureLoaded 后填充，getUrl 同步取）

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE, { keyPath: 'id' }); } catch (e) {} };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }
  function tx(mode) { return openDB().then(d => d.transaction(STORE, mode).objectStore(STORE)); }
  function pAll() { return tx('readonly').then(s => new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); })); }
  // .catch → false：IndexedDB 不可用（Safari 隐私模式/配额/首次打开失败）时优雅降级，不抛异常
  function pPut(rec) { return tx('readwrite').then(s => new Promise(r => { const q = s.put(rec); q.onsuccess = () => r(true); q.onerror = () => r(false); })).catch(() => false); }
  function pDel(id) { return tx('readwrite').then(s => new Promise(r => { const q = s.delete(id); q.onsuccess = () => r(true); q.onerror = () => r(false); })).catch(() => false); }

  function makeUrl(id, blob) {
    let u = urlMap.get(id);
    if (!u) { u = URL.createObjectURL(blob); urlMap.set(id, u); }
    return u;
  }
  // 把一条记录转成播放器/列表用的歌曲对象
  function toSong(r) {
    const u = makeUrl(r.id, r.file);
    return {
      id: 'local:' + r.id, name: r.name || '未知', artist: r.artist || '本地音乐', artists: r.artist || '本地音乐',
      pic: '', album: r.album || '', duration: r.duration || 0, sources: ['local'],
      url: u, _localUrl: u, size: r.size || 0, addedAt: r.addedAt || 0,
    };
  }

  let _loaded = false, _cache = [];
  const LocalMusic = {
    // boot 时预加载：读全部记录 + 生成 urlMap，使 getUrl 同步可用（队列恢复的本地歌也能重播）
    async ensureLoaded() {
      if (_loaded) return _cache;
      try { const recs = await pAll(); recs.forEach(r => makeUrl(r.id, r.file)); _cache = recs; } catch (e) { _cache = []; }
      _loaded = true;
      return _cache;
    },
    // player 引擎用：fileId 是 'local:' 之后的部分
    getUrl(fileId) { return urlMap.get(fileId) || null; },
    // 列表（新加入的在前）
    async list() {
      const recs = await this.ensureLoaded();
      return recs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map(toSong);
    },
    count() { return _cache.length; },
    // 导入 File 列表 → 存 IndexedDB，返回成功条数
    async import(fileList) {
      await this.ensureLoaded();
      let n = 0;
      for (const f of Array.from(fileList || [])) {
        const isAudio = (f.type && f.type.indexOf('audio') === 0) || AUDIO_RE.test(f.name || '');
        if (!isAudio) continue;
        const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const name = String(f.name || '未知').replace(/\.[^.]+$/, '');
        const rec = { id, name, artist: '', album: '', duration: 0, file: f, size: f.size || 0, addedAt: Date.now() };
        if (await pPut(rec)) { _cache.push(rec); makeUrl(id, f); n++; }
      }
      return n;
    },
    async remove(id) {
      const fid = String(id).replace(/^local:/, '');
      const u = urlMap.get(fid); if (u) { try { URL.revokeObjectURL(u); } catch (e) {} urlMap.delete(fid); }
      await pDel(fid);
      _cache = _cache.filter(r => r.id !== fid);
    },
  };
  window.LocalMusic = LocalMusic;
  // 预加载：尽早填充 urlMap，使队列恢复的本地歌能直接重播（getUrl 同步命中）
  try { LocalMusic.ensureLoaded(); } catch (e) {}
})();
