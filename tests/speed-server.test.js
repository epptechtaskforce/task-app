'use strict';
// Server side of "instant feel": sign-in brings the task list, tasks can be looked at ahead without being marked read, voice messages are stored first
// and transcribed in a second call.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

function boot(ai) {
  const env = createMemoryEnv({ hashRounds: 5, settings: {}, ai: ai });
  const core = createCore(env);
  core.setup({ companyName: 'Acme', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  const call = (action, token, p) => core.handle(Object.assign({ action, token }, p || {}));
  const a = call('login', null, { username: 'admin', password: 'Admin-pass-1' }).data;
  call('changePassword', a.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = call('login', null, { username: 'admin', password: 'Admin-pass-2' }).data.token;
  const hi = call('adminSaveJobTitle', A, { title: 'Director', level: 1 }).data.id, lo = call('adminSaveJobTitle', A, { title: 'Worker', level: 2 }).data.id;
  const mgr = call('adminSaveUser', A, { name: 'Mgr', username: 'mgr', jobTitleId: hi }).data.user, wrk = call('adminSaveUser', A, { name: 'Wrk', username: 'wrk', jobTitleId: lo }).data.user;
  call('adminSaveLinks', A, { links: [{ fromId: mgr.id, toId: wrk.id }] });
  const login = (u) => { const l = call('login', null, { username: u, password: '1111' }).data; call('changePassword', l.token, { oldPassword: '1111', newPassword: u + '-pass-123' }); return u + '-pass-123'; };
  const pm = login('mgr'), pw = login('wrk');
  const M = call('login', null, { username: 'mgr', password: pm }).data.token, W = call('login', null, { username: 'wrk', password: pw }).data.token;
  return { env, call, A, M, W, mgr, wrk, pm, pw };
}

test('sign-in brings the task list in the same answer (one round trip less), but not for admins or people who must change their password', () => {
  const s = boot();
  const t = s.call('createTask', s.M, { title: 'Roof', assigneeIds: [s.wrk.id] }).data.task;
  const l = s.call('login', null, { username: 'wrk', password: s.pw });
  assert.equal(l.ok, true); assert.ok(l.data.list && Array.isArray(l.data.list.tasks));
  assert.deepEqual(l.data.list.tasks.map((x) => x.id), [t.id]);
  assert.deepEqual(l.data.list.tasks.map((x) => x.title), s.call('listTasks', l.data.token).data.tasks.map((x) => x.title), 'the same list the list call would give');
  assert.equal(s.call('login', null, { username: 'admin', password: 'Admin-pass-2' }).data.list, undefined, 'a pure administrator has no tasks');
  const fresh = s.call('adminSaveUser', s.A, { name: 'New', username: 'newbie', jobTitleId: '', isAdmin: true }).data;
  assert.equal(s.call('login', null, { username: 'newbie', password: '1111' }).data.list, undefined, 'must choose a password first');
});

test('peek looks at a task ahead of time without marking it read; a normal look does', () => {
  const s = boot();
  const t = s.call('createTask', s.M, { title: 'Roof', assigneeIds: [s.wrk.id] }).data.task;
  s.call('postMessage', s.M, { taskId: t.id, text: 'Please start' });
  const unread = () => s.call('listTasks', s.W).data.tasks.find((x) => x.id === t.id).unread;
  assert.equal(unread(), true);
  const p = s.call('getTask', s.W, { taskId: t.id, peek: true });
  assert.equal(p.ok, true); assert.ok(p.data.messages.some((m) => m.text === 'Please start'));
  assert.equal(unread(), true, 'still new after a peek');
  s.call('getTask', s.W, { taskId: t.id });
  assert.equal(unread(), false, 'read after a real look');
  assert.equal(s.call('getTask', s.A, { taskId: t.id, peek: true }).ok, false, 'peek is no way around who may see a task');
});

const AUDIO = Buffer.from('some audio bytes').toString('base64');
test('a deferred voice message is stored and answered at once; the transcript comes from a second call', () => {
  let heard = 0;
  const s = boot({ transcribe: () => { heard++; return { english: 'The pump is fixed', language: 'Sinhala', key_points: 'Pump fixed.' }; }, summarize: () => ({}) });
  const t = s.call('createTask', s.M, { title: 'Pump', assigneeIds: [s.wrk.id] }).data.task;
  const v = s.call('postVoice', s.W, { taskId: t.id, audioB64: AUDIO, mime: 'audio/webm', secs: 4, defer: true });
  assert.equal(v.ok, true); assert.equal(v.data.deferred, true); assert.equal(v.data.message.status, 'transcribing'); assert.equal(v.data.message.hasAudio, true); assert.equal(heard, 0, 'the AI was not waited for');
  const done = s.call('transcribeVoice', s.W, { messageId: v.data.message.id });
  assert.equal(done.ok, true); assert.equal(done.data.message.status, 'ok'); assert.equal(heard, 1);
  assert.equal(s.env.store.all('Messages').find((m) => m.id === v.data.message.id).transcript, 'The pump is fixed');
  const again = s.call('transcribeVoice', s.W, { messageId: v.data.message.id });
  assert.equal(again.ok, true); assert.equal(heard, 1, 'asking twice does the work once');
});

test('only the sender may ask for a transcript; a failing AI keeps the audio and says so', () => {
  let fail = true;
  const s = boot({ transcribe: () => { if (fail) throw new Error('503'); return { english: 'ok' }; }, summarize: () => ({}) });
  const t = s.call('createTask', s.M, { title: 'Pump', assigneeIds: [s.wrk.id] }).data.task;
  const v = s.call('postVoice', s.W, { taskId: t.id, audioB64: AUDIO, mime: 'audio/webm', secs: 4, defer: true }).data;
  assert.equal(s.call('transcribeVoice', s.M, { messageId: v.message.id }).ok, false, 'the manager did not send it');
  const r = s.call('transcribeVoice', s.W, { messageId: v.message.id });
  assert.equal(r.ok, true); assert.equal(r.data.message.status, 'failed'); assert.equal(r.data.transcribeFailed, true); assert.equal(r.data.message.hasAudio, true);
  assert.equal(s.call('transcribeVoice', s.W, { messageId: 'Mnope' }).ok, false);
});

test('without defer, voice works as before (transcript in the same answer)', () => {
  const s = boot({ transcribe: () => ({ english: 'Done' }), summarize: () => ({}) });
  const t = s.call('createTask', s.M, { title: 'Pump', assigneeIds: [s.wrk.id] }).data.task;
  const v = s.call('postVoice', s.W, { taskId: t.id, audioB64: AUDIO, mime: 'audio/webm', secs: 4 });
  assert.equal(v.data.message.status, 'ok');
});
