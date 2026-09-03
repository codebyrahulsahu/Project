/* Arena Lite service worker — cache-first for the app shell, network-only for API calls. */
const CACHE = "arena-lite-v5";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/style.css",
  "./js/markdown.js", "./js/providers.js", "./js/store.js", "./js/agent.js", "./js/app.js",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // never cache API / cross-origin requests (model providers)
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetched = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || fetched; // stale-while-revalidate
    })
  );
});
