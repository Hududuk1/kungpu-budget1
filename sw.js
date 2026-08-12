const CACHE = "kungpu-budget-v14";
const ASSETS = [
  "./?v=14",
  "./index.html",
  "./styles.css?v=14",
  "./remote-store.js?v=14",
  "./app.js?v=14",
  "./manifest.webmanifest?v=14",
  "./icons/apple-touch-icon.png?v=9",
  "./icons/app-icon-192.png?v=9",
  "./icons/app-icon-512.png?v=9"
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
