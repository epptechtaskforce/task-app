// What the service worker does with a push message and with a tap on a notification (run in a fake worker).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const SCOPE = 'https://example.org/app/';

function worker(opts) {
  opts = opts || {};
  const handlers = {}, shown = [], opened = [], messages = [], closed = [];
  const clientsNow = opts.clients || [];
  const self = {
    navigator: { userAgent: opts.ua || 'Mozilla/5.0 (Linux; Android 14) Chrome/130' },
    registration: { scope: SCOPE, showNotification: (title, o) => { shown.push({ title, o }); return Promise.resolve(); } },
    clients: {
      claim: () => Promise.resolve(), openWindow: (u) => { opened.push(u); return Promise.resolve({}); },
      matchAll: () => Promise.resolve(clientsNow.map((c) => Object.assign({ postMessage: (m) => messages.push([c.url, m]), focus() { c.focused = true; return Promise.resolve(this); } }, c)))
    },
    skipWaiting() {}, addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  vm.runInContext(code, vm.createContext({ self, fetch: () => Promise.resolve({}), Response: function () {}, console, Promise }));
  const fire = async (type, ev) => { const waits = []; ev.waitUntil = (p) => waits.push(p); handlers[type](ev); await Promise.all(waits); };
  return {
    shown, opened, messages, closed,
    push: (data, raw) => fire('push', { data: data === undefined ? null : { json: () => { if (raw) throw new Error('not json'); return data; }, text: () => String(raw || '') } }),
    click: (url) => fire('notificationclick', { notification: { close: () => closed.push(1), data: url === undefined ? {} : { url } } })
  };
}
const msg = { t: 'WK1 · Roof', b: 'The tiles arrived', u: '#/task/T123', g: 'chat:T123', c: 'messages', a: 'Open', ts: 1700000000000 };

test('a push message becomes a clear notification: title, text, the app icon, a small status icon, a tag so newer ones replace older ones', async () => {
  const w = worker(); await w.push(msg);
  assert.equal(w.shown.length, 1);
  const n = w.shown[0];
  assert.equal(n.title, 'WK1 · Roof'); assert.equal(n.o.body, 'The tiles arrived'); assert.equal(n.o.icon, 'icon-192.png'); assert.equal(n.o.badge, 'badge-96.png');
  assert.equal(n.o.tag, 'chat:T123'); assert.equal(n.o.renotify, true); assert.equal(n.o.silent, false); assert.equal(n.o.timestamp, 1700000000000);
  assert.equal(JSON.stringify(n.o.actions), JSON.stringify([{ action: 'open', title: 'Open' }])); assert.equal(JSON.stringify(n.o.data), JSON.stringify({ url: '#/task/T123' }));
});

test('quiet hours: the alert is shown without sound (and never both "renotify" and "silent", which browsers reject)', async () => {
  const w = worker(); await w.push(Object.assign({}, msg, { s: 1 }));
  assert.equal(w.shown[0].o.silent, true); assert.equal(w.shown[0].o.renotify, false);
});

test('a message with no text or no data still shows something sensible; a strange address falls back to the task list', async () => {
  const w = worker(); await w.push(undefined); await w.push(null, 'plain words'); await w.push({ t: 'Hi', u: 'https://evil.example/' }); await w.push({ t: 'Hi', u: '#/task/..%2F..' });
  assert.equal(w.shown[0].title, 'Task Manager'); assert.equal(w.shown[1].o.body, 'plain words');
  assert.equal(w.shown[2].o.data.url, '#/tasks'); assert.equal(w.shown[3].o.data.url, '#/task/..%2F..', 'odd but harmless: it is only a place inside the app');
});

test('someone looking at that very conversation is not buzzed about it (except on iPhone, which insists on an alert every time)', async () => {
  const looking = [{ url: SCOPE + '#/task/T123', visibilityState: 'visible', focused: true }];
  const w = worker({ clients: looking }); await w.push(msg);
  assert.equal(w.shown.length, 0);
  await w.push(Object.assign({}, msg, { g: 'task:T123', u: '#/task/T123' }));
  assert.equal(w.shown.length, 1, 'only chat messages are held back, a new task or approval always shows');
  const other = worker({ clients: [{ url: SCOPE + '#/tasks', visibilityState: 'visible', focused: true }] }); await other.push(msg);
  assert.equal(other.shown.length, 1, 'looking at a different screen: show it');
  const hidden = worker({ clients: [{ url: SCOPE + '#/task/T123', visibilityState: 'hidden', focused: false }] }); await hidden.push(msg);
  assert.equal(hidden.shown.length, 1, 'the app in the background: show it');
  const iphone = worker({ clients: looking, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }); await iphone.push(msg);
  assert.equal(iphone.shown.length, 1);
});

test('tapping a notification: the open app is brought forward and sent to that task', async () => {
  const w = worker({ clients: [{ url: SCOPE + '#/tasks' }, { url: 'https://other.example/' }] });
  await w.click('#/task/T123');
  assert.equal(w.closed.length, 1);
  assert.equal(JSON.stringify(w.messages), JSON.stringify([[SCOPE + '#/tasks', { type: 'open', hash: '#/task/T123' }]]));
  assert.deepEqual(w.opened, []);
});

test('tapping a notification when the app is closed opens it directly on that task; a bad address opens the task list', async () => {
  const w = worker(); await w.click('#/history/T9'); await w.click('javascript:alert(1)'); await w.click(undefined);
  assert.deepEqual(w.opened, [SCOPE + '#/history/T9', SCOPE + '#/tasks', SCOPE + '#/tasks']);
});

test('the worker still caches nothing and asks the network for pages every time', () => {
  assert.ok(!/caches\.(open|put|match)/.test(code));
  assert.match(code, /cache: 'no-cache'/);
});
