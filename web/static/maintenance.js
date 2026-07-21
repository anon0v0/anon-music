(() => {
  'use strict';

  const config = window.ANON_MAINTENANCE || {};
  const target = config.target || document.documentElement.dataset.target || '/music';
  const health = config.health || document.documentElement.dataset.health || '/healthz';
  const embedded = !!config.embedded;
  const root = config.root || document.getElementById('maintenanceRoot');
  if (!root) return;

  const $ = (s) => root.querySelector(s);
  const stateLabel = $('[data-role="state-label"]');
  const reasonLabel = $('[data-role="reason"]');
  const targetLabel = $('[data-role="target"]');
  const checkedLabel = $('[data-role="last-check"]');
  const retryButton = $('[data-action="retry"]');
  const gameButton = $('[data-action="jump"]');
  const canvas = $('[data-role="game"]');
  const scoreLabel = $('[data-role="score"]');
  const bestLabel = $('[data-role="best"]');
  const tip = $('[data-role="game-tip"]');

  const isShell = !!window.__TAURI__;
  let checking = false;
  let timer = 0;
  let consecutiveSuccess = 0;

  function nowText() {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  }

  function setStatus(state, label, reason) {
    root.dataset.state = state;
    if (stateLabel) stateLabel.textContent = label;
    if (reasonLabel) reasonLabel.textContent = reason;
  }

  async function probe({ navigate = false, quiet = false } = {}) {
    if (checking) return false;
    checking = true;
    if (retryButton) retryButton.disabled = true;
    if (!quiet) setStatus('checking', '网站正在维护', '维护完成后会自动返回，等待时来玩一局小游戏吧。');
    try {
      const sep = health.includes('?') ? '&' : '?';
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(`${health}${sep}_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      }).finally(() => clearTimeout(abortTimer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => ({}));
      if (body.status && !['ok', 'ready'].includes(String(body.status).toLowerCase())) throw new Error('service not ready');
      consecutiveSuccess += 1;
      setStatus('online', '维护即将结束', '网站已经恢复，正在返回 Anon Music…');
      if (checkedLabel) checkedLabel.textContent = `最近检查：${nowText()}`;
      if (!embedded && (navigate || consecutiveSuccess >= 2)) window.setTimeout(() => location.replace(target), 420);
      return true;
    } catch (err) {
      consecutiveSuccess = 0;
      const offline = navigator.onLine === false;
      setStatus('offline', '网站正在维护', offline
        ? '暂时无法连接，等待恢复时可以继续玩小游戏。'
        : '维护完成后会自动返回，等待时来玩一局小游戏吧。');
      if (checkedLabel) checkedLabel.textContent = `最近检查：${nowText()}`;
      return false;
    } finally {
      checking = false;
      if (retryButton) retryButton.disabled = false;
    }
  }

  if (targetLabel) {
    try { targetLabel.textContent = new URL(target, location.href).host || 'Anon Music'; }
    catch (_) { targetLabel.textContent = 'Anon Music'; }
  }
  retryButton?.addEventListener('click', () => probe({ navigate: true }));
  window.addEventListener('online', () => probe({ navigate: true }));
  window.addEventListener('offline', () => setStatus('offline', '网站正在维护', '暂时无法连接，等待恢复时可以继续玩小游戏。'));
  timer = window.setInterval(() => probe({ quiet: true }), 15000);
  window.addEventListener('pagehide', () => clearInterval(timer));

  if (isShell && !embedded) {
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="maintenance-drag" data-tauri-drag-region></div>
      <div class="maintenance-window-controls">
        <button data-win="min" aria-label="最小化"><svg viewBox="0 0 12 12"><path d="M2 7h8"/></svg></button>
        <button data-win="max" aria-label="最大化或还原"><svg viewBox="0 0 12 12"><rect x="2.1" y="2.1" width="7.8" height="7.8"/></svg></button>
        <button data-win="close" aria-label="关闭"><svg viewBox="0 0 12 12"><path d="M2.2 2.2l7.6 7.6M9.8 2.2L2.2 9.8"/></svg></button>
      </div>`);
    try {
      const raw = window.__TAURI__;
      const win = raw.window.getCurrentWindow ? raw.window.getCurrentWindow() : raw.window.getCurrent();
      document.querySelector('[data-win="min"]').onclick = () => win.minimize();
      document.querySelector('[data-win="max"]').onclick = () => win.toggleMaximize();
      document.querySelector('[data-win="close"]').onclick = () => win.close();
      raw.event?.emit('wc-ready', {});
    } catch (_) {}
  }

  if (canvas) {
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(devicePixelRatio || 1, 2);
    const storageKey = 'anon-maintenance-runner-best';
    let W = 0, H = 0, raf = 0, last = 0, running = false, dead = false;
    let score = 0, speed = 250, spawn = 0;
    const player = { x: 66, y: 0, vy: 0, r: 14, grounded: true };
    let obstacles = [], particles = [], stars = [];
    let best = Number(localStorage.getItem(storageKey) || 0);
    if (bestLabel) bestLabel.textContent = best;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(280, rect.width); H = Math.max(230, rect.height);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      player.y = Math.min(player.y || H - 51, H - 51);
      stars = Array.from({ length: Math.max(25, Math.round(W / 14)) }, () => ({
        x: Math.random() * W, y: Math.random() * H * .72, r: Math.random() * 1.4 + .25, a: Math.random() * .55 + .16,
      }));
      draw();
    }

    function reset() {
      score = 0; speed = 250; spawn = .9; obstacles = []; particles = []; dead = false; running = true;
      player.y = H - 51; player.vy = 0; player.grounded = true;
      if (tip) { tip.textContent = '点击画面 / 空格 / ↑ 跳跃'; tip.classList.remove('fade'); }
      if (scoreLabel) scoreLabel.textContent = '0';
      last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    }

    function jump() {
      if (!running || dead) { reset(); return; }
      if (!player.grounded) return;
      player.vy = -470; player.grounded = false;
      if (tip) tip.classList.add('fade');
      for (let i = 0; i < 9; i++) particles.push({ x: player.x - 3, y: H - 34, vx: -45 - Math.random() * 90, vy: -20 - Math.random() * 55, life: .45 + Math.random() * .3 });
    }

    function collide(o) {
      const px = player.x - player.r * .72, py = player.y - player.r * .72, ps = player.r * 1.44;
      return px < o.x + o.w && px + ps > o.x && py < o.y + o.h && py + ps > o.y;
    }

    function stop() {
      dead = true; running = false;
      best = Math.max(best, Math.floor(score)); localStorage.setItem(storageKey, String(best));
      if (bestLabel) bestLabel.textContent = best;
      if (tip) { tip.textContent = '节拍中断了 · 点击画面重新开始'; tip.classList.remove('fade'); }
      draw();
    }

    function update(dt) {
      score += dt * 10; speed = Math.min(470, 250 + score * 1.7);
      if (scoreLabel) scoreLabel.textContent = String(Math.floor(score));
      player.vy += 1250 * dt; player.y += player.vy * dt;
      const floor = H - 51;
      if (player.y >= floor) { player.y = floor; player.vy = 0; player.grounded = true; }
      spawn -= dt;
      if (spawn <= 0) {
        const h = 28 + Math.random() * 32;
        obstacles.push({ x: W + 15, y: H - 36 - h, w: 18 + Math.random() * 17, h });
        spawn = Math.max(.62, 1.25 - score / 180) + Math.random() * .62;
      }
      obstacles.forEach(o => o.x -= speed * dt); obstacles = obstacles.filter(o => o.x + o.w > -10);
      particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; });
      particles = particles.filter(p => p.life > 0);
      if (obstacles.some(collide)) stop();
    }

    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }

    function draw() {
      if (!ctx || !W || !H) return;
      const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1b31'); bg.addColorStop(1, '#07111f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      stars.forEach(s => { ctx.globalAlpha = s.a; ctx.fillStyle = '#bfe3ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(101,169,255,.11)'; ctx.lineWidth = 1;
      for (let x = -((performance.now() / 40) % 34); x < W; x += 34) { ctx.beginPath(); ctx.moveTo(x, H - 36); ctx.lineTo(x + 16, H); ctx.stroke(); }
      ctx.fillStyle = 'rgba(82,181,255,.16)'; ctx.fillRect(0, H - 36, W, 1);
      obstacles.forEach(o => {
        const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h); g.addColorStop(0, '#ff9bac'); g.addColorStop(1, '#9e5cf2'); ctx.fillStyle = g; ctx.shadowColor = 'rgba(231,92,177,.32)'; ctx.shadowBlur = 12; roundRect(o.x, o.y, o.w, o.h, 5); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.35)'; roundRect(o.x + 4, o.y + 5, Math.max(4, o.w - 8), 3, 2);
      });
      particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = '#75d9ff'; ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(Math.min(.55, player.vy / 1200));
      const pg = ctx.createLinearGradient(-14, -14, 14, 14); pg.addColorStop(0, '#79c8ff'); pg.addColorStop(1, '#5ce6bd'); ctx.fillStyle = pg; ctx.shadowColor = 'rgba(92,215,221,.45)'; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(0, 0, player.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#092033'; ctx.beginPath(); ctx.arc(-4, -2, 2, 0, Math.PI * 2); ctx.arc(4, -2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#092033'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 2, 5, .15, Math.PI - .15); ctx.stroke(); ctx.restore();
      if (dead) { ctx.fillStyle = 'rgba(3,9,17,.42)'; ctx.fillRect(0, 0, W, H); }
    }

    function loop(ts) {
      const dt = Math.min(.033, Math.max(.001, (ts - last) / 1000)); last = ts;
      if (running) update(dt); draw();
      if (running) raf = requestAnimationFrame(loop);
    }

    const activate = (e) => { if (e && ['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return; e?.preventDefault?.(); jump(); };
    canvas.addEventListener('pointerdown', activate);
    gameButton?.addEventListener('click', activate);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') activate(e); });
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize(); reset();
  }

  probe({ quiet: true });
})();
