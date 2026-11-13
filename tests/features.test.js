// Shared files, editing a task, the assistant and the home overview.   Run with:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function makeApp(opts) {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const env = createMemoryEnv(Object.assign({ now: () => clock, hashRounds: 5 }, opts || {}));
  const core = createCore(env);
  const app = {
    env, core,
    tick: (ms) => { clock += ms; },
    call(action, token, params) { return core.handle(Object.assign({ action, token }, params || {})); },
    ok(action, token, params) { const r = app.call(action, token, params); assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r)); return r.data; },
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

// admin, titles (CEO L1, Manager L2, Worker L3), users ceo/mgr/wk1/wk2/wk3, arrows ceo->mgr, mgr->wk1,wk2, ceo->wk1
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
    app.ok('changePassword', l.token, { oldPassword: users[u].temp, newPassword: 'Changed-' + u + '-1' });
    tok[u] = app.ok('login', null, { username: u, password: 'Changed-' + u + '-1' }).token;
  }
  return { A, titles, users, tok };
}

const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n').toString('base64');
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]).toString('base64');

test('files: documents and photos are checked by type and content, and only task members can open them', () => {
  const app = makeApp(); const s = seed(app);
  const task = app.ok('createTask', s.tok.mgr, { title: 'Files', assigneeIds: [s.users.wk1.id] }).task;
  const post = (tok, p) => app.call('postFile', tok, Object.assign({ taskId: task.id }, p));
  const good = post(s.tok.wk1, { name: 'Report v2.pdf', b64: PDF_B64, caption: 'First draft' });
  assert.equal(good.ok, true);
  assert.equal(good.data.message.type, 'file');
  assert.equal(good.data.message.file.name, 'Report v2.pdf');
  assert.equal(good.data.message.file.isImage, false);
  const img = app.ok('postFile', s.tok.wk1, { taskId: task.id, name: 'site.png', b64: PNG_B64, thumb: TINY_JPEG, w: 800, h: 600 });
  assert.equal(img.message.file.isImage, true); assert.equal(img.message.file.thumb, TINY_JPEG);
  // refused: programs, renamed programs, wrong content, bad base64, too big
  assert.equal(post(s.tok.wk1, { name: 'virus.exe', b64: PDF_B64 }).code, 'VALIDATION');
  assert.equal(post(s.tok.wk1, { name: 'fake.pdf', b64: PNG_B64 }).code, 'VALIDATION');
  assert.equal(post(s.tok.wk1, { name: 'noext', b64: PDF_B64 }).code, 'VALIDATION');
  assert.equal(post(s.tok.wk1, { name: 'a.pdf', b64: 'JVBERi0<script>' }).code, 'VALIDATION');
  assert.equal(post(s.tok.wk1, { name: 'big.pdf', b64: 'JVBERi' + 'A'.repeat(7000000) }).code, 'VALIDATION');
  // a preview that is not a small JPEG is dropped, not stored
  const noThumb = app.ok('postFile', s.tok.wk1, { taskId: task.id, name: 'x.png', b64: PNG_B64, thumb: 'data:image/svg+xml;base64,AAAA' });
  assert.equal(noThumb.message.file.thumb, '');
  // path tricks in the name are flattened
  const odd = app.ok('postFile', s.tok.wk1, { taskId: task.id, name: '..\\..\\etc/passwd.txt', b64: Buffer.from('hello').toString('base64') });
  assert.equal(odd.message.file.name, 'passwd.txt');
  // people outside the task cannot post or read
  assert.equal(post(s.tok.wk2, { name: 'a.pdf', b64: PDF_B64 }).code, 'NOT_FOUND');
  app.err('getFile', s.tok.wk2, { messageId: good.data.message.id }, 'NOT_FOUND');
  assert.equal(app.ok('getFile', s.tok.mgr, { messageId: good.data.message.id }).b64, PDF_B64);
  assert.equal(app.ok('getFile', s.tok.mgr, { messageId: good.data.message.id }).name, 'Report v2.pdf');
  // the conversation shows them
  const t = app.ok('getTask', s.tok.mgr, { taskId: task.id });
  assert.ok(t.messages.some((m) => m.type === 'file' && m.file.name === 'Report v2.pdf' && m.text === 'First draft'));
  // archiving keeps the files and they can still be opened by the people of the task only
  app.ok('setProgress', s.tok.wk1, { taskId: task.id, progress: 100 });
  app.ok('approveTask', s.tok.mgr, { taskId: task.id });
  assert.equal(app.env.store.all('Attachments').length, 0);
  const doc = app.ok('getArchived', s.tok.wk1, { taskId: task.id });
  const fm = doc.messages.find((m) => m.type === 'file' && m.file.name === 'Report v2.pdf');
  assert.ok(fm);
  assert.equal(app.ok('getFile', s.tok.wk1, { archived: true, taskId: task.id, messageId: fm.id }).b64, PDF_B64);
  app.err('getFile', s.tok.wk2, { archived: true, taskId: task.id, messageId: fm.id }, 'NOT_FOUND');
});

