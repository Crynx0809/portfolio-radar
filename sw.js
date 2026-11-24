/* LLM Radar – Service Worker
   Immer zuerst das Netz (damit Kurse und Analysen aktuell sind); nur ohne Verbindung der zuletzt geladene Stand aus dem Cache. */
const CACHE = 'radar-v1';
const SHELL = ['./', './index.html', './logo.svg', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const lib = /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (!own && !lib) return;                       // Logos, GitHub-API usw. direkt aus dem Netz
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (own || res.type === 'cors' || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, {ignoreSearch: own && !url.pathname.includes('/data/')}).then((r) => r || caches.match('./index.html'))));
});
