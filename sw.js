'use strict';

/* Offline support. The app files are cached on first visit. While online, the newest copy is fetched
   (and the cache refreshed); with no connection the cached copy is used. Calls to the sync service
   are never touched here. */
const CACHE = 'money-tracker-v7';
const OCR_CACHE = 'money-tracker-ocr'; // slip reader code and language data, kept once downloaded
const OCR_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'slips.js', 'sync.js', 'config.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all([c.addAll(SHELL), c.add(LIB).catch(() => {})]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && req.url !== LIB) {
    if (!OCR_HOSTS.includes(url.hostname)) return;
    // Files of the slip reader never change per URL, so serve them from the cache once downloaded.
    e.respondWith(caches.open(OCR_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
