// A task the background job cannot file must never be hidden: people see "needs attention", the administrator sees why and can try again,
// save what remains in Drive (with the reason written into the zip) or delete it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

const HOUR = 3600000, DAY = 24 * HOUR;

function makeApp() {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const env = createMemoryEnv({ now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: '3' }, archiveAtNight: true });
  const core = createCore(env);
  const app = {
    env, core, tick: (ms) => { clock += ms; },
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
// a task with a conversation and two documents, approved (so it is closed and waits for the background job)
function closedTask(app, s, title) {
  const t = app.ok('createTask', s.tok.mgr, { title: title || 'Roof', assigneeIds: [s.users.wk1.id], dueDate: '2026-11-20' }).task;
  app.tick(60000); app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'Started' });
  app.tick(60000); app.ok('postFile', s.tok.wk1, { taskId: t.id, name: 'Plan.pdf', b64: pdf(1) });
  app.tick(60000); app.ok('postFile', s.tok.wk1, { taskId: t.id, name: 'Photo.pdf', b64: pdf(2) });
  app.tick(60000); app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 100 });
  app.tick(60000); app.ok('approveTask', s.tok.mgr, { taskId: t.id });
  return t;
}
// the normal filing fails for as long as `state.down` is set (and, if `state.missing`, whenever a stored file is gone)
function breakDrive(app, state) {
  const real = app.env.archive.saveZip;
  app.env.archive.saveZip = (o) => {
    if (state.down) throw new Error(state.down);
    (o.moves || []).forEach((mv) => { if (!app.env._files[mv.id]) throw new Error('File not found: ' + mv.id); });
    return real(o);
  };
  return real;
}
const failRuns = (app, n) => { for (let i = 0; i < n; i++) { app.tick(HOUR); app.core.archiveWaiting(); } };
const taskRow = (app, id) => app.env.store.all('Tasks').filter((x) => x.id === id)[0];

test('one or two failures are only "waiting"; the third makes the task need attention, for the people on it and for the admin, with the reason', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  breakDrive(app, { down: 'Drive is full' });
  failRuns(app, 2);
  assert.equal(app.ok('listHistory', s.tok.wk1, {}).attention, 0);
  assert.equal(app.ok('adminStuckList', s.A, {}).tasks.length, 0);
  failRuns(app, 1);
  const row = taskRow(app, t.id);
  assert.equal(row.archiveFails, 3); assert.match(row.archiveError, /Drive is full/);
  for (const who of ['wk1', 'mgr']) {                                                       // the people on the task
    const h = app.ok('listHistory', s.tok[who], {});
    assert.equal(h.attention, 1); assert.equal(h.items[0].stuck, true); assert.equal(h.items[0].waiting, true);
    const d = app.ok('getArchived', s.tok[who], { taskId: t.id });
    assert.equal(d.archive.stuck, true); assert.match(d.archive.problem, /Drive is full/); assert.equal(d.archive.fails, 3);
  }
  assert.equal(app.ok('listTasks', s.tok.mgr, {}).attention, 1);
  assert.equal(app.ok('listTasks', s.tok.wk2, {}).attention, 0);                             // not their task
  assert.equal(app.ok('listHistory', s.tok.wk2, {}).attention, 0);
  assert.equal(app.ok('me', s.A, {}).stuckAdmin, 1); assert.equal(app.ok('me', s.tok.mgr, {}).stuckAdmin, 0);
  const l = app.ok('adminStuckList', s.A, {});
  assert.equal(l.tasks.length, 1);
  assert.deepEqual(Object.assign({}, l.tasks[0], { closedAt: 0, lastFailedAt: 0 }), { id: t.id, title: 'Roof', creatorName: 'MGR', assigneeNames: 'WK1', closedAt: 0, fails: 3, lastFailedAt: 0, reason: 'Drive is full', messageCount: 3, fileCount: 2 });
  assert.ok(!JSON.stringify(l).includes('Started'), 'the administrator sees that it exists and why it is stuck, not the conversation');
  app.err('adminStuckList', s.tok.mgr, {}, 'FORBIDDEN');
  assert.equal(app.env.store.all('AuditLog').filter((a) => a.action === 'task.archive.failed').length, 2);   // attempt 1 and attempt 3 are logged, not every one
});

