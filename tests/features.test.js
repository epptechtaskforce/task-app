// Shared files, editing a task, the assistant and the home overview.   Run with:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function makeApp(opts) {
  let clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  const env = createMemoryEnv(Object.assign({ now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: '3' } }, opts || {}));   // in these tests everybody may use the AI unless a test says otherwise
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

test('assistant: the whole answer is what gets spoken; the speak action needs a voice and fails politely without one', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  ai.reply = () => ({ reply: 'You have two tasks. One is late and needs a call today. The other is fine.', spoken: 'Two tasks, one is late.', actions: [] });
  assert.equal(app.ok('assistant', s.tok.mgr, { text: 'status?' }).spoken, 'You have two tasks. One is late and needs a call today. The other is fine.');   // not a shortened version
  ai.reply = () => ({ reply: 'Done.', actions: [{ type: 'open_task', task_id: 'T-nope' }] });
  const withNote = app.ok('assistant', s.tok.mgr, { text: 'x' });
  assert.ok(withNote.reply.includes('(Note:') && withNote.spoken === 'Done.');                                                                                     // the note is never read aloud
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

test('AI access: only Senior General Managers and above (the cut-off is the layer of that job title, or AI_MAX_LEVEL)', () => {
  const find = (app, id) => app.ok('listTasks', id).tasks;   // just to prove ordinary use is untouched
  // 1) no setting: the cut-off is found from a job title that looks like "Senior General Manager"
  const app = makeApp({ settings: {} });
  const admin = app.ok('login', null, { username: 'admin', password: 'Admin-pass-1' });
  app.ok('changePassword', admin.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = app.ok('login', null, { username: 'admin', password: 'Admin-pass-2' }).token;
  const mk = (t, l) => app.ok('adminSaveJobTitle', A, { title: t, level: l }).id;
  const ids = { ceo: mk('CEO', 1), sgm: mk('Senior General Manager', 2), gm: mk('General Manager', 3), mgr: mk('Manager', 4) };
  const who = {};
  [['ceo', 'ceo'], ['sgm', 'sgm'], ['gm', 'gm'], ['mgr', 'mgr']].forEach(([u, t]) => {
    u += '1';
    const r = app.ok('adminSaveUser', A, { name: u, username: u, jobTitleId: ids[t] });
    const tok = app.ok('login', null, { username: u, password: r.tempPassword }).token;
    app.ok('changePassword', tok, { oldPassword: r.tempPassword, newPassword: 'Newpass-123' });
    who[u] = app.ok('login', null, { username: u, password: 'Newpass-123' }).token;
  });
  const can = (u) => app.ok('me', who[u + '1']).canUseAi;
  assert.deepEqual(['ceo', 'sgm', 'gm', 'mgr'].map(can), [true, true, false, false]);
  assert.equal(app.ok('me', A).canUseAi, false);                                   // the Administrator has no job title
  ['assistant', 'briefing', 'speak'].forEach((a) => { app.err(a, who.gm1, { text: 'hi' }, 'FORBIDDEN'); });
  assert.ok(find(app, who.gm1));                                                    // everything else works as usual
  // 2) the property wins over the job-title search
  const app2 = makeApp({ settings: { AI_MAX_LEVEL: '1' } }); const s2 = seed(app2);
  assert.equal(app2.ok('me', s2.tok.ceo).canUseAi, true);
  assert.equal(app2.ok('me', s2.tok.mgr).canUseAi, false);
});

test('navigation: the assistant can take the person to a filtered list, chosen tasks, History or Account (nothing needs confirming, nothing foreign gets in)', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const mine = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  const other = app.ok('createTask', s.tok.ceo, { title: 'Board pack', assigneeIds: [s.users.mgr.id] }).task;   // the worker has no part in this one
  ai.reply = () => ({ reply: 'Here they are.', actions: [
    { type: 'show_page', page: 'tasks', filter: 'late' },
    { type: 'show_page', page: 'tasks', task_ids: [mine.id, other.id, 'T-nope', mine.id], search: '  Jonas  ' },
    { type: 'show_page', page: 'history', search: 'harvest', filter: 'late', task_ids: [mine.id] },
    { type: 'show_page', page: 'account', search: 'x' },
    { type: 'show_page', page: 'elsewhere', filter: 'weird' }] });
  const r = app.ok('assistant', s.tok.wk1, { text: 'show me things' });
  assert.equal(r.actions.length, 5);
  assert.ok(r.actions.every((a) => a.needsConfirm === false));
  assert.deepEqual([r.actions[0].page, r.actions[0].filter, r.actions[0].taskIds], ['tasks', 'late', []]);
  assert.deepEqual([r.actions[1].taskIds, r.actions[1].q], [[mine.id], 'Jonas']);              // only the worker's own open task, once
  assert.deepEqual([r.actions[2].page, r.actions[2].q, r.actions[2].filter, r.actions[2].taskIds], ['history', 'harvest', 'all', []]);
  assert.deepEqual([r.actions[3].page, r.actions[3].q], ['account', '']);
  assert.deepEqual([r.actions[4].page, r.actions[4].filter], ['tasks', 'all']);                  // unknown values fall back to safe ones
});

test('ids are never shown or read aloud: they are stripped from the assistant reply, the overview and the summary', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postMessage', s.tok.wk1, { taskId: t.id, text: 'Started' });
  ai.reply = () => ({ reply: 'The roof job (id ' + t.id + ') is at 35%, task ' + t.id + ' is late. Total 4820 kg.', actions: [] });
  const r = app.ok('assistant', s.tok.mgr, { text: 'status?' });
  assert.equal(r.reply.includes(t.id), false);
  assert.ok(r.reply.includes('35%') && r.reply.includes('4820 kg') && r.reply.includes('The roof job'));
  assert.equal(r.spoken.includes(t.id), false);
  ai.briefReply = () => ({ headline: 'Roof ' + t.id + ' is late', items: [{ tone: 'urgent', text: 'Pump house roof (' + t.id + ') needs a new date', task_id: t.id }] });
  const b = app.ok('briefing', s.tok.mgr, { force: true }).briefing;
  assert.equal(JSON.stringify(b).replace(new RegExp('"taskId":"' + t.id + '"', 'g'), '').includes(t.id), false);   // the link field keeps the id, the words do not
});

