/*
 * 全屏正在播放 / 沉浸歌词组件（旧下载页与新整页播放器共享）
 * 绑定到 window.player（NeteaseMiniPlayer 实例），通过其事件系统同步。
 * 用法：NowPlaying.bind(player); 点击迷你播放器歌曲信息区即可打开。
 */
(function () {
  const ICON = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    heartF: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    single: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="9.2" y="15.5" font-size="8.5" fill="currentColor" stroke="none">1</text></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    volMute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13M3 12h13M3 18h9M17 14v6l4-2z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4.5A2 2 0 0 1 3 15V7a2 2 0 0 1 2-2z"/><path d="M7 8h10M7 12h7M7 16h4"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11M3 12h11M3 18h7"/><path d="M17 11v8M13 15h8"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.2-3.2 3.2h-2.4a2.4 2.4 0 0 0-1.8 4c.4.4.6.9.6 1.4 0 .8-.6 1.4-1.4 1.4z"/><circle cx="7.6" cy="11.6" r="1"/><circle cx="10.6" cy="7.6" r="1"/><circle cx="15.2" cy="8.2" r="1"/></svg>',
  };
  const MODE = { list: { icon: ICON.list, label: '列表循环' }, single: { icon: ICON.single, label: '单曲循环' }, shuffle: { icon: ICON.shuffle, label: '随机播放' } };
  const QUALITIES = [['standard', '标准'], ['hq', 'HQ 320'], ['flac', '无损'], ['master', '母带']];

  function fmt(s) { s = Math.floor(s || 0); const m = Math.floor(s / 60); const ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }
  function esc(t) { const d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function attr(t) { return esc(t).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const PS_DEFAULTS = { skin: 'square', vinylColor: '#e14fae', bg: 'auto', lyricAlign: 'center', viz: 'wave' };
  const WAVE_PAD = 8;   // 波形进度条左右内边距（= 游标半径 + 描边），点击换算也要减掉

  class NowPlayingOverlay {
    constructor() {
      this.player = null;
      this.seeking = false;
      this._build();
    }

    _build() {
      const el = document.createElement('div');
      el.className = 'np-overlay';
      el.innerHTML = `
        <div class="np-bg"></div>
        <div class="np-fluid"><span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span></div>
        <div class="np-topbar">
          <button class="np-close" title="收起播放页">${ICON.chevDown}</button>
          <div class="np-dots"><span data-p="cover" class="active"></span><span data-p="lyrics"></span></div>
          <div class="np-more">
            <button class="np-more-btn" title="更多">${ICON.more}</button>
            <div class="np-more-menu">
              <div data-a="comment">${ICON.comment}<span>评论</span></div>
              <div data-a="style">${ICON.palette}<span>播放器样式</span></div>
              <div data-a="desklyric"><b>词</b><span>悬浮歌词</span></div>
            </div>
          </div>
        </div>
        <div class="np-queue">
          <div class="np-queue-head"><span>播放列表 <i class="np-q-count"></i></span><span class="np-qh-r"><button class="np-q-clear">清空</button><button class="np-q-close" title="关闭">×</button></span></div>
          <div class="np-queue-list"></div>
        </div>
        <div class="np-body">
          <div class="np-left">
            <div class="np-cover-wrap"><div class="np-disc"><img class="np-cover" alt=""></div><div class="np-tonearm"><i></i></div><span class="np-srcbadge"></span></div>
            <div class="np-meta">
              <div class="np-title">未在播放</div>
              <div class="np-artist"></div>
            </div>
            <div class="np-mini-lyric"><div class="ml-a"></div><div class="ml-b"></div></div>
          </div>
          <div class="np-right"><div class="np-lyrics"><div class="empty">暂无歌词</div></div></div>
          <div class="np-lyrhead"><div class="t"></div><div class="a"></div></div>
        </div>
        <div class="np-footer">
          <canvas class="np-viz"></canvas>
          <!-- 进度：波形滑条（仿 NeriPlayer WaveformSlider）+ 下方 当前时间 · 音质 · 总时长 -->
          <div class="np-progress">
            <div class="np-bar"><canvas class="np-wave"></canvas><div class="np-bar-fill"></div><div class="np-bar-tip"></div></div>
            <div class="np-info">
              <span class="t np-cur">0:00</span>
              <div class="np-q">
                <button class="np-q-btn"><span class="np-q-label">标准</span></button>
                <div class="np-q-menu">${QUALITIES.map(q => `<div data-q="${q[0]}">${q[1]}</div>`).join('')}</div>
              </div>
              <span class="t np-dur">0:00</span>
            </div>
          </div>
          <!-- 主控行：模式 · 上一首 · 播放 · 下一首 · 喜欢 -->
          <div class="np-main-ctrl">
            <button class="np-mode" title="播放模式"></button>
            <button class="np-prev" title="上一首">${ICON.prev}</button>
            <button class="np-play" title="播放/暂停">${ICON.play}</button>
            <button class="np-next" title="下一首">${ICON.next}</button>
            <button class="np-like" title="喜欢">${ICON.heart}</button>
          </div>
          <!-- 工具坞：队列 · 定时 · 音量 · 悬浮歌词 · 加入歌单 -->
          <div class="np-dock">
            <button class="np-qbtn" title="播放列表">${ICON.queue}</button>
            <button class="np-timer" title="睡眠定时">${ICON.timer}</button>
            <div class="np-vol">
              <button class="np-vol-btn" title="音量">${ICON.vol}</button>
              <div class="np-vol-pop">
                <div class="np-vol-track"><div class="np-vol-fill"></div><div class="np-vol-thumb"></div></div>
                <div class="np-vol-num">100%</div>
                <button class="np-vol-mute" title="静音 / 恢复">${ICON.vol}</button>
              </div>
            </div>
            <button class="np-lyric" title="悬浮歌词显示/隐藏">词</button>
            <button class="np-addpl" title="加入歌单">${ICON.plus}</button>
          </div>
          <!-- 兼容旧引用：评论/样式入口移入顶部「更多」菜单，这里留隐藏挂载点 -->
          <div class="np-legacy"><button class="np-cbtn"></button><button class="np-style-btn">${ICON.palette}</button><button class="np-collapse"></button></div>
        </div>
        <div class="np-preview"><img alt="封面大图"></div>`;
      document.body.appendChild(el);
      this.el = el;
      this.$ = (s) => el.querySelector(s);
      this.bg = this.$('.np-bg'); this.fluid = this.$('.np-fluid'); this.cover = this.$('.np-cover');
      this.title = this.$('.np-title'); this.artist = this.$('.np-artist');
      this.source = this.$('.np-source'); this.lyricsBox = this.$('.np-lyrics');
      this.curT = this.$('.np-cur'); this.durT = this.$('.np-dur');
      this.bar = this.$('.np-bar'); this.fill = this.$('.np-bar-fill');
      this.playBtn = this.$('.np-play'); this.modeBtn = this.$('.np-mode');
      this.qLabel = this.$('.np-q-label'); this.likeBtn = this.$('.np-like');
      this.volBtn = this.$('.np-vol-btn'); this.volWrap = this.$('.np-vol'); this.volPop = this.$('.np-vol-pop');
      this.volTrack = this.$('.np-vol-track'); this.volFill = this.$('.np-vol-fill');
      this.volThumb = this.$('.np-vol-thumb'); this.volNum = this.$('.np-vol-num'); this.volMute = this.$('.np-vol-mute');
      this.rightBox = this.$('.np-right');
      this.wave = this.$('.np-wave'); this.srcBadge = this.$('.np-srcbadge');
      this.queuePanel = this.$('.np-queue'); this.queueList = this.$('.np-queue-list'); this.queueCount = this.$('.np-q-count');
      this.miniA = this.$('.np-mini-lyric .ml-a'); this.miniB = this.$('.np-mini-lyric .ml-b');

      // ===== 移动端两屏（封面页 ⇄ 歌词页，仿 QQ 音乐手机端）=====
      const mq = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;
      this._isMobile = () => !!(mq && mq.matches);
      // 点封面 → 歌词页；点歌词页空白（非歌词行）→ 封面页；顶部圆点也可切换
      this.$('.np-cover-wrap').addEventListener('click', () => {
        if (this._lpFired) { this._lpFired = false; return; }   // 刚长按开过大图，这一下不是切页
        if (this._isMobile() && !this._lyricsOnly && (!this._ps || this._ps.skin !== 'lyrics')) this._setMPage('lyrics');
      });
      this.rightBox.addEventListener('click', (e) => {
        if (e.target.closest('.ln')) return;
        if (this._isMobile() && !this._lyricsOnly && this.el.dataset.mpage === 'lyrics' && (!this._ps || this._ps.skin !== 'lyrics')) this._setMPage('cover');
      });
      this.el.querySelectorAll('.np-dots span').forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); this._setMPage(d.dataset.p); }));

      this.$('.np-close').addEventListener('click', () => this.close());
      this.$('.np-collapse').addEventListener('click', () => this.close());
      // 歌手名可点（封面页 np-artist / 简约歌词 np-lyrhead）→ 收起全屏页，有 id 跳歌手页、无 id 搜索
      this.el.addEventListener('click', (e) => {
        const link = e.target.closest('.np-ar-link');
        if (link) {
          e.stopPropagation();
          const aid = link.dataset.aid || ''; const p2 = aid.indexOf(':');
          if (p2 > 0) { this.close(); location.hash = `#/artist/${aid.slice(0, p2)}/${encodeURIComponent(aid.slice(p2 + 1))}`; }
          return;
        }
        const sr = e.target.closest('.np-ar-search');
        if (sr) {
          e.stopPropagation();
          const q = (sr.textContent || '').split(/[\/、,]/)[0].trim();
          if (q) { this.close(); location.hash = '#/search/' + encodeURIComponent(q); }
        }
      });
      // 播放列表
      this.$('.np-qbtn').addEventListener('click', (e) => { e.stopPropagation(); this._toggleQueue(); });
      // 评论（复用主页面的评论面板，z-index 提到全屏页之上）
      this.$('.np-cbtn').addEventListener('click', (e) => { e.stopPropagation(); this.closeQueue(); this.closeStylePanel(); if (window.Comments) window.Comments.toggle(); });
      this.$('.np-q-clear').addEventListener('click', () => { if (window.QueueCtl) { window.QueueCtl.clear(); this._renderQueue(); } });
      // 点队列面板外部关闭
      this.el.addEventListener('click', (e) => {
        if (this.queuePanel.classList.contains('show') && !this.queuePanel.contains(e.target) && !e.target.closest('.np-qbtn')) {
          this.queuePanel.classList.remove('show');
        }
      });
      this.playBtn.addEventListener('click', () => {
        if (!this.player) return;
        const p = this.player;
        if (p._needLoad && p.playlist && p.playlist.length) { p._needLoad = false; p.playQQMusicPlaylist(p.playlist, p.currentIndex); return; }
        if ((!p.currentSong || !p.playlist || !p.playlist.length) && window.playRandom) { window.playRandom(); return; }
        p.togglePlay();
      });
      this.$('.np-prev').addEventListener('click', () => this.player && this.player.previousSong());
      this.$('.np-next').addEventListener('click', () => this.player && this.player.nextSong());
      this.modeBtn.addEventListener('click', () => { if (this.player) { this.player.togglePlayMode(); this._renderMode(); } });
      this.likeBtn.addEventListener('click', () => this._toggleLike());
      const addBtn = this.$('.np-addpl');
      if (addBtn) addBtn.addEventListener('click', () => { if (window.openAddModal && this.player && this.player.currentSong) window.openAddModal(this.player.currentSong); });
      // 音质自定义下拉（与底栏一致，纯文字）
      const qLabelFor = (q) => { const m = QUALITIES.find(x => x[0] === q); return m ? m[1] : '标准'; };
      this.qLabelFor = qLabelFor;
      const npq = this.$('.np-q');
      this.$('.np-q-btn').addEventListener('click', (e) => { e.stopPropagation(); npq.classList.toggle('open'); if (this.volWrap) this.volWrap.classList.remove('open'); });
      this.$('.np-q-menu').querySelectorAll('div').forEach(it => it.addEventListener('click', () => { const q = it.dataset.q; if (this.player) this.player.setQuality(q); this.qLabel.textContent = qLabelFor(q); npq.classList.remove('open'); }));
      // 桌面歌词「词」
      const npl = this.$('.np-lyric');
      npl.addEventListener('click', () => { if (window.DeskLyric) { const on = window.DeskLyric.toggle(); npl.classList.toggle('active', on); } });
      this._npl = npl;
      // 点空白关掉下拉
      this.el.addEventListener('click', () => { npq.classList.remove('open'); if (this.volWrap) this.volWrap.classList.remove('open'); });
      // 播放列表关闭按钮
      this.$('.np-q-close').addEventListener('click', (e) => { e.stopPropagation(); this.queuePanel.classList.remove('show'); const qb = this.$('.np-qbtn'); if (qb) qb.classList.remove('active'); });
      // 音量：喇叭弹出竖向调节条（默认 100）
      // ⚠️ 音量真值 = player.volume（逻辑音量）。audio.volume 在切歌加载期间会被引擎淡出置 0
      // （player.js loadCurrentSong → 'playing' 事件才淡回），不能当真值读，否则加载窗口内
      // 打开全屏页会误显示 0%/静音，甚至把 0 写回逻辑音量导致淡入目标为 0、无声播放。
      const logicalVol = () => {
        const p = this.player;
        if (p && typeof p.volume === 'number' && !isNaN(p.volume)) return Math.max(0, Math.min(1, p.volume));
        if (p && p.audio && typeof p.audio.volume === 'number') return p.audio.volume;
        return parseFloat(localStorage.getItem('player_vol') || '1');
      };
      this._logicalVol = logicalVol;
      const renderVol = (v) => {
        const pct = Math.round(v * 100);
        this.volFill.style.height = pct + '%';
        this.volThumb.style.bottom = pct + '%';
        this.volNum.textContent = pct + '%';
        this.volBtn.innerHTML = v === 0 ? ICON.volMute : ICON.vol;
        this.volMute.innerHTML = v === 0 ? ICON.volMute : ICON.vol;
        this.volMute.classList.toggle('muted', v === 0);
      };
      this._renderVol = renderVol;
      const applyVol = (v, save) => {
        v = Math.max(0, Math.min(1, v));
        if (this.player && this.player.audio) { this.player.audio.volume = v; this.player.volume = v; }
        renderVol(v);
        if (save) { try { localStorage.setItem('player_vol', v); } catch (_) {} }
      };
      this._applyVol = applyVol;
      this.volBtn.addEventListener('click', (e) => { e.stopPropagation(); this.volWrap.classList.toggle('open'); npq.classList.remove('open'); });
      this.volPop.addEventListener('click', (e) => e.stopPropagation());
      this.volMute.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = logicalVol();
        if (cur > 0) { this._lastVol = cur; applyVol(0, true); } else { applyVol(this._lastVol || 1, true); }
      });
      const volFromEvent = (ev) => {
        const r = this.volTrack.getBoundingClientRect();
        const y = (ev.touches && ev.touches[0]) ? ev.touches[0].clientY : ev.clientY;
        return 1 - Math.max(0, Math.min(1, (y - r.top) / r.height));
      };
      this.volTrack.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation(); applyVol(volFromEvent(ev), true);
        const mv = (e2) => applyVol(volFromEvent(e2), true);
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
      this.volTrack.addEventListener('touchstart', (ev) => {
        ev.preventDefault(); ev.stopPropagation(); applyVol(volFromEvent(ev), true);
        const mv = (e2) => applyVol(volFromEvent(e2), true);
        const up = () => { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); };
        document.addEventListener('touchmove', mv); document.addEventListener('touchend', up);
      }, { passive: false });
      this.volPop.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        applyVol(logicalVol() + (ev.deltaY < 0 ? 0.05 : -0.05), true);
      }, { passive: false });
      // 歌词滚轮预览：滚动时暂停自动跟随，2.5s 后恢复
      if (this.rightBox) {
        this.rightBox.addEventListener('wheel', (e) => {
          e.preventDefault();
          this._preview = true;
          const base = (this._previewY == null) ? this._curLyricY() : this._previewY;
          this._previewY = base - e.deltaY;
          this._clampPreview();
          this.lyricsBox.style.transition = 'none';
          this.lyricsBox.style.transform = `translateY(${this._previewY}px)`;
          clearTimeout(this._previewTimer);
          this._previewTimer = setTimeout(() => {
            this._preview = false; this._previewY = null;
            this.lyricsBox.style.transition = '';
            this._layoutLyrics();
          }, 2600);
        }, { passive: false });
        // 触摸滑动预览（手机）：与滚轮同逻辑，手指拖动歌词、2.6s 后恢复自动跟随
        let _ty0 = 0, _tBase = 0, _tMoved = false;
        this.rightBox.addEventListener('touchstart', (e) => {
          if (!e.touches || !e.touches.length) return;
          _ty0 = e.touches[0].clientY;
          _tBase = (this._previewY == null) ? this._curLyricY() : this._previewY;
          _tMoved = false;
          clearTimeout(this._previewTimer);
          this.lyricsBox.style.transition = 'none';
        }, { passive: true });
        this.rightBox.addEventListener('touchmove', (e) => {
          if (!e.touches || !e.touches.length) return;
          const dy = e.touches[0].clientY - _ty0;
          if (!_tMoved && Math.abs(dy) < 4) return;   // 小位移不算（避免点击歌词跳转被误判）
          _tMoved = true;
          this._preview = true;
          this._previewY = _tBase + dy;
          this._clampPreview();
          this.lyricsBox.style.transform = `translateY(${this._previewY}px)`;
        }, { passive: true });
        this.rightBox.addEventListener('touchend', () => {
          if (!_tMoved) {
            // 纯点击（交给行点击跳转）：touchstart 已清掉预览定时器/过渡，这里必须复原，
            // 否则上一次滑动的预览态永远不结束（自动跟随冻结）
            if (this._preview) {
              clearTimeout(this._previewTimer);
              this._previewTimer = setTimeout(() => {
                this._preview = false; this._previewY = null;
                this.lyricsBox.style.transition = '';
                this._layoutLyrics();
              }, 2600);
            } else { this.lyricsBox.style.transition = ''; }
            return;
          }
          clearTimeout(this._previewTimer);
          this._previewTimer = setTimeout(() => {
            this._preview = false; this._previewY = null;
            this.lyricsBox.style.transition = '';
            this._layoutLyrics();
          }, 2600);
        }, { passive: true });
        // 桌面：鼠标停在歌词区时暂停自动跟随滚动（歌词不会从光标下滑走），移开即恢复。
        // 沉浸歌词(lyrics-only)不参与：光标几乎必然落在歌词列上，会把自动跟随永久冻结。
        if (window.matchMedia && matchMedia('(hover: hover)').matches) {
          this.rightBox.addEventListener('mouseenter', () => { if (!this._lyricsOnly) this._hoverHold = true; });
          this.rightBox.addEventListener('mouseleave', () => { this._hoverHold = false; if (!this._preview) this._layoutLyrics(); });
        }
      }
      // 进度条：点击 + 拖动
      const barRatio = (e) => { const r = this.bar.getBoundingClientRect(); const inner = Math.max(1, r.width - WAVE_PAD * 2); return Math.min(1, Math.max(0, (e.clientX - r.left - WAVE_PAD) / inner)); };
      const barDur = () => { const st = this.player ? this.player.getState() : {}; return st.duration || (this.player && this.player.audio && this.player.audio.duration) || 0; };
      this.bar.addEventListener('mousedown', (e) => { if (!this.player) return; this._barDrag = true; const rt = barRatio(e); this._dragRatio = rt; this.fill.style.width = rt * 100 + '%'; this.curT.textContent = fmt(rt * barDur()); e.preventDefault(); });
      window.addEventListener('mousemove', (e) => { if (!this._barDrag) return; const rt = barRatio(e); this._dragRatio = rt; this.fill.style.width = rt * 100 + '%'; this.curT.textContent = fmt(rt * barDur()); });
      window.addEventListener('mouseup', (e) => { if (!this._barDrag) return; this._barDrag = false; this._dragRatio = null; if (this.player) this.player.seekTo(barRatio(e) * barDur()); });
      // 触摸拖动（安卓 WebView 触摸时 mousemove 不可靠）：touchstart 后 move/end 仍派发到 bar 元素本身
      const barTouchRatio = (e) => { const t = e.touches[0] || e.changedTouches[0]; return t ? barRatio(t) : 0; };
      this.bar.addEventListener('touchstart', (e) => { if (!this.player) return; this._barDrag = true; const rt = barTouchRatio(e); this._dragRatio = rt; this.fill.style.width = rt * 100 + '%'; this.curT.textContent = fmt(rt * barDur()); e.preventDefault(); }, { passive: false });
      this.bar.addEventListener('touchmove', (e) => { if (!this._barDrag) return; const rt = barTouchRatio(e); this._dragRatio = rt; this.fill.style.width = rt * 100 + '%'; this.curT.textContent = fmt(rt * barDur()); e.preventDefault(); }, { passive: false });
      this.bar.addEventListener('touchend', (e) => { if (!this._barDrag) return; this._barDrag = false; const rt = barTouchRatio(e); this._dragRatio = null; if (this.player) this.player.seekTo(rt * barDur()); });
      // 悬停预览：左侧时间随光标 + 光标位置歌词气泡（无圆点游标），移开恢复
      const npTip = this.$('.np-bar-tip');
      this.bar.addEventListener('mousemove', (e) => {
        if (this._barDrag) return;
        this._barHover = true;
        const rt = barRatio(e);
        this.curT.textContent = fmt(rt * barDur());
        if (npTip) { const tx = this._lyricAt(rt * barDur()); npTip.textContent = tx; npTip.style.left = (rt * 100) + '%'; npTip.classList.toggle('show', !!tx); }
      });
      this.bar.addEventListener('mouseleave', () => { this._barHover = false; if (npTip) npTip.classList.remove('show'); });
      // 仅歌词模式：点空白处（非歌词行）关闭
      this.el.addEventListener('click', (e) => { if (this._lyricsOnly && !e.target.closest('.ln')) this.close(); });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !this.el.classList.contains('open')) return;
        if (this.preview && this.preview.classList.contains('show')) { this.closePreview(); return; }
        this.close();
      });

      /* ===== 封面长按 → 沉浸大图预览（仿 NeriPlayer CoverPreview）===== */
      this.preview = this.$('.np-preview');
      this.previewImg = this.preview.querySelector('img');
      const coverWrap = this.$('.np-cover-wrap');
      let lpTimer = null, lpMoved = false, lpX = 0, lpY = 0;
      const openPreview = () => {
        const src = this.cover && this.cover.getAttribute('src');
        if (!src) return;
        this._lpFired = true;
        this._pvAt = Date.now();
        this.previewImg.src = src;
        this.preview.classList.add('show');
      };
      coverWrap.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        lpMoved = false; lpX = e.touches[0].clientX; lpY = e.touches[0].clientY;
        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => { if (!lpMoved) openPreview(); }, 480);
      }, { passive: true });
      coverWrap.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches.length) return;
        if (Math.abs(e.touches[0].clientX - lpX) > 8 || Math.abs(e.touches[0].clientY - lpY) > 8) {
          lpMoved = true; clearTimeout(lpTimer);
        }
      }, { passive: true });
      coverWrap.addEventListener('touchend', () => clearTimeout(lpTimer), { passive: true });
      coverWrap.addEventListener('touchcancel', () => clearTimeout(lpTimer), { passive: true });
      coverWrap.addEventListener('contextmenu', (e) => { e.preventDefault(); openPreview(); });   // 桌面右键
      this.preview.addEventListener('click', (e) => {
        e.stopPropagation();
        // 长按抬手时浏览器会在刚出现的预览层上补一次 click，那一下不能算“点击关闭”
        if (this._pvAt && Date.now() - this._pvAt < 550) return;
        this.closePreview();
      });

      /* ===== 顶栏「更多」菜单：评论 / 播放器样式 / 悬浮歌词 ===== */
      const moreWrap = this.$('.np-more'), moreMenu = this.$('.np-more-menu');
      this.$('.np-more-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const open = moreWrap.classList.toggle('open');
        if (open) { this.closeQueue(); npq.classList.remove('open'); this.volWrap.classList.remove('open'); }
      });
      moreMenu.addEventListener('click', (e) => {
        const it = e.target.closest('[data-a]'); if (!it) return;
        e.stopPropagation();
        moreWrap.classList.remove('open');
        const a = it.dataset.a;
        if (a === 'comment') { this.closeQueue(); this.closeStylePanel(); if (window.Comments) window.Comments.toggle(); }
        else if (a === 'style') { const sb = this.$('.np-style-btn'); if (sb) sb.click(); }
        else if (a === 'desklyric') { this._npl && this._npl.click(); }
      });
      this.el.addEventListener('click', () => moreWrap.classList.remove('open'));

      /* ===== 睡眠定时：打开设置面板的「睡眠定时」分区 ===== */
      this.$('.np-timer').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.openSettingsAt) window.openSettingsAt('sleep');
        else if (window.appNotice) window.appNotice('睡眠定时在设置里', 'info');
      });
      this._syncTimerState();
      try { if (window.SleepTimer && window.SleepTimer.onChange) window.SleepTimer.onChange(() => this._syncTimerState()); } catch (_) {}

      this._bindGestures();
    }

    /* 睡眠定时生效时点亮坞里的定时器图标 */
    _syncTimerState() {
      const btn = this.$('.np-timer'); if (!btn) return;
      let on = false;
      try { on = !!(window.SleepTimer && window.SleepTimer.state && window.SleepTimer.state().active); } catch (_) {}
      btn.classList.toggle('active', on);
    }

    /* ===== 手势（仿 NeriPlayer）：整页下拉收起 · 左右滑切封面/歌词页 =====
       只在封面区/空白处起手，歌词区与队列面板自己要滚动，不抢它们的触摸。 */
    _bindGestures() {
      const el = this.el;
      let x0 = 0, y0 = 0, dx = 0, dy = 0, tracking = false, axis = '';
      const startable = (t) =>
        !t.closest('.np-bar') && !t.closest('.np-queue') && !t.closest('.np-right') &&
        !t.closest('.np-vol-pop') && !t.closest('.np-more-menu') && !t.closest('.np-q-menu') &&
        !t.closest('.np-style-panel') && !t.closest('.np-main-ctrl') && !t.closest('.np-dock') &&
        !t.closest('.np-preview');
      el.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1 || !startable(e.target)) { tracking = false; return; }
        tracking = true; axis = ''; dx = dy = 0;
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
        el.style.transition = 'none';
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!tracking || !e.touches || !e.touches.length) return;
        dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
        if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // 纵向：跟手下移（仅向下，带阻尼），松手过阈值收起
        if (axis === 'y' && dy > 0) el.style.transform = `translateY(${Math.pow(dy, .86)}px)`;
      }, { passive: true });
      const settle = () => {
        if (!tracking) return;
        tracking = false;
        el.style.transition = '';
        el.style.transform = '';
        if (axis === 'y' && dy > 90) { this.close(); return; }
        if (axis === 'x' && Math.abs(dx) > 56 && this._isMobile() && !this._lyricsOnly && (!this._ps || this._ps.skin !== 'lyrics')) {
          // 左滑 → 歌词页；右滑 → 封面页（与 NeriPlayer 一致）
          this._setMPage(dx < 0 ? 'lyrics' : 'cover');
        }
        axis = ''; dx = dy = 0;
      };
      el.addEventListener('touchend', settle, { passive: true });
      el.addEventListener('touchcancel', settle, { passive: true });
      // 歌词页：横向滑回封面页（歌词区纵向自己滚动，这里只认横向）
      let lx0 = 0, ly0 = 0, lAxis = '';
      this.rightBox.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        lx0 = e.touches[0].clientX; ly0 = e.touches[0].clientY; lAxis = '';
      }, { passive: true });
      this.rightBox.addEventListener('touchend', (e) => {
        const t = (e.changedTouches && e.changedTouches[0]); if (!t) return;
        const ddx = t.clientX - lx0, ddy = t.clientY - ly0;
        if (Math.abs(ddx) > 56 && Math.abs(ddx) > Math.abs(ddy) * 1.6 && ddx > 0 &&
            this._isMobile() && !this._lyricsOnly && (!this._ps || this._ps.skin !== 'lyrics') &&
            this.el.dataset.mpage === 'lyrics') {
          this._setMPage('cover');
        }
      }, { passive: true });
    }

    /* ===== 播放器样式（皮肤/彩胶颜色/背景色/歌词版式/频谱），设置面板改动后调用 ===== */
    applyStyle() {
      const ps = Object.assign({}, PS_DEFAULTS, (window.AppSettings && window.AppSettings.playerStyle) || {});
      if (!['square', 'lyrics'].includes(ps.skin)) ps.skin = 'square';
      ps.bg = 'auto'; ps.lyricAlign = 'center'; ps.viz = 'wave';
      // 调试只允许在两个保留皮肤之间切换，不再暴露已下线的样式轴。
      try {
        const q = new URLSearchParams(location.search);
        if (['square', 'lyrics'].includes(q.get('skin'))) ps.skin = q.get('skin');
      } catch (_) {}
      this._ps = ps;
      this.el.dataset.skin = ps.skin;
      this.el.dataset.lyralign = ps.lyricAlign;
      this.el.dataset.viz = ps.viz;
      const c = hexRgb(ps.vinylColor) || [225, 79, 174];
      this.el.style.setProperty('--vinylC', `rgb(${c[0]},${c[1]},${c[2]})`);
      this.el.style.setProperty('--vinylCA', `rgba(${c[0]},${c[1]},${c[2]},.34)`);
      this.el.style.setProperty('--vinylCB', `rgba(${c[0]},${c[1]},${c[2]},.55)`);   // 彩胶盘体
      this.el.style.setProperty('--vinylCR', `rgba(${c[0]},${c[1]},${c[2]},.82)`);   // 彩胶外缘/描边
      // 背景：固定色覆盖专辑取色；切回自动则按最近封面重新取色
      if (ps.bg && ps.bg !== 'auto') this._applyBg(hexRgb(ps.bg));
      else if (this._lastPic !== undefined) this._extractColor(this._lastPic);
      // 简约歌词皮肤：移动端只有歌词页
      if (ps.skin === 'lyrics') this._setMPage('lyrics');
      else if (!this.el.dataset.mpage) this._setMPage('cover');
    }
    _setMPage(pg) {
      pg = pg === 'lyrics' ? 'lyrics' : 'cover';
      this.el.dataset.mpage = pg;
      this.el.querySelectorAll('.np-dots span').forEach(d => d.classList.toggle('active', d.dataset.p === pg));
      // 歌词页刚从 display:none 显示出来，行高/offsetTop 需要下一帧才有效
      if (pg === 'lyrics') requestAnimationFrame(() => this._layoutLyrics());
    }
    _renderMini(idx) {
      if (!this.miniA) return;
      const ly = (this.player && this.player.lyrics) || [];
      if (!ly.length) { this.miniA.textContent = ''; this.miniB.textContent = ''; return; }
      const cur = idx >= 0 && ly[idx] ? (ly[idx].text || '♪') : (ly[0] ? (ly[0].text || '♪') : '');
      const nxt = ly[(idx >= 0 ? idx : 0) + 1];
      this.miniA.textContent = cur;
      this.miniB.textContent = nxt ? (nxt.text || '♪') : '';
    }

    // 歌手名：带 id 的 artistList → 可点 span（跳歌手页）；否则纯字符串 → 可点搜索该歌手
    _artistHTML(s) {
      const arr = Array.isArray(s.artistList) ? s.artistList : (Array.isArray(s.artists) ? s.artists : null);
      if (arr && arr.length && arr[0] && arr[0].id) {
        return arr.map(a => `<span class="np-ar-link" data-aid="${attr(a.id)}">${esc(a.name)}</span>`).join('<span class="np-ar-sep">, </span>');
      }
      const txt = (typeof s.artists === 'string' ? s.artists : '') || s.artist || '';
      return txt ? `<span class="np-ar-search">${esc(txt)}</span>` : '';
    }

    // 给定时间，返回该时刻应显示的歌词文本（供进度条悬停气泡）
    _lyricAt(t) {
      const ly = (this.player && this.player.lyrics) || [];
      let txt = '';
      for (let i = 0; i < ly.length; i++) { if (ly[i].time <= t) txt = ly[i].text || ''; else break; }
      return txt;
    }

    bind(player) {
      if (!player || this.player === player) return;
      this.player = player;
      player.on('songchange', (s) => { this._renderSong(s); if (this.queuePanel && this.queuePanel.classList.contains('show')) this._renderQueue(); });
      player.on('lyricsloaded', () => this._renderLyrics());
      player.on('timeupdate', (d) => this._tick(d));
      player.on('playstate', (p) => this._renderPlay(p));
      player.on('qualitychange', (q) => { if (this.qLabel) this.qLabel.textContent = (this.qLabelFor ? this.qLabelFor(q) : q); });
      // 迷你播放器歌曲信息区点击 → 打开全屏
      try {
        const info = player.element && player.element.querySelector('.song-info');
        if (info) { info.style.cursor = 'pointer'; info.addEventListener('click', () => this.open()); }
      } catch (e) {}
      this._syncFromState();
    }

    _syncFromState() {
      if (!this.player) return;
      const st = this.player.getState();
      if (this.qLabel) this.qLabel.textContent = (this.qLabelFor ? this.qLabelFor(st.quality || 'standard') : '标准');
      // 同步倍速按钮 + 桌面歌词「词」高亮
      try { if (this._npl && window.DeskLyric) this._npl.classList.toggle('active', window.DeskLyric.isOn()); } catch (_) {}
      this._renderMode();
      // 同步音量：读逻辑音量 player.volume（切歌加载期 audio.volume 被淡出置 0，不可信），
      // 且只渲染 UI 不写回——写回会把瞬时值覆盖到逻辑音量/audio 上，干扰引擎淡入。
      try {
        if (this._renderVol) this._renderVol(this._logicalVol ? this._logicalVol() : 1);
      } catch (_) {}
      if (st.song) { this._renderSong(st.song); this._renderLyrics(); }
      this._renderPlay(st.isPlaying);
      this._tick({ currentTime: st.currentTime, duration: st.duration });
    }

    _renderSong(s) {
      if (!s) return;
      this.title.textContent = s.name || '未知歌曲';
      this.artist.innerHTML = this._artistHTML(s);
      // 简约歌词皮肤：歌词上方的歌名/歌手（隐藏封面区后的信息来源）
      const lh = this.$('.np-lyrhead');
      if (lh) { lh.querySelector('.t').textContent = s.name || '未知歌曲'; lh.querySelector('.a').innerHTML = this._artistHTML(s); }
      if (this.source) this.source.textContent = (s.id || '').startsWith('qq:') ? 'QQ 音乐' : ((s.id || '').startsWith('netease:') ? '网易云音乐' : '');
      // 封面右下音源角标（仿 NeriPlayer PlaybackSourceBadge）
      if (this.srcBadge) {
        const id = String(s.id || '');
        const src = id.startsWith('qq:') ? 'qq' : (id.startsWith('netease:') ? 'netease' : '');
        this.srcBadge.innerHTML = src === 'qq' ? '<img src="/static/qqmusic.png" alt="QQ 音乐">'
          : (src === 'netease' ? '<img src="/static/wyyyy.jpg" alt="网易云音乐">' : '');
        this.srcBadge.classList.toggle('show', !!src);
      }
      const pic = (window.httpsify ? window.httpsify(s.picUrl || s.pic) : (s.picUrl || s.pic)) || '';
      this.cover.src = pic || (window.IMG_PLACEHOLDER || '');
      this._lastPic = pic;
      // 播放器样式设了固定背景色时不走专辑取色
      const psBg = this._ps && this._ps.bg;
      if (psBg && psBg !== 'auto') this._applyBg(hexRgb(psBg));
      else this._extractColor(pic);
      this._applyFluidPref();
      this._updateLikeState();
    }

    /* 从专辑封面取主色 → 渐变背景（仿 25pan「专辑取色」） */
    _extractColor(picUrl) {
      if (!picUrl) { this._applyBg(null); return; }
      this._colorCache = this._colorCache || new Map();
      const cached = this._colorCache.get(picUrl);
      if (cached) { this._applyBg(cached); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          const w = cv.width = 40, h = cv.height = 40;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          // 取最饱和的平均色：跳过近白/近黑/低饱和像素，保证渐变有色彩
          let r = 0, g = 0, b = 0, n = 0, fr = 0, fg = 0, fb = 0, fn = 0;
          for (let i = 0; i < data.length; i += 4) {
            const R = data[i], G = data[i + 1], B = data[i + 2], A = data[i + 3];
            if (A < 125) continue;
            r += R; g += G; b += B; n++;
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            const sat = mx === 0 ? 0 : (mx - mn) / mx;
            if (sat > 0.28 && mx > 50 && mx < 245) { fr += R; fg += G; fb += B; fn++; }
          }
          let c;
          if (fn > n * 0.06) c = [Math.round(fr / fn), Math.round(fg / fn), Math.round(fb / fn)];
          else if (n) c = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
          else c = null;
          // LRU 上限 50：听得多也不会让取色缓存无限占内存
          if (c) {
            this._colorCache.set(picUrl, c);
            while (this._colorCache.size > 50) this._colorCache.delete(this._colorCache.keys().next().value);
          }
          this._applyBg(c);
        } catch (e) { this._applyBg(null); }
      };
      img.onerror = () => this._applyBg(null);
      img.src = apiUrl('/api/img?url=' + encodeURIComponent(picUrl));
    }
    _applyBg(c) {
      if (!c) {
        this.bg.style.background = 'radial-gradient(120% 90% at 30% 18%, #23232c, #121217 60%, #08080c 100%)';
        this.fluid.style.cssText = '--c1:#2a2a3a;--c2:#1c1c28;--c3:#222230';
        return;
      }
      let [r, g, b] = c;
      const mix = (v, t, f) => Math.round(v * f + t * (1 - f));
      const rgb = (r2, g2, b2) => `rgb(${r2},${g2},${b2})`;
      // 暗色调：主色压暗做底，两端更深
      const mid = rgb(mix(r, 10, .62), mix(g, 10, .62), mix(b, 14, .62));
      const lo = rgb(mix(r, 8, .30), mix(g, 8, .30), mix(b, 12, .30));
      this.bg.style.background =
        `radial-gradient(130% 100% at 28% 12%, ${mid} 0%, ${lo} 55%, #08080c 100%)`;
      // 流体光斑用更亮一点的同色系
      const hi = rgb(mix(r, 255, .82), mix(g, 255, .82), mix(b, 255, .82));
      this.fluid.style.setProperty('--c1', hi);
      this.fluid.style.setProperty('--c2', mid);
      // c3 同色系更深一档（不串色，保持专辑色调统一）
      this.fluid.style.setProperty('--c3', rgb(mix(r, 12, .5), mix(g, 12, .5), mix(b, 18, .5)));
    }
    _applyFluidPref() {
      this.el.classList.add('fluid-on');
    }

    _lineInner(l) {
      const wbw = window.AppSettings && window.AppSettings.wordByWord && window.AppSettings.wordByWord.enabled;
      if (wbw && l.words && l.words.length) {
        return l.words.map(w => `<span class="w" data-t="${w.time}">${esc(w.text)}</span>`).join('');
      }
      return esc(l.text || '♪');
    }
    _renderLyrics() {
      const ly = (this.player && this.player.lyrics) || [];
      this._preview = false; this._previewY = null; clearTimeout(this._previewTimer);
      if (this.lyricsBox) { this.lyricsBox.style.transition = 'none'; this.lyricsBox.style.transform = 'translateY(0)'; }
      this._renderMini(this.player ? this.player.currentLyricIndex : -1);
      if (!ly.length) { this.lyricsBox.innerHTML = '<div class="empty">暂无歌词 / 纯音乐</div>'; return; }
      this.lyricsBox.innerHTML = ly.map((l, i) =>
        `<div class="ln" data-i="${i}"><span class="seekt">${fmt(l.time)}</span><span class="ln-tx">${this._lineInner(l)}${l.translation ? `<span class="tr">${esc(l.translation)}</span>` : ''}</span></div>`
      ).join('');
      this.lyricsBox.querySelectorAll('.ln').forEach((n) => {
        n.addEventListener('click', () => {
          const i = +n.dataset.i;
          if (this.player && ly[i]) {
            this.player.seekTo(ly[i].time);
            this._preview = false; this._previewY = null; clearTimeout(this._previewTimer);
            this.lyricsBox.style.transition = ''; this._activeIdx = -1; this._layoutLyrics();
          }
        });
      });
      this._activeIdx = -1;
      requestAnimationFrame(() => { if (this.lyricsBox) { this.lyricsBox.style.transition = ''; } this._layoutLyrics(); });
    }
    _curLyricY() {
      const m = /translateY\(([-0-9.]+)px\)/.exec((this.lyricsBox && this.lyricsBox.style.transform) || '');
      return m ? parseFloat(m[1]) : 0;
    }
    _clampPreview() {
      const box = this.rightBox, inner = this.lyricsBox;
      if (!box || !inner) return;
      const max = box.clientHeight / 2;
      const min = box.clientHeight / 2 - inner.scrollHeight;
      if (this._previewY > max) this._previewY = max;
      if (this._previewY < min) this._previewY = min;
    }
    /* ===== 全屏播放页内的播放列表 ===== */
    closeQueue() { if (this.queuePanel) this.queuePanel.classList.remove('show'); const b = this.$('.np-qbtn'); if (b) b.classList.remove('active'); }
    closeStylePanel() {
      const sp = this.el.querySelector('.np-style-panel'); if (sp) sp.classList.remove('show');
      const sb = this.el.querySelector('.np-style-btn'); if (sb) sb.classList.remove('active');
    }
    _toggleQueue() {
      const open = this.queuePanel.classList.toggle('show');
      const btn = this.el.querySelector('.np-qbtn'); if (btn) btn.classList.toggle('active', open);
      const positionQueuePanel = () => {
        if (!btn || !this.queuePanel || this._isMobile()) return;
        const br = btn.getBoundingClientRect(), er = this.el.getBoundingClientRect();
        this.queuePanel.style.width = Math.min(300, er.width - 32) + 'px';
        const width = this.queuePanel.offsetWidth || 300;
        const left = Math.max(16, Math.min(er.width - width - 16, br.left - er.left + br.width / 2 - width / 2));
        this.queuePanel.style.left = left + 'px'; this.queuePanel.style.right = 'auto';
        this.queuePanel.style.top = 'auto'; this.queuePanel.style.bottom = Math.max(92, er.bottom - br.top + 12) + 'px'; this.queuePanel.style.transform = 'none';
      };
      if (open) { this._renderQueue(); if (window.Comments) window.Comments.close(); this.closeStylePanel(); requestAnimationFrame(positionQueuePanel); }   // 互斥：开列表关评论/样式
    }
    _renderQueue() {
      if (!this.queueList) return;
      const ctl = window.QueueCtl;
      const list = ctl ? ctl.list() : [];
      const idx = ctl ? ctl.index() : -1;
      this.queueCount.textContent = list.length ? list.length + ' 首' : '';
      if (!list.length) { this.queueList.innerHTML = '<div class="np-q-empty">播放列表为空</div>'; return; }
      this.queueList.innerHTML = list.map((s, i) => `
        <div class="np-q-row ${i === idx ? 'playing' : ''}" data-i="${i}">
          <span class="np-q-i">${i === idx ? '▶' : (i + 1)}</span>
          <div class="np-q-t"><div class="np-q-n">${esc(s.name || '')}</div><div class="np-q-a">${esc(s.artists || s.artist || '')}</div></div>
          <button class="np-q-x" title="移除">×</button>
        </div>`).join('');
      this.queueList.querySelectorAll('.np-q-row').forEach(r => {
        r.addEventListener('click', (e) => {
          if (e.target.closest('.np-q-x')) return;
          if (window.QueueCtl) window.QueueCtl.play(+r.dataset.i);
          setTimeout(() => this._renderQueue(), 140);
        });
        r.querySelector('.np-q-x').addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.QueueCtl) window.QueueCtl.remove(+r.dataset.i);
          setTimeout(() => this._renderQueue(), 60);
        });
      });
      const cur = this.queueList.querySelector('.np-q-row.playing');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    /* transform 居中当前行 + 按距离淡出（仿 25pan 平滑滚动歌词） */
    _layoutLyrics() {
      if (!this.lyricsBox) return;
      const lines = this.lyricsBox.querySelectorAll('.ln');
      if (!lines.length) return;
      const idx = this.player ? this.player.currentLyricIndex : -1;
      lines.forEach((n, i) => {
        const d = Math.abs(i - idx);
        n.classList.toggle('active', i === idx);
        n.style.opacity = i === idx ? '1' : String(Math.max(0.16, 0.5 - d * 0.07));
      });
      if (this._preview || this._hoverHold) return;
      const box = this.rightBox; if (!box) return;
      const active = lines[idx >= 0 ? idx : 0];
      const y = idx >= 0 && active
        ? (box.clientHeight / 2 - (active.offsetTop + active.offsetHeight / 2))
        : (box.clientHeight / 2 - 30);
      this.lyricsBox.style.transform = `translateY(${y}px)`;
    }

    _tick(d) {
      d = d || {}; const cur = d.currentTime || 0; const dur = d.duration || 0;
      if (!this._barDrag && !this._barHover) this.curT.textContent = fmt(cur);   // 悬停/拖动时不被拉回
      this.durT.textContent = fmt(dur);
      if (!this._barDrag) this.fill.style.width = (dur ? (cur / dur * 100) : 0) + '%';
      // 切音质重载期间 currentTime 会瞬间归零，跳过歌词重排避免回滚到顶部
      if (this.player && this.player._qSwitch) return;
      const idx = this.player ? this.player.currentLyricIndex : -1;
      if (idx !== this._activeIdx) {
        this._activeIdx = idx;
        this._layoutLyrics();
        this._renderMini(idx);
      }
    }
    // 60fps 平滑逐字填充（rAF 驱动，避免 timeupdate 4fps 的卡顿）
    _startRAF() {
      this._stopRAF();
      const loop = () => { this._rafTick(); this._raf = requestAnimationFrame(loop); };
      loop();
    }
    _stopRAF() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

    /* ===== 波形进度条（仿 NeriPlayer WaveformSlider）=====
       已播放段用流动正弦波、未播放段是同一条曲线的暗色版，游标落在波上；
       暂停/拖动时振幅平滑收敛到 0（变直线），与原实现同一套观感。 */
    _accent() {
      if (!this._accentC) {
        try { this._accentC = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#22c55e'; }
        catch (_) { this._accentC = '#22c55e'; }
      }
      return this._accentC;
    }
    _drawWave(ratio) {
      const cv = this.wave; if (!cv) return;
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const ctx = cv.getContext('2d'); if (!ctx) return;
      const w = r.width, h = r.height, cy = h / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const now = (window.performance && performance.now()) || Date.now();
      const dt = Math.min(80, now - (this._waveLast || now));
      this._waveLast = now;
      const playing = this.el.classList.contains('playing') && !this._barDrag;
      // 振幅 500ms 平滑到目标（播放 3.5px / 暂停 0）
      const target = playing ? 3.5 : 0;
      if (this._amp == null) this._amp = target;
      const stepA = dt / 500 * 3.5;
      this._amp = this._amp < target ? Math.min(target, this._amp + stepA) : Math.max(target, this._amp - stepA);
      // 相位：2s 一个完整周期
      if (playing) this._phase = ((this._phase || 0) + dt / 2000 * Math.PI * 2) % (Math.PI * 2);
      const phase = this._phase || 0, amp = this._amp;

      // 左右留出游标半径，避免端点/游标被画布边缘裁掉
      const pad = WAVE_PAD, x0 = pad, ww = Math.max(1, w - pad * 2);
      const seg = Math.max(48, Math.min(180, Math.ceil(ww / 6)));
      const sw = ww / seg;
      const px = x0 + Math.max(0, Math.min(1, ratio || 0)) * ww;
      const F = 0.2;   // 波长≈31px，与原实现在手机上的观感一致
      const path = new Path2D();
      path.moveTo(x0, cy + Math.sin(phase) * amp);
      for (let i = 1; i <= seg; i++) { const x = x0 + i * sw; path.lineTo(x, cy + Math.sin(x * F + phase) * amp); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2.5; ctx.stroke(path);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, px, h); ctx.clip();
      ctx.strokeStyle = this._accent(); ctx.lineWidth = 4; ctx.stroke(path);
      ctx.restore();
      const ty = cy + Math.sin(px * F + phase) * amp;
      ctx.beginPath(); ctx.fillStyle = this._accent();
      ctx.arc(px, ty, this._barDrag ? 8 : 6, 0, Math.PI * 2); ctx.fill();
    }
    _waveRatio() {
      const p = this.player; if (!p) return 0;
      const dur = p.duration || (p.audio && p.audio.duration) || 0;
      if (!dur) return 0;
      const t = (p.audio && p.audio.currentTime) || p.currentTime || 0;
      return t / dur;
    }
    _rafTick() {
      const p = this.player;
      // 波形：拖动时跟手指，其余跟随播放进度
      this._drawWave(this._barDrag && this._dragRatio != null ? this._dragRatio : this._waveRatio());
      if (!p) return;
      if (p._qSwitch) return;   // 切音质重载期间不刷新进度/逐字，避免回零闪动
      const dur = p.duration || (p.audio && p.audio.duration) || 0;
      const t = (p.audio && p.audio.currentTime) || p.currentTime || 0;
      if (dur && !this._barDrag) this.fill.style.width = (t / dur * 100) + '%';   // 进度条也丝滑（拖动时不抢）
      const wbw = window.AppSettings && window.AppSettings.wordByWord && window.AppSettings.wordByWord.enabled;
      const idx = p.currentLyricIndex, ly = p.lyrics || [];
      if (!wbw || idx < 0 || !ly[idx] || !ly[idx].words) return;
      const c = ly[idx], n = ly[idx + 1];
      const lnEl = this.lyricsBox.querySelectorAll('.ln')[idx];
      if (!lnEl) return;
      const spans = lnEl.querySelectorAll('.w');
      for (let i = 0; i < c.words.length; i++) {
        const start = c.words[i].time;
        const end = i + 1 < c.words.length ? c.words[i + 1].time : (n ? n.time : start + 0.6);
        let pct = end > start ? (t - start) / (end - start) : (t >= start ? 1 : 0);
        pct = pct < 0 ? 0 : pct > 1 ? 1 : pct;
        if (spans[i]) spans[i].style.setProperty('--p', (pct * 100).toFixed(1) + '%');
      }
    }

    _renderPlay(p) { this.playBtn.innerHTML = p ? ICON.pause : ICON.play; this.el.classList.toggle('playing', !!p); }
    _renderMode() {
      const m = (this.player && this.player.playMode) || 'list';
      const def = MODE[m] || MODE.list;
      this.modeBtn.innerHTML = def.icon; this.modeBtn.title = def.label;
      this.modeBtn.classList.toggle('active', m !== 'list');   // 随机/单曲时高亮
    }

    /* 收藏（服务端库），需 window.Library 提供（整页播放器注入）；旧页无则降级隐藏 */
    _updateLikeState() {
      const s = this.player && this.player.currentSong;
      const liked = !!(window.Library && s && window.Library.isLiked && window.Library.isLiked(s.id));
      this.likeBtn.classList.toggle('active', liked);
      this.likeBtn.innerHTML = liked ? ICON.heartF : ICON.heart;
    }
    async _toggleLike() {
      const s = this.player && this.player.currentSong;
      if (!s || !window.Library || !window.Library.toggleLike) return;
      await window.Library.toggleLike(s);
      this._updateLikeState();
    }

    open(lyricsOnly) {
      this._lyricsOnly = !!lyricsOnly;
      this._hoverHold = false;   // 上次关闭时鼠标可能没触发 mouseleave
      this.el.classList.toggle('lyrics-only', this._lyricsOnly);
      this.applyStyle();
      this._setMPage((this._lyricsOnly || (this._ps && this._ps.skin === 'lyrics')) ? 'lyrics' : 'cover');
      if (this.player) this._syncFromState();
      this._renderMini(this.player ? this.player.currentLyricIndex : -1);
      this.el.classList.add('open'); document.body.style.overflow = 'hidden'; this._startRAF();
    }
    closePreview() { if (this.preview) this.preview.classList.remove('show'); }
    close() { this.el.classList.remove('open'); document.body.style.overflow = ''; this._stopRAF(); this.closeStylePanel(); this.closeQueue(); this.closePreview(); }
    toggle() { this.el.classList.contains('open') ? this.close() : this.open(false); }
    toggleLyrics() { (this.el.classList.contains('open') && this._lyricsOnly) ? this.close() : this.open(true); }
  }

  const inst = new NowPlayingOverlay();
  window.NowPlaying = inst;
  // 自动绑定（player 可能已就绪或稍后就绪）
  function tryBind() {
    const p = window.player || window.qqPlayer;
    if (p && p.on) { inst.bind(p); return true; }
    return false;
  }
  if (!tryBind()) {
    let n = 0;
    const t = setInterval(() => { if (tryBind() || ++n > 40) clearInterval(t); }, 150);
  }
})();
