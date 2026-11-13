/* ui.js - DOM helpers, icons, charts, drag & drop, illustrations, confetti, photo cropper.
 * Never uses innerHTML, so user text can never become markup. */
(function (w) {
  'use strict';

  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1, readOnly: 1 };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduced = function () { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); };

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
  // SVG element builder: svg('rect', {x:1}, children...)
  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]); });
    for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c) el.appendChild(c); }
    return el;
  }

  /* ---------- icons (inline SVG built with the DOM API, 24x24 outline style) ---------- */
  const ICONS = {
    tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
    history: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'],
    users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    userPlus: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M20 8v6', 'M23 11h-6'],
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
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
    camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    move: ['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20'],
    trend: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
    zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
    flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
    smile: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
    paperclip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
    image: ['M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 15l-5-5L5 21'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    volume: ['M11 5L6 9H2v6h4l5 4z', 'M19.07 4.93a10 10 0 0 1 0 14.14', 'M15.54 8.46a5 5 0 0 1 0 7.07'],
    volumeOff: ['M11 5L6 9H2v6h4l5 4z', 'M23 9l-6 6', 'M17 9l6 6'],
    stop: ['M6 6h12v12H6z']
  };
  // opts.fill: solid shape (play/pause). opts.cls: extra class. Decorative by default (aria-hidden).
  function icon(name, size, opts) {
    opts = opts || {};
    const s = svg('svg', { viewBox: '0 0 24 24', width: size || 20, height: size || 20, 'class': 'icon' + (opts.cls ? ' ' + opts.cls : ''), 'aria-hidden': 'true', focusable: 'false',
      fill: opts.fill ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': opts.fill ? 1.5 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    (ICONS[name] || []).forEach(function (d) { s.appendChild(svg('path', { d: d })); });
    return s;
  }
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
    const box = h('div', { class: 'modal' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      opts.title ? h('div', { class: 'modal-head' }, h('h2', { id: titleId }, opts.title),
        opts.sticky ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x', 18))) : h('span', { id: titleId, class: 'sr-only' }, opts.label || 'Dialog'),
      h('div', { class: 'modal-body' }, opts.body), buttons.length ? h('div', { class: 'modal-actions' }, buttons) : null);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && !opts.sticky) close(); });
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    document.body.appendChild(overlay);
    const first = box.querySelector('input,textarea,select');
    if (first && !opts.noFocus) setTimeout(function () { first.focus(); }, 30);
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

  /* ---------- people ---------- */
  function initials(name) { return String(name || '?').split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase(); }
  function paintAvatar(el) {
    const photo = w.Profiles ? w.Profiles.photo(el.getAttribute('data-uid')) : '';
    let img = el.querySelector('img');
    if (photo) {
      if (!img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; el.appendChild(img); }
      if (img.getAttribute('src') !== photo) img.setAttribute('src', photo);
      el.classList.add('has-photo');
    } else if (img) { img.remove(); el.classList.remove('has-photo'); }
  }
  // Round avatar: the person's picture when they have one, otherwise initials on a colour taken from the name.
  function avatar(name, size, uid) {
    let hash = 0; const s = String(name || '?');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = [330, 280, 215, 190, 150, 25, 355, 250][hash % 8];
    const el = h('span', { class: 'avatar' + (size ? ' ' + size : ''), style: '--h:' + hue, 'aria-hidden': 'true' }, h('b', null, initials(name)));
    if (uid) { el.setAttribute('data-uid', uid); paintAvatar(el); }
    return el;
  }
  // Called when new pictures arrive: upgrades every avatar already on the screen.
  function hydrateAvatars(rootEl) { (rootEl || document).querySelectorAll('.avatar[data-uid]').forEach(paintAvatar); }
  // people: array of names or {id, name}
  function avatarStack(people, max) {
    max = max || 3;
    const shown = people.slice(0, max);
    return h('span', { class: 'avatar-stack' }, shown.map(function (p) { return typeof p === 'string' ? avatar(p, 'xs') : avatar(p.name, 'xs', p.id); }), people.length > max ? h('span', { class: 'avatar xs more' }, '+' + (people.length - max)) : null);
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
    const track = svg('circle', { cx: 44, cy: 44, r: R, 'class': 'ring-track' }), fill = svg('circle', { cx: 44, cy: 44, r: R, 'class': 'ring-fill', 'stroke-dasharray': C, transform: 'rotate(-90 44 44)' });
    const label = svg('text', { x: 44, y: 44, 'class': 'ring-text', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    const s = svg('svg', { viewBox: '0 0 88 88', width: size, height: size, 'class': 'ring ' + (status || ''), role: 'img' }, track, fill, label);
    s.setPct = function (n) {
      n = Math.max(0, Math.min(100, Number(n) || 0));
      fill.setAttribute('stroke-dashoffset', C * (1 - n / 100)); label.textContent = Math.round(n) + '%';
      s.setAttribute('aria-label', Math.round(n) + ' percent complete'); s.classList.toggle('full', n >= 100);
    };
    fill.setAttribute('stroke-dashoffset', C);
    s.setPct(0);
    if (reduced()) s.setPct(pct); else requestAnimationFrame(function () { requestAnimationFrame(function () { s.setPct(pct); }); });
    return s;
  }
  function chip(text, cls, iconName) { return h('span', { class: 'chip ' + (cls || '') }, iconName ? icon(iconName, 13) : null, text); }
  function skeleton(kind, count) {
    const one = function () {
      if (kind === 'line') return h('div', { class: 'skel line' });
      return h('div', { class: 'card skel-card', 'aria-hidden': 'true' }, h('div', { class: 'skel line w60' }), h('div', { class: 'skel line w40 sm' }), h('div', { class: 'skel bar-s' }), h('div', { class: 'skel line w30 sm' }));
    };
    const box = h('div', { class: 'skeleton', role: 'status', 'aria-label': 'Loading' });
    for (let i = 0; i < (count || 3); i++) box.appendChild(one());
    return box;
  }
  function emptyState(art, title, text, action) {
    return h('div', { class: 'card empty' }, h('div', { class: 'empty-art' }, illustration(art)), h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
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

  /* ---------- motion & charts ---------- */
  // Counts a number up from 0 (or sets it at once for people who prefer less motion / when animate is false).
  function countUp(el, to, animate, ms) {
    to = Math.round(Number(to) || 0);
    if (animate === false || reduced() || to === 0) { el.textContent = to; return; }
    const t0 = performance.now(); ms = ms || 800; el.textContent = 0;
    (function step(now) {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  // Donut chart. segs: [{key, value, color (css colour), label}], o: {size, thickness, animate, center:{num,label}, active:key, onPick(key)}
  function donut(segs, o) {
    o = o || {};
    const size = o.size || 150, t = o.thickness || 13, r = 50 - t / 2, C = 2 * Math.PI * r;
    const total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    const s = svg('svg', { viewBox: '0 0 100 100', width: size, height: size, 'class': 'donut', role: 'img', 'aria-label': (o.center ? o.center.num + ' ' + o.center.label + '. ' : '') + segs.map(function (x) { return x.value + ' ' + x.label; }).join(', ') });
    s.appendChild(svg('circle', { cx: 50, cy: 50, r: r, 'class': 'donut-track', 'stroke-width': t }));
    let offset = 0; const arcs = [];
    if (total > 0) segs.forEach(function (sg) {
      if (sg.value <= 0) return;
      const len = sg.value / total * C, gap = segs.filter(function (x) { return x.value > 0; }).length > 1 ? Math.min(2.2, len * 0.3) : 0;
      const arc = svg('circle', { cx: 50, cy: 50, r: r, 'class': 'donut-arc' + (o.active === sg.key ? ' on' : '') + (o.active && o.active !== sg.key ? ' dim' : ''), 'stroke-width': t, stroke: sg.color,
        'stroke-dasharray': (o.animate === false || reduced() ? Math.max(len - gap, 0.01) : 0.01) + ' ' + C, 'stroke-dashoffset': -offset, transform: 'rotate(-90 50 50)', 'data-key': sg.key });
      if (o.onPick) { arc.style.cursor = 'pointer'; arc.addEventListener('click', function () { o.onPick(sg.key); }); }
      arc.appendChild(svg('title', null)).textContent = sg.label + ': ' + sg.value;
      arcs.push([arc, Math.max(len - gap, 0.01)]);
      s.appendChild(arc); offset += len;
    });
    if (o.center) {
      const num = svg('text', { x: 50, y: 49, 'class': 'donut-num', 'text-anchor': 'middle', 'dominant-baseline': 'central' }), lab = svg('text', { x: 50, y: 63, 'class': 'donut-lab', 'text-anchor': 'middle' });
      lab.textContent = o.center.label; s.appendChild(num); s.appendChild(lab);
      countUp({ set textContent(v) { num.textContent = v; } }, o.center.num, o.animate);
    }
    if (o.animate !== false && !reduced()) requestAnimationFrame(function () { requestAnimationFrame(function () { arcs.forEach(function (a, i) { a[0].style.transitionDelay = (i * 90) + 'ms'; a[0].setAttribute('stroke-dasharray', a[1] + ' ' + C); }); }); });
    return s;
  }

  /* ---------- confetti ---------- */
  function confetti(opts) {
    if (reduced()) return;
    opts = opts || {};
    const cv = h('canvas', { class: 'confetti', 'aria-hidden': 'true' }), dpr = Math.min(2, w.devicePixelRatio || 1);
    const W = w.innerWidth, H = w.innerHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const colors = ['#c0397f', '#8a2b66', '#f6b73c', '#3fb6a8', '#5b8def', '#ff7a7a', '#7ed957'];
    const ox = opts.x === undefined ? W / 2 : opts.x, oy = opts.y === undefined ? H * 0.35 : opts.y;
    const parts = [];
    for (let i = 0; i < (opts.count || 110); i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, g: 0.22 + Math.random() * 0.12, s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length], shape: i % 3 });
    }
    const t0 = performance.now();
    (function frame(now) {
      const p = (now - t0) / 1900;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (q) {
        q.vx *= 0.99; q.vy += q.g; q.x += q.vx; q.y += q.vy; q.r += q.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p * p); ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c;
        if (q.shape === 0) ctx.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); else if (q.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, q.s / 3, 0, 7); ctx.fill(); } else ctx.fillRect(-q.s / 3, -q.s / 3, q.s / 1.5, q.s / 1.5);
        ctx.restore();
      });
      if (p < 1) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  /* ---------- drag & drop (pointer events: works with finger, mouse and pen) ---------- */
  // o: { data, zones: () => [elements], ghost: () => node, onDrop(zoneEl, data), onTap(), onStart(), onEnd() }
  // A drag starts after a small movement (sideways movement on touch scrolls the row instead). A tap/click is left alone.
  function draggable(el, o) {
    let st = null, suppress = false;
    const cleanup = function () {
      if (!st) return;
      if (st.raf) cancelAnimationFrame(st.raf);
      if (st.zones) st.zones.forEach(function (z) { z.classList.remove('drop-over', 'drop-ready'); });
      el.classList.remove('drag-src'); document.body.classList.remove('dragging');
      st = null;
    };
    el.addEventListener('click', function (e) { if (suppress) { e.stopImmediatePropagation(); e.preventDefault(); suppress = false; } }, true);
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', drag: false, ghost: null, over: null, raf: 0, cx: e.clientX, cy: e.clientY };
      // keep receiving this pointer's moves even when it leaves the element (a fast flick would otherwise be lost)
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      st.cx = e.clientX; st.cy = e.clientY;
      if (!st.drag) {
        const dx = e.clientX - st.x, dy = e.clientY - st.y, dist = Math.sqrt(dx * dx + dy * dy);
        if (!(st.touch ? (Math.abs(dy) > 7 && Math.abs(dy) >= Math.abs(dx) * 0.8) : dist > 5)) return;
        st.drag = true; st.zones = (o.zones ? o.zones() : []).filter(Boolean);
        st.ghost = o.ghost ? o.ghost() : el.cloneNode(true); st.ghost.classList.add('drag-ghost'); document.body.appendChild(st.ghost);
        st.gw = st.ghost.offsetWidth; st.gh = st.ghost.offsetHeight;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        el.classList.add('drag-src'); document.body.classList.add('dragging');
        st.zones.forEach(function (z) { z.classList.add('drop-ready'); });
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* ignore */ } }
        if (o.onStart) o.onStart();
        const loop = function () { if (!st || !st.drag) return; if (st.cy < 90) w.scrollBy(0, -Math.ceil((90 - st.cy) / 5)); st.raf = requestAnimationFrame(loop); };
        st.raf = requestAnimationFrame(loop);
      }
      e.preventDefault();
      st.ghost.style.transform = 'translate(' + (e.clientX - st.gw / 2) + 'px,' + (e.clientY - st.gh / 2) + 'px) scale(1.12) rotate(3deg)';
      let over = null;
      st.zones.forEach(function (z) {
        const r = z.getBoundingClientRect(), hit = e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
        z.classList.toggle('drop-over', hit); if (hit) over = z;
      });
      st.over = over; st.ghost.classList.toggle('can-drop', !!over);
    });
    const finish = function (e, cancelled) {
      if (!st || (e && e.pointerId !== st.id)) return;
      const s = st;
      if (!s.drag) { cleanup(); return; }
      suppress = true; setTimeout(function () { suppress = false; }, 60);
      const ghost = s.ghost, zone = cancelled ? null : s.over, data = o.data;
      try { el.releasePointerCapture(s.id); } catch (err) { /* ignore */ }
      const target = zone ? zone.getBoundingClientRect() : el.getBoundingClientRect();
      ghost.classList.add('landing');
      ghost.style.transform = 'translate(' + (target.left + target.width / 2 - s.gw / 2) + 'px,' + (target.top + target.height / 2 - s.gh / 2) + 'px) scale(' + (zone ? 0.3 : 1) + ')';
      ghost.style.opacity = zone ? '0' : '0.2';
      setTimeout(function () { ghost.remove(); }, 260);
      cleanup();
      if (zone) { if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) { /* ignore */ } } if (o.onDrop) o.onDrop(zone, data); }
      if (o.onEnd) o.onEnd(!!zone);
    };
    el.addEventListener('pointerup', function (e) { finish(e, false); });
    el.addEventListener('pointercancel', function (e) { finish(e, true); });
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  /* ---------- illustrations (small animated SVG scenes) ---------- */
  function sparkle(x, y, s, d) { return svg('path', { d: 'M' + x + ',' + (y - s) + ' L' + (x + s * 0.28) + ',' + (y - s * 0.28) + ' L' + (x + s) + ',' + y + ' L' + (x + s * 0.28) + ',' + (y + s * 0.28) + ' L' + x + ',' + (y + s) + ' L' + (x - s * 0.28) + ',' + (y + s * 0.28) + ' L' + (x - s) + ',' + y + ' L' + (x - s * 0.28) + ',' + (y - s * 0.28) + ' Z', 'class': 'tw', style: '--d:' + d + 's' }); }
  function illustration(kind) {
    const g = function (cls, delay) { const el = svg('g', { 'class': cls }); if (delay !== undefined) el.style.setProperty('--d', delay + 's'); for (let i = 2; i < arguments.length; i++) el.appendChild(arguments[i]); return el; };
    const R = function (x, y, wd, ht, rx, cls, extra) { return svg('rect', Object.assign({ x: x, y: y, width: wd, height: ht, rx: rx, 'class': cls }, extra || {})); };
    const C = function (cx, cy, r, cls) { return svg('circle', { cx: cx, cy: cy, r: r, 'class': cls }); };
    const P = function (d, cls) { return svg('path', { d: d, 'class': cls, fill: 'none' }); };
    const s = svg('svg', { viewBox: '0 0 360 210', 'class': 'ill ill-' + kind, 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'hero') {
      s.appendChild(C(180, 105, 96, 'ill-glow'));
      s.appendChild(g('fl', 0, R(34, 56, 182, 88, 18, 'ill-card'), R(54, 76, 86, 9, 4.5, 'ill-line'), R(54, 102, 142, 8, 4, 'ill-track'), R(54, 102, 100, 8, 4, 'ill-fill ill-grow'), C(192, 80, 12, 'ill-ok'), P('M186 80l4.5 4.5L199 75', 'ill-tick'), R(54, 120, 56, 14, 7, 'ill-tag')));
      s.appendChild(g('fl', -2.2, R(148, 112, 180, 80, 18, 'ill-card'), C(176, 140, 14, 'ill-av1'), R(198, 128, 80, 8, 4, 'ill-line'), R(198, 144, 108, 7, 3.5, 'ill-track'), C(300, 132, 6, 'ill-warn')));
      s.appendChild(g('fl', -1, R(250, 20, 76, 40, 18, 'ill-card'), svg('circle', { cx: 272, cy: 40, r: 4, 'class': 'ill-dot', style: '--d:0s' }), svg('circle', { cx: 288, cy: 40, r: 4, 'class': 'ill-dot', style: '--d:.15s' }), svg('circle', { cx: 304, cy: 40, r: 4, 'class': 'ill-dot', style: '--d:.3s' })));
      s.appendChild(sparkle(30, 34, 9, 0)); s.appendChild(sparkle(330, 112, 7, 0.7)); s.appendChild(sparkle(120, 28, 6, 1.3)); s.appendChild(sparkle(60, 176, 6, 0.4));
    } else if (kind === 'inbox') {
      s.appendChild(C(180, 112, 74, 'ill-soft'));
      s.appendChild(g('fl', 0, R(116, 42, 128, 70, 14, 'ill-card2'), R(134, 60, 60, 8, 4, 'ill-line2'), R(134, 80, 92, 7, 3.5, 'ill-track2'), C(222, 64, 9, 'ill-ok'), P('M217 64l3.5 3.5L227 60', 'ill-tick')));
      s.appendChild(P('M96 118h54l10 20h40l10-20h54v48a14 14 0 0 1-14 14H110a14 14 0 0 1-14-14z', 'ill-tray'));
      s.appendChild(sparkle(84, 54, 8, 0.2)); s.appendChild(sparkle(280, 74, 6, 0.9)); s.appendChild(sparkle(262, 30, 5, 1.4));
    } else if (kind === 'team') {
      s.appendChild(C(180, 104, 78, 'ill-soft'));
      s.appendChild(P('M180 70L120 140M180 70L240 140M120 140L240 140', 'ill-wire'));
      s.appendChild(g('fl', 0, C(180, 66, 26, 'ill-av1'), C(180, 60, 8, 'ill-face'), P('M166 80a14 12 0 0 1 28 0', 'ill-face-s')));
      s.appendChild(g('fl', -1.4, C(118, 140, 22, 'ill-av2'), C(118, 135, 7, 'ill-face'), P('M106 152a12 10 0 0 1 24 0', 'ill-face-s')));
      s.appendChild(g('fl', -2.6, C(242, 140, 22, 'ill-av3'), C(242, 135, 7, 'ill-face'), P('M230 152a12 10 0 0 1 24 0', 'ill-face-s')));
      s.appendChild(sparkle(70, 70, 7, 0.3)); s.appendChild(sparkle(296, 60, 8, 1));
    } else if (kind === 'done') {
      s.appendChild(C(180, 104, 70, 'ill-pulse')); s.appendChild(C(180, 104, 52, 'ill-ok-big'));
      s.appendChild(P('M156 106l17 17 32-36', 'ill-tick-big'));
      s.appendChild(sparkle(96, 64, 9, 0)); s.appendChild(sparkle(268, 80, 7, 0.8)); s.appendChild(sparkle(250, 156, 6, 1.4)); s.appendChild(sparkle(110, 154, 6, 0.5));
    } else { // search
      s.appendChild(C(180, 104, 76, 'ill-soft'));
      s.appendChild(g('fl', 0, C(168, 98, 36, 'ill-lens'), P('M194 124l34 34', 'ill-handle')));
      s.appendChild(C(120, 60, 6, 'ill-bub')); s.appendChild(C(250, 70, 8, 'ill-bub')); s.appendChild(C(238, 150, 5, 'ill-bub'));
    }
    return s;
  }

  /* ---------- profile picture: choose, crop, shrink ---------- */
  let photoInput = null, photoResolve = null;
  function loadImage(file) {
    return new Promise(function (res, rej) {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
      img.src = url;
    });
  }
  // Resolves with a small JPEG data URL (about 144 px square), or null if cancelled.
  function pickPhoto() {
    return new Promise(function (resolve) {
      photoResolve = resolve;
      if (!photoInput) {
        photoInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden', 'aria-hidden': 'true', tabindex: '-1' });
        photoInput.addEventListener('change', async function () {
          const f = photoInput.files && photoInput.files[0]; photoInput.value = '';
          const done = photoResolve; if (!f) return;
          try { cropModal(await loadImage(f), done); } catch (e) { toast(e.message || 'Could not read that image', 'bad'); done(null); }
        });
        document.body.appendChild(photoInput);
      }
      photoInput.click();
    });
  }
  function cropModal(img, resolve) {
    const V = 260, OUT = 144;
    const base = V / Math.min(img.naturalWidth, img.naturalHeight);
    let zoom = 1, ox = 0, oy = 0, answered = false;
    const cv = h('canvas', { width: V * 2, height: V * 2, class: 'crop-canvas', 'aria-label': 'Drag to move the picture' });
    const ctx = cv.getContext('2d');
    const clamp = function () { const mx = Math.max(0, (img.naturalWidth * base * zoom - V) / 2), my = Math.max(0, (img.naturalHeight * base * zoom - V) / 2); ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy)); };
    const paint = function (c, size) {
      const k = size / V, sw = img.naturalWidth * base * zoom * k, sh = img.naturalHeight * base * zoom * k;
      c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
      c.drawImage(img, size / 2 + ox * k - sw / 2, size / 2 + oy * k - sh / 2, sw, sh);
    };
    const draw = function () { clamp(); paint(ctx, V * 2); };
    let drag = null;
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) { if (!drag) return; ox += e.clientX - drag.x; oy += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; draw(); });
    cv.addEventListener('pointerup', function () { drag = null; }); cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); zoom = Math.max(1, Math.min(4, zoom - e.deltaY / 400)); slider.value = zoom; draw(); }, { passive: false });
    const slider = h('input', { type: 'range', min: 1, max: 4, step: 0.02, value: 1, 'aria-label': 'Zoom' });
    slider.addEventListener('input', function () { zoom = Number(slider.value); draw(); });
    const answer = function (v) { if (!answered) { answered = true; resolve(v); } };
    const m = modal({ title: 'Adjust your photo', noFocus: true, onClose: function () { answer(null); },
      body: h('div', { class: 'cropper' }, h('div', { class: 'crop-frame' }, cv), h('div', { class: 'row', style: 'gap:.6rem;flex-wrap:nowrap' }, icon('search', 16), slider), h('p', { class: 'hint', style: 'text-align:center' }, 'Drag to move, use the slider to zoom.')),
      actions: [{ label: 'Cancel' }, { label: 'Use this photo', kind: 'primary', onClick: function () {
        const out = h('canvas', { width: OUT, height: OUT }), oc = out.getContext('2d'); paint(oc, OUT);
        let q = 0.85, data = out.toDataURL('image/jpeg', q);
        while (data.length > 18000 && q > 0.4) { q -= 0.1; data = out.toDataURL('image/jpeg', q); }
        answer(data);
      } }] });
    draw();
    return m;
  }

  /* ---------- photos and documents ---------- */
  const FILE_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods';
  const FILE_EXTS = 'jpg jpeg png webp gif pdf doc docx xls xlsx ppt pptx txt csv rtf odt ods'.split(' ');
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  function fileExt(name) { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function fileKind(name) {
    const e = fileExt(name);
    if (e === 'pdf') return 'pdf'; if (e === 'doc' || e === 'docx' || e === 'rtf' || e === 'odt') return 'doc';
    if (e === 'xls' || e === 'xlsx' || e === 'csv' || e === 'ods') return 'xls'; if (e === 'ppt' || e === 'pptx') return 'ppt';
    return 'file';
  }
  function fmtSize(b) { b = Number(b) || 0; return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function fileIcon(name) { const k = fileKind(name); return h('span', { class: 'file-ico', 'data-k': k, 'aria-hidden': 'true' }, fileExt(name).slice(0, 4) || 'file'); }
  function readB64(file) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(new Error('Could not read that file')); };
      r.readAsDataURL(file);
    });
  }
  function drawScaled(img, maxSide) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = h('canvas', { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) }), c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }
  // A photo from the phone can be 5-10 MB. Shrink it to a sensible size (1600 px, JPEG) and make a small preview picture.
  async function prepareImage(file) {
    let img;
    try { img = await loadImage(file); } catch (e) { throw new Error('This picture could not be opened. Try a JPG or PNG photo.'); }
    let side = 1600, q = 0.82, cv = drawScaled(img, side), data = cv.toDataURL('image/jpeg', q);
    for (let i = 0; i < 5 && data.length > 6000000; i++) { if (q > 0.5) q -= 0.15; else { side = Math.round(side * 0.75); cv = drawScaled(img, side); } data = cv.toDataURL('image/jpeg', q); }
    let ts = 200, tq = 0.62, thumb = drawScaled(img, ts).toDataURL('image/jpeg', tq);
    for (let i = 0; i < 6 && thumb.length > 8800; i++) { if (tq > 0.35) tq -= 0.1; else { ts = Math.round(ts * 0.8); } thumb = drawScaled(img, ts).toDataURL('image/jpeg', tq); }
    const base = String(file.name || 'photo').replace(/\.[^.]*$/, '').slice(0, 60) || 'photo';
    return { name: base + '.jpg', b64: data.split(',')[1], thumb: thumb.length <= 9000 ? thumb : '', w: cv.width, h: cv.height };
  }
  // Turns what the person picked into what the server wants: { name, b64, thumb?, w?, h? }. Throws a friendly error.
  async function prepareFile(file) {
    const e = fileExt(file.name), type = String(file.type || '');
    const isImg = type.indexOf('image/') === 0 || ['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(e) >= 0;
    if (isImg) return prepareImage(file);
    if (FILE_EXTS.indexOf(e) < 0) throw new Error('"' + file.name + '" is not a file type that can be shared. Use photos, PDF, Word, Excel, PowerPoint or text files.');
    if (file.size > MAX_FILE_BYTES) throw new Error('"' + file.name + '" is ' + fmtSize(file.size) + '. The limit is 5 MB.');
    return { name: file.name, b64: await readB64(file) };
  }
  function pickFiles(kind) {
    return new Promise(function (resolve) {
      const input = h('input', { type: 'file', class: 'hidden', 'aria-hidden': 'true', tabindex: '-1' });
      if (kind === 'camera') { input.setAttribute('accept', 'image/*'); input.setAttribute('capture', 'environment'); }
      else if (kind === 'photo') { input.setAttribute('accept', 'image/*'); input.multiple = true; }
      else { input.setAttribute('accept', FILE_ACCEPT); input.multiple = true; }
      input.addEventListener('change', function () { const f = Array.prototype.slice.call(input.files || []); input.remove(); resolve(f); });
      input.addEventListener('cancel', function () { input.remove(); resolve([]); });
      document.body.appendChild(input); input.click();
    });
  }
  // The "attach" menu. Resolves with the chosen files (or []).
  function attachMenu() {
    return new Promise(function (resolve) {
      let m = null, answered = false;
      const answer = function (v) { if (!answered) { answered = true; resolve(v); } };
      const opt = function (ic, title, sub, kind) {
        return h('button', { type: 'button', class: 'attach-opt', onclick: function () { pickFiles(kind).then(answer); m.close(); } }, h('span', { class: 'ic' }, icon(ic, 22)), h('span', null, title, h('small', null, sub)));
      };
      m = modal({ title: 'Share a file', noFocus: true, onClose: function () { setTimeout(function () { answer([]); }, 300); },
        body: h('div', { class: 'attach-sheet' }, opt('camera', 'Take a photo', 'Use the camera', 'camera'), opt('image', 'Photo from gallery', 'Pictures are shrunk automatically', 'photo'), opt('file', 'Document', 'PDF, Word, Excel, PowerPoint, text (up to 5 MB)', 'doc')) });
    });
  }
  function b64Url(b64, mime) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }
  function saveUrl(url, name) { const a = h('a', { href: url, download: name || 'file' }); document.body.appendChild(a); a.click(); a.remove(); }
  function lightbox(url, name) {
    modal({ title: name, cls: 'wide', body: h('div', { class: 'lightbox' }, h('img', { src: url, alt: name })),
      actions: [{ label: 'Close' }, { label: 'Download', kind: 'primary', onClick: function () { saveUrl(url, name); return false; } }] });
  }

  /* ---------- button ripple ---------- */
  document.addEventListener('pointerdown', function (e) {
    const b = e.target.closest && e.target.closest('.btn, .send, .mic, .fab');
    if (!b || b.disabled || reduced()) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.6;
    const rip = h('span', { class: 'ripple', style: 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px' });
    b.appendChild(rip); setTimeout(function () { rip.remove(); }, 650);
  }, { passive: true });

  /* ---------- theme (automatic / light / dark) ---------- */
  const THEME_KEY = 'taskapp.theme';
  function themeGet() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function themeApply() {
    const v = themeGet(), de = document.documentElement;
    if (v === 'auto') de.removeAttribute('data-theme'); else de.setAttribute('data-theme', v);
  }
  function themeSet(v) { try { if (v === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage blocked */ } themeApply(); }

  w.h = h;
  w.UI = { h: h, svg: svg, clear: clear, icon: icon, setIcon: setIcon, date: date, time: time, dateTime: dateTime, dayLabel: dayLabel, ago: ago, duration: duration, dueInfo: dueInfo, greeting: greeting, ymd: ymd,
    toast: toast, modal: modal, confirm: confirmBox, progressBar: progressBar, ring: ring, donut: donut, countUp: countUp, confetti: confetti, draggable: draggable, illustration: illustration,
    chip: chip, initials: initials, avatar: avatar, avatarStack: avatarStack, hydrateAvatars: hydrateAvatars, pickPhoto: pickPhoto, reduced: reduced,
    skeleton: skeleton, emptyState: emptyState, copyText: copyText, passwordField: passwordField, theme: { get: themeGet, set: themeSet, apply: themeApply },
    fileIcon: fileIcon, fileKind: fileKind, fmtSize: fmtSize, prepareFile: prepareFile, attachMenu: attachMenu, b64Url: b64Url, saveUrl: saveUrl, lightbox: lightbox, MAX_FILE_BYTES: MAX_FILE_BYTES };
})(window);