test('a task waiting for more than a day needs attention even if no attempt ever failed (the job may be switched off)', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  app.tick(23 * HOUR); assert.equal(app.ok('listHistory', s.tok.mgr, {}).attention, 0);
  app.tick(2 * HOUR);
  assert.equal(app.ok('listHistory', s.tok.mgr, {}).attention, 1);
  assert.match(app.ok('getArchived', s.tok.mgr, { taskId: t.id }).archive.problem, /not filed it for more than a day/);
  assert.equal(app.ok('adminStuckList', s.A, {}).tasks.length, 1);
});

test('a busy app is not a failure of the task', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  const real = app.env.archive.saveZip;
  app.env.archive.saveZip = () => { const e = new Error('The system is busy.'); e.code = 'BUSY'; throw e; };
  failRuns(app, 5);
  assert.equal(Number(taskRow(app, t.id).archiveFails) || 0, 0);
  app.env.archive.saveZip = real; app.tick(HOUR);
  assert.equal(app.core.archiveWaiting().archived, 1);
});

test('"Try again now": still failing shows the reason and counts; once fixed it files the task normally', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s), state = { down: 'Drive is full' };
  breakDrive(app, state); failRuns(app, 3);
  const r1 = app.ok('adminStuckRetry', s.A, { taskId: t.id });
  assert.equal(r1.archived, false); assert.match(r1.error, /Drive is full/); assert.equal(taskRow(app, t.id).archiveFails, 4);
  app.err('adminStuckRetry', s.tok.mgr, { taskId: t.id }, 'FORBIDDEN');
  state.down = '';
  const r2 = app.ok('adminStuckRetry', s.A, { taskId: t.id });
  assert.deepEqual(r2, { archived: true, archiveCode: 'EPP-0001' });
  assert.equal(app.ok('adminStuckList', s.A, {}).tasks.length, 0); assert.equal(app.ok('listHistory', s.tok.mgr, {}).attention, 0);
  const d = app.ok('getArchived', s.tok.mgr, { taskId: t.id });
  assert.equal(d.archive.waiting, false); assert.equal(d.archive.note, '');
  app.err('adminStuckRetry', s.A, { taskId: t.id }, 'NOT_FOUND');                           // already filed: nothing to retry
});

test('SAVE WHAT REMAINS: a document that is gone from Drive is listed as missing, everything else is in the zip, and the reason is written down', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  breakDrive(app, {});
  const gone = app.env.store.all('Attachments').filter((a) => a.name === 'Plan.pdf')[0].fileId;
  delete app.env._files[gone];                                                              // someone deleted it from Drive for good
  failRuns(app, 3);
  assert.match(taskRow(app, t.id).archiveError, /File not found/);
  const r = app.ok('adminStuckSalvage', s.A, { taskId: t.id });
  assert.equal(r.archived, true); assert.equal(r.archiveCode, 'EPP-0001'); assert.match(r.note, /Saved with problems.*File not found.*Plan\.pdf/);
  const idx = app.env.store.all('ArchiveIndex')[0];
  assert.equal(idx.note, r.note);
  const zip = app.env._folders[idx.path];
  assert.match(zip.files['Summary.txt'], /^TASK ARCHIVE EPP-0001[\s\S]*!! SAVED WITH PROBLEMS !![\s\S]*File not found[\s\S]*NOT SAVED[\s\S]*Plan\.pdf/);
  assert.match(zip.files['Summary.txt'], /Plan\.pdf \(1 KB\) - NOT SAVED/);
  assert.ok(/Plan\.pdf - NOT SAVED/.test(zip.files['Conversation.txt']) && /Started/.test(zip.files['Conversation.txt']));
  assert.equal(zip.moved.length, 1); assert.match(zip.moved[0].name, /Photo\.pdf$/);          // the other document is in the zip
  assert.equal(app.env.store.all('Tasks').length, 0); assert.equal(app.env.store.all('Messages').length, 0); assert.equal(app.env.store.all('Attachments').length, 0);
  assert.ok(app.env.store.all('AuditLog').some((a) => a.action === 'task.archive.salvaged' && /Plan\.pdf/.test(a.detail)));
  assert.match(app.env._history.rows[0][10], /^\[Saved with problems/);                       // the full history sheet says so too
  for (const who of ['mgr', 'wk1']) {
    assert.match(app.ok('getArchived', s.tok[who], { taskId: t.id }).archive.note, /Saved with problems/);
    assert.match(app.ok('listHistory', s.tok[who], {}).items[0].note, /Saved with problems/);
  }
  assert.equal(app.ok('adminStuckList', s.A, {}).tasks.length, 0);
});

