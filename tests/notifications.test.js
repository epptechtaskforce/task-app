// Push notifications: who is told what, when; settings; devices; and that telling people never breaks what they did.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

const HOUR = 3600000, DAY = 24 * HOUR;

function makeApp(opts) {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const env = createMemoryEnv(Object.assign({ now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: '3', VAPID_PUBLIC_KEY: 'PUBLICKEY' }, archiveAtNight: true }, opts || {}));
  const core = createCore(env);
  const app = {
    env, core, tick: (ms) => { clock += ms; },
    call(action, token, params) { return core.handle(Object.assign({ action, token }, params || {})); },
    ok(action, token, params) { const r = app.call(action, token, params); assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r)); return r.data; },
    err(action, token, params, code) { const r = app.call(action, token, params); assert.equal(r.ok, false, action + ' should have failed'); if (code) assert.equal(r.code, code, action + ' wrong code: ' + JSON.stringify(r)); return r; },
    pushes() { return app.env._pushes; }, clear() { app.env._pushes.length = 0; }
  };
  core.setup({ companyName: 'Acme Ltd', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  return app;
}
function seed(app) {
  const admin = app.ok('login', null, { username: 'admin', password: 'Admin-pass-1' });
  app.ok('changePassword', admin.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = app.ok('login', null, { username: 'admin', password: 'Admin-pass-2' }).token;
  const titles = {};
  [['CEO', 1], ['Manager', 2], ['Worker', 3]].forEach(([t, l]) => { titles[t] = app.ok('adminSaveJobTitle', A, { title: t, level: l }).id; });
  const users = {};
  [['mgr', 'Manager'], ['wk1', 'Worker'], ['wk2', 'Worker']].forEach(([u, t]) => { const r = app.ok('adminSaveUser', A, { name: u.toUpperCase(), username: u, jobTitleId: titles[t] }); users[u] = { id: r.user.id, temp: r.tempPassword }; });
  app.ok('adminSaveLinks', A, { links: [['mgr', 'wk1'], ['mgr', 'wk2']].map(([f, t]) => ({ fromId: users[f].id, toId: users[t].id })), note: 'v1' });
  const tok = {};
  for (const u of Object.keys(users)) {
    const l = app.ok('login', null, { username: u, password: users[u].temp });
    app.ok('changePassword', l.token, { oldPassword: users[u].temp, newPassword: 'Changed-' + u + '-1' });
    tok[u] = app.ok('login', null, { username: u, password: 'Changed-' + u + '-1' }).token;
  }
  return { A, users, tok, titles };
}
// a device's subscription as a browser would give it
function device(n) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/device' + (n || 1) + 'x'.repeat(40), p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url'), label: 'Android phone' };
}
// everybody gets one phone
function allPhones(app, s) { const d = {}; for (const u of ['mgr', 'wk1', 'wk2']) { d[u] = device(u === 'mgr' ? 1 : u === 'wk1' ? 2 : 3); app.ok('pushSubscribe', s.tok[u], d[u]); } return d; }
const to = (app, name) => app.pushes().filter((p) => p.userId === name);

