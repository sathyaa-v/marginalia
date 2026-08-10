// sw.js — caches the app shell so the notebook works fully offline (FR-25/27).
// Bump CACHE_NAME whenever shipped files change to invalidate old caches.
const CACHE_NAME = 'notes-app-shell-v13';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/search.js',
  './js/github.js',
  './js/webrtc.js',
  './js/editor-helpers.js',
  './js/quill.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  // cache.addAll() rejects — and aborts the ENTIRE install — the moment any
  // single file 404s. That previously meant one missing shell asset (e.g. an
  // icon) silently prevented the service worker from ever installing, so
  // offline support quietly never turned on. Cache each file independently
  // instead, so one bad entry can't take the rest down with it.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] precache skipped:', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never intercept GitHub API calls or PeerJS signaling — both must go
  // live, and both are explicit user actions anyway (NFR-04: nothing
  // leaves the device implicitly).
  if (req.url.includes('api.github.com') || req.url.includes('peerjs.com')) return;

  // App shell (own origin): network-first with a HARD TIMEOUT.
  // A service worker must never make a page refresh wait indefinitely for
  // a network response. This was causing the app to appear frozen when the
  // browser was online but the server/CDN request stalled. Use the cached
  // shell immediately after a short timeout, then refresh the cache when
  // the network succeeds.
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
    const cached = caches.match(req);
    const network = fetch(req.url, { cache: 'no-store' }).then((res) => {
      if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
      return res;
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('network timeout')), 2500)
    );

    event.respondWith(
      Promise.race([network, timeout]).catch(() => cached)
    );
    return;
  }

  // Third-party (fonts, marked.js/highlight.js/DOMPurify/PeerJS CDN):
  // stale-while-revalidate is fine here — these are pinned versions in
  // the <script> tags, so "stale" just means "the same pinned version."
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
