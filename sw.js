// sw.js — service worker: keeps the app working offline.
// When you change any file, bump CACHE (v1 → v2) so phones download the new version.
const CACHE = 'playlens-v3';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/main.js', './js/data.js', './js/sim.js', './js/field.js', './js/store.js',
  './js/importer.js', './js/editor.js', './js/ai.js', './js/reader.js', './js/util.js',
  './icons/icon.svg', './icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // App files: answer from the cache right away, refresh the cache in the background.
    e.respondWith(caches.match(e.request).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }));
  } else if (url.host.includes('fonts.')) {
    // Fonts: try the network, fall back to a saved copy.
    e.respondWith(fetch(e.request).then((res) => {
      caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request)));
  }
});
