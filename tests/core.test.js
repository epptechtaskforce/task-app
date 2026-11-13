// Run with:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv, sha256Hex } = require('../docs/js/memory-env.js');

function makeApp(opts) {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const env = createMemoryEnv(Object.assign({ now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: "3" } }, opts || {}));
  const core = createCore(env);
  const app = {
    env, core,
    tick: (ms) => { clock += ms; },
    call(action, token, params) { return core.handle(Object.assign({ action, token }, params || {})); },
    ok(action, token, params) {
      const r = app.call(action, token, params);
      assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r));
      return r.data;
    },
    err(action, token, params, code) {
      const r = app.call(action, token, params);
      assert.equal(r.ok, false, action + ' should have failed');
      if (code) assert.equal(r.code, code, action + ' wrong code: ' + JSON.stringify(r));
      return r;
    }
  };
  core.setup({ companyName: 'Acme Ltd', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  return app;
}

// Builds: admin, titles (CEO L1, Manager L2, Worker L3), users ceo/mgr/wk1/wk2/wk3, links ceo->mgr, mgr->wk1,wk2, ceo->wk1
function seed(app) {
  const admin = app.ok('login', null, { username: 'admin', password: 'Admin-pass-1' });
  app.ok('changePassword', admin.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = app.ok('login', null, { username: 'admin', password: 'Admin-pass-2' }).token;
  const titles = {};
  [['CEO', 1], ['Manager', 2], ['Worker', 3]].forEach(([t, l]) => { titles[t] = app.ok('adminSaveJobTitle', A, { title: t, level: l }).id; });
  const users = {};
  [['ceo', 'CEO'], ['mgr', 'Manager'], ['wk1', 'Worker'], ['wk2', 'Worker'], ['wk3', 'Worker']].forEach(([u, t]) => {
    const r = app.ok('adminSaveUser', A, { name: u.toUpperCase(), username: u, jobTitleId: titles[t] });
    users[u] = { id: r.user.id, temp: r.tempPassword };
  });
  app.ok('adminSaveLinks', A, { links: [['ceo', 'mgr'], ['mgr', 'wk1'], ['mgr', 'wk2'], ['ceo', 'wk1']].map(([f, t]) => ({ fromId: users[f].id, toId: users[t].id })), note: 'v1' });
  const tok = {};
  for (const u of Object.keys(users)) {
    const l = app.ok('login', null, { username: u, password: users[u].temp });
    app.err('listTasks', l.token, {}, 'MUSTCHANGE');
    app.ok('changePassword', l.token, { oldPassword: users[u].temp, newPassword: 'Changed-' + u + '-1' });
    tok[u] = app.ok('login', null, { username: u, password: 'Changed-' + u + '-1' }).token;
  }
  return { A, titles, users, tok };
}

test('sha256 matches node crypto (including unicode)', () => {
  for (const s of ['', 'abc', 'The quick brown fox', 'සිංහල පරීක්ෂණය', 'x'.repeat(1000)]) {
    assert.equal(sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('setup, login, forced password change, lockout', () => {
  const app = makeApp();
  assert.deepEqual(app.ok('info', null), { companyName: 'Acme Ltd', version: '1.0.0', ready: true });
  app.err('login', null, { username: 'nobody', password: 'x' }, 'AUTH');
  const l = app.ok('login', null, { username: 'ADMIN', password: 'Admin-pass-1' }); // case-insensitive username
  assert.equal(l.user.mustChange, true);
  app.err('adminOverview', l.token, {}, 'MUSTCHANGE');
  app.err('changePassword', l.token, { oldPassword: 'wrong', newPassword: 'Another-pass-1' }, 'AUTH');
  app.err('changePassword', l.token, { oldPassword: 'Admin-pass-1', newPassword: 'short' }, 'VALIDATION');
  app.ok('changePassword', l.token, { oldPassword: 'Admin-pass-1', newPassword: 'Another-pass-1' });
  app.ok('adminOverview', l.token);
  // lockout after 5 wrong attempts, even with the right password afterwards
  for (let i = 0; i < 5; i++) app.err('login', null, { username: 'admin', password: 'bad' + i }, 'AUTH');
  app.err('login', null, { username: 'admin', password: 'Another-pass-1' }, 'LOCKED');
  app.tick(16 * 60000);
  app.ok('login', null, { username: 'admin', password: 'Another-pass-1' });
});

test('bad tokens, expired sessions, logout, deactivated users', () => {
  const app = makeApp(); const s = seed(app);
  app.err('listTasks', null, {}, 'AUTH');
  app.err('listTasks', 'f'.repeat(64), {}, 'AUTH');
  app.ok('listTasks', s.tok.wk1);
  app.ok('logout', s.tok.wk1);
  app.err('listTasks', s.tok.wk1, {}, 'AUTH');
  const t2 = app.ok('login', null, { username: 'wk2', password: 'Changed-wk2-1' }).token;
  app.tick(15 * 86400000);
  app.err('listTasks', t2, {}, 'AUTH');
  // deactivation kills sessions and blocks login (the admin's own session expired too, so sign in again)
  const adminToken = app.ok('login', null, { username: 'admin', password: 'Admin-pass-2' }).token;
  const wk3 = app.ok('login', null, { username: 'wk3', password: 'Changed-wk3-1' }).token;
  app.ok('adminSaveUser', adminToken, { id: s.users.wk3.id, name: 'WK3', username: 'wk3', jobTitleId: s.titles.Worker, active: false });
  app.err('listTasks', wk3, {}, 'AUTH');
  app.err('login', null, { username: 'wk3', password: 'Changed-wk3-1' }, 'AUTH');
});

test('admin-only actions are protected and responses never leak password data', () => {
  const app = makeApp(); const s = seed(app);
  for (const a of ['adminOverview', 'adminSaveJobTitle', 'adminSaveUser', 'adminSaveLinks', 'adminResetPassword', 'adminDeleteJobTitle']) {
    app.err(a, s.tok.ceo, {}, 'FORBIDDEN');
  }
  const o = JSON.stringify(app.ok('adminOverview', s.A));
  assert.ok(!/passHash|passSalt|tokenHash/.test(o));
  assert.ok(!/passHash|passSalt/.test(JSON.stringify(app.ok('me', s.tok.ceo))));
});

test('admin: job titles, users and tether validation', () => {
  const app = makeApp(); const s = seed(app);
  app.err('adminSaveJobTitle', s.A, { title: 'manager', level: 4 }, 'VALIDATION');   // duplicate (case-insensitive)
  app.err('adminSaveJobTitle', s.A, { title: 'X', level: 0 }, 'VALIDATION');
  app.err('adminDeleteJobTitle', s.A, { id: s.titles.Worker }, 'VALIDATION');         // still in use
  app.err('adminSaveUser', s.A, { name: 'Dup', username: 'CEO', jobTitleId: s.titles.CEO }, 'VALIDATION');
  app.err('adminSaveUser', s.A, { name: 'Bad', username: 'a b', jobTitleId: s.titles.CEO }, 'VALIDATION');
  app.err('adminSaveUser', s.A, { name: 'NoTitle', username: 'notitle', jobTitleId: '' }, 'VALIDATION');
  // tethers: same level and upward are rejected, unknown users rejected
  const L = (f, t) => ({ fromId: s.users[f].id, toId: s.users[t].id });
  app.err('adminSaveLinks', s.A, { links: [L('wk1', 'wk2')] }, 'VALIDATION');
  app.err('adminSaveLinks', s.A, { links: [L('wk1', 'ceo')] }, 'VALIDATION');
  app.err('adminSaveLinks', s.A, { links: [{ fromId: 'nope', toId: s.users.wk1.id }] }, 'VALIDATION');
  // the failed attempts must not have changed the saved tethers
  assert.equal(app.ok('adminOverview', s.A).links.length, 4);
  const saved = app.ok('adminSaveLinks', s.A, { links: [L('ceo', 'mgr'), L('ceo', 'mgr'), L('mgr', 'wk1')], note: 'v2' });
  assert.equal(saved.version, 2); assert.equal(saved.linkCount, 2); // duplicates removed
  assert.equal(app.ok('adminOverview', s.A).versions.length, 2);
  // changing a level that would break an existing tether is refused
  app.err('adminSaveJobTitle', s.A, { id: s.titles.Manager, level: 1 }, 'VALIDATION');
  // cannot remove the last admin
  const me = app.ok('adminOverview', s.A).users.filter(u => u.username === 'admin')[0];
  app.err('adminSaveUser', s.A, { id: me.id, name: 'Administrator', username: 'admin', jobTitleId: '', isAdmin: false }, 'VALIDATION');
  app.err('adminSaveUser', s.A, { id: me.id, name: 'Administrator', username: 'admin', jobTitleId: '', isAdmin: true, active: false }, 'VALIDATION');
  // password reset forces a change and signs the user out
  const r = app.ok('adminResetPassword', s.A, { userId: s.users.wk2.id });
  app.err('listTasks', s.tok.wk2, {}, 'AUTH');
  const l = app.ok('login', null, { username: 'wk2', password: r.tempPassword });
  assert.equal(l.user.mustChange, true);
});

test('task permissions follow the tethers', () => {
  const app = makeApp(); const s = seed(app);
  assert.deepEqual(app.ok('assignable', s.tok.ceo).map(u => u.name), ['MGR', 'WK1']);
  assert.deepEqual(app.ok('assignable', s.tok.mgr).map(u => u.name), ['WK1', 'WK2']);
  assert.deepEqual(app.ok('assignable', s.tok.wk1), []);
  app.err('createTask', s.tok.mgr, { title: 'No access', assigneeIds: [s.users.wk3.id] }, 'FORBIDDEN');   // not tethered
  app.err('createTask', s.tok.wk1, { title: 'Upward', assigneeIds: [s.users.mgr.id] }, 'FORBIDDEN');
  app.err('createTask', s.tok.ceo, { title: 'Skip + untethered', assigneeIds: [s.users.mgr.id, s.users.wk2.id] }, 'FORBIDDEN'); // ceo has no tether to wk2
  app.err('createTask', s.tok.ceo, { title: '', assigneeIds: [s.users.mgr.id] }, 'VALIDATION');
  app.err('createTask', s.tok.ceo, { title: 'Nobody', assigneeIds: [] }, 'VALIDATION');
  app.err('createTask', s.tok.ceo, { title: 'Bad date', assigneeIds: [s.users.mgr.id], dueDate: '12/31/2026' }, 'VALIDATION');
  const t = app.ok('createTask', s.tok.ceo, { title: 'Skip level', assigneeIds: [s.users.wk1.id], dueDate: '2026-12-01' }).task; // ceo -> wk1 skips a level
  assert.equal(t.status, 'open'); assert.equal(t.progress, 0);
  // admin is not a participant: cannot see any task
  assert.equal(app.ok('listTasks', s.A).tasks.length, 0);
  app.err('getTask', s.A, { taskId: t.id }, 'NOT_FOUND');
  app.err('getTask', s.tok.wk2, { taskId: t.id }, 'NOT_FOUND');
  app.err('postMessage', s.tok.wk2, { taskId: t.id, text: 'hi' }, 'NOT_FOUND');
  app.err('setProgress', s.tok.wk2, { taskId: t.id, progress: 50 }, 'NOT_FOUND');
  app.err('refreshSummary', s.tok.wk2, { taskId: t.id }, 'NOT_FOUND');
});

test('full task life cycle: shared chat, progress, send back, approve, archive', () => {
  const app = makeApp(); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Prepare harvest report', description: 'Weekly numbers', assigneeIds: [s.users.wk1.id, s.users.wk2.id] }).task;
  assert.equal(app.ok('listTasks', s.tok.wk1).tasks[0].unread, false);   // only a system message so far
  app.tick(1000);
  app.ok('postMessage', s.tok.mgr, { taskId: t.id, text: 'Please start today' });
  assert.equal(app.ok('listTasks', s.tok.wk1).tasks[0].unread, true);
  assert.equal(app.ok('listTasks', s.tok.wk2).tasks[0].unread, true);
  const g1 = app.ok('getTask', s.tok.wk1, { taskId: t.id });
  assert.equal(g1.messages.length, 2);                                  // system + manager text (one shared conversation)
  assert.equal(app.ok('listTasks', s.tok.wk1).tasks[0].unread, false);   // wk1 read it
  assert.equal(app.ok('listTasks', s.tok.wk2).tasks[0].unread, true);    // wk2 has not
  app.tick(1000);
  app.ok('postMessage', s.tok.wk2, { taskId: t.id, text: 'Half done' });
  assert.equal(app.ok('getTask', s.tok.wk1, { taskId: t.id }).messages.length, 3); // wk2's message is visible to wk1 too

  // only assignees can move the slider
  app.err('setProgress', s.tok.mgr, { taskId: t.id, progress: 50 }, 'FORBIDDEN');
  app.err('setProgress', s.tok.wk1, { taskId: t.id, progress: 101 }, 'VALIDATION');
  app.err('setProgress', s.tok.wk1, { taskId: t.id, progress: 12.5 }, 'VALIDATION');
  app.tick(1000);
  assert.equal(app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 60 }).task.status, 'open');
  app.err('approveTask', s.tok.mgr, { taskId: t.id }, 'VALIDATION');   // not at 100 yet
  app.tick(1000);
  const done = app.ok('setProgress', s.tok.wk2, { taskId: t.id, progress: 100 }).task;
  assert.equal(done.status, 'pending');
  assert.equal(app.ok('listTasks', s.tok.mgr).tasks[0].status, 'pending');
  app.err('approveTask', s.tok.wk1, { taskId: t.id }, 'FORBIDDEN');     // assignees cannot approve
  app.err('rejectTask', s.tok.wk1, { taskId: t.id }, 'FORBIDDEN');
  // manager is not happy: sends it back
  const back = app.ok('rejectTask', s.tok.mgr, { taskId: t.id, note: 'numbers missing' }).task;
  assert.equal(back.status, 'open'); assert.equal(back.progress, 90);
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  // dragging the slider back from 100 reopens it
  assert.equal(app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 95 }).task.status, 'open');
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  app.tick(86400000);
  const closed = app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  assert.equal(closed.archived, true);

  // gone from the live lists, present in history for participants only
  assert.equal(app.ok('listTasks', s.tok.mgr).tasks.length, 0);
  assert.equal(app.env.store.all('Messages').length, 0);
  assert.equal(app.env.store.all('Tasks').length, 0);
  for (const u of ['mgr', 'wk1', 'wk2']) {
    const h = app.ok('listHistory', s.tok[u], {});
    assert.equal(h.total, 1); assert.equal(h.items[0].title, 'Prepare harvest report');
  }
  assert.equal(app.ok('listHistory', s.tok.ceo, {}).total, 0);
  assert.equal(app.ok('listHistory', s.tok.mgr, { q: 'harvest' }).total, 1);
  assert.equal(app.ok('listHistory', s.tok.mgr, { q: 'zzz' }).total, 0);
  app.err('getArchived', s.tok.ceo, { taskId: t.id }, 'NOT_FOUND');
  const doc = app.ok('getArchived', s.tok.wk1, { taskId: t.id });
  assert.equal(doc.task.title, 'Prepare harvest report');
  assert.equal(doc.task.startedText.slice(0, 10), '2026-11-12');
  assert.equal(doc.task.completedText.slice(0, 10), '2026-11-13');
  assert.ok(doc.messages.some(m => m.text === 'Half done'));
  assert.ok(doc.messages.some(m => /sent the task back/.test(m.text)));
  // closed tasks cannot be changed
  app.err('postMessage', s.tok.wk1, { taskId: t.id, text: 'late' }, 'NOT_FOUND');
});

test('voice messages: stored, transcribed, and a failing AI does not lose the audio', () => {
  let failing = false;
  const ai = {
    transcribe: () => { if (failing) throw new Error('503 overloaded'); return { english: 'The work is finished', language: 'Sinhala', key_points: 'Work reported finished.' }; },
    summarize: () => ({})
  };
  const app = makeApp({ ai }); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Voice test', assigneeIds: [s.users.wk1.id] }).task;
  const audio = Buffer.from('fake-audio-bytes').toString('base64');
  app.err('postVoice', s.tok.wk1, { taskId: t.id, audioB64: '', mime: 'audio/webm' }, 'VALIDATION');
  app.err('postVoice', s.tok.wk1, { taskId: t.id, audioB64: audio, mime: 'text/html' }, 'VALIDATION');
  const ok = app.ok('postVoice', s.tok.wk1, { taskId: t.id, audioB64: audio, wavB64: audio, mime: 'audio/webm;codecs=opus', secs: 12.4 });
  assert.equal(ok.message.status, 'ok'); assert.equal(ok.message.audioSecs, 12);
  // the chat shows audio only: what the AI understood is never sent to the browser
  assert.equal(ok.message.transcript, undefined); assert.equal(ok.message.translation, undefined); assert.equal(ok.message.text, '');
  assert.equal(JSON.stringify(app.ok('getTask', s.tok.mgr, { taskId: t.id })).includes('The work is finished'), false);
  assert.equal(JSON.stringify(app.ok('listTasks', s.tok.mgr, {})).includes('The work is finished'), false);
  failing = true;
  const bad = app.ok('postVoice', s.tok.wk1, { taskId: t.id, audioB64: audio, wavB64: audio, mime: 'audio/webm', secs: 5 });
  assert.equal(bad.message.status, 'failed'); assert.equal(bad.transcribeFailed, true); assert.equal(bad.message.hasAudio, true);
  // audio can be played back by participants only
  assert.equal(app.ok('getAudio', s.tok.mgr, { messageId: bad.message.id }).b64, audio);
  app.err('getAudio', s.tok.wk2, { messageId: bad.message.id }, 'NOT_FOUND');
  app.err('getAudio', s.tok.ceo, { messageId: bad.message.id }, 'NOT_FOUND');
  // transcripts are included in the conversation view
  const msgs = app.ok('getTask', s.tok.mgr, { taskId: t.id }).messages.filter(m => m.type === 'voice');
  assert.equal(msgs.length, 2);
  // after archiving, audio is still reachable through the archive
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  assert.equal(app.ok('getAudio', s.tok.wk1, { archived: true, taskId: t.id, messageId: ok.message.id }).b64, audio);
  app.err('getAudio', s.tok.ceo, { archived: true, taskId: t.id, messageId: ok.message.id }, 'NOT_FOUND');
});

test('AI summary: cached until new messages arrive; failures are reported cleanly', () => {
  let calls = 0, failing = false, lastInput = null;
  const ai = { transcribe: () => ({}), summarize: (input) => { calls++; lastInput = input; if (failing) throw new Error('boom'); return { summary_en: 'Going well', health: 'on_track', blockers: ['x'], next_steps: ['y'], progress_note: 'half' }; } };
  const app = makeApp({ ai }); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Sum', assigneeIds: [s.users.wk1.id] }).task;
  assert.equal(app.ok('refreshSummary', s.tok.mgr, { taskId: t.id }).summary, null);   // nothing to summarize yet
  assert.equal(calls, 0);
  app.tick(1000); app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'Started' });
  assert.equal(app.ok('getTask', s.tok.mgr, { taskId: t.id }).task.summaryStale, true);
  assert.equal(app.ok('refreshSummary', s.tok.mgr, { taskId: t.id }).summary.summary_en, 'Going well');
  assert.equal(lastInput.messages.filter(m => m.role === 'assignee').length, 1);
  assert.equal(lastInput.task.manager, 'MGR');
  assert.equal(app.ok('getTask', s.tok.mgr, { taskId: t.id }).task.summaryStale, false);
  app.ok('refreshSummary', s.tok.mgr, { taskId: t.id });
  assert.equal(calls, 1);                                                               // cached, no second AI call
  app.tick(1000); app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'More' });
  failing = true;
  app.err('refreshSummary', s.tok.mgr, { taskId: t.id }, 'AI_FAILED');
  assert.equal(app.ok('getTask', s.tok.mgr, { taskId: t.id }).task.summary.summary_en, 'Going well'); // old summary kept
});

