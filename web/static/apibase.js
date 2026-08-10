/* API 出口统一层（必须在所有业务脚本之前加载）。
 *
 * 浏览器：__ANON_API_BASE__ 未注入 → API_BASE='' → 站内路径保持相对，
 *   凭据仍走同源 httponly cookie，行为与改造前完全一致。
 * 原生壳（Tauri APK/EXE 把前端打进安装包，页面 origin 是 tauri.localhost）：
 *   打包时在 index.html 注入 <script>window.__ANON_API_BASE__='https://…'</script>，
 *   于是所有站内请求打到远程站点。此时对本站属于跨站，httponly + SameSite=Lax
 *   的 cookie 带不过去（安卓 WebView 默认还拦第三方 cookie），所以改用
 *   Authorization: Bearer <token>，token 登录时由服务端在 body 里返回、存 localStorage。
 */
(function () {
  'use strict';

  const BASE = String(window.__ANON_API_BASE__ || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'anon_session_token';

  // 只给"站内绝对路径"拼前缀。绝对 URL（QQ/网易 CDN 直链）和协议相对 URL 原样放行，
  // 否则会把 https://... 拼成 https://music…/https://… 。
  function apiUrl(p) {
    const s = p == null ? '' : String(p);
    if (!BASE || s.charAt(0) !== '/' || s.charAt(1) === '/') return s;
    return BASE + s;
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function apiFetch(p, opts) {
    const o = Object.assign({}, opts);
    // 同源(浏览器)时不发 header，继续用 cookie —— 保持既有行为，也不给预检增加负担
    const tok = BASE ? getToken() : '';
    if (tok) o.headers = Object.assign({}, o.headers, { Authorization: 'Bearer ' + tok });
    if (!o.credentials) o.credentials = BASE ? 'omit' : 'same-origin';
    return fetch(apiUrl(p), o);
  }

  window.API_BASE = BASE;
  window.IS_PACKED = !!BASE;      // true = 前端跑在安装包里
  window.apiUrl = apiUrl;
  window.apiFetch = apiFetch;
  window.apiToken = { get: getToken, set: setToken };
})();
