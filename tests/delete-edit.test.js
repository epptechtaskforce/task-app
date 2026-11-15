'use strict';
// Taking things back: the creator deletes an unfinished task; a sender deletes or edits their own message, voice message, photo or document.
// "Delete" = gone from the whole app as if it never existed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

function boot(night) {
  const ai = { transcribe: () => ({ english: 'The pump is fixed', language: 'English', key_points: 'Pump fixed' }), summarize: () => ({ summary_en: 'Going well', health: 'on_track', blockers: [], next_steps: [], progress_note: 'half' }) };
  const env = createMemoryEnv({ hashRounds: 5, settings: { AI_MAX_LEVEL: '2' }, ai: ai, archiveAtNight: !!night });
  const core = createCore(env);
  core.setup({ companyName: 'Acme', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  const call = (action, token, p) => core.handle(Object.assign({ action, token }, p || {}));
  const a = call('login', null, { username: 'admin', password: 'Admin-pass-1' }).data;
  call('changePassword', a.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = call('login', null, { username: 'admin', password: 'Admin-pass-2' }).data.token;
  const hi = call('adminSaveJobTitle', A, { title: 'Director', level: 1 }).data.id, lo = call('adminSaveJobTitle', A, { title: 'Worker', level: 2 }).data.id;
  const mgr = call('adminSaveUser', A, { name: 'Mgr', username: 'mgr', jobTitleId: hi }).data.user, wrk = call('adminSaveUser', A, { name: 'Wrk', username: 'wrk', jobTitleId: lo }).data.user;
  call('adminSaveLinks', A, { links: [{ fromId: mgr.id, toId: wrk.id }] });
  const login = (u) => { const l = call('login', null, { username: u, password: '1111' }).data; call('changePassword', l.token, { oldPassword: '1111', newPassword: u + '-pass-123' }); return call('login', null, { username: u, password: u + '-pass-123' }).data.token; };
  const M = login('mgr'), W = login('wrk');
  const task = call('createTask', M, { title: 'Roof repair', description: 'secret details', assigneeIds: [wrk.id] }).data.task;
  const rows = (t) => env.store.all(t);
  return { env, call, A, M, W, mgr, wrk, task, rows };
}
const B64 = Buffer.from('hello world').toString('base64');

test('the creator deletes an unfinished task: rows, messages, files, summary and overviews are all gone; nobody else can', () => {
  const s = boot();
  s.call('postMessage', s.W, { taskId: s.task.id, text: 'half done' });
  s.call('postFile', s.W, { taskId: s.task.id, name: 'note.txt', b64: B64 });
  s.call('postVoice', s.W, { taskId: s.task.id, audioB64: B64, mime: 'audio/webm', secs: 3 });
  s.env.store.insert('Briefings', { userId: s.mgr.id, sig: 'x', at: 1, data: { headline: 'Roof repair is half done' } });
  assert.ok(Object.keys(s.env._files).length >= 2, 'files are stored');
  assert.equal(s.call('deleteTask', s.W, { taskId: s.task.id }).code, 'FORBIDDEN', 'the person it was given to cannot delete it');
  assert.equal(s.call('deleteTask', s.A, { taskId: s.task.id }).ok, false, 'nor an administrator');
  assert.equal(s.rows('Tasks').length, 1);
  const r = s.call('deleteTask', s.M, { taskId: s.task.id });
  assert.equal(r.ok, true); assert.equal(r.data.deleted, true);
  assert.equal(s.rows('Tasks').length, 0); assert.equal(s.rows('Messages').length, 0); assert.equal(s.rows('Attachments').length, 0); assert.equal(s.rows('Reads').length, 0);
  assert.equal(s.rows('Briefings').length, 0, 'the saved overview that talked about it is dropped');
  assert.equal(Object.keys(s.env._files).length, 0, 'the stored voice and files are removed');
  assert.equal(s.call('getTask', s.W, { taskId: s.task.id }).code, 'NOT_FOUND', 'for the assignee too');
  assert.equal(s.call('listTasks', s.M).data.tasks.length, 0); assert.equal(s.call('listTasks', s.W).data.tasks.length, 0);
  const log = JSON.stringify(s.rows('AuditLog').filter((a) => a.action === 'task.delete'));
  assert.ok(log.includes(s.task.id)); assert.ok(!/Roof|secret|half done/.test(log), 'the audit line holds a bare id, no content');
  assert.equal(s.call('deleteTask', s.M, { taskId: s.task.id }).code, 'NOT_FOUND', 'deleting twice is a clean "not found"');
});

test('a task waiting for approval can be deleted, a finished (approved) one cannot', () => {
  const s = boot(true);                                              // approving only closes it; the hourly job files it later, like the real app
  s.call('setProgress', s.W, { taskId: s.task.id, progress: 100 });
  assert.equal(s.call('deleteTask', s.M, { taskId: s.task.id }).ok, true, 'waiting for approval is not finished yet');
  const t2 = s.call('createTask', s.M, { title: 'Second', assigneeIds: [s.wrk.id] }).data.task;
  s.call('setProgress', s.W, { taskId: t2.id, progress: 100 }); s.call('approveTask', s.M, { taskId: t2.id });
  const r = s.call('deleteTask', s.M, { taskId: t2.id });
  assert.equal(r.ok, false); assert.equal(r.code, 'VALIDATION');
});

test('a sender deletes their own message, voice message or document: erased, and what the AI summarised is dropped', () => {
  const s = boot();
  const text = s.call('postMessage', s.W, { taskId: s.task.id, text: 'the budget is 5000' }).data.message;
  const doc = s.call('postFile', s.W, { taskId: s.task.id, name: 'note.txt', b64: B64, caption: 'see this' }).data.message;
  const voice = s.call('postVoice', s.W, { taskId: s.task.id, audioB64: B64, mime: 'audio/webm', secs: 3 }).data.message;
  s.call('refreshSummary', s.M, { taskId: s.task.id, force: true });
  assert.ok(s.rows('Tasks')[0].summary, 'a summary exists');
  assert.equal(s.call('deleteMessage', s.M, { messageId: text.id }).code, 'FORBIDDEN', 'only the sender');
  assert.equal(s.call('deleteMessage', s.W, { messageId: 'Mnope' }).code, 'NOT_FOUND');
  assert.equal(s.call('deleteMessage', s.W, { messageId: text.id }).ok, true);
  assert.equal(s.rows('Tasks')[0].summary, null, 'the summary may have quoted it: it is dropped and made again later');
  assert.ok(!s.call('getTask', s.M, { taskId: s.task.id }).data.messages.some((m) => m.id === text.id));
  const filesBefore = Object.keys(s.env._files).length;
  assert.equal(s.call('deleteMessage', s.W, { messageId: doc.id }).ok, true);
  assert.equal(s.rows('Attachments').length, 0); assert.equal(Object.keys(s.env._files).length, filesBefore - 1, 'the document is removed from storage');
  assert.equal(s.call('deleteMessage', s.W, { messageId: voice.id }).ok, true);
  assert.equal(Object.keys(s.env._files).length, 0, 'and the voice recording');
  assert.equal(s.rows('Messages').filter((m) => m.type !== 'system').length, 0);
  const sys = s.rows('Messages').find((m) => m.type === 'system');
  assert.equal(s.call('deleteMessage', s.W, { messageId: sys.id }).code, 'NOT_FOUND', 'a system line is nobody\'s to delete');
  assert.ok(!/budget|5000|see this/.test(JSON.stringify(s.rows('AuditLog'))), 'no content in the audit log');
});

test('a sender edits their own text or the caption of a document; a voice message cannot be edited; others cannot', () => {
  const s = boot();
  const text = s.call('postMessage', s.W, { taskId: s.task.id, text: 'the budget is 5000' }).data.message;
  const doc = s.call('postFile', s.W, { taskId: s.task.id, name: 'note.txt', b64: B64, caption: 'old caption' }).data.message;
  const voice = s.call('postVoice', s.W, { taskId: s.task.id, audioB64: B64, mime: 'audio/webm', secs: 3 }).data.message;
  assert.equal(s.call('editMessage', s.M, { messageId: text.id, text: 'hacked' }).code, 'FORBIDDEN');
  const e = s.call('editMessage', s.W, { messageId: text.id, text: 'the budget is 6000' });
  assert.equal(e.ok, true); assert.equal(e.data.message.text, 'the budget is 6000'); assert.ok(e.data.message.editedAt > 0);
  assert.ok(s.call('getTask', s.M, { taskId: s.task.id }).data.messages.find((m) => m.id === text.id).editedAt > 0, 'everybody sees it was edited');
  assert.equal(s.call('editMessage', s.W, { messageId: text.id, text: '   ' }).ok, false, 'a text message cannot be made empty (delete it instead)');
  assert.equal(s.call('editMessage', s.W, { messageId: doc.id, text: 'new caption' }).data.message.text, 'new caption');
  assert.equal(s.call('editMessage', s.W, { messageId: doc.id, text: '' }).ok, true, 'a caption may be removed');
  const v = s.call('editMessage', s.W, { messageId: voice.id, text: 'x' });
  assert.equal(v.ok, false); assert.equal(v.code, 'VALIDATION');
  s.call('refreshSummary', s.M, { taskId: s.task.id, force: true });
  s.call('editMessage', s.W, { messageId: text.id, text: 'the budget is 7000' });
  assert.equal(s.rows('Tasks')[0].summary, null, 'an edit drops the summary that quoted the old words');
  assert.ok(!/6000|5000/.test(JSON.stringify(s.rows('Messages').map((m) => m.text))), 'the old words are not kept anywhere');
});

test('nothing can be changed in a closed task', () => {
  const s = boot(true);
  const text = s.call('postMessage', s.W, { taskId: s.task.id, text: 'finished' }).data.message;
  s.call('setProgress', s.W, { taskId: s.task.id, progress: 100 }); s.call('approveTask', s.M, { taskId: s.task.id });
  assert.equal(s.call('editMessage', s.W, { messageId: text.id, text: 'changed' }).ok, false);
  assert.equal(s.call('deleteMessage', s.W, { messageId: text.id }).ok, false);
});
