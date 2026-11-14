'use strict';
// The appearance colour (Account > Appearance) must repaint the WHOLE app: no stylesheet rule may hard-code the original berry
// pink. Everything accent-coloured goes through the --accent* / --brand-* variables (or color-mix() of them). Red for "late",
// "listening" and "unread" is meaning, not decoration, so reds are allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'docs');
const css = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8').split('\n');

function rgbOf(token) {
  if (token[0] === '#') {
    let h = token.slice(1); if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = token.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]];
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}

test('theme: no stylesheet rule hard-codes the berry pink outside the colour-variable definitions', () => {
  const bad = [];
  css.forEach((line, i) => {
    if (i < 53 || line.indexOf('data-accent') >= 0) return;                    // the variable definitions themselves (top of the file, and the accent sets)
    (line.match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g) || []).forEach((tok) => {
      const [h, s, l] = hsl(...rgbOf(tok));
      if (h >= 295 && h <= 345 && s > 0.3 && l > 0.15 && l < 0.9) bad.push('line ' + (i + 1) + ': ' + tok);
    });
  });
  assert.deepEqual(bad, [], 'hard-coded berry colours would stay pink in the other appearances:\n' + bad.join('\n'));
});

test('theme: every appearance defines the colours the interface relies on (light and dark)', () => {
  const text = css.join('\n');
  ['ocean', 'forest', 'sunset', 'violet'].forEach((a) => {
    ['--accent:', '--accent-strong:', '--accent-2:', '--accent-soft:', '--brand-from:', '--brand-to:'].forEach((v) => {
      const light = new RegExp(':root\\[data-accent="' + a + '"\\]\\s*\\{[^}]*' + v);
      const dark = new RegExp(':root\\[data-theme="dark"\\]\\[data-accent="' + a + '"\\]\\s*\\{[^}]*' + v);
      assert.ok(light.test(text), a + ' (light) is missing ' + v);
      assert.ok(dark.test(text), a + ' (dark) is missing ' + v);
    });
  });
});

test('logo: the app icon files exist in every size the browsers ask for, and the in-app logo is a function of the theme', () => {
  ['icon.svg', 'icon-maskable.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f + ' is missing'));
  const png = (f) => { const b = fs.readFileSync(path.join(root, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(png('icon-192.png'), [192, 192]); assert.deepEqual(png('icon-512.png'), [512, 512]);
  assert.deepEqual(png('icon-maskable-512.png'), [512, 512]); assert.deepEqual(png('apple-touch-icon.png'), [180, 180]);
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  assert.ok(/function logoMark\(/.test(ui) && /logoMark: logoMark/.test(ui));
  assert.ok(css.join('\n').indexOf('.logo { background: linear-gradient(135deg, var(--brand-from), var(--brand-to)); }') >= 0);
});

test('theme: person avatars never use a pink or rose hue (they would stay berry-coloured in every appearance)', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const m = ui.match(/const hue = \[([\d,\s]+)\]/);
  assert.ok(m, 'avatar hue list not found');
  m[1].split(',').map(Number).forEach((h) => assert.ok(!(h >= 290 && h <= 360), 'avatar hue ' + h + ' is pink/rose'));
  assert.equal(css.join('\n').indexOf('var(--h, 330)'), -1);
});
