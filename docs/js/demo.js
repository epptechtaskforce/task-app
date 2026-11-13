/* demo.js - "demo mode": the REAL business logic (core.js) running in the browser on fake data.
 * Nothing is sent anywhere. Data lives in this browser's localStorage. Open the site with ?demo=1.
 */
(function (w) {
  'use strict';

  const KEY = 'taskapp.demo.db.v1';
  const DAY = 86400000;
  const PASSWORD = 'demo1234';
  let core = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // half a second of silence, so the demo voice messages have something playable
  function silentWavB64() {
    const n = 8000, bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer);
    const str = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function seed(env, setOffset) {
    const call = function (action, token, params) {
      const r = core.handle(Object.assign({ action: action, token: token }, params || {}));
      if (!r.ok) throw new Error('Demo seed failed at ' + action + ': ' + r.error);
      return r.data;
    };
    core.setup({ companyName: 'Acme Foods (demo)', adminName: 'Demo Admin', adminUsername: 'admin', adminPassword: 'demo-admin-1' });
    const first = call('login', null, { username: 'admin', password: 'demo-admin-1' });
    call('changePassword', first.token, { oldPassword: 'demo-admin-1', newPassword: PASSWORD });
    const A = call('login', null, { username: 'admin', password: PASSWORD }).token;

    const T = {};
    [['Chairman', 1], ['General Manager', 2], ['Supervisor', 3], ['Field Officer', 4]].forEach(function (p) { T[p[0]] = call('adminSaveJobTitle', A, { title: p[0], level: p[1] }).id; });
    const U = {}, tok = {};
    [['nimal.perera', 'Nimal Perera', 'Chairman'], ['kamala.silva', 'Kamala Silva', 'General Manager'], ['sunil.fernando', 'Sunil Fernando', 'Supervisor'],
     ['ruwan.jayasinghe', 'Ruwan Jayasinghe', 'Field Officer'], ['ishara.dias', 'Ishara Dias', 'Field Officer']].forEach(function (p) {
      const r = call('adminSaveUser', A, { name: p[1], username: p[0], jobTitleId: T[p[2]] });
      U[p[0]] = r.user.id;
      const l = call('login', null, { username: p[0], password: r.tempPassword });
      call('changePassword', l.token, { oldPassword: r.tempPassword, newPassword: PASSWORD });
      tok[p[0]] = call('login', null, { username: p[0], password: PASSWORD }).token;
    });
    const L = function (a, b) { return { fromId: U[a], toId: U[b] }; };
    call('adminSaveLinks', A, { note: 'Demo structure', links: [L('nimal.perera', 'kamala.silva'), L('nimal.perera', 'sunil.fernando'), L('kamala.silva', 'sunil.fernando'), L('kamala.silva', 'ruwan.jayasinghe'), L('sunil.fernando', 'ruwan.jayasinghe'), L('sunil.fernando', 'ishara.dias')] });

    // short bios, so the profile cards look alive in the demo
    [['nimal.perera', 'Chairman. Ask me about strategy and budgets.'], ['kamala.silva', 'General Manager. Keeps the harvest and packing schedules running.'], ['sunil.fernando', 'Supervisor of the field teams. Irrigation and quality checks.'],
     ['ruwan.jayasinghe', 'Field officer, Blocks A to C.'], ['ishara.dias', 'Field officer. Ask me about drip lines.']].forEach(function (p) { call('saveProfile', tok[p[0]], { bio: p[1] }); });

    const wav = silentWavB64();
    const ymd = function (offsetDays) { const d = new Date(Date.now() + offsetDays * DAY); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };

    // 1. an old, finished task -> History
    setOffset(-3 * DAY);
    const t1 = call('createTask', tok['kamala.silva'], { title: 'Weekly harvest report', description: 'Collect picking totals from all blocks and send me the summary.', assigneeIds: [U['sunil.fernando'], U['ruwan.jayasinghe']] }).task;
    setOffset(-3 * DAY + 3600000); call('postMessage', tok['kamala.silva'], { taskId: t1.id, text: 'Please have this ready before the Friday review.' });
    setOffset(-3 * DAY + 2 * 3600000); call('postMessage', tok['sunil.fernando'], { taskId: t1.id, text: 'Blocks A and B are counted. Waiting for C.' });
    setOffset(-2 * DAY); call('postVoice', tok['ruwan.jayasinghe'], { taskId: t1.id, audioB64: wav, wavB64: wav, mime: 'audio/wav', secs: 8 });
    setOffset(-2 * DAY + 3600000); call('setProgress', tok['sunil.fernando'], { taskId: t1.id, progress: 100 });
    setOffset(-2 * DAY + 2 * 3600000); call('approveTask', tok['kamala.silva'], { taskId: t1.id });

    // 2. in progress, with a voice update
    setOffset(-1 * DAY);
    const t2 = call('createTask', tok['sunil.fernando'], { title: 'Check irrigation in Block C', description: 'Walk the lines and report any leaks or blocked drippers.', assigneeIds: [U['ruwan.jayasinghe'], U['ishara.dias']], dueDate: ymd(1) }).task;
    setOffset(-1 * DAY + 3600000); call('postVoice', tok['ruwan.jayasinghe'], { taskId: t2.id, audioB64: wav, wavB64: wav, mime: 'audio/wav', secs: 14 });
    setOffset(-1 * DAY + 2 * 3600000); call('postMessage', tok['ishara.dias'], { taskId: t2.id, text: 'Rows 1 to 10 are fine. Two drippers blocked in row 11, fixing now.' });
    setOffset(-1 * DAY + 3 * 3600000); call('setProgress', tok['ishara.dias'], { taskId: t2.id, progress: 60 });
    setOffset(0); call('refreshSummary', tok['sunil.fernando'], { taskId: t2.id });

    // 3. finished, waiting for the manager to approve
    setOffset(-4 * 3600000);
    const t3 = call('createTask', tok['kamala.silva'], { title: 'Prepare packing schedule for Friday', description: 'Match the truck slots with the harvest forecast.', assigneeIds: [U['sunil.fernando']], dueDate: ymd(0) }).task;
    setOffset(-3 * 3600000); call('postMessage', tok['sunil.fernando'], { taskId: t3.id, text: 'Schedule drafted and shared with the packing house.' });
    setOffset(-2 * 3600000); call('setProgress', tok['sunil.fernando'], { taskId: t3.id, progress: 100 });
    setOffset(0); call('refreshSummary', tok['kamala.silva'], { taskId: t3.id });

    // 4. just assigned, nothing happened yet
    const t4 = call('createTask', tok['nimal.perera'], { title: 'Send the Q4 budget draft', description: '', assigneeIds: [U['kamala.silva']], dueDate: ymd(1) }).task;
    return t4;
  }

  const Demo = {
    ready: null,
    init: function () {
      if (Demo.ready) return Demo.ready;
      Demo.ready = (async function () {
        await loadScript('js/memory-env.js');
        await loadScript('js/core.js');
        let offset = 0;
        const env = w.MemoryEnv.createMemoryEnv({ persistKey: KEY, now: function () { return Date.now() + offset; }, hashRounds: 30 });
        core = createCore(env);
        let existing = null;
        try { existing = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
        if (!existing || !existing.t || !existing.t.Users || !existing.t.Users.length) {
          env.store.init(core.TABLES);
          seed(env, function (ms) { offset = ms; });
          offset = 0;
        } else env.store.init(core.TABLES);
        w.DemoBackend = { handle: function (req) { return core.handle(req); } };
      })();
      return Demo.ready;
    },
    reset: function () { try { localStorage.removeItem(KEY); localStorage.removeItem('taskapp.demo.token'); } catch (e) { /* ignore */ } if (window.Api) window.Api.cacheClear(); location.reload(); },
    accounts: [
      ['admin', 'Administrator (users, job titles, org chart)'],
      ['nimal.perera', 'Chairman (top layer)'], ['kamala.silva', 'General Manager'], ['sunil.fernando', 'Supervisor'],
      ['ruwan.jayasinghe', 'Field Officer'], ['ishara.dias', 'Field Officer']
    ],
    password: PASSWORD
  };
  w.Demo = Demo;
})(window);
