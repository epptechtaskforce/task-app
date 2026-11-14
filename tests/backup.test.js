'use strict';
// The nightly backups (Setup.gs: nightlyJob): the database sheet, and the full history sheet with 14 nightly copies plus 12 monthly ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Setup.gs'), 'utf8');

function setup(opts) {
  opts = opts || {};
  let clock = 0, maintenance = 0;
  const folder = { files: [] };
  const mkFile = (name) => { const f = { name, created: clock, getName: () => name, getDateCreated: () => f.created, setTrashed: () => { folder.files = folder.files.filter((x) => x !== f); } }; return f; };
  const source = (id) => ({ makeCopy: (name, to) => { if (opts.failHistoryCopy && id === 'H') throw new Error('Drive said no'); const f = mkFile(name); to.files.push(f); return f; } });
  const it = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  folder.getFiles = () => it(folder.files.slice()); folder.getFilesByName = (n) => it(folder.files.filter((f) => f.name === n));
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ BACKUP_FOLDER_ID: 'B', SPREADSHEET_ID: 'S' })[k] }) },
    DriveApp: { getFolderById: () => folder, getFileById: (id) => source(id) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => 'UTC' },
    getCore_: () => ({ maintenance: () => { maintenance++; return {}; } }),
    makeEnv_: () => ({ history: { fileId: () => (opts.noHistory ? '' : 'H') } }),
    Logger: { log: () => {} }
  };
  vm.createContext(ctx); vm.runInContext(src + '\n;this.nightlyJob = nightlyJob;', ctx);
  return {
    folder, maintenance: () => maintenance,
    night: (date) => { clock = date.getTime(); ctx.nightlyJob(date); },
    names: (prefix) => folder.files.map((f) => f.name).filter((n) => n.indexOf(prefix) === 0).sort()
  };
}
const nights = (t, from, n) => { for (let i = 0; i < n; i++) t.night(new Date(Date.UTC(2026, 0, 1 + from + i, 2, 0, 0))); };   // night number `from` + i since 1 Jan 2026

test('nightly backups: the database sheet keeps 14 copies, the full history sheet keeps 14 nightly plus 12 monthly, a hand-made safety copy is never thrown away', () => {
  const t = setup();
  t.folder.files.push({ name: 'TaskApp BEFORE CLEAN START 2026-11-14 1421', created: -1, getName() { return this.name; }, getDateCreated() { return this.created; }, setTrashed() { t.folder.files = t.folder.files.filter((x) => x !== this); } });
  nights(t, 0, 40);                                                                      // 1 Jan - 9 Feb 2026
  assert.equal(t.names('TaskApp backup ').length, 14); assert.equal(t.names('EPP History backup ').length, 14);
  assert.deepEqual(t.names('EPP History monthly '), ['EPP History monthly 2026-01', 'EPP History monthly 2026-02']);
  assert.equal(t.names('TaskApp backup ').slice(-1)[0], 'TaskApp backup 2026-02-09');     // the newest copies are kept
  assert.equal(t.names('EPP History backup ')[0], 'EPP History backup 2026-01-27');
  nights(t, 40, 430);                                                                    // a year and more of nights
  assert.equal(t.names('EPP History monthly ').length, 12);
  assert.equal(t.names('EPP History monthly ')[0], 'EPP History monthly 2026-05');         // 16 months passed (Jan 2026 - Apr 2027): the oldest four have gone, the last 12 stay
  assert.equal(t.names('TaskApp backup ').length, 14); assert.equal(t.names('EPP History backup ').length, 14);
  assert.equal(t.names('TaskApp BEFORE').length, 1, 'a safety copy made by hand stays');
  assert.equal(t.maintenance(), 470);                                                    // the clean-up ran every night
});

test('nightly backups: running the job again on the same day makes no second copy', () => {
  const t = setup(); const d = new Date(Date.UTC(2026, 5, 10, 2));
  t.night(d); t.night(d); t.night(new Date(d.getTime() + 3600000));
  assert.deepEqual(t.names('').length, 3);                                                // one database copy, one history copy, one monthly copy
  assert.equal(t.maintenance(), 3);
});

test('nightly backups: no full history sheet yet is fine; a failing copy of it never stops the database backup or the clean-up', () => {
  let t = setup({ noHistory: true }); nights(t, 0, 3);
  assert.equal(t.names('TaskApp backup ').length, 3); assert.equal(t.names('EPP History').length, 0); assert.equal(t.maintenance(), 3);
  t = setup({ failHistoryCopy: true }); nights(t, 0, 3);
  assert.equal(t.names('TaskApp backup ').length, 3); assert.equal(t.names('EPP History').length, 0); assert.equal(t.maintenance(), 3);
});
