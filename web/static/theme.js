/* 深浅主题：主界面与正在播放页共享主题选择；保留用户已保存的偏好。 */
(function () {
  'use strict';
  const META_COLOR = { dark: '#141416', light: '#f5f5f7' };
  function apply(t, save) {
    t = (t === 'light') ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
    if (save !== false) { try { localStorage.setItem('app_theme', t); } catch (e) {} }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', META_COLOR[t]);
    return t;
  }
  // 调试/截图用：?theme=light|dark 强制主题（不写 localStorage、不被服务器设置覆盖）
  const qs = /[?&]theme=(light|dark)\b/.exec(location.search);
  window.Theme = {
    locked: !!qs,   // appext boot 看到 locked 就不用服务器设置覆盖
    get() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; },
    set(t) { return apply(t); },
  };
  if (qs) apply(qs[1], false);
  else apply(document.documentElement.dataset.theme ||
    (function () { try { return localStorage.getItem('app_theme'); } catch (e) { return null; } })() || 'dark');
})();
