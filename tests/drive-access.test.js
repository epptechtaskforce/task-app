'use strict';
// The real Drive sharing code (Adapters.gs: DriveArchive_.shareFolder / unshareFolder) against a small fake Drive: view-only, one folder, never wider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');

function fakeDrive(owner) {
  const NONE = 'NONE', VIEW = 'VIEW', EDIT = 'EDIT', PRIVATE = 'PRIVATE', LINK = 'ANYONE_WITH_LINK';
  const mkFolder = (name) => {
    const f = { name, viewers: new Set(), editors: new Set(), access: PRIVATE, children: {}, id: 'ID-' + name,
      getName: () => name, getId: () => f.id,
      getAccess: (e) => f.editors.has(e) ? EDIT : f.viewers.has(e) ? VIEW : NONE,
      getSharingAccess: () => f.access, setSharing: (a) => { f.access = a; },
      addViewer: (e) => { f.editors.delete(e); f.viewers.add(e); }, removeViewer: (e) => { f.viewers.delete(e); },
      getFoldersByName: (n) => { const c = f.children[n]; let done = !c; return { hasNext: () => !done, next: () => { done = true; return c; } }; },
      createFolder: (n) => (f.children[n] = mkFolder(n)) };
    return f;
  };
  const root = mkFolder('root'), epp = mkFolder('EPP'); root.children.EPP = epp;
  const drive = { Permission: { NONE, VIEW, EDIT }, Access: { PRIVATE, ANYONE_WITH_LINK: LINK }, getRootFolder: () => root, getFolderById: (id) => (id === 'ID-EPP' ? epp : null) };
  return { root, epp, drive, session: { getEffectiveUser: () => ({ getEmail: () => owner }) } };
}
function archiveWith(fake) {
  const ctx = { DriveApp: fake.drive, Session: fake.session, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.DriveArchive_ = DriveArchive_;', ctx);
  return new ctx.DriveArchive_('archive-root', 'ID-EPP');
}

test('shareFolder: one person, one folder, view-only, not by link; nothing else is touched', () => {
  const fake = fakeDrive('owner@gmail.com'), a = archiveWith(fake);
  fake.epp.children.Kamala = fake.epp.createFolder('Kamala'); fake.epp.children.Other = fake.epp.createFolder('Other');
  fake.epp.children.Kamala.access = 'ANYONE_WITH_LINK';                       // somebody had opened it by link: it is closed again
  const r = a.shareFolder({ person: 'Kamala', email: ' Kamala@Gmail.com ' });
  assert.equal(r.folderId, 'ID-Kamala');
  assert.ok(fake.epp.children.Kamala.viewers.has('kamala@gmail.com') && fake.epp.children.Kamala.viewers.size === 1);
  assert.equal(fake.epp.children.Kamala.access, 'PRIVATE');
  assert.equal(fake.epp.children.Other.viewers.size, 0);                       // another person's folder is untouched
  assert.equal(fake.epp.viewers.size + fake.root.viewers.size, 0);             // never the EPP folder or the root
  assert.equal(fake.epp.children.Kamala.editors.size, 0);                      // never an editor
});

test('shareFolder: refuses the owner, an empty email, and an account that already reaches more of the Drive', () => {
  const fake = fakeDrive('owner@gmail.com'), a = archiveWith(fake);
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'OWNER@gmail.com' }), /owns the app/);
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: '' }), /No Google account/);
  fake.epp.viewers.add('wide@gmail.com');
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'wide@gmail.com' }), /wider access/);
  fake.root.viewers.add('wide2@gmail.com');
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'wide2@gmail.com' }), /wider access/);
  assert.equal((fake.epp.children.Kamala || { viewers: new Set() }).viewers.size, 0);
});

test('shareFolder: if Google does not record view-only access, it is taken back and the admin is told', () => {
  const fake = fakeDrive('owner@gmail.com'), a = archiveWith(fake);
  const folder = a.personFolder('Kamala'); folder.addViewer = (e) => { folder.editors.add(e); };      // pretend Drive made them an editor
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'k@gmail.com' }), /did not record view-only/);
  folder.editors.clear();
});

test('unshareFolder: withdraws the access, and says so when it is still there', () => {
  const fake = fakeDrive('owner@gmail.com'), a = archiveWith(fake);
  a.shareFolder({ person: 'Kamala', email: 'k@gmail.com' });
  a.unshareFolder({ person: 'Kamala', email: 'K@gmail.com' });
  assert.equal(fake.epp.children.Kamala.viewers.size, 0);
  const folder = fake.epp.children.Kamala; folder.addViewer('k@gmail.com'); folder.removeViewer = () => {};         // access that cannot be removed
  assert.throws(() => a.unshareFolder({ person: 'Kamala', email: 'k@gmail.com' }), /still there/);
});