test('companion: the assistant is told which screen the person is on (checked against what they may see), and fill_task fills the New task form safely', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const mine = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  const other = app.ok('createTask', s.tok.ceo, { title: 'Board pack', assigneeIds: [s.users.mgr.id] }).task;   // the worker has no part in this one
  const screenOf = () => ai.calls.pop().screen;
  app.ok('assistant', s.tok.wk1, { text: 'what is here?', screen: { kind: 'home', filter: 'late', q: ' roof ', shown: [mine.id, other.id, 'T-nope', mine.id] } });
  let seen = screenOf();
  assert.ok(/HOME screen/.test(seen) && seen.includes('only late') && seen.includes('"roof"') && seen.includes('Pump house roof'));
  assert.equal(seen.includes('Board pack'), false);                                   // a task of somebody else cannot be smuggled in through the screen
  app.ok('assistant', s.tok.mgr, { text: 'x', screen: { kind: 'new', draft: { title: 'Fix the gate', due: '2026-11-20', assigneeIds: [s.users.wk1.id, s.users.ceo.id] } } });
  seen = screenOf();
  assert.ok(seen.includes('NEW TASK form') && seen.includes('"Fix the gate"') && seen.includes('assigned to WK1') && seen.includes('fill_task'));
  assert.equal(seen.includes('CEO'), false);                               // the manager may not assign to the CEO: not listed as chosen
  app.ok('assistant', s.tok.wk1, { text: 'x', screen: { kind: 'task', slider: 40, draft: 'Almost done' } });
  seen = screenOf();
  assert.ok(seen.includes('40%') && seen.includes('Almost done'));
  app.ok('assistant', s.tok.wk1, { text: 'x', screen: { kind: 'hacked', shown: [mine.id] } });
  assert.equal(screenOf(), '');                                                       // an unknown screen is ignored
  app.ok('assistant', s.tok.wk1, { text: 'x' });
  assert.equal(screenOf(), '');
  ai.reply = () => ({ reply: 'Filled.', actions: [
    { type: 'fill_task', title: '  Fix the gate ', due_date: '2026-11-20', assignee_ids: [s.users.wk1.id, s.users.ceo.id, s.users.wk1.id] },
    { type: 'fill_task', due_date: 'soon' }, { type: 'fill_task' }] });
  const r = app.ok('assistant', s.tok.mgr, { text: 'fill it in' });
  assert.equal(r.actions.length, 1);
  const a = r.actions[0];
  assert.deepEqual([a.type, a.title, a.dueDate, a.assigneeIds, a.needsConfirm], ['fill_task', 'Fix the gate', '2026-11-20', [s.users.wk1.id], false]);
  assert.ok(r.reply.includes('not allowed'));                                         // told that someone was left out
});

