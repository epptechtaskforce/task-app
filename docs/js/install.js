/* install.js - the page behind the QR code (install.html): one big button.
 *   not installed -> "Install"  (one tap on Chrome / Edge / Android; on an iPhone a short picture guide, because Safari has no install button)
 *   installed     -> "Open"     (takes the person to the installed app and tries to close this browser tab)
 *   already inside the installed app -> goes straight to the app.
 * Honest limits: a web page cannot see an iPhone's home screen, and browsers only let a page close a tab it opened itself,
 * so closing is attempted but may not happen. Every text goes through textContent; the icons are fixed strings. */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const APP = new URL('./', location.href).href;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Snapchat|MicroMessenger|WhatsApp|Messenger|LinkedIn|TikTok|Twitter|; wv\)/i.test(ua);   // chat apps' own browsers cannot install
  const KEY = 'taskapp.installed';
  const flag = function () { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const mark = function () { try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ } };
  const standalone = (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches)) || navigator.standalone === true;

  // already running as the installed app: nothing to install, go to the app
  if (standalone) { mark(); location.replace(APP); return; }

  const I = {
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-5-5m5 5l5-5M5 20h14"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0L8 7m4-4l4 4M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m0 0l-6-6m6 6l6-6"/></svg>'
  };
  const go = $('go'), goIco = $('goIco'), goTxt = $('goTxt'), hint = $('hint'), sheet = $('sheet'), steps = $('steps'), point = $('point');
  let deferred = null, state = 'install';

  function draw() {
    state = flag() ? 'open' : 'install';
    goIco.innerHTML = state === 'open' ? I.open : I.down;     // fixed strings above, never user text
    goTxt.textContent = state === 'open' ? 'Open' : 'Install';
    go.disabled = false;
  }
  function guide(list, where) {   // a short picture guide: [icon, words] per step
    steps.textContent = '';
    list.forEach(function (s, n) {
      const li = document.createElement('li'), num = document.createElement('span'), ic = document.createElement('span'), t = document.createElement('span');
      num.className = 'n'; num.textContent = String(n + 1); ic.innerHTML = s[0]; ic.style.display = 'contents'; t.className = 't'; t.textContent = s[1];
      li.appendChild(num); li.appendChild(ic); li.appendChild(t); steps.appendChild(li);
    });
    point.innerHTML = where === 'down' ? I.arrow : ''; point.style.display = where ? 'flex' : 'none';
    sheet.classList.add('on');
  }
  $('ok').addEventListener('click', function () { sheet.classList.remove('on'); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.classList.remove('on'); });

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; try { localStorage.removeItem(KEY); } catch (x) { /* ignore */ } draw(); });   // the browser offers it: so it is NOT installed (any old note is stale)
  window.addEventListener('appinstalled', function () { mark(); deferred = null; draw(); hint.textContent = ''; });

  // Chrome can say whether this site is installed (the manifest names itself in related_applications)
  if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps().then(function (l) { if (l && l.length) { mark(); draw(); } }).catch(function () { /* not supported here */ });

  function openApp() {
    mark();
    if (android && !inApp) {   // hand the address to Android: when the installed app owns it, the app opens; otherwise the page itself opens
      const u = new URL(APP);
      location.href = 'intent://' + u.host + u.pathname + '#Intent;scheme=https;S.browser_fallback_url=' + encodeURIComponent(APP) + ';end';
    } else location.href = APP;
    setTimeout(function () { try { window.close(); } catch (e) { /* the browser only closes tabs a page opened itself */ } }, 900);
  }

  go.addEventListener('click', async function () {
    if (state === 'open') return openApp();
    if (deferred) {
      const d = deferred; deferred = null;
      try { d.prompt(); const r = await d.userChoice; if (r && r.outcome === 'accepted') { mark(); draw(); hint.textContent = ''; } else hint.textContent = ''; } catch (e) { /* ignore */ }
      return;
    }
    if (inApp) return guide([[I.dots, 'Open the menu'], [I.globe, 'Open in your browser'], [I.down, 'Then tap Install']], '');
    if (iOS) return guide([[I.share, 'Tap Share'], [I.plus, 'Add to Home Screen'], [I.check, 'Tap Add']], 'down');
    guide([[I.dots, 'Open the browser menu'], [I.down, 'Install app / Add to Home screen'], [I.check, 'Tap Install']], '');
  });

  draw();
  if (iOS) hint.textContent = '';
})();
