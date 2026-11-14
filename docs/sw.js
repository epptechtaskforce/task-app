/* sw.js - the smallest possible service worker.
 * Browsers only offer "Install app" to sites that have one. It deliberately caches NOTHING: the app always loads fresh from the
 * network (so a new release shows at once and company data is never stored by the worker). Pages are asked "has this changed?" every
 * time (cache: 'no-cache') instead of being trusted from the phone's saved copy for 10 minutes. Offline, it shows a short message. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;                   // pictures, scripts, calls to the server: the browser handles them as usual
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' }).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:600 18px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center;color:#5e173f"><p>No internet.<br>Try again when you are online.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
