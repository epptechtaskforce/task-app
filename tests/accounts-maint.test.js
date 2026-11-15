'use strict';
// The two hand-run tools: own one-time passwords instead of the shared default 1111, and one more administrator.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../backend/Core.gs');
const { createMemoryEnv } = require('../docs/js/memory-env.js');

function boot() {
  const env = createMemoryEnv({ hashRounds: 5, settings: {} }), core = createCore(env);
  core.setup({ companyName: 'Acme', adminUsername: 'admin', adminPassword: 'Admin-pass-1' });
  const call = (action, token, p) => core.handle(Object.assign({ action, token }, p || {}));
  const admin = call('login', null, { username: 'admin', password: 'Admin-pass-1' }).data;
  call('changePassword', admin.token, { oldPassword: 'Admin-pass-1', newPassword: 'Admin-pass-2' });
  const A = call('login', null, { username: 'admin', password: 'Admin-pass-2' }).data.token;
  const t = call('adminSaveJobTitle', A, { title: 'Manager', level: 2 }).data.id;
  const mk = (u) => call('adminSaveUser', A, { name: u, username: u, jobTitleId: t }).data;
  return { env, core, call, A, mk };
}

test('issueTempPasswords: 1111 stops working, the new one-time password works once and forces a new password', () => {
  const { core, call, mk, env } = boot();
  mk('sam'); mk('tia');
  assert.equal(call('login', null, { username: 'sam', password: '1111' }).ok, true, 'before: the shared default opens the account');
  const out = core.issueTempPasswords(['sam', 'tia'], (() => { let n = 0; return () => 'Temp-pass-' + (++n); })());
  assert.deepEqual(out.map((x) => [x.username, x.tempPassword]), [['sam', 'Temp-pass-1'], ['tia', 'Temp-pass-2']]);
  assert.equal(call('login', null, { username: 'sam', password: '1111' }).ok, false);
  assert.equal(call('login', null, { username: 'tia', password: 'Temp-pass-1' }).ok, false, 'each person has their own');
  const l = call('login', null, { username: 'tia', password: 'Temp-pass-2' });
  assert.equal(l.ok, true); assert.equal(l.data.user.mustChange, true);
  assert.equal(call('changePassword', l.data.token, { oldPassword: 'Temp-pass-2', newPassword: 'Tia-own-pass-1' }).ok, true);
  assert.ok(env.store.all('AuditLog').some((a) => a.action === 'user.resetPassword' && a.detail === 'tia'));
});

test('issueTempPasswords: unknown or weak input changes nothing for the rest', () => {
  const { core, call, mk } = boot();
  mk('sam');
  assert.throws(() => core.issueTempPasswords(['nobody'], () => 'Temp-pass-1'), /No active person/);
  assert.throws(() => core.issueTempPasswords(['sam'], () => 'short'), /at least/);
  assert.equal(call('login', null, { username: 'sam', password: '1111' }).ok, true);
});

test('resetToDefault: back to 1111, which only opens the change-password step', () => {
  const { core, call, mk } = boot();
  mk('sam'); core.issueTempPasswords(['sam'], () => 'Temp-pass-1');
  assert.equal(call('login', null, { username: 'sam', password: 'Temp-pass-1' }).ok, true);
  core.resetToDefault(['sam']);
  assert.equal(call('login', null, { username: 'sam', password: 'Temp-pass-1' }).ok, false);
  const l = call('login', null, { username: 'sam', password: '1111' });
  assert.equal(l.ok, true); assert.equal(l.data.user.mustChange, true);
  assert.equal(call('changePassword', l.data.token, { oldPassword: '1111', newPassword: '1111' }).ok, false, '1111 is never accepted as a chosen password');
  assert.throws(() => core.resetToDefault(['nobody']), /No active person/);
});

test('addAdminAccount: a pure administrator with its own temporary password; no duplicate names', () => {
  const { core, call, A } = boot();
  const r = core.addAdminAccount('Dilshan', 'Dilshan', 'Temp-pass-9');
  assert.equal(r.username, 'dilshan');
  const l = call('login', null, { username: 'dilshan', password: 'Temp-pass-9' });
  assert.equal(l.ok, true); assert.equal(l.data.user.isAdmin, true); assert.equal(l.data.user.jobTitleId, ''); assert.equal(l.data.user.mustChange, true);
  assert.equal(call('login', null, { username: 'dilshan', password: '1111' }).ok, false);
  assert.throws(() => core.addAdminAccount('Other', 'dilshan', 'Temp-pass-8'), /taken/);
  assert.equal(call('adminOverview', A).data.users.filter((u) => u.isAdmin && u.active).length, 2);
});
