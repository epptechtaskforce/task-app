'use strict';
// Alerts are queued while the person who acted is answered, and delivered right after (the app asks, a timer is the safety net).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

// ---- the queue itself (Adapters.gs), against a fake script-properties store and lock ----
const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\n;this.enq = notifyEnqueue_; this.drain = notifyDrain_; this.MAX = NOTIFY_QUEUE_MAX_;', ctx);
function fakeProps() { const m = {}; return { m, getProperty: (k) => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = v; }, deleteProperty: (k) => { delete m[k]; } }; }
const lock = (fn) => fn();
const titles = (list) => Array.from(list, (i) => i.p.t);   // (arrays made inside the vm have another prototype: compare plain values)
const item = (n, pad) => ({ p: { t: 'Alert ' + n, b: 'x'.repeat(pad || 10) }, r: [{ userId: 'U' + n, silent: false }] });

test('queued alerts come out once, in order, and the queue is empty afterwards', () => {
  const props = fakeProps();
  assert.equal(ctx.enq(props, lock, item(1)), true); assert.equal(ctx.enq(props, lock, item(2)), true);
  const out = ctx.drain(props, lock);
  assert.deepEqual(titles(out), ['Alert 1', 'Alert 2']);
  assert.equal(ctx.drain(props, lock).length, 0, 'a second drain (the timer right after the app) finds nothing: no alert is sent twice');
  assert.equal(Object.keys(props.m).length, 0, 'the property is removed, not left empty');
});

test('a full queue refuses the new alert (it is then sent at once) and keeps what it had', () => {
  const props = fakeProps();
  assert.equal(ctx.enq(props, lock, item(1)), true);
  assert.equal(ctx.enq(props, lock, item(2, ctx.MAX)), false, 'too big for the property');
  assert.deepEqual(titles(ctx.drain(props, lock)), ['Alert 1']);
});

test('a busy lock never loses or breaks anything: enqueue says "not queued", drain says "nothing now"', () => {
  const props = fakeProps();
  ctx.enq(props, lock, item(1));
  const busy = () => { const e = new Error('busy'); e.code = 'BUSY'; throw e; };
  assert.equal(ctx.enq(props, busy, item(2)), false);
  assert.equal(ctx.drain(props, busy).length, 0);
  assert.deepEqual(titles(ctx.drain(props, lock)), ['Alert 1'], 'what was queued is still there for the next flush');
});

test('a damaged queue is ignored instead of breaking the next action', () => {
  const props = fakeProps(); props.m.NOTIFY_QUEUE = '{not json';
  assert.equal(ctx.enq(props, lock, item(1)), true);
  assert.deepEqual(titles(ctx.drain(props, lock)), ['Alert 1']);
  props.m.NOTIFY_QUEUE = '{not json'; assert.equal(ctx.drain(props, lock).length, 0);
});

// ---- Core: who waits for the sending ----
function boot() {
  const calls = [];
  const env = createMemoryEnv({ hashRounds: 5, settings: { VAPID_PUBLIC_KEY: 'K' } });
  const real = env.notify; env.notify = (p, r, o) => { calls.push({ p, o }); return real(p, r, o); };
  const core = createCore(env);
  core.setup({ companyName: 'Acme', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  const call = (action, token, p) => core.handle(Object.assign({ action, token }, p || {}));
  const a = call('login', null, { username: 'admin', password: 'Admin-pass-1' }).data;
  call('changePassword', a.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = call('login', null, { username: 'admin', password: 'Admin-pass-2' }).data.token;
  const hi = call('adminSaveJobTitle', A, { title: 'Director', level: 1 }).data.id, lo = call('adminSaveJobTitle', A, { title: 'Worker', level: 2 }).data.id;
  const mgr = call('adminSaveUser', A, { name: 'mgr', username: 'mgr', jobTitleId: hi }).data.user, wk = call('adminSaveUser', A, { name: 'wrk', username: 'wrk', jobTitleId: lo }).data.user;
  call('adminSaveLinks', A, { links: [{ fromId: mgr.id, toId: wk.id }] });
  const login = (u) => { const l = call('login', null, { username: u, password: '1111' }).data; call('changePassword', l.token, { oldPassword: '1111', newPassword: u + '-pass-123' }); return call('login', null, { username: u, password: u + '-pass-123' }).data.token; };
  const M = login('mgr'), W = login('wrk');
  env.store.insert('PushSubs', { id: 'S1', userId: wk.id, endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a', label: 'phone', createdAt: 1, lastOk: 0, lastError: '' });
  return { env, call, M, W, wk, calls };
}

test('an alert for a new task or a message is handed over for queuing (not waited for); only the test button asks for "now"', () => {
  const { call, M, W, wk, calls } = boot();
  const t = call('createTask', M, { title: 'Roof', assigneeIds: [wk.id] }).data.task;
  assert.ok(calls.length >= 1 && calls.every((c) => !c.o.now), 'new task: queued, not sent while the manager waits');
  const n = calls.length;
  call('postMessage', M, { taskId: t.id, text: 'hello' });
  assert.ok(calls.length > n && calls.slice(n).every((c) => !c.o.now), 'message: queued');
  const k = calls.length;
  assert.equal(call('pushTest', W, {}).ok, true);
  assert.equal(calls[k].o.now, true, 'the test button reports how it went, so it sends at once');
});

test('flushAlerts is for signed-in people only and answers with a count, nothing else', () => {
  const { call, W } = boot();
  assert.equal(call('flushAlerts', null, {}).ok, false, 'no sign-in, no flush');
  const r = call('flushAlerts', W, {});
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.data), ['sent']);
});

// ---- the app (docs/js/api.js): asks for delivery after an alerting action, never waits for it ----
function client(answers) {
  const calls = [];
  const win = { APP_CONFIG: { backendUrl: 'https://example.test/exec' }, location: { search: '' } };
  const c = {
    window: win, location: win.location, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console,
    AbortController, setTimeout, clearTimeout, JSON, Promise, Object,
    fetch: (url, o) => new Promise((resolve) => {
      const action = JSON.parse(o.body).action; calls.push(action);
      const ans = answers[action] || { ok: true, data: {} };
      setTimeout(() => resolve({ json: async () => ans }), action === 'flushAlerts' ? 30 : 0);
    })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'api.js'), 'utf8'), c);
  return { api: win.Api, calls };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('after a message the app asks for delivery in the background; the message call is not held up by it', async () => {
  const c = client({});
  const t0 = Date.now(); await c.api.call('postMessage', { taskId: 'T1', text: 'hi' });
  assert.ok(Date.now() - t0 < 25, 'the answer does not wait for the 30 ms delivery request');
  await tick(80);
  assert.deepEqual(c.calls, ['postMessage', 'flushAlerts']);
});

test('reads and failed writes ask for no delivery; two actions close together share one request plus one catch-up', async () => {
  const c = client({ postMessage: { ok: false, code: 'VALIDATION', error: 'no' } });
  await c.api.call('listTasks');
  await assert.rejects(c.api.call('postMessage', { taskId: 'T1', text: 'x' }));
  await tick(60); assert.deepEqual(c.calls, ['listTasks', 'postMessage'], 'nothing to deliver after a read or a refused message');
  const d = client({});
  await Promise.all([d.api.call('setProgress', { taskId: 'T1', progress: 50 }), d.api.call('postMessage', { taskId: 'T1', text: 'a' }), d.api.call('approveTask', { taskId: 'T1' })]);
  await tick(150);
  assert.equal(d.calls.filter((a) => a === 'flushAlerts').length, 2, 'one while the first is running, one more after it so nothing waits for the timer');
});