test('confirmation: what the person says decides, not how the model words its answer (no more "Sent!" while the card is still waiting)', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  const t = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  const waiting = ['Post this in "Pump house roof": "Started the roof today"'];
  const again = { type: 'post_message', task_id: t.id, text: 'Started the roof today' };
  // 1. the person says yes (voice: only the model hears it); the model re-proposes the same message and says it sent it
  ai.reply = () => ({ heard: 'yes please send it', reply: 'Sent!', confirm: '', actions: [again] });
  let r = app.ok('assistant', s.tok.mgr, { audioB64: 'AAAA', mime: 'audio/webm', pending: waiting });
  assert.equal(r.confirm, 'yes'); assert.deepEqual(r.actions, []);
  ai.reply = () => ({ heard: 'yes', reply: 'Sent!', confirm: 'yes', actions: [] });   // (the model's idea of what it heard does not override typed words)
  r = app.ok('assistant', s.tok.mgr, { text: 'how is the roof going', pending: waiting });
  assert.equal(r.confirm, 'yes');                                                      // (its own yes label is still respected)
  // 2. typed words are enough on their own, whatever the model says
  ai.reply = () => ({ reply: 'Done, it is posted.', confirm: '', actions: [] });
  r = app.ok('assistant', s.tok.mgr, { text: 'okay go ahead', pending: waiting });
  assert.equal(r.confirm, 'yes');
  // 3. the model says yes but also re-proposes the action: it is still one confirmation, not a new card
  ai.reply = () => ({ heard: 'sure', reply: 'Sending.', confirm: 'yes', actions: [again] });
  r = app.ok('assistant', s.tok.mgr, { audioB64: 'AAAA', mime: 'audio/webm', pending: waiting });
  assert.equal(r.confirm, 'yes'); assert.equal(r.actions.length, 0);
  // 4. no / cancel
  ai.reply = () => ({ reply: 'Okay.', confirm: '', actions: [again] });
  r = app.ok('assistant', s.tok.mgr, { text: 'never mind', pending: waiting });
  assert.equal(r.confirm, 'no'); assert.equal(r.actions.length, 0);
  // 5. "yes, but change it" is NOT a yes: the corrected action goes through the card again
  ai.reply = () => ({ reply: 'Here is the new version. Shall I send it?', confirm: '', actions: [{ type: 'post_message', task_id: t.id, text: 'Started the roof today, finishing tomorrow' }] });
  r = app.ok('assistant', s.tok.mgr, { text: 'yes but add that we finish tomorrow', pending: waiting });
  assert.equal(r.confirm, ''); assert.equal(r.actions.length, 1);
  r = app.ok('assistant', s.tok.mgr, { text: 'no, make it shorter', pending: waiting });
  assert.equal(r.confirm, ''); assert.equal(r.actions.length, 1);
  // 6. the model claims it is done although the person did not confirm anything: the answer must not say so
  ai.reply = () => ({ reply: 'I have sent it to the team.', confirm: '', actions: [] });
  r = app.ok('assistant', s.tok.mgr, { text: 'how is the roof going', pending: waiting });
  assert.equal(r.confirm, ''); assert.ok(/not done yet/.test(r.reply) && !/sent it/.test(r.reply));
  // an ordinary answer while something waits is left alone, and nothing is touched when nothing waits
  ai.reply = () => ({ reply: 'The roof is at 35%.', confirm: '', actions: [] });
  r = app.ok('assistant', s.tok.mgr, { text: 'how is the roof going', pending: waiting });
  assert.equal(r.reply, 'The roof is at 35%.');
  ai.reply = () => ({ reply: 'Done, I noted that.', confirm: 'yes', actions: [] });
  r = app.ok('assistant', s.tok.mgr, { text: 'yes' });
  assert.equal(r.confirm, ''); assert.equal(r.reply, 'Done, I noted that.');
});

