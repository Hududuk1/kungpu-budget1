const CACHE = "kungpu-calendar-v1";
const ASSETS = [
  "./?v=1",
  "./index.html",
  "./styles.css?v=1",
  "./config.js?v=1",
  "./app.js?v=1",
  "./manifest.webmanifest?v=1",
  "./icons/app-icon.svg?v=1"
];
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request))));
