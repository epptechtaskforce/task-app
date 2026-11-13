/* assistant.js - the private secretary (chat + voice) and the "Today at a glance" card on the home page.
 * The assistant only PROPOSES actions. They are shown in plain words and run (through the normal, permission-checked
 * calls) only after the person says or taps "yes". All text is inserted with textContent (via h()), never as HTML. */
(function (w) {
  'use strict';
  const h = UI.h, icon = UI.icon;

  /* ============================== shared state (kept for this browser tab, wiped at sign-out) ============================== */
  const A = { uid: '', feed: [], pending: [], history: [], focusId: '', focusTitle: '', busy: false, rec: null, convo: false, active: false };
  const KEY = function () { return 'assist:' + A.uid; };
  function save() { try { sessionStorage.setItem(KEY(), JSON.stringify({ feed: A.feed.filter(function (f) { return f.k !== 'typing'; }).slice(-40), pending: A.pending, history: A.history.slice(-12) })); } catch (e) { /* storage blocked */ } }
  function load(uid) {
    if (A.uid === uid) return;
    A.uid = uid; A.feed = []; A.pending = []; A.history = [];
    try { const s = JSON.parse(sessionStorage.getItem(KEY()) || 'null'); if (s) { A.feed = s.feed || []; A.pending = s.pending || []; A.history = s.history || []; } } catch (e) { /* ignore */ }
  }
  function reset() {
    if (A.rec) { try { A.rec.cancel(); } catch (e) { /* ignore */ } }
    Speech.stop();
    try { if (A.uid) sessionStorage.removeItem(KEY()); } catch (e) { /* ignore */ }
    A.uid = ''; A.feed = []; A.pending = []; A.history = []; A.focusId = ''; A.busy = false; A.rec = null; A.convo = false;
  }

  const YES = /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|confirm|please do|that's right|correct)\b[\s.!]*$/i;
  const NO = /^(no|nope|cancel|stop|don't|do not|never mind|leave it)\b[\s.!]*$/i;

  /* ============================== the assistant page ============================== */

  function view(App, focusId) {
    const S = App.S, me = S.user;
    load(me.id);
    if (focusId) {
      A.focusId = focusId;
      const known = (Api.cacheGet('tasks:' + me.id) || {}).tasks || [];
      const t = known.filter(function (x) { return x.id === focusId; })[0];
      A.focusTitle = t ? t.title : 'this task';
    } else { A.focusId = ''; A.focusTitle = ''; }
    A.active = true;
    App.onLeave(function () { A.active = false; A.convo = false; Speech.stop(); if (A.rec) { try { A.rec.cancel(); } catch (e) { /* ignore */ } A.rec = null; } });

    const head = h('div', { class: 'assist-head' }), feedBox = h('div', { class: 'a-feed', 'aria-live': 'polite' }), actBox = h('div'), compBox = h('div', { class: 'a-composer' });
    App.shell(h('div', { class: 'assist' }, head, feedBox, actBox, compBox), 'assistant', { focus: true, back: '#/tasks', title: 'Assistant' });
    const scrollDown = function () { setTimeout(function () { window.scrollTo(0, document.body.scrollHeight); }, 30); };
    let text = null, levelBars = [], micBtn = null;

    /* ---- top bar: what it is about, voice replies, hands-free, new chat ---- */
    function drawHead() {
      UI.clear(head);
      head.appendChild(A.focusId
        ? h('span', { class: 'focus-chip' }, icon('tasks', 14), h('span', null, 'About: ' + A.focusTitle), h('button', { type: 'button', 'aria-label': 'Ask about everything instead', onclick: function () { A.focusId = ''; A.focusTitle = ''; drawHead(); drawFeed(); } }, icon('x', 14)))
        : h('strong', null, 'Ask me anything about your work'));
      const tools = h('div', { class: 'assist-tools' });
      if (Speech.supported) {
        const on = Speech.enabled();
        tools.appendChild(h('button', { type: 'button', class: 'tool-btn' + (on ? ' on' : ''), 'aria-pressed': on, title: 'Read the answers aloud', onclick: function () { Speech.setEnabled(!Speech.enabled()); if (!Speech.enabled()) A.convo = false; drawHead(); } }, icon(on ? 'volume' : 'volumeOff', 16), 'Voice replies'));
      }
      if (Audio2.supported()) {
        tools.appendChild(h('button', { type: 'button', class: 'tool-btn' + (A.convo ? ' on' : ''), 'aria-pressed': A.convo, title: 'Keep listening after each answer, like a phone call', onclick: function () {
          A.convo = !A.convo;
          if (A.convo) { if (!Speech.enabled()) Speech.setEnabled(true); if (!A.busy && !A.rec) startListening(); }
          else if (A.rec) A.rec.cancel();
          drawHead();
        } }, icon('mic', 16), 'Hands-free'));
      }
      if (A.feed.length) tools.appendChild(h('button', { type: 'button', class: 'tool-btn', title: 'Start a new conversation', onclick: function () { Speech.stop(); A.feed = []; A.pending = []; A.history = []; A.convo = false; save(); redraw(); } }, icon('refresh', 16), 'New chat'));
      head.appendChild(tools);
    }

    /* ---- the conversation ---- */
    function suggestions() {
      const out = [];
      if (A.focusId) {
        out.push(['Summarize this task so far', true], ['Is anything blocking it?', true], ['What do the shared files say?', true], ['Draft a short progress message for me', true]);
        return out;
      }
      out.push(['What needs my attention today?', true], ['Summarize all my ongoing tasks', true]);
      if (S.canAssign) {
        out.push(['Who is behind schedule?', true], ['What did my team report this week?', true]);
        const p = (Api.cacheGet('assignable') || [])[0];
        out.push(['Give ' + (p ? p.name.split(/\s+/)[0] : 'Ruwan') + ' a task to check the stock, due Friday', false]);
      } else {
        out.push(['What is due this week?', true], ['Set my progress on my first task to 50 percent', false]);
      }
      return out;
    }
    function drawFeed() {
      UI.clear(feedBox);
      if (!A.feed.length) {
        const first = String(me.name || '').split(/\s+/)[0];
        feedBox.appendChild(h('div', { class: 'a-welcome' }, h('div', { class: 'a-orb' }, icon('sparkles', 36)), h('h2', null, 'Hi' + (first ? ' ' + first : '') + ', how can I help?'),
          h('p', { class: 'muted' }, 'I know your tasks, conversations and files. Ask a question, or tell me what to do. You can type, or tap the microphone and talk.'),
          h('div', { class: 'a-chips' }, suggestions().map(function (s) {
            return h('button', { type: 'button', class: 'a-chip', onclick: function () { if (s[1]) ask({ text: s[0] }); else { text.value = s[0]; text.focus(); resize(); toggleSend(); } } }, s[0]);
          }))));
        return;
      }
      A.feed.forEach(function (f) {
        if (f.k === 'typing') return feedBox.appendChild(h('div', { class: 'a-msg bot typing', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')));
        if (f.k === 'done') return feedBox.appendChild(h('div', { class: 'a-done' + (f.bad ? ' bad' : '') }, f.text, f.link ? h('span', null, ' ', h('a', { href: '#/task/' + f.link }, 'Open')) : null));
        const el = h('div', { class: 'a-msg ' + (f.k === 'user' ? 'user' : 'bot') },
          f.voice ? h('div', { class: 'a-tag' }, icon('mic', 12), 'You said') : null, f.text,
          f.links && f.links.length ? h('div', { style: 'margin-top:.5rem;display:flex;gap:.4rem;flex-wrap:wrap' }, f.links.map(function (l) { return h('a', { class: 'btn small', href: '#/task/' + l.taskId }, icon('arrowRight', 14), l.label.replace(/^Open /, '')); })) : null);
        feedBox.appendChild(el);
      });
    }
    function drawActions() {
      UI.clear(actBox);
      if (!A.pending.length) return;
      actBox.appendChild(h('div', { class: 'a-act' }, h('h4', null, 'Waiting for your OK'),
        h('ul', null, A.pending.map(function (a) { return h('li', null, a.label); })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: confirmPending }, icon('check', 18), 'Yes, do it'),
          h('button', { class: 'btn', type: 'button', onclick: cancelPending }, 'No, cancel'),
          h('span', { class: 'muted small' }, 'or just say "yes"'))));
    }

    /* ---- the box at the bottom ---- */
    function resize() { text.style.height = '46px'; text.style.height = Math.min(text.scrollHeight, 130) + 'px'; text.style.overflowY = text.scrollHeight > 130 ? 'auto' : 'hidden'; }
    let sendBtn = null;
    function toggleSend() { if (sendBtn) sendBtn.classList.toggle('hidden', !text.value.trim()); if (micBtn) micBtn.classList.toggle('hidden', !!text.value.trim()); }
    function drawComposer() {
      UI.clear(compBox);
      if (A.rec) {
        levelBars = []; const lvl = h('div', { class: 'lvl', 'aria-hidden': 'true' });
        for (let i = 0; i < 28; i++) { const b = h('i'); levelBars.push(b); lvl.appendChild(b); }
        micBtn = h('button', { class: 'mic-big live', type: 'button', 'aria-label': 'Done speaking - send', title: 'Done speaking', onclick: function () { A.rec.stop(); } }, icon('send', 22));
        compBox.appendChild(h('div', { class: 'a-listen' }, h('span', { class: 'lbl' }, 'Listening…'), lvl,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cancel', title: 'Cancel', onclick: function () { A.convo = false; drawHead(); A.rec.cancel(); } }, icon('x', 20)), micBtn));
        compBox.appendChild(h('p', { class: 'a-hint' }, 'Speak naturally. I will answer when you pause.'));
        return;
      }
      text = h('textarea', { placeholder: A.pending.length ? 'Say or type "yes" to go ahead…' : 'Ask anything, or tap the microphone and talk…', maxlength: 1500, rows: 1, 'aria-label': 'Message to the assistant', disabled: A.busy });
      sendBtn = h('button', { class: 'send hidden', type: 'button', 'aria-label': 'Send', onclick: sendTyped }, icon('send', 20));
      micBtn = Audio2.supported() ? h('button', { class: 'mic-big', type: 'button', 'aria-label': 'Talk to the assistant', title: 'Tap and talk', disabled: A.busy, onclick: startListening }, icon('mic', 24)) : null;
      text.addEventListener('input', function () { resize(); toggleSend(); });
      text.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return;
        if (e.ctrlKey || e.metaKey || (!e.shiftKey && window.matchMedia && window.matchMedia('(pointer: fine)').matches)) { e.preventDefault(); sendTyped(); }
      });
      compBox.appendChild(h('div', { class: 'composer-in' }, text, micBtn, sendBtn));
      if (!Audio2.supported()) compBox.appendChild(h('p', { class: 'a-hint' }, 'Voice needs a newer browser (Chrome, Edge, Safari). You can still type.'));
      toggleSend();
    }
    function setLevel(v) {
      if (micBtn) micBtn.style.setProperty('--lv', v.toFixed(2));
      levelBars.forEach(function (b, i) { b.style.height = Math.max(10, Math.min(100, v * 100 * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + Date.now() / 140))) + 8)) + '%'; });
    }
    function redraw() { drawHead(); drawFeed(); drawActions(); drawComposer(); }

    /* ---- talking ---- */
    async function startListening() {
      if (A.busy || A.rec || !A.active) return;
      if (!Audio2.supported()) return UI.toast('Voice is not supported in this browser. You can type instead.', 'bad');
      Speech.stop();
      let rec;
      try { rec = await Audio2.listen({ maxSecs: 45, silenceMs: 1700, onLevel: setLevel }); }
      catch (e) { A.convo = false; drawHead(); return UI.toast(e.message, 'bad'); }
      A.rec = rec; drawComposer();
      const r = await rec.done;
      A.rec = null; if (!A.active) return;
      drawComposer();
      if (!r) return;                                                   // cancelled
      if (!r.heard || r.secs < 0.7) { A.convo = false; drawHead(); return UI.toast("I didn't hear anything. Tap the microphone and try again.", 'bad'); }
      ask({ audio: await Audio2.prepareLite(r.blob, r.secs) });
    }
    function sendTyped() { const v = text.value.trim(); if (!v || A.busy) return; text.value = ''; resize(); ask({ text: v }); }
    function speakReply(reply) {
      const again = function () { if (A.convo && A.active && !A.busy && !A.rec) setTimeout(startListening, 350); };
      if (Speech.enabled() && Speech.supported) Speech.speak(reply, { onend: again }); else again();
    }

    async function ask(o) {
      if (A.busy) return;
      Speech.stop();
      // "yes" / "no" typed while something is waiting: no need to ask the server
      if (o.text && A.pending.length) {
        if (YES.test(o.text)) { A.feed.push({ k: 'user', text: o.text }); return confirmPending(); }
        if (NO.test(o.text)) { A.feed.push({ k: 'user', text: o.text }); return cancelPending(); }
      }
      A.busy = true;
      const userItem = o.text ? { k: 'user', text: o.text } : { k: 'user', text: 'Listening to what you said…', voice: true };
      A.feed.push(userItem, { k: 'typing' }); redraw(); scrollDown();
      let reply = '';
      try {
        const payload = Object.assign({ history: A.history.slice(-10), pending: A.pending.map(function (p) { return p.label; }), taskId: A.focusId || undefined, text: o.text || undefined }, o.audio || {});
        const r = await Api.call('assistant', payload, { timeout: 120000 });
        A.feed = A.feed.filter(function (f) { return f.k !== 'typing'; });
        if (userItem.voice) userItem.text = r.heard || '(I could not make out what you said)';
        reply = r.reply;
        A.history.push({ role: 'user', text: r.heard || o.text || '' }, { role: 'assistant', text: r.reply });
        const free = (r.actions || []).filter(function (a) { return !a.needsConfirm; }), needs = (r.actions || []).filter(function (a) { return a.needsConfirm; });
        A.feed.push({ k: 'bot', text: r.reply, links: free.map(function (a) { return { taskId: a.taskId, label: a.label }; }) });
        if (needs.length) A.pending = needs;
        else if (r.confirm === 'no') A.pending = [];
        A.busy = false;
        if (r.confirm === 'yes' && A.pending.length) { const todo = A.pending; A.pending = []; redraw(); await runActions(todo); reply = ''; }   // runActions already said "Done"
      } catch (e) {
        A.feed = A.feed.filter(function (f) { return f.k !== 'typing'; });
        if (userItem.voice) userItem.text = '(voice message)';
        if (e.code === 'AUTH') { A.busy = false; return; }
        reply = e.message || 'Something went wrong. Please try again.';
        A.feed.push({ k: 'bot', text: reply });
        A.convo = false;
      }
      A.busy = false; save(); redraw(); scrollDown();
      if (reply) speakReply(reply);
    }

    /* ---- doing what was agreed ---- */
    async function runActions(list) {
      A.busy = true; drawComposer();
      let done = 0, big = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        try {
          if (a.type === 'create_task') { const r = await Api.call('createTask', { title: a.title, description: a.description, dueDate: a.dueDate, assigneeIds: a.assigneeIds }); A.feed.push({ k: 'done', text: 'Created "' + r.task.title + '".', link: r.task.id }); big = true; }
          else if (a.type === 'set_progress') { await Api.call('setProgress', { taskId: a.taskId, progress: a.progress }); A.feed.push({ k: 'done', text: 'Done: ' + a.label, link: a.taskId }); if (a.progress === 100) big = true; }
          else if (a.type === 'post_message') { await Api.call('postMessage', { taskId: a.taskId, text: a.text }); A.feed.push({ k: 'done', text: 'Done: ' + a.label, link: a.taskId }); }
          else if (a.type === 'approve_task') { await Api.call('approveTask', { taskId: a.taskId }, { timeout: 90000 }); A.feed.push({ k: 'done', text: 'Done: ' + a.label + '. It is now in History.' }); big = true; }
          else if (a.type === 'send_back') { await Api.call('rejectTask', { taskId: a.taskId, note: a.note }); A.feed.push({ k: 'done', text: 'Done: ' + a.label, link: a.taskId }); }
          else if (a.type === 'update_task') { await Api.call('updateTask', Object.assign({ taskId: a.taskId }, a.patch)); A.feed.push({ k: 'done', text: 'Done: ' + a.label, link: a.taskId }); }
          done++;
        } catch (e) {
          if (e.code === 'AUTH') return;
          A.feed.push({ k: 'done', bad: true, text: 'Could not do "' + a.label + '": ' + (e.message || 'something went wrong') });
        }
      }
      if (done) { App.invalidate(); if (big) UI.confetti(); }
      A.busy = false; save(); redraw(); scrollDown();
      if (done) speakReply(done === list.length ? 'Done.' : 'Some of that is done, but not everything. Please check the messages.');
    }
    async function confirmPending() { if (!A.pending.length || A.busy) return; const todo = A.pending; A.pending = []; redraw(); await runActions(todo); }
    function cancelPending() { A.pending = []; A.feed.push({ k: 'bot', text: 'Okay, I will not do that.' }); save(); redraw(); scrollDown(); if (Speech.enabled()) speakReply('Okay.'); }

    redraw(); scrollDown();
    if (A.feed.length === 0 && !focusId) Profiles.refresh();
  }

  /* ============================== "Today at a glance" ============================== */

  function briefingCard(App) {
    const box = h('section', { class: 'brief', 'aria-label': 'Today at a glance' }), key = 'brief:' + App.S.user.id;
    let data = Api.cacheGet(key) || null, busy = false, failed = '', listening = false;
    function say() {
      if (listening) { Speech.stop(); listening = false; return draw(); }
      if (!data) return;
      listening = true; draw();
      Speech.speak([data.briefing.headline].concat(data.briefing.items.map(function (i) { return i.text; })).join('. '), { onend: function () { listening = false; draw(); } });
    }
    function draw() {
      UI.clear(box);
      const b = data && data.briefing;
      box.appendChild(h('div', { class: 'brief-head' }, h('span', { class: 'sum-ico' }, icon('sparkles', 16)), h('span', { class: 'grow' }, 'Today at a glance'),
        b && Speech.supported ? h('button', { class: 'icon-btn', type: 'button', title: listening ? 'Stop reading' : 'Read it to me', 'aria-label': listening ? 'Stop reading' : 'Read it to me', onclick: say }, icon(listening ? 'stop' : 'volume', 18)) : null,
        h('button', { class: 'icon-btn', type: 'button', title: 'Update', 'aria-label': 'Update the overview', disabled: busy, onclick: function () { load(true); } }, icon('refresh', 18))));
      if (!b) {
        box.appendChild(failed
          ? h('p', { class: 'brief-headline' }, failed)
          : h('div', { style: 'margin:.7rem 0' }, h('div', { class: 'skel line w60' }), h('div', { class: 'skel line' }), h('div', { class: 'skel line w40' })));
      } else {
        box.appendChild(h('p', { class: 'brief-headline' }, b.headline));
        if (b.items.length) box.appendChild(h('ul', { class: 'brief-items' }, b.items.map(function (i, n) {
          return h('li', null, i.taskId ? h('a', { class: 'bi tone-' + i.tone, href: '#/task/' + i.taskId, style: '--i:' + n }, h('span', { class: 'dot' }), h('span', null, i.text)) : h('div', { class: 'bi tone-' + i.tone, style: '--i:' + n }, h('span', { class: 'dot' }), h('span', null, i.text)));
        })));
      }
      box.appendChild(h('div', { class: 'brief-foot' },
        h('a', { class: 'btn primary small', href: '#/assistant' }, icon('mic', 16), 'Ask me anything'),
        busy && b ? h('span', { class: 'brief-note' }, 'Updating…') : data && data.at ? h('span', { class: 'brief-note' }, (data.stale ? 'New activity since · ' : '') + 'Updated ' + UI.ago(data.at)) : null));
    }
    async function load(force) {
      if (busy) return;
      busy = true; failed = ''; draw();
      try {
        const r = await Api.call('briefing', { force: !!force }, { timeout: 120000 });
        data = { briefing: r.briefing, at: r.at, stale: r.stale }; Api.cacheSet(key, data);
      } catch (e) { if (e.code !== 'AUTH' && !data) failed = e.message || 'The overview is not available right now.'; else if (e.code !== 'AUTH') UI.toast(e.message, 'bad'); }
      busy = false; draw();
    }
    App.onLeave(function () { if (listening) Speech.stop(); });
    draw();
    return { el: box, load: load };
  }

  w.Assistant = { view: view, briefingCard: briefingCard, reset: reset };
})(window);
