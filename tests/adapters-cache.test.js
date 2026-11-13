'use strict';
// Tests the table cache in backend/Adapters.gs (SheetsStore_) against fake Apps Script services.
// The fake CacheService enforces the real 100 KB-per-value limit (measured in UTF-8 bytes), so Sinhala text is a real test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeWorld() {
  const stats = { sheetReads: 0, opens: 0, created: [] };
  const cacheData = new Map();
  const cacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { return cacheData.has(k) ? cacheData.get(k) : null; },
        getAll: function (ks) { const o = {}; ks.forEach(function (k) { if (cacheData.has(k)) o[k] = cacheData.get(k); }); return o; },
        put: function (k, v) { if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: value'); cacheData.set(k, String(v)); },
        putAll: function (o) { Object.keys(o).forEach(function (k) { this.put(k, o[k]); }, this); },
        remove: function (k) { cacheData.delete(k); }
      };
    }
  };
  function FakeSheet() { this.rows = [[]]; this.maxRows = 100; }   // rows[0] = header
  FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
  FakeSheet.prototype.getMaxRows = function () { return Math.max(this.maxRows, this.rows.length); };
  FakeSheet.prototype.getMaxColumns = function () { return 30; };
  FakeSheet.prototype.insertColumnsAfter = function () {};
  FakeSheet.prototype.setFrozenRows = function () {};
  FakeSheet.prototype.insertRowsAfter = function (r, n) { this.maxRows = r + n; };
  FakeSheet.prototype.getRange = function (r, c, nr, nc) {
    const sh = this;
    return {
      getValues: function () { stats.sheetReads++; const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: function (vals) { vals.forEach(function (v, i) { const row = sh.rows[r - 1 + i] || (sh.rows[r - 1 + i] = []); v.forEach(function (x, j) { row[c - 1 + j] = x; }); }); return this; },
      setFontWeight: function () { return this; },
      clearContent: function () { for (let i = 0; i < nr; i++) { const idx = r - 1 + i; if (idx < sh.rows.length) sh.rows[idx] = []; } while (sh.rows.length > 1 && !sh.rows[sh.rows.length - 1].some(function (x) { return x !== '' && x !== undefined; })) sh.rows.pop(); },
      setNumberFormat: function () { return this; }
    };
  };
  const sheets = { Users: new FakeSheet(), Settings: new FakeSheet() };
  const ctx = vm.createContext({
    console, Date, JSON, Math, Object, String, Number, Array, Error,
    CacheService: cacheService,
    Utilities: { getUuid: function () { return require('crypto').randomUUID(); } },
    SpreadsheetApp: { openById: function () { stats.opens++; return {
      getSheetByName: function (n) { return sheets[n] || null; },
      insertSheet: function (n) { stats.created.push(n); return (sheets[n] = new FakeSheet()); },
      getSheets: function () { return Object.keys(sheets).map(function (k) { return sheets[k]; }); },
      deleteSheet: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; } }; } }
  });
  const root = path.join(__dirname, '..', 'backend');
  vm.runInContext(fs.readFileSync(path.join(root, 'Core.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Adapters.gs'), 'utf8'), ctx);
  const mk = function () { return vm.runInContext('new SheetsStore_("spreadsheet-id-1234567890")', ctx); };
  return { stats: stats, sheets: sheets, cacheData: cacheData, mk: mk, run: function (code) { return vm.runInContext(code, ctx); } };
}

test('pure-JS SHA-256 gives exactly the same hashes as Node crypto (so existing passwords keep working)', () => {
  const crypto = require('crypto'), w = makeWorld();
  const samples = ['', 'a', 'abc', 'salt:password', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(1000),
    'මෙය සිංහල මුරපදයක්', 'emoji 😀 mix', 'token:' + 'f'.repeat(64), 'Ünïcödé ñ 日本語'];
  samples.forEach(function (s) {
    assert.equal(w.run('sha256Hex_(' + JSON.stringify(s) + ')'), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s).slice(0, 30));
  });
  // 200 chained rounds like hashPassword() does
  let expect = crypto.createHash('sha256').update('salt:pw').digest('hex');
  for (let i = 0; i < 200; i++) expect = crypto.createHash('sha256').update(expect + 'saltpw').digest('hex');
  assert.equal(w.run('(function(){ let h = sha256Hex_("salt:pw"); for (let i = 0; i < 200; i++) h = sha256Hex_(h + "saltpw"); return h; })()'), expect);
});

const user = function (i, name) { return { id: 'U' + i, name: name || ('User ' + i), username: 'user' + i, jobTitleId: '', isAdmin: false, active: true, passSalt: 's', passHash: 'h', mustChange: false, failCount: 0, lockedUntil: 0, createdAt: 1, lastLogin: 0 }; };

