/* Talento PyME - Service Worker
   Cache version is driven by TP_APP_VERSION (imported from /config.js)
*/
importScripts('/config.js');

const CACHE = `tp-cache-v${self.TP_APP_VERSION || "dev"}`;

const ASSETS = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/perfil.html",
  "/cv.html",
  "/buscar.html",
  "/empleos.html",
  "/empresa.html",
  "/publicar.html",
  "/mis-busquedas.html",
  "/forgot.html",
  "/reset.html",
  "/styles.css",
  "/auth.js",
  "/config.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/logo-tp.svg",
  "/assets/logo-talento-pyme.png",
  "/assets/logo-talento-pyme-small.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k.startsWith("tp-cache-") && k !== CACHE) ? caches.delete(k) : Promise.resolve()))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // IMPORTANT: do not hijack API / POST / cross-origin requests.
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  const url = new URL(req.url);

  // Always go network-first for the API.
  if (url.origin.includes("onrender.com") && url.pathname.startsWith("/")) {
    // Let the browser handle it (no cache here).
  }

  // Navigation requests: try network first (to reduce "stuck" old UI), fallback to cache.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
