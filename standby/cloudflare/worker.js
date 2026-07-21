/**
 * Anon Music — Cloudflare Worker 故障回退
 *
 * 正常：透传源站（腾讯云中转 / VPS）
 * 源站超时、连接失败、502–504：
 *   - 浏览器页面导航 → 返回维护小游戏页（Workers Assets / STANDBY_BASE）
 *   - /healthz 与 API → 返回 503 JSON，避免维护页挡住恢复探测
 *
 * 绑定域名：music.saki.li/*
 * DNS：橙云代理到你的中转或源站 IP
 */

const ORIGIN_TIMEOUT_MS = 8000;
const BAD_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

function wantsHTML(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) return true;
  // 部分浏览器首屏导航 Accept 很宽，按路径兜底
  try {
    const path = new URL(request.url).pathname;
    return path === '/' || path === '/music' || path.startsWith('/music/') || path === '/maintenance';
  } catch {
    return false;
  }
}

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

async function fetchOrigin(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('origin-timeout'), ORIGIN_TIMEOUT_MS);
  try {
    // 在 Worker 路由下 fetch(request) 会走 CF 源站（DNS 记录指向的 IP）
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

async function maintenanceResponse(request, env, url) {
  // 1) Workers Static Assets（wrangler assets 目录）
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const assetUrl = new URL(request.url);
    // 任意失败页面都落到维护首页，静态资源按路径取
    const path = assetUrl.pathname;
    const isAsset =
      path.endsWith('.css') ||
      path.endsWith('.js') ||
      path.endsWith('.png') ||
      path.endsWith('.ico') ||
      path.endsWith('.webmanifest') ||
      path === '/favicon-32.png' ||
      path === '/app-icon.png' ||
      path === '/favicon.ico';
    if (path === '/favicon.ico') {
      assetUrl.pathname = '/favicon-32.png';
    } else if (!isAsset) {
      assetUrl.pathname = '/index.html';
    }
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-anon-fallback', 'assets');
      return new Response(res.body, { status: 200, headers });
    }
  }

  // 2) 独立 Pages / 备用域名
  const base = (env.STANDBY_BASE || '').replace(/\/$/, '');
  if (base) {
    const path = url.pathname;
    const isAsset =
      path.endsWith('.css') ||
      path.endsWith('.js') ||
      path.endsWith('.png') ||
      path.endsWith('.ico');
    const target = isAsset ? `${base}${path}` : `${base}/index.html`;
    const res = await fetch(target, { cf: { cacheTtl: 60 } });
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-anon-fallback', 'standby-base');
      // 备用站 HTML 里 data-health 已是正式域名；同域时也可
      return new Response(res.body, { status: 200, headers });
    }
  }

  // 3) 最后兜底：极简内联页（无小游戏，至少不是 Lucky 502）
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Anon Music · 维护中</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#e8f1ff;font-family:system-ui,sans-serif}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}p{color:#9bb0c7;line-height:1.6}</style></head>
<body><main><h1>音乐暂时按下了暂停键</h1><p>源站或中转暂时不可用。页面会自动重试，恢复后无需手动刷新。</p></main>
<script>setInterval(async()=>{try{const r=await fetch('/healthz?_='+Date.now(),{cache:'no-store'});if(r.ok)location.replace('/music')}catch(e){}},15000)</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-anon-fallback': 'inline' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 预检
    if (request.method === 'OPTIONS' && isProbePath(url.pathname)) {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-max-age': '600',
        },
      });
    }

    let originRes;
    try {
      originRes = await fetchOrigin(request);
    } catch {
      if (isProbePath(url.pathname) || isApiOrRealtime(url.pathname)) {
        return offlineJSON(503);
      }
      if (wantsHTML(request) || url.pathname.startsWith('/static/')) {
        // 维护页自己的静态资源在 ASSETS 里
        return maintenanceResponse(request, env, url);
      }
      return offlineJSON(503);
    }

    // 源站明确网关错误 → 页面回退；探活/API 原样返回错误码
    if (BAD_STATUSES.has(originRes.status)) {
      if (isProbePath(url.pathname) || isApiOrRealtime(url.pathname)) {
        return originRes;
      }
      if (wantsHTML(request) || url.pathname === '/maintenance') {
        return maintenanceResponse(request, env, url);
      }
    }

    return originRes;
  },
};
