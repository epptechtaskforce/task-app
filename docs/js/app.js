/* app.js - screens, routing and glue. All text from the server is inserted with textContent (via h()), never as HTML. */
(function () {
  'use strict';
  const root = document.getElementById('app');
  const S = { user: null, company: '', canAssign: false, timers: [], filter: 'all', unread: 0, playing: null, taskMem: {} };

  /* ============================== helpers ============================== */

  function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }
  function poll(fn, ms) { S.timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); }
  // Pure administrators (no job title) have no tasks, so start them on the Users page.
  function landing() { return S.user && S.user.isAdmin && !S.user.jobTitleId ? '#/admin/users' : '#/tasks'; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function mount(node) { UI.clear(root); root.appendChild(node); window.scrollTo(0, 0); }

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
    if (t.status === 'pending') return UI.chip('Awaiting approval', 'warn');
    if (t.progress === 0) return UI.chip('Not started');
    return UI.chip('In progress', 'info');
  }
  function peopleLine(t) {
    return t.role === 'creator' ? 'To: ' + t.assignees.map(function (a) { return a.name; }).join(', ') : 'From: ' + t.creator.name + (t.assignees.length > 1 ? ' · with ' + (t.assignees.length - 1) + ' other' + (t.assignees.length > 2 ? 's' : '') : '');
  }

  /* ============================== shell ============================== */

  function shell(content, active) {
    const u = S.user;
    const nav = [['#/tasks', 'Tasks', 'tasks'], ['#/history', 'History', 'history']];
    if (u.isAdmin) nav.push(['#/admin/users', 'Users', 'users'], ['#/admin/titles', 'Job titles', 'titles'], ['#/admin/org', 'Org chart', 'org']);
    nav.push(['#/account', 'Account', 'account']);
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'topbar-in' }, h('div', { class: 'brand' }, S.company || 'Task Manager'), h('span', { class: 'small muted' }, u.name), h('a', { class: 'avatar', href: '#/account', title: 'Account', 'aria-label': 'Account' }, UI.initials(u.name))),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, nav.map(function (n) {
        return h('a', { href: n[0], class: n[2] === active ? 'active' : '', 'aria-current': n[2] === active ? 'page' : false }, n[1], n[2] === 'tasks' && S.unread ? h('span', { class: 'badge' }, S.unread) : null);
      })));
    mount(h('div', null, top, h('main', null, content)));
  }
  function setUnread(tasks) {
    S.unread = tasks.filter(function (t) { return t.unread; }).length;
    document.title = (S.unread ? '(' + S.unread + ') ' : '') + (S.company || 'Task Manager');
    const a = document.querySelector('.nav a[href="#/tasks"]');
    if (a) { const b = a.querySelector('.badge'); if (b) b.remove(); if (S.unread) a.appendChild(h('span', { class: 'badge' }, S.unread)); }
  }

  /* ============================== login / password ============================== */

  function showLogin(message) {
    stopTimers(); S.user = null; S.taskMem = {};
    // Paint the sign-in page at once with the last known company name; the server (which may need a few seconds to
    // wake up) is asked in the background. Asking first made people stare at "Loading…".
    const company = S.company || Api.savedCompany();
    const title = h('h1', null, company || 'Task Manager');
    if (!S.company) Api.call('info').then(function (r) { if (r && r.companyName) { S.company = r.companyName; Api.saveCompany(r.companyName); title.textContent = r.companyName; } }).catch(function () { /* ignore */ });
    const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('div');
    const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;margin-top:1rem' }, 'Sign in');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err); btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await Api.call('login', { username: user.value, password: pass.value });
        Api.setToken(r.token); S.user = r.user; S.company = r.companyName; S.canAssign = !!r.canAssign;
        if (r.user.mustChange) return viewMustChange();
        if (r.canAssign === undefined) await loadMe(); else rememberMe();   // the sign-in answer already holds the profile
        go(landing());
      } catch (e) { err.appendChild(errBox(e)); pass.value = ''; }
      finally { btn.disabled = false; btn.textContent = 'Sign in'; }
    } }, h('label', null, 'Username', user), h('label', null, 'Password', pass), btn, err);
    const demo = Api.demo ? h('div', { class: 'note' }, h('strong', null, 'Demo mode'), ' - fake data in this browser only. Password for every account: ', h('code', null, Demo.password),
      h('ul', null, Demo.accounts.map(function (a) { return h('li', null, h('a', { href: '#', onclick: function (e) { e.preventDefault(); user.value = a[0]; pass.value = Demo.password; } }, a[0]), ' - ' + a[1]); })),
      h('button', { class: 'btn small', type: 'button', onclick: function () { Demo.reset(); } }, 'Reset demo data')) : null;
    mount(h('div', { class: 'center-box' }, title, h('p', { class: 'muted' }, 'Sign in to see and update your tasks.'),
      message ? h('div', { class: 'note' }, message) : null, h('div', { class: 'card' }, form), demo));
    user.focus();
  }

  function viewMustChange() {
    stopTimers();
    const old = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const err = h('div');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err);
      if (n1.value !== n2.value) return err.appendChild(errBox(new Error('The two new passwords do not match.')));
      try {
        await Api.call('changePassword', { oldPassword: old.value, newPassword: n1.value });
        S.user.mustChange = false; UI.toast('Password changed'); await loadMe(); go(landing());
      } catch (e) { err.appendChild(errBox(e)); }
    } }, h('label', null, 'Temporary password you were given', old), h('label', null, 'New password (at least 8 characters)', n1), h('label', null, 'Repeat new password', n2),
      h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;margin-top:1rem' }, 'Save new password'), err);
    mount(h('div', { class: 'center-box' }, h('h1', null, 'Choose a new password'), h('p', { class: 'muted' }, 'For your security, please replace the temporary password before continuing.'), h('div', { class: 'card' }, form),
      h('button', { class: 'btn ghost small', type: 'button', onclick: signOut }, 'Sign out')));
  }

  async function signOut() {
    try { await Api.call('logout'); } catch (e) { /* ignore */ }
    Api.setToken(''); S.user = null; stopTimers(); showLogin('You have been signed out.');
  }

  async function loadMe() {
    const me = await Api.call('me');
    S.user = me.user; S.company = me.companyName; S.canAssign = me.canAssign;
    rememberMe();
  }
  function rememberMe() {
    Api.cacheSet('me', { user: S.user, company: S.company, canAssign: S.canAssign });
    Api.saveCompany(S.company);
  }

  /* ============================== tasks list ============================== */

  function viewTasks() {
    const list = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    const filters = h('div', { class: 'filters', role: 'tablist' });
    const head = h('div', { class: 'page-head' }, h('h1', null, 'Tasks'), S.canAssign ? h('a', { class: 'btn primary', href: '#/new' }, '+ New task') : null);
    shell(h('div', null, head, filters, list), 'tasks');
    let tasks = [];
    const cacheKey = 'tasks:' + S.user.id;

    function draw() {
      const counts = { all: tasks.length, mine: 0, byme: 0, approve: 0 };
      tasks.forEach(function (t) { if (t.role === 'assignee') counts.mine++; else counts.byme++; if (t.role === 'creator' && t.status === 'pending') counts.approve++; });
      UI.clear(filters);
      [['all', 'All'], ['mine', 'Assigned to me'], ['byme', 'Assigned by me'], ['approve', 'To approve']].forEach(function (f) {
        if (f[0] === 'approve' && !counts.approve && S.filter !== 'approve') return;
        filters.appendChild(h('button', { type: 'button', class: S.filter === f[0] ? 'on' : '', onclick: function () { S.filter = f[0]; draw(); } }, f[1] + ' (' + counts[f[0]] + ')'));
      });
      const shown = tasks.filter(function (t) { return S.filter === 'all' || (S.filter === 'mine' && t.role === 'assignee') || (S.filter === 'byme' && t.role === 'creator') || (S.filter === 'approve' && t.role === 'creator' && t.status === 'pending'); });
      UI.clear(list);
      if (!shown.length) {
        list.appendChild(h('div', { class: 'card empty' }, tasks.length ? 'Nothing in this view.' : 'No open tasks.' + (S.canAssign ? ' Create one with "New task".' : ' New tasks assigned to you will appear here.')));
        return;
      }
      shown.forEach(function (t) {
        const due = UI.dueInfo(t.dueDate, t.status);
        list.appendChild(h('a', { class: 'card task', href: '#/task/' + t.id },
          t.unread ? h('span', { class: 'dot', title: 'New messages' }) : null,
          h('div', { class: 'title' }, t.title), h('div', { class: 'people' }, peopleLine(t)),
          UI.progressBar(t.progress, t.status),
          h('div', { class: 'meta' }, statusChip(t), h('strong', null, t.progress + '%'), due ? UI.chip(due.text, due.cls) : null, h('span', { class: 'muted small' }, 'Updated ' + UI.ago(t.updatedAt))),
          t.lastMessage ? h('div', { class: 'last' }, t.lastMessage.senderName + ': ' + (t.lastMessage.type === 'voice' ? '🎤 ' : '') + t.lastMessage.text) : null));
      });
    }
    async function load() {
      try {
        tasks = (await Api.call('listTasks')).tasks; setUnread(tasks); draw();
        Api.cacheSet(cacheKey, { tasks: tasks });
        // Warm the "people I can assign to" list so the New task screen opens at once.
        if (S.canAssign && !Api.cacheGet('assignable')) Api.call('assignable').then(function (p) { Api.cacheSet('assignable', p); }).catch(function () { /* ignore */ });
      }
      catch (e) { if (e.code === 'MUSTCHANGE') return viewMustChange(); if (e.code !== 'AUTH' && !tasks.length) { UI.clear(list); list.appendChild(errBox(e)); } }
    }
    // Show the last known list immediately (it is refreshed within a moment), instead of an empty "Loading…" screen.
    const known = Api.cacheGet(cacheKey);
    if (known && Array.isArray(known.tasks)) { tasks = known.tasks; setUnread(tasks); draw(); }
    load(); poll(load, 20000);
  }

  /* ============================== new task ============================== */

  async function viewNewTask() {
    let people = Api.cacheGet('assignable');
    if (people && people.length) {   // an empty list is not trusted: the admin may have added arrows since
      // Open at once with the last known list; refresh it quietly for next time (the server re-checks every assignment anyway).
      Api.call('assignable').then(function (p) { Api.cacheSet('assignable', p); }).catch(function () { /* ignore */ });
    } else {
      shell(h('p', { class: 'muted' }, 'Loading…'), 'tasks');
      try { people = await Api.call('assignable'); Api.cacheSet('assignable', people); } catch (e) { return shell(errBox(e), 'tasks'); }
    }
    if (!people.length) return shell(h('div', { class: 'card empty' }, 'You do not have anyone to assign tasks to. Ask your administrator to connect you to the people you manage in the Org chart.'), 'tasks');

    const title = h('input', { type: 'text', maxlength: 120, required: true, placeholder: 'e.g. Prepare the harvest report' });
    const desc = h('textarea', { maxlength: 2000, placeholder: 'Details, what "done" looks like, anything they should know…' });
    const due = h('input', { type: 'date' });
    const boxes = [], pick = h('div', { class: 'pick' });
    let lastLevel = null;
    people.forEach(function (p) {
      if (p.level !== lastLevel) { lastLevel = p.level; pick.appendChild(h('div', { class: 'lvl' }, 'Layer ' + p.level + ' · ' + p.jobTitle)); }
      const cb = h('input', { type: 'checkbox', value: p.id });
      boxes.push(cb);
      pick.appendChild(h('label', null, cb, h('span', null, h('strong', null, p.name), ' ', h('span', { class: 'muted small' }, p.jobTitle))));
    });
    const err = h('div');
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Assign task');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err);
      const ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      if (!ids.length) return err.appendChild(errBox(new Error('Choose at least one person.')));
      submit.disabled = true;
      try { const r = await Api.call('createTask', { title: title.value, description: desc.value, dueDate: due.value, assigneeIds: ids }); UI.toast('Task assigned'); go('#/task/' + r.task.id); }
      catch (e) { err.appendChild(errBox(e)); submit.disabled = false; }
    } }, h('label', null, 'Task title', title), h('label', null, 'Description (optional)', desc), h('label', null, 'Due date (optional)', due),
      h('label', null, 'Assign to (you can choose several people - they will share one conversation)'), pick, err,
      h('div', { class: 'row', style: 'margin-top:1rem' }, submit, h('a', { class: 'btn', href: '#/tasks' }, 'Cancel')));
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'New task')), h('div', { class: 'card' }, form)), 'tasks');
    title.focus();
  }

  /* ============================== conversation pieces ============================== */

  function healthChip(hl) {
    const m = { on_track: ['On track', 'ok'], at_risk: ['At risk', 'warn'], blocked: ['Blocked', 'bad'], done: ['Looks complete', 'ok'], unknown: ['Status unclear', ''] }[hl] || ['', ''];
    return m[0] ? UI.chip(m[0], m[1]) : null;
  }

  function summaryNode(summary, extra) {
    const s = summary;
    const list = function (title, items) { return items && items.length ? [h('strong', { class: 'small' }, title), h('ul', null, items.map(function (i) { return h('li', null, i); }))] : null; };
    return h('div', { class: 'card summary' },
      h('h3', null, '✨ AI summary', s ? healthChip(s.health) : null, h('span', { class: 'grow' }), extra),
      s ? h('div', null, h('p', null, s.summary_en), s.summary_si ? h('p', { class: 'muted' }, s.summary_si) : null, s.progress_note ? h('p', { class: 'small' }, h('strong', null, 'So far: '), s.progress_note) : null, list('Blockers', s.blockers), list('Next steps', s.next_steps))
        : h('p', { class: 'muted' }, 'No summary yet. It appears once people post updates.'));
  }

  function stopAudio() {
    if (S.playing) { try { S.playing.audio.pause(); } catch (e) { /* ignore */ } S.playing = null; }
    document.querySelectorAll('.play').forEach(function (b) { b.textContent = '▶'; });
  }
  async function togglePlay(btn, m, o) {
    const same = S.playing && S.playing.id === m.id;
    stopAudio();
    if (same) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      const url = await Audio2.urlFor((o.archived ? 'a' : 'l') + m.id, function () { return Api.call('getAudio', o.archived ? { archived: true, taskId: o.taskId, messageId: m.id } : { messageId: m.id }); });
      const a = new Audio(url);
      a.onended = function () { S.playing = null; document.querySelectorAll('.play').forEach(function (b) { b.textContent = '▶'; }); };
      await a.play();
      S.playing = { id: m.id, audio: a }; btn.textContent = '❚❚';
    } catch (e) { btn.textContent = '▶'; UI.toast(e.message || 'Could not play this voice message.', 'bad'); }
    finally { btn.disabled = false; }
  }

  function messageNode(m, o) {
    if (m.type === 'system') return h('div', { class: 'msg system' }, m.text);
    const mine = m.senderId === S.user.id;
    let body;
    if (m.type === 'voice') {
      const text = m.status === 'transcribing' ? 'Transcribing…' : m.transcript ? m.transcript : 'Transcript not available - play the audio.';
      body = h('div', null,
        h('div', { class: 'voice' }, m.hasAudio ? h('button', { class: 'play', type: 'button', 'data-id': m.id, 'aria-label': 'Play voice message', onclick: function (e) { togglePlay(e.currentTarget, m, o); } }, S.playing && S.playing.id === m.id ? '❚❚' : '▶') : null, h('span', { class: 'muted small' }, '🎤 ' + UI.duration(m.audioSecs))),
        h('div', { class: 'txt' }, text),
        m.translation && m.translation !== m.transcript ? h('div', { class: 'tr' }, 'English: ' + m.translation) : null);
    } else body = h('div', { class: 'txt' }, m.text);
    return h('div', { class: 'msg' + (mine ? ' me' : '') }, mine ? null : h('div', { class: 'who' }, m.senderName + (m.senderTitle ? ' · ' + m.senderTitle : '')), body, h('div', { class: 'time' }, UI.time(m.createdAt)));
  }

  function renderChat(box, messages, o) {
    UI.clear(box);
    let day = '';
    messages.forEach(function (m) {
      const d = UI.dayLabel(m.createdAt);
      if (d !== day) { day = d; box.appendChild(h('div', { class: 'day' }, d)); }
      box.appendChild(messageNode(m, o));
    });
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
    if (!data && !preview) {
      shell(h('p', { class: 'muted' }, 'Loading…'), 'tasks');
      try { data = await Api.call('getTask', { taskId: id }); freshData = true; }
      catch (e) { return shell(h('div', null, errBox(e), h('p', null, h('a', { href: '#/tasks' }, '← Back to tasks'))), 'tasks'); }
    }

    let task = data ? data.task : preview, messages = data ? data.messages : [], sig = '', dragging = false, summaryBusy = false, summaryError = '', autoTried = false, recording = null;
    const headBox = h('div'), sumBox = h('div'), chatBox = h('div', { class: 'chat', 'aria-live': 'polite' }), compBox = h('div', { class: 'composer' });
    shell(h('div', null, h('p', null, h('a', { href: '#/tasks' }, '← All tasks')), headBox, sumBox, h('h2', null, 'Conversation'), chatBox, compBox), 'tasks');
    const isAssignee = function () { return task.role === 'assignee'; };

    function drawHead() {
      const due = UI.dueInfo(task.dueDate, task.status);
      const people = h('p', { class: 'muted' }, h('strong', null, 'From: '), task.creator.name + (task.creator.jobTitle ? ' (' + task.creator.jobTitle + ')' : ''), h('br'), h('strong', null, 'To: '), task.assignees.map(function (a) { return a.name; }).join(', '));
      const pct = h('div', { class: 'pct' }, task.progress + '%');
      const parts = [h('div', { class: 'head-grid' }, h('div', null, h('h1', null, task.title), h('div', { class: 'row' }, statusChip(task), due ? UI.chip(due.text, due.cls) : null, UI.chip('Started ' + UI.date(task.createdAt))), people, task.description ? h('p', { class: 'txt', style: 'white-space:pre-wrap' }, task.description) : null),
        h('div', null, pct, task.progressBy ? h('div', { class: 'muted small' }, 'Last set by ' + task.progressBy) : null)), UI.progressBar(task.progress, task.status)];

      if (isAssignee() && task.status !== 'closed') {
        const label = h('strong', null, task.progress + '%');
        const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: task.progress, 'aria-label': 'How much of the task is done' });
        slider.addEventListener('input', function () { dragging = true; label.textContent = slider.value + '%'; pct.textContent = slider.value + '%'; });
        slider.addEventListener('change', async function () {
          const v = Number(slider.value); dragging = false;
          if (v === task.progress) return;
          if (v === 100 && !(await UI.confirm('Mark as 100% done?', 'Your manager will be asked to confirm that the work is complete.', 'Yes, it is done'))) { slider.value = task.progress; label.textContent = task.progress + '%'; pct.textContent = task.progress + '%'; return; }
          await guarded(async function () { task = (await Api.call('setProgress', { taskId: id, progress: v })).task; await refresh(true); UI.toast(v === 100 ? 'Sent to your manager for approval' : 'Progress updated'); });
          drawHead();
        });
        parts.push(h('div', { class: 'slider-box' }, h('div', { class: 'row between' }, h('span', null, 'My progress: '), label), slider,
          h('div', { class: 'row between small muted' }, h('span', null, '0%'), h('span', null, 'Drag, then release to save'), h('span', null, '100%')),
          task.status === 'pending' ? h('p', { class: 'note' }, 'Waiting for your manager to approve. If you still have work to do, move the slider back.') : null));
      }
      if (task.role === 'creator' && task.status === 'pending') {
        parts.push(h('div', { class: 'banner pending', style: 'margin-top:.8rem' }, h('strong', null, 'Marked 100% complete. '), 'Please check the work and the conversation, then approve or send it back.',
          h('div', { class: 'row', style: 'margin-top:.6rem' },
            h('button', { class: 'btn ok', type: 'button', onclick: approve }, '✔ Agree & close task'), h('button', { class: 'btn', type: 'button', onclick: sendBack }, 'Send back for more work'))));
      }
      UI.clear(headBox); headBox.appendChild(h('div', { class: 'card' }, parts));
    }

    async function approve() {
      if (!(await UI.confirm('Close this task?', 'It will move to History with its full conversation. This cannot be undone.', 'Agree & close', 'ok'))) return;
      await guarded(async function () { await Api.call('approveTask', { taskId: id }, { timeout: 90000 }); UI.toast('Task closed and saved to History'); go('#/tasks'); });
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
      const stale = task.summaryStale && task.messageCount > 0;
      const btn = h('button', { class: 'btn small', type: 'button', disabled: summaryBusy, onclick: function () { runSummary(true); } }, summaryBusy ? 'Updating…' : (task.summary ? 'Refresh' : 'Create summary'));
      const card = summaryNode(task.summary, task.messageCount > 0 ? btn : null);
      if (summaryBusy) card.appendChild(h('p', { class: 'small muted' }, 'The AI is reading the conversation - this can take up to a minute.'));
      else if (summaryError) card.appendChild(h('p', { class: 'small', style: 'color:var(--bad)' }, summaryError));
      else if (stale && task.summary) card.appendChild(h('p', { class: 'small muted' }, 'New messages since this summary (' + UI.ago(task.summaryAt) + ').'));
      else if (task.summary && task.summaryAt) card.appendChild(h('p', { class: 'small muted' }, 'Updated ' + UI.ago(task.summaryAt) + '.'));
      sumBox.appendChild(card);
    }
    async function runSummary(force) {
      if (summaryBusy) return;
      summaryBusy = true; summaryError = ''; drawSummary();
      try { const r = await Api.call('refreshSummary', { taskId: id, force: !!force }, { timeout: 120000 }); task.summary = r.summary; task.summaryStale = false; task.summaryAt = Date.now(); }
      catch (e) { if (e.code !== 'AUTH') summaryError = e.message; }
      summaryBusy = false; drawSummary();
    }

    async function refresh(force) { apply(await Api.call('getTask', { taskId: id }), force); }
    function apply(d, force) {
      S.taskMem[id] = d;
      const newSig = d.messages.map(function (m) { return m.id + m.status + (m.transcript || '').length; }).join(',') + '|' + d.task.progress + d.task.status + d.task.summaryAt + d.task.summaryStale;
      if (!force && newSig === sig) return;
      const stick = !sig || nearBottom() || force;
      sig = newSig; task = d.task; messages = d.messages;
      if (!dragging) drawHead();
      drawSummary();
      renderChat(chatBox, messages, { taskId: id });
      if (stick) window.scrollTo(0, document.body.scrollHeight);
      if (!autoTried && task.role === 'creator' && task.summaryStale && task.messageCount > 0) { autoTried = true; runSummary(false); }
      // Opening the task marks it read on the server; mirror that in the saved task list so the blue dot goes away at once.
      const l = Api.cacheGet(listKey);
      if (l && l.tasks && l.tasks.some(function (t) { return t.id === id && t.unread; })) { l.tasks.forEach(function (t) { if (t.id === id) t.unread = false; }); Api.cacheSet(listKey, l); }
    }

    /* ---- composer ---- */
    function drawComposer() {
      UI.clear(compBox);
      const text = h('textarea', { placeholder: 'Write an update…', maxlength: 4000, rows: 1, 'aria-label': 'Message' });
      text.addEventListener('input', function () { text.style.height = '44px'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; text.style.overflowY = text.scrollHeight > 140 ? 'auto' : 'hidden'; });
      const send = h('button', { class: 'send', type: 'button', 'aria-label': 'Send message', onclick: sendText }, '➤');
      text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendText(); } });
      async function sendText() {
        const v = text.value.trim(); if (!v) return;
        send.disabled = true;
        try { await Api.call('postMessage', { taskId: id, text: v }); text.value = ''; text.style.height = '44px'; await refresh(true); }
        catch (e) { UI.toast(e.message, 'bad'); } finally { send.disabled = false; }
      }
      const mic = h('button', { class: 'mic', type: 'button', 'aria-label': 'Record a voice message', title: 'Record a voice message', onclick: startRecording }, '🎤');
      compBox.appendChild(h('div', { class: 'composer-in' }, mic, text, send));
    }

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
        h('button', { class: 'btn primary small', type: 'button', onclick: function () { session.stop(); } }, 'Send')));
      session.done.then(async function (r) {
        if (!r || recording !== session) return;   // cancelled
        recording = null; drawComposer();
        if (r.secs < 0.7) return UI.toast('That was too short.', 'bad');
        await sendVoice(r);
      });
    }

    async function sendVoice(r) {
      const temp = h('div', { class: 'msg me' }, h('div', { class: 'txt' }, '🎤 Sending voice message (' + UI.duration(r.secs) + ')… the transcript can take up to a minute.'));
      chatBox.appendChild(temp); window.scrollTo(0, document.body.scrollHeight);
      try {
        const payload = await Audio2.prepare(r.blob, r.secs);
        const res = await Api.call('postVoice', Object.assign({ taskId: id }, payload), { timeout: 170000 });
        if (res.transcribeFailed) UI.toast('Sent. The transcript could not be created, but people can play the audio.');
      } catch (e) { UI.toast(e.message, 'bad'); }
      temp.remove(); await refresh(true).catch(function () {});
    }

    drawComposer();
    if (freshData) apply(data, true);                       // just fetched: no second round trip
    else {
      drawHead();                                           // from this session / the task list; the server answer follows
      if (!data) chatBox.appendChild(h('p', { class: 'muted' }, 'Loading the conversation…'));
      else { drawSummary(); renderChat(chatBox, messages, { taskId: id }); sig = ''; }
      refresh(true).catch(function (e) { if (e.code !== 'AUTH' && !data) { UI.clear(chatBox); chatBox.appendChild(errBox(e)); } });
    }
    poll(function () { if (!dragging && !recording) refresh(false).catch(function () {}); }, 8000);
  }

  /* ============================== history ============================== */

  function viewHistory() {
    const q = h('input', { type: 'search', placeholder: 'Search closed tasks by title, person or summary…', 'aria-label': 'Search history' });
    const list = h('div');
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'History')), h('p', { class: 'muted' }, 'Tasks that were completed and approved, with their full conversation.'), q, h('div', { style: 'height:.8rem' }), list), 'history');
    let timer = null;
    async function load() {
      UI.clear(list); list.appendChild(h('p', { class: 'muted' }, 'Loading…'));
      try {
        const r = await Api.call('listHistory', { q: q.value, limit: 50 });
        UI.clear(list);
        if (!r.items.length) return list.appendChild(h('div', { class: 'card empty' }, q.value ? 'No closed tasks match your search.' : 'No closed tasks yet. Tasks appear here after the manager approves them.'));
        r.items.forEach(function (t) {
          list.appendChild(h('a', { class: 'card task', href: '#/history/' + t.id }, h('div', { class: 'title' }, t.title),
            h('div', { class: 'people' }, t.creatorName + ' → ' + t.assigneeNames), h('div', { class: 'meta' }, UI.chip('Started ' + UI.date(t.createdAt)), UI.chip('Completed ' + UI.date(t.closedAt), 'ok'), UI.chip(t.messageCount + ' message' + (t.messageCount === 1 ? '' : 's'))),
            t.summaryText ? h('div', { class: 'last' }, t.summaryText) : null));
        });
        if (r.total > r.items.length) list.appendChild(h('p', { class: 'muted small' }, 'Showing the latest ' + r.items.length + ' of ' + r.total + '. Use search to narrow down.'));
      } catch (e) { UI.clear(list); list.appendChild(errBox(e)); }
    }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 350); });
    load();
  }

  async function viewArchived(id) {
    shell(h('p', { class: 'muted' }, 'Loading from the archive…'), 'history');
    let doc;
    try { doc = await Api.call('getArchived', { taskId: id }, { timeout: 60000 }); }
    catch (e) { return shell(h('div', null, errBox(e), h('p', null, h('a', { href: '#/history' }, '← Back to history'))), 'history'); }
    const t = doc.task;
    const msgs = doc.messages.map(function (m) { return { id: m.id, senderId: m.senderId, senderName: m.senderName, senderTitle: '', type: m.type, text: m.text, transcript: m.transcript, translation: m.translation, status: m.status, hasAudio: !!m.audioFileId, audioSecs: m.audioSecs, createdAt: m.createdAt }; });
    const chat = h('div', { class: 'chat' });
    renderChat(chat, msgs, { archived: true, taskId: id });
    shell(h('div', null, h('p', null, h('a', { href: '#/history' }, '← History')),
      h('div', { class: 'card' }, h('h1', null, t.title), h('div', { class: 'row' }, UI.chip('Closed', 'ok'), UI.chip('Started ' + UI.dateTime(t.createdAt)), UI.chip('Completed ' + UI.dateTime(t.closedAt), 'ok')),
        h('p', { class: 'muted' }, h('strong', null, 'From: '), t.creator.name, h('br'), h('strong', null, 'To: '), t.assignees.map(function (a) { return a.name; }).join(', '), h('br'), h('strong', null, 'Approved by: '), t.approvedBy),
        t.description ? h('p', { style: 'white-space:pre-wrap' }, t.description) : null),
      t.summary && t.summary.summary_en ? summaryNode(t.summary) : null, h('h2', null, 'Conversation'), chat), 'history');
  }

  /* ============================== admin: users ============================== */

  async function viewUsers() {
    const box = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Users'), h('button', { class: 'btn primary', type: 'button', onclick: function () { editUser(null); } }, '+ Add user')), box), 'users');
    let ov;
    async function load() {
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      if (ov.jobTitles.length === 0) box.appendChild(h('div', { class: 'note' }, 'Start with ', h('a', { href: '#/admin/titles' }, 'Job titles'), ' (for example Chairman, Manager, Worker), then add users, then connect them in the ', h('a', { href: '#/admin/org' }, 'Org chart'), '.'));
      const card = h('div', { class: 'card' });
      ov.users.forEach(function (u) {
        card.appendChild(h('div', { class: 'list-row' }, h('span', { class: 'avatar' }, UI.initials(u.name)),
          h('div', { class: 'info' }, h('strong', null, u.name), h('span', { class: 'muted small' }, '@' + u.username + (u.lastLogin ? ' · last sign-in ' + UI.ago(u.lastLogin) : ' · never signed in'))),
          h('div', { class: 'row' }, u.jobTitle ? UI.chip(u.jobTitle + ' · L' + u.level) : null, u.isAdmin ? UI.chip('Admin', 'info') : null, !u.active ? UI.chip('Inactive', 'bad') : null, u.mustChange ? UI.chip('Temp password', 'warn') : null),
          h('button', { class: 'btn small', type: 'button', onclick: function () { editUser(u); } }, 'Edit')));
      });
      box.appendChild(card);
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
        h('label', { style: 'display:flex;gap:.5rem;align-items:center;color:var(--ink)' }, admin, 'Administrator (can manage users, job titles and the org chart)'),
        u ? h('label', { style: 'display:flex;gap:.5rem;align-items:center;color:var(--ink)' }, active, 'Account is active') : null,
        u ? h('p', null, h('button', { class: 'btn small', type: 'button', onclick: async function () {
          if (!(await UI.confirm('Reset password?', u.name + ' will be signed out and must use a new temporary password.', 'Reset password'))) return;
          await guarded(async function () { const r = await Api.call('adminResetPassword', { userId: u.id }); showTemp('Password reset', u, r.tempPassword); await load(); });
        } }, 'Reset password…')) : null);
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
    const box = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Job titles'), h('button', { class: 'btn primary', type: 'button', onclick: function () { editTitle(null); } }, '+ Add job title')),
      h('p', { class: 'muted' }, 'A job title belongs to a layer of the pyramid. Layer 1 is the top. People can only be connected to people in a lower layer.'), box), 'titles');
    let ov;
    async function load() {
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      if (!ov.jobTitles.length) return box.appendChild(h('div', { class: 'card empty' }, 'No job titles yet. Add the first one, for example "Chairman" at layer 1.'));
      const card = h('div', { class: 'card' });
      ov.jobTitles.forEach(function (t) {
        const n = ov.users.filter(function (u) { return u.jobTitleId === t.id; }).length;
        card.appendChild(h('div', { class: 'list-row' }, UI.chip('Layer ' + t.level, 'info'), h('div', { class: 'info' }, h('strong', null, t.title), h('span', { class: 'muted small' }, n + ' user' + (n === 1 ? '' : 's'))),
          h('button', { class: 'btn small', type: 'button', onclick: function () { editTitle(t); } }, 'Edit'),
          h('button', { class: 'btn small', type: 'button', onclick: async function () {
            if (!(await UI.confirm('Delete "' + t.title + '"?', 'This only works if no user has this job title.', 'Delete', 'danger'))) return;
            await guarded(async function () { await Api.call('adminDeleteJobTitle', { id: t.id }); UI.toast('Deleted'); await load(); });
          } }, 'Delete')));
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
    const box = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Org chart')),
      h('p', { class: 'muted' }, 'Draw arrows to decide who can give tasks to whom. An arrow from A to B means "A can assign tasks to B". People only see and assign to the people their arrows point to.'), box), 'org');
    async function load() {
      let ov;
      try { ov = await Api.call('adminOverview'); } catch (e) { UI.clear(box); return box.appendChild(errBox(e)); }
      UI.clear(box);
      const hasTitled = ov.users.some(function (u) { return u.level !== null; });
      if (!hasTitled) return box.appendChild(h('div', { class: 'card empty' }, 'Add job titles and users first, then come back to connect them.'));
      box.appendChild(OrgCanvas.create({ users: ov.users, links: ov.links, onSave: async function (links, note) { await Api.call('adminSaveLinks', { links: links, note: note }); await load(); } }));
      if (ov.versions.length) {
        box.appendChild(h('div', { class: 'card', style: 'margin-top:1rem' }, h('h3', null, 'Saved versions'),
          ov.versions.map(function (v) { return h('div', { class: 'list-row' }, UI.chip('v' + v.version), h('div', { class: 'info' }, h('strong', null, v.createdBy + ' · ' + v.linkCount + ' arrows'), h('span', { class: 'muted small' }, UI.dateTime(v.createdAt) + (v.note ? ' · ' + v.note : '')))); })));
      }
    }
    load();
  }

  /* ============================== account ============================== */

  function viewAccount() {
    const old = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div');
    const form = h('form', { onsubmit: async function (ev) {
      ev.preventDefault(); UI.clear(err);
      if (n1.value !== n2.value) return err.appendChild(errBox(new Error('The two new passwords do not match.')));
      try { await Api.call('changePassword', { oldPassword: old.value, newPassword: n1.value }); old.value = n1.value = n2.value = ''; UI.toast('Password changed. Other devices were signed out.'); }
      catch (e) { err.appendChild(errBox(e)); }
    } }, h('label', null, 'Current password', old), h('label', null, 'New password (at least 8 characters)', n1), h('label', null, 'Repeat new password', n2), h('button', { class: 'btn primary', type: 'submit', style: 'margin-top:1rem' }, 'Change password'), err);
    shell(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'My account')),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'avatar' }, UI.initials(S.user.name)), h('div', null, h('strong', null, S.user.name), h('div', { class: 'muted small' }, '@' + S.user.username + (S.user.jobTitle ? ' · ' + S.user.jobTitle : '') + (S.user.isAdmin ? ' · Administrator' : '')))),
        h('div', { style: 'margin-top:1rem' }, h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Sign out'), ' ', Api.demo ? h('button', { class: 'btn', type: 'button', onclick: function () { Demo.reset(); } }, 'Reset demo data') : null)),
      h('div', { class: 'card' }, h('h2', null, 'Change password'), form)), 'account');
  }

  /* ============================== router / boot ============================== */

  function route() {
    stopAudio(); stopTimers();
    if (!S.user) return showLogin();
    if (S.user.mustChange) return viewMustChange();
    const p = (location.hash || '#/tasks').slice(2).split('/');
    const adminOnly = function (fn) { return S.user.isAdmin ? fn() : go('#/tasks'); };
    switch (p[0]) {
      case 'tasks': return viewTasks();
      case 'new': return viewNewTask();
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
    mount(h('div', { class: 'center-box' }, h('h1', null, 'Task Manager'), h('div', { class: 'card' }, h('p', null, 'This site has not been connected to a backend yet.'),
      h('p', { class: 'muted' }, 'The administrator needs to put the backend address into js/config.js. You can look around with fake data in the demo:'), h('a', { class: 'btn primary', href: '?demo=1' }, 'Open the demo'))));
  }

  async function boot() {
    if (!Api.configured) return notConfigured();
    try {
      if (Api.demo) await Demo.init();
      Api.onAuthLost = function (msg) { S.user = null; showLogin(msg || 'Please sign in again.'); };
      if (Api.token) {
        const known = Api.cacheGet('me');
        if (known && known.user) {
          // Returning visitor: open straight into the app with the last known profile and check it in the background.
          S.user = known.user; S.company = known.company; S.canAssign = known.canAssign;
          const sig = function () { const u = S.user || {}; return [u.id, u.isAdmin, u.mustChange, u.jobTitleId, u.active, S.canAssign].join('|'); };
          const before = sig();
          loadMe().then(function () { if (S.user && sig() !== before) route(); }).catch(function () { /* AUTH is handled by Api.onAuthLost; offline keeps the cached view */ });
        } else {
          try { await loadMe(); }
          catch (e) { if (e.network) { mount(h('div', { class: 'center-box' }, h('h1', null, 'Offline'), errBox(e), h('button', { class: 'btn primary', style: 'margin-top:1rem', onclick: function () { location.reload(); } }, 'Try again'))); return; } Api.setToken(''); }
        }
      }
      window.addEventListener('hashchange', route);
      document.addEventListener('visibilitychange', function () { /* polling timers skip while hidden */ });
      route();
    } catch (e) { mount(h('div', { class: 'center-box' }, h('h1', null, 'Something went wrong'), errBox(e))); }
  }
  boot();
})();
