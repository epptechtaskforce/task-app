// "No ghost touches, ever": the rules that keep one tap from doing something twice or something else. No DOM here, so these guard the code itself
// (the behaviour was also checked in a real browser with the server slowed to 2 s).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', f), 'utf8');
const ui = read('ui.js'), app = read('app.js');

test('a popup closes on CLICK, never on the emulated mousedown that a phone sends (that tap fell through onto what was underneath)', () => {
  assert.doesNotMatch(ui, /addEventListener\('mousedown'/, 'no mousedown handler anywhere in ui.js');
  assert.match(ui, /overlay\.addEventListener\('click', function \(e\) \{ if \(e\.target === overlay && !opts\.sticky\) close\(\); \}\)/);
});

test('for a moment after a popup closes, a click outside popups is thrown away (the second half of a tap)', () => {
  assert.match(ui, /lastModalClose = Date\.now\(\)/);
  assert.match(ui, /Date\.now\(\) - lastModalClose < 380 && !\(e\.target && e\.target\.closest && e\.target\.closest\('\.overlay'\)\)/);
});

test('a second click on the same button or link within 0.3 s is thrown away, but labels and checkboxes are left alone', () => {
  assert.match(ui, /closest\('button, a, \[role="button"\]'\)/);
  assert.match(ui, /lastTap\.el === el && now - lastTap\.at < 300/);
  assert.doesNotMatch(ui.slice(ui.indexOf('let lastTap'), ui.indexOf('function modal(opts)')), /label/, 'a label click legitimately makes a second click on its checkbox');
});

test('long press: runs once, ignores a moving finger, swallows the tap that ends the hold, never starts inside a text box, and replaces the right-click menu', () => {
  const lp = ui.slice(ui.indexOf('function longPress('), ui.indexOf('function confirmBox('));
  assert.match(lp, /Math\.hypot\(e\.clientX - sx, e\.clientY - sy\) > SLOP\) clear\(\)/, 'a scroll cancels it');
  assert.match(lp, /closest\('input, textarea, select, \[data-nolp\]'\)/);
  assert.match(lp, /swallow = Date\.now\(\) \+ 800/); assert.match(lp, /Date\.now\(\) < swallow\) \{ e\.stopImmediatePropagation\(\); e\.preventDefault\(\)/);
  assert.match(lp, /addEventListener\('contextmenu', function \(e\) \{ e\.preventDefault\(\);/);
});

test('every choice in the menu works once', () => {
  const sheet = ui.slice(ui.indexOf('function actionSheet('), ui.indexOf('function longPress('));
  assert.match(sheet, /let used = false/); assert.match(sheet, /if \(used\) return; used = true; m\.close\(\)/);
});

test('a key held down does not send the message again and again', () => {
  assert.match(app, /e\.key !== 'Enter' \|\| e\.isComposing \|\| e\.repeat/);
});

test('quick taps on progress numbers: one save at a time, only the newest value is sent, and the state lives outside drawHead', () => {
  assert.match(app, /let sending = false, next = null, confirmed = null, latest = null;/);
  assert.ok(app.indexOf('let sending = false') < app.indexOf('function drawHead()'), 'the state is declared before (outside) drawHead');
  assert.match(app, /if \(sending\) \{ next = v; return; \}/);
});

test('a lost connection is not a refusal: nothing is undone, and adding things never offers a second copy', () => {
  assert.match(app, /if \(keep && e && e\.network\)/);
  assert.match(app, /No signal\. The task may still arrive/); assert.match(app, /No signal\. Your message may still be sent/);
});

test('only your own tasks and messages have the hold menu; deleting asks first and says it cannot be undone', () => {
  assert.match(app, /t\.role === 'creator' && !t\.creating && t\.status !== 'closed'/, 'tasks: creator, not being created, not finished');
  assert.match(app, /if \(mine && o\.onMenu && !o\.archived\)/, 'messages: mine, never in History');
  assert.match(app, /will be erased for everyone, with its conversation, files and voice messages, as if it had never existed\. This cannot be undone\./);
  assert.match(app, /as if it had never been sent\. This cannot be undone\./);
  assert.match(app, /m\.type === 'text' \|\| \(m\.type === 'file' && m\.file\)\) items\.push\(\{ label: 'Edit'/, 'a voice message can only be deleted');
});
