// The Web Push encryption and signing written for Google Apps Script (which has no ECDSA / ECDH / AES-GCM) must agree with real implementations.
// Every result is checked against Node's own crypto, including a full decrypt the way a browser does it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8');
const section = src.slice(src.indexOf('// ==== WEB PUSH BEGIN'), src.indexOf('// ==== WEB PUSH END'));
const prims = {
  sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
  hmac: (key, data) => new Uint8Array(crypto.createHmac('sha256', key).update(data).digest()),
  random: (n) => new Uint8Array(crypto.randomBytes(n))
};
const WP = new Function(section + '\nreturn makeWebPush_;')()(prims);
const hex = (u8) => Buffer.from(u8).toString('hex');
const pubKeyObject = (raw) => crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(raw.slice(1, 33)).toString('base64url'), y: Buffer.from(raw.slice(33, 65)).toString('base64url') }, format: 'jwk' });

test('public keys match Node (private scalar -> uncompressed point)', () => {
  for (let i = 0; i < 4; i++) {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const mine = WP._p.pubBytes(WP._p.toBig(new Uint8Array(ecdh.getPrivateKey())));
    assert.equal(hex(mine), ecdh.getPublicKey('hex'));
  }
});

test('ECDH agrees with Node in both directions', () => {
  for (let i = 0; i < 4; i++) {
    const a = crypto.createECDH('prime256v1'), b = crypto.createECDH('prime256v1'); a.generateKeys(); b.generateKeys();
    const secret = WP._p.ecdh(WP._p.toBig(new Uint8Array(a.getPrivateKey())), new Uint8Array(b.getPublicKey()));
    assert.equal(hex(secret), a.computeSecret(b.getPublicKey()).toString('hex'));
  }
});

test('ES256 signatures verify with Node', () => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const d = WP._p.toBig(new Uint8Array(ecdh.getPrivateKey())), pub = pubKeyObject(new Uint8Array(ecdh.getPublicKey()));
  for (let i = 0; i < 4; i++) {
    const msg = Buffer.from('message number ' + i), sig = WP._p.sign(prims.sha256(msg), d);
    assert.equal(sig.length, 64);
    assert.ok(crypto.verify('sha256', msg, { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig)));
    assert.ok(!crypto.verify('sha256', Buffer.from('another'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig)));
  }
});

test('AES-128-GCM matches Node for every length (empty, one block, partial blocks, long)', () => {
  for (const len of [0, 1, 15, 16, 17, 31, 32, 100, 300, 1000]) {
    const key = crypto.randomBytes(16), iv = crypto.randomBytes(12), plain = crypto.randomBytes(len);
    const c = crypto.createCipheriv('aes-128-gcm', key, iv), expected = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    assert.equal(hex(WP._p.gcmEncrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(plain))), expected.toString('hex'), 'length ' + len);
  }
});

// What a browser does with a push message (RFC 8291 section 3.4), written with Node's crypto only.
function browserDecrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), record = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const secret = uaEcdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last record ends with the 0x02 delimiter');
  return plain.subarray(0, plain.length - 1);
}

test('a push message is decrypted correctly by a receiver that follows RFC 8291 (including Sinhala text)', () => {
  for (const text of ['Hello', '', JSON.stringify({ t: 'New task from Priyantha', b: 'Plan the weekend harvest shifts · due tomorrow', u: '#/task/Tabc' }), 'සුභ උදෑසනක් - කාර්ය 3ක් ඉතිරියි 🌿', 'x'.repeat(3000)]) {
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
    const body = Buffer.from(WP.encrypt(WP.utf8(text), new Uint8Array(ua.getPublicKey()), new Uint8Array(auth)));
    assert.equal(browserDecrypt(body, ua, auth).toString('utf8'), text);
  }
});

test('two encryptions of the same text differ (fresh key and salt each time)', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = new Uint8Array(crypto.randomBytes(16));
  const a = WP.encrypt(WP.utf8('same'), new Uint8Array(ua.getPublicKey()), auth), b = WP.encrypt(WP.utf8('same'), new Uint8Array(ua.getPublicKey()), auth);
  assert.notEqual(hex(a), hex(b));
});

test('VAPID header: a signed token for the push service, verifiable with the public key', () => {
  const keys = WP.newKeys(), pubRaw = WP.unb64u(keys.publicKey), priv = WP.unb64u(keys.privateKey);
  assert.equal(pubRaw.length, 65); assert.equal(priv.length, 32);
  const h = WP.vapidHeader('https://fcm.googleapis.com/fcm/send/abc123', 'https://example.org/app/', priv, pubRaw, 1800000000);
  const m = h.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, h); assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(m[2], 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1800000000 + 12 * 3600, sub: 'https://example.org/app/' });
  assert.ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pubKeyObject(pubRaw), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});

test('keys: the public key belongs to the private key; bad public keys are refused', () => {
  const k = WP.newKeys(), ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(WP.unb64u(k.privateKey)));
  assert.equal(ecdh.getPublicKey('base64url'), k.publicKey);
  const ok = new Uint8Array(ecdh.getPublicKey()), auth = new Uint8Array(16);
  assert.throws(() => WP.encrypt(WP.utf8('x'), ok.subarray(0, 64), auth), /uncompressed/);
  const bad = Uint8Array.from(ok); bad[40] ^= 1;
  assert.throws(() => WP.encrypt(WP.utf8('x'), bad, auth), /curve/);
  assert.equal(hex(WP.unb64u(WP.b64u(new Uint8Array([0, 255, 1, 2, 3])))), '00ff010203');
});

test('speed: one encrypted message takes well under a second', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = new Uint8Array(crypto.randomBytes(16)), t0 = Date.now();
  for (let i = 0; i < 5; i++) WP.encrypt(WP.utf8('x'.repeat(300)), new Uint8Array(ua.getPublicKey()), auth);
  assert.ok((Date.now() - t0) / 5 < 500, 'took ' + (Date.now() - t0) / 5 + ' ms each');
});