test('SAVE WHAT REMAINS when even the zip cannot hold the documents: they stay in Drive (not trashed) with links, and the zip keeps the conversation', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  const real = app.env.archive.saveZip;
  app.env.archive.saveZip = (o) => { if ((o.moves || []).length) throw new Error('zip check failed: Photo.pdf differs'); return real(o); };
  failRuns(app, 3);
  const before = Object.keys(app.env._files).length;
  const r = app.ok('adminStuckSalvage', s.A, { taskId: t.id });
  assert.match(r.note, /2 document\(s\) are kept in Google Drive outside the zip/);
  const zip = app.env._folders[app.env.store.all('ArchiveIndex')[0].path];
  assert.match(zip.files['Summary.txt'], /Why the documents are not in this zip: zip check failed/);
  assert.match(zip.files['Summary.txt'], /KEPT IN GOOGLE DRIVE, NOT IN THIS ZIP[\s\S]*Plan\.pdf: https:\/\/drive\.google\.com\/file\/d\/F[0-9a-f]+\/view[\s\S]*Photo\.pdf: https:\/\/drive\.google\.com\/file\/d\//);
  assert.match(zip.files['Conversation.txt'], /Plan\.pdf - kept in Google Drive outside this zip/);
  assert.deepEqual(zip.moved, []); assert.deepEqual(zip.trashed, []);
  assert.equal(Object.keys(app.env._files).length, before, 'no document was trashed');
  assert.equal(app.env.store.all('Tasks').length, 0);
});

test('if even the simplest way of saving fails, nothing is changed and the task stays on the list', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s);
  breakDrive(app, { down: 'Google Drive is not reachable' }); failRuns(app, 3);
  const counts = [app.env.store.all('Messages').length, app.env.store.all('Attachments').length];
  const r = app.err('adminStuckSalvage', s.A, { taskId: t.id }, 'VALIDATION');
  assert.match(r.error, /Even the simplest way of saving did not work: Google Drive is not reachable/);
  assert.equal(taskRow(app, t.id).archiveFails, 4);
  assert.deepEqual([app.env.store.all('Messages').length, app.env.store.all('Attachments').length], counts); assert.equal(app.env.store.all('ArchiveIndex').length, 0);
  assert.equal(app.ok('adminStuckList', s.A, {}).tasks.length, 1);
});

test('DELETE: needs the word DELETE, only for a stuck task and only the administrator; rows leave the app, files go to the trash, the log says what was deleted', () => {
  const app = makeApp(), s = seed(app), t = closedTask(app, s), t2 = closedTask(app, s, 'Gate');
  breakDrive(app, { down: 'Drive is full' });
  app.tick(25 * HOUR); app.core.archiveWaiting();                                           // both are older than a day now
  app.ok('adminStuckList', s.A, {});
  app.err('adminStuckDelete', s.tok.mgr, { taskId: t.id, confirm: 'DELETE' }, 'FORBIDDEN');
  app.err('adminStuckDelete', s.A, { taskId: t.id }, 'VALIDATION');
  app.err('adminStuckDelete', s.A, { taskId: t.id, confirm: 'yes' }, 'VALIDATION');
  assert.equal(app.env.store.all('Tasks').length, 2);
  const fileIds = app.env.store.all('Attachments').filter((a) => a.taskId === t.id).map((a) => a.fileId);
  const r = app.ok('adminStuckDelete', s.A, { taskId: t.id, confirm: 'DELETE' });
  assert.deepEqual(r, { deleted: true, title: 'Roof', messages: 3, files: 2, trashed: 2 });
  assert.deepEqual(app.env.store.all('Tasks').map((x) => x.id), [t2.id]);                   // the other one is untouched
  assert.ok(app.env.store.all('Messages').every((m) => m.taskId === t2.id));
  fileIds.forEach((id) => assert.equal(app.env._files[id], undefined));
  assert.ok(app.env.store.all('AuditLog').some((a) => a.action === 'task.archive.deleted' && /Roof.*3 messages, 2 files.*Drive is full/.test(a.detail)));
  assert.equal(app.ok('listHistory', s.tok.mgr, {}).total, 1);
  app.err('adminStuckDelete', s.A, { taskId: t.id, confirm: 'DELETE' }, 'NOT_FOUND');
  // a task that is only waiting (not stuck) cannot be deleted this way
  const t3 = closedTask(app, s, 'Fresh');
  app.err('adminStuckDelete', s.A, { taskId: t3.id, confirm: 'DELETE' }, 'NOT_FOUND');
  app.err('adminStuckSalvage', s.A, { taskId: t3.id }, 'NOT_FOUND');
});