test('updateTask: only the person who gave the task can change it, and everyone sees what changed', () => {
  const app = makeApp(); const s = seed(app);
  const task = app.ok('createTask', s.tok.mgr, { title: 'Old title', assigneeIds: [s.users.wk1.id], dueDate: '2026-11-20' }).task;
  app.err('updateTask', s.tok.wk1, { taskId: task.id, title: 'Mine now' }, 'FORBIDDEN');
  const r = app.ok('updateTask', s.tok.mgr, { taskId: task.id, title: 'New title', dueDate: '2026-11-25', description: 'More detail' }).task;
  assert.equal(r.title, 'New title'); assert.equal(r.dueDate, '2026-11-25'); assert.equal(r.description, 'More detail');
  app.err('updateTask', s.tok.mgr, { taskId: task.id, dueDate: '25/11/2026' }, 'VALIDATION');
  app.err('updateTask', s.tok.mgr, { taskId: task.id, title: '   ' }, 'VALIDATION');
  assert.equal(app.ok('updateTask', s.tok.mgr, { taskId: task.id, dueDate: '' }).task.dueDate, '');
  const sys = app.ok('getTask', s.tok.wk1, { taskId: task.id }).messages.filter((m) => m.type === 'system').map((m) => m.text);
  assert.ok(sys.some((t) => t.includes('renamed the task to "New title"')) && sys.some((t) => t.includes('removed the due date')));
  const before = app.ok('getTask', s.tok.wk1, { taskId: task.id }).messages.length;
  app.ok('updateTask', s.tok.mgr, { taskId: task.id, title: 'New title' });            // no change: no new message
  assert.equal(app.ok('getTask', s.tok.wk1, { taskId: task.id }).messages.length, before);
});

function spyAi() {
  const calls = [];
  const ai = {
    calls,
    transcribe() { return { english: 't', language: 'English', key_points: '' }; },
    summarize() { return { summary_en: 's', health: 'on_track', blockers: [], next_steps: [], progress_note: '' }; },
    assistant(input) { calls.push(input); return ai.reply(input); },
    reply() { return { reply: 'ok', actions: [] }; },
    briefing(input) { calls.push({ briefing: true, input }); return ai.briefReply(input); },
    briefReply() { return { headline: 'Two things need you', items: [{ tone: 'urgent', text: 'X is late', task_id: ai.taskId }, { tone: 'weird', text: 'Y', task_id: 'T-not-mine' }] }; }
  };
  return ai;
}

