/**
 * Anon Music — Cloudflare Worker 故障回退
 *
 * 正常：透传源站（腾讯云中转 / VPS）
 * 源站超时、连接失败、502–526：
 *   - 页面导航 → 维护小游戏（Workers Assets）
 *   - /healthz、API → 503 JSON
 *
 * 路由：music.saki.li/*
 */

const ORIGIN_TIMEOUT_MS = 8000;
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
  if (pathname === '/' || pathname === '/music' || pathname === '/maintenance') return true;
  if (pathname.startsWith('/music/')) return true;
  // 登录/资料等 HTML 入口
  if (pathname.endsWith('.html')) return true;
  return false;
}

function isStandbyAsset(pathname) {
  return (
    pathname === '/favicon.ico' ||
    pathname === '/favicon-32.png' ||
    pathname === '/app-icon.png' ||
    pathname === '/maintenance.css' ||
    pathname === '/maintenance.js' ||
    pathname === '/index.html'
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

async function maintenanceResponse(request, env) {
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const assetUrl = new URL(request.url);
    const path = assetUrl.pathname;
    if (path === '/favicon.ico') {
      assetUrl.pathname = '/favicon-32.png';
    } else if (!isStandbyAsset(path)) {
      assetUrl.pathname = '/index.html';
    }
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
    if (res && res.ok) {
      const headers = new Headers(res.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-anon-fallback', 'assets');
      headers.set('x-anon-fallback-path', path);
      return new Response(res.body, { status: 200, headers });
    }
  }

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Anon Music · 维护中</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#e8f1ff;font-family:system-ui,sans-serif}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}p{color:#9bb0c7;line-height:1.6}</style></head>
<body><main><h1>音乐暂时按下了暂停键</h1><p>源站或中转暂时不可用。页面会自动重试。</p></main>
<script>setInterval(async()=>{try{const r=await fetch('/healthz?_='+Date.now(),{cache:'no-store'});const j=await r.json().catch(()=>({}));if(r.ok&&j.status==='ok')location.replace('/music')}catch(e){}},15000)</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
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

    // 维护页静态资源直接走 Assets，避免回源
    if ((method === 'GET' || method === 'HEAD') && isStandbyAsset(path)) {
      return maintenanceResponse(request, env);
    }

    let originRes;
    try {
      originRes = await fetchOrigin(request);
    } catch {
      if (isProbePath(path) || isApiOrRealtime(path)) return offlineJSON(503);
      if (method === 'GET' || method === 'HEAD') return maintenanceResponse(request, env);
      return offlineJSON(503);
    }

    const bad = BAD_STATUSES.has(originRes.status);
    if (!bad) return originRes;

    // 探活 / API：不要伪装成维护 HTML，便于客户端判断离线
    if (isProbePath(path) || isApiOrRealtime(path)) {
      return offlineJSON(originRes.status === 525 || originRes.status === 526 ? 503 : originRes.status);
    }

    // 页面与其余 GET：回退维护页（覆盖 curl 无 Accept: text/html 的情况）
    if (method === 'GET' || method === 'HEAD' || isPagePath(path)) {
      return maintenanceResponse(request, env);
    }

    return offlineJSON(503);
  },
};
