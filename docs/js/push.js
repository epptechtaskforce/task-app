/* push.js - notifications on this phone or computer (Web Push). The server sends them; sw.js shows them and opens the right task when they are tapped.
 * This file only manages THIS device: asks permission, subscribes, tells the server, and forgets the device when the person signs out (so the next person who
 * signs in on the same phone never receives the previous person's alerts). */
(function (w) {
  'use strict';
  const KEY = 'taskapp.push';                                         // what this device last told the server: { e: endpoint, u: person, t: when }
  const WEEK = 7 * 86400000;
  const ua = navigator.userAgent || '';
  const apple = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = function () { return !!((w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true); };
  const capable = function () { return 'serviceWorker' in navigator && 'PushManager' in w && 'Notification' in w; };
  const load = function () { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const save = function (v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* not remembered */ } };

  function b64uToBytes(s) {
    const p = String(s).replace(/-/g, '+').replace(/_/g, '/'), bin = atob(p + '==='.slice((p.length + 3) % 4)), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameKey(sub, key) {                                         // was this browser subscription made for the server's current key?
    const have = sub && sub.options && sub.options.applicationServerKey;
    if (!have) return true;                                            // cannot tell: assume yes
    const a = new Uint8Array(have), b = b64uToBytes(key);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // a short, friendly name for the list of devices ("Android phone - installed app")
  function deviceLabel() {
    const kind = /Android/.test(ua) ? 'Android phone' : apple ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Windows/.test(ua) ? 'Windows computer' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux computer' : 'Device';
    return kind + (installed() ? ' - installed app' : ' - browser');
  }
  async function registration() {
    const r = await Promise.race([navigator.serviceWorker.ready, new Promise(function (_, no) { setTimeout(function () { no(new Error('The app is not ready for notifications yet. Reload the page and try again.')); }, 8000); })]);
    return r;
  }
  async function tell(sub, uid) {
    const j = sub.toJSON();
    await w.Api.call('pushSubscribe', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: deviceLabel() });
    save({ e: j.endpoint, u: uid, t: Date.now() });
  }

  const Push = {
    capable: capable, installed: installed, deviceLabel: deviceLabel,
    // 'demo' | 'unsupported' | 'install' (iPhone: only the installed app can get them) | 'blocked' | 'off' | 'on'
    async state() {
      if (w.Api && w.Api.demo) return 'demo';
      if (!capable()) return apple && !installed() ? 'install' : 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      try { const sub = await (await registration()).pushManager.getSubscription(); return sub && Notification.permission === 'granted' ? 'on' : 'off'; }
      catch (e) { return 'off'; }
    },
    // Must be called straight from a tap (browsers only show the permission question then).
    async enable(key, uid) {
      if (!key) throw new Error('Notifications are not switched on at the server yet. Ask the administrator.');
      const perm = await Notification.requestPermission();
      if (perm === 'denied') throw new Error('Notifications are blocked for this app. Allow them in your phone settings, then try again.');
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
      await tell(sub, uid);
    },
    // Turns notifications off on this device only (the server forgets it, and the browser subscription is removed).
    async disable() {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) { try { await w.Api.call('pushUnsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* the server drops dead devices by itself */ } await sub.unsubscribe(); }
      save(null);
    },
    // After sign-in / when the app opens: make sure the server knows THIS device belongs to THIS person (and uses the current key).
    async sync(key, uid) {
      try {
        if (!capable() || (w.Api && w.Api.demo) || !key || Notification.permission !== 'granted') return;
        const reg = await registration(); let sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        if (!sameKey(sub, key)) { await sub.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }); save(null); }
        const last = load();
        if (last && last.e === sub.endpoint && last.u === uid && Date.now() - last.t < WEEK) return;
        await tell(sub, uid);
      } catch (e) { /* silent: it is tried again at the next start */ }
    },
    // Signing out: this device must stop getting this person's alerts at once.
    async forget() {
      try {
        if (!capable() || (w.Api && w.Api.demo)) return;
        const sub = await (await registration()).pushManager.getSubscription();
        if (sub) await w.Api.call('pushUnsubscribe', { endpoint: sub.endpoint });
      } catch (e) { /* signing out must never get stuck on this */ }
      save(null);
    },
    // the small first-time question on the home page is asked only once per device
    promptSeen() { try { return localStorage.getItem('taskapp.push.asked') === '1'; } catch (e) { return false; } },
    promptDone() { try { localStorage.setItem('taskapp.push.asked', '1'); } catch (e) { /* ignore */ } }
  };
  w.Push = Push;
})(window);