test('devices: only real push services are accepted, keys are checked, the same phone moves to whoever signs in, the oldest devices make room', () => {
  const app = makeApp(), s = seed(app), d = device(1);
  app.err('pushSubscribe', s.tok.wk1, Object.assign({}, d, { endpoint: 'https://evil.example.com/fcm/send/abc' }), 'VALIDATION');           // the server would otherwise call any address
  app.err('pushSubscribe', s.tok.wk1, Object.assign({}, d, { endpoint: 'http://fcm.googleapis.com/fcm/send/abc' }), 'VALIDATION');
  app.err('pushSubscribe', s.tok.wk1, Object.assign({}, d, { p256dh: 'short' }), 'VALIDATION');
  app.err('pushSubscribe', s.tok.wk1, Object.assign({}, d, { auth: '!!' }), 'VALIDATION');
  for (const ok of ['https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QabC', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) app.ok('pushSubscribe', s.tok.wk1, Object.assign(device(9), { endpoint: ok }));
  app.ok('pushUnsubscribe', s.tok.wk1, { endpoint: 'https://web.push.apple.com/QabC' });
  app.ok('pushSubscribe', s.tok.wk1, d);
  assert.equal(app.ok('pushStatus', s.tok.wk1, {}).devices.length, 3);
  assert.equal(app.ok('pushStatus', s.tok.wk2, {}).devices.length, 0, 'devices are private to their owner');
  assert.equal(app.ok('pushStatus', s.tok.wk1, {}).key, 'PUBLICKEY'); assert.equal(app.ok('me', s.tok.wk1, {}).pushKey, 'PUBLICKEY');
  app.ok('pushSubscribe', s.tok.wk2, d);                                                                       // the same phone, now signed in as wk2
  assert.equal(app.ok('pushStatus', s.tok.wk1, {}).devices.length, 2); assert.equal(app.ok('pushStatus', s.tok.wk2, {}).devices.length, 1);
  for (let i = 0; i < 8; i++) { app.tick(1000); app.ok('pushSubscribe', s.tok.mgr, device(100 + i)); }
  assert.equal(app.ok('pushStatus', s.tok.mgr, {}).devices.length, 6);                                          // at most 6 per person
  app.ok('pushUnsubscribe', s.tok.wk1, { endpoint: d.endpoint });                                               // not wk1's any more: nothing happens
  assert.equal(app.ok('pushStatus', s.tok.wk2, {}).devices.length, 1);
});

test('a new task tells the people it is given to (not the person who gave it), with the way to open it', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s); app.clear();
  const t = app.ok('createTask', s.tok.mgr, { title: 'Plan the harvest', assigneeIds: [s.users.wk1.id, s.users.wk2.id], dueDate: '2026-11-13' }).task;
  assert.deepEqual(app.pushes().map((p) => p.userId).sort(), [s.users.wk1.id, s.users.wk2.id].sort());
  const p = to(app, s.users.wk1.id)[0].payload;
  assert.equal(p.t, 'MGR gave you a task'); assert.equal(p.b, 'Plan the harvest · due tomorrow'); assert.equal(p.u, '#/task/' + t.id); assert.equal(p.g, 'task:' + t.id); assert.equal(p.c, 'tasks'); assert.equal(p.a, 'Open task');
  assert.ok(JSON.stringify(p).length < 600, 'small enough to travel');
});

test('messages tell everyone else on the task, with the sender and the task in the title and the words in the text; voice and files read clearly', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Roof', assigneeIds: [s.users.wk1.id, s.users.wk2.id] }).task; app.clear();
  app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'The tiles arrived this morning' });
  assert.deepEqual(app.pushes().map((p) => p.userId).sort(), [s.users.mgr.id, s.users.wk2.id].sort());                    // not wk1, who wrote it
  const p = to(app, s.users.mgr.id)[0].payload;
  assert.equal(p.t, 'WK1 · Roof'); assert.equal(p.b, 'The tiles arrived this morning'); assert.equal(p.u, '#/task/' + t.id); assert.equal(p.g, 'chat:' + t.id); assert.equal(p.c, 'messages');
  app.clear();
  app.ok('postFile', s.tok.wk2, { taskId: t.id, name: 'Plan.pdf', caption: 'the new plan', b64: Buffer.from('%PDF-1.4 x').toString('base64') });
  assert.equal(to(app, s.users.mgr.id)[0].payload.b, '📎 Plan.pdf - the new plan');
  app.clear();
  app.ok('postVoice', s.tok.wk1, { taskId: t.id, audioB64: Buffer.from('audio').toString('base64'), mime: 'audio/webm', secs: 3 });
  assert.equal(to(app, s.users.mgr.id)[0].payload.b, '🎤 Voice message');
});