test('archive html escapes user content', () => {
  const app = makeApp(); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: '<img src=x onerror=alert(1)>', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: '<script>alert(1)</script>' });
  const html = app.core._renderArchiveHtml(JSON.parse(JSON.stringify({
    task: { title: '<b>x</b>', creator: { name: 'A&B' }, assignees: [{ name: 'W' }], startedText: 's', completedText: 'c', progress: 100, description: '<i>d</i>' },
    messages: [{ type: 'text', text: '<script>alert(1)</script>', senderName: '<u>n</u>', time: 't' }]
  })));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<b>x</b>')); assert.ok(html.includes('&lt;script&gt;'));
});

test('maintenance removes expired sessions', () => {
  const app = makeApp(); seed(app);
  const before = app.env.store.all('Sessions').length;
  app.tick(30 * 86400000);
  const r = app.core.maintenance();
  assert.equal(r.expiredSessions, before);
});

/* ------------------------------ profiles ------------------------------ */

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test('profiles: save a bio and picture, update only what is sent, remove the picture', () => {
  const app = makeApp(); const s = seed(app);
  const r = app.ok('saveProfile', s.tok.wk1, { bio: 'Field officer, Block C. Ask me about irrigation.', photo: TINY_JPEG }).profile;
  assert.equal(r.hasPhoto, true); assert.ok(r.ver > 0);
  app.tick(1000);
  const r2 = app.ok('saveProfile', s.tok.wk1, { bio: 'New bio' }).profile;      // bio only: the picture stays
  assert.equal(r2.hasPhoto, true); assert.equal(r2.bio, 'New bio'); assert.ok(r2.ver > r.ver);
  app.tick(1000);
  assert.equal(app.ok('saveProfile', s.tok.wk1, { photo: '' }).profile.hasPhoto, false);
  assert.equal(app.env.store.all('Profiles').length, 1);                          // one row per person, updated in place
  app.err('saveProfile', s.tok.wk1, {}, 'VALIDATION');
  app.err('saveProfile', s.tok.wk1, { bio: 'x'.repeat(301) }, 'VALIDATION');
});

