/* update.js - keeps an installed app (or a tab left open for days) on the newest version.
 * An installed app is one long-lived window: reopening it from the recent-apps list resumes the copy it already loaded, and the phone may also
 * keep the downloaded page for up to 10 minutes. So the app asks the server which version is current (the version is the ?v= number on
 * app.js in index.html) when it starts, whenever it comes back to the foreground, and every few minutes. If a newer one exists it reloads
 * itself when that is safe (nothing typed, no popup, not listening), otherwise it shows a small "New version" button instead.
 * Loaded before app.js; its own ?v= number is the version this copy runs. */
(function (w) {
  'use strict';
  const MINE = (/[?&]v=(\w+)/.exec((document.currentScript || {}).src || '') || [])[1] || '';
  let busy = false, last = 0, bar = null;

  // the current version on the server: fetched with "reload" so the answer is fresh AND the phone's saved copy of the page is replaced too
  function latest() {
    return fetch(new URL('./', location.href).href, { cache: 'reload' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { return (/js\/app\.js\?v=(\w+)/.exec(t) || [])[1] || ''; });
  }
  // is it a good moment to reload without losing anything?
  function safe() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && String(a.value || '').length) return false;       // something is being typed
    if (document.querySelector('.overlay, .modal, .aib-typer:not(.hidden), .aib-fab.listening, .sending')) return false;   // a popup, the assistant is typing/listening, a message is on its way
    return true;
  }
  function reloadNow() { location.reload(); }
  function banner(v) {
    if (bar || !document.body) return;
    bar = document.createElement('div'); bar.className = 'upd-bar'; bar.setAttribute('role', 'status');
    const t = document.createElement('span'); t.textContent = 'New version ready';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Update'; b.addEventListener('click', reloadNow);
    bar.appendChild(t); bar.appendChild(b); document.body.appendChild(bar);
  }
  // auto: a background check (may reload by itself); otherwise the person asked (always answers)
  async function check(auto) {
    if (!MINE || busy) return 'busy';
    if (auto && Date.now() - last < 60000) return 'recent';
    busy = true; last = Date.now();
    try {
      const v = await latest();
      if (!v) return 'unknown';
      if (v === MINE) return 'current';
      let tries = 0; const key = 'upd.' + v;
      try { tries = Number(sessionStorage.getItem(key) || 0); } catch (e) { /* storage blocked */ }
      if (auto && safe() && tries < 2) {                                   // (twice at most: never a reload loop if a stale copy keeps answering)
        try { sessionStorage.setItem(key, String(tries + 1)); } catch (e) { /* ignore */ }
        reloadNow(); return 'reloading';
      }
      banner(v); return 'available';
    } catch (e) { return 'offline'; }
    finally { busy = false; }
  }
  function start() {
    if (!MINE) return;
    setTimeout(function () { check(true); }, 4000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(true); });
    w.addEventListener('online', function () { check(true); });
    w.addEventListener('pageshow', function (e) { if (e.persisted) check(true); });
    setInterval(function () { if (document.visibilityState === 'visible') check(true); }, 5 * 60000);
  }
  w.Updater = { version: MINE, check: check, start: start, _safe: safe };
  start();
})(window);
