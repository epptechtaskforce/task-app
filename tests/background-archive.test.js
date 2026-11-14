// Approving a task only closes it; a background job files it in Google Drive without holding anyone up, and nothing is ever lost on the way.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

const HOUR = 3600000, DAY = 24 * HOUR;

function makeApp(opts) {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0), lockDepth = 0;
  const env = createMemoryEnv(Object.assign({
    now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: '3' }, archiveAtNight: true,
    lock: (fn) => { lockDepth++; try { return fn(); } finally { lockDepth--; } }          // so a test can see whether the write lock is held
  }, opts || {}));
  const core = createCore(env);
  const app = {
    env, core, lockDepth: () => lockDepth,
    tick: (ms) => { clock += ms; },
    call(action, token, params) { return core.handle(Object.assign({ action, token }, params || {})); },
    ok(action, token, params) { const r = app.call(action, token, params); assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r)); return r.data; },
    err(action, token, params, code) { const r = app.call(action, token, params); assert.equal(r.ok, false, action + ' should have failed'); if (code) assert.equal(r.code, code, action + ' wrong code: ' + JSON.stringify(r)); return r; }
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
  return { A, users, tok };
}
const pdf = (n) => Buffer.from('%PDF-1.4 document ' + n).toString('base64');
// a finished task (100%, waiting for approval) with some conversation
function pending(app, s, title) {
  const t = app.ok('createTask', s.tok.mgr, { title: title || 'Roof', assigneeIds: [s.users.wk1.id], dueDate: '2026-11-20' }).task;
  app.tick(60000); app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'Started' });
  app.tick(60000); app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  return t;
}
const taskRows = (app) => app.env.store.all('Tasks'), msgRows = (app) => app.env.store.all('Messages'), attRows = (app) => app.env.store.all('Attachments');

test('approving only closes the task: it leaves the task list, shows in History as being filed, and nothing is in Drive yet', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s);
  app.tick(60000);
  const r = app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  assert.deepEqual(r, { closed: true, archived: false, id: t.id, archiveCode: '' });
  assert.equal(app.lockDepth(), 0);
  assert.equal(app.ok('listTasks', s.tok.mgr, {}).tasks.length, 0);                        // no longer an open task for anybody
  assert.equal(app.ok('listTasks', s.tok.wk1, {}).tasks.length, 0);
  app.err('postMessage', s.tok.wk1, { taskId: t.id, text: 'one more thing' }, 'VALIDATION');   // and nobody can add to it
  const h = app.ok('listHistory', s.tok.wk1, {});
  assert.equal(h.total, 1); assert.equal(h.items[0].waiting, true); assert.equal(h.items[0].archiveCode, ''); assert.equal(h.items[0].title, 'Roof');
  assert.equal(app.ok('listHistory', s.tok.wk2, {}).total, 0);                             // only the people of the task
  assert.equal(app.ok('listHistory', s.tok.mgr, { role: 'byme' }).total, 1);
  const d = app.ok('getArchived', s.tok.mgr, { taskId: t.id });
  assert.equal(d.detailsOnly, true); assert.equal(d.archive.waiting, true); assert.equal(d.archive.canOpen, false); assert.equal(d.archive.fileUrl, ''); assert.equal(d.archive.person, 'MGR');
  app.err('getArchived', s.tok.wk2, { taskId: t.id }, 'NOT_FOUND');
  assert.deepEqual(Object.keys(app.env._folders), []);                                       // nothing in Drive yet
  assert.ok(msgRows(app).length >= 2);                                                         // the conversation is still all here
});

test('the background job files it: zip in Drive, History row with its ID, live rows gone, the completed date is the day of approval', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s);
  app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  app.tick(2 * DAY);                                                                           // the job runs two days later
  assert.deepEqual(app.core.archiveWaiting(), { archived: 1, skipped: 0, failed: 0, left: 0 });
  const h = app.ok('listHistory', s.tok.wk1, {}).items[0];
  assert.equal(h.archiveCode, 'EPP-0001'); assert.equal(!!h.waiting, false);
  const doc = app.ok('getArchived', s.tok.mgr, { taskId: t.id });
  assert.equal(doc.archive.waiting, false); assert.equal(doc.archive.zipName, 'EPP-0001 - Roof - 2026-11-12.zip');           // the day it was approved
  const zip = app.env._folders[doc.archive.path];
  assert.ok(zip.files['Conversation.txt'].includes('Started') && zip.files['Summary.txt'].includes('Completed:    2026-11-12'));
  assert.equal(taskRows(app).length, 0); assert.equal(msgRows(app).length, 0);
  assert.equal(app.env._history.rows.length, 1);
  assert.deepEqual(app.env.store.all('AuditLog').map((a) => a.action).filter((a) => /^task\.(approve|archive)/.test(a)), ['task.approve', 'task.archive']);
  assert.deepEqual(app.core.archiveWaiting(), { archived: 0, skipped: 0, failed: 0, left: 0 });   // nothing left to do
});

