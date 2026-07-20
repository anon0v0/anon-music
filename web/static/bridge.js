/* 原生壳桥接层（P3 抽离）：Tauri/安卓检测 + 事件 emit/listen + shell-info 能力握手。
   - 桌面壳(Windows Tauri)：Bridge.TAURI 非空
   - 安卓壳：Bridge.ANDROID 非空（安卓 Tauri 也注入 __TAURI__，按 UA 区分）
   - 浏览器/PWA：两者皆 null，emit/listen 为 no-op，功能自动降级
   能力握手：新壳(≥v0.6)启动时 emit shell-info {ver,caps:[...]}；旧壳(≤v0.5)不会发 →
   Bridge.shell 保持空、Bridge.has() 恒 false，调用方按旧壳/浏览器路径降级。 */
(function () {
  'use strict';
  const raw = window.__TAURI__;
  const hasEv = !!(raw && raw.event);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const emit = (name, payload) => { if (hasEv) { try { raw.event.emit(name, payload); } catch (e) {} } };
  const listen = (name, cb) => { if (hasEv) { try { raw.event.listen(name, cb); } catch (e) {} } };
  const shell = { ver: null, caps: [] };
  listen('shell-info', (e) => { const p = e.payload || {}; shell.ver = p.ver || null; shell.caps = p.caps || []; });
  // 握手：新壳(≥0.6)收到 shell-hello 回 shell-info；旧壳/浏览器无监听=no-op。
  // Tauri 的 event.listen 是异步注册，若回包早于监听就位会丢 → 重发几次，直到拿到 caps。
  if (hasEv) {
    let tries = 0;
    const ping = () => {
      if (shell.ver || tries >= 5) return;   // 收到即停；5 次(共 ~2.5s)仍无响应视作旧壳/浏览器
      tries++; emit('shell-hello', {});
      setTimeout(ping, 500);
    };
    ping();
  }
  window.Bridge = {
    TAURI: (hasEv && !isAndroid) ? raw : null,
    ANDROID: (hasEv && isAndroid) ? raw : null,
    IS_SHELL: hasEv,
    emit, listen, shell,
    has(cap) { return shell.caps.indexOf(cap) >= 0; },
  };

  // ── 壳内体验 ────────────────────────────────────────────────
  if (hasEv) {
    // body 标记：CSS 按端隐藏元素（如"去下载"入口只留网页端）
    document.body.classList.add('in-shell');
    // 禁用 WebView 默认右键菜单（返回/刷新/另存为/打印…），输入框保留系统菜单
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    });
  }

  // ── 无边框窗口自绘控制（新桌面壳 caps 含 'wc'，decorations=false）────
  // 旧壳没有 wc → 系统标题栏仍在，不挂按钮。
  function mountWinCtl() {
    if (isAndroid || !raw || !raw.window || document.getElementById('winCtl')) return;
    let W;
    try { W = raw.window.getCurrentWindow ? raw.window.getCurrentWindow() : raw.window.getCurrent(); } catch (e) { return; }
    if (!W) return;
    const tb = document.querySelector('.topbar');
    if (tb) {
      tb.setAttribute('data-tauri-drag-region', '');   // 顶栏空白处拖动窗口/双击最大化
      // 拖拽只在事件 target 自身带属性时生效 → 中间的弹性占位 div 也要标上
      tb.querySelectorAll(':scope > div').forEach(el => {
        if (el.id !== 'winCtl' && !el.querySelector('input,button')) el.setAttribute('data-tauri-drag-region', '');
      });
    }
    document.body.classList.add('has-winctl');
    const d = document.createElement('div');
    d.id = 'winCtl';
    d.innerHTML = `
      <button id="wcMin" title="最小化"><svg viewBox="0 0 12 12"><rect x="1.5" y="5.4" width="9" height="1.2" fill="currentColor"/></svg></button>
      <button id="wcMax" title="最大化 / 还原"><svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
      <button id="wcClose" title="关闭"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.3"/></svg></button>`;
    (tb || document.body).appendChild(d);
    d.querySelector('#wcMin').onclick = () => { try { W.minimize(); } catch (e) {} };
    d.querySelector('#wcMax').onclick = () => { try { W.toggleMaximize(); } catch (e) {} };
    d.querySelector('#wcClose').onclick = () => { try { W.close(); } catch (e) {} };   // 关闭走 Rust 侧"最小化到托盘"偏好
    // 通知 Rust 自绘标题栏已挂好：否则超时兜底会给主窗恢复系统标题栏（防旧缓存页/错误页无边框无手柄）
    emit('wc-ready', {});
  }
  let _wcMounted = false;
  function tryMountWinCtl() { if (_wcMounted) return; if (shell.caps.indexOf('wc') >= 0) { _wcMounted = true; mountWinCtl(); } }
  listen('shell-info', tryMountWinCtl);
  tryMountWinCtl();
})();
