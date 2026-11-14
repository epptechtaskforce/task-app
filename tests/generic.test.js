'use strict';
// `main` is the generic, publishable code. A company deployment keeps its own address, names and keys in its own branch / script
// properties, never here. This guards the easy mistakes: a hard-coded site or backend address in code or docs, and keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', 'QR code', 'mock'].includes(e.name)) walk(p); }
    else if (/\.(gs|js|md|json|webmanifest)$/.test(e.name) && !/package-lock/.test(e.name)) files.push(p);
  });
})(root);

test('generic code: no real site or backend address, no keys', () => {
  const bad = [];
  files.forEach((f) => {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (rel === 'docs/js/config.js' || rel === 'HANDOVER.md' || rel.startsWith('tests/')) return;   // (HANDOVER.md stays out of git on purpose)        // config.js is where a deployment puts its backend address (empty in main)
    const text = fs.readFileSync(f, 'utf8');
    (text.match(/https?:\/\/[a-z0-9-]+\.github\.io\/[^\s'")]*/gi) || []).forEach((u) => { if (!/<account>|<user>|your-/.test(u)) bad.push(rel + ': ' + u); });
    (text.match(/script\.google\.com\/macros\/s\/AK[A-Za-z0-9_-]{10,}/g) || []).forEach((u) => bad.push(rel + ': ' + u));
    (text.match(/\b(?:AIza[0-9A-Za-z_-]{30,}|gsk_[0-9A-Za-z]{20,}|sk-ant-[0-9A-Za-z_-]{20,})\b/g) || []).forEach(() => bad.push(rel + ': a key'));
  });
  assert.deepEqual(bad, [], 'company-specific addresses or keys in generic code:\n' + bad.join('\n'));
});
