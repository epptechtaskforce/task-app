/* org.js - the admin "Org chart" canvas.
 * People are placed in layers (one per job-title level) inside a pyramid.
 * A tether is an arrow  A -> B  meaning "A can assign tasks to B".  It must point to a LOWER layer.
 * Ways to draw: (1) tap a person, then tap another person lower down;  (2) drag from the dot under a person.
 * Tap an arrow to select it, then press "Remove arrow". Nothing is saved until "Finalize & save".
 */
(function (w) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 178, NODE_H = 58, ROW_GAP = 134, TOP = 40, MIN_SLOT = 200;

  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
  }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /**
   * opts: { users:[{id,name,jobTitle,level,active}], links:[{fromId,toId}], onSave(links, note) -> Promise }
   * Returns a DOM element to insert in the page.
   */
  function create(opts) {
    const users = opts.users.filter(function (u) { return u.level !== null && u.level !== undefined; });
    const byId = {}; users.forEach(function (u) { byId[u.id] = u; });
    const original = opts.links.filter(function (l) { return byId[l.fromId] && byId[l.toId]; });
    let links = original.map(function (l) { return { fromId: l.fromId, toId: l.toId }; });
    let selNode = null, selLink = null, drag = null;

    const wrap = h('div', { class: 'org' });
    const toolbar = h('div', { class: 'org-toolbar' });
    const scroller = h('div', { class: 'org-scroll' });
    const info = h('div', { class: 'org-info' });
    wrap.appendChild(toolbar); wrap.appendChild(scroller); wrap.appendChild(info);

    // ---- layout ----
    const levels = Array.from(new Set(users.map(function (u) { return u.level; }))).sort(function (a, b) { return a - b; });
    const rows = levels.map(function (lv) { return users.filter(function (u) { return u.level === lv; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); });
    const maxCount = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    const baseW = Math.max(maxCount * MIN_SLOT, 520);
    const totalW = baseW + 40;
    const totalH = TOP * 2 + Math.max(rows.length - 1, 0) * ROW_GAP + NODE_H;
    const pos = {};
    rows.forEach(function (row, i) {
      const frac = rows.length > 1 ? i / (rows.length - 1) : 1;
      const rowW = Math.max(baseW * (0.42 + 0.58 * frac), row.length * MIN_SLOT);
      row.forEach(function (u, k) { pos[u.id] = { x: totalW / 2 - rowW / 2 + (k + 0.5) * rowW / row.length, y: TOP + i * ROW_GAP + NODE_H / 2, rowW: rowW }; });
    });

    function valid(a, b) { return a !== b && byId[a] && byId[b] && byId[a].level < byId[b].level; }
    function has(a, b) { return links.some(function (l) { return l.fromId === a && l.toId === b; }); }
    function toggle(a, b) {
      if (has(a, b)) links = links.filter(function (l) { return !(l.fromId === a && l.toId === b); });
      else links.push({ fromId: a, toId: b });
      selLink = null; draw();
    }
    function dirty() {
      const key = function (ls) { return ls.map(function (l) { return l.fromId + '>' + l.toId; }).sort().join('|'); };
      return key(links) !== key(original);
    }

    // ---- drawing ----
    function draw() {
      scroller.textContent = '';
      const s = svg('svg', { width: totalW, height: totalH, viewBox: '0 0 ' + totalW + ' ' + totalH, class: 'org-svg', role: 'group', 'aria-label': 'Organisation chart' });
      const defs = svg('defs', {},
        svg('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' })),
        svg('marker', { id: 'arr-hi', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head hi' })));
      s.appendChild(defs);

      // pyramid layers
      rows.forEach(function (row, i) {
        const y0 = TOP + i * ROW_GAP - 28, y1 = y0 + NODE_H + 56, cx = totalW / 2;
        const w0 = (pos[row[0].id].rowW), nextW = i + 1 < rows.length ? pos[rows[i + 1][0].id].rowW : w0 * 1.1;
        s.appendChild(svg('polygon', { class: 'layer' + (i % 2 ? ' alt' : ''), points: [cx - w0 / 2 - 20, y0, cx + w0 / 2 + 20, y0, cx + nextW / 2 + 20, y1, cx - nextW / 2 - 20, y1].join(' ') }));
        s.appendChild(svg('text', { x: 8, y: y0 + 18, class: 'layer-label' }, 'Layer ' + levels[i]));
      });

      // arrows
      links.forEach(function (l) {
        const a = pos[l.fromId], b = pos[l.toId]; if (!a || !b) return;
        const x1 = a.x, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y - NODE_H / 2, my = (y1 + y2) / 2;
        const isSel = selLink && selLink.fromId === l.fromId && selLink.toId === l.toId;
        const hi = isSel || selNode === l.fromId || selNode === l.toId;
        const d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + (y2 - 2);
        const g = svg('g', { class: 'link' + (hi ? ' hi' : '') + (selNode && !hi ? ' dim' : '') + (isSel ? ' sel' : '') });
        g.appendChild(svg('path', { d: d, class: 'link-line', 'marker-end': hi ? 'url(#arr-hi)' : 'url(#arr)' }));
        const hit = svg('path', { d: d, class: 'link-hit' });
        hit.addEventListener('click', function (e) { e.stopPropagation(); selLink = l; selNode = null; draw(); });
        g.appendChild(hit);
        s.appendChild(g);
      });

      // drag preview
      if (drag) s.appendChild(svg('path', { class: 'link-line preview', d: 'M' + pos[drag.from].x + ',' + (pos[drag.from].y + NODE_H / 2) + ' L' + drag.x + ',' + drag.y }));

      // people
      users.forEach(function (u) {
        const p = pos[u.id];
        const canTarget = selNode && selNode !== u.id && valid(selNode, u.id);
        const g = svg('g', { class: 'node' + (selNode === u.id ? ' sel' : '') + (u.active === false ? ' off' : '') + (canTarget ? ' target' : '') + (has(selNode, u.id) ? ' linked' : ''), 'data-id': u.id, tabindex: 0, role: 'button', 'aria-label': u.name + ', ' + u.jobTitle });
        g.appendChild(svg('rect', { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 12 }));
        // picture (or initials) on the left of the card
        const ax = p.x - NODE_W / 2 + 30, ay = p.y, photo = w.Profiles ? w.Profiles.photo(u.id) : '';
        g.appendChild(svg('circle', { cx: ax, cy: ay, r: 18, class: 'n-av n-av-bg' }));
        if (photo) {
          const cid = 'clip-' + u.id;
          defs.appendChild(svg('clipPath', { id: cid }, svg('circle', { cx: ax, cy: ay, r: 18 })));
          g.appendChild(svg('image', { href: photo, x: ax - 18, y: ay - 18, width: 36, height: 36, 'clip-path': 'url(#' + cid + ')', preserveAspectRatio: 'xMidYMid slice', class: 'n-av' }));
        } else g.appendChild(svg('text', { x: ax, y: ay + 4, class: 'n-av n-av-t', 'text-anchor': 'middle' }, String(u.name || '?').split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase()));
        g.appendChild(svg('text', { x: p.x - NODE_W / 2 + 56, y: p.y - 3, class: 'n-name' }, clip(u.name, 16)));
        g.appendChild(svg('text', { x: p.x - NODE_W / 2 + 56, y: p.y + 14, class: 'n-title' }, clip(u.jobTitle, 20)));
        const handle = svg('circle', { cx: p.x, cy: p.y + NODE_H / 2, r: 9, class: 'handle', 'data-handle': u.id });
        handle.addEventListener('pointerdown', function (e) { startDrag(e, u.id, s); });
        g.appendChild(handle);
        g.addEventListener('click', function (e) { e.stopPropagation(); onNode(u.id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNode(u.id); } });
        s.appendChild(g);
      });
      s.addEventListener('click', function () { selNode = null; selLink = null; draw(); });
      scroller.appendChild(s);
      renderToolbar(); renderInfo();
    }

    function onNode(id) {
      if (selNode && selNode !== id && valid(selNode, id)) { toggle(selNode, id); return; }
      if (selNode && selNode !== id && byId[selNode].level >= byId[id].level) {
        UI.toast(byId[selNode].level === byId[id].level ? 'People in the same layer cannot be tethered.' : 'Arrows must point from a higher layer down to a lower layer.', 'bad');
      }
      selNode = selNode === id ? null : id; selLink = null; draw();
    }

    function startDrag(e, from, s) {
      e.preventDefault(); e.stopPropagation();
      const pt = s.createSVGPoint();
      const toLocal = function (ev) { pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(s.getScreenCTM().inverse()); };
      drag = { from: from, x: pos[from].x, y: pos[from].y + NODE_H / 2 };
      const move = function (ev) { const p = toLocal(ev); drag.x = p.x; drag.y = p.y; const prev = s.querySelector('.preview'); if (prev) prev.setAttribute('d', 'M' + pos[from].x + ',' + (pos[from].y + NODE_H / 2) + ' L' + p.x + ',' + p.y); };
      const up = function (ev) {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        const el = document.elementFromPoint(ev.clientX, ev.clientY), node = el && el.closest ? el.closest('.node') : null;
        const target = node && node.getAttribute('data-id');
        drag = null;
        if (target && target !== from) {
          if (valid(from, target)) { if (!has(from, target)) { links.push({ fromId: from, toId: target }); selLink = null; selNode = from; } }
          else UI.toast('Arrows must point from a higher layer down to a lower layer.', 'bad');
        }
        draw();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
      draw();
    }

    function renderToolbar() {
      toolbar.textContent = '';
      const changed = dirty();
      toolbar.appendChild(h('span', { class: 'org-count' }, links.length + ' arrow' + (links.length === 1 ? '' : 's') + (changed ? ' - unsaved changes' : '')));
      toolbar.appendChild(h('button', { class: 'btn small', type: 'button', disabled: !selLink, onclick: function () {
        links = links.filter(function (l) { return !(l.fromId === selLink.fromId && l.toId === selLink.toId); }); selLink = null; draw();
      } }, 'Remove arrow'));
      toolbar.appendChild(h('button', { class: 'btn small', type: 'button', disabled: !changed, onclick: function () { links = original.map(function (l) { return { fromId: l.fromId, toId: l.toId }; }); selNode = selLink = null; draw(); } }, 'Discard changes'));
      toolbar.appendChild(h('button', { class: 'btn primary small', type: 'button', disabled: !changed, onclick: save }, 'Finalize & save'));
    }

    function renderInfo() {
      info.textContent = '';
      if (!users.length) { info.appendChild(h('p', { class: 'muted' }, 'No people with a job title yet. Add job titles and users first.')); return; }
      if (selNode) {
        const u = byId[selNode];
        const out = links.filter(function (l) { return l.fromId === selNode; }).map(function (l) { return byId[l.toId].name; });
        const inn = links.filter(function (l) { return l.toId === selNode; }).map(function (l) { return byId[l.fromId].name; });
        info.appendChild(h('p', null, h('strong', null, u.name), ' (' + u.jobTitle + ') can assign tasks to: ', out.length ? out.join(', ') : 'nobody'));
        info.appendChild(h('p', { class: 'muted' }, 'Receives tasks from: ' + (inn.length ? inn.join(', ') : 'nobody') + '. Tap another person in a lower layer to add or remove an arrow.'));
      } else if (selLink) {
        info.appendChild(h('p', null, byId[selLink.fromId].name + ' can assign tasks to ' + byId[selLink.toId].name + '.'));
      } else {
        info.appendChild(h('p', { class: 'muted' }, 'Tap a person, then tap someone in a lower layer to draw an arrow (tap again to remove it). You can also drag from the dot under a person. People only see and assign tasks to the people their arrows point to.'));
      }
    }

    function save() {
      const note = h('input', { type: 'text', maxlength: 300, placeholder: 'What changed? (optional)' });
      UI.modal({
        title: 'Finalize the org chart?',
        body: h('div', null, h('p', null, 'This saves ' + links.length + ' arrow(s) and applies them to everyone immediately. Tasks that already exist keep working.'), h('label', null, 'Note', note)),
        actions: [{ label: 'Cancel' }, { label: 'Finalize & save', kind: 'primary', onClick: async function () {
          try { await opts.onSave(links.map(function (l) { return { fromId: l.fromId, toId: l.toId }; }), note.value); UI.toast('Org chart saved'); }
          catch (e) { UI.toast(e.message, 'bad'); return false; }
        } }]
      });
    }

    draw();
    return wrap;
  }

  w.OrgCanvas = { create: create };
})(window);