test('assistant: sees only what the person may see, and only PROPOSES actions that the person is allowed to do', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const mine = app.ok('createTask', s.tok.mgr, { title: 'Prepare the harvest plan', assigneeIds: [s.users.wk1.id], dueDate: '2026-11-10' }).task;
  app.ok('createTask', s.tok.ceo, { title: 'Secret board matter', assigneeIds: [s.users.mgr.id] });
  const hidden = app.ok('createTask', s.tok.mgr, { title: 'Private to wk2', assigneeIds: [s.users.wk2.id] }).task;
  ai.reply = () => ({
    heard: 'set my progress to sixty percent', reply: 'Okay.', confirm: 'yes',
    actions: [
      { type: 'set_progress', task_id: mine.id, progress: 60 },                    // allowed: wk1 is an assignee
      { type: 'post_message', task_id: mine.id, text: 'Done with step one' },
      { type: 'set_progress', task_id: hidden.id, progress: 60 },                  // not wk1's task
      { type: 'approve_task', task_id: mine.id },                                  // wk1 is not the creator
      { type: 'create_task', title: 'Go up', assignee_ids: [s.users.ceo.id] },     // cannot assign upwards
      { type: 'delete_everything' }, null
    ]
  });
  const r = app.ok('assistant', s.tok.wk1, { text: 'set my progress to 60', history: [{ role: 'user', text: 'hello' }] });
  assert.equal(r.heard, 'set my progress to sixty percent');
  assert.deepEqual(r.actions.map((a) => a.type), ['set_progress', 'post_message']);
  assert.equal(r.actions[0].progress, 60); assert.equal(r.actions[0].needsConfirm, true);
  assert.match(r.actions[0].label, /Prepare the harvest plan.*60%/);
  assert.match(r.reply, /Note:/);                                                  // the refused ones are explained
  assert.equal(r.confirm, '');                                                     // a new proposal never counts as a confirmation
  const ctxText = ai.calls[ai.calls.length - 1].context;
  assert.ok(ctxText.includes('Prepare the harvest plan') && ctxText.includes('OVERDUE'));
  assert.ok(!ctxText.includes('Secret board matter') && !ctxText.includes('Private to wk2'));   // other people's tasks never reach the model
  assert.equal(app.ok('getTask', s.tok.wk1, { taskId: mine.id }).task.progress, 0);              // merely asking changed nothing
  // a manager can assign to their people (ids from the app's own list); unknown ids are dropped
  ai.reply = () => ({ reply: 'ok', actions: [{ type: 'create_task', title: 'Count the crates', description: 'Warehouse', due_date: '2026-11-14', assignee_ids: [s.users.wk1.id, 'U-nobody'] }] });
  const m = app.ok('assistant', s.tok.mgr, { text: 'give Count the crates to wk1 for Saturday' });
  assert.equal(m.actions.length, 1); assert.deepEqual(m.actions[0].assigneeIds, [s.users.wk1.id]);
  assert.match(m.actions[0].label, /Count the crates.*WK1.*14 Nov/);
  // confirmation words only mean something when something is waiting
  ai.reply = () => ({ reply: 'Done', confirm: 'yes', actions: [] });
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'yes' }).confirm, '');
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'yes', pending: ['Create the task "A"'] }).confirm, 'yes');
  // bad input
  app.err('assistant', s.tok.mgr, {}, 'VALIDATION');
  app.err('assistant', s.tok.mgr, { audioB64: 'AAAA', mime: 'application/pdf' }, 'VALIDATION');
  app.err('assistant', null, { text: 'hi' }, 'AUTH');
  ai.reply = () => { throw new Error('model down'); };
  app.err('assistant', s.tok.mgr, { text: 'hi' }, 'AI_FAILED');
});

