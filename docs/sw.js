/* sw.js - the app's service worker.
 * 1. Browsers only offer "Install app" to sites that have one. It deliberately caches NOTHING: the app always loads fresh from the network (so a new release
 *    shows at once and company data is never stored by the worker). Pages are asked "has this changed?" every time (cache: 'no-cache') instead of being trusted
 *    from the phone's saved copy for 10 minutes. Offline, it shows a short message.
 * 2. Notifications (Web Push). The server sends an encrypted message { t: title, b: text, u: '#/task/ID', g: tag, c: category, a: button label, s: 1 = silent, ts };
 *    this shows it, and when it is tapped opens the app on exactly that task (focusing the app if it is already open). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;                   // pictures, scripts, calls to the server: the browser handles them as usual
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' }).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:600 18px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center;color:#5e173f"><p>No internet.<br>Try again when you are online.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});

// Only an address inside the app can be opened from a notification.
function safeHash(u) { return typeof u === 'string' && /^#\/[A-Za-z0-9_\/%.-]{0,120}$/.test(u) ? u : '#/tasks'; }
function isApple() { return /iPhone|iPad|iPod/.test((self.navigator && self.navigator.userAgent) || ''); }

self.addEventListener('push', function (e) {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Task Manager', b: e.data ? e.data.text() : '' }; }
  const hash = safeHash(d.u);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    // If the person is looking at exactly this task right now, the screen already shows it: no alert on top of it (iPhone insists on one, so it always gets one).
    const looking = list.some(function (c) { return c.visibilityState === 'visible' && c.focused && c.url.slice(c.url.indexOf('#')) === hash; });
    if (looking && d.g && d.g.indexOf('chat:') === 0 && !isApple()) return null;
    const o = {
      body: d.b || '', icon: 'icon-192.png', badge: 'badge-96.png', tag: d.g || undefined, renotify: !!d.g && !d.s, silent: !!d.s,
      timestamp: d.ts || Date.now(), data: { url: hash }, lang: 'en'
    };
    if (d.a) o.actions = [{ action: 'open', title: String(d.a).slice(0, 24) }];
    return self.registration.showNotification(d.t || 'Task Manager', o);
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const hash = safeHash(e.notification.data && e.notification.data.url);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    const scope = self.registration.scope;
    const mine = list.filter(function (c) { return c.url.indexOf(scope) === 0; })[0];
    if (mine) {
      return Promise.resolve(mine.focus ? mine.focus() : mine).catch(function () { return mine; }).then(function (c) { (c || mine).postMessage({ type: 'open', hash: hash }); });
    }
    return self.clients.openWindow(scope + hash);
  }));
});
