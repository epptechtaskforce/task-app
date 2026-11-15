// On a phone, choosing a document opens the system file picker, which stays open for seconds. Closing the "Share a file" sheet must not answer
// "no files" in the meantime (it once did, after 300 ms, so every picked file was silently ignored). No DOM here, so this guards the code itself.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('attach menu: tapping an option stops the sheet from answering "no files" when it closes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'ui.js'), 'utf8');
  const menu = src.slice(src.indexOf('function attachMenu()'), src.indexOf('function b64Url('));
  assert.match(menu, /chosen = false/, 'there is a flag for "an option was tapped"');
  assert.match(menu, /onclick: function \(\) \{ chosen = true; pickFiles\(kind\)\.then\(answer\); m\.close\(\); \}/, 'tapping an option sets it before the sheet closes');
  assert.match(menu, /onClose: function \(\) \{ setTimeout\(function \(\) \{ if \(!chosen\) answer\(\[\]\); \}, 300\); \}/, 'closing the sheet only answers "no files" when nothing was chosen');
});
