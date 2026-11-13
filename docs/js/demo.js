/* demo.js - "demo mode": the REAL business logic (core.js) running in the browser on fake data.
 * Nothing is sent anywhere. Data lives in this browser's localStorage. Open the site with ?demo=1.
 */
(function (w) {
  'use strict';

  const KEY = 'taskapp.demo.db.v3';
  const DAY = 86400000;
  const PASSWORD = 'demo1234';
  let core = null;

  const VER = (/[?&]v=(\w+)/.exec((document.currentScript || {}).src || '') || [])[1] || '';   // the same version tag as demo.js itself, so updated files are never served from an old cache
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = src + (VER ? '?v=' + VER : ''); s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function seed(env, setOffset) {
    const call = function (action, token, params) {
      const r = core.handle(Object.assign({ action: action, token: token }, params || {}));
      if (!r.ok) throw new Error('Demo seed failed at ' + action + ': ' + r.error);
      return r.data;
    };
    const D = w.DemoData;
    core.setup({ companyName: 'Acme Foods (demo)', adminName: 'Demo Admin', adminUsername: 'admin', adminPassword: 'demo-admin-1' });
    const first = call('login', null, { username: 'admin', password: 'demo-admin-1' });
    call('changePassword', first.token, { oldPassword: 'demo-admin-1', newPassword: PASSWORD });
    const A = call('login', null, { username: 'admin', password: PASSWORD }).token;

    const T = {};
    D.titles.forEach(function (p) { T[p[0]] = call('adminSaveJobTitle', A, { title: p[0], level: p[1] }).id; });
    const U = {}, tok = {};
    D.people.forEach(function (p) {
      const r = call('adminSaveUser', A, { name: p[1], username: p[0], jobTitleId: T[p[2]] });
      U[p[0]] = r.user.id;
      const l = call('login', null, { username: p[0], password: r.tempPassword });
      call('changePassword', l.token, { oldPassword: r.tempPassword, newPassword: PASSWORD });
      tok[p[0]] = call('login', null, { username: p[0], password: PASSWORD }).token;
    });
    const uid = function (short) { return U[D.short[short]]; }, tk = function (short) { return tok[D.short[short]]; };
    const links = [];
    Object.keys(D.arrows).forEach(function (from) { D.arrows[from].forEach(function (to) { links.push({ fromId: uid(from), toId: uid(to) }); }); });
    call('adminSaveLinks', A, { note: 'Demo structure', links: links });
    D.people.forEach(function (p) { call('saveProfile', tok[p[0]], { bio: p[3] }); });

    /* two months of work: every task is created at its own time in the past, with the updates that followed */
    const H = 3600000, midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const M0 = midnight.getTime(), realNow = Date.now();
    const when = function (day, hour) { return Math.min(M0 - day * DAY + hour * H, realNow - 120000); };
    const at = function (day, hour) { setOffset(when(day, hour) - realNow); };
    const ymd = function (ms) { const d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    const wav = D.voice(), pics = {}, active = [];

    D.tasks.forEach(function (spec) {
      at(spec.day, spec.hour);
      const task = call('createTask', tk(spec.by), { title: spec.t, description: spec.d, assigneeIds: spec.to.map(uid), dueDate: ymd(M0 + spec.due * DAY) }).task;
      const events = spec.ev.map(function (e, i) { return { e: e, i: i, t: when(e[1], e[2]) }; }).sort(function (x, y) { return x.t - y.t || x.i - y.i; });
      let closed = false;
      events.forEach(function (x) {
        const e = x.e, kind = e[0];
        at(e[1], e[2]);
        if (kind === 's') call('postMessage', tk(e[3]), { taskId: task.id, text: e[4] });
        else if (kind === 'v') {
          const v = call('postVoice', tk(e[3]), { taskId: task.id, audioB64: wav, wavB64: wav, mime: 'audio/wav', secs: e[4] });
          // what the AI "understood" from this (hidden) voice message, so its answers about it are true to the story
          env.store.update('Messages', v.message.id, { transcript: e[5] || '', translation: '', lang: 'English', status: 'ok' });
        }
        else if (kind === 'i') {
          const key = e[4] + '|' + e[5]; const img = pics[key] || (pics[key] = D.image(e[4], e[5]));
          call('postFile', tk(e[3]), { taskId: task.id, name: e[4] + '-' + (Object.keys(pics).length) + '.jpg', b64: img.b64, thumb: img.thumb, w: img.w, h: img.h, caption: e[5] });
        } else if (kind === 'f') { const d = D.doc(e[4]); call('postFile', tk(e[3]), { taskId: task.id, name: d.name, b64: d.b64, caption: e[5] }); }
        else if (kind === 'p') call('setProgress', tk(e[3]), { taskId: task.id, progress: e[4] });
        else if (kind === 'ok') { call('approveTask', tk(spec.by), { taskId: task.id }); closed = true; }
        else if (kind === 'back') call('rejectTask', tk(spec.by), { taskId: task.id, note: e[3] });
      });
      if (!closed) active.push({ id: task.id, spec: spec });
    });

    // today: mark what people have already read (except the tasks that should look new). No AI text is pre-written: the
    // summaries, overview and answers are made on demand by the real model from this data.
    setOffset(0);
    active.forEach(function (a) {
      if (!a.spec.unread) [a.spec.by].concat(a.spec.to).forEach(function (who) { call('getTask', tk(who), { taskId: a.id }); });
    });
  }

  /* ---------- the AI in the demo ----------
   * The demo's data and rules (core.js) run in this browser, so the real "business logic" builds the prompt: it decides what
   * this person may see, writes the context, and later checks every proposed action. Only the model call itself goes out,
   * through the backend's capped demoAi relay (which holds the key and reads no stored data). Core is synchronous, so it is run
   * twice: first to collect the model input, then again with the model's answer. Without a backend address (a local copy)
   * the simple built-in stand-in answers instead. */
  const PROXIED = { assistant: 1, briefing: 1, refreshSummary: 1, postVoice: 1 };
  // The relay is OFF unless js/config.js says demoAi: true (and has a backend address): it is a public, capped endpoint that uses the shared AI quota, so the administrator must choose it.
  function backendUrl() { return w.APP_CONFIG && w.APP_CONFIG.demoAi === true && w.APP_CONFIG.backendUrl ? w.APP_CONFIG.backendUrl : ''; }
  function relay(kind, input) {
    const ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 100000);
    return fetch(backendUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'demoAi', kind: kind, input: input }), signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (!res || !res.ok) throw new Error((res && res.error) || 'The assistant is not available right now.'); return res.data; })
      .catch(function (e) { throw new Error(e.name === 'AbortError' ? 'The assistant took too long. Please try again.' : (e.message && !/fetch|network/i.test(e.message) ? e.message : 'Could not reach the assistant. Check your internet connection.')); })
      .finally(function () { clearTimeout(timer); });
  }
  function setupAi(env) {
    const stand = env.ai;                                   // the simple built-in stand-in (also used by the tests)
    let mode = null;                                        // { capture: {} } while collecting the input, { replay: {kind, value} } while using the answer
    const Captured = function () {};
    const hook = function (kind, input, fallback) {
      if (!backendUrl()) return fallback();
      if (mode && mode.replay && mode.replay.kind === kind) return mode.replay.value;
      if (mode && mode.capture) { mode.capture.kind = kind; mode.capture.input = input; if (mode.capture.carryOn) return mode.capture.placeholder; throw new Captured(); }
      return fallback();
    };
    env.ai = {
      transcribe: function (b64, mime, hints) { return hook('transcribe', { b64: b64, mime: mime, hints: hints }, function () { return stand.transcribe(b64, mime, hints); }); },
      summarize: function (input) { return hook('summarize', input, function () { return stand.summarize(input); }); },
      assistant: function (input) { return hook('assistant', input, function () { return stand.assistant(input); }); },
      briefing: function (input) { return hook('briefing', input, function () { return stand.briefing(input); }); }
    };
    return async function handle(req) {
      if (!backendUrl() || !PROXIED[req.action]) return core.handle(req);
      if (req.action === 'postVoice') {
        // the message is saved at once; what the AI understands from it is added in the background (it is never shown)
        mode = { capture: { carryOn: true, placeholder: { english: '', language: '', key_points: '' } } };
        let r; try { r = core.handle(req); } finally { var cap = mode.capture; mode = null; }
        if (r.ok && cap.kind === 'transcribe') {
          relay('transcribe', cap.input).then(function (t) {
            env.store.update('Messages', r.data.message.id, { transcript: String(t.english || t.english_translation || t.transcript || '').slice(0, 8000), translation: String(t.key_points || '').slice(0, 600), lang: String(t.language || '').slice(0, 40), status: 'ok' });
          }).catch(function () { /* the demo simply has no memory of this message */ });
        }
        return r;
      }
      mode = { capture: {} };
      let r; try { r = core.handle(req); } finally { var cap2 = mode.capture; mode = null; }
      if (!cap2.kind) return r;                             // nothing needed the model (for example: no messages to summarise)
      let raw;
      try { raw = await relay(cap2.kind, cap2.input); } catch (e) { return { ok: false, code: 'AI_FAILED', error: e.message }; }
      mode = { replay: { kind: cap2.kind, value: raw } };
      try { return core.handle(req); } finally { mode = null; }
    };
  }

  const Demo = {
    ready: null,
    init: function () {
      if (Demo.ready) return Demo.ready;
      Demo.ready = (async function () {
        await loadScript('js/memory-env.js');
        await loadScript('js/demo-data.js');
        await loadScript('js/core.js');
        let offset = 0;
        try { ['taskapp.demo.db.v1', 'taskapp.demo.db.v2', 'taskapp.demo.db.v2.files'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
        const env = w.MemoryEnv.createMemoryEnv({ persistKey: KEY, now: function () { return Date.now() + offset; }, hashRounds: 30 });
        core = createCore(env);
        let existing = null;
        try { existing = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
        if (!existing || !existing.t || !existing.t.Users || !existing.t.Users.length) {
          env.store.init(core.TABLES);
          seed(env, function (ms) { offset = ms; });
          offset = 0;
        } else env.store.init(core.TABLES);
        w.DemoBackend = { handle: setupAi(env), realAi: !!backendUrl() };
      })();
      return Demo.ready;
    },
    reset: function () { try { localStorage.removeItem(KEY); localStorage.removeItem('taskapp.demo.token'); } catch (e) { /* ignore */ } if (window.Api) window.Api.cacheClear(); location.reload(); },
    accounts: [
      ['admin', 'Administrator (users, job titles, org chart)'],
      ['nimal.perera', 'Chairman (top layer)'], ['kamala.silva', 'General Manager, Operations'], ['dinesh.rathnayake', 'General Manager, Logistics'],
      ['sunil.fernando', 'Supervisor'], ['nadeesha.wickrama', 'Supervisor, Quality'],
      ['ruwan.jayasinghe', 'Field Officer'], ['ishara.dias', 'Field Officer'], ['kasun.bandara', 'Field Officer'], ['thilini.herath', 'Field Officer'], ['mahesh.kumara', 'Field Officer']
    ],
    password: PASSWORD
  };
  w.Demo = Demo;
})(window);
