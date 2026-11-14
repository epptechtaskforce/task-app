'use strict';
// The app keeps itself current: it asks the server which version is live and reloads (when safe) or offers an Update button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'update.js'), 'utf8');

// Runs update.js as version `mine` in a fake browser; `live` is what the server's page says; opts: typing, popup
function browser(mine, live, opts) {
  opts = opts || {};
  const log = { reloads: 0, fetched: [], banners: 0, buttons: [] };
  const store = {};
  const el = () => ({ appendChild() {}, addEventListener(t, f) { this.fn = f; log.buttons.push(this); }, setAttribute() {}, set className(v) { this._c = v; }, get className() { return this._c; } });
  const win = {
    addEventListener() {}, location: { href: 'https://example.test/task-app/#/tasks', reload() { log.reloads++; } },
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }
  };
  const ctx = {
    window: win, location: win.location, sessionStorage: win.sessionStorage, URL, setTimeout: () => 0, setInterval: () => 0, console,
    document: {
      currentScript: { src: 'https://example.test/task-app/js/update.js?v=' + mine },
      addEventListener() {}, visibilityState: 'visible', body: { appendChild() { log.banners++; } },
      createElement: () => el(),
      get activeElement() { return opts.typing ? { tagName: 'TEXTAREA', value: 'half a message' } : { tagName: 'BODY' }; },
      querySelector: () => (opts.popup ? {} : null)
    },
    fetch: (url, init) => { log.fetched.push([url, init && init.cache]); return Promise.resolve({ ok: true, text: () => Promise.resolve('<script src="js/app.js?v=' + live + '"></script>') }); }
  };
  vm.runInNewContext(src, ctx);
  return { Updater: win.Updater, log };
}

test('update: same version does nothing, and the server is asked with a cache-bypassing request for the page the app opens from', async () => {
  const b = browser('20261163', '20261163');
  assert.equal(b.Updater.version, '20261163');
  assert.equal(await b.Updater.check(true), 'current');
  assert.equal(b.log.reloads, 0); assert.equal(b.log.banners, 0);
  assert.deepEqual(b.log.fetched[0], ['https://example.test/task-app/', 'reload']);
});

test('update: a newer version reloads the app by itself when nothing would be lost', async () => {
  const b = browser('20261163', '20261164');
  assert.equal(await b.Updater.check(true), 'reloading');
  assert.equal(b.log.reloads, 1);
});

test('update: while something is typed or a popup is open it only shows an Update button, and never reloads in a loop', async () => {
  let b = browser('20261163', '20261164', { typing: true });
  assert.equal(await b.Updater.check(true), 'available');
  assert.equal(b.log.reloads, 0); assert.equal(b.log.banners, 1);
  b = browser('20261163', '20261164', { popup: true });
  assert.equal(await b.Updater.check(true), 'available'); assert.equal(b.log.reloads, 0);
  // a stale copy that keeps answering with the old page: at most two automatic reloads
  b = browser('20261163', '20261164');
  const results = [];
  for (let i = 0; i < 4; i++) { b.Updater.check(true); results.push(await b.Updater.check(true)); }
  assert.ok(b.log.reloads <= 2, 'reloads: ' + b.log.reloads);
});

test('update: a person asking ("Check for updates") always gets an answer, and the page ships it all', async () => {
  const b = browser('20261163', '20261163');
  await b.Updater.check(true);
  assert.equal(await b.Updater.check(false), 'current');                    // asked again within a minute: still answers
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/update.js?v=') >= 0 && html.indexOf('js/update.js') < html.indexOf('js/app.js'));
  const sw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
  assert.ok(sw.includes("cache: 'no-cache'"));
});