test('assistant: the creator can approve and edit, and the files of the task in focus are passed to the model', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const task = app.ok('createTask', s.tok.mgr, { title: 'Pump report', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postFile', s.tok.wk1, { taskId: task.id, name: 'report.pdf', b64: PDF_B64 });
  app.ok('postFile', s.tok.wk1, { taskId: task.id, name: 'sheet.xlsx', b64: 'UEsDBAAA' });
  app.ok('setProgress', s.tok.wk1, { taskId: task.id, progress: 100 });
  let seen = null;
  ai.reply = (input) => { seen = input; return { reply: 'ok', actions: [{ type: 'approve_task', task_id: task.id }, { type: 'update_task', task_id: task.id, due_date: '2026-12-01', title: 'Pump report v2' }, { type: 'open_task', task_id: task.id }] }; };
  const r = app.ok('assistant', s.tok.mgr, { text: 'approve it', taskId: task.id });
  assert.deepEqual(r.actions.map((a) => a.type), ['approve_task', 'update_task', 'open_task']);
  assert.equal(r.actions[2].needsConfirm, false);
  assert.deepEqual(r.actions[1].patch, { title: 'Pump report v2', dueDate: '2026-12-01' });
  assert.equal(seen.focus.title, 'Pump report');
  assert.deepEqual(seen.files.map((f) => f.name), ['report.pdf']);                 // the spreadsheet cannot be read by the model, the PDF can
  assert.ok(seen.context.includes('report.pdf') && seen.context.includes('sheet.xlsx'));
  const other = app.ok('createTask', s.tok.ceo, { title: 'Not yours', assigneeIds: [s.users.mgr.id] }).task;
  app.ok('assistant', s.tok.wk2, { text: 'x', taskId: other.id });                  // somebody else's task id as "focus" is ignored
  assert.equal(seen.focus, null);
});

test('briefing: made once per change, shared by quick repeat visits, and cleaned before it is stored', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  assert.deepEqual(app.ok('briefing', s.tok.wk1, {}).briefing.items, []);                      // nothing open: no AI call
  assert.equal(ai.calls.length, 0);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Mine', assigneeIds: [s.users.wk1.id] }).task;
  ai.taskId = t.id;
  const b1 = app.ok('briefing', s.tok.wk1, {});
  assert.equal(b1.briefing.headline, 'Two things need you');
  assert.equal(b1.briefing.items.length, 2);
  assert.equal(b1.briefing.items[0].taskId, t.id);
  assert.equal(b1.briefing.items[1].tone, 'info'); assert.equal(b1.briefing.items[1].taskId, '');   // unknown tone and foreign task ids are cleaned
  const n = ai.calls.length;
  app.ok('briefing', s.tok.wk1, {});                                                           // same state: served from the saved copy
  assert.equal(ai.calls.length, n);
  app.tick(60000); app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 50 });
  const b2 = app.ok('briefing', s.tok.wk1, {});                                                // changed, but made less than 20 minutes ago
  assert.equal(b2.stale, true); assert.equal(ai.calls.length, n);
  app.ok('briefing', s.tok.wk1, { force: true });                                              // asking explicitly always refreshes
  assert.equal(ai.calls.length, n + 1);
  app.tick(25 * 60000);
  app.ok('setProgress', s.tok.wk1, { taskId: t.id, progress: 60 });
  assert.equal(app.ok('briefing', s.tok.wk1, {}).stale, false);                                // changed and older than 20 minutes: made again
  assert.equal(ai.calls.length, n + 2);
  assert.equal(app.env.store.all('Briefings').length, 1);                                      // one saved row per person
});

test('voice notes: the AI is told who is in the task, to help it spell names', () => {
  const seen = []; const ai = spyAi(); ai.transcribe = (b, m, hints) => { seen.push(hints); return { english: 'ok', language: 'English', key_points: '' }; };
  const app = makeApp({ ai }); const s = seed(app);
  const task = app.ok('createTask', s.tok.mgr, { title: 'Irrigation check', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postVoice', s.tok.wk1, { taskId: task.id, audioB64: 'AAAA', mime: 'audio/webm', secs: 3 });
  assert.match(seen[0], /Irrigation check/); assert.match(seen[0], /WK1/); assert.match(seen[0], /MGR/);
});

test('assistant: a short spoken version is always returned; the speak action needs a voice and fails politely without one', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  ai.reply = () => ({ reply: 'You have two tasks. One is late and needs a call today. The other is fine.', spoken: 'Two tasks, one is late.', actions: [] });
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'status?' }).spoken, 'Two tasks, one is late.');
  ai.reply = () => ({ reply: 'You have two tasks. One is late and needs a call today. The other is fine.', actions: [] });
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'status?' }).spoken, 'You have two tasks. One is late and needs a call today.');
  app.err('speak', s.tok.mgr, { text: '   ' }, 'VALIDATION');
  app.err('speak', s.tok.mgr, { text: 'Hello' }, 'AI_FAILED');                    // the stand-in AI has no voice
  ai.speak = (t) => ({ b64: 'AAAA', mime: 'audio/L16;codec=pcm;rate=24000', t });
  assert.equal(app.ok('speak', s.tok.mgr, { text: 'Hello' }).mime, 'audio/L16;codec=pcm;rate=24000');
  app.err('speak', null, { text: 'Hello' }, 'AUTH');
  ai.speak = () => { throw new Error('quota'); };
  app.err('speak', s.tok.mgr, { text: 'Hello' }, 'AI_FAILED');
});

