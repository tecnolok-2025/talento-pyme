const CACHE = "tp-v3.2.4";
const ASSETS = [
  "/", "/index.html", "/dashboard.html", "/perfil.html", "/cv.html", "/buscar.html",
  "/empleos.html", "/empresa.html", "/publicar.html", "/mis-busquedas.html",
  "/forgot.html",
  "/styles.css", "/auth.js", "/config.js",
  "/manifest.webmanifest", "/icon-192.png", "/icon-512.png",
  "/assets/logo-tp.svg", "/assets/logo-talento-pyme.png", "/assets/logo-talento-pyme-small.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then((c) => c || fetch(event.request)));
  }
});
