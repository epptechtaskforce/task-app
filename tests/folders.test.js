'use strict';
// The company folder (EPP_Task_Manager) and the people's folders are found or made again whenever they are missing, trashed or still carry the old name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');

// A tiny fake Drive: folders with a name, a parent, a trashed flag; iterators skip trashed ones (like the real DriveApp).
function world() {
  let n = 0; const all = {}, props = {};
  const mk = (name, parent) => {
    const f = { id: 'F' + (++n), name, parent, trashed: false, kids: [] };
    f.getId = () => f.id; f.getName = () => f.name; f.setName = (v) => { f.name = v; }; f.isTrashed = () => f.trashed || (!!f.parent && f.parent.isTrashed()); f.setTrashed = (v) => { f.trashed = v; };
    f.getFoldersByName = (nm) => iter(f.kids.filter((k) => k.name === nm && !k.isTrashed()));
    f.createFolder = (nm) => mk(nm, f);
    all[f.id] = f; if (parent) parent.kids.push(f); return f;
  };
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const root = mk('My Drive', null);
  const ctx = {
    DriveApp: { getRootFolder: () => root, getFolderById: (id) => { if (!all[id]) throw new Error('not found'); return all[id]; }, createFolder: (nm) => mk(nm, root) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.DriveArchive_ = DriveArchive_; this.DriveFiles_ = DriveFiles_; this.taskAppFolder_ = taskAppFolder_;', ctx);
  return { ctx, root, props, mk, all };
}
const live = (root, name) => root.kids.filter((k) => k.name === name && !k.trashed);

test('no company folder yet: it is made, called EPP_Task_Manager, and remembered', () => {
  const w = world(), a = new w.ctx.DriveArchive_('root');
  const f = a.eppFolder();
  assert.equal(f.getName(), 'EPP_Task_Manager'); assert.equal(w.props.EPP_FOLDER_ID, f.getId());
  assert.equal(a.eppFolder().getId(), f.getId(), 'the second call finds it, no duplicate');
  assert.equal(live(w.root, 'EPP_Task_Manager').length, 1);
});

test('a company folder that still has the old name EPP is renamed in place, with everything in it', () => {
  const w = world(), old = w.mk('EPP', w.root), inside = w.mk('Kamala', old); w.props.EPP_FOLDER_ID = old.getId();
  const f = new w.ctx.DriveArchive_('root').eppFolder();
  assert.equal(f.getId(), old.getId()); assert.equal(f.getName(), 'EPP_Task_Manager'); assert.equal(inside.parent, old);
});

test('a company folder that was thrown in the trash (or deleted) is made again, never written into', () => {
  const w = world(), a = new w.ctx.DriveArchive_('root'), first = a.eppFolder();
  first.setTrashed(true);
  const second = a.eppFolder();
  assert.notEqual(second.getId(), first.getId()); assert.equal(second.getName(), 'EPP_Task_Manager'); assert.equal(w.props.EPP_FOLDER_ID, second.getId());
  delete w.all[second.getId()]; second.parent.kids.splice(second.parent.kids.indexOf(second), 1);   // really gone: Drive says "not found" and no longer lists it
  const third = a.eppFolder();
  assert.ok(w.all[third.getId()] && !third.isTrashed());
});

test('a person without a folder gets one on the spot; a person with one keeps it; a trashed one is replaced', () => {
  const w = world(), a = new w.ctx.DriveArchive_('root');
  const p1 = a.personFolder('Kamala Perera');
  assert.equal(p1.parent.getName(), 'EPP_Task_Manager'); assert.equal(a.personFolder('Kamala Perera').getId(), p1.getId());
  assert.notEqual(a.personFolder('Nimal').getId(), p1.getId());
  p1.setTrashed(true);
  const p2 = a.personFolder('Kamala Perera');
  assert.notEqual(p2.getId(), p1.getId()); assert.ok(!p2.isTrashed());
});

test('the Voice folder is found or made again when it was deleted, so uploads keep working', () => {
  const w = world(), home = w.mk('TaskApp', w.root), voice = w.mk('Voice', home);
  w.props.ROOT_FOLDER_ID = home.getId(); w.props.VOICE_FOLDER_ID = voice.getId();
  const files = new w.ctx.DriveFiles_(voice.getId(), true);
  assert.equal(files.dir().getId(), voice.getId());
  voice.setTrashed(true);
  const again = files.dir();
  assert.notEqual(again.getId(), voice.getId()); assert.equal(again.getName(), 'Voice'); assert.equal(again.parent, home); assert.equal(w.props.VOICE_FOLDER_ID, again.getId());
  home.setTrashed(true);                                                           // even the whole TaskApp folder
  const f3 = files.dir();
  assert.ok(!f3.isTrashed() && !f3.parent.isTrashed() && f3.getName() === 'Voice');
});