test('finishing, approving, sending back and changing a task tell the right people', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Gate', assigneeIds: [s.users.wk1.id], dueDate: '2026-11-20' }).task; app.clear();
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 50 });
  assert.equal(app.pushes().length, 0, 'progress on the way is not worth an alert');
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  assert.deepEqual(app.pushes().map((p) => [p.userId, p.payload.t, p.payload.b, p.payload.a]), [[s.users.mgr.id, 'WK1 finished a task', 'Gate · waiting for your approval', 'Review']]);
  app.clear();
  app.ok('rejectTask', s.tok.mgr, { taskId: t.id, note: 'Add the lock' });
  assert.deepEqual(app.pushes().map((p) => [p.userId, p.payload.t, p.payload.b]), [[s.users.wk1.id, 'MGR sent a task back', 'Gate · Add the lock']]);
  app.clear();
  app.ok('updateTask', s.tok.mgr, { taskId: t.id, dueDate: '2026-11-25' });
  assert.deepEqual(app.pushes().map((p) => [p.userId, p.payload.t, p.payload.b]), [[s.users.wk1.id, 'MGR updated a task', 'Gate · changed the due date to 2026-11-25']]);
  app.clear();
  app.ok('updateTask', s.tok.mgr, { taskId: t.id, dueDate: '2026-11-25' });
  assert.equal(app.pushes().length, 0, 'nothing changed, nothing to say');
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 }); app.clear();
  app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  assert.deepEqual(app.pushes().map((p) => [p.userId, p.payload.t, p.payload.b, p.payload.u]), [[s.users.wk1.id, 'Approved ✓', 'MGR approved "Gate"', '#/history/' + t.id]]);
});

test('settings: a category can be switched off; quiet hours keep the alert but without sound; the test button ignores both', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Roof', assigneeIds: [s.users.wk1.id] }).task;
  assert.deepEqual(app.ok('pushStatus', s.tok.wk1, {}).prefs, { messages: true, tasks: true, reminders: true, quiet: false });
  app.ok('pushPrefs', s.tok.wk1, { messages: false }); app.clear();
  app.ok('postMessage', s.tok.mgr, { taskId: t.id, text: 'Hello' });
  assert.equal(to(app, s.users.wk1.id).length, 0, 'messages are off for wk1');
  app.ok('createTask', s.tok.mgr, { title: 'Second', assigneeIds: [s.users.wk1.id] });
  assert.equal(to(app, s.users.wk1.id).length, 1, 'new tasks still arrive');
  assert.equal(app.ok('pushStatus', s.tok.wk1, {}).prefs.tasks, true);
  app.ok('pushPrefs', s.tok.wk1, { messages: true, quiet: true }); app.clear();
  while (app.env.formatDate(app.env.now()).slice(11, 13) !== '22') app.tick(HOUR);                              // 22:00 company time
  app.ok('postMessage', s.tok.mgr, { taskId: t.id, text: 'Late one' });
  assert.equal(to(app, s.users.wk1.id)[0].silent, true, 'delivered, but silent');
  app.tick(12 * HOUR); app.clear();
  app.ok('postMessage', s.tok.mgr, { taskId: t.id, text: 'Daytime' });
  assert.equal(app.env.formatDate(app.env.now()).slice(11, 13), '10');
  assert.equal(to(app, s.users.wk1.id)[0].silent, false);
  app.ok('pushPrefs', s.tok.wk1, { messages: false, tasks: false, reminders: false, quiet: true }); app.clear();
  const r = app.ok('pushTest', s.tok.wk1, {});
  assert.deepEqual([r.sent, r.failed, r.devices], [1, 0, 1]);
  assert.equal(app.pushes()[0].payload.t, 'Notifications are working ✓'); assert.equal(app.pushes()[0].silent, false);
});

test('the test button: tells the truth when nothing is registered or when delivery fails', () => {
  const app = makeApp(), s = seed(app);
  app.err('pushTest', s.tok.wk1, {}, 'VALIDATION');
  app.ok('pushSubscribe', s.tok.wk1, device(1));
  const bad = makeApp({ failPush: 'push service said 403' }), s2 = seed(bad); bad.ok('pushSubscribe', s2.tok.wk1, device(1));
  const r = bad.ok('pushTest', s2.tok.wk1, {});
  assert.deepEqual([r.sent, r.failed], [0, 1]); assert.match(r.errors[0], /403/);
});

