/* app.js - screens, routing and glue. All text from the server is inserted with textContent (via h()), never as HTML. */
(function () {
  'use strict';
  const root = document.getElementById('app');
  // S.kind / S.peek: which screen is open and a live look at it (what is filled in, what is listed). The AI bubble asks for it on every
  // question so that it and the person look at the same screen. S.fill lets it fill in the New task form; S.pendingFill waits for that form.
  const S = { kind: '', peek: null, fill: null, pendingFill: null, user: null, company: '', canAssign: false, canUseAi: false, only: [], histQ: '', timers: [], leave: [], filter: 'all', sort: 'recent', q: '', unread: 0, playing: null, taskMem: {} };

  /* ============================== helpers ============================== */

  function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }
  // Things a screen must clean up when the person leaves it (stop talking, stop the microphone, ...).
  function onLeave(fn) { S.leave.push(fn); }
  function runLeave() { const fns = S.leave; S.leave = []; fns.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }
  // After the assistant (or anything else) changed tasks behind the screen's back.
  function invalidate() { S.taskMem = {}; if (S.user) { try { Api.cacheSet('tasks:' + S.user.id, { tasks: [] }); } catch (e) { /* ignore */ } } }
  // Refresh in the background, but never stack requests: a tick is skipped while the previous one is still waiting
  // (a slow server must not be buried under more questions), and after a failure the next tries are spaced out.
  // Quiet refreshes: the first paint of a screen plays its little entrance animations; once it has settled (`calm` on <body>) later
  // refreshes swap the content without replaying them, so the screen never flashes when fresh data arrives.
  let settleT = 0;
  function settle() { if (settleT) return; settleT = setTimeout(function () { document.body.classList.add('calm'); }, 1500); }
  function unsettle() { clearTimeout(settleT); settleT = 0; document.body.classList.remove('calm'); }
  function poll(fn, ms) {
    let busy = false, skip = 0;
    S.timers.push(setInterval(function () {
      if (document.hidden || busy) return;
      if (skip > 0) { skip--; return; }
      busy = true;
      Promise.resolve().then(fn).then(function () { skip = 0; fails = 0; }, function () { skip = Math.min(++fails, 4); }).then(function () { busy = false; });
    }, ms));
    let fails = 0;
  }
  // Pure administrators (no job title) have no tasks, so start them on the Users page.
  function landing() { return S.user && S.user.isAdmin && !S.user.jobTitleId ? '#/admin/users' : '#/tasks'; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function mount(node) { UI.clear(root); document.body.classList.remove('focus-view'); root.appendChild(node); window.scrollTo(0, 0); }
  function isPureAdmin() { return !!(S.user && S.user.isAdmin && !S.user.jobTitleId); }
  function firstName() { return String((S.user && S.user.name) || '').split(/\s+/)[0] || ''; }
  const icon = UI.icon;
  const prefersReduced = UI.reduced;

  function errBox(e) { return h('div', { class: 'err', role: 'alert' }, e.message || String(e)); }

  // Runs an async action, shows errors as toasts, handles expired sessions.
  async function guarded(fn) {
    try { return await fn(); }
    catch (e) {
      if (e.code === 'MUSTCHANGE') { S.user.mustChange = true; return viewMustChange(); }
      if (e.code !== 'AUTH') UI.toast(e.message, 'bad');
    }
  }

  function statusChip(t) {
    if (t.status === 'pending') return UI.chip('Awaiting approval', 'warn', 'clock');
    if (t.progress === 0) return UI.chip('Not started');
    return UI.chip('In progress', 'info');
  }
  function peopleLine(t) {
    return t.role === 'creator' ? 'To: ' + t.assignees.map(function (a) { return a.name; }).join(', ') : 'From: ' + t.creator.name + (t.assignees.length > 1 ? ' · with ' + (t.assignees.length - 1) + ' other' + (t.assignees.length > 2 ? 's' : '') : '');
  }
  function names(list) { return list.map(function (a) { return a.name; }); }

  // The four states a task can be in, for the donut chart and its filters (a task is in exactly one).
  const BUCKETS = [['late', 'Overdue', '#ef5b6c'], ['wait', 'Awaiting approval', '#f6b73c'], ['active', 'In progress', '#5b8def'], ['new', 'Not started', '#98a0b6']];
  function bucket(t) {
    const due = UI.dueInfo(t.dueDate, t.status);
    if (due && due.cls === 'bad') return 'late';
    if (t.status === 'pending') return 'wait';
    return t.progress > 0 ? 'active' : 'new';
  }

  /* ---------- people: tap a face to see who they are ---------- */

  function personBtn(p, size) {
    return h('button', { type: 'button', class: 'who-btn', onclick: function () { showPerson(p); } }, UI.avatar(p.name, size || 'xs', p.id), h('span', null, p.name));
  }
  function showPerson(p) {
    const bio = Profiles.bio(p.id), mine = S.user && p.id === S.user.id;
    const known = (Api.cacheGet('assignable') || []).some(function (x) { return x.id === p.id; });
    const actions = [{ label: 'Close' }];
    if (!mine && S.canAssign && known) actions.push({ label: 'Assign a task', kind: 'primary', onClick: function (close) { close(); go('#/new/' + p.id); return false; } });
    if (mine) actions.push({ label: 'Edit my profile', kind: 'primary', onClick: function (close) { close(); go('#/account'); return false; } });
    UI.modal({ label: p.name, noFocus: true, cls: 'person-modal', actions: actions,
      body: h('div', { class: 'person-sheet' }, UI.avatar(p.name, 'xl', p.id), h('h2', null, p.name),
        p.jobTitle ? UI.chip(p.jobTitle, 'brand') : null,
        bio ? h('p', { class: 'bio-text' }, bio) : h('p', { class: 'bio-text bio-empty' }, mine ? 'You have not written a bio yet.' : 'No bio yet.')) });
    Profiles.refresh();
  }

  /* ============================== shell (sidebar on wide screens, bottom tabs on phones) ============================== */

  function navModel() {
    const u = S.user, pure = isPureAdmin();
    const work = pure ? [] : [{ k: 'tasks', href: '#/tasks', label: 'Tasks', ic: 'tasks' }, { k: 'history', href: '#/history', label: 'History', ic: 'history' }];
    const admin = u.isAdmin ? [{ k: 'users', href: '#/admin/users', label: 'Users', ic: 'users' }, { k: 'titles', href: '#/admin/titles', label: 'Job titles', ic: 'briefcase' }, { k: 'org', href: '#/admin/org', label: 'Org chart', ic: 'org' }] : [];
    const account = { k: 'account', href: '#/account', label: 'Account', ic: 'user' };
    return { work: work, admin: admin, account: account };
  }
  function unreadBadge() { return S.unread ? h('span', { class: 'nav-badge', 'aria-label': S.unread + ' unread' }, S.unread) : null; }

  // opts: { focus: hide the bottom tabs (conversation screens), back: '#/hash' shows a back arrow on phones, title: text for the phone top bar }
  function shell(content, active, opts) {
    opts = opts || {};
    const u = S.user, m = navModel();
    const adminKeys = ['users', 'titles', 'org'];

    const sideLink = function (n) { return h('a', { href: n.href, class: (n.k === active ? 'active' : '') + (n.k === 'assistant' ? ' ai-link' : ''), 'data-nav': n.k, 'aria-current': n.k === active ? 'page' : false }, icon(n.ic, 20), n.label, n.k === 'tasks' ? unreadBadge() : null); };
    const sidebar = h('aside', { class: 'sidebar' },
      h('div', { class: 'side-brand' }, h('span', { class: 'logo' }, UI.logoMark(24)), h('span', null, S.company || 'Task Manager')),
      S.canAssign ? h('a', { class: 'btn primary side-new', href: '#/new' }, icon('plus', 18), 'New task') : null,
      h('nav', { class: 'side-nav', 'aria-label': 'Main' },
        m.work.length ? [h('div', { class: 'side-label' }, 'Work'), m.work.map(sideLink)] : null,
        m.admin.length ? [h('div', { class: 'side-label' }, 'Administration'), m.admin.map(sideLink)] : null,
        h('div', { class: 'side-label' }, 'Me'), sideLink(m.account)),
      h('div', { class: 'side-user' }, h('a', { class: 'me', href: '#/account', 'aria-label': 'My profile' }, UI.avatar(u.name, '', u.id), h('div', { class: 'who' }, h('strong', null, u.name), h('span', null, [u.jobTitle, u.isAdmin ? 'Administrator' : ''].filter(Boolean).join(' · ') || 'Team member'))),
        h('button', { type: 'button', class: 'icon-btn', title: 'Sign out', 'aria-label': 'Sign out', onclick: signOut }, icon('logout', 20))));

    const titleEl = h('div', { class: 'brand' }, opts.title || S.company || 'Task Manager');
    const mtop = h('header', { class: 'mtop' }, h('div', { class: 'mtop-in' },
      opts.back ? h('a', { class: 'icon-btn', href: opts.back, 'aria-label': 'Back' }, icon('back', 24)) : h('span', { class: 'logo' }, UI.logoMark(24)),
      titleEl,
      opts.back ? null : h('a', { class: 'icon-btn', href: '#/account', 'aria-label': 'My profile' }, UI.avatar(u.name, 'sm', u.id))));

    // bottom tabs: admins who also have tasks get one "Admin" tab (its pages have a switcher at the top)
    const tabs = isPureAdmin() ? m.admin.concat([m.account]) : m.work.concat(u.isAdmin ? [{ k: 'admin', href: '#/admin/users', label: 'Admin', ic: 'shield' }] : [], [m.account]);
    const bottom = opts.focus ? null : h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, tabs.map(function (n) {
      const on = n.k === active || (n.k === 'admin' && adminKeys.indexOf(active) >= 0);
      return h('a', { href: n.href, class: (on ? 'active' : '') + (n.k === 'assistant' ? ' ai' : ''), 'data-nav': n.k, 'aria-current': on ? 'page' : false }, h('span', { class: 'pill' }, icon(n.ic, n.k === 'assistant' ? 26 : 22), n.k === 'tasks' ? unreadBadge() : null), n.label);
    }));

    const adminSwitch = u.isAdmin && adminKeys.indexOf(active) >= 0 && !isPureAdmin()
      ? h('nav', { class: 'seg seg-admin', 'aria-label': 'Administration' }, m.admin.map(function (n) { return h('a', { href: n.href, class: n.k === active ? 'active' : '' }, n.label); })) : null;

    mount(h('div', { class: 'app' + (opts.focus ? ' focus' : '') + (opts.bare ? ' bare' : '') },
      h('a', { class: 'skip', href: '#main', onclick: function (e) { e.preventDefault(); const mn = document.getElementById('main'); if (mn) { mn.setAttribute('tabindex', '-1'); mn.focus(); } } }, 'Skip to content'),
      sidebar, h('div', { class: 'main-col' }, mtop, h('main', { id: 'main', class: 'content' }, adminSwitch, content)), bottom));
    document.body.classList.toggle('focus-view', !!opts.focus);
    return { title: titleEl };
  }
  function setUnread(tasks) {
    S.unread = tasks.filter(function (t) { return t.unread; }).length;
    document.title = (S.unread ? '(' + S.unread + ') ' : '') + (S.company || 'Task Manager');
    document.querySelectorAll('[data-nav="tasks"]').forEach(function (a) {
      const host = a.querySelector('.pill') || a, b = host.querySelector('.nav-badge');
      if (b) b.remove();
      const nb = unreadBadge(); if (nb) host.appendChild(nb);
    });
  }

  /* ============================== login / password ============================== */

  // art: an illustration for the top of the page (the sign-in page); other pages get a plain logo
  function authPage(heading, sub, body, art) {
    mount(h('div', { class: 'auth' },
      h('div', { class: 'auth-hero' }, art ? UI.illustration('hero') : h('div', { class: 'logo', style: 'width:60px;height:60px;border-radius:18px;margin:0 auto .8rem' }, UI.logoMark(40)), heading, h('p', null, sub)),
      h('div', { class: 'auth-card' }, body)));
  }

  function showLogin(message) {
    stopTimers(); runLeave(); S.user = null; S.taskMem = {}; Profiles.reset(); Assistant.reset();
    // Paint the sign-in page at once with the last known company name; the server (which may need a few seconds to
    // wake up) is asked in the background. Asking first made people stare at "Loading…".
    const company = S.company || Api.savedCompany();
    const title = h('h1', null, company || 'Task Manager');
    if (!S.company) Api.call('info').then(function (r) { if (r && r.companyName) { S.company = r.companyName; Api.saveCompany(r.companyName); title.textContent = r.companyName; } }).catch(function () { /* ignore */ });
    const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pw = UI.passwordField({ autocomplete: 'current-password', required: true }), pass = pw.input;
    const err = h('div');
    const btn = h('button', { class: 'btn primary block', type: 'submit', style: 'margin-top:1.2rem' }, 'Sign in');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err); btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await Api.call('login', { username: user.value, password: pass.value });
        Api.setToken(r.token); S.user = r.user; S.company = r.companyName; S.canAssign = !!r.canAssign; S.canUseAi = !!r.canUseAi;
        if (r.user.mustChange) return viewMustChange();
        if (r.canAssign === undefined) await loadMe(); else rememberMe();   // the sign-in answer already holds the profile
        Profiles.load(); Profiles.refresh(true);
        go(landing());
      } catch (e) { err.appendChild(errBox(e)); pass.value = ''; }
      finally { btn.disabled = false; btn.textContent = 'Sign in'; }
    } }, h('label', null, 'Username', user), h('label', null, 'Password', pw.el), btn, err);
    const demo = Api.demo ? h('div', { class: 'note', style: 'margin-top:1rem' }, h('strong', null, 'Demo mode'), ' - fake data in this browser only. Password for every account: ', h('code', null, Demo.password),
      h('div', { style: 'margin-top:.5rem' }, Demo.accounts.map(function (a) { return h('button', { type: 'button', class: 'chip-btn', title: a[1], onclick: function () { user.value = a[0]; pass.value = Demo.password; } }, a[0]); })),
      h('button', { class: 'btn small', type: 'button', style: 'margin-top:.5rem', onclick: function () { Demo.reset(); } }, 'Reset demo data')) : null;
    authPage(title, 'Tasks, progress and conversations in one place.', [
      message ? h('div', { class: 'note', style: 'margin-top:0;margin-bottom:.8rem' }, message) : null,
      h('div', { class: 'card' }, h('h2', null, 'Welcome back'), h('p', { class: 'muted small' }, 'Use the username and password your administrator gave you.'), form),
      demo, h('p', { class: 'auth-foot' }, 'Forgot your password? Ask your administrator to reset it.')], true);
    user.focus();
  }

  function viewMustChange() {
    stopTimers();
    const o = UI.passwordField({ autocomplete: 'current-password', required: true }), n = UI.passwordField({ autocomplete: 'new-password', required: true, minlength: 8 }), r = UI.passwordField({ autocomplete: 'new-password', required: true });
    const err = h('div');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err);
      if (n.input.value !== r.input.value) return err.appendChild(errBox(new Error('The two new passwords do not match.')));
      try {
        await Api.call('changePassword', { oldPassword: o.input.value, newPassword: n.input.value });
        S.user.mustChange = false; UI.toast('Password changed'); await loadMe(); Profiles.load(); Profiles.refresh(true); go(landing());
      } catch (e) { err.appendChild(errBox(e)); }
    } }, h('label', null, 'Temporary password you were given', o.el), h('label', null, 'New password (at least 8 characters)', n.el), h('label', null, 'Repeat new password', r.el),
      h('button', { class: 'btn primary block', type: 'submit', style: 'margin-top:1.2rem' }, 'Save new password'), err);
    authPage(h('h1', null, 'Choose a new password'), 'For your security, replace the temporary password before continuing.', [
      h('div', { class: 'card' }, form), h('p', { style: 'text-align:center;margin-top:.8rem' }, h('button', { class: 'btn ghost small', type: 'button', onclick: signOut }, 'Sign out'))]);
  }

  async function signOut() {
    try { await Api.call('logout'); } catch (e) { /* ignore */ }
    Api.setToken(''); S.user = null; stopTimers(); showLogin('You have been signed out.');
  }

  async function loadMe() {
    const me = await Api.call('me');
    S.user = me.user; S.company = me.companyName; S.canAssign = me.canAssign; S.canUseAi = !!me.canUseAi;
    rememberMe();
  }
  function rememberMe() {
    Api.cacheSet('me', { user: S.user, company: S.company, canAssign: S.canAssign, canUseAi: S.canUseAi });
    Api.saveCompany(S.company);
  }

  /* ============================== tasks: home ============================== */

  function taskFlags(t) {
    const due = UI.dueInfo(t.dueDate, t.status);
    return { overdue: !!(due && due.cls === 'bad'), approve: t.role === 'creator' && t.status === 'pending', unread: !!t.unread, due: due };
  }

  // A task card is a picture first: a progress doughnut, the title, who -> whom as faces with an arrow, and one small time badge.
  // Colour tells the state (red late, amber waiting for approval, blue going, grey not started); the thin bar at the bottom is how much
  // of the time has been used (compare it with the doughnut: bar ahead of doughnut = falling behind). No sentences, no dates in words.
  const first = function (n) { return String(n || '').split(' ')[0]; };
  function dueBadge(t, f) {
    if (t.status === 'pending') return t.role === 'creator' ? { cls: 'warn', ic: 'clock', text: 'Review', tip: 'Waiting for your approval' } : { cls: 'warn', ic: 'clock', text: 'Sent', tip: 'Sent for approval' };
    const d = f.due; if (!d) return null;
    const n = d.days;
    if (n < 0) return { cls: 'bad late', ic: 'alert', text: (-n) + 'd late', tip: d.text };
    if (n === 0) return { cls: 'warn', ic: 'calendar', text: 'Today', tip: d.text };
    if (n === 1) return { cls: 'warn', ic: 'calendar', text: 'Tomorrow', tip: d.text };
    if (n <= 6) return { cls: 'soon', ic: 'calendar', text: n + ' days', tip: d.text };
    return { cls: '', ic: 'calendar', text: new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tip: d.text };
  }
  function timeUsed(t) {   // 0..1 of the time between creation and the due date that has gone by (null without a due date)
    if (!t.dueDate || t.status === 'pending') return null;
    const end = new Date(t.dueDate + 'T23:59:59').getTime(), start = t.createdAt || 0;
    if (!start || end <= start) return null;
    return Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
  }
  function taskCard(t, i) {
    const f = taskFlags(t), b = bucket(t);
    const state = { late: 'bad', wait: 'warn', active: 'info', 'new': '' }[b];
    const mine = t.role === 'creator';
    const me = S.user || { name: 'You', id: '' };
    const who = function (p, label) { return h('span', { class: 'who' }, UI.avatar(p.name, 'xs', p.id), h('span', null, label)); };
    const toLabel = mine ? first(t.assignees[0].name) + (t.assignees.length > 1 ? ' +' + (t.assignees.length - 1) : '') : 'You';
    const flow = h('div', { class: 'flow', 'aria-label': mine ? 'From you to ' + names(t.assignees).join(', ') : 'From ' + t.creator.name + ' to you' },
      mine ? who(me, 'You') : who(t.creator, first(t.creator.name)),
      h('span', { class: 'arrow', 'aria-hidden': 'true' }, icon('arrowRight', 14)),
      mine ? (t.assignees.length > 1 ? h('span', { class: 'who' }, UI.avatarStack(t.assignees, 3), h('span', null, toLabel)) : who(t.assignees[0], toLabel)) : who(me, 'You'));
    const due = dueBadge(t, f), used = timeUsed(t);
    return h('a', { class: 'card task' + (state ? ' st-' + state : '') + (b === 'late' ? ' is-late' : '') + (S.spot === t.id ? ' ai-spot' : ''), href: '#/task/' + t.id, 'data-id': t.id, style: '--i:' + Math.min(i || 0, 10) },
      h('div', { class: 't-row' },
        h('div', { class: 't-dn' }, UI.ring(t.progress, '', 58)),
        h('div', { class: 't-main' },
          h('div', { class: 'top' }, h('div', { class: 'title' }, t.title), t.unread ? h('span', { class: 'newdot', title: 'New activity', 'aria-label': 'New activity' }) : null),
          h('div', { class: 'sub-row' }, flow, due ? h('span', { class: 'dbadge ' + due.cls, title: due.tip }, icon(due.ic, 13), due.text) : null))),
      used === null ? null : h('div', { class: 'timebar', title: 'Time used', 'aria-hidden': 'true' }, h('i', { style: '--u:' + Math.round(used * 100) + '%' })));
  }

  /* ---------- "Today at a glance": a picture, not a paragraph (built from the task list itself, no AI call) ----------
     Four icon tiles for what needs you (late, due today, waiting for your approval, new activity) and a week strip: one column per
     day (late ones first), one dot per task coloured by state. Tap a tile or a column to see just those tasks, tap a dot to open it.
     People with AI access also get a speaker button that reads the AI overview aloud (nothing to read on screen). */
  function glanceCard(brief) {
    const box = h('section', { class: 'card glance', 'aria-label': 'Today at a glance' });
    let reading = false, loadingVoice = false, last = [];
    const stateCls = { late: 'late', wait: 'wait', active: 'active', 'new': 'new' };
    function show(ids, filter) { App.showPage({ page: 'tasks', filter: filter || 'all', taskIds: ids || [] }); }
    function voiceBtn() {
      if (!brief || !Speech.supported) return null;
      return h('button', { class: 'icon-btn', type: 'button', disabled: loadingVoice, title: reading ? 'Stop' : 'Listen to the overview', 'aria-label': reading ? 'Stop' : 'Listen to the overview', onclick: function () {
        if (reading) { Speech.stop(); reading = false; return update(last); }
        reading = true; loadingVoice = true; update(last);
        brief.speak(function () { reading = false; update(last); }).then(function () { loadingVoice = false; update(last); });
      } }, loadingVoice ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : icon(reading ? 'stop' : 'volume', 18));
    }
    function update(tasks) {
      last = tasks;
      UI.clear(box);
      const today = [], late = [], approve = [], fresh = [], cols = [[], [], [], [], [], [], []], lateCol = [];
      tasks.forEach(function (t) {
        const due = UI.dueInfo(t.dueDate, t.status), b = bucket(t);
        if (b === 'late') late.push(t);
        if (t.role === 'creator' && t.status === 'pending') approve.push(t);
        if (t.unread) fresh.push(t);
        if (due && t.status !== 'pending' && due.days === 0) today.push(t);
        if (due) { if (due.days < 0) lateCol.push(t); else if (due.days <= 6) cols[due.days].push(t); }
      });
      const ids = function (a) { return a.map(function (t) { return t.id; }); };
      box.appendChild(h('div', { class: 'glance-head' }, h('span', { class: 'sum-ico' }, icon('sparkles', 16)), h('span', { class: 'grow' }, 'Today'), voiceBtn()));
      const tiles = [['late', 'alert', 'Late', late, function () { show([], 'late'); }], ['today', 'zap', 'Today', today, function () { show(ids(today)); }],
        ['approve', 'checkCircle', 'Approve', approve, function () { show(ids(approve)); }], ['fresh', 'inbox', 'New', fresh, function () { show(ids(fresh)); }]];
      const total = tiles.reduce(function (n, x) { return n + x[3].length; }, 0);
      if (!tasks.length) { box.appendChild(h('div', { class: 'glance-clear' }, h('span', { class: 'okring' }, icon('check', 30)), h('b', null, 'No tasks yet'))); return; }
      if (!total) box.appendChild(h('div', { class: 'glance-clear' }, h('span', { class: 'okring' }, icon('check', 30)), h('b', null, 'All clear')));
      else box.appendChild(h('div', { class: 'glance-tiles' }, tiles.map(function (x, n) {
        const k = x[3].length;
        return h('button', { type: 'button', class: 'gtile ' + x[0] + (k ? ' has' : ''), disabled: !k, style: '--i:' + n, 'aria-label': k + ' ' + x[2], onclick: x[4] }, h('span', { class: 'gi' }, icon(x[1], 20)), h('b', null, k), h('em', null, x[2]));
      })));
      // the week strip
      const dayOf = function (n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
      const strip = h('div', { class: 'wstrip', role: 'group', 'aria-label': 'Next seven days' });
      const column = function (label, sub, list, extra, n) {
        const dots = list.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 4).map(function (t, k) {
          return h('span', { class: 'gdot ' + stateCls[bucket(t)], 'aria-hidden': 'true', style: '--d:' + (n * 60 + k * 90) + 'ms' });   // only a picture: the whole column opens the list
        });
        return h('button', { type: 'button', class: 'wcol' + (extra || '') + (list.length ? ' has' : ''), disabled: !list.length, 'aria-label': (list.length || 'No') + ' task' + (list.length === 1 ? '' : 's') + ' ' + (label === 'Late' ? 'late' : label === 'Today' ? 'today' : 'on ' + sub), onclick: function () { show(ids(list)); } },
          h('span', { class: 'whead' }, h('small', null, label), h('b', null, sub)),
          h('div', { class: 'wdots' }, dots, list.length > 4 ? h('span', { class: 'wmore' }, '+' + (list.length - 4)) : null));
      };
      if (lateCol.length) strip.appendChild(column('Late', '!', lateCol, ' wlate', 0));
      cols.forEach(function (list, n) {
        const d = dayOf(n);
        strip.appendChild(column(n === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'narrow' }), String(d.getDate()), list, n === 0 ? ' wtoday' : '', n + 1));
      });
      box.appendChild(strip);
    }
    update([]);
    return { el: box, update: update };
  }

  function viewTasks() {
    const glance = glanceCard(S.canUseAi ? Assistant.briefingCard(App) : null);   // the picture card is for everyone; the spoken AI overview and the bubble are for Senior General Managers and above
    const statBox = h('div'), list = h('div', null, UI.skeleton('card', 3)), filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Show tasks' }), activeBox = h('div');
    const q = h('input', { type: 'search', placeholder: 'Search tasks or people…', 'aria-label': 'Search tasks or people', value: S.q });
    const sort = h('select', { 'aria-label': 'Sort tasks' }, h('option', { value: 'recent', selected: S.sort === 'recent' }, 'Latest first'), h('option', { value: 'due', selected: S.sort === 'due' }, 'Due date'));
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const subLine = h('p', { class: 'sub' }, ' ');
    shell(h('div', null,
      h('div', { class: 'hero2' },
        h('div', { class: 'hero2-top' }, h('span', { class: 'logo' }, UI.logoMark(24)), h('span', { class: 'nm' }, S.company || 'Task Manager'), h('a', { href: '#/account', 'aria-label': 'My profile' }, UI.avatar(S.user.name, 'sm', S.user.id))),
        h('div', { class: 'date' }, date), h('h1', null, UI.greeting() + (firstName() ? ', ' + firstName() : '')), subLine, statBox),
      h('div', { class: 'home-grid' },
        h('div', { class: 'home-side' }, glance.el),
        h('div', { class: 'home-main' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 18), q), sort), filters, activeBox, list)),
      S.canAssign ? h('a', { class: 'btn primary fab', href: '#/new', 'aria-label': 'New task' }, icon('plus', 22), 'New task') : null), 'tasks', { bare: true });
    let tasks = [], statSig = '', animated = false;
    const cacheKey = 'tasks:' + S.user.id;
    q.addEventListener('input', function () { S.q = q.value; drawList(); });
    sort.addEventListener('change', function () { S.sort = sort.value; drawList(); });

    function setFilter(key) { S.filter = S.filter === key ? 'all' : key; redraw(); }
    function matches(t) {
      const f = S.filter;
      if (S.only.length && S.only.indexOf(t.id) < 0) return false;                  // the assistant picked these tasks
      if (f === 'mine' && t.role !== 'assignee') return false;
      if (f === 'byme' && t.role !== 'creator') return false;
      if (['late', 'wait', 'active', 'new'].indexOf(f) >= 0 && bucket(t) !== f) return false;
      const needle = S.q.trim().toLowerCase();
      if (!needle) return true;
      return [t.title, t.creator.name].concat(names(t.assignees), t.lastMessage ? [t.lastMessage.text] : []).join(' ').toLowerCase().indexOf(needle) >= 0;
    }
    function ordered(items) {
      const copy = items.slice();
      if (S.sort === 'due') copy.sort(function (a, b) { const x = a.dueDate || '9999', y = b.dueDate || '9999'; return x < y ? -1 : x > y ? 1 : b.updatedAt - a.updatedAt; });
      else copy.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return copy;
    }

    S.peek = function () { return { filter: S.filter, q: S.q, shown: tasks.filter(matches).map(function (t) { return t.id; }) }; };   // what the AI bubble is told about this screen

    /* ---- one stacked bar and four big numbers: the whole picture, and each number is a filter ---- */
    function drawStats() {
      const counts = { late: 0, wait: 0, active: 0, 'new': 0 };
      tasks.forEach(function (t) { counts[bucket(t)]++; });
      const sig = [counts.late, counts.wait, counts.active, counts['new'], S.filter].join(',');
      if (sig === statSig) return;
      statSig = sig; const anim = !animated; animated = true;
      UI.clear(statBox);
      const attention = counts.late + counts.wait + tasks.filter(function (t) { return t.unread; }).length;
      subLine.textContent = !tasks.length ? 'Nothing open right now. Enjoy the calm!' : attention ? attention + ' thing' + (attention === 1 ? '' : 's') + ' need' + (attention === 1 ? 's' : '') + ' your attention' : 'Everything is on track';
      if (!tasks.length) return;
      const bar = h('div', { class: 'statbar', role: 'img', 'aria-label': BUCKETS.map(function (b) { return counts[b[0]] + ' ' + b[1]; }).join(', ') });
      BUCKETS.forEach(function (b) {
        const seg = h('i', { style: '--c:' + b[2] }), pct = counts[b[0]] / tasks.length * 100 + '%';
        if (anim && !prefersReduced()) requestAnimationFrame(function () { requestAnimationFrame(function () { seg.style.width = pct; }); }); else seg.style.width = pct;
        bar.appendChild(seg);
      });
      statBox.appendChild(bar);
      statBox.appendChild(h('div', { class: 'stats', role: 'group', 'aria-label': 'Filter by state' }, BUCKETS.map(function (b) {
        const num = h('div', { class: 'n' }); UI.countUp(num, counts[b[0]], anim);
        return h('button', { type: 'button', class: 'stat' + (S.filter === b[0] ? ' on' : ''), 'aria-pressed': S.filter === b[0], style: '--c:' + b[2], onclick: function () { setFilter(b[0]); } }, h('i', { class: 'dot' }), num, h('div', { class: 'l' }, b[1]));
      })));
    }

    function drawList() {
      const counts = { all: tasks.length, mine: 0, byme: 0 };
      tasks.forEach(function (t) { if (t.role === 'assignee') counts.mine++; else counts.byme++; });
      UI.clear(filters);
      if (counts.mine && counts.byme) {
        [['all', 'All'], ['mine', 'Assigned to me'], ['byme', 'Assigned by me']].forEach(function (f) {
          filters.appendChild(h('button', { type: 'button', class: S.filter === f[0] ? 'on' : '', 'aria-pressed': S.filter === f[0], onclick: function () { S.filter = f[0]; redraw(); } }, f[1], h('span', { class: 'n' }, counts[f[0]])));
        });
      }
      UI.clear(activeBox);
      const picked = BUCKETS.filter(function (x) { return x[0] === S.filter; })[0];
      const label = S.only.length ? S.only.length + (S.only.length === 1 ? ' task' : ' tasks') + ' selected' : picked ? picked[1] : S.filter === 'mine' ? 'Assigned to me' : S.filter === 'byme' ? 'Assigned by me' : '';
      if (label) activeBox.appendChild(h('div', { class: 'active-filter' }, UI.chip('Showing: ' + label, 'brand', 'search'), h('button', { class: 'btn ghost small', type: 'button', onclick: function () { S.filter = 'all'; S.only = []; redraw(); } }, 'Show all')));
      const shown = tasks.filter(matches);
      UI.clear(list);
      if (!shown.length) {
        list.appendChild(tasks.length
          ? UI.emptyState('search', 'Nothing matches', 'Try a different filter or search.', h('button', { class: 'btn small', type: 'button', onclick: function () { S.q = ''; q.value = ''; S.filter = 'all'; S.only = []; redraw(); } }, 'Clear filters'))
          : UI.emptyState('inbox', 'No open tasks', S.canAssign ? 'Create a task and drag the right people onto it. Or just tell the assistant what to do.' : 'New tasks assigned to you will appear here.', S.canAssign ? h('a', { class: 'btn primary', href: '#/new' }, icon('plus', 18), 'New task') : null));
        return;
      }
      // grouped by state, most urgent first (a single state when one is picked)
      let n = 0;
      BUCKETS.forEach(function (b) {
        const items = ordered(shown.filter(function (t) { return bucket(t) === b[0]; }));
        if (!items.length) return;
        list.appendChild(h('div', { class: 'group-title', style: '--c:' + b[2] }, h('i'), b[1], h('span', { class: 'cnt' }, items.length)));
        items.forEach(function (t) { list.appendChild(taskCard(t, n++)); });
      });
    }
    function redraw() { drawStats(); drawList(); glance.update(tasks); settle(); }
    const listSig = function (list) { return JSON.stringify(list) + '|' + new Date().toDateString(); };   // (the date: "3d late" changes at midnight)
    let lastSig = '';

    let loaded = false;
    async function load() {
      try {
        const fresh = (await Api.call('listTasks')).tasks; setUnread(fresh); loaded = true;
        const sg = listSig(fresh);
        if (sg === lastSig) return;                                 // nothing changed: leave the screen exactly as it is
        lastSig = sg; tasks = fresh; redraw();
        Api.cacheSet(cacheKey, { tasks: tasks });
        // Warm the "people I can assign to" list so the New task screen opens at once.
        if (S.canAssign && !Api.cacheGet('assignable')) Api.call('assignable').then(function (p) { Api.cacheSet('assignable', p); }).catch(function () { /* ignore */ });
      }
      catch (e) { if (e.code === 'MUSTCHANGE') return viewMustChange(); if (e.code !== 'AUTH' && !tasks.length) { UI.clear(list); list.appendChild(errBox(e)); } throw e; }
    }
    // Show the last known list immediately (it is refreshed within a moment), instead of an empty "Loading…" screen.
    const known = Api.cacheGet(cacheKey);
    if (known && Array.isArray(known.tasks)) { tasks = known.tasks; lastSig = listSig(tasks); setUnread(tasks); redraw(); }
    // The list comes first; the overview (an AI call) is only asked for after it, and only when the saved one is old or missing.
    load().catch(function () { /* the error is already shown */ });
    poll(load, 40000);
  }

  /* ============================== new task: type a title, drag people onto it ============================== */

  async function viewNewTask(preId) {
    const bar = { focus: true, back: '#/tasks', title: 'New task' };
    let people = Api.cacheGet('assignable');
    if (people && people.length) {   // an empty list is not trusted: the admin may have added arrows since
      // Open at once with the last known list; refresh it quietly for next time (the server re-checks every assignment anyway).
      Api.call('assignable').then(function (p) { Api.cacheSet('assignable', p); }).catch(function () { /* ignore */ });
    } else {
      shell(UI.skeleton('card', 2), 'tasks', bar);
      try { people = await Api.call('assignable'); Api.cacheSet('assignable', people); } catch (e) { return shell(errBox(e), 'tasks', bar); }
    }
    if (!people.length) return shell(UI.emptyState('team', 'No one to assign to yet', 'Ask your administrator to connect you to the people you manage in the Org chart.', h('a', { class: 'btn', href: '#/tasks' }, 'Back to tasks')), 'tasks', bar);

    const chosen = {}, bubbles = {};
    const title = h('input', { class: 'draft-title', type: 'text', maxlength: 120, placeholder: 'What needs to be done?', 'aria-label': 'Task title', autocomplete: 'off' });
    const zone = h('div', { class: 'dropzone', role: 'group', 'aria-label': 'People this task is assigned to', 'aria-live': 'polite' });
    const desc = h('textarea', { maxlength: 2000, placeholder: 'Details, what "done" looks like, anything they should know…', 'aria-label': 'Description' });
    const dock = h('section', { class: 'dock', 'aria-label': 'People you can assign tasks to' });
    const createLabel = h('span', null, 'Create task');
    const createBtn = h('button', { class: 'btn primary', type: 'button' }, icon('send', 18), createLabel);
    let dueVal = '';
    const more = h('details', { class: 'more' }, h('summary', null, icon('plus', 15), 'Add details'), desc);

    // ---- due date ----
    const dueInput = h('input', { type: 'date', 'aria-label': 'Pick a due date' });
    const quickDefs = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]];
    const dueRow = h('div', { class: 'due-row' });
    function drawDue() {
      UI.clear(dueRow);
      quickDefs.forEach(function (d) {
        const k = UI.ymd(d[1]);
        dueRow.appendChild(h('button', { type: 'button', class: dueVal === k ? 'on' : '', 'aria-pressed': dueVal === k, onclick: function () { dueVal = dueVal === k ? '' : k; dueInput.value = dueVal; drawDue(); } }, d[0]));
      });
      dueRow.appendChild(dueInput);
    }
    dueInput.addEventListener('change', function () { dueVal = dueInput.value; drawDue(); });

    // ---- the drop zone on the task card ----
    function ghostFor(p) { return h('div', { class: 'bubble' }, UI.avatar(p.name, 'lg', p.id)); }
    function renderZone() {
      UI.clear(zone);
      const ids = Object.keys(chosen);
      zone.classList.toggle('filled', ids.length > 0);
      if (!ids.length) zone.appendChild(h('div', { class: 'dz-hint' }, icon('move', 26), h('span', null, 'Drag people here'), h('span', { class: 'small' }, 'or just tap them below')));
      ids.forEach(function (id) {
        const p = chosen[id];
        const chip = h('span', { class: 'pchip' }, UI.avatar(p.name, 'sm', p.id), h('span', null, p.name), h('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + p.name, onclick: function () { toggle(p, false); } }, icon('x', 13)));
        UI.draggable(chip, { zones: function () { return [dock]; }, ghost: function () { return ghostFor(p); }, onDrop: function () { toggle(p, false); } });   // drag a face back down to remove it
        zone.appendChild(chip);
      });
      createLabel.textContent = ids.length ? 'Assign to ' + ids.length + (ids.length === 1 ? ' person' : ' people') : 'Create task';
    }
    function toggle(p, on) {
      if (on === undefined) on = !chosen[p.id];
      if (on) chosen[p.id] = p; else delete chosen[p.id];
      renderZone();
      const b = bubbles[p.id]; if (b) { b.classList.toggle('sel', !!chosen[p.id]); b.setAttribute('aria-pressed', !!chosen[p.id]); }
    }

    // ---- the dock: everyone you can assign to, grouped by layer ----
    const find = h('input', { type: 'search', placeholder: 'Search people…', 'aria-label': 'Search people' });
    const body = h('div', { class: 'dock-body' }), groups = [];
    const byLevel = {}; people.forEach(function (p) { (byLevel[p.level] = byLevel[p.level] || []).push(p); });
    Object.keys(byLevel).sort(function (a, b) { return a - b; }).forEach(function (lv) {
      const items = byLevel[lv], row = h('div', { class: 'bubbles' }), g = { nodes: [], head: null, el: null };
      const all = function () { const every = items.every(function (p) { return chosen[p.id]; }); items.forEach(function (p) { toggle(p, !every); }); };
      g.head = h('div', { class: 'dock-label' }, h('span', null, 'Layer ' + lv + ' · ' + items[0].jobTitle), items.length > 1 ? h('button', { type: 'button', onclick: all }, 'Select all') : null);
      items.forEach(function (p) {
        const b = h('button', { type: 'button', class: 'bubble', 'aria-pressed': 'false', 'aria-label': p.name + ', ' + p.jobTitle, onclick: function () { toggle(p); } },
          UI.avatar(p.name, '', p.id), h('span', { class: 'bn' }, p.name.split(/\s+/)[0]), h('span', { class: 'bt' }, p.jobTitle), h('span', { class: 'tick' }, icon('check', 13)));
        UI.draggable(b, { zones: function () { return [zone]; }, ghost: function () { return ghostFor(p); }, onDrop: function () { toggle(p, true); } });
        bubbles[p.id] = b; g.nodes.push({ p: p, el: b }); row.appendChild(b);
      });
      g.el = h('div', { class: 'dock-group' }, g.head, row);
      groups.push(g); body.appendChild(g.el);
    });
    find.addEventListener('input', function () {
      const needle = find.value.trim().toLowerCase();
      groups.forEach(function (g) {
        let any = false;
        g.nodes.forEach(function (n) { const show = !needle || (n.p.name + ' ' + n.p.jobTitle).toLowerCase().indexOf(needle) >= 0; n.el.classList.toggle('hidden', !show); if (show) any = true; });
        g.el.classList.toggle('hidden', !any);
      });
    });
    dock.appendChild(h('div', { class: 'dock-head' }, h('h2', null, icon('move', 18), 'People'), people.length > 8 ? h('div', { class: 'search' }, icon('search', 16), find) : null, createBtn));
    dock.appendChild(body);

    // ---- create ----
    const shake = function (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
    createBtn.addEventListener('click', async function () {
      if (!title.value.trim()) { shake(title); title.focus(); return UI.toast('Give the task a title first.', 'bad'); }
      const ids = Object.keys(chosen);
      if (!ids.length) { shake(zone); return UI.toast('Drag at least one person onto the task.', 'bad'); }
      createBtn.disabled = true;
      try {
        const r = await Api.call('createTask', { title: title.value, description: desc.value, dueDate: dueVal, assigneeIds: ids });
        UI.confetti(); UI.toast('Task assigned'); go('#/task/' + r.task.id);
      } catch (e) { UI.toast(e.message, 'bad'); createBtn.disabled = false; }
    });

    const draft = h('div', { class: 'card draft' }, h('div', { class: 'detail-banner' }), h('div', { class: 'draft-in' },
      title,
      h('div', { class: 'draft-label' }, icon('users', 14), 'Assigned to'), zone,
      h('div', { class: 'draft-label' }, icon('calendar', 14), 'Due'), dueRow,
      more));
    shell(h('div', { class: 'builder' }, h('a', { class: 'back-link desk', href: '#/tasks' }, icon('back', 18), 'All tasks'), draft, dock), 'tasks', bar);
    renderZone(); drawDue();
    if (preId && people.some(function (p) { return p.id === preId; })) toggle(people.filter(function (p) { return p.id === preId; })[0], true);

    // The AI bubble sees this form (S.peek) and can fill it in for the person (S.fill); the person still presses the button.
    S.peek = function () { return { draft: { title: title.value, description: desc.value, due: dueVal, assigneeIds: Object.keys(chosen) } }; };
    const glow = function (el) { el.classList.remove('ai-fill'); void el.offsetWidth; el.classList.add('ai-fill'); };
    S.fill = function (a) {
      if (a.title) { title.value = a.title; glow(title); }
      if (a.description !== undefined) { desc.value = a.description; if (a.description) { more.open = true; glow(desc); } }
      if (a.dueDate !== undefined) { dueVal = a.dueDate; dueInput.value = dueVal; drawDue(); glow(dueRow); }
      if (Array.isArray(a.assigneeIds)) { people.forEach(function (p) { toggle(p, a.assigneeIds.indexOf(p.id) >= 0); }); glow(zone); }
    };
    if (S.pendingFill) { const f = S.pendingFill; S.pendingFill = null; S.fill(f); }
    if (!title.value) title.focus();
  }

  /* ============================== conversation pieces ============================== */

  function healthChip(hl) {
    const m = { on_track: ['On track', 'ok'], at_risk: ['At risk', 'warn'], blocked: ['Blocked', 'bad'], done: ['Looks complete', 'ok'], unknown: ['Status unclear', ''] }[hl] || ['', ''];
    return m[0] ? UI.chip(m[0], m[1]) : null;
  }

  // extra: node shown at the bottom of the card (the refresh button)
  function summaryNode(summary, extra) {
    const s = summary;
    const list = function (title, items) { return items && items.length ? [h('strong', { class: 'small' }, title), h('ul', null, items.map(function (i) { return h('li', null, i); }))] : null; };
    return h('div', { class: 'card sumcard' },
      h('div', { class: 'sum-head' }, h('span', { class: 'sum-ico' }, icon('sparkles', 18)), h('span', { class: 'grow' }, 'AI summary'), s ? healthChip(s.health) : null),
      h('div', { class: 'body' },
        s ? h('div', null, h('p', null, s.summary_en), s.progress_note ? h('p', { class: 'small' }, h('strong', null, 'So far: '), s.progress_note) : null, list('Blockers', s.blockers), list('Next steps', s.next_steps))
          : h('p', { class: 'muted' }, 'No summary yet. It appears once people post updates, or tap “Create summary”.')),
      extra);
  }

  function setPlayIcon(btn, state) { UI.setIcon(btn, state === 'pause' ? 'pause' : 'play', 18, { fill: true }); }
  function stopAudio() {
    if (S.playing) { try { S.playing.audio.pause(); } catch (e) { /* ignore */ } S.playing = null; }
    document.querySelectorAll('.play').forEach(function (b) { setPlayIcon(b, 'play'); });
    document.querySelectorAll('.voice.playing').forEach(function (v) { v.classList.remove('playing'); });
  }
  async function togglePlay(btn, m, o) {
    const same = S.playing && S.playing.id === m.id;
    stopAudio();
    if (same) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      const url = await Audio2.urlFor((o.archived ? 'a' : 'l') + m.id, function () { return Api.call('getAudio', o.archived ? { archived: true, taskId: o.taskId, messageId: m.id } : { messageId: m.id }); });
      const a = new Audio(url);
      a.onended = function () { S.playing = null; stopAudio(); };
      await a.play();
      S.playing = { id: m.id, audio: a }; setPlayIcon(btn, 'pause');
      const v = btn.closest('.voice'); if (v) v.classList.add('playing');
    } catch (e) { setPlayIcon(btn, 'play'); UI.toast(e.message || 'Could not play this voice message.', 'bad'); }
    finally { btn.disabled = false; }
  }

  // a little decorative waveform, the same for the same message every time
  function waveform(seed) {
    let x = 0; const s = String(seed);
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
    const w = h('span', { class: 'wave', 'aria-hidden': 'true' });
    for (let i = 0; i < 26; i++) { x = (x * 1103515245 + 12345) >>> 0; const bar = h('i'); bar.style.setProperty('--hh', (25 + (x >>> 8) % 75) + '%'); bar.style.setProperty('--i', i); w.appendChild(bar); }
    return w;
  }

  const fileUrls = {};
  async function openFile(m, o, btn) {
    if (btn) btn.disabled = true;
    try {
      const key = (o.archived ? 'a' : 'l') + m.id;
      if (!fileUrls[key]) { const r = await Api.call('getFile', o.archived ? { archived: true, taskId: o.taskId, messageId: m.id } : { messageId: m.id }, { timeout: 120000 }); fileUrls[key] = { url: UI.b64Url(r.b64, r.mime), name: r.name }; }
      const f = fileUrls[key];
      if (m.file.isImage) UI.lightbox(f.url, f.name); else { UI.saveUrl(f.url, f.name); UI.toast('Downloaded ' + f.name); }
    } catch (e) { if (e.code !== 'AUTH') UI.toast(e.message || 'Could not open this file.', 'bad'); }
    finally { if (btn) btn.disabled = false; }
  }
  function fileBubble(m, o) {
    const f = m.file;
    if (f.isImage && f.thumb) return h('button', { type: 'button', class: 'img-btn', 'aria-label': 'Open picture ' + f.name, onclick: function (e) { openFile(m, o, e.currentTarget); } }, h('img', { src: f.thumb, alt: f.name }));
    return h('button', { type: 'button', class: 'file-card', title: f.isImage ? 'View' : 'Download', onclick: function (e) { openFile(m, o, e.currentTarget); } },
      UI.fileIcon(f.name), h('span', { class: 'file-meta' }, h('b', null, f.name), h('span', null, UI.fmtSize(f.size) + ' · tap to ' + (f.isImage ? 'view' : 'download'))));
  }

  function messageNode(m, o) {
    if (m.type === 'system') return h('div', { class: 'msg-sys' }, m.text);
    const mine = m.senderId === S.user.id;
    let body;
    if (m.type === 'voice') {
      const play = m.hasAudio ? h('button', { class: 'play', type: 'button', 'data-id': m.id, 'aria-label': 'Play voice message', onclick: function (e) { togglePlay(e.currentTarget, m, o); } }) : null;
      if (play) setPlayIcon(play, S.playing && S.playing.id === m.id ? 'pause' : 'play');
      body = h('div', { class: 'voice' + (S.playing && S.playing.id === m.id ? ' playing' : '') }, play, waveform(m.id), h('span', { class: 'dur' }, UI.duration(m.audioSecs)));   // audio only; the AI keeps what was said in its own memory of the task
    } else if (m.type === 'file' && m.file) body = h('div', null, fileBubble(m, o), m.text ? h('div', { class: 'txt' }, m.text) : null);
    else body = h('div', { class: 'txt' }, m.text);
    const bubble = h('div', { class: 'msg' + (mine ? ' me' : '') }, mine || o.cont ? null : h('div', { class: 'who' }, m.senderName, m.senderTitle ? h('span', null, ' · ' + m.senderTitle) : null), body, h('div', { class: 'time' }, UI.time(m.createdAt)));
    let lead = null;
    if (!mine) {
      if (o.cont) lead = h('span', { class: 'avatar-spacer' });
      else { lead = UI.avatar(m.senderName, 'sm', m.senderId); lead.setAttribute('role', 'button'); lead.setAttribute('tabindex', '0'); lead.setAttribute('aria-label', 'About ' + m.senderName); lead.addEventListener('click', function () { showPerson({ id: m.senderId, name: m.senderName, jobTitle: m.senderTitle }); }); }
    }
    return h('div', { class: 'msg-row' + (mine ? ' me' : '') + (o.cont ? ' cont' : '') }, lead, bubble);
  }

  function renderChat(box, messages, o) {
    UI.clear(box);
    let day = '', prev = null;
    messages.forEach(function (m) {
      const d = UI.dayLabel(m.createdAt);
      if (d !== day) { day = d; prev = null; box.appendChild(h('div', { class: 'day' }, d)); }
      const cont = !!(prev && prev.type !== 'system' && m.type !== 'system' && prev.senderId === m.senderId && m.createdAt - prev.createdAt < 5 * 60000);
      box.appendChild(messageNode(m, Object.assign({ cont: cont }, o)));
      prev = m;
    });
    if (!messages.length) box.appendChild(h('div', { class: 'msg-sys' }, 'No messages yet. Post the first update below.'));
  }
  function nearBottom() { return window.innerHeight + window.scrollY >= document.body.scrollHeight - 180; }

  /* ============================== task detail ============================== */

  async function viewTask(id) {
    // Open instantly when possible: use what this session already loaded for the task, or else the row from the task
    // list (title, people, progress), and fetch the conversation in the background. Only a task we know nothing about
    // (e.g. a link opened directly) has to wait for the server.
    const listKey = 'tasks:' + S.user.id;
    let data = S.taskMem[id] || null, preview = null;
    if (!data) { const l = Api.cacheGet(listKey); preview = l && l.tasks ? l.tasks.filter(function (t) { return t.id === id; })[0] || null : null; }
    let freshData = false;
    const barOpts = { focus: true, back: '#/tasks', title: 'Task' };
    if (!data && !preview) {
      shell(UI.skeleton('card', 2), 'tasks', barOpts);
      try { data = await Api.call('getTask', { taskId: id }); freshData = true; }
      catch (e) { return shell(h('div', null, errBox(e), h('p', null, h('a', { href: '#/tasks' }, '← Back to tasks'))), 'tasks', barOpts); }
    }

    let task = data ? data.task : preview, messages = data ? data.messages : [], sig = '', dragging = false, summaryBusy = false, summaryError = '', autoTried = !S.canUseAi || !!(Api.demo && window.DemoBackend && window.DemoBackend.realAi), recording = null;   // the demo's AI is capped, so it only summarises when asked
    const pendingEls = [];   // messages being sent: shown at once, replaced by the real ones when the server answers
    const headBox = h('div'), sumBox = h('div'), filesBox = h('div'), chatBox = h('div', { class: 'chat', 'aria-live': 'polite' }), compBox = h('div', { class: 'composer' });
    const bar = shell(h('div', null, h('a', { class: 'back-link desk', href: '#/tasks' }, icon('back', 18), 'All tasks'), headBox, sumBox, filesBox, h('div', { class: 'sec-title' }, h('h2', null, 'Conversation')), chatBox, compBox), 'tasks', barOpts);
    S.peek = function () { const sl = document.querySelector('.slider-box input[type=range]'), ta = document.querySelector('.composer textarea'); return { slider: sl ? Number(sl.value) : undefined, draft: ta ? ta.value : '' }; };   // what the AI bubble is told about this screen
    const onChanged = function () { refresh(true).catch(function () {}); };   // the AI bubble just posted or changed something here
    window.addEventListener('taskapp:changed', onChanged); onLeave(function () { window.removeEventListener('taskapp:changed', onChanged); });
    const isAssignee = function () { return task.role === 'assignee'; };

    function drawHead() {
      bar.title.textContent = task.title;
      const due = UI.dueInfo(task.dueDate, task.status);
      const ring = UI.ring(task.progress, task.status === 'pending' ? 'pending' : '', 88);
      const ringBox = h('div', { class: 'head-side' }, ring, task.progressBy ? h('div', { class: 'muted small' }, 'Set by ' + task.progressBy) : null);
      const parts = [
        h('div', { class: 'head-top' }, h('div', { class: 'grow', style: 'min-width:0' }, h('h1', null, task.title), h('div', { class: 'row' }, statusChip(task), due ? UI.chip(due.text, due.cls, 'calendar') : null, UI.chip('Started ' + UI.date(task.createdAt)))), ringBox),
        h('div', { style: 'margin-top:.8rem' },
          h('div', { class: 'person-line' }, h('span', { class: 'k' }, 'From'), h('span', { class: 'names' }, personBtn(task.creator), task.creator.jobTitle ? h('span', { class: 'muted small' }, task.creator.jobTitle) : null)),
          h('div', { class: 'person-line' }, h('span', { class: 'k' }, 'To'), h('span', { class: 'names' }, task.assignees.map(function (a) { return personBtn(a); })))),
        task.description ? h('div', { class: 'desc' }, task.description) : null];

      parts.push(h('div', { class: 'head-actions' },
        task.role === 'creator' && task.status !== 'closed' ? h('button', { class: 'btn small', type: 'button', onclick: editTask }, icon('edit', 15), 'Edit task') : null));
      if (isAssignee() && task.status !== 'closed') {
        const label = h('strong', null, task.progress + '%');
        const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: task.progress, 'aria-label': 'How much of the task is done' });
        const show = function (v) { label.textContent = v + '%'; ring.setPct(v); };
        async function commit(v) {
          dragging = false;
          if (v === task.progress) return;
          if (v === 100 && !(await UI.confirm('Mark as 100% done?', 'Your manager will be asked to confirm that the work is complete.', 'Yes, it is done'))) { slider.value = task.progress; show(task.progress); return; }
          await guarded(async function () { task = (await Api.call('setProgress', { taskId: id, progress: v })).task; await refresh(true); if (v === 100) UI.confetti(); UI.toast(v === 100 ? 'Sent to your manager for approval' : 'Progress updated'); });
          drawHead();
        }
        slider.addEventListener('input', function () { dragging = true; show(slider.value); });
        slider.addEventListener('change', function () { commit(Number(slider.value)); });
        const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Quick progress' }, [0, 25, 50, 75, 100].map(function (v) {
          return h('button', { type: 'button', class: v === task.progress ? 'on' : '', onclick: function () { slider.value = v; show(v); commit(v); } }, v + '%');
        }));
        parts.push(h('div', { class: 'slider-box' }, h('div', { class: 'row between' }, h('strong', null, 'My progress'), label), presets, slider,
          h('div', { class: 'hint' }, 'Tap a value, or drag the slider and let go to save.'),
          task.status === 'pending' ? h('p', { class: 'note warn' }, 'Waiting for your manager to approve. If you still have work to do, move the slider back.') : null));
      }
      if (task.role === 'creator' && task.status === 'pending') {
        parts.push(h('div', { class: 'banner pending' }, h('strong', null, 'Marked 100% complete. '), 'Please check the work and the conversation, then approve or send it back.',
          h('div', { class: 'row', style: 'margin-top:.7rem' },
            h('button', { class: 'btn ok', type: 'button', onclick: approve }, icon('check', 18), 'Agree & close task'), h('button', { class: 'btn', type: 'button', onclick: sendBack }, 'Send back for more work'))));
      }
      UI.clear(headBox); headBox.appendChild(h('div', { class: 'card detail' }, h('div', { class: 'detail-banner' }), h('div', { class: 'detail-in' }, parts)));
    }

    function editTask() {
      const title = h('input', { type: 'text', maxlength: 120, value: task.title, 'aria-label': 'Task title' });
      const desc = h('textarea', { maxlength: 2000, 'aria-label': 'Details' }); desc.value = task.description || '';
      const due = h('input', { type: 'date', value: task.dueDate || '', 'aria-label': 'Due date' });
      UI.modal({ title: 'Edit task', body: h('div', null, h('label', null, 'Title', title), h('label', null, 'Details', desc), h('label', null, 'Due date', due), h('p', { class: 'hint' }, 'Everyone on the task is told what you changed. Clear the date to remove it.')),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async function () {
          try { await Api.call('updateTask', { taskId: id, title: title.value, description: desc.value, dueDate: due.value }); await refresh(true); UI.toast('Saved'); } catch (e) { UI.toast(e.message, 'bad'); return false; }
        } }] });
    }

    async function approve() {
      if (!(await UI.confirm('Close this task?', 'It will move to History with its full conversation. This cannot be undone.', 'Agree & close', 'ok'))) return;
      await guarded(async function () { await Api.call('approveTask', { taskId: id }, { timeout: 90000 }); UI.confetti(); UI.toast('Task closed and saved to History'); go('#/tasks'); });
    }
    function sendBack() {
      const note = h('textarea', { maxlength: 300, placeholder: 'What still needs to be done? (optional)' });
      UI.modal({ title: 'Send back for more work', body: h('div', null, h('p', null, 'The progress will be set back to 90% and everyone will see your note.'), note),
        actions: [{ label: 'Cancel' }, { label: 'Send back', kind: 'primary', onClick: async function () {
          try { task = (await Api.call('rejectTask', { taskId: id, note: note.value })).task; await refresh(true); UI.toast('Sent back'); } catch (e) { UI.toast(e.message, 'bad'); return false; }
        } }] });
    }

    function drawSummary() {
      UI.clear(sumBox);
      if (!S.canUseAi && !task.summary) return;   // nothing to show, and no right to ask for one
      const stale = task.summaryStale && task.messageCount > 0;
      const btn = h('button', { class: 'btn small', type: 'button', disabled: summaryBusy, onclick: function () { runSummary(true); } }, icon('refresh', 15), summaryBusy ? 'Updating…' : (task.summary ? 'Refresh summary' : 'Create summary'));
      let status = null;
      if (summaryBusy) status = h('span', { class: 'small muted' }, 'The AI is reading the conversation - this can take up to a minute.');
      else if (summaryError) status = h('span', { class: 'small', style: 'color:var(--bad)' }, summaryError);
      else if (stale && task.summary) status = h('span', { class: 'small muted' }, 'New messages since this summary (' + UI.ago(task.summaryAt) + ').');
      else if (task.summary && task.summaryAt) status = h('span', { class: 'small muted' }, 'Updated ' + UI.ago(task.summaryAt) + '.');
      sumBox.appendChild(summaryNode(task.summary, task.messageCount > 0 && S.canUseAi ? h('div', { class: 'sum-foot' }, h('span', { class: 'grow' }, status), btn) : null));
    }
    async function runSummary(force) {
      if (summaryBusy) return;
      summaryBusy = true; summaryError = ''; drawSummary();
      try { const r = await Api.call('refreshSummary', { taskId: id, force: !!force }, { timeout: 120000 }); task.summary = r.summary; task.summaryStale = false; task.summaryAt = Date.now(); }
      catch (e) { if (e.code !== 'AUTH') summaryError = e.message; }
      summaryBusy = false; drawSummary();
    }

    function drawFiles() {
      UI.clear(filesBox);
      const files = messages.filter(function (m) { return m.type === 'file' && m.file; });
      if (!files.length) return;
      filesBox.appendChild(h('div', { class: 'sec-title' }, h('h2', null, 'Files (' + files.length + ')')));
      filesBox.appendChild(h('div', { class: 'files-strip' }, files.slice().reverse().map(function (m) {
        return h('button', { type: 'button', class: 'fchip', title: m.file.name, onclick: function (e) { openFile(m, { taskId: id }, e.currentTarget); } }, UI.fileIcon(m.file.name), h('span', null, m.file.name));
      })));
    }

    async function refresh(force) { apply(await Api.call('getTask', { taskId: id }), force); }
    function apply(d, force) {
      S.taskMem[id] = d; settle();
      const newSig = d.messages.map(function (m) { return m.id + m.status; }).join(',') + '|' + d.task.progress + d.task.status + d.task.summaryAt + d.task.summaryStale;
      if (!force && newSig === sig) return;
      const stick = !sig || nearBottom() || force;
      sig = newSig; task = d.task; messages = d.messages;
      if (!dragging) drawHead();
      drawSummary(); drawFiles();
      renderChat(chatBox, messages, { taskId: id });
      pendingEls.forEach(function (el) { chatBox.appendChild(el); });
      if (stick) window.scrollTo(0, document.body.scrollHeight);
      if (!autoTried && task.summaryStale && task.messageCount > 0) { autoTried = true; setTimeout(function () { if (!summaryBusy) runSummary(false); }, 2500); }   // after the conversation is on screen, not alongside it   // everyone gets an up-to-date summary (it is saved, so this is one AI call per change)
      // Opening the task marks it read on the server; mirror that in the saved task list so the NEW badge goes away at once.
      const l = Api.cacheGet(listKey);
      if (l && l.tasks && l.tasks.some(function (t) { return t.id === id && t.unread; })) { l.tasks.forEach(function (t) { if (t.id === id) t.unread = false; }); Api.cacheSet(listKey, l); }
    }

    /* ---- composer ---- */
    function showPending(node) { pendingEls.push(node); chatBox.appendChild(node); window.scrollTo(0, document.body.scrollHeight); }
    function dropPending(node) { const i = pendingEls.indexOf(node); if (i >= 0) pendingEls.splice(i, 1); if (node.parentNode) node.parentNode.removeChild(node); }
    const pendingRow = function (inner, extra) { return h('div', { class: 'msg-row me' }, h('div', { class: 'msg me sending' }, inner, extra)); };

    function drawComposer() {
      UI.clear(compBox);
      const text = h('textarea', { placeholder: 'Write an update…', maxlength: 4000, rows: 1, 'aria-label': 'Message' });
      const send = h('button', { class: 'send hidden', type: 'button', 'aria-label': 'Send message', onclick: sendText }, icon('send', 20));
      const mic = h('button', { class: 'mic', type: 'button', 'aria-label': 'Record a voice message', title: 'Record a voice message', onclick: startRecording }, icon('mic', 22));
      const toggle = function () { const has = !!text.value.trim(); send.classList.toggle('hidden', !has); mic.classList.toggle('hidden', has); };
      const resize = function () { text.style.height = '46px'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; text.style.overflowY = text.scrollHeight > 140 ? 'auto' : 'hidden'; };
      text.addEventListener('input', function () { resize(); toggle(); });
      text.addEventListener('paste', function (e) { const fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); uploadFiles(Array.prototype.slice.call(fs)); } });
      // Ctrl/Cmd+Enter always sends; on a computer plain Enter sends too (Shift+Enter = new line). Phones keep Enter = new line.
      text.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return;
        if (e.ctrlKey || e.metaKey || (!e.shiftKey && window.matchMedia && window.matchMedia('(pointer: fine)').matches)) { e.preventDefault(); sendText(); }
      });
      async function sendText() {
        const v = text.value.trim(); if (!v) return;
        // show the message straight away (the server takes a second or two), and put the text back if sending fails
        const temp = pendingRow(h('div', { class: 'txt' }, v), h('div', { class: 'time' }, icon('clock', 11), 'Sending…'));
        showPending(temp); text.value = ''; resize(); toggle();
        try { await Api.call('postMessage', { taskId: id, text: v }); }
        catch (e) { dropPending(temp); if (!text.value) { text.value = v; resize(); toggle(); } if (e.code !== 'AUTH') UI.toast(e.message, 'bad'); return; }
        await refresh(true).catch(function () { /* the next poll will show it */ });
        dropPending(temp);
      }
      const attach = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Share a photo or document', title: 'Share a photo or document', onclick: attachFlow }, icon('paperclip', 22));
      compBox.appendChild(h('div', { class: 'composer-in' }, attach, text, mic, send));
    }

    async function uploadFiles(files) {
      if (!files || !files.length || task.status === 'closed') return;
      if (files.length > 5) UI.toast('Sending the first 5 files.');
      for (const f of files.slice(0, 5)) {
        const temp = pendingRow(h('div', { class: 'txt' }, '📎 Sending ' + f.name + '…'));
        showPending(temp);
        try {
          const p = await UI.prepareFile(f);
          await Api.call('postFile', { taskId: id, name: p.name, b64: p.b64, thumb: p.thumb, w: p.w, h: p.h }, { timeout: 170000 });
        } catch (e) { if (e.code !== 'AUTH') UI.toast(e.message, 'bad'); }
        await refresh(true).catch(function () { /* the next poll will show it */ });
        dropPending(temp);
      }
    }
    async function attachFlow() { uploadFiles(await UI.attachMenu()); }
    // on a computer: drop files anywhere on the page
    const veil = h('div', { class: 'drop-veil', 'aria-hidden': 'true' }, 'Drop to share with this task');
    const hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
    const onOver = function (e) { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add('file-drag'); } };
    const onLeaveDrag = function (e) { if (!e.relatedTarget) document.body.classList.remove('file-drag'); };
    const onDrop = function (e) { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove('file-drag'); uploadFiles(Array.prototype.slice.call(e.dataTransfer.files)); };
    document.body.appendChild(veil); document.addEventListener('dragover', onOver); document.addEventListener('dragleave', onLeaveDrag); document.addEventListener('drop', onDrop);
    onLeave(function () { veil.remove(); document.body.classList.remove('file-drag'); document.removeEventListener('dragover', onOver); document.removeEventListener('dragleave', onLeaveDrag); document.removeEventListener('drop', onDrop); });

    async function startRecording() {
      if (!Audio2.supported()) return UI.toast('Voice recording is not supported in this browser. You can still type your update.', 'bad');
      stopAudio();
      const timer = h('strong', null, '0:00');
      try {
        recording = await Audio2.start(function (s) { timer.textContent = UI.duration(s) + ' / ' + UI.duration(Audio2.MAX_SECONDS); });
      } catch (e) { return UI.toast(e.message, 'bad'); }
      const session = recording;
      UI.clear(compBox);
      compBox.appendChild(h('div', { class: 'recbar' }, h('span', { class: 'recdot' }), h('span', { class: 'grow' }, 'Recording… ', timer),
        h('button', { class: 'btn small', type: 'button', onclick: function () { recording = null; session.cancel().then(drawComposer); } }, 'Cancel'),
        h('button', { class: 'btn primary small', type: 'button', onclick: function () { session.stop(); } }, icon('send', 15), 'Send')));
      session.done.then(async function (r) {
        if (!r || recording !== session) return;   // cancelled
        recording = null; drawComposer();
        if (r.secs < 0.7) return UI.toast('That was too short.', 'bad');
        await sendVoice(r);
      });
    }

    async function sendVoice(r) {
      const temp = pendingRow(h('div', { class: 'txt' }, '🎤 Sending voice message (' + UI.duration(r.secs) + ')…'));
      showPending(temp);
      try {
        const payload = await Audio2.prepare(r.blob, r.secs);
        await Api.call('postVoice', Object.assign({ taskId: id }, payload), { timeout: 170000 });
      } catch (e) { UI.toast(e.message, 'bad'); }
      await refresh(true).catch(function () {});
      dropPending(temp);
    }

    drawComposer();
    if (freshData) apply(data, true);                       // just fetched: no second round trip
    else {
      drawHead();                                           // from this session / the task list; the server answer follows
      if (!data) chatBox.appendChild(UI.skeleton('line', 3));
      else { drawSummary(); drawFiles(); renderChat(chatBox, messages, { taskId: id }); sig = ''; }
      refresh(true).catch(function (e) { if (e.code !== 'AUTH' && !data) { UI.clear(chatBox); chatBox.appendChild(errBox(e)); } });
    }
    poll(function () { if (!dragging && !recording) return refresh(false); }, 15000);
  }

  /* ============================== history ============================== */

  function viewHistory() {
    const q = h('input', { type: 'search', placeholder: 'Search closed tasks by title, person or summary…', 'aria-label': 'Search history', value: S.histQ }); S.histQ = '';   // (the assistant may have filled it in)
    const list = h('div');
    S.peek = function () { return { q: q.value }; };
    shell(h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'History'), h('p', { class: 'sub' }, 'Completed and approved tasks, with their full conversation.'))), h('div', { class: 'search', style: 'margin-bottom:1rem' }, icon('search', 18), q), list), 'history');
    let timer = null;
    async function load() {
      UI.clear(list); list.appendChild(UI.skeleton('card', 3));
      try {
        const r = await Api.call('listHistory', { q: q.value, limit: 50 });
        UI.clear(list);
        if (!r.items.length) return list.appendChild(q.value ? UI.emptyState('search', 'No matches', 'No closed tasks match your search.') : UI.emptyState('done', 'Nothing here yet', 'Finished tasks land here once the manager approves them.'));
        r.items.forEach(function (t, i) {
          list.appendChild(h('a', { class: 'card task st-ok', href: '#/history/' + t.id, style: '--i:' + Math.min(i, 12) }, h('div', { class: 'top' }, h('div', { class: 'title' }, t.title)),
            h('div', { class: 'people' }, UI.avatarStack([t.creatorName]), h('span', { class: 't' }, t.creatorName + ' → ' + t.assigneeNames)),
            h('div', { class: 'meta' }, UI.chip('Completed ' + UI.date(t.closedAt), 'ok', 'check'), UI.chip('Started ' + UI.date(t.createdAt)), UI.chip(t.messageCount + ' message' + (t.messageCount === 1 ? '' : 's'))),
            t.summaryText ? h('div', { class: 'last' }, t.summaryText) : null));
        });
        if (r.total > r.items.length) list.appendChild(h('p', { class: 'muted small', style: 'text-align:center' }, 'Showing the latest ' + r.items.length + ' of ' + r.total + '. Use search to narrow down.'));
      } catch (e) { UI.clear(list); list.appendChild(errBox(e)); }
    }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 350); });
    load();
  }

  async function viewArchived(id) {
    const barOpts = { back: '#/history', title: 'Closed task' };
    shell(UI.skeleton('card', 2), 'history', barOpts);
    let doc;
    try { doc = await Api.call('getArchived', { taskId: id }, { timeout: 60000 }); }
    catch (e) { return shell(h('div', null, errBox(e), h('p', null, h('a', { href: '#/history' }, '← Back to history'))), 'history', barOpts); }
    const t = doc.task;
    const msgs = doc.messages.map(function (m) { return { id: m.id, senderId: m.senderId, senderName: m.senderName, senderTitle: '', type: m.type, text: m.text, status: m.status, hasAudio: !!m.audioFileId, audioSecs: m.audioSecs, createdAt: m.createdAt, file: m.file ? Object.assign({ isImage: String(m.file.mime).indexOf('image/') === 0 }, m.file) : undefined }; });
    const chat = h('div', { class: 'chat' });
    renderChat(chat, msgs, { archived: true, taskId: id });
    shell(h('div', null, h('a', { class: 'back-link desk', href: '#/history' }, icon('back', 18), 'History'),
      h('div', { class: 'card detail' }, h('div', { class: 'detail-banner' }), h('div', { class: 'detail-in' }, h('h1', null, t.title), h('div', { class: 'row' }, UI.chip('Closed', 'ok', 'check'), UI.chip('Started ' + UI.dateTime(t.createdAt)), UI.chip('Completed ' + UI.dateTime(t.closedAt), 'ok')),
        h('div', { style: 'margin-top:.8rem' },
          h('div', { class: 'person-line' }, h('span', { class: 'k' }, 'From'), h('span', { class: 'names' }, personBtn(t.creator))),
          h('div', { class: 'person-line' }, h('span', { class: 'k' }, 'To'), h('span', { class: 'names' }, t.assignees.map(function (a) { return personBtn(a); }))),
          h('div', { class: 'person-line' }, h('span', { class: 'k' }, 'Approved'), h('span', { class: 'names' }, t.approvedBy))),
        t.description ? h('div', { class: 'desc' }, t.description) : null)),
      t.summary && t.summary.summary_en ? summaryNode(t.summary) : null, h('div', { class: 'sec-title' }, h('h2', null, 'Conversation')), chat), 'history', barOpts);
  }

  /* ============================== admin: users ============================== */

  async function viewUsers() {
    const box = h('div', null, UI.skeleton('card', 3));
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Users'), h('button', { class: 'btn primary', type: 'button', onclick: function () { editUser(null); } }, icon('plus', 18), 'Add user')), box), 'users');
    let ov, needle = '';
    function drawRows(holder) {
      UI.clear(holder);
      const shown = ov.users.filter(function (u) { return !needle || (u.name + ' ' + u.username + ' ' + (u.jobTitle || '')).toLowerCase().indexOf(needle) >= 0; });
      if (!shown.length) return holder.appendChild(UI.emptyState('search', 'No one matches', 'Try a different search.'));
      const card = h('div', { class: 'card' });
      shown.forEach(function (u) {
        card.appendChild(h('div', { class: 'list-row user' }, UI.avatar(u.name, '', u.id),
          h('div', { class: 'info' }, h('strong', null, u.name), h('span', { class: 'muted small' }, '@' + u.username + (u.lastLogin ? ' · last sign-in ' + UI.ago(u.lastLogin) : ' · never signed in'))),
          h('div', { class: 'tags' }, u.jobTitle ? UI.chip(u.jobTitle + ' · L' + u.level) : null, u.isAdmin ? UI.chip('Admin', 'info', 'shield') : null, !u.active ? UI.chip('Inactive', 'bad') : null, u.mustChange ? UI.chip('Temp password', 'warn') : null),
          h('button', { class: 'btn small', type: 'button', onclick: function () { editUser(u); } }, icon('edit', 15), 'Edit')));
      });
      holder.appendChild(card);
    }
    // the organisation at a glance: numbers and a pyramid that grows to its size
    function overview() {
      const never = ov.users.filter(function (u) { return !u.lastLogin; }).length;
      const kpi = function (n, label) { const num = h('div', { class: 'num' }); UI.countUp(num, n); return h('div', { class: 'kpi' }, num, h('div', { class: 'lbl' }, label)); };
      const wrap = h('div', null, h('div', { class: 'kpis' }, kpi(ov.users.length, 'People'), kpi(ov.jobTitles.length, 'Job titles'), kpi(ov.links.length, 'Arrows'), kpi(never, 'Never signed in')));
      if (ov.jobTitles.length) {
        const pyr = h('div', { class: 'pyramid' });
        const lv = ov.jobTitles.slice().sort(function (a, b) { return a.level - b.level; });
        lv.forEach(function (t, i) {
          const n = ov.users.filter(function (u) { return u.jobTitleId === t.id; }).length, el = h('div', { class: 'pyr', style: '--i:' + i }, t.title, h('b', null, n));
          pyr.appendChild(el);
          const w = Math.round(34 + (lv.length > 1 ? i / (lv.length - 1) : 1) * 66) + '%';
          if (prefersReduced()) el.style.width = w; else requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.width = w; }); });
        });
        wrap.appendChild(h('div', { class: 'card' }, h('h3', null, 'Your pyramid'), pyr));
      }
      return wrap;
    }
    async function load() {
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      if (ov.jobTitles.length === 0) box.appendChild(h('div', { class: 'note' }, 'Start with ', h('a', { href: '#/admin/titles' }, 'Job titles'), ' (for example Chairman, Manager, Worker), then add users, then connect them in the ', h('a', { href: '#/admin/org' }, 'Org chart'), '.'));
      box.appendChild(overview());
      const rows = h('div');
      if (ov.users.length > 5) {
        const s = h('input', { type: 'search', placeholder: 'Search ' + ov.users.length + ' users…', 'aria-label': 'Search users' });
        s.addEventListener('input', function () { needle = s.value.trim().toLowerCase(); drawRows(rows); });
        box.appendChild(h('div', { class: 'search', style: 'margin-bottom:.8rem' }, icon('search', 18), s));
      }
      box.appendChild(rows); drawRows(rows);
      Profiles.refresh();
    }
    function showTemp(title, u, temp) {
      const pw = h('div', { class: 'pw' }, temp);
      UI.modal({ title: title, sticky: true, body: h('div', null, h('p', null, h('strong', null, u.name), ' (@' + u.username + ') must sign in with this temporary password and will be asked to choose a new one:'), pw,
        h('p', { class: 'muted small', style: 'margin-top:.6rem' }, 'It is shown only once. Share it privately (not in a group chat).')),
        actions: [{ label: 'Copy password', onClick: async function () { UI.toast((await UI.copyText(temp)) ? 'Copied' : 'Select the password and copy it manually'); return false; } }, { label: 'Done', kind: 'primary' }] });
    }
    function editUser(u) {
      const name = h('input', { type: 'text', maxlength: 80, value: u ? u.name : '' });
      const username = h('input', { type: 'text', maxlength: 30, value: u ? u.username : '', autocapitalize: 'none', spellcheck: 'false' });
      const title = h('select', null, h('option', { value: '' }, '- none (admin only) -'), ov.jobTitles.map(function (t) { return h('option', { value: t.id, selected: u && u.jobTitleId === t.id }, 'L' + t.level + ' · ' + t.title); }));
      const admin = h('input', { type: 'checkbox', checked: !!(u && u.isAdmin) });
      const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
      const body = h('div', null, h('label', null, 'Full name', name), h('label', null, 'Username (used to sign in)', username), h('label', null, 'Job title (decides the layer in the pyramid)', title),
        h('label', { class: 'check-row' }, admin, 'Administrator (can manage users, job titles and the org chart)'),
        u ? h('label', { class: 'check-row' }, active, 'Account is active') : null,
        u ? h('p', { style: 'margin-top:1rem' }, h('button', { class: 'btn small', type: 'button', onclick: async function () {
          if (!(await UI.confirm('Reset password?', u.name + ' will be signed out and must use a new temporary password.', 'Reset password'))) return;
          await guarded(async function () { const r = await Api.call('adminResetPassword', { userId: u.id }); showTemp('Password reset', u, r.tempPassword); await load(); });
        } }, icon('lock', 15), 'Reset password…')) : null);
      UI.modal({ title: u ? 'Edit user' : 'Add user', body: body, actions: [{ label: 'Cancel' }, { label: u ? 'Save' : 'Create user', kind: 'primary', onClick: async function () {
        try {
          const r = await Api.call('adminSaveUser', { id: u ? u.id : undefined, name: name.value, username: username.value, jobTitleId: title.value, isAdmin: admin.checked, active: u ? active.checked : true });
          await load(); if (r.tempPassword) showTemp('User created', r.user, r.tempPassword); else UI.toast('Saved');
        } catch (e) { UI.toast(e.message, 'bad'); return false; }
      } }] });
    }
    load();
  }

  /* ============================== admin: job titles ============================== */

  async function viewTitles() {
    const box = h('div', null, UI.skeleton('card', 2));
    shell(h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Job titles'), h('p', { class: 'sub' }, 'A job title belongs to a layer of the pyramid. Layer 1 is the top. People can only be connected to people in a lower layer.')),
      h('button', { class: 'btn primary', type: 'button', onclick: function () { editTitle(null); } }, icon('plus', 18), 'Add job title')), box), 'titles');
    let ov;
    async function load() {
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      if (!ov.jobTitles.length) return box.appendChild(UI.emptyState('team', 'No job titles yet', 'Add the first one, for example "Chairman" at layer 1.'));
      const card = h('div', { class: 'card' });
      ov.jobTitles.forEach(function (t) {
        const n = ov.users.filter(function (u) { return u.jobTitleId === t.id; }).length;
        card.appendChild(h('div', { class: 'list-row' }, h('span', { class: 'layer-badge' }, h('small', null, 'Layer'), t.level), h('div', { class: 'info' }, h('strong', null, t.title), h('span', { class: 'muted small' }, n + ' user' + (n === 1 ? '' : 's'))),
          h('button', { class: 'btn small', type: 'button', onclick: function () { editTitle(t); } }, icon('edit', 15), 'Edit'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete ' + t.title, onclick: async function () {
            if (!(await UI.confirm('Delete "' + t.title + '"?', 'This only works if no user has this job title.', 'Delete', 'danger'))) return;
            await guarded(async function () { await Api.call('adminDeleteJobTitle', { id: t.id }); UI.toast('Deleted'); await load(); });
          } }, icon('trash', 18))));
      });
      box.appendChild(card);
    }
    function editTitle(t) {
      const name = h('input', { type: 'text', maxlength: 60, value: t ? t.title : '', placeholder: 'e.g. General Manager' });
      const level = h('input', { type: 'number', min: 1, max: 20, step: 1, value: t ? t.level : (ov.jobTitles.length ? Math.max.apply(null, ov.jobTitles.map(function (x) { return x.level; })) + 1 : 1) });
      UI.modal({ title: t ? 'Edit job title' : 'Add job title', body: h('div', null, h('label', null, 'Job title', name), h('label', null, 'Layer (1 = top of the pyramid)', level)),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async function () {
          try { await Api.call('adminSaveJobTitle', { id: t ? t.id : undefined, title: name.value, level: Number(level.value) }); UI.toast('Saved'); await load(); }
          catch (e) { UI.toast(e.message, 'bad'); return false; }
        } }] });
    }
    load();
  }

  /* ============================== admin: org chart ============================== */

  async function viewOrg() {
    const box = h('div', null, UI.skeleton('card', 2));
    shell(h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Org chart'), h('p', { class: 'sub' }, 'Draw arrows to decide who can give tasks to whom. An arrow from A to B means "A can assign tasks to B". People only see and assign to the people their arrows point to.'))), box), 'org');
    async function load() {
      let ov;
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      const hasTitled = ov.users.some(function (u) { return u.level !== null; });
      if (!hasTitled) return box.appendChild(UI.emptyState('team', 'Nothing to connect yet', 'Add job titles and users first, then come back to connect them.'));
      box.appendChild(OrgCanvas.create({ users: ov.users, links: ov.links, onSave: async function (links, note) { await Api.call('adminSaveLinks', { links: links, note: note }); await load(); } }));
      if (ov.versions.length) {
        box.appendChild(h('div', { class: 'card', style: 'margin-top:1rem' }, h('h3', null, 'Saved versions'),
          ov.versions.map(function (v) { return h('div', { class: 'list-row' }, UI.chip('v' + v.version, 'brand'), h('div', { class: 'info' }, h('strong', null, v.createdBy + ' · ' + v.linkCount + ' arrows'), h('span', { class: 'muted small' }, UI.dateTime(v.createdAt) + (v.note ? ' · ' + v.note : '')))); })));
      }
      Profiles.refresh();
    }
    load();
  }

  /* ============================== account & profile ============================== */

  function viewAccount() {
    const me = S.user;
    const o = UI.passwordField({ autocomplete: 'current-password' }), n = UI.passwordField({ autocomplete: 'new-password' }), r = UI.passwordField({ autocomplete: 'new-password' });
    const err = h('div');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err);
      if (n.input.value !== r.input.value) return err.appendChild(errBox(new Error('The two new passwords do not match.')));
      try { await Api.call('changePassword', { oldPassword: o.input.value, newPassword: n.input.value }); o.input.value = n.input.value = r.input.value = ''; UI.toast('Password changed. Other devices were signed out.'); }
      catch (e) { err.appendChild(errBox(e)); }
    } }, h('label', null, 'Current password', o.el), h('label', null, 'New password (at least 8 characters)', n.el), h('label', null, 'Repeat new password', r.el), h('button', { class: 'btn primary', type: 'submit', style: 'margin-top:1.2rem' }, 'Change password'), err);

    // ---- picture + bio ----
    const bio = h('textarea', { maxlength: 300, rows: 3, placeholder: 'Say a few words about yourself - what you do, what people can ask you about…', 'aria-label': 'About me' });
    bio.value = Profiles.bio(me.id);
    const counter = h('div', { class: 'counter' }), saveBio = h('button', { class: 'btn primary small', type: 'button' }, 'Save');
    const count = function () { counter.textContent = bio.value.length + ' / 300'; };
    bio.addEventListener('input', count); count();
    saveBio.addEventListener('click', async function () {
      saveBio.disabled = true;
      try { await Profiles.saveMine({ bio: bio.value }); UI.toast('Profile saved'); } catch (e) { UI.toast(e.message, 'bad'); } finally { saveBio.disabled = false; }
    });
    const removeBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: async function () {
      try { await Profiles.saveMine({ photo: '' }); UI.toast('Picture removed'); } catch (e) { UI.toast(e.message, 'bad'); }
    } }, 'Remove picture');
    const syncRemove = function () { removeBtn.classList.toggle('hidden', !Profiles.photo(me.id)); };
    async function changePhoto() {
      const data = await UI.pickPhoto(); if (!data) return;
      try { await Profiles.saveMine({ photo: data }); UI.toast('Profile picture updated'); } catch (e) { UI.toast(e.message, 'bad'); }
    }
    Profiles.onChange(function () { syncRemove(); if (document.activeElement !== bio && !bio.value) { bio.value = Profiles.bio(me.id); count(); } });
    syncRemove();

    const themes = [['auto', 'Auto', 'phone'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Appearance', style: 'margin:0' }, themes.map(function (t) {
      return h('button', { type: 'button', 'data-v': t[0], class: UI.theme.get() === t[0] ? 'on' : '', 'aria-pressed': UI.theme.get() === t[0], onclick: function () {
        UI.theme.set(t[0]); seg.querySelectorAll('button').forEach(function (b) { const on = b.getAttribute('data-v') === t[0]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      } }, icon(t[2], 16), t[1]);
    }));

    shell(h('div', null,
      h('div', { class: 'card profile-card' }, h('div', { class: 'cover' }),
        h('div', { class: 'profile-in' },
          h('div', { class: 'photo-edit' }, UI.avatar(me.name, 'xl', me.id), h('button', { class: 'cam', type: 'button', 'aria-label': 'Change profile picture', title: 'Change picture', onclick: changePhoto }, icon('camera', 18))),
          h('h2', null, me.name), h('div', { class: 'muted small' }, '@' + me.username),
          h('div', { class: 'row', style: 'margin-top:.5rem;gap:.35rem' }, me.jobTitle ? UI.chip(me.jobTitle, 'brand') : null, me.isAdmin ? UI.chip('Administrator', 'info', 'shield') : null, removeBtn),
          h('label', { style: 'margin-top:1.1rem' }, 'About me'), bio, h('div', { class: 'row between' }, counter, saveBio),
          h('div', { class: 'hint' }, 'Your picture and bio are visible to the people you work with: your managers, your team and anyone you share a task with.'))),
      h('div', { class: 'card' }, h('h2', null, 'Appearance'), h('p', { class: 'muted small' }, 'Auto follows your phone or computer setting.'), seg,
        h('h3', { style: 'margin-top:1.1rem' }, 'Colour'),
        (function () {
          const box = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour' });
          UI.accent.list.forEach(function (a) {
            box.appendChild(h('button', { type: 'button', class: 'swatch' + (UI.accent.get() === a[0] ? ' on' : ''), style: '--a:' + a[2] + ';--b:' + a[3], 'aria-pressed': UI.accent.get() === a[0], 'data-v': a[0], onclick: function () {
              UI.accent.set(a[0]); box.querySelectorAll('.swatch').forEach(function (b) { const on = b.getAttribute('data-v') === a[0]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
            } }, h('i'), a[1]));
          });
          return box;
        })()),
      isPureAdmin() || !S.canUseAi ? null : Assistant.settingsCard(),
      h('div', { class: 'card' }, h('h2', null, 'Change password'), form),
      h('div', { class: 'card tip' }, icon('phone', 22), h('div', null, h('h3', null, 'Add to your home screen'), h('p', { class: 'muted small', style: 'margin:0' }, 'Open this page on your phone, then in Chrome use the ⋮ menu → "Add to Home screen". On iPhone (Safari) use Share → "Add to Home Screen". It then opens like an app.'))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: signOut }, icon('logout', 18), 'Sign out'), Api.demo ? h('button', { class: 'btn', type: 'button', onclick: function () { Demo.reset(); } }, 'Reset demo data') : null)), 'account');
    Profiles.refresh(true);
  }

  /* ============================== router / boot ============================== */

  function route() {
    stopAudio(); stopTimers(); runLeave(); unsettle(); S.peek = null; S.fill = null; S.kind = '';
    if (!S.user) return showLogin();
    if (S.user.mustChange) { Assistant.hide(); return viewMustChange(); }
    Profiles.refresh();
    const p = (location.hash || '#/tasks').slice(2).split('/');
    // the AI bubble floats over every screen (not over the administrator-only pages); it knows which task or completed task is open
    if (isPureAdmin() || !S.canUseAi) Assistant.hide(); else {
      Assistant.ensure(App);
      Assistant.where({ task: p[0] === 'task' && p[1] ? decodeURIComponent(p[1]) : '', archived: p[0] === 'history' && p[1] ? decodeURIComponent(p[1]) : '' });
    }
    const adminOnly = function (fn) { return S.user.isAdmin ? fn() : go('#/tasks'); };
    S.kind = { tasks: 'home', 'new': 'new', task: 'task', history: p[1] ? 'closed' : 'history', account: 'account', admin: 'admin' }[p[0]] || '';
    if (S.kind !== 'new') S.pendingFill = null;
    switch (p[0]) {
      case 'tasks': return viewTasks();
      case 'assistant': return go('#/tasks');   // the AI is now the floating bubble
      case 'new': return viewNewTask(p[1] ? decodeURIComponent(p[1]) : '');
      case 'task': return p[1] ? viewTask(decodeURIComponent(p[1])) : go('#/tasks');
      case 'history': return p[1] ? viewArchived(decodeURIComponent(p[1])) : viewHistory();
      case 'admin':
        if (p[1] === 'users') return adminOnly(viewUsers);
        if (p[1] === 'titles') return adminOnly(viewTitles);
        if (p[1] === 'org') return adminOnly(viewOrg);
        return go('#/tasks');
      case 'account': return viewAccount();
      default: return go('#/tasks');
    }
  }

  function notConfigured() {
    authPage(h('h1', null, 'Task Manager'), 'Not connected yet.', h('div', { class: 'card' }, h('p', null, 'This site has not been connected to a backend yet.'),
      h('p', { class: 'muted' }, 'The administrator needs to put the backend address into js/config.js. You can look around with fake data in the demo:'), h('a', { class: 'btn primary', href: '?demo=1' }, 'Open the demo')));
  }

  /* ---- the AI points a task out: the list scrolls to it and it glows until the next touch ---- */
  function clearSpot() {
    if (!S.spot) return;
    S.spot = '';
    document.querySelectorAll('.task.ai-spot').forEach(function (el) { el.classList.remove('ai-spot'); });
  }
  function showTask(id) {
    S.filter = 'all'; S.q = ''; S.only = [];
    S.spot = id;
    if ((location.hash || '#/tasks').indexOf('#/tasks') === 0) route(); else go('#/tasks');
    let tries = 0;
    const timer = setInterval(function () {
      const el = document.querySelector('.task[data-id="' + id + '"]');
      if (el) { clearInterval(timer); el.classList.add('ai-spot'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (++tries > 40) clearInterval(timer);
    }, 150);
  }

  // The assistant takes the person to what they asked to see (the task list with a filter / search / chosen tasks, History, Account).
  function showPage(a) {
    const same = function (h2) { if ((location.hash || '#/tasks').indexOf(h2) === 0) route(); else go(h2); };
    if (a.page === 'account') return go('#/account');
    if (a.page === 'history') { S.histQ = a.q || ''; return same('#/history'); }
    S.filter = a.filter || 'all'; S.q = a.q || ''; S.only = a.taskIds || []; S.spot = '';
    same('#/tasks');
  }

  // What is on screen right now, for the AI bubble (it is sent with every question; the server checks it).
  function screen() {
    const out = { kind: S.kind };
    if (!out.kind) return undefined;
    try { Object.assign(out, S.peek ? S.peek() : {}); } catch (e) { /* a missing detail is not worth failing a question */ }
    return out;
  }
  // The assistant fills in the New task form (from anywhere: it opens the form first).
  function fillTask(a) {
    if (S.kind === 'new' && S.fill) return S.fill(a);
    S.pendingFill = a; go('#/new');
  }

  const App = { S: S, shell: shell, go: go, onLeave: onLeave, invalidate: invalidate, showTask: showTask, showPage: showPage, clearSpot: clearSpot, screen: screen, fillTask: fillTask };

  async function boot() {
    UI.theme.apply(); UI.accent.apply();
    Profiles.load(); Profiles.onChange(function () { UI.hydrateAvatars(document); });
    if (!Api.configured) return notConfigured();
    try {
      if (Api.demo) await Demo.init();
      Api.onAuthLost = function (msg) { S.user = null; showLogin(msg || 'Please sign in again.'); };
      let slowEl = null;   // a small note while the server is slow, so a wait never looks like a frozen app
      Api.onSlow = function (on) {
        if (on && !slowEl) { slowEl = h('div', { class: 'slow-note', role: 'status' }, 'The server is slow, still trying…'); document.body.appendChild(slowEl); }
        else if (!on && slowEl) { slowEl.remove(); slowEl = null; }
      };
      if (Api.token) {
        const known = Api.cacheGet('me');
        if (known && known.user) {
          // Returning visitor: open straight into the app with the last known profile and check it in the background.
          S.user = known.user; S.company = known.company; S.canAssign = known.canAssign; S.canUseAi = !!known.canUseAi;
          const sig = function () { const u = S.user || {}; return [u.id, u.isAdmin, u.mustChange, u.jobTitleId, u.active, S.canAssign, S.canUseAi].join('|'); };
          const before = sig();
          loadMe().then(function () { if (S.user && sig() !== before) route(); }).catch(function () { /* AUTH is handled by Api.onAuthLost; offline keeps the cached view */ });
        } else {
          try { await loadMe(); }
          catch (e) { if (e.network) { authPage(h('h1', null, 'Offline'), 'We could not reach the server.', h('div', { class: 'card' }, errBox(e), h('button', { class: 'btn primary block', style: 'margin-top:1rem', onclick: function () { location.reload(); } }, 'Try again'))); return; } Api.setToken(''); }
        }
      }
      window.addEventListener('hashchange', route);
      route();
    } catch (e) { authPage(h('h1', null, 'Something went wrong'), 'Please reload the page.', h('div', { class: 'card' }, errBox(e))); }
  }
  boot();
})();
