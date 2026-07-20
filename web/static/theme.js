/* 主题切换（P3）：html[data-theme] 驱动 app.css 语义 token。
   深色默认；浅色为首版（P4 视觉重做时完成全部组件适配）。
   app.html <head> 有 3 行内联预置脚本先读 localStorage 设 data-theme 防闪白，这里是完整实现。
   全屏播放页(nowplaying)保持专辑取色深底，不随主题。 */
(function () {
  'use strict';
  const META_COLOR = { dark: '#0e0e12', light: '#f5f6f8' };
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
