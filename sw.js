const CACHE = "kungpu-budget-v17";
const ASSETS = [
  "./?v=17",
  "./index.html",
  "./styles.css?v=17",
  "./remote-store.js?v=17",
  "./app.js?v=17",
  "./manifest.webmanifest?v=17",
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
