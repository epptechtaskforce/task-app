'use strict';
// The three-month simulation (Setup.gs: simPlan_) is an Apps Script tool, but its PLAN is plain JavaScript: this checks the plan before it is ever run on real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Setup.gs'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\n;this.simPlan_ = simPlan_;', ctx);

const OFFSET = 5.5 * 3600000, DAY = 86400000, H = 3600000;
const cal = {
  ymd: (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10),
  weekday: (ms) => (new Date(ms + OFFSET).getUTCDay() + 6) % 7 + 1            // 1 = Monday ... 7 = Sunday
};
const now = Date.UTC(2026, 10, 14, 9, 30), m0 = Date.UTC(2026, 10, 13, 18, 30);   // 14 Nov 2026 15:00 and midnight, Colombo time
const roster = [
  { id: 'A', level: 1, targets: ['B', 'C'] },
  { id: 'B', level: 2, targets: ['C', 'D', 'E'] },
  { id: 'C', level: 3, targets: ['D', 'E', 'F', 'G'] }
];
const plan = () => ctx.simPlan_(JSON.parse(JSON.stringify(roster)), { m0, now }, cal);
const dueEnd = (s) => Date.parse(s.due + 'T00:00:00+05:30') + DAY;
const finishOf = (s) => { const p = s.ev.filter((e) => e[0] === 'p' && e[3] === 100).map((e) => e[1]); return p.length ? Math.max(...p) : null; };

test('simulation plan: about 100 tasks over 13 weeks, same plan every time', () => {
  const specs = plan();
  assert.ok(specs.length >= 85 && specs.length <= 120, 'tasks: ' + specs.length);
  assert.equal(JSON.stringify(specs), JSON.stringify(plan()));
  assert.ok(specs.every((s, i) => i === 0 || s.created >= specs[i - 1].created));
  assert.ok(specs[0].created >= m0 - 95 * DAY && specs[specs.length - 1].created < now);
  const by = {}; specs.forEach((s) => { by[s.by] = (by[s.by] || 0) + 1; });
  assert.ok(by.A >= 12 && by.B >= 28 && by.C >= 38, JSON.stringify(by));                         // the CEO assigns least, the field manager most
});

test('simulation plan: people follow the org chart, tasks are assigned on working days, due dates make sense', () => {
  plan().forEach((s) => {
    const r = roster.find((x) => x.id === s.by);
    assert.ok(r, 'assigner ' + s.by);
    assert.ok(s.to.length >= 1 && s.to.length <= (r.level <= 1 ? 1 : r.level === 2 ? 2 : 3) && new Set(s.to).size === s.to.length);
    assert.ok(s.to.every((t) => r.targets.includes(t)), 'only people the arrows point to: ' + s.by + ' -> ' + s.to);
    assert.ok(cal.weekday(s.created + 12 * H) <= 5 || cal.weekday(s.created) <= 5, 'assigned Monday to Friday');
    const gap = (dueEnd(s) - DAY - (s.created - ((s.created + OFFSET) % DAY) + 0)) / DAY;               // whole days from the day of assigning to the due day
    assert.ok(gap >= 3 && gap <= 8, 'due gap ' + gap);
    assert.ok(!/\{[a-z]+\}/.test(s.title + s.desc), 'placeholders filled: ' + s.title);
  });
});

test('simulation plan: management pushes - nothing finishes more than 7 days after its due date, nothing is in the future', () => {
  const specs = plan(); let late = 0, onTime = 0;
  specs.forEach((s) => {
    assert.ok(s.ev.every((e) => e[1] <= now - 3 * 60000), 'no event in the future');
    assert.ok(s.ev.every((e, i) => i === 0 || e[1] >= s.ev[i - 1][1]), 'events in time order');
    const f = finishOf(s);
    if (f !== null) {
      const days = (f - dueEnd(s)) / DAY;
      assert.ok(days <= 7, 'finished ' + days.toFixed(2) + ' days after the due date: ' + s.title);
      assert.ok(f > s.created + 3 * H);
      if (days > 0) late++; else onTime++;
    } else {
      // still open: it can only be open if it is not more than 7 days past due (it would have been finished by then)
      assert.ok((now - dueEnd(s)) / DAY <= 7, 'open task too long overdue: ' + s.title);
    }
  });
  assert.ok(onTime > late && late >= 15, 'mostly on time, a good share late: on time ' + onTime + ', late ' + late);
});

