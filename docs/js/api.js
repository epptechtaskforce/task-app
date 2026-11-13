/* api.js - talks to the Apps Script backend (or the in-browser demo backend). */
(function (w) {
  'use strict';

  const TOKEN_KEY = 'taskapp.token';
  const cfg = w.APP_CONFIG || {};
  const demo = !!cfg.demo || /[?&]demo=1\b/.test(location.search);
  const CACHE_PREFIX = demo ? 'taskapp.demo.c.' : 'taskapp.c.';   // demo data is kept apart from real data

  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function save(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }

  const SAFE = ['login', 'info', 'me', 'listTasks', 'getTask', 'listHistory', 'getArchived', 'assignable', 'adminOverview'];   // safe to ask twice (the sign-in too)

  function fetchJson(req, ctl) {
    return fetch(cfg.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), signal: ctl.signal }).then(function (r) { return r.json(); });
  }
  function slowError(e) {
    const err = new Error(e && e.name === 'AbortError' ? 'The server is slow right now. Please try again in a moment.' : 'Could not reach the server. Check your internet connection and try again.');
    err.network = true; return err;
  }
  function single(req, ms) {
    const ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ms);
    return fetchJson(req, ctl).catch(function (e) { throw slowError(e); }).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }
  function hedged(req, launches, deadline) {
    return new Promise(function (resolve, reject) {
      let done = false, pending = 0, next = 0, timer = 0, lastErr = null;
      const ctls = [], slow = setTimeout(function () { Api.onSlow(true); }, 6000);
      const finish = function (fn, v) {
        if (done) return; done = true; clearTimeout(timer); clearTimeout(slow); clearTimeout(stop); Api.onSlow(false);
        ctls.forEach(function (c) { try { c.abort(); } catch (e) { /* already finished */ } }); fn(v);
      };
      const stop = setTimeout(function () { const e = new Error('slow'); e.name = 'AbortError'; finish(reject, slowError(e)); }, deadline);
      const launch = function () {
        if (done || next >= launches.length) return;
        const ctl = new AbortController(); ctls.push(ctl); pending++; next++;
        clearTimeout(timer);
        if (next < launches.length) timer = setTimeout(launch, Math.max(0, launches[next] - launches[next - 1]));
        fetchJson(req, ctl).then(function (r) { finish(resolve, r); }, function (e) {
          if (done) return;
          lastErr = e; pending--;
          if (!pending) { if (next < launches.length) launch(); else finish(reject, slowError(lastErr)); }   // everything failed: try the next one at once
        });
      };
      launch();
    });
  }

  const Api = {
    demo: demo,
    token: load(demo ? 'taskapp.demo.token' : TOKEN_KEY),
    configured: demo || !!cfg.backendUrl,
    timing: { launches: [0, 4500, 9500], deadline: 24000 },
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
        // Apps Script sometimes loses a request completely (it never even starts) while the next one is answered in about
        // 2 s. So for reads and sign-in, if nothing has come back after 4.5 s the same request is sent again alongside the first
        // (and once more after 9.5 s), and whichever answers first wins. Writes are sent once and wait their full time.
        const safe = !opts.timeout && SAFE.indexOf(action) >= 0;
        if (safe) res = await hedged(req, Api.timing.launches, Api.timing.deadline);
        else res = await single(req, opts.timeout || 60000);
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
