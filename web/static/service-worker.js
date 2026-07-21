/* Anon Music Service Worker
 * 缓存策略（务必配合 app.html 里的 ?v=YYYYMMDDx 热更新机制）：
 *  - 导航请求(/music, app.html) → network-first，离线兜底缓存，保证 ?v= bump 后总能拿到新壳
 *  - /static/*（带 ?v= 版本号）→ cache-first，按完整 URL(含版本)做键，新版本=新缓存条目
 *  - /api/* 与 媒体流 → 不拦截，永远走网络（绝不缓存）
 *  - 跨源(CDN 音频/封面) → 不拦截，放行
 *  bump CACHE 版本即可整体失效旧缓存（activate 时清理）。
 */
const CACHE = 'anon-cache-v14';
const OFFLINE_URL = '/music';
const MAINTENANCE_URL = '/maintenance';
const MAINTENANCE_ASSETS = [
  MAINTENANCE_URL,
  '/static/maintenance.css?v=20260721d',
  '/static/maintenance.js?v=20260721c',
  '/static/app-icon.png?v=20260721c',
  '/static/favicon-32.png?v=20260721c',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(MAINTENANCE_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch (e) {}
    }));
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
  // 接口与媒体流：永不缓存，直接走网络
  if (url.pathname.startsWith('/api/')) return;

  // 导航请求：network-first + 离线兜底
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const reqUrl = new URL(req.url);
        if (res.ok && reqUrl.pathname === '/music') {
          const cache = await caches.open(CACHE);
          cache.put(OFFLINE_URL, res.clone());
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        const maintenance = await cache.match(MAINTENANCE_URL);
        const cached = await cache.match(OFFLINE_URL);
        return cached || maintenance || new Response('Anon Music 暂时不可用，请稍后重试。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
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
    return;
  }

  // 其它同源 GET：默认走网络
});