test('simulation plan: every timeline is something the app accepts (order of progress, send back, approval)', () => {
  plan().forEach((s) => {
    let pct = 0, state = 'open', closed = false;
    s.ev.forEach((e) => {
      const [kind, , who] = e;
      assert.ok(!closed, 'nothing after the approval: ' + kind);
      if (kind === 's') assert.ok(s.to.includes(who) || who === s.by);
      else if (kind === 'p') { assert.ok(s.to.includes(who)); assert.equal(state, 'open', 'progress only while the task is open'); assert.ok(e[3] > pct || (e[3] === 100 && pct === 90) || e[3] === 100, 'progress goes up'); pct = e[3]; if (pct === 100) state = 'pending'; }
      else if (kind === 'back') { assert.equal(who, s.by); assert.equal(state, 'pending'); state = 'open'; pct = 90; }
      else if (kind === 'ok') { assert.equal(who, s.by); assert.equal(state, 'pending'); closed = true; }
      else { assert.ok(['v', 'f', 'i'].includes(kind) && s.to.includes(who)); assert.equal(state, 'open', 'files and voice only while the task is open'); }
    });
  });
});

test('simulation plan: a realistic mix - archived, open, late, waiting for approval, sent back, voice, documents, pictures', () => {
  const specs = plan(), has = (k) => specs.filter((s) => s.ev.some((e) => e[0] === k)).length;
  const stateOf = (s) => { let st = 'open'; s.ev.forEach((e) => { if (e[0] === 'p' && e[3] === 100) st = 'pending'; else if (e[0] === 'back') st = 'open'; else if (e[0] === 'ok') st = 'closed'; }); return st; };
  const closed = specs.filter((s) => stateOf(s) === 'closed'), pending = specs.filter((s) => stateOf(s) === 'pending');
  const open = specs.filter((s) => stateOf(s) !== 'closed');
  assert.ok(closed.length >= 70, 'archived ' + closed.length);
  assert.ok(open.length >= 8 && open.length <= 30, 'still open or waiting ' + open.length);
  assert.ok(open.some((s) => finishOf(s) === null && dueEnd(s) < now), 'some open task is overdue');
  assert.ok(pending.length >= 2, 'tasks waiting for approval: ' + pending.length);
  assert.ok(has('back') >= 2, 'send backs ' + has('back'));
  assert.ok(has('v') >= 4 && has('f') >= 12 && has('i') >= 5, 'voice ' + has('v') + ', documents ' + has('f') + ', pictures ' + has('i'));
  assert.ok(specs.some((s) => s.unread) && specs.some((s) => !s.unread));
  assert.ok(new Set(specs.map((s) => s.title)).size >= 25, 'a good variety of titles');
});

