// The Apps Script side of push delivery (pushNotify_ in Adapters.gs) against fake Google services: what it sends, to whom, how it reacts to each answer.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (a) => Buffer.from(a.map((b) => b & 255));

function world(answers) {
  const calls = { requests: [], locked: 0 };
  const props = {};
  const stored = { PushSubs: [] };
  const sandbox = {
    console, unescape, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/APP/exec' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { calls.locked++; }, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, input) => signed(crypto.createHash('sha256').update(typeof input === 'string' ? Buffer.from(input) : unsigned(input)).digest()),
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', unsigned(key)).update(unsigned(value)).digest())
    },
    UrlFetchApp: { fetchAll: (reqs) => { calls.requests.push(...reqs); return reqs.map((r, i) => { const a = answers(r, i); return { getResponseCode: () => a.code, getContentText: () => a.text || '' }; }); } }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8'), ctx);
  const store = {
    all: (t) => stored[t].map((r) => Object.assign({}, r)),
    update: (t, id, patch) => { Object.assign(stored[t].find((r) => r.id === id), patch); },
    removeWhere: (t, pred) => { const n = stored[t].length; stored[t] = stored[t].filter((r) => !pred(r)); return n - stored[t].length; }
  };
  return { ctx, calls, props, stored, store, send: (payload, recipients) => vm.runInContext('pushNotify_', ctx)(store, payload, recipients) };
}
function phone(id, userId, host) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { ecdh, auth: crypto.randomBytes(16), row: { id, userId, endpoint: (host || 'https://fcm.googleapis.com') + '/fcm/send/' + id, p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url'), label: 'x', createdAt: 1, lastOk: 0, lastError: '' } };
}
function withKeys(w) { const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), jwk = k.privateKey.export({ format: 'jwk' }); w.props.VAPID_PRIVATE_KEY = jwk.d; w.props.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'); return w; }
function decrypt(req, ph) {                                                       // what the phone's browser does
  const body = unsigned(req.payload), salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), record = body.subarray(21 + idlen);
  const authSecret = Buffer.from(ph.row.auth, 'base64url'), secret = ph.ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ph.ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}
const payload = { t: 'WK1 · Roof', b: 'Tiles arrived 🌿', u: '#/task/T1', g: 'chat:T1', c: 'messages', a: 'Open', ts: 1 };

test('every device of the people told gets its own encrypted copy, signed for its push service, in ONE parallel call', () => {
  const w = withKeys(world(() => ({ code: 201 })));
  const a1 = phone('a1', 'U1'), a2 = phone('a2', 'U1', 'https://updates.push.services.mozilla.com/wpush'), b1 = phone('b1', 'U2'), c1 = phone('c1', 'U3');
  w.stored.PushSubs.push(a1.row, a2.row, b1.row, c1.row);
  const r = w.send(payload, [{ userId: 'U1', silent: false }, { userId: 'U2', silent: true }]);
  assert.deepEqual([r.sent, r.failed, r.removed, r.devices], [3, 0, 0, 3]);
  assert.equal(w.calls.requests.length, 3, 'U3 was not told');
  const byUrl = (u) => w.calls.requests.find((x) => x.url === u);
  const mine = byUrl(a1.row.endpoint), moz = byUrl(a2.row.endpoint), quiet = byUrl(b1.row.endpoint);
  assert.deepEqual(decrypt(mine, a1), Object.assign({}, payload, { s: 0 }));
  assert.equal(decrypt(quiet, b1).s, 1, 'silent hours: the phone is told to show it without sound');
  assert.deepEqual(decrypt(moz, a2).t, payload.t);
  assert.notEqual(Buffer.from(mine.payload).toString('hex'), Buffer.from(moz.payload).toString('hex'));
  assert.equal(mine.headers['Content-Encoding'], 'aes128gcm'); assert.equal(mine.headers.Urgency, 'high'); assert.equal(mine.headers.TTL, '21600');
  assert.match(mine.headers.Topic, /^[0-9a-f]{24}$/); assert.equal(mine.headers.Topic, moz.headers.Topic, 'same chat, same topic: an older unread one is replaced');
  assert.match(mine.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const claims = (h) => JSON.parse(Buffer.from(h.match(/t=[\w-]+\.([\w-]+)\./)[1], 'base64url'));
  assert.equal(claims(mine.headers.Authorization).aud, 'https://fcm.googleapis.com'); assert.equal(claims(moz.headers.Authorization).aud, 'https://updates.push.services.mozilla.com');
  assert.equal(claims(mine.headers.Authorization).sub, 'https://script.google.com/macros/s/APP/exec');
  assert.equal(mine.muteHttpExceptions, true); assert.equal(mine.followRedirects, false); assert.ok(mine.payload.every((b) => b >= -128 && b <= 127), 'Apps Script wants signed bytes');
});

test('a device the push service says is gone is forgotten; a failing one is marked with the reason; the rest still arrive', () => {
  const w = withKeys(world((req) => (req.url.includes('/gone') ? { code: 410 } : req.url.includes('/bad') ? { code: 403, text: 'wrong key' } : { code: 201 })));
  const ok = phone('ok1', 'U1'), gone = phone('gone', 'U1'), bad = phone('bad', 'U1');
  w.stored.PushSubs.push(ok.row, gone.row, bad.row);
  const r = w.send(payload, [{ userId: 'U1', silent: false }]);
  assert.deepEqual([r.sent, r.failed, r.removed], [1, 1, 1]);
  assert.match(r.errors[0], /403.*wrong key/);
  assert.deepEqual(w.stored.PushSubs.map((s) => s.id).sort(), ['bad', 'ok1']);
  assert.match(w.stored.PushSubs.find((s) => s.id === 'bad').lastError, /403/);
  assert.ok(w.stored.PushSubs.find((s) => s.id === 'ok1').lastOk > 0);
});

test('not set up, nobody to tell, bad stored keys and an unreachable push service are all reported, never thrown', () => {
  const w = world(() => ({ code: 201 }));
  w.stored.PushSubs.push(phone('a', 'U1').row);
  assert.match(w.send(payload, [{ userId: 'U1' }]).errors[0], /setupPush/);                          // no keys yet
  withKeys(w);
  assert.equal(JSON.stringify(w.send(payload, [{ userId: 'nobody' }])), JSON.stringify({ sent: 0, failed: 0, removed: 0, errors: [], devices: 0 }));
  w.stored.PushSubs[0].p256dh = 'not-a-key';
  const r = w.send(payload, [{ userId: 'U1' }]);
  assert.equal(r.failed, 1); assert.equal(r.sent, 0);
  const w2 = world(() => { throw new Error('network down'); }); withKeys(w2); w2.stored.PushSubs.push(phone('z', 'U1').row);
  const r2 = w2.send(payload, [{ userId: 'U1' }]);
  assert.equal(r2.sent, 0); assert.match(r2.errors[0], /could not be reached/);
});