test('NOBODY IS HELD UP: no write lock is held while the zip is made', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s);
  app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  const real = app.env.archive.saveZip; let seen = -1;
  app.env.archive.saveZip = (o) => { seen = app.lockDepth(); return real(o); };
  app.core.archiveWaiting();
  assert.equal(seen, 0, 'the slow part (reading files, zipping, checking) runs without the lock');
});

test('a message that arrives while the zip is made is never lost: the zip is thrown away and the task is filed again with it', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s);
  app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  const real = app.env.archive.saveZip; let once = true;
  app.env.archive.saveZip = (o) => {
    const saved = real(o);
    if (once) { once = false; app.env.store.insert('Messages', { id: 'MLATE', taskId: t.id, senderId: s.users.wk1.id, type: 'text', text: 'late message', transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: Date.now() }); }
    return saved;
  };
  assert.deepEqual(app.core.archiveWaiting(), { archived: 0, skipped: 1, failed: 0, left: 0 });
  assert.deepEqual(Object.keys(app.env._folders), []);                                         // the unused zip was removed
  assert.equal(taskRows(app).length, 1); assert.equal(app.env.store.all('ArchiveIndex').length, 0);   // nothing was deleted
  assert.deepEqual(app.core.archiveWaiting(), { archived: 1, skipped: 0, failed: 0, left: 0 });
  const doc = app.ok('getArchived', s.tok.mgr, { taskId: t.id });
  assert.ok(app.env._folders[doc.archive.path].files['Conversation.txt'].includes('late message'));
  assert.equal(doc.archive.code, 'EPP-0001');
});

test('a failure changes nothing: the task stays visible and waiting, the reason is logged, the next run (after the claim expires) files it with the SAME number', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s), t2 = pending(app, s, 'Gate');
  app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  const real = app.env.archive.saveZip; let fail = true;
  app.env.archive.saveZip = (o) => { if (fail) throw new Error('Drive is down'); return real(o); };
  assert.deepEqual(app.core.archiveWaiting(), { archived: 0, skipped: 0, failed: 1, left: 0 });
  assert.equal(app.ok('listHistory', s.tok.mgr, {}).items[0].waiting, true);
  assert.ok(app.env.store.all('AuditLog').some((a) => a.action === 'task.archive.failed' && /Drive is down/.test(a.detail)));
  fail = false;
  assert.equal(app.core.archiveWaiting().skipped, 1);                                          // claimed a moment ago: left alone for now
  app.tick(16 * 60000);
  assert.equal(app.core.archiveWaiting().archived, 1);
  assert.equal(app.ok('getArchived', s.tok.mgr, { taskId: t.id }).archive.code, 'EPP-0001');
  app.ok('approveTask', s.tok.mgr, { taskId: t2.id }); app.core.archiveWaiting();
  assert.equal(app.ok('getArchived', s.tok.mgr, { taskId: t2.id }).archive.code, 'EPP-0002');   // no gap in the numbers
});

test('the job works through the oldest first and stops when its time is up; the rest is taken next time', () => {
  const app = makeApp(), s = seed(app), ids = [];
  for (const title of ['One', 'Two', 'Three']) { const t = pending(app, s, title); app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id }); ids.push(t.id); }
  let allowed = 1;
  assert.deepEqual(app.core.archiveWaiting({ keepGoing: () => allowed-- > 0 }), { archived: 1, skipped: 0, failed: 0, left: 2 });
  assert.equal(app.ok('getArchived', s.tok.mgr, { taskId: ids[0] }).archive.code, 'EPP-0001');   // the oldest went first
  assert.equal(app.ok('getArchived', s.tok.mgr, { taskId: ids[1] }).archive.waiting, true);
  assert.deepEqual(app.core.archiveWaiting(), { archived: 2, skipped: 0, failed: 0, left: 0 });
});