test('simulation tools: guarded clean-up, resumable, and nothing in the generic code is company specific', () => {
  assert.ok(/simulationClean\(confirmText\)[\s\S]{0,200}REMOVE THE SIMULATION/.test(src));
  assert.ok(src.includes("'SIM_STATE'") && src.includes('simSchedule_(60000)') && src.includes('SIM_RUN'));
  assert.equal(/https?:\/\/[a-z0-9-]+\.github\.io/i.test(src), false);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan is also run through the app's REAL rules (Core.gs, in memory) for a company shaped like the live one: if the app would reject any
// step (progress order, sending back, approving, files, voice), this fails here instead of half-way through a run on real data.
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

test('simulation plan runs through the real rules without one rejected step, and fills History and the EPP zips', () => {
  let clock = now, said = '';
  const ai = {
    transcribe: () => ({ english: said, language: 'English', key_points: '' }),
    summarize: (input) => ({ summary_en: 'Done: ' + input.task.title + ', ' + input.messages.length + ' messages.', health: 'done', blockers: [], next_steps: [], progress_note: '' })
  };
  const env = createMemoryEnv({ now: () => clock, hashRounds: 5, settings: { AI_MAX_LEVEL: '3' }, ai });
  const core = createCore(env);
  core.setup({ companyName: 'Sim Co', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  const call = (action, token, params) => core.handle(Object.assign({ action, token }, params || {}));
  const ok = (action, token, params) => { const r = call(action, token, params); assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r)); return r.data; };
  const a0 = ok('login', null, { username: 'admin', password: 'Admin-pass-1' });
  ok('changePassword', a0.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = ok('login', null, { username: 'admin', password: 'Admin-pass-2' }).token;
  // the live company: CEO -> SGM, COO;  COO -> two managers, SGM;  SGM -> three managers and an assistant manager
  const titles = {}; [['CEO', 1], ['COO', 2], ['SGM', 3], ['M', 5], ['AM', 6]].forEach(([t, l]) => { titles[t] = ok('adminSaveJobTitle', A, { title: t, level: l }).id; });
  const users = {}, tok = {};
  [['ceo', 'CEO'], ['coo', 'COO'], ['sgm', 'SGM'], ['mgr1', 'M'], ['mgr2', 'M'], ['mgr3', 'M'], ['asst', 'AM']].forEach(([u, t]) => { users[u] = ok('adminSaveUser', A, { name: u.toUpperCase(), username: u, jobTitleId: titles[t] }).user.id; });
  const arrows = [['ceo', 'sgm'], ['ceo', 'coo'], ['coo', 'mgr2'], ['coo', 'mgr3'], ['coo', 'sgm'], ['sgm', 'mgr1'], ['sgm', 'mgr3'], ['sgm', 'mgr2'], ['sgm', 'asst']];
  ok('adminSaveLinks', A, { links: arrows.map(([f, t]) => ({ fromId: users[f], toId: users[t] })), note: 'v1' });
  Object.keys(users).forEach((u) => { const l = ok('login', null, { username: u, password: '1111' }); ok('changePassword', l.token, { oldPassword: '1111', newPassword: 'Changed-' + u + '-1' }); tok[users[u]] = ok('login', null, { username: u, password: 'Changed-' + u + '-1' }).token; });
  const level = { ceo: 1, coo: 2, sgm: 3 }, byUser = {}; Object.keys(users).forEach((u) => { byUser[users[u]] = u; });
  const rost = ['ceo', 'coo', 'sgm'].map((u) => ({ id: users[u], level: level[u], targets: arrows.filter(([f]) => f === u).map(([, t]) => users[t]).sort() }));
  const specs = ctx.simPlan_(rost, { m0, now }, cal);
  const PDF = Buffer.from('%PDF-1.4 tiny').toString('base64'), PNG = Buffer.from('not-a-real-picture-but-valid-bytes').toString('base64');
  const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const AUDIO = Buffer.from('fake-audio').toString('base64');
  let n = 0, voices = 0, files = 0, backs = 0;
  specs.forEach((s, i) => {
    clock = s.created;
    const task = ok('createTask', tok[s.by], { title: s.title, description: s.desc, assigneeIds: s.to, dueDate: s.due }).task;
    s.ev.forEach((e) => {
      clock = e[1];
      if (e[0] === 's') ok('postMessage', tok[e[2]], { taskId: task.id, text: e[3] });
      else if (e[0] === 'p') ok('setProgress', tok[e[2]], { taskId: task.id, progress: e[3] });
      else if (e[0] === 'v') { said = e[4]; voices++; ok('postVoice', tok[e[2]], { taskId: task.id, audioB64: AUDIO + (++n), wavB64: AUDIO, mime: 'audio/wav', secs: e[3] }); }
      else if (e[0] === 'f') { files++; ok('postFile', tok[e[2]], { taskId: task.id, name: 'doc-' + (++n) + '.pdf', b64: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n' + n).toString('base64'), caption: e[4] }); }
      else if (e[0] === 'i') { files++; ok('postFile', tok[e[2]], { taskId: task.id, name: e[3] + '-' + (++n) + '.png', b64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest' + n)]).toString('base64'), thumb: THUMB, w: 720, h: 500, caption: e[4] }); }
      else if (e[0] === 'back') { backs++; ok('rejectTask', tok[e[2]], { taskId: task.id, note: e[3] }); }
      else if (e[0] === 'ok') ok('approveTask', tok[e[2]], { taskId: task.id });
    });
    // opening a task marks it read, like the real run does for tasks that are still open
    if (!s.ev.some((e) => e[0] === 'ok') && !s.unread) { clock = now; [s.by].concat(s.to).forEach((w) => ok('getTask', tok[w], { taskId: task.id })); }
  });
  const archived = env.store.all('ArchiveIndex'), open = env.store.all('Tasks');
  assert.equal(archived.length + open.length, specs.length);
  assert.ok(archived.length >= 70 && open.length >= 8, 'archived ' + archived.length + ', open ' + open.length);
  assert.ok(archived.every((x) => x.storage === 'zip' && x.archiveNo > 0 && x.path.startsWith('EPP/')));
  assert.equal(new Set(archived.map((x) => x.archiveNo)).size, archived.length);                      // every archive number is different
  const folders = {}; archived.forEach((x) => { const p = x.path.split('/')[1]; folders[p] = (folders[p] || 0) + 1; });
  assert.deepEqual(Object.keys(folders).sort(), ['CEO', 'COO', 'SGM'], 'one folder per person who assigned, made when needed: ' + JSON.stringify(folders));
  assert.ok(archived.some((x) => x.fileCount > 0) && files > 0 && voices > 0 && backs > 0);
  assert.equal(env.store.all('Messages').filter((m) => !open.some((t) => t.id === m.taskId)).length, 0, 'archived tasks leave no live messages');
});
