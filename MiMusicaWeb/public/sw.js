import { offlineDB } from './offline-db.js';
import { offlineResponse } from './offline-response.js';
const CACHE_NAME = 'mimusic-design-v15';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/imports.js', '/player.js', '/library-client.js', '/library-display.js', '/connection.js', '/subsonic-auth.js', '/offline.js', '/offline-db.js', '/offline-response.js', '/manifest.webmanifest', '/assets/icon.svg', '/assets/icon-180.png', '/assets/icon-192.png', '/assets/icon-512.png', '/assets/shuffle.svg', '/assets/repeat.svg', '/assets/imgList.svg', '/assets/imgMagnifyingglass2.svg', '/assets/imgImage19.png', '/assets/imgRectangle.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('mimusica-design-') || key.startsWith('mimusic-design-')) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data === 'mimusic-offline-ready') event.ports[0]?.postMessage({ offline: true });
});
async function savedMedia(request, url) {
  try {
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    const account = await offlineDB.account();
    if (!account || !key.startsWith(`${account}:`)) return new Response(null, { status: 403 });
    const blob = await (url.pathname.startsWith('/offline-audio/') ? offlineDB.audio(key) : offlineDB.cover(key));
    return offlineResponse(blob, request);
  } catch { return new Response('No se pudo abrir la descarga local.', { status: 503 }); }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/offline-audio/') || url.pathname.startsWith('/offline-cover/')) { event.respondWith(savedMedia(event.request, url)); return; }
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request.mode === 'navigate' ? '/' : url.pathname);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(url.pathname, response.clone());
    return response;
  })());
});
