/* ui.js - tiny DOM helpers. Never uses innerHTML, so user text can never become markup. */
(function (w) {
  'use strict';

  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1, readOnly: 1 };

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (PROPS[k]) el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { append(el, k); });
    else if (kid instanceof Node) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  /* ---------- icons (inline SVG built with the DOM API, 24x24 outline style) ---------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
    history: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'],
    users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    briefcase: ['M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
    org: ['M9.5 5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0z', 'M2.5 19a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0z', 'M16.5 19a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0z', 'M12 7.5V12', 'M5 16.5V12h14v4.5'],
    user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    plus: ['M12 5v14', 'M5 12h14'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
    mic: ['M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v4', 'M8 23h8'],
    play: ['M7 4l13 8-13 8z'],
    pause: ['M7 4h3v16H7z', 'M14 4h3v16h-3z'],
    check: ['M20 6L9 17l-5-5'],
    checkCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
    x: ['M18 6L6 18', 'M6 6l12 12'],
    back: ['M15 18l-6-6 6-6'],
    next: ['M9 18l6-6-6-6'],
    alert: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
    calendar: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
    eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    eyeOff: ['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19', 'M1 1l22 22'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    sparkles: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z'],
    refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
    sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42'],
    moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
    edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
    trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    lock: ['M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
    arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
    thumb: ['M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z', 'M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'],
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01']
  };
  // opts.fill: solid shape (play/pause). opts.cls: extra class. Decorative by default (aria-hidden).
  function icon(name, size, opts) {
    opts = opts || {};
    const paths = ICONS[name] || [];
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 20); s.setAttribute('height', size || 20);
    s.setAttribute('class', 'icon' + (opts.cls ? ' ' + opts.cls : '')); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('fill', opts.fill ? 'currentColor' : 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', opts.fill ? 1.5 : 2); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  // Replace the content of a button/element with an icon (+ optional label).
  function setIcon(el, name, size, opts) { clear(el); el.appendChild(icon(name, size, opts)); return el; }

  /* ---------- formatting ---------- */
  function date(ms) { return ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
  function time(ms) { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function dateTime(ms) { return ms ? date(ms) + ', ' + time(ms) : ''; }
  function dayLabel(ms) {
    const d = new Date(ms), t = new Date();
    const sameDay = function (a, b) { return a.toDateString() === b.toDateString(); };
    const y = new Date(t); y.setDate(t.getDate() - 1);
    return sameDay(d, t) ? 'Today' : sameDay(d, y) ? 'Yesterday' : date(ms);
  }
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return date(ms);
  }
  function duration(secs) { secs = Math.round(secs || 0); return Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2); }
  function dueInfo(dueDate, status) {
    if (!dueDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parts = dueDate.split('-'), d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    const days = Math.round((d - today) / 86400000);
    const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    if (status === 'pending') return { text: 'Due ' + label, cls: '', days: days };
    if (days < 0) return { text: 'Overdue ' + label, cls: 'bad', days: days };
    if (days === 0) return { text: 'Due today', cls: 'warn', days: days };
    if (days === 1) return { text: 'Due tomorrow', cls: 'warn', days: days };
    return { text: 'Due ' + label, cls: '', days: days };
  }
  function greeting() { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
  // yyyy-mm-dd for "today + n days" in local time (what <input type=date> expects)
  function ymd(offsetDays) {
    const d = new Date(); d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(message, kind) {
    let box = document.getElementById('toast');
    if (!box) { box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    clear(box);
    box.appendChild(icon(kind === 'bad' ? 'alert' : 'checkCircle', 18));
    box.appendChild(h('span', null, message));
    box.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = ''; }, kind === 'bad' ? 6000 : 3000);
  }

  /* ---------- modal (bottom sheet on phones, centred dialog on larger screens) ---------- */
  // actions: [{label, kind:'primary'|'danger'|'', onClick: fn(close) -> may return a Promise; keep open if it returns false}]
  let modalSeq = 0;
  function modal(opts) {
    const overlay = h('div', { class: 'overlay' });
    const previous = document.activeElement;
    const titleId = 'modal-title-' + (++modalSeq);
    let closed = false;
    const close = function () {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* element gone */ } }
      if (opts.onClose) opts.onClose();
    };
    const onKey = function (e) {
      if (e.key === 'Escape' && !opts.sticky) return close();
      if (e.key !== 'Tab') return;
      // keep keyboard focus inside the dialog
      const items = Array.prototype.filter.call(box.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const buttons = (opts.actions || []).map(function (a) {
      const btn = h('button', { type: 'button', class: 'btn ' + (a.kind || '') }, a.label);
      btn.addEventListener('click', async function () {
        if (!a.onClick) return close();
        btn.disabled = true;
        try { const r = await a.onClick(close); if (r !== false) close(); } finally { btn.disabled = false; }
      });
      return btn;
    });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      h('div', { class: 'modal-head' }, h('h2', { id: titleId }, opts.title),
        opts.sticky ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x', 18))),
      h('div', { class: 'modal-body' }, opts.body), h('div', { class: 'modal-actions' }, buttons));
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && !opts.sticky) close(); });
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    document.body.appendChild(overlay);
    const first = box.querySelector('input,textarea,select');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return { close: close, box: box };
  }
  function confirmBox(title, message, okLabel, kind) {
    return new Promise(function (resolve) {
      let answered = false;
      const answer = function (v) { if (!answered) { answered = true; resolve(v); } };
      modal({
        title: title, body: h('p', null, message), onClose: function () { answer(false); },
        actions: [
          { label: 'Cancel', onClick: function () { answer(false); } },
          { label: okLabel || 'OK', kind: kind || 'primary', onClick: function () { answer(true); } }
        ]
      });
    });
  }

  /* ---------- small widgets ---------- */
  function progressBar(pct, status) {
    return h('div', { class: 'bar ' + (status || ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
      h('div', { class: 'bar-fill', style: 'width:' + Math.max(0, Math.min(100, pct)) + '%' }));
  }
  // Circular progress. Returns the element; call el.setPct(n) to change it while the slider moves.
  function ring(pct, status, size) {
    size = size || 84;
    const R = 38, C = 2 * Math.PI * R;
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 88 88'); s.setAttribute('width', size); s.setAttribute('height', size);
    const mk = function (cls) { const c = document.createElementNS(SVG_NS, 'circle'); c.setAttribute('cx', 44); c.setAttribute('cy', 44); c.setAttribute('r', R); c.setAttribute('class', cls); return c; };
    const track = mk('ring-track'), fill = mk('ring-fill');
    fill.setAttribute('stroke-dasharray', C); fill.setAttribute('transform', 'rotate(-90 44 44)');
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', 44); label.setAttribute('y', 44); label.setAttribute('class', 'ring-text'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central');
    s.appendChild(track); s.appendChild(fill); s.appendChild(label);
    s.setAttribute('class', 'ring ' + (status || '')); s.setAttribute('role', 'img');
    s.setPct = function (n) {
      n = Math.max(0, Math.min(100, Number(n) || 0));
      fill.setAttribute('stroke-dashoffset', C * (1 - n / 100)); label.textContent = Math.round(n) + '%';
      s.setAttribute('aria-label', Math.round(n) + ' percent complete'); s.classList.toggle('full', n >= 100);
    };
    s.setPct(pct);
    return s;
  }
  function chip(text, cls, iconName) { return h('span', { class: 'chip ' + (cls || '') }, iconName ? icon(iconName, 13) : null, text); }
  function initials(name) { return String(name || '?').split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase(); }
  // Round avatar with initials; the colour comes from the name, so the same person always looks the same.
  function avatar(name, size) {
    let hash = 0; const s = String(name || '?');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = [330, 280, 215, 190, 150, 25, 355, 250][hash % 8];
    return h('span', { class: 'avatar' + (size ? ' ' + size : ''), style: '--h:' + hue, 'aria-hidden': 'true' }, initials(name));
  }
  function avatarStack(names, max) {
    max = max || 3;
    const shown = names.slice(0, max);
    return h('span', { class: 'avatar-stack' }, shown.map(function (n) { return avatar(n, 'xs'); }), names.length > max ? h('span', { class: 'avatar xs more' }, '+' + (names.length - max)) : null);
  }
  function skeleton(kind, count) {
    const one = function () {
      if (kind === 'line') return h('div', { class: 'skel line' });
      return h('div', { class: 'card skel-card', 'aria-hidden': 'true' }, h('div', { class: 'skel line w60' }), h('div', { class: 'skel line w40 sm' }), h('div', { class: 'skel bar-s' }), h('div', { class: 'skel line w30 sm' }));
    };
    const box = h('div', { class: 'skeleton', role: 'status', 'aria-label': 'Loading' });
    for (let i = 0; i < (count || 3); i++) box.appendChild(one());
    return box;
  }
  function emptyState(iconName, title, text, action) {
    return h('div', { class: 'card empty' }, h('div', { class: 'empty-ico' }, icon(iconName, 28)), h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }
  // A password box with a "show" button (people mistype long passwords on phones).
  function passwordField(attrs) {
    const input = h('input', Object.assign({ type: 'password' }, attrs || {}));
    const btn = h('button', { type: 'button', class: 'field-btn', 'aria-label': 'Show password', title: 'Show password' }, icon('eye', 18));
    btn.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const label = show ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-label', label); btn.title = label; setIcon(btn, show ? 'eyeOff' : 'eye', 18);
    });
    return { input: input, el: h('div', { class: 'field' }, input, btn) };
  }

  /* ---------- theme (automatic / light / dark) ---------- */
  const THEME_KEY = 'taskapp.theme';
  function themeGet() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function themeApply() {
    const v = themeGet(), de = document.documentElement;
    if (v === 'auto') de.removeAttribute('data-theme'); else de.setAttribute('data-theme', v);
  }
  function themeSet(v) { try { if (v === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage blocked */ } themeApply(); }

  w.h = h;
  w.UI = { h: h, clear: clear, icon: icon, setIcon: setIcon, date: date, time: time, dateTime: dateTime, dayLabel: dayLabel, ago: ago, duration: duration, dueInfo: dueInfo, greeting: greeting, ymd: ymd,
    toast: toast, modal: modal, confirm: confirmBox, progressBar: progressBar, ring: ring, chip: chip, initials: initials, avatar: avatar, avatarStack: avatarStack,
    skeleton: skeleton, emptyState: emptyState, copyText: copyText, passwordField: passwordField, theme: { get: themeGet, set: themeSet, apply: themeApply } };
})(window);
