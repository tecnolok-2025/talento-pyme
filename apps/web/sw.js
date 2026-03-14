// Talento PyME service worker (v5.6.5)
// Objetivo: evitar "versiones pegadas" por cache. 
// Estrategia:
// - HTML (navegación): network-first (si hay red, siempre busca lo último).
// - Assets (css/js/img): stale-while-revalidate.
// - Al cambiar VERSION, se crea un cache nuevo y se limpian caches viejos.

importScripts("/config.js?v=5.6.5");

const VERSION = (typeof TP_APP_VERSION !== "undefined") ? TP_APP_VERSION : "5.6.5";
const CACHE_NAME = `tp-cache-${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/perfil.html",
  "/empleos.html",
  "/buscar.html",
  "/factory.html",
  "/admin.html",
  "/asistencia.html",
  "/styles.css?v=5.6.5",
  "/auth.js?v=5.6.5",
  "/app.js?v=5.6.5",
  "/bolsa-candidato.js?v=5.6.5",
  "/config.js?v=5.6.5",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("tp-cache-") && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const accept = req.headers.get("accept") || "";

  if (url.origin !== self.location.origin) return;

  const sensitivePath = (
    req.method !== 'GET' ||
    url.pathname.startsWith('/payments/') ||
    url.pathname.startsWith('/factory/') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/support/') ||
    accept.includes('application/json')
  );

  if (sensitivePath) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match("/index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then(async (res) => {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
      return res;
    }).catch(() => cached);

    return cached || fetchPromise;
  })());
});
