'use strict';
// The real zip-making code (Adapters.gs: DriveArchive_.saveZip) against a small fake Drive: the zip is opened again and every file in it must match what
// went in (name, size, content) before the loose originals are thrown away. If anything differs, the zip goes and the originals stay.
// A very big task is split into several zips (Google Drive refuses one file of about 50 MB); nothing is thrown away until every part was checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The limit of a part is 30 MB in real life. Here it is 30 KB (documents of 7 KB), so the test is quick: only the number differs, the code is the same.
const real = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');
assert.ok(real.includes('const ZIP_PART_BYTES_ = 30 * 1000 * 1000;'), 'the part limit is where the test expects it');
const src = real.replace('const ZIP_PART_BYTES_ = 30 * 1000 * 1000;', 'const ZIP_PART_BYTES_ = 30 * 1000;');

function blob(bytes, mime, name) {
  const b = { bytes: Buffer.from(bytes), mime, name, getName: () => b.name, setName: (n) => { b.name = n; return b; }, copyBlob: () => blob(b.bytes, b.mime, b.name), getDataAsString: (cs) => b.bytes.toString(/8859-1/.test(cs || '') ? 'latin1' : 'utf8') };
  return b;
}

// tamper(entries, zip) lets a test damage what "Drive" gives back when a zip is opened again
function setup(opts) {
  opts = opts || {};
  const stored = {}, trashedIds = [], created = [];
  Object.keys(opts.originals || {}).forEach((id) => { stored[id] = blob(opts.originals[id], 'application/pdf', id); });
  const person = {
    getName: () => 'Boss', getId: () => 'PERSON',
    createFile(z) { const f = { trashed: false, size: 100, blob: z, name: z.name, getSize() { return this.size; }, getBlob() { return this.blob; }, setTrashed(v) { this.trashed = v; }, getName() { return this.name; }, getId() { return 'ZIP' + created.length; } }; created.push(f); return f; }
  };
  const ctx = {
    Utilities: {
      newBlob: (c, m, n) => blob(c, m, n),
      zip: (blobs, name) => ({ entries: blobs.map((b) => blob(b.bytes, b.mime, b.name)), name }),
      unzip: (z) => { let e = z.entries.map((b) => blob(b.bytes, b.mime, b.name)); if (opts.tamper) e = opts.tamper(e, z); return e; }
    },
    DriveApp: { getFileById: (id) => { if (!stored[id]) throw new Error('gone'); return { getBlob: () => stored[id], getSize: () => stored[id].bytes.length, setTrashed: () => trashedIds.push(id) }; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.DriveArchive_ = DriveArchive_;', ctx);
  const arch = new ctx.DriveArchive_('root', 'EPP');
  arch.personFolder = () => person;
  return { arch, created, trashedIds };
}
const files = [{ name: 'Summary.txt', content: 'summary', mime: 'text/plain' }, { name: 'Conversation.txt', content: 'talk', mime: 'text/plain' }];
const moves = [{ id: 'F1', name: 'Files/a.pdf' }, { id: 'F2', name: 'Files/b.pdf' }];
const originals = { F1: 'document one', F2: 'document two' };
const job = () => ({ person: 'Boss', zipName: 'EPP-0001 - x.zip', files, moves, trashIds: ['F1', 'F2'] });

test('saveZip: when every file in the zip matches, the zip is kept and the loose originals are trashed', () => {
  const t = setup({ originals });
  const r = t.arch.saveZip(job());
  assert.equal(r.storage, 'zip'); assert.equal(r.path, 'EPP/Boss/EPP-0001 - x.zip'); assert.equal(r.parts, 1);
  assert.equal(t.created.length, 1); assert.equal(t.created[0].trashed, false); assert.deepEqual(t.trashedIds, ['F1', 'F2']);
});

test('saveZip: a file whose content differs inside the zip stops everything: zip removed, originals kept', () => {
  const t = setup({ originals, tamper: (e) => { e[2].bytes = Buffer.from('document 0ne'); return e; } });     // same size, one letter different
  assert.throws(() => t.arch.saveZip(job()), /content of Files\/a\.pdf differs.*Nothing was deleted/);
  assert.equal(t.created[0].trashed, true); assert.deepEqual(t.trashedIds, []);
});

test('saveZip: a missing, an extra or a cut-short file stops everything too', () => {
  for (const tamper of [(e) => e.slice(0, 3), (e) => e.concat([blob('x', 'text/plain', 'Surprise.txt')]), (e) => { e[3].bytes = e[3].bytes.subarray(0, 5); return e; }]) {
    const t = setup({ originals, tamper });
    assert.throws(() => t.arch.saveZip(job()), /could not be checked/);
    assert.equal(t.created[0].trashed, true); assert.deepEqual(t.trashedIds, []);
  }
});

test('saveZip: an unreadable zip, or an original that is gone, never loses anything', () => {
  let t = setup({ originals, tamper: () => { throw new Error('Drive could not open it'); } });
  assert.throws(() => t.arch.saveZip(job()), /Drive could not open it/); assert.equal(t.created[0].trashed, true); assert.deepEqual(t.trashedIds, []);
  t = setup({ originals: { F1: 'document one' } });                                                           // F2 was deleted from Drive: the approval fails, nothing is trashed
  assert.throws(() => t.arch.saveZip(job()), /gone/); assert.deepEqual(t.trashedIds, []);
});

test('saveZip: two files with the same name in the archive are refused before anything is made', () => {
  const t = setup({ originals });
  assert.throws(() => t.arch.saveZip({ person: 'Boss', zipName: 'z.zip', files, moves: [{ id: 'F1', name: 'Files/a.pdf' }, { id: 'F2', name: 'Files/a.pdf' }], trashIds: ['F1', 'F2'] }), /same name/);
  assert.equal(t.created.length, 0); assert.deepEqual(t.trashedIds, []);
});

// five documents of 7 KB: 28 KB fit in one part, the fifth makes a second one
const big = () => { const o = {}, m = []; for (let i = 1; i <= 5; i++) { o['B' + i] = Buffer.alloc(7000, 'x').fill(String(i), 0, 3); m.push({ id: 'B' + i, name: 'Files/big' + i + '.pdf' }); } return { o, m }; };

test('saveZip: a very big task is split into parts; every document is in exactly one part; Summary.txt says where; originals go only at the end', () => {
  const { o, m } = big(), t = setup({ originals: o });
  const r = t.arch.saveZip({ person: 'Boss', zipName: 'EPP-0007 - big.zip', files, moves: m, trashIds: m.map((x) => x.id) });
  assert.equal(r.parts, 2); assert.equal(r.path, 'EPP/Boss/EPP-0007 - big.zip');                                 // the History row points at part 1
  assert.deepEqual(t.created.map((f) => f.name), ['EPP-0007 - big.zip', 'EPP-0007 - big (part 2 of 2).zip']);
  const inside = t.created.map((f) => Array.from(f.blob.entries, (b) => b.name));
  assert.deepEqual(inside[0], ['Summary.txt', 'Conversation.txt', 'Files/big1.pdf', 'Files/big2.pdf', 'Files/big3.pdf', 'Files/big4.pdf']);
  assert.deepEqual(inside[1], ['Files/big5.pdf']);
  const summary = t.created[0].blob.entries[0].getDataAsString();
  assert.ok(summary.startsWith('summary') && /IN 2 ZIP FILES/.test(summary) && summary.includes('EPP-0007 - big (part 2 of 2).zip') && summary.includes('- Files/big5.pdf'), summary);
  assert.equal(t.created[0].blob.entries[1].getDataAsString(), 'talk');                                          // the conversation is untouched
  assert.deepEqual(t.trashedIds.sort(), ['B1', 'B2', 'B3', 'B4', 'B5']);
  assert.ok(t.created.every((f) => !f.trashed));
});

test('saveZip: if the LAST part fails its check, every part is removed and every original stays', () => {
  const { o, m } = big(), t = setup({ originals: o, tamper: (e, z) => { if (/part 2/.test(z.name)) e[0].bytes = Buffer.from('damaged'); return e; } });
  assert.throws(() => t.arch.saveZip({ person: 'Boss', zipName: 'EPP-0007 - big.zip', files, moves: m, trashIds: m.map((x) => x.id) }), /could not be checked/);
  assert.equal(t.created.length, 2); assert.ok(t.created.every((f) => f.trashed)); assert.deepEqual(t.trashedIds, []);
});
