/* Anon Music Service Worker
 * 缓存策略（务必配合 app.html 里的 ?v=YYYYMMDDx 热更新机制）：
 *  - 导航请求(/music, app.html) → stale-while-revalidate：有缓存就秒开，后台拉新版写回缓存，
 *    下次启动即为新版（原本是 network-first，冷启动必须先等一次 TTFB，原生壳里表现为"开机转圈几秒"）
 *  - /static/*（带 ?v= 版本号）→ cache-first，按完整 URL(含版本)做键，新版本=新缓存条目
 *  - /api/*、/healthz、媒体流 → 不拦截，永远走网络（绝不缓存）
 *  - 跨源(CDN 音频/封面) → 不拦截，放行
 *  bump CACHE 版本即可整体失效旧缓存（activate 时清理）。
 */
const CACHE = 'anon-cache-v17';
const OFFLINE_URL = '/music';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 不再预缓存 /maintenance：恢复后它会自动跳 /music，离线时反而造成“维护页死循环”。
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跨源（CDN 音频/封面图等）：放行，不拦截
  if (url.origin !== self.location.origin) return;
  // 接口 / 健康检查 / 媒体流：永不缓存
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/healthz' ||
    url.pathname === '/readyz' ||
    url.pathname === '/maintenance'
  ) return;

  // 导航请求：stale-while-revalidate
  //  有缓存 → 立即返回缓存壳（冷启动不再等网络），同时后台拉新版写回，下次启动生效
  //  无缓存 → 走网络，成功则缓存；失败回退到内置提示页
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const url = new URL(req.url);
      const cacheable = url.pathname === '/music' || url.pathname === '/';
      const cache = await caches.open(CACHE);
      const cached = cacheable ? await cache.match(OFFLINE_URL) : null;

      // 后台（或前台，取决于有没有缓存）取新版
      const fetching = fetch(req, { cache: 'no-store' })
        .then(async (res) => {
          if (res.ok && cacheable) await cache.put(OFFLINE_URL, res.clone());
          return res;
        });

      if (cached) {
        // 缓存命中：立刻返回，更新在后台跑完；失败也不影响本次启动
        event.waitUntil(fetching.catch(() => {}));
        return cached;
      }

      try {
        return await fetching;
      } catch (err) {
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Anon Music 离线</title>' +
          '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#e8f1ff;font-family:system-ui,sans-serif">' +
          '<main style="text-align:center;padding:2rem"><h1>暂时无法连接</h1>' +
          '<p style="color:#9bb0c7">请检查网络后刷新。服务恢复后即可继续使用。</p>' +
          '<p><button onclick="location.reload()" style="padding:.6rem 1rem;border-radius:8px;border:0;cursor:pointer">刷新</button></p></main>' +
          '<script>setInterval(()=>location.reload(),20000)</script></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
        );
      }
    })());
    return;
  }

  // 静态资源（/static/*，URL 带 ?v= 版本号）：cache-first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        return cached || Response.error();
      }
    })());
  }
});