test('voice messages: shown as audio only, but the AI remembers them in English for summaries and the assistant', () => {
  const ai = spyAi(); let summaryInput = null;
  ai.transcribe = () => ({ english: 'The pump is fixed and I will water block C tomorrow', language: 'Sinhala', key_points: 'Pump fixed. Watering block C tomorrow.' });
  ai.summarize = (input) => { summaryInput = input; return { summary_en: 's', health: 'on_track', blockers: [], next_steps: [], progress_note: '' }; };
  const app = makeApp({ ai }); const s = seed(app);
  const task = app.ok('createTask', s.tok.mgr, { title: 'Irrigation check', assigneeIds: [s.users.wk1.id] }).task;
  const v = app.ok('postVoice', s.tok.wk1, { taskId: task.id, audioB64: 'AAAA', mime: 'audio/webm', secs: 4 });
  const shown = JSON.stringify([v, app.ok('getTask', s.tok.mgr, { taskId: task.id }), app.ok('listTasks', s.tok.mgr, {})]);
  assert.equal(shown.includes('pump'), false);                                                 // nothing of it reaches the chat
  assert.equal(app.ok('listTasks', s.tok.mgr, {}).tasks.filter((t) => t.id === task.id)[0].lastMessage.text, 'Voice message');
  app.ok('refreshSummary', s.tok.mgr, { taskId: task.id });
  assert.ok(summaryInput.messages.some((m) => m.type === 'voice' && m.text.includes('The pump is fixed')));   // the summary knows it
  app.ok('assistant', s.tok.mgr, { text: 'what did the worker say?', focusTaskId: task.id });
  assert.ok(ai.calls[ai.calls.length - 1].context.includes('The pump is fixed'));              // so does the assistant
  assert.equal(app.ok('assistant', s.tok.wk2, { text: 'anything?' }).reply, 'ok');
  assert.equal(ai.calls[ai.calls.length - 1].context.includes('pump'), false);                 // and only people in the task
});

test('bubble: show or enter a task, completed tasks can be opened and read, and old tasks are known', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const live = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  const old = app.ok('createTask', s.tok.mgr, { title: 'September harvest report', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postMessage', s.tok.wk1, { taskId: old.id, text: 'Totals are 4820 kg for block A' });
  app.ok('setProgress', s.tok.wk1, { taskId: old.id, progress: 100 }); app.ok('approveTask', s.tok.mgr, { taskId: old.id });
  ai.reply = () => ({ reply: 'ok', actions: [{ type: 'open_task', task_id: live.id, mode: 'show' }, { type: 'open_task', task_id: old.id }, { type: 'open_task', task_id: 'T-nope' }] });
  const r = app.ok('assistant', s.tok.mgr, { text: 'show me the roof and the september report' });
  assert.equal(r.actions.length, 2);                                                           // the unknown id is dropped
  assert.deepEqual([r.actions[0].mode, r.actions[0].archived], ['show', undefined]);
  assert.deepEqual([r.actions[1].taskId, r.actions[1].archived, r.actions[1].mode], [old.id, true, 'enter']);
  ai.reply = () => ({ reply: 'ok', actions: [{ type: 'open_task', task_id: live.id, mode: 'enter' }] });
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'open it' }).actions[0].mode, 'enter');
  // the context lists completed tasks with their ids, and looking at one adds its conversation
  assert.ok(ai.calls[ai.calls.length - 1].context.includes('id=' + old.id + ' "September harvest report"'));
  app.ok('assistant', s.tok.mgr, { text: 'what was the total?', archivedId: old.id });
  const withArchive = ai.calls[ai.calls.length - 1];
  assert.ok(withArchive.context.includes('LOOKING AT THIS COMPLETED TASK') && withArchive.context.includes('4820 kg'));
  assert.equal(withArchive.focus.id, old.id);
  app.ok('assistant', s.tok.wk2, { text: 'what was the total?', archivedId: old.id });          // someone who was not part of it gets nothing
  assert.equal(ai.calls[ai.calls.length - 1].context.includes('4820'), false);
});