test('reads are served from the cache and the spreadsheet is not even opened', () => {
  const w = makeWorld(), a = w.mk();
  a.insert('Users', user(1));
  assert.equal(a.all('Users').length, 1);                 // first read fills the cache
  const reads = w.stats.sheetReads, opens = w.stats.opens;
  const b = w.mk();                                       // a different request (new store object)
  assert.equal(JSON.stringify(b.all('Users')), JSON.stringify(a.all('Users')));
  assert.equal(w.stats.sheetReads, reads, 'second request must not read the sheet');
  assert.equal(w.stats.opens, opens, 'second request must not open the spreadsheet');
});

test('every kind of write invalidates the cache (other requests see it at once)', () => {
  const w = makeWorld(), a = w.mk(), b = w.mk();
  a.insert('Users', user(1)); a.insert('Users', user(2));
  assert.equal(b.all('Users').length, 2);                 // b caches
  a.insert('Users', user(3));
  assert.equal(b.all('Users').length, 3, 'insert');
  a.update('Users', 'U2', { name: 'Renamed' });
  assert.equal(b.all('Users').filter(function (u) { return u.id === 'U2'; })[0].name, 'Renamed', 'update');
  a.insertMany('Users', [user(4), user(5)]);
  assert.equal(b.all('Users').length, 5, 'insertMany');
  assert.equal(a.removeWhere('Users', function (u) { return u.id === 'U1'; }), 1);
  assert.equal(b.all('Users').length, 4, 'removeWhere');
  assert.equal(a.removeWhere('Users', function () { return false; }), 0);
});

test('a reader that started before a write cannot leave stale data behind', () => {
  const w = makeWorld(), reader = w.mk(), writer = w.mk();
  writer.insert('Users', user(1));
  // Simulate the race by hand: the reader looks up the version, then the writer writes and bumps, then the reader stores its (old) result.
  const c = reader.cacheRead('Users');                    // miss, version V1 (or hit)
  const oldRows = reader.readSheet('Users');
  writer.insert('Users', user(2));                        // write + new version
  reader.cacheWrite('Users', c.ver, oldRows);             // the late store goes to the OLD version
  assert.equal(w.mk().all('Users').length, 2, 'new readers must see the write');
});

test('big tables with Sinhala and emoji text survive chunking and respect the 100 KB limit', () => {
  const w = makeWorld(), a = w.mk();
  const sinhala = 'මෙය සිංහල පණිවිඩයක් 😀 ';
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push(user(i, sinhala.repeat(5) + i));
  a.insertMany('Users', rows);
  const first = a.all('Users');
  assert.equal(first.length, 400);
  const keys = Array.from(w.cacheData.keys()).filter(function (k) { return k.indexOf(':d:Users:') > 0; });
  assert.ok(keys.length > 1, 'should be stored in several chunks, got ' + keys.length);
  const reads = w.stats.sheetReads;
  const again = w.mk().all('Users');
  assert.equal(w.stats.sheetReads, reads, 'served from cache');
  assert.equal(JSON.stringify(again), JSON.stringify(first));   // compared as text: the fake VM has its own Object prototypes
  assert.equal(again[399].name, sinhala.repeat(5) + 399);
});

test('tables too big for the cache are still read correctly from the sheet', () => {
  const w = makeWorld(), a = w.mk();
  const filler = 'x'.repeat(2000), rows = [];
  for (let i = 0; i < 400; i++) rows.push(user(i, filler));  // ~800 KB of JSON: over the limit
  a.insertMany('Users', rows);
  assert.equal(a.all('Users').length, 400);
  assert.equal(w.mk().all('Users').length, 400);
});

test('keys include the spreadsheet id (smokeTest uses a temporary sheet)', () => {
  const w = makeWorld(), a = w.mk();
  a.insert('Users', user(1)); a.all('Users');
  assert.ok(w.cacheData.size > 0);
  assert.ok(Array.from(w.cacheData.keys()).every(function (k) { return k.startsWith('ts:1234567890:'); }));
});

test('a table added by a newer version is created on first use (no manual setup step)', () => {
  const w = makeWorld(), a = w.mk();
  assert.equal(w.sheets.Profiles, undefined);
  assert.equal(a.all('Profiles').length, 0);                       // a read creates the sheet and finds it empty
  assert.deepEqual(w.stats.created, ['Profiles']);
  a.insert('Profiles', { userId: 'U1', bio: 'hello', photo: '', ver: 5 });
  assert.equal(a.all('Profiles').length, 1);
  assert.equal(a.all('Profiles')[0].bio, 'hello');
  assert.equal(w.sheets.Profiles.rows[0].join('|'), 'userId|bio|photo|ver');   // header row written
  assert.deepEqual(w.stats.created, ['Profiles']);                 // created once, not again
  assert.throws(() => w.mk().all('NoSuchTable'));                  // unknown names still fail loudly
});
