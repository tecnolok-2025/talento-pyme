// Talento PyME service worker (v4.0.4)
// Objetivo: evitar "versiones pegadas" por cache. 
// Estrategia:
// - HTML (navegación): network-first (si hay red, siempre busca lo último).
// - Assets (css/js/img): stale-while-revalidate.
// - Al cambiar VERSION, se crea un cache nuevo y se limpian caches viejos.

importScripts("/config.js?v=4.0.4");

const VERSION = (typeof TP_APP_VERSION !== "undefined") ? TP_APP_VERSION : "4.0.8";
const CACHE_NAME = `tp-cache-${VERSION}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/perfil.html",
  "/empleos.html",
  "/buscar.html",
  "/styles.css?v=4.0.4",
  "/auth.js?v=4.0.4",
  "/app.js?v=4.0.4",
  "/bolsa-candidato.js?v=4.0.4",
  "/config.js?v=4.0.4",
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

  // Solo same-origin
  if (url.origin !== self.location.origin) return;

  // Navegación (HTML): network-first
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
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

  // Assets: stale-while-revalidate
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