test('a file or voice message that finishes sending AFTER the task was approved is refused clearly and not stored, so nothing is stored that no archive would pick up', () => {
  const app = makeApp(), s = seed(app), t = pending(app, s);
  const realSave = app.env.files.saveFile; let closeNow = true;
  app.env.files.saveFile = (o) => { const id = realSave(o); if (closeNow) { closeNow = false; app.ok('approveTask', s.tok.mgr, { taskId: t.id }); } return id; };   // the manager approves while the upload is in flight
  const r = app.err('postFile', s.tok.wk1, { taskId: t.id, name: 'Late.pdf', b64: pdf(1) }, 'VALIDATION');
  assert.match(r.error, /closed while your message was being sent/);
  assert.equal(attRows(app).length, 0); assert.equal(Object.keys(app.env._files).length, 0);       // not stored, and the stored copy was removed
  const realAudio = app.env.files.saveAudio, taskTwo = pending(app, s, 'Gate'); let closeTwo = true;
  app.env.files.saveAudio = (o) => { const id = realAudio(o); if (closeTwo) { closeTwo = false; app.ok('approveTask', s.tok.mgr, { taskId: taskTwo.id }); } return id; };
  app.err('postVoice', s.tok.wk1, { taskId: taskTwo.id, audioB64: Buffer.from('audio').toString('base64'), mime: 'audio/webm', secs: 3 }, 'VALIDATION');
  assert.equal(msgRows(app).filter((m) => m.type === 'voice').length, 0); assert.equal(Object.keys(app.env._files).length, 0);
});

test('nothing is left behind: every document, every voice message without words, and a stored document no message points to all end up in the zip', () => {
  const ai = { transcribe: () => { throw new Error('503'); }, summarize: () => ({}) };               // no voice message gets a transcript
  const app = makeApp({ ai }), s = seed(app), t = pending(app, s, 'Everything');
  app.tick(60000);
  app.ok('postFile', s.tok.wk1, { taskId: t.id, name: 'Plan.pdf', b64: pdf(1) });
  app.ok('postFile', s.tok.mgr, { taskId: t.id, name: 'Plan.pdf', b64: pdf(2) });
  app.ok('postVoice', s.tok.wk1, { taskId: t.id, audioB64: Buffer.from('a1').toString('base64'), mime: 'audio/webm', secs: 3 });
  app.ok('postVoice', s.tok.wk1, { taskId: t.id, audioB64: Buffer.from('a2').toString('base64'), mime: 'audio/webm', secs: 3 });
  const strayFile = app.env.files.saveFile({ taskId: t.id, messageId: 'MSTRAY', name: 'Stray.pdf', mime: 'application/pdf', b64: pdf(9) });
  app.env.store.insert('Attachments', { id: 'MSTRAY', taskId: t.id, name: 'Stray.pdf', mime: 'application/pdf', size: 10, fileId: strayFile, thumb: '', w: 0, h: 0, createdAt: Date.now() });
  const stored = Object.keys(app.env._files).length;                                             // 2 documents + 2 recordings + the stray file
  assert.equal(stored, 5);
  app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  app.core.archiveWaiting();
  const doc = app.ok('getArchived', s.tok.mgr, { taskId: t.id }), zip = app.env._folders[doc.archive.path];
  assert.equal(zip.moved.length, 5, zip.moved.map((m) => m.name).join(' | '));                      // every stored file is in the zip
  assert.equal(zip.trashed.length, 5); assert.equal(new Set(zip.moved.map((m) => m.name.toLowerCase())).size, 5);
  assert.ok(zip.moved.some((m) => /not linked to a message - Stray\.pdf$/.test(m.name)));
  assert.ok(zip.files['Summary.txt'].includes('ALSO STORED WITH THIS TASK') && zip.files['Summary.txt'].includes('Stray'));
  assert.equal(zip.files['Conversation.txt'].split('\n').filter((l) => /^\[/.test(l)).length, 1 + 1 + 1 + 2 + 2);   // task created, Started, progress, 2 files, 2 voice messages: every message has its line
  assert.equal(msgRows(app).length, 0); assert.equal(attRows(app).length, 0);
});

test('where there is no background job (the demo, plain tests) approving files the task at once, as before', () => {
  const app = makeApp({ archiveAtNight: false }), s = seed(app), t = pending(app, s);
  const r = app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  assert.equal(r.archived, true); assert.equal(r.archiveCode, 'EPP-0001');
  assert.equal(taskRows(app).length, 0); assert.equal(app.ok('listHistory', s.tok.mgr, {}).items[0].waiting, false);
});