test('demo AI relay: needs no login, reads no stored data, passes only whitelisted input, and is capped', () => {
  const got = []; const ai = spyAi();
  ai.assistant = (i) => { got.push(i); return { reply: 'hi', actions: [] }; };
  ai.summarize = (i) => { got.push(i); return { summary_en: 'x' }; };
  ai.briefing = (i) => { got.push(i); return { headline: 'h', items: [] }; };
  ai.transcribe = (b, m, hints) => { got.push({ b, m, hints }); return { english: 'said', language: 'English', key_points: '' }; };
  const app = makeApp({ ai, settings: { DEMO_AI_HOURLY: '5', DEMO_AI_DAILY: '8' } }); const s = seed(app);
  const r = app.ok('demoAi', null, { kind: 'assistant', input: { context: 'TODAY: x', text: 'hello', history: [{ role: 'assistant', text: 'a' }, { role: 'user', text: 'b' }], secret: 'SHOULD NOT PASS', userName: 'Kamala', pending: ['p'], focus: { id: 'T1', title: 'T' }, audio: null, files: [{ name: 'a.exe', mime: 'application/x-msdownload', b64: 'AA' }] } });
  assert.equal(r.reply, 'hi');
  assert.deepEqual(Object.keys(got[0]).sort(), ['audio', 'context', 'files', 'focus', 'history', 'pending', 'text', 'userName']);   // nothing else gets through
  assert.equal(got[0].files.length, 0);                                                                                              // a program is not passed on
  assert.equal(got[0].context.includes('Voice test'), false);                                                                         // it never reads the database
  app.ok('demoAi', null, { kind: 'summarize', input: { task: { title: 'T', assignees: ['A'] }, messages: [{ from: 'A', text: 'hi', extra: 1 }] } });
  assert.deepEqual(Object.keys(got[1].messages[0]).sort(), ['from', 'role', 'text', 'time', 'type']);
  app.ok('demoAi', null, { kind: 'briefing', input: { context: 'c', userName: 'u' } });
  assert.equal(app.ok('demoAi', null, { kind: 'transcribe', input: { b64: 'AAAA', mime: 'audio/wav', hints: 'Task: x' } }).english, 'said');
  app.err('demoAi', null, { kind: 'delete_everything', input: {} }, 'VALIDATION');
  app.err('demoAi', null, { kind: 'assistant' }, 'VALIDATION');
  app.ok('demoAi', null, { kind: 'briefing', input: { context: 'c' } });
  app.err('demoAi', null, { kind: 'briefing', input: { context: 'c' } }, 'AI_FAILED');                                                // 6th call this hour: over the cap of 5
  app.tick(3600000 + 1000);
  app.ok('demoAi', null, { kind: 'briefing', input: { context: 'c' } });                                                             // a new hour
  const off = makeApp({ ai, settings: { DEMO_AI: 'off' } });
  off.err('demoAi', null, { kind: 'briefing', input: { context: 'c' } }, 'AI_FAILED');
});
