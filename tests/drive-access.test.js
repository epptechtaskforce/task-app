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
      getName: () => name, getId: () => f.id, getOwner: () => ({ getEmail: () => owner }),
      getAccess: (e) => f.editors.has(e) ? EDIT : f.viewers.has(e) ? VIEW : NONE,
      getSharingAccess: () => f.access, setSharing: (a) => { f.access = a; },
      addViewer: (e) => { f.editors.delete(e); f.viewers.add(e); }, removeViewer: (e) => { f.viewers.delete(e); },
      getFoldersByName: (n) => { const c = f.children[n]; let done = !c; return { hasNext: () => !done, next: () => { done = true; return c; } }; },
      createFolder: (n) => (f.children[n] = mkFolder(n)) };
    return f;
  };
  const root = mkFolder('root'), epp = mkFolder('EPP'); root.children.EPP = epp;
  const drive = { Permission: { NONE, VIEW, EDIT }, Access: { PRIVATE, ANYONE_WITH_LINK: LINK }, getRootFolder: () => root, getFolderById: (id) => (id === 'ID-EPP' ? epp : null) };
  const calls = [];
  // the Drive web service: records every call and adds the permission the way Google would
  const fetch = (url, opts) => {
    const m = /files\/(ID-[^/]+)\/permissions\?(.*)$/.exec(url), body = JSON.parse(opts.payload || '{}'), folder = m && Object.values(epp.children).find((f) => f.id === m[1]);
    calls.push({ url, query: m && m[2], method: opts.method, auth: opts.headers.Authorization, body });
    const reply = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
    if (fetch.fail) return reply(400, { error: { message: fetch.fail } });
    if (!folder) return reply(404, { error: { message: 'not found' } });
    (body.role === 'writer' ? folder.editors : folder.viewers).add(body.emailAddress);
    return reply(200, { id: 'perm1' });
  };
  return { root, epp, drive, calls, fetch, session: { getEffectiveUser: () => ({ getEmail: () => owner }) } };
}
function archiveWith(fake) {
  const ctx = { DriveApp: fake.drive, ScriptApp: { getOAuthToken: () => 'token-123' }, UrlFetchApp: { fetch: (u, o) => fake.fetch(u, o) }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) } };
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
  // no email is sent: the permission is made through the Drive web service with notifications switched off, as a plain reader, for that one folder
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.method, 'post'); assert.equal(call.auth, 'Bearer token-123');
  assert.ok(/files\/ID-Kamala\/permissions\?/.test(call.url) && /sendNotificationEmail=false/.test(call.query), call.url);
  assert.deepEqual(call.body, { role: 'reader', type: 'user', emailAddress: 'kamala@gmail.com' });
});

test('shareFolder: an address without a Google account is refused in plain words, and nothing is shared', () => {
  const fake = fakeDrive('owner@gmail.com'), a = archiveWith(fake);
  fake.fetch.fail = 'You are trying to invite x@example.com. Since there is no Google account associated with this email address, you must check the "Notify people" box to invite this recipient.';
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'x@example.com' }), /no Google account\. Use a Gmail or Google Workspace address/);
  assert.equal(fake.epp.children.Kamala.viewers.size, 0);
  fake.fetch.fail = 'Forbidden. User message: "Sorry, you cannot share with x@example.com because they do not have a Google Account."';   // the wording Google really uses
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'x@example.com' }), /no Google account\. Use a Gmail or Google Workspace address/);
  fake.fetch.fail = 'Some other Google problem';
  assert.throws(() => a.shareFolder({ person: 'Kamala', email: 'y@gmail.com' }), /Some other Google problem/);
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
  const folder = a.personFolder('Kamala'); const real = fake.fetch; fake.fetch = (u, o) => real(u, Object.assign({}, o, { payload: JSON.stringify({ role: 'writer', emailAddress: 'k@gmail.com' }) }));   // pretend Drive made them an editor
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

test('Adapters.gs does not use calls that need a Google permission the project was never given (they only fail on the real Drive)', () => {
  assert.equal(/getEffectiveUser|getActiveUser/.test(src), false);
});

test('the app: nothing about Google Drive on the Account page; the two buttons and the request sit on the History task', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'app.js'), 'utf8');
  const acc = app.slice(app.indexOf('function viewAccount()'), app.indexOf('function ', app.indexOf('function viewAccount()') + 30));
  assert.equal(/Drive/i.test(acc), false, 'the Account page must not mention Google Drive');
  const det = app.slice(app.indexOf('function archivedDetails('), app.indexOf('async function viewArchived('));
  assert.ok(det.includes('Open the folder in Google Drive') && det.includes('Open the zip') && det.includes('Request access') && det.includes("requestDriveAccess"));
});

test('the History page has the same groups as the task list and a date range (source check)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'app.js'), 'utf8');
  const v = app.slice(app.indexOf('function viewHistory()'), app.indexOf('// A task archived as a zip file:'));
  for (const bit of ["'All'", "'Assigned to me'", "'Assigned by me'", 'Choose date', 'Completed from', 'Show more', 'listHistory']) assert.ok(v.includes(bit), bit);
});
