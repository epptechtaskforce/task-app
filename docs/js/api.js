/* api.js - talks to the Apps Script backend (or the in-browser demo backend). */
(function (w) {
  'use strict';

  const TOKEN_KEY = 'taskapp.token';
  const cfg = w.APP_CONFIG || {};
  const demo = !!cfg.demo || /[?&]demo=1\b/.test(location.search);
  const CACHE_PREFIX = demo ? 'taskapp.demo.c.' : 'taskapp.c.';   // demo data is kept apart from real data

  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function save(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }

  const READS = ['info', 'me', 'listTasks', 'getTask', 'listHistory', 'getArchived', 'assignable', 'adminOverview'];   // safe to ask twice

  const Api = {
    demo: demo,
    token: load(demo ? 'taskapp.demo.token' : TOKEN_KEY),
    configured: demo || !!cfg.backendUrl,
    onAuthLost: function () {},
    onSlow: function () {},   // the app shows a small "still trying" note while a read is slow

    setToken: function (t) { Api.token = t || ''; save(demo ? 'taskapp.demo.token' : TOKEN_KEY, Api.token); if (!Api.token) Api.cacheClear(); },

    // Last known answers (profile, task list, people you can assign to), so a screen can appear instantly while the
    // server (1-3 s per call on Apps Script) is asked again. Kept in this browser only and wiped at sign-out.
    cacheGet: function (k) { try { const v = localStorage.getItem(CACHE_PREFIX + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    cacheSet: function (k, v) { try { localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    cacheClear: function () { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ } },
    // The company name is public (it is on the sign-in page), so it is kept across sign-outs to paint the login page at once.
    savedCompany: function () { return load(demo ? 'taskapp.demo.company' : 'taskapp.company'); },
    saveCompany: function (n) { if (n) save(demo ? 'taskapp.demo.company' : 'taskapp.company', n); },

    /**
     * Resolves with the data, or rejects with Error (e.code = backend code, e.network = true if unreachable).
     * opts.timeout (ms) - voice uploads and AI calls can take a while.
     */
    call: async function (action, params, opts) {
      opts = opts || {};
      const req = Object.assign({ action: action, token: Api.token || undefined }, params || {});
      let res;
      if (demo) {
        await new Promise(function (r) { setTimeout(r, 120); });
        res = await w.DemoBackend.handle(JSON.parse(JSON.stringify(req)));
      } else {
        // Reading is safe to repeat, so a read that hangs is given up after 20 s and asked once more (Apps Script sometimes
        // leaves a request hanging while the next one is answered at once). Writes are never repeated: they wait their full time.
        const isRead = !opts.timeout && READS.indexOf(action) >= 0;
        const tries = isRead ? 2 : 1;
        let lastErr = null;
        for (let n = 1; n <= tries && !res; n++) {
          const ctl = new AbortController();
          const timer = setTimeout(function () { ctl.abort(); }, opts.timeout || (isRead ? 20000 : 60000));
          const hint = isRead ? setTimeout(function () { Api.onSlow(true); }, 6000) : 0;
          try {
            const r = await fetch(cfg.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), signal: ctl.signal });
            res = await r.json();
          } catch (e) {
            lastErr = e;
          } finally { clearTimeout(timer); clearTimeout(hint); if (isRead) Api.onSlow(false); }
        }
        if (!res) {
          const err = new Error(lastErr && lastErr.name === 'AbortError' ? 'The server is slow right now. Please try again in a moment.' : 'Could not reach the server. Check your internet connection and try again.');
          err.network = true; throw err;
        }
      }
      if (!res || !res.ok) {
        const err = new Error((res && res.error) || 'Unknown error');
        err.code = res && res.code;
        if (err.code === 'AUTH' && action !== 'login' && Api.token) { Api.setToken(''); Api.onAuthLost(err.message); }
        throw err;
      }
      return res.data;
    }
  };
  w.Api = Api;
})(window);
