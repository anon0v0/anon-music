/*
 * 全屏正在播放 / 沉浸歌词组件（完全对标参考设计规范）
 * Image 1: 封面分栏模式（左侧方形专辑封面，右侧标题+VIP+歌手+歌词流）
 * Image 2: 简约歌词模式（全屏居中纯歌词，居中大标题，当前唱句黄金高亮发光）
 * 底栏控制台:
 *   - 左侧: 正在播放歌曲 - 歌手 [VIP]，下方喜欢 / 评论(带数字角标) / 加入歌单 / 更多
 *   - 中间: 顶部霓虹微光 + 循环 / 上一首 / 实心圆形主播放 / 下一首 / 音量 + 3px直线进度条
 *   - 右侧: 皮肤切换(T恤图标) / 臻品音质黄金胶囊 / 音效 / 词 / 播放列表 / 伴奏徽标
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
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4.5A2 2 0 0 1 3 15V7a2 2 0 0 1 2-2z"/><path d="M7 8h10M7 12h7M7 16h4"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11M3 12h11M3 18h7"/><path d="M17 11v8M13 15h8"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.2-3.2 3.2h-2.4a2.4 2.4 0 0 0-1.8 4c.4.4.6.9.6 1.4 0 .8-.6 1.4-1.4 1.4z"/><circle cx="7.6" cy="11.6" r="1"/><circle cx="10.6" cy="7.6" r="1"/><circle cx="15.2" cy="8.2" r="1"/></svg>',
    tshirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
    eq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2"/></svg>',
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

  class NowPlayingOverlay {
    constructor() {
      this.player = null;
      this.seeking = false;
      this._build();
    }

    _build() {
      const el = document.createElement('div');
      el.className = 'np-overlay';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '正在播放');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
      el.inert = true;
      el.innerHTML = `
        <div class="np-bg"></div>
        <div class="np-fluid" aria-hidden="true"></div>
        <div class="np-topbar">
          <button class="np-close" title="收起播放页" aria-label="收起播放页">
            ${ICON.chevDown}
          </button>
          <div class="np-heading" style="display:none">正在播放</div>
          <div class="np-dots" role="group" aria-label="播放页视图"><span data-p="cover" class="active" role="button" tabindex="0" aria-pressed="true">封面</span><span data-p="lyrics" role="button" tabindex="0" aria-pressed="false">歌词</span></div>
          <div class="np-top-actions">
            <button class="np-top-btn np-top-min" title="最小化" aria-label="最小化">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="np-top-btn np-top-expand" title="全屏切换" aria-label="全屏切换">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M15 3h6v6M9 21H3v-6"/></svg>
            </button>
            <button class="np-top-btn np-top-close" title="关闭" aria-label="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="np-more">
              <button class="np-more-btn" title="更多">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
              </button>
              <div class="np-more-menu">
                <div data-a="style" role="button" tabindex="0">${ICON.palette}<span>播放器样式</span></div>
                <div data-a="download" role="button" tabindex="0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></svg><span>下载当前歌曲</span></div>
                <label class="np-speed-label">播放速度<select class="np-speed-select" aria-label="播放速度"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1.0×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select></label>
              </div>
            </div>
          </div>
        </div>
        <div class="np-queue">
          <div class="np-queue-head"><span>播放列表 <i class="np-q-count"></i></span><span class="np-qh-r"><button class="np-q-clear">清空</button><button class="np-q-close" title="关闭">×</button></span></div>
          <div class="np-queue-list"></div>
        </div>
        <div class="np-style-panel"></div>
        <div class="np-stage">
          <div class="np-body">
            <!-- 左栏：大尺寸高清方形专辑封面 (Image 1 规范) -->
            <div class="np-left">
              <div class="np-cover-wrap">
                <img class="np-cover" alt="专辑封面" src="/static/app-icon.png">
                <span class="np-srcbadge"></span>
              </div>
              <div class="np-meta" style="display:none">
                <div class="np-title">从一首喜欢的歌开始</div>
                <div class="np-artist">选择音乐，开始聆听</div>
                <div class="np-record-label"><span class="np-source"></span></div>
              </div>
              <div class="np-mini-lyric" style="display:none"><div class="ml-a"></div><div class="ml-b"></div></div>
            </div>
            <!-- 右栏：歌曲标题 + VIP角标 + 歌手 + 歌词流 (Image 1) 或 居中纯歌词 (Image 2) -->
            <div class="np-right">
              <div class="np-stage-header">
                <div class="np-title-row">
                  <h1 class="np-stage-title np-title">从一首喜欢的歌开始</h1>
                  <span class="np-vip-badge">VIP</span>
                </div>
                <div class="np-stage-artist np-artist">选择音乐，开始聆听</div>
              </div>
              <div class="np-lyrhead" style="display:none"><div class="t"></div><div class="a"></div></div>
              <div class="np-lyrics-wrap">
                <div class="np-lyrics"><div class="empty">歌词会在这里，随音乐展开</div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="np-footer">
          <!-- 左侧：正在播放曲目信息与操作区 (喜欢、评论、加入歌单、更多) -->
          <div class="np-foot-left">
            <div class="np-foot-meta">
              <span class="np-foot-name">从一首喜欢的歌开始</span>
              <span class="np-foot-sep">-</span>
              <span class="np-foot-artist">选择音乐</span>
              <span class="np-foot-vip">VIP</span>
            </div>
            <div class="np-foot-acts">
              <button class="np-like" title="喜欢">${ICON.heart}</button>
              <button class="np-cbtn" title="评论">
                ${ICON.comment}
                <span class="np-cbtn-count">999+</span>
              </button>
              <button class="np-addpl" title="加入歌单">${ICON.plus}</button>
              <button class="np-foot-more-btn" title="更多选项">
                ${ICON.more}
              </button>
            </div>
          </div>

          <!-- 中间：顶部霓虹微光 + 控制按键 + 直线进度条 -->
          <div class="np-foot-center">
            <div class="np-center-glow"></div>
            <div class="np-main-ctrl">
              <button class="np-mode" title="播放模式"></button>
              <button class="np-prev" title="上一首">${ICON.prev}</button>
              <button class="np-play" title="播放/暂停">${ICON.play}</button>
              <button class="np-next" title="下一首">${ICON.next}</button>
              <div class="np-vol">
                <button class="np-vol-btn" title="音量">${ICON.vol}</button>
                <div class="np-vol-pop">
                  <div class="np-vol-track" role="slider" tabindex="0" aria-label="音量" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="np-vol-fill"></div><div class="np-vol-thumb"></div></div>
                  <div class="np-vol-num">100%</div>
                  <button class="np-vol-mute" title="静音 / 恢复">${ICON.vol}</button>
                </div>
              </div>
            </div>
            <div class="np-progress">
              <span class="t np-cur">0:00</span>
              <div class="np-bar" role="slider" tabindex="0" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="np-bar-track"><div class="np-bar-fill"></div><span class="np-bar-thumb" aria-hidden="true"></span></div>
                <div class="np-bar-tip"></div>
              </div>
              <span class="t np-dur">0:00</span>
            </div>
          </div>

          <!-- 右侧：样式切换 (切简约歌词/唱片) + 音质胶囊 + 音效 + 桌面歌词 + 播放队列 + 伴奏 -->
          <div class="np-foot-right">
            <button class="np-style-btn" id="npSkinToggle" title="切换简约歌词 / 封面分栏" aria-label="切换简约歌词与封面分栏">
              ${ICON.tshirt}
            </button>
            <div class="np-q">
              <button class="np-q-btn" title="选择音质"><span class="np-q-label">臻品音质</span></button>
              <div class="np-q-menu">${QUALITIES.map(q => `<div data-q="${q[0]}">${q[1]}</div>`).join('')}</div>
            </div>
            <button class="np-eq-btn" title="音效设置" aria-label="音效设置">
              ${ICON.eq}
            </button>
            <button class="np-lyric" title="悬浮歌词显示/隐藏">词</button>
            <button class="np-qbtn" title="播放列表">${ICON.queue}</button>
            <span class="np-foot-sub-badge">伴</span>
          </div>
          <div class="np-legacy" style="display:none"><button class="np-collapse"></button></div>
        </div>
        <div class="np-preview"><img alt="封面大图"></div>`;
      document.body.appendChild(el);
      this.el = el;
      this.$ = (s) => el.querySelector(s);
      this.bg = this.$('.np-bg'); this.fluid = this.$('.np-fluid'); this.cover = this.$('.np-cover');
      this.title = this.$('.np-title'); this.artist = this.$('.np-artist');
      this.footName = this.$('.np-foot-name'); this.footArtist = this.$('.np-foot-artist');
      this.source = this.$('.np-source'); this.lyricsBox = this.$('.np-lyrics');
      this.curT = this.$('.np-cur'); this.durT = this.$('.np-dur');
      this.bar = this.$('.np-bar'); this.fill = this.$('.np-bar-fill');
      this.playBtn = this.$('.np-play'); this.modeBtn = this.$('.np-mode');
      this.qLabel = this.$('.np-q-label'); this.likeBtn = this.$('.np-like');
      this.volBtn = this.$('.np-vol-btn'); this.volWrap = this.$('.np-vol'); this.volPop = this.$('.np-vol-pop');
      this.volTrack = this.$('.np-vol-track'); this.volFill = this.$('.np-vol-fill');
      this.volThumb = this.$('.np-vol-thumb'); this.volNum = this.$('.np-vol-num'); this.volMute = this.$('.np-vol-mute');
      this.rightBox = this.$('.np-right');
      this.srcBadge = this.$('.np-srcbadge');
      this.queuePanel = this.$('.np-queue'); this.queueList = this.$('.np-queue-list'); this.queueCount = this.$('.np-q-count');
      this.miniA = this.$('.np-mini-lyric .ml-a'); this.miniB = this.$('.np-mini-lyric .ml-b');
      this.skinToggle = this.$('#npSkinToggle');
      if (this.skinToggle) {
        this.skinToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = (this._ps && this._ps.skin) || 'square';
          const target = cur === 'lyrics' ? 'square' : 'lyrics';
          this.setSkin(target);
        });
      }
      const footMore = this.$('.np-foot-more-btn');
      if (footMore) {
        footMore.addEventListener('click', (e) => {
          e.stopPropagation();
          const moreBtn = this.$('.np-more-btn');
          if (moreBtn) moreBtn.click();
        });
      }
      const topMin = this.$('.np-top-min');
      if (topMin) topMin.addEventListener('click', () => this.close());
      const topClose = this.$('.np-top-close');
      if (topClose) topClose.addEventListener('click', () => this.close());
      const topExpand = this.$('.np-top-expand');
      if (topExpand) {
        topExpand.addEventListener('click', () => {
          try {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen().catch(() => {});
          } catch (_) {}
        });
      }
      const eqBtn = this.$('.np-eq-btn');
      if (eqBtn) {
        eqBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          eqBtn.classList.toggle('active');
        });
      }
      this.cover.addEventListener('error', () => {
        const fallback = window.IMG_PLACEHOLDER || '/static/app-icon.png';
        if (this.cover.getAttribute('src') !== fallback) this.cover.src = fallback;
      });
      this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      if (window.ResizeObserver) {
        this._lyricResize = new ResizeObserver(() => {
          if (this.el.classList.contains('open')) {
            this._layoutLyrics();
          }
        });
        this._lyricResize.observe(this.rightBox);
      }
      window.addEventListener('resize', () => {
        if (this.el && this.el.classList.contains('open')) {
          this._layoutLyrics();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this._stopRAF();
        else if (this.el.classList.contains('open') && this.el.classList.contains('playing')) this._startRAF();
      });

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
      this.el.querySelectorAll('.np-dots span').forEach(d => d.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); d.click(); }
      }));

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
          this.closeQueue();
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
      const qLabelFor = (q) => { const m = QUALITIES.find(x => x[0] === q); return m ? m[1] : '臻品音质'; };
      this.qLabelFor = qLabelFor;
      const npq = this.$('.np-q');
      this.npq = npq;
      const closeAllPopups = (except) => {
        if (npq && except !== npq) npq.classList.remove('open');
        if (this.volWrap && except !== this.volWrap) this.volWrap.classList.remove('open');
        const more = this.$('.np-more');
        if (more && except !== more) more.classList.remove('open');
        if (this.queuePanel && except !== this.queuePanel) this.closeQueue();
        if (this.stylePanel && except !== this.stylePanel) this.closeStylePanel();
      };
      this._closeAllPopups = closeAllPopups;
      this.$('.np-q-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !npq.classList.contains('open');
        closeAllPopups();
        if (willOpen) npq.classList.add('open');
      });
      this.$('.np-q-menu').querySelectorAll('div').forEach(it => it.addEventListener('click', () => {
        const q = it.dataset.q; if (this.player) this.player.setQuality(q); this.qLabel.textContent = qLabelFor(q); closeAllPopups();
      }));
      // 桌面歌词「词」
      const npl = this.$('.np-lyric');
      npl.addEventListener('click', () => { if (window.DeskLyric) { const on = window.DeskLyric.toggle(); npl.classList.toggle('active', on); } });
      this._npl = npl;
      // 点空白关掉全部弹窗
      this.el.addEventListener('click', (e) => {
        const inside = e.target.closest('.np-q, .np-vol, .np-more, .np-queue, .np-style-panel');
        if (!inside) closeAllPopups();
      });
      // 播放列表关闭按钮
      this.$('.np-q-close').addEventListener('click', (e) => { e.stopPropagation(); this.queuePanel.classList.remove('show'); const qb = this.$('.np-qbtn'); if (qb) qb.classList.remove('active'); });
      // 音量：喇叭弹出竖向调节条（默认 100）
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
        this.volTrack.setAttribute('aria-valuenow', String(pct));
        this.volTrack.setAttribute('aria-valuetext', pct + '%');
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
      this.volBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !this.volWrap.classList.contains('open');
        closeAllPopups();
        if (willOpen) this.volWrap.classList.add('open');
      });
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
      this.volTrack.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        if (this._volDragCleanup) this._volDragCleanup();
        ev.preventDefault(); ev.stopPropagation(); applyVol(volFromEvent(ev), true);
        const mv = e => applyVol(volFromEvent(e), true);
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); window.removeEventListener('blur', up); this._volDragCleanup = null; };
        this._volDragCleanup = up;
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); window.addEventListener('blur', up);
      });
      this.volTrack.addEventListener('touchstart', ev => {
        if (ev.touches.length !== 1) return;
        if (this._volDragCleanup) this._volDragCleanup();
        ev.preventDefault(); ev.stopPropagation(); applyVol(volFromEvent(ev), true);
        const mv = e => { if (e.touches.length) applyVol(volFromEvent(e), true); };
        const up = () => { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); document.removeEventListener('touchcancel', up); this._volDragCleanup = null; };
        this._volDragCleanup = up;
        document.addEventListener('touchmove', mv); document.addEventListener('touchend', up); document.addEventListener('touchcancel', up);
      }, { passive: false });
      this.volPop.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        applyVol(logicalVol() + (ev.deltaY < 0 ? 0.05 : -0.05), true);
      }, { passive: false });
      this.volTrack.addEventListener('keydown', e => {
        const step = { ArrowUp: .05, ArrowRight: .05, ArrowDown: -.05, ArrowLeft: -.05 }[e.key];
        if (step == null && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault(); e.stopPropagation();
        applyVol(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : logicalVol() + step, true);
      });
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
          if (!_tMoved && Math.abs(dy) < 4) return;
          _tMoved = true;
          this._preview = true;
          this._previewY = _tBase + dy;
          this._clampPreview();
          this.lyricsBox.style.transform = `translateY(${this._previewY}px)`;
        }, { passive: true });
        this.rightBox.addEventListener('touchend', () => {
          if (!_tMoved) {
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
        if (window.matchMedia && matchMedia('(hover: hover)').matches) {
          this.rightBox.addEventListener('mouseenter', () => { if (!this._lyricsOnly) this._hoverHold = true; });
          this.rightBox.addEventListener('mouseleave', () => { this._hoverHold = false; if (!this._preview) this._layoutLyrics(); });
        }
      }
      // 进度条：点击 + 拖动
      const barRatio = (e) => { const r = this.bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))); };
      const barDur = () => { const st = this.player ? this.player.getState() : {}; return st.duration || (this.player && this.player.audio && this.player.audio.duration) || 0; };
      const paintDrag = ratio => { this._dragRatio = ratio; this._setProgress(ratio); this.curT.textContent = fmt(ratio * barDur()); };
      const beginDrag = ratio => { this._barDrag = true; this.bar.classList.add('dragging'); paintDrag(ratio); };
      const endDrag = (ratio, commit) => {
        this._barDrag = false; this._dragRatio = null; this.bar.classList.remove('dragging');
        if (commit && this.player) this.player.seekTo(ratio * barDur());
        this._rafTick();
      };
      this.bar.addEventListener('mousedown', e => { if (e.button !== 0 || !this.player || !barDur()) return; beginDrag(barRatio(e)); e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (this._barDrag) paintDrag(barRatio(e)); });
      window.addEventListener('mouseup', e => { if (this._barDrag) endDrag(barRatio(e), true); });
      const barTouchRatio = e => { const t = e.touches[0] || e.changedTouches[0]; return t ? barRatio(t) : 0; };
      this.bar.addEventListener('touchstart', e => { if (!this.player || !barDur() || e.touches.length !== 1) return; beginDrag(barTouchRatio(e)); e.preventDefault(); }, { passive: false });
      this.bar.addEventListener('touchmove', e => { if (!this._barDrag) return; paintDrag(barTouchRatio(e)); e.preventDefault(); }, { passive: false });
      this.bar.addEventListener('touchend', e => { if (this._barDrag) endDrag(barTouchRatio(e), true); });
      this.bar.addEventListener('touchcancel', () => { if (this._barDrag) endDrag(0, false); });
      this.bar.addEventListener('keydown', e => {
        const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
        if (!this.player || (step == null && e.key !== 'Home' && e.key !== 'End')) return;
        e.preventDefault(); e.stopPropagation();
        const dur = barDur();
        if (!Number.isFinite(dur) || dur <= 0) return;
        const cur = this.player.getState().currentTime || 0;
        this.player.seekTo(e.key === 'Home' ? 0 : e.key === 'End' ? dur : Math.max(0, Math.min(dur, cur + step)));
      });
      // 悬停预览：左侧时间随光标 + 光标位置歌词气泡
      const npTip = this.$('.np-bar-tip');
      this.bar.addEventListener('mousemove', (e) => {
        if (this._barDrag) return;
        this._barHover = true;
        const rt = barRatio(e);
        this.curT.textContent = fmt(rt * barDur());
        if (npTip) { const tx = this._lyricAt(rt * barDur()); npTip.textContent = tx; npTip.style.left = (rt * 100) + '%'; npTip.classList.toggle('show', !!tx); }
      });
      this.bar.addEventListener('mouseleave', () => { this._barHover = false; if (npTip) npTip.classList.remove('show'); });
      // 仅歌词模式：点空白处关闭
      this.el.addEventListener('click', (e) => { if (this._lyricsOnly && !e.target.closest('.ln')) this.close(); });
      document.addEventListener('keydown', e => {
        if (!this.el.classList.contains('open') || e.defaultPrevented) return;
        if (document.querySelector('.modal-mask.open, .ov-mask.open, .comment-panel.open, .confirm-mask.open')) return;
        if (e.key === 'Tab') {
          const nodes = [...this.el.querySelectorAll('button, input, select, [tabindex="0"]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && !n.disabled && !n.closest('.np-more:not(.open) .np-more-menu'));
          if (!nodes.length) return;
          const first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
          if (e.shiftKey && (active === first || active === this.el)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (active === last || active === this.el || !this.el.contains(active))) { e.preventDefault(); first.focus(); }
          return;
        }
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (this.preview && this.preview.classList.contains('show')) { this.closePreview(); return; }
        if (this.queuePanel.classList.contains('show')) { this.closeQueue(); return; }
        const style = this.$('.np-style-panel');
        if (style && style.classList.contains('show')) { this.closeStylePanel(); return; }
        if (this.$('.np-more').classList.contains('open')) { this.$('.np-more').classList.remove('open'); return; }
        if (this.$('.np-q').classList.contains('open')) { this.$('.np-q').classList.remove('open'); return; }
        if (this.volWrap.classList.contains('open')) { this.volWrap.classList.remove('open'); return; }
        this.close();
      });

      /* ===== 封面长按 → 沉浸大图预览 ===== */
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
      coverWrap.addEventListener('contextmenu', (e) => { e.preventDefault(); openPreview(); });
      this.preview.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._pvAt && Date.now() - this._pvAt < 550) return;
        this.closePreview();
      });

      /* ===== 顶栏「更多」菜单 ===== */
      const moreWrap = this.$('.np-more'), moreMenu = this.$('.np-more-menu');
      this.$('.np-more-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !moreWrap.classList.contains('open');
        this._closeAllPopups();
        if (willOpen) {
          moreWrap.classList.add('open');
          this.$('[data-a="download"]').hidden = !document.getElementById('pbDownload');
          this.$('.np-speed-select').value = String(window.getPlaybackSpeed ? window.getPlaybackSpeed() : ((this.player && this.player.audio.playbackRate) || 1));
        }
      });
      moreMenu.addEventListener('click', (e) => {
        const it = e.target.closest('[data-a]'); if (!it) return;
        e.stopPropagation();
        moreWrap.classList.remove('open');
        if (it.dataset.a === 'style') { const sb = this.$('.np-style-btn'); if (sb) sb.click(); }
        if (it.dataset.a === 'download') { const button = document.getElementById('pbDownload'); if (button) button.click(); }
      });
      moreMenu.addEventListener('keydown', e => {
        const item = e.target.closest('[data-a]');
        if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); item.click(); }
      });
      this.$('.np-speed-select').addEventListener('click', e => e.stopPropagation());
      this.$('.np-speed-select').addEventListener('change', e => {
        e.stopPropagation(); const speed = Number(e.target.value);
        if (window.setPlaybackSpeed) window.setPlaybackSpeed(speed);
        else if (this.player && this.player.audio) this.player.audio.playbackRate = speed;
        moreWrap.classList.remove('open');
      });
      this.el.addEventListener('click', () => moreWrap.classList.remove('open'));

      this._bindGestures();
    }

    _bindGestures() {
      const el = this.el;
      let x0 = 0, y0 = 0, dx = 0, dy = 0, tracking = false, axis = '';
      this._resetGesture = () => { tracking = false; axis = ''; dx = dy = 0; el.style.transition = ''; el.style.transform = ''; };
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
        if (axis === 'y' && dy > 0 && !this._reducedMotion.matches) el.style.transform = `translate3d(0,${Math.pow(dy, .86)}px,0)`;
      }, { passive: true });
      const settle = () => {
        if (!tracking) return;
        tracking = false;
        el.style.transition = '';
        if (axis === 'y' && dy > 90) { this.close(); return; }
        el.style.transform = '';
        if (axis === 'x' && Math.abs(dx) > 56 && this._isMobile() && !this._lyricsOnly && (!this._ps || this._ps.skin !== 'lyrics')) {
          this._setMPage(dx < 0 ? 'lyrics' : 'cover');
        }
        axis = ''; dx = dy = 0;
      };
      el.addEventListener('touchend', settle, { passive: true });
      el.addEventListener('touchcancel', () => this._resetGesture(), { passive: true });
      let lx0 = 0, ly0 = 0;
      this.rightBox.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        lx0 = e.touches[0].clientX; ly0 = e.touches[0].clientY;
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

    applyStyle() {
      const ps = Object.assign({}, PS_DEFAULTS, (window.AppSettings && window.AppSettings.playerStyle) || {});
      if (!['square', 'lyrics'].includes(ps.skin)) ps.skin = 'square';
      ps.bg = 'auto'; ps.lyricAlign = 'center'; ps.viz = 'line';
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
      this.el.style.setProperty('--vinylCB', `rgba(${c[0]},${c[1]},${c[2]},.55)`);
      this.el.style.setProperty('--vinylCR', `rgba(${c[0]},${c[1]},${c[2]},.82)`);
      if (ps.bg && ps.bg !== 'auto') this._applyBg(hexRgb(ps.bg));
      else if (this._lastPic !== undefined) this._extractColor(this._lastPic);
      if (ps.skin === 'lyrics') this._setMPage('lyrics');
      else if (!this.el.dataset.mpage) this._setMPage('cover');
    }

    setSkin(skin) {
      skin = skin === 'lyrics' ? 'lyrics' : 'square';
      this._ps = this._ps || {};
      this._ps.skin = skin;
      this.el.dataset.skin = skin;
      try {
        let st = JSON.parse(localStorage.getItem('anon_player_style') || '{}');
        st.skin = skin;
        localStorage.setItem('anon_player_style', JSON.stringify(st));
        if (window.AppSettings) {
          window.AppSettings.playerStyle = window.AppSettings.playerStyle || {};
          window.AppSettings.playerStyle.skin = skin;
        }
      } catch (_) {}
      this._setMPage(skin === 'lyrics' ? 'lyrics' : 'cover');
      this._layoutLyrics();
      requestAnimationFrame(() => this._layoutLyrics());
    }

    _setMPage(pg) {
      pg = pg === 'lyrics' ? 'lyrics' : 'cover';
      const changed = this.el.dataset.mpage !== pg;
      this.el.dataset.mpage = pg;
      if (changed && this._isMobile() && this.el.classList.contains('open') && !this._reducedMotion.matches) {
        const target = pg === 'lyrics' ? this.rightBox : this.$('.np-left');
        if (target && target.animate) target.animate([{ opacity: .25, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      this.el.querySelectorAll('.np-dots span').forEach(d => { const active = d.dataset.p === pg; d.classList.toggle('active', active); d.setAttribute('aria-pressed', String(active)); });
      if (pg === 'lyrics') {
        this._layoutLyrics();
        requestAnimationFrame(() => this._layoutLyrics());
      }
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

    _artistHTML(s) {
      const arr = Array.isArray(s.artistList) ? s.artistList : (Array.isArray(s.artists) ? s.artists : null);
      if (arr && arr.length && arr[0] && arr[0].id) {
        return arr.map(a => `<span class="np-ar-link" data-aid="${attr(a.id)}">${esc(a.name)}</span>`).join('<span class="np-ar-sep">, </span>');
      }
      const txt = (typeof s.artists === 'string' ? s.artists : '') || s.artist || '';
      return txt ? `<span class="np-ar-search">${esc(txt)}</span>` : '';
    }

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
      if (player.audio) player.audio.addEventListener('volumechange', () => {
        if (this._renderVol && this._logicalVol) this._renderVol(this._logicalVol());
      });
      try {
        const info = player.element && player.element.querySelector('.song-info');
        if (info) { info.style.cursor = 'pointer'; info.addEventListener('click', () => this.open()); }
      } catch (e) {}
      this._syncFromState();
    }

    _syncFromState() {
      if (!this.player) return;
      const st = this.player.getState();
      if (this.qLabel) this.qLabel.textContent = (this.qLabelFor ? this.qLabelFor(st.quality || 'standard') : '臻品音质');
      try { if (this._npl && window.DeskLyric) this._npl.classList.toggle('active', window.DeskLyric.isOn()); } catch (_) {}
      this._renderMode();
      try {
        if (this._renderVol) this._renderVol(this._logicalVol ? this._logicalVol() : 1);
      } catch (_) {}
      if (st.song) { this._renderSong(st.song); this._renderLyrics(); } else { this.reset(); }
      this._renderPlay(st.isPlaying);
      this._tick({ currentTime: st.currentTime, duration: st.duration });
    }

    _renderSong(s) {
      if (!s) return;
      const name = s.name || '未知歌曲';
      const arHTML = this._artistHTML(s);
      this.title.textContent = name;
      this.artist.innerHTML = arHTML;
      if (this.footName) this.footName.textContent = name;
      if (this.footArtist) this.footArtist.innerHTML = arHTML;
      const lh = this.$('.np-lyrhead');
      if (lh) { lh.querySelector('.t').textContent = name; lh.querySelector('.a').innerHTML = arHTML; }
      if (this.source) { const id = String(s.id || ''); this.source.textContent = id.startsWith('qq:') ? 'QQ 音乐' : id.startsWith('netease:') ? '网易云音乐' : id.startsWith('local:') ? '本地音乐' : '正在聆听'; }
      if (this.srcBadge) {
        const id = String(s.id || '');
        const src = id.startsWith('qq:') ? 'qq' : (id.startsWith('netease:') ? 'netease' : '');
        this.srcBadge.innerHTML = src === 'qq' ? '<img src="/static/qqmusic.png" alt="QQ 音乐">'
          : (src === 'netease' ? '<img src="/static/wyyyy.jpg" alt="网易云音乐">' : '');
        this.srcBadge.classList.toggle('show', !!src);
      }
      const pic = (window.httpsify ? window.httpsify(s.picUrl || s.pic) : (s.picUrl || s.pic)) || '';
      this.cover.src = pic || window.IMG_PLACEHOLDER || '/static/app-icon.png';
      this.cover.alt = (s.name || '当前歌曲') + ' · 专辑封面';
      this._lastPic = pic;
      if (this.bg && pic) this.bg.style.backgroundImage = `url("${pic}")`;
      const psBg = this._ps && this._ps.bg;
      if (psBg && psBg !== 'auto') this._applyBg(hexRgb(psBg));
      else this._extractColor(pic);
      this._applyFluidPref();
      this._updateLikeState();
    }

    _extractColor(picUrl) {
      if (!picUrl) { this._applyBg(null); return; }
      this._colorCache = this._colorCache || new Map();
      const cached = this._colorCache.get(picUrl);
      if (cached) { this._applyBg(cached); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (this._lastPic !== picUrl) return;
        try {
          const cv = document.createElement('canvas');
          const w = cv.width = 40, h = cv.height = 40;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
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
          if (c) {
            this._colorCache.set(picUrl, c);
            while (this._colorCache.size > 50) this._colorCache.delete(this._colorCache.keys().next().value);
          }
          this._applyBg(c);
        } catch (e) { this._applyBg(null); }
      };
      img.onerror = () => { if (this._lastPic === picUrl) this._applyBg(null); };
      img.src = /^(blob:|data:)/.test(picUrl) ? picUrl : apiUrl('/api/img?url=' + encodeURIComponent(picUrl));
    }

    _applyBg(c) {
      this.bg.style.removeProperty('background');
      this.el.style.setProperty('--np-tint', (c || [150, 150, 160]).map(n => Math.round(Math.max(0, Math.min(255, n)))).join(' '));
    }

    _applyFluidPref() {
      this.el.classList.remove('fluid-on');
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
      this._layoutLyrics();
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
      if (open) { this._renderQueue(); if (window.Comments) window.Comments.close(); this.closeStylePanel(); requestAnimationFrame(positionQueuePanel); }
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

    /* 精准居中当前行：基于父容器绝对坐标计算，彻底消除视口重排与缩放误差 */
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
      if (!active) return;
      const wrap = this.$('.np-lyrics-wrap');
      const boxRect = box.getBoundingClientRect();
      const wrapRect = wrap ? wrap.getBoundingClientRect() : boxRect;
      const wrapRelTop = wrapRect.top - boxRect.top;
      const activeCenter = active.offsetTop + active.offsetHeight / 2;
      const targetCenter = box.clientHeight / 2;
      const y = targetCenter - wrapRelTop - activeCenter;
      this.lyricsBox.style.transform = `translateY(${y}px)`;
    }

    _tick(d) {
      d = d || {}; const cur = d.currentTime || 0; const dur = d.duration || 0;
      if (!this._barDrag && !this._barHover) this.curT.textContent = fmt(cur);
      this.durT.textContent = fmt(dur);
      if (!this._barDrag) this._setProgress(dur > 0 ? cur / dur : 0);
      this.bar.setAttribute('aria-valuenow', String(Math.round(dur > 0 ? Math.max(0, Math.min(100, cur / dur * 100)) : 0)));
      this.bar.setAttribute('aria-valuetext', fmt(cur) + ' / ' + fmt(dur));
      if (this.player && this.player._qSwitch) return;
      const idx = this.player ? this.player.currentLyricIndex : -1;
      if (idx !== this._activeIdx) {
        this._activeIdx = idx;
        this._layoutLyrics();
        this._renderMini(idx);
      }
    }

    _startRAF() {
      this._stopRAF();
      if (document.hidden || !this.el.classList.contains('open') || !this.el.classList.contains('playing')) return;
      const loop = () => { this._rafTick(); this._raf = requestAnimationFrame(loop); };
      loop();
    }
    _stopRAF() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

    _setProgress(ratio) {
      ratio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
      this.bar.style.setProperty('--progress', ratio.toFixed(5));
    }
    _rafTick() {
      const p = this.player;
      if (!p) return;
      if (p._qSwitch) return;
      const dur = p.duration || (p.audio && p.audio.duration) || 0;
      const t = (p.audio && p.audio.currentTime) || p.currentTime || 0;
      if (!this._barDrag) this._setProgress(dur > 0 ? t / dur : 0);
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

    _renderPlay(p) {
      this.playBtn.innerHTML = p ? ICON.pause : ICON.play;
      this.playBtn.title = p ? '暂停' : '播放';
      this.playBtn.setAttribute('aria-label', this.playBtn.title);
      this.el.classList.toggle('playing', !!p);
      if (p) this._startRAF(); else { this._stopRAF(); this._rafTick(); }
      const status = this.$('.np-status');
      if (status) status.textContent = p ? '正在播放' : (this.player && this.player.currentSong ? '已暂停' : '等待播放');
    }
    _renderMode() {
      const m = (this.player && this.player.playMode) || 'list';
      const def = MODE[m] || MODE.list;
      this.modeBtn.innerHTML = def.icon; this.modeBtn.title = def.label;
      this.modeBtn.setAttribute('aria-label', def.label);
      this.modeBtn.classList.toggle('active', m !== 'list');
    }

    _updateLikeState() {
      const s = this.player && this.player.currentSong;
      const liked = !!(window.Library && s && window.Library.isLiked && window.Library.isLiked(s.id));
      this.likeBtn.classList.toggle('active', liked);
      this.likeBtn.setAttribute('aria-pressed', String(liked));
      this.likeBtn.innerHTML = liked ? ICON.heartF : ICON.heart;
    }
    async _toggleLike() {
      const s = this.player && this.player.currentSong;
      if (!s || !window.Library || !window.Library.toggleLike) return;
      await window.Library.toggleLike(s);
      this._updateLikeState();
    }

    reset() {
      this._lastPic = ''; this._applyBg(null); this.closePreview();
      this.title.textContent = '从一首喜欢的歌开始'; this.artist.textContent = '选择音乐，开始聆听';
      this.source.textContent = '';
      this.cover.src = window.IMG_PLACEHOLDER || '/static/app-icon.png'; this.cover.alt = '专辑封面';
      this.srcBadge.classList.remove('show'); this.srcBadge.innerHTML = '';
      const head = this.$('.np-lyrhead'); if (head) { head.querySelector('.t').textContent = '等待播放'; head.querySelector('.a').textContent = ''; }
      this._renderLyrics(); this._tick({ currentTime: 0, duration: 0 }); this._renderPlay(false); this._updateLikeState();
    }

    open(lyricsOnly) {
      if (!this.el.classList.contains('open')) {
        this._returnFocus = document.activeElement; this._previousOverflow = document.body.style.overflow;
        this._backgroundInert = [...document.querySelectorAll('.layout, .playbar, .mobile-bottom-nav')].map(node => [node, node.inert]);
        this._backgroundInert.forEach(([node]) => { node.inert = true; });
      }
      if (this._resetGesture) this._resetGesture();
      this._lyricsOnly = !!lyricsOnly;
      this._hoverHold = false;
      this.el.classList.toggle('lyrics-only', this._lyricsOnly);
      this.applyStyle();
      this._setMPage((this._lyricsOnly || (this._ps && this._ps.skin === 'lyrics')) ? 'lyrics' : 'cover');
      if (this.player) this._syncFromState();
      this._renderMini(this.player ? this.player.currentLyricIndex : -1);
      this.el.inert = false;
      this.el.classList.add('open'); document.body.style.overflow = 'hidden'; this._startRAF();
      this.el.setAttribute('aria-hidden', 'false');
      this.el.focus({ preventScroll: true });
      this._layoutLyrics();
      requestAnimationFrame(() => this._layoutLyrics());
    }
    closePreview() { if (this.preview) this.preview.classList.remove('show'); }
    close() {
      this.el.classList.remove('open'); this.el.setAttribute('aria-hidden', 'true');
      if (this._resetGesture) this._resetGesture();
      if (this._volDragCleanup) this._volDragCleanup();
      (this._backgroundInert || []).forEach(([node, wasInert]) => { node.inert = wasInert; }); this._backgroundInert = [];
      this.el.inert = true;
      this._barDrag = false; this._dragRatio = null; this.bar.classList.remove('dragging');
      document.body.style.overflow = this._previousOverflow || '';
      this._stopRAF(); this.closeStylePanel(); this.closeQueue(); this.closePreview();
      this.$('.np-more').classList.remove('open'); this.$('.np-q').classList.remove('open'); this.volWrap.classList.remove('open');
      if (this._returnFocus && this._returnFocus.isConnected) this._returnFocus.focus({ preventScroll: true });
    }
    toggle() { this.el.classList.contains('open') ? this.close() : this.open(false); }
    toggleLyrics() { (this.el.classList.contains('open') && this._lyricsOnly) ? this.close() : this.open(true); }
  }

  const inst = new NowPlayingOverlay();
  window.NowPlaying = inst;
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