test('assistant summaries: the AI summary shown at the top of a task is what the assistant is given (in full for the open task, compact for the others, and for completed tasks)', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  ai.summarize = (input) => ({ summary_en: 'Roof repair is under way (' + input.task.title + ').', health: 'at_risk', progress_note: 'Beams are fitted.', blockers: ['Waiting for the tiles'], next_steps: ['Fit the tiles', 'Inspect the leak'] });
  const roof = app.ok('createTask', s.tok.mgr, { title: 'Pump house roof', assigneeIds: [s.users.wk1.id] }).task;
  const gate = app.ok('createTask', s.tok.mgr, { title: 'Gate lock', assigneeIds: [s.users.wk1.id] }).task;
  app.ok('postMessage', s.tok.wk1, { taskId: roof.id, text: 'Beams are fitted' });
  app.ok('postMessage', s.tok.wk1, { taskId: gate.id, text: 'Lock ordered' });
  app.ok('refreshSummary', s.tok.mgr, { taskId: roof.id }); app.ok('refreshSummary', s.tok.mgr, { taskId: gate.id });
  const context = () => ai.calls.pop().context;
  app.ok('assistant', s.tok.mgr, { text: 'give me the summary', taskId: roof.id });
  let c = context();
  assert.ok(c.includes('AI SUMMARY (exactly what the task page shows'), 'the open task carries its full summary');
  ['summary: Roof repair is under way (Pump house roof).', 'health: at risk', 'so far: Beams are fitted.', 'blockers: Waiting for the tiles', 'next steps: Fit the tiles; Inspect the leak'].forEach((x) => assert.ok(c.includes(x), x));
  assert.ok(/AI summary \(at risk\): Roof repair is under way \(Gate lock\)\. \| so far: Beams are fitted\. \| blockers: Waiting for the tiles/.test(c), 'other tasks carry a compact one');
  assert.equal(c.includes('newer message'), false);
  // something new is said after the summary: the assistant is told
  app.ok('postMessage', s.tok.wk1, { taskId: roof.id, text: 'Tiles delivered' });
  app.ok('assistant', s.tok.mgr, { text: 'summary please', taskId: roof.id });
  assert.ok(/1 newer message since/.test(context()));
  // no summary yet: nothing invented
  const fresh = app.ok('createTask', s.tok.mgr, { title: 'New fence', assigneeIds: [s.users.wk2.id] }).task;
  app.ok('assistant', s.tok.mgr, { text: 'x', taskId: fresh.id });
  c = context(); assert.equal(c.split('\n').filter((l) => l.indexOf('New fence') >= 0 && l.indexOf('TASK id=') === 0).length, 1);
  // a completed task keeps its whole summary for the History view
  app.ok('setProgress', s.tok.wk1, { taskId: gate.id, progress: 100 }); app.ok('approveTask', s.tok.mgr, { taskId: gate.id });
  app.ok('assistant', s.tok.mgr, { text: 'summary of the finished gate job', archivedId: gate.id });
  c = context(); assert.ok(c.includes('AI SUMMARY (exactly what the task page shows') && c.includes('blockers: Waiting for the tiles'));
});

test('points and pictures: the reply keeps its tags for the screen, the spoken version never reads them', () => {
  const ai = spyAi(); const app = makeApp({ ai }); const s = seed(app);
  ai.reply = () => ({ reply: 'Two things need you.\n- [late] Pump house roof [35%] is 3 days late\n- [wait] Gate lock [100%] waits for your approval\n- [good] Fence is on track', actions: [] });
  const r = app.ok('assistant', s.tok.mgr, { text: 'what needs me' });
  assert.ok(r.reply.includes('[late] Pump house roof [35%]') && r.reply.includes('[wait]') && r.reply.includes('[good]'));   // drawn by the screen
  assert.equal(/\[[a-z]+\]|\[\d+%\]/.test(r.spoken), false);                                                                    // never read aloud
  assert.ok(r.spoken.includes('Pump house roof 35 percent is 3 days late'));
  assert.ok(r.spoken.includes('Two things need you.'));
  // the model is told how to write them
  const adapters = require('fs').readFileSync(require('path').join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');
  assert.ok(adapters.includes('FORMAT: the reply is drawn as points') && adapters.includes('[late]') && adapters.includes('[35%]'));
});