test('telling people never breaks what they did: even a broken delivery leaves the message sent', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Roof', assigneeIds: [s.users.wk1.id] }).task;
  app.env.notify = () => { throw new Error('push service is down'); };
  const m = app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'Still delivered' });
  assert.equal(m.message.text, 'Still delivered');
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  app.ok('approveTask', s.tok.mgr, { taskId: t.id });
});

test('a deactivated person or a reset password stops getting alerts on their devices', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  app.ok('adminSaveUser', s.A, { id: s.users.wk1.id, name: 'WK1', username: 'wk1', jobTitleId: s.titles.Worker, active: false });
  assert.equal(app.env.store.all('PushSubs').filter((r) => r.userId === s.users.wk1.id).length, 0);
  app.ok('adminResetPassword', s.A, { userId: s.users.wk2.id });
  assert.equal(app.env.store.all('PushSubs').filter((r) => r.userId === s.users.wk2.id).length, 0);
  assert.equal(app.env.store.all('PushSubs').filter((r) => r.userId === s.users.mgr.id).length, 1);
});

test('the morning message: what is late, due today and waiting for approval; nothing when there is nothing to say', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s);
  assert.deepEqual(app.core.dailyDigest(), { told: 0 }); assert.equal(app.pushes().length, 0);
  const today = app.env.formatDate(app.env.now()).slice(0, 10);
  const yesterday = app.env.formatDate(app.env.now() - DAY).slice(0, 10);
  app.ok('createTask', s.tok.mgr, { title: 'Late one', assigneeIds: [s.users.wk1.id], dueDate: yesterday });
  app.ok('createTask', s.tok.mgr, { title: 'Today one', assigneeIds: [s.users.wk1.id], dueDate: today });
  const done = app.ok('createTask', s.tok.mgr, { title: 'Done one', assigneeIds: [s.users.wk2.id] }).task;
  app.ok('setProgress', s.tok.wk2, { taskId: done.id, progress: 100 }); app.clear();
  assert.deepEqual(app.core.dailyDigest(), { told: 2 });
  assert.deepEqual(to(app, s.users.wk1.id).map((p) => [p.payload.t, p.payload.b, p.payload.c, p.payload.u]), [['Good morning, WK1', '1 late · 1 due today', 'reminders', '#/tasks']]);
  assert.equal(to(app, s.users.mgr.id)[0].payload.b, '1 waiting for your approval');
  assert.equal(to(app, s.users.wk2.id).length, 0, 'wk2 only has a task waiting for approval by someone else');
  app.ok('pushPrefs', s.tok.wk1, { reminders: false }); app.clear();
  assert.deepEqual(app.core.dailyDigest(), { told: 1 });
});

test('a task that cannot be saved to Drive tells the people on it and the admin once, when it needs attention', () => {
  const app = makeApp(), s = seed(app); allPhones(app, s); app.ok('pushSubscribe', s.A, device(7));
  const t = app.ok('createTask', s.tok.mgr, { title: 'Roof', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 }); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  app.env.archive.saveZip = () => { throw new Error('Drive is full'); }; app.clear();
  for (let i = 0; i < 2; i++) { app.tick(HOUR); app.core.archiveWaiting(); }
  assert.equal(app.pushes().length, 0, 'two failures are not yet a problem');
  app.tick(HOUR); app.core.archiveWaiting();
  const got = app.pushes().map((p) => [p.userId === s.users.mgr.id ? 'mgr' : p.userId === s.users.wk1.id ? 'wk1' : 'admin', p.payload.u]).sort();
  assert.deepEqual(got, [['admin', '#/admin/drive'], ['mgr', '#/history/' + t.id], ['wk1', '#/history/' + t.id]]);
  app.clear(); app.tick(HOUR); app.core.archiveWaiting();
  assert.equal(app.pushes().length, 0, 'not again on the next failure');
});
