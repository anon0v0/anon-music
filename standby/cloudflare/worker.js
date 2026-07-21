/**
 * Anon Music — Cloudflare Worker 故障回退
 *
 * 正常：透传源站（Tunnel / 中转 / VPS）
 * 源站超时、连接失败、5xx：
 *   - 页面导航 → 内联维护页（不再用 Assets SPA，避免 /music 被劫持成 index.html）
 *   - /healthz、API → 503 JSON
 *
 * 路由：music.saki.li/*
 */

const ORIGIN_TIMEOUT_MS = 15000;
const BAD_STATUSES = new Set([
  500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530,
]);

function isProbePath(pathname) {
  return pathname === '/healthz' || pathname === '/readyz';
}

function isApiOrRealtime(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/ws') ||
    pathname.startsWith('/together') ||
    pathname === '/service-worker.js'
  );
}

function isPagePath(pathname) {
  return (
    pathname === '/' ||
    pathname === '/music' ||
    pathname === '/maintenance' ||
    pathname.startsWith('/music/') ||
    pathname.endsWith('.html')
  );
}

async function fetchOrigin(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('origin-timeout'), ORIGIN_TIMEOUT_MS);
  try {
    return await fetch(request, {
      signal: controller.signal,
      redirect: 'manual',
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } finally {
    clearTimeout(timer);
  }
}

function offlineJSON(status = 503) {
  return new Response(JSON.stringify({ status: 'offline', message: 'origin unavailable' }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function maintenanceHTML() {
  // 内联维护页：不依赖 ASSETS，避免 SPA not_found 把 /music 盖成维护壳
  return `<!doctype html>
<html lang="zh-CN" data-target="/music" data-health="/healthz">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Anon Music · 维护中</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#e8f1ff;font-family:system-ui,sans-serif}
    main{max-width:28rem;padding:2rem;text-align:center}
    h1{font-size:1.4rem;margin:.4rem 0 1rem}
    p{color:#9bb0c7;line-height:1.6}
    .pulse{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:#5eead4;margin-right:.45rem;animation:p 1.2s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
  </style>
</head>
<body>
  <main>
    <div><i class="pulse"></i>网站正在维护</div>
    <h1>音乐暂时按下了暂停键</h1>
    <p>源站恢复后会自动返回播放器，无需手动刷新。</p>
    <p id="st" style="font-size:.85rem;opacity:.7">正在检测…</p>
  </main>
  <script>
  (async function(){
    let ok=0;
    async function probe(){
      try{
        const r=await fetch('/healthz?_='+Date.now(),{cache:'no-store'});
        const j=await r.json().catch(()=>({}));
        if(r.ok && String(j.status||'').toLowerCase()==='ok'){
          ok++; document.getElementById('st').textContent='已恢复，即将返回…';
          if(ok>=2) location.replace('/music?_r='+Date.now());
          return;
        }
      }catch(e){}
      ok=0; document.getElementById('st').textContent='最近检查：'+new Date().toLocaleTimeString();
    }
    setInterval(probe, 12000); probe();
  })();
  </script>
</body>
</html>`;
}

function maintenanceResponse() {
  return new Response(maintenanceHTML(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'cdn-cache-control': 'no-store',
      'cloudflare-cdn-cache-control': 'no-store',
      'x-anon-fallback': 'inline',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS' && isProbePath(path)) {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-max-age': '600',
        },
      });
    }

    // 明确的维护入口
    if ((method === 'GET' || method === 'HEAD') && path === '/maintenance') {
      return maintenanceResponse();
    }

    let originRes;
    try {
      originRes = await fetchOrigin(request);
    } catch {
      if (isProbePath(path) || isApiOrRealtime(path)) return offlineJSON(503);
      if (method === 'GET' || method === 'HEAD') return maintenanceResponse();
      return offlineJSON(503);
    }

    const bad = BAD_STATUSES.has(originRes.status);
    if (!bad) {
      const headers = new Headers(originRes.headers);
      if (isProbePath(path) || isPagePath(path) || path.startsWith('/api/')) {
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        headers.set('CDN-Cache-Control', 'no-store');
        headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
      }
      headers.set('x-anon-origin', 'pass');
      return new Response(originRes.body, {
        status: originRes.status,
        statusText: originRes.statusText,
        headers,
      });
    }

    if (isProbePath(path) || isApiOrRealtime(path)) {
      return offlineJSON(originRes.status === 525 || originRes.status === 526 ? 503 : originRes.status);
    }

    if (method === 'GET' || method === 'HEAD' || isPagePath(path)) {
      return maintenanceResponse();
    }

    return offlineJSON(503);
  },
};
