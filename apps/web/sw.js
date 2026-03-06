/* Talento PyME Service Worker — v4.0.1 (20260306)
   Cachea SOLO recursos same-origin GET. La API (cross-origin) nunca se intercepta.
   - Navegación: network-first (para actualizar versión).
   - Assets GET: stale-while-revalidate.
*/
self.importScripts("/config.js?v=4.0.1");

const VERSION = (self.TP_APP_VERSION || "4.0.1");
const CACHE_NAME = "tp-cache-" + VERSION;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith("tp-cache-") && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;                 // no interceptar POST/etc
  if (url.origin !== self.location.origin) return;  // no interceptar cross-origin (API)

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, net.clone());
        return net;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match("/index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const fetchAndUpdate = fetch(req).then((net) => {
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(fetchAndUpdate);
      return cached;
    }

    const net = await fetchAndUpdate;
    if (net) return net;

    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  })());
});
