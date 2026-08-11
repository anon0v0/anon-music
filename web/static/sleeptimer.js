/* 睡眠定时器（模式设计参考 NeriPlayer 的 SleepTimerManager，GPL-3.0）。
 *
 * 四种模式：
 *   countdown        倒计时到点立即暂停
 *   countdown-finish 倒计时到点后，播完当前这首再暂停
 *   finish-current   播完当前这首就暂停
 *   finish-playlist  播完整个播放列表就暂停
 *
 * 可靠性要点：**不依赖 setTimeout 计时**。手机锁屏/切后台时 WebView 的定时器会被系统
 * 大幅节流甚至冻结，用 setTimeout 到点必然不准。这里改成记录一个绝对截止时刻
 * （Date.now() + 时长），在播放引擎的 timeupdate 事件里比对——那个事件由音频解码驱动，
 * 只要还在放歌就一定在跑，后台也不受影响。另挂一个低频 setInterval 只为在暂停状态下
 * 也能更新剩余时间显示。
 */
(function () {
  'use strict';

  const KEY = 'anon_sleep_timer';
  const PRESETS = [15, 30, 45, 60, 90, 120];

  let st = null;          // { mode, deadline, totalMs, pendingFinish }
  const listeners = [];

  const now = () => Date.now();
  const player = () => window.player;

  function notify() {
    const s = state();
    listeners.forEach((fn) => { try { fn(s); } catch (e) {} });
  }

  function state() {
    if (!st) return { active: false };
    return {
      active: true,
      mode: st.mode,
      totalMs: st.totalMs,
      remainingMs: st.deadline ? Math.max(0, st.deadline - now()) : 0,
      pendingFinish: !!st.pendingFinish,
    };
  }

  function save() {
    try {
      if (st) localStorage.setItem(KEY, JSON.stringify(st));
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      // 过期的定时器不恢复：用户可能关了 App 好几个小时
      if (v && v.deadline && v.deadline > now()) st = v;
      else if (v && !v.deadline) st = v;   // finish-current / finish-playlist 没有截止时刻
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function stopPlayback() {
    const p = player();
    try {
      if (p && p.audio && !p.audio.paused) p.audio.pause();
      else if (p && typeof p.pause === 'function') p.pause();
    } catch (e) {}
  }

  function fire() {
    st = null; save(); notify();
    stopPlayback();
    try { window.Notice ? window.Notice('睡眠定时器已到，暂停播放') : 0; } catch (e) {}
  }

  /** 由 timeupdate 驱动的检查——这是主计时路径 */
  function tick() {
    if (!st) return;
    if (st.deadline && now() >= st.deadline) {
      if (st.mode === 'countdown-finish') {
        // 到点不立刻停，标记为「这首放完就停」
        if (!st.pendingFinish) { st.pendingFinish = true; st.deadline = null; save(); notify(); }
      } else if (st.mode === 'countdown') {
        fire();
      }
    }
  }

  /** 一首播完时调用（songchange / ended） */
  function onSongEnd(isLastOfQueue) {
    if (!st) return;
    if (st.mode === 'finish-current' || st.pendingFinish) { fire(); return; }
    if (st.mode === 'finish-playlist' && isLastOfQueue) fire();
  }

  function start(mode, minutes) {
    const ms = (minutes || 0) * 60000;
    st = {
      mode,
      totalMs: ms,
      deadline: (mode === 'countdown' || mode === 'countdown-finish') ? now() + ms : null,
      pendingFinish: false,
    };
    save(); notify();
    return state();
  }

  function cancel() { st = null; save(); notify(); }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  }

  function bind() {
    const p = player();
    if (!p || !p.on || p._sleepBound) return;
    p._sleepBound = true;
    p.on('timeupdate', tick);
    p.on('songchange', () => {
      // songchange 在切到下一首后触发：若上一首是「播完就停」的目标，这里收口
      if (st && (st.mode === 'finish-current' || st.pendingFinish)) fire();
    });
    // 暂停态也要更新剩余时间显示（不作为到点判据，只驱动 UI）
    setInterval(() => { if (st) { tick(); notify(); } }, 1000);
  }

  restore();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  // player 可能晚于本脚本初始化，兜底重试
  let tries = 0;
  const t = setInterval(() => { bind(); if (++tries > 20 || (player() && player()._sleepBound)) clearInterval(t); }, 500);

  window.SleepTimer = {
    PRESETS,
    start, cancel, state, fmt, onSongEnd,
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    MODES: {
      'countdown': '倒计时结束后暂停',
      'countdown-finish': '倒计时结束后，播完当前歌曲',
      'finish-current': '播完当前歌曲后暂停',
      'finish-playlist': '播完当前列表后暂停',
    },
  };
})();