test('profiles: only small JPEG data URLs are accepted as a picture (no SVG, no scripts, no huge files)', () => {
  const app = makeApp(); const s = seed(app);
  const bad = ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'javascript:alert(1)', 'https://example.com/a.jpg', 'data:image/jpeg;base64,AAAA"onerror="x',
    'data:text/html;base64,PGI+', 'data:image/jpeg;base64,' + 'A'.repeat(20000)];
  bad.forEach((p) => app.err('saveProfile', s.tok.wk1, { photo: p }, 'VALIDATION'));
  app.err('saveProfile', null, { bio: 'x' }, 'AUTH');
});

test('profiles: you only receive the profiles of people you work with; photos are sent only when changed', () => {
  const app = makeApp(); const s = seed(app);
  ['ceo', 'mgr', 'wk1', 'wk2', 'wk3'].forEach((u) => app.ok('saveProfile', s.tok[u], { bio: 'I am ' + u, photo: TINY_JPEG }));
  const ids = (tok, have) => app.ok('profiles', tok, { have: have || {} }).profiles.map((p) => p.userId).sort();
  const want = (...us) => us.map((u) => s.users[u].id).sort();
  assert.deepEqual(ids(s.tok.wk1), want('wk1', 'mgr', 'ceo'));                  // yourself + the people who can assign to you
  assert.deepEqual(ids(s.tok.wk3), want('wk3'));                                // no arrows, no tasks: only yourself
  assert.deepEqual(ids(s.tok.mgr), want('mgr', 'ceo', 'wk1', 'wk2'));
  assert.equal(ids(s.A).length, 5);                                             // administrators see everyone
  // a shared open task makes the two people visible to each other
  app.ok('createTask', s.tok.mgr, { title: 'T', assigneeIds: [s.users.wk2.id] });
  assert.ok(ids(s.tok.wk2).includes(s.users.mgr.id));
  // differential: the picture is only included when the browser's version differs
  const first = app.ok('profiles', s.tok.mgr, {}).profiles.find((p) => p.userId === s.users.wk1.id);
  assert.ok(first.photo.startsWith('data:image/jpeg'));
  const again = app.ok('profiles', s.tok.mgr, { have: { [s.users.wk1.id]: first.ver } }).profiles.find((p) => p.userId === s.users.wk1.id);
  assert.equal(again.photo, undefined); assert.equal(again.bio, 'I am wk1'); assert.equal(again.hasPhoto, true);
});

test('profiles: a deactivated user disappears from the list', () => {
  const app = makeApp(); const s = seed(app);
  app.ok('saveProfile', s.tok.wk1, { bio: 'hi' });
  app.ok('adminSaveUser', s.A, { id: s.users.wk1.id, name: 'WK1', username: 'wk1', jobTitleId: s.titles.Worker, active: false });
  assert.ok(!app.ok('profiles', s.tok.mgr, {}).profiles.some((p) => p.userId === s.users.wk1.id));
});
