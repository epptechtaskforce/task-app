'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Loads docs/js/api.js with a fake browser whose fetch is scripted per attempt.
function client(script) {
  const calls = [];
  const win = { APP_CONFIG: { backendUrl: 'https://example.test/exec' }, location: { search: '' } };
  const ctx = {
    window: win, location: win.location, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console,
    AbortController, setTimeout, clearTimeout, JSON, Promise, Object,
    fetch: (url, o) => new Promise((resolve, reject) => {
      const step = script[calls.length] || script[script.length - 1];
      calls.push(JSON.parse(o.body).action);
      if (step === 'hang') o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      else if (step === 'down') reject(new TypeError('failed to fetch'));
      else resolve({ json: async () => ({ ok: true, data: { n: calls.length } }) });
    }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'api.js'), 'utf8').replace('20000 :', '60 :'), ctx);   // 60 ms instead of 20 s
  return { api: win.Api, calls };
}

test('a read that hangs is asked a second time and succeeds', async () => {
  const c = client(['hang', 'ok']);
  const r = await c.api.call('listTasks');
  assert.equal(r.n, 2); assert.deepEqual(c.calls, ['listTasks', 'listTasks']);
});

test('a read that hangs twice gives a plain "server is slow" message', async () => {
  const c = client(['hang', 'hang']);
  await assert.rejects(c.api.call('getTask', { taskId: 'x' }), (e) => /slow/.test(e.message) && e.network === true);
  assert.equal(c.calls.length, 2);
});

test('a write is never repeated automatically', async () => {
  const c = client(['down', 'ok']);
  await assert.rejects(c.api.call('postMessage', { taskId: 'x', text: 'hi' }), (e) => /Could not reach/.test(e.message));
  assert.deepEqual(c.calls, ['postMessage']);
});
