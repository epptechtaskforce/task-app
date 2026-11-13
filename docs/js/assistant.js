/* assistant.js - the AI bubble.
 * One round bubble floats over every screen. Tap it and talk: your question and the answer float next to it (only the last two),
 * the app stays visible behind. Touching the screen elsewhere does NOT close the chat. Tap the bubble to tuck the chat away
 * (minimise) and tap it again to pop it up and start listening. Nothing of the earlier conversation is shown (the assistant just
 * remembers it, so you can carry on); a small Clear button next to the chat forgets it. The open chat can be dragged by touching
 * it (the bubble comes along); touching the background behind it works as normal (scrolling, tapping).
 * Drag the bubble anywhere you like.
 * The assistant only PROPOSES actions (post a message, set progress, create a task...). They are shown in a small card
 * (Send / Edit / Delete for a message) and run, through the normal permission-checked calls, only after the person agrees.
 * All text is inserted with textContent (via h()), never as HTML.
 * Also here: the "Today at a glance" card on the home page and the voice settings. */
(function (w) {
  'use strict';
  const h = UI.h, icon = UI.icon;
  const SIZE = 58, POS_KEY = 'aibub.pos';
  const YES = /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|send it|send|confirm|please do|that's right|correct)\b[\s.!]*$/i;
  const NO = /^(no|nope|cancel|stop|delete|delete it|don't|do not|never mind|leave it)\b[\s.!]*$/i;

  /* ============================== state (kept for this browser tab, wiped at sign-out) ============================== */
  const B = { recog: null, App: null, uid: '', built: false, fab: null, stack: null, typer: null, input: null, userEl: null, botEl: null, card: null, live: false, bars: [],
    history: [], pending: [], busy: false, rec: null, token: 0, lastVoice: false, min: false, unseen: false, tools: null, where: { task: '', archived: '' }, pos: null, typing: false, editing: false };
  const store = {
    load: function () { try { const v = JSON.parse(sessionStorage.getItem('aib:' + B.uid) || 'null'); if (v) { B.history = v.history || []; B.pending = v.pending || []; } } catch (e) { /* ignore */ } },
    save: function () { try { sessionStorage.setItem('aib:' + B.uid, JSON.stringify({ history: B.history.slice(-12), pending: B.pending })); } catch (e) { /* storage blocked */ } }
  };

  /* ============================== building the bubble ============================== */
  function build() {
    B.fab = h('button', { class: 'aib-fab', type: 'button', 'aria-label': 'AI assistant. Tap and speak. Drag to move.', title: 'Tap and ask me. Drag to move me.' },
      h('span', { class: 'aib-orb' }, icon('sparkles', 26), h('span', { class: 'aib-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i'))), h('i', { class: 'aib-dot' }));
    B.stack = h('div', { class: 'aib-stack', 'aria-live': 'polite' });
    B.input = h('input', { type: 'text', maxlength: 1500, placeholder: 'Type to the assistant…', 'aria-label': 'Message to the assistant', autocomplete: 'off' });
    B.typer = h('form', { class: 'aib-typer hidden', onsubmit: function (e) { e.preventDefault(); const v = B.input.value.trim(); if (!v) return; B.input.value = ''; closeTyper(); ask({ text: v }); } },
      B.input, h('button', { type: 'submit', class: 'aib-send', 'aria-label': 'Send' }, icon('send', 20)));
    // two small buttons tied to the AI bubble: type instead of speaking, and clear (forget) the conversation. Asking by voice is done by tapping the bubble.
    B.tools = h('div', { class: 'aib-tools' },
      h('button', { type: 'button', class: 'aib-tb', title: 'Type instead', 'aria-label': 'Type instead', onclick: function () { switchToTyping(); } }, icon('edit', 15)),
      h('button', { type: 'button', class: 'aib-tb clr', title: 'Clear this conversation', 'aria-label': 'Clear this conversation', onclick: clearConversation }, icon('trash', 14), 'Clear'));
    B.stack.appendChild(B.tools);
    document.body.appendChild(B.stack); document.body.appendChild(B.typer); document.body.appendChild(B.fab);
    wireDrag(); wireStackDrag(); layout();
    window.addEventListener('resize', layout);
    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(document.documentElement);   // a scrollbar appearing changes the width too
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && shown() && !document.querySelector('.overlay')) minimize(); });
    B.built = true;
  }

  /* ---- position: drag it anywhere; it remembers where you left it ---- */
  const vwOf = function () { return document.documentElement.clientWidth || innerWidth; };   // without the scrollbar
  function clampPos(p) { return { x: Math.max(6, Math.min(vwOf() - SIZE - 6, p.x)), y: Math.max(6, Math.min(innerHeight - SIZE - 6, p.y)) }; }
  function getPos() {
    if (!B.pos) {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* ignore */ }
      B.pos = saved && typeof saved.fx === 'number' ? { x: saved.fx * (vwOf() - SIZE), y: saved.fy * (innerHeight - SIZE) } : { x: vwOf() - SIZE - 14, y: innerHeight - SIZE - 190 };
    }
    return (B.pos = clampPos(B.pos));
  }
  function savePos() { try { const p = getPos(); localStorage.setItem(POS_KEY, JSON.stringify({ fx: p.x / Math.max(1, vwOf() - SIZE), fy: p.y / Math.max(1, innerHeight - SIZE) })); } catch (e) { /* storage blocked */ } }
  function layout() {
    if (!B.built) return;
    const p = getPos(), vw = vwOf(), vh = innerHeight, W = Math.min(vw - 24, 340);
    B.fab.style.left = p.x + 'px'; B.fab.style.top = p.y + 'px';
    const right = p.x + SIZE / 2 > vw / 2, above = p.y + SIZE / 2 > vh / 2;
    // the stack spans the screen: your side (picture + words) sits at the edge opposite the bubble, the AI's words hug its bubble
    B.stack.style.width = (vw - 24) + 'px'; B.stack.style.left = '12px';
    B.stack.style.setProperty('--aib-w', W + 'px');
    B.stack.style.setProperty('--aib-edge', (right ? Math.max(0, vw - 12 - (p.x + SIZE)) : Math.max(0, p.x - 12)) + 'px');
    B.stack.style.setProperty('--tx', (p.x + SIZE / 2 - 12) + 'px'); B.stack.style.setProperty('--tdx', right ? '-9px' : '9px');
    if (above) { B.stack.style.top = 'auto'; B.stack.style.bottom = (vh - p.y + 26) + 'px'; B.stack.style.maxHeight = Math.max(120, p.y - 40) + 'px'; }
    else { B.stack.style.bottom = 'auto'; B.stack.style.top = (p.y + SIZE + 26) + 'px'; B.stack.style.maxHeight = Math.max(120, vh - p.y - SIZE - 40) + 'px'; }
    B.stack.style.setProperty('--aib-max', Math.max(150, parseInt(B.stack.style.maxHeight, 10) - 84) + 'px');   // room left for the answer (the question takes about 70px)
    B.fab.classList.toggle('tag-left', right);
    B.stack.classList.toggle('above', above); B.stack.classList.toggle('below', !above); B.stack.classList.toggle('right', right); B.stack.classList.toggle('left', !right);
  }
  function wireDrag() {
    let d = null;
    B.fab.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      const p = getPos(); d = { sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
      try { B.fab.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    B.fab.addEventListener('pointermove', function (e) {
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 7) { d.moved = true; B.fab.classList.add('drag'); }
      if (d.moved) { B.pos = clampPos({ x: d.ox + dx, y: d.oy + dy }); layout(); }
    });
    B.fab.addEventListener('pointerup', function (e) {
      if (!d) return;
      const moved = d.moved; d = null; B.fab.classList.remove('drag');
      try { B.fab.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (moved) savePos(); else tap();
    });
    B.fab.addEventListener('pointercancel', function () { d = null; B.fab.classList.remove('drag'); });
    B.fab.addEventListener('click', function (e) { if (e.detail === 0) tap(); });   // keyboard: Enter / Space
  }

  // The open conversation can be moved by touching it (the bubble comes along, as they belong together). Touches on the
  // background around it are not caught by the chat at all, so the page behind scrolls and taps as usual.
  function wireStackDrag() {
    B.stack.addEventListener('pointerdown', function (e) {
      if (e.button || !e.target.closest) return;
      if (!e.target.closest('.aib-msg, .aib-dp, .aib-card-head, .aib-card-text') || e.target.closest('button, a, input, textarea')) return;
      const p = getPos(), d = { sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
      const move = function (ev) {
        const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) > 7) { d.moved = true; B.fab.classList.add('drag'); B.stack.classList.add('dragging'); }
        if (d.moved) { B.pos = clampPos({ x: d.ox + dx, y: d.oy + dy }); layout(); }
      };
      const end = function () {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end);
        B.fab.classList.remove('drag'); B.stack.classList.remove('dragging'); if (d.moved) savePos();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
    });
  }

  /* ============================== the two floating messages ============================== */
  function active() { return !!(B.botEl || B.typing || B.rec || B.live); }
  // (there is no bubble for what you say: only the AI's words are shown; B.live = the assistant is listening to you right now)
  function hasConvo() { return !!(B.botEl || B.card || B.live); }
  function shown() { return B.built && !B.min && (hasConvo() || B.typing || !!B.rec); }
  // keeps the small tools row and the speech-bubble tail in step with what is on screen
  function sync() {
    if (!B.built) return;
    B.stack.classList.toggle('has', hasConvo());
    B.stack.classList.toggle('min', B.min);
  }
  function bubbleEl(kind, content) { return h('div', { class: 'aib-msg ' + kind }, content); }
  function dissolve(el) { if (!el || !el.parentNode) return; el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 380); }
  // The assistant's words: a small name tag, then the text laid out in lines (lines starting with "- " become bullets) with the
  // words fading in one after another, so it feels like it is speaking. Very long answers skip the per-word effect.
  function botCard(text) {
    const lines = String(text).split('\n').filter(function (l) { return l.trim(); });
    const total = String(text).split(/\s+/).length, fancy = total <= 140, step = Math.max(14, Math.min(46, 1500 / Math.max(1, total)));
    let n = 0;
    const body = h('div', { class: 'aib-body' }, lines.map(function (line) {
      const bullet = /^\s*[-•]\s+/.test(line), note = /^\(Note:/.test(line.trim()), words = line.replace(/^\s*[-•]\s+/, '').split(/(\s+)/);
      const span = h('span', { class: 'txt' }, fancy ? words.map(function (w) {
        return /^\s*$/.test(w) ? document.createTextNode(w || '') : h('span', { class: 'w', style: 'animation-delay:' + Math.min(Math.round(n++ * step), 1800) + 'ms' }, w);
      }) : line.replace(/^\s*[-•]\s+/, ''));
      return h('div', { class: 'aib-line' + (bullet ? ' li' : '') + (note ? ' note' : '') }, bullet ? h('i', { class: 'pt' }) : null, span);
    }));
    return [h('div', { class: 'aib-who' }, h('span', { class: 'aib-mini' }, icon('sparkles', 11)), 'Assistant'), body];
  }
  function putBot(content, typing) {
    if (typeof content === 'string') content = botCard(content);
    const old = B.botEl; B.botEl = bubbleEl('bot' + (typing ? ' typing' : ''), content);
    if (old) old.remove();
    B.stack.insertBefore(B.botEl, B.stack.firstChild); sync(); return B.botEl;
  }
  function clearMessages() { dissolve(B.userEl); dissolve(B.botEl); B.userEl = null; B.botEl = null; sync(); }
  // Stops listening / speaking / typing and removes the messages. The remembered conversation (B.history) is untouched.
  function endSession() {
    B.token++;                                              // anything still on its way is ignored
    if (B.rec) { try { B.rec.cancel(); } catch (e) { /* ignore */ } B.rec = null; }
    if (B.recog) { B.recog.abort(); B.recog = null; }
    B.busy = false; B.live = false; B.fab.classList.remove('listening', 'busy', 'unread'); Speech.stop(); closeTyper(true);
    B.min = false; clearMessages();
    if (B.App && B.App.clearSpot) B.App.clearSpot();
  }
  // Tuck the chat away. The conversation stays exactly as it is (an answer still on its way arrives quietly: the bubble shows a dot).
  function minimize() {
    if (!B.built || B.min) return;
    Speech.stop(); closeTyper(true);
    if (B.rec || B.recog || B.fab.classList.contains('listening') || B.live) {          // it was only listening: stop that, nothing was asked yet
      B.token++;
      if (B.rec) { try { B.rec.cancel(); } catch (e) { /* ignore */ } B.rec = null; }
      if (B.recog) { B.recog.abort(); B.recog = null; }
      B.fab.classList.remove('listening'); B.fab.style.setProperty('--lv', 0);
      B.live = false;
    }
    if (B.App && B.App.clearSpot) B.App.clearSpot();
    B.min = true; sync();
  }
  function restore() { if (!B.built) return; B.min = false; B.unseen = false; B.fab.classList.remove('unread'); sync(); layout(); }
  // Forget this conversation completely: what is on screen, what the assistant remembers of it, and any draft waiting for an OK.
  function clearConversation() {
    B.pending = []; B.history = []; B.editing = false; drawCard();
    endSession(); store.save();
    UI.toast('Conversation cleared');
  }

  /* ============================== talking ============================== */
  function setLevel(v) {
    B.fab.style.setProperty('--lv', v.toFixed(2));
  }
  // Tap on the bubble: chat showing -> tuck it away; otherwise it pops up AND starts listening. The earlier conversation stays in the
  // assistant's memory (so you can simply carry on), and only its last message is still in view.
  function tap() {
    Speech.unlock();
    if (shown()) return minimize();
    startListening();
  }
  function startListening() {
    Speech.unlock();
    const wasMin = B.min, unseen = B.unseen;
    restore();
    if (B.App && B.App.clearSpot) B.App.clearSpot();
    Speech.stop(); closeTyper(true);
    if (B.rec) { try { B.rec.cancel(); } catch (e) { /* ignore */ } B.rec = null; }
    if (B.recog) { B.recog.abort(); B.recog = null; }
    if (wasMin) {                                           // popping up again: the earlier messages are remembered, not shown
      if (B.botEl && !unseen) { B.botEl.remove(); B.botEl = null; }   // (an answer that came while it was tucked away is still shown once)
      sync();
    }
    listen(true);
  }
  /* ---- the phone's own speech recognition (English): instant words, no upload ---- */
  const speechCtor = function () { return w.SpeechRecognition || w.webkitSpeechRecognition; };
  const onIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPhones cannot record and recognise at the same time
  function quickOn() { try { return localStorage.getItem('taskapp.quick') !== 'off'; } catch (e) { return true; } }
  function startRecognizer(onWords) {
    const Ctor = speechCtor();
    if (!Ctor || onIOS || !quickOn()) return null;
    let r; try { r = new Ctor(); } catch (e) { return null; }
    r.lang = 'en-IN'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
    const st = { text: '', conf: [], failed: false, finished: null };
    st.finished = new Promise(function (res) { r.onend = function () { res(); }; });
    r.onerror = function () { st.failed = true; };                            // no speech / blocked / no network: the sound is used instead
    r.onresult = function (e) {
      let fin = '', interim = ''; const conf = [];
      for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) { fin += x[0].transcript + ' '; conf.push(x[0].confidence); } else interim += x[0].transcript; }
      st.text = (fin + interim).trim(); st.conf = conf; onWords(st.text);
    };
    st.confidence = function () { return st.conf.length ? st.conf.reduce(function (a, b) { return a + b; }, 0) / st.conf.length : 0.8; };   // not reported for unfinished words: trust it
    st.stop = function () { try { r.stop(); } catch (e) { /* ignore */ } };
    st.abort = function () { try { r.abort(); } catch (e) { /* ignore */ } };
    try { r.start(); } catch (e) { return null; }
    return st;
  }
  // keep: leave the assistant's last message on screen while listening for the answer to its question
  async function listen(keep) {
    if (!Audio2.supported()) return openTyper();
    const my = ++B.token; B.busy = false;
    B.live = true; sync();                                  // the tools row (type / clear) shows while it listens
    B.fab.classList.add('listening');                       // the AI bubble shows right away that it is listening
    let rec;
    // The phone's own speech recognition listens alongside: when its words look good they are
    // sent instead of the sound (no upload, no audio processing: much faster). The sound is the fallback.
    const recog = startRecognizer(function () { /* the words are not shown: only used for the question */ });
    B.recog = recog;
    const stopRecog = function () { if (recog) recog.abort(); if (B.recog === recog) B.recog = null; };
    try { rec = await Audio2.listen({ maxSecs: 45, silenceMs: recog ? 1100 : 1400, onLevel: setLevel }); }
    catch (e) { stopRecog(); if (my !== B.token) return; B.fab.classList.remove('listening'); B.live = false; putBot(e.message || 'I could not use the microphone.'); return; }
    if (my !== B.token) { stopRecog(); try { rec.cancel(); } catch (e) { /* ignore */ } return; }
    B.rec = rec; B.fab.classList.add('listening');
    const r = await rec.done;
    B.rec = null; B.live = false; B.fab.classList.remove('listening'); B.fab.style.setProperty('--lv', 0);
    if (my !== B.token) { stopRecog(); return; }
    if (!r) { stopRecog(); B.live = false; sync(); return; }                       // cancelled
    if (!r.heard || r.secs < 0.7) { stopRecog(); B.live = false; sync(); if (!B.botEl) putBot("I didn't hear anything. Tap me and try again."); return; }   // an earlier answer stays in view
    let words = '';
    if (recog) {
      recog.stop(); await Promise.race([recog.finished, new Promise(function (res) { setTimeout(res, 500); })]);
      if (B.recog === recog) B.recog = null;
      if (my !== B.token) return;
      words = recog.failed ? '' : recog.text;
    }
    if (recog && words.length >= 2 && recog.confidence() >= 0.5) return ask({ text: words.charAt(0).toUpperCase() + words.slice(1), voice: true }, my);
    ask({ audio: await Audio2.prepareLite(r.blob, r.secs) }, my);
  }
  function openTyper() { B.typing = true; B.typer.classList.remove('hidden'); setTimeout(function () { B.input.focus(); }, 30); }
  function closeTyper(quiet) { B.typing = false; B.typer.classList.add('hidden'); if (!quiet) B.input.blur(); }
  function switchToTyping() { B.token++; if (B.rec) { try { B.rec.cancel(); } catch (e) { /* ignore */ } B.rec = null; } B.fab.classList.remove('listening'); B.live = false; sync(); openTyper(); }

  async function ask(o, mine) {
    const my = mine || ++B.token;
    Speech.unlock(); Speech.stop();
    // "yes" / "no" typed while something waits for an OK: no need to ask the server
    if (o.text && B.pending.length) {
      if (YES.test(o.text)) return confirmPending();
      if (NO.test(o.text)) return cancelPending();
    }
    B.busy = true; B.lastVoice = !!(o.audio || o.voice); B.fab.classList.add('busy');
    // no bouncing dots: the AI bubble itself shows a small spinning ring and "Thinking…" while it works
    B.live = false;                                                        // what you said or typed is never shown: only the answer is
    dissolve(B.botEl); B.botEl = null; sync();
    let r;
    try {
      const payload = Object.assign({ history: B.history.slice(-10), pending: B.pending.map(function (p) { return p.label; }), taskId: B.where.task || undefined, archivedId: B.where.archived || undefined, text: o.text || undefined }, o.audio || {});
      r = await Api.call('assistant', payload, { timeout: o.audio ? 50000 : 40000 });   // a firm limit: never wait forever
    } catch (e) {
      if (my !== B.token) return;
      B.busy = false; B.fab.classList.remove('busy');
      if (e.code === 'AUTH') return;
      return putBot(e.message || 'Something went wrong. Please try again.');
    }
    if (my !== B.token) return;                                                     // the person moved on
    B.busy = false; B.fab.classList.remove('busy');
    if (B.min) { B.fab.classList.add('unread'); B.unseen = true; }
    const heard = r.heard || o.text || '';
    B.history.push({ role: 'user', text: heard }, { role: 'assistant', text: r.reply });
    const acts = r.actions || [], free = acts.filter(function (a) { return !a.needsConfirm; }), needs = acts.filter(function (a) { return a.needsConfirm; });
    if (needs.length) { B.pending = needs; B.editing = false; drawCard(); } else if (r.confirm === 'no') { B.pending = []; drawCard(); }
    store.save();
    if (r.confirm === 'yes' && B.pending.length) return confirmPending();           // it says "Done" itself
    putBot(r.reply);
    free.forEach(function (a) { if (a.type === 'show_page') B.App.showPage(a); else openTask(a); });
    say(String(r.reply).split('\n\n(Note:')[0], my, r.reply);          // the whole answer is read aloud, word for word
  }
  function say(text, my, shown) {
    const again = function () {                                                      // it asked something: listen for the answer
      if (my === B.token && !B.min && B.lastVoice && !B.busy && !B.rec && B.botEl && (/\?\s*$/.test(shown || '') || B.pending.length)) setTimeout(function () { if (my === B.token) listen(true); }, 300);
    };
    if (B.lastVoice && !B.min && Speech.enabled() && Speech.supported) Speech.speak(text, { onend: again }); else again();
  }
  function openTask(a) {
    if (!B.App) return;
    if (a.archived || a.mode === 'enter') B.App.go((a.archived ? '#/history/' : '#/task/') + a.taskId);
    else B.App.showTask(a.taskId);
  }

  /* ============================== the card: Send / Edit / Delete a message, or yes / no for other actions ============================== */
  function drawCard() {
    if (B.card) { B.card.remove(); B.card = null; sync(); }
    if (!B.pending.length) return;
    const one = B.pending.length === 1 ? B.pending[0] : null;
    const card = h('div', { class: 'aib-card' });
    if (one && one.type === 'post_message') {
      const title = (/^Post this in "([^"]*)"/.exec(one.label) || [])[1] || 'this task';
      card.appendChild(h('div', { class: 'aib-card-head' }, icon('send', 14), h('span', null, 'Message for “' + title + '”')));
      if (B.editing) {
        const ta = h('textarea', { maxlength: 4000, rows: 3, 'aria-label': 'Edit the message' }); ta.value = one.text;
        card.appendChild(ta);
        card.appendChild(h('div', { class: 'aib-card-actions' },
          h('button', { class: 'btn primary small', type: 'button', onclick: function () { const t = ta.value.trim(); if (!t) return; one.text = t; one.label = 'Post this in "' + title + '": "' + (t.length > 140 ? t.slice(0, 140) : t) + '"'; B.editing = false; store.save(); drawCard(); } }, icon('check', 16), 'Save'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { B.editing = false; drawCard(); } }, 'Cancel')));
        setTimeout(function () { ta.focus(); }, 30);
      } else {
        card.appendChild(h('div', { class: 'aib-card-text' }, one.text));
        card.appendChild(h('div', { class: 'aib-card-actions' },
          h('button', { class: 'btn primary small', type: 'button', onclick: confirmPending }, icon('send', 16), 'Send'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { B.editing = true; drawCard(); } }, icon('edit', 16), 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: cancelPending }, icon('trash', 16), 'Delete')));
      }
    } else {
      card.appendChild(h('div', { class: 'aib-card-head' }, icon('check', 14), h('span', null, 'Waiting for your OK')));
      card.appendChild(h('ul', { class: 'aib-card-list' }, B.pending.map(function (a) { return h('li', null, a.label); })));
      card.appendChild(h('div', { class: 'aib-card-actions' },
        h('button', { class: 'btn primary small', type: 'button', onclick: confirmPending }, icon('check', 16), 'Yes, do it'),
        h('button', { class: 'btn small', type: 'button', onclick: cancelPending }, 'No')));
    }
    B.card = card; B.stack.appendChild(card); sync();
  }
  async function confirmPending() {
    if (!B.pending.length || B.busy) return;
    const todo = B.pending; B.pending = []; B.editing = false; drawCard(); store.save();
    const my = ++B.token; B.busy = true; B.fab.classList.add('busy'); dissolve(B.botEl); B.botEl = null; sync();
    let done = 0, big = false; const bad = [];
    for (let i = 0; i < todo.length; i++) {
      const a = todo[i];
      try {
        if (a.type === 'create_task') { await Api.call('createTask', { title: a.title, description: a.description, dueDate: a.dueDate, assigneeIds: a.assigneeIds }); big = true; }
        else if (a.type === 'set_progress') { await Api.call('setProgress', { taskId: a.taskId, progress: a.progress }); if (a.progress === 100) big = true; }
        else if (a.type === 'post_message') await Api.call('postMessage', { taskId: a.taskId, text: a.text });
        else if (a.type === 'approve_task') { await Api.call('approveTask', { taskId: a.taskId }, { timeout: 90000 }); big = true; }
        else if (a.type === 'send_back') await Api.call('rejectTask', { taskId: a.taskId, note: a.note });
        else if (a.type === 'update_task') await Api.call('updateTask', Object.assign({ taskId: a.taskId }, a.patch));
        done++;
      } catch (e) {
        if (e.code === 'AUTH') { B.busy = false; return; }
        bad.push('Could not do "' + a.label + '": ' + (e.message || 'something went wrong'));
      }
    }
    B.busy = false; B.fab.classList.remove('busy');
    if (my !== B.token) return;
    if (done && B.App) { B.App.invalidate(); window.dispatchEvent(new Event('taskapp:changed')); if (big) UI.confetti(); }
    const sent = todo.length === 1 && todo[0].type === 'post_message';
    const msg = (done ? (sent ? 'Sent ✓' : (todo.length === 1 ? 'Done ✓' : done + ' done ✓')) : '') + (bad.length ? (done ? '\n' : '') + bad.join('\n') : '');
    putBot(msg || 'Done.'); store.save();
    if (B.min) { B.fab.classList.add('unread'); B.unseen = true; }
    if (done && B.lastVoice && !B.min && Speech.enabled() && Speech.supported) Speech.speak(sent ? 'Sent.' : 'Done.');
  }
  function cancelPending() {
    B.pending = []; B.editing = false; drawCard(); store.save(); Speech.stop();
    putBot('Okay, I will not do that.');
    if (B.lastVoice && Speech.enabled() && Speech.supported) Speech.speak('Okay.');
  }

  /* ============================== voice settings (Account page) ============================== */
  function voicePicker() {
    const body = h('div', { class: 'voice-pick' });
    const inDemo = !!(window.Api && window.Api.demo);
    const draw = function () {
      UI.clear(body);
      const list = Speech.voices(), current = Speech.voice(), studio = Speech.studio();
      body.appendChild(h('p', { class: 'small muted' }, list.length ? 'Tap a voice to hear it. The ones marked Natural sound the most like a person. Phones and Microsoft Edge usually have the best ones.' : 'No English voices were found on this device. Try Microsoft Edge on a computer, or Chrome on a phone.'));
      list.slice(0, 14).forEach(function (v) {
        const on = !studio && v.uri === current;
        body.appendChild(h('button', { type: 'button', class: 'voice-opt' + (on ? ' on' : ''), onclick: function () {
          Speech.setStudio(false); Speech.setVoice(v.uri); Speech.unlock(); Speech.speak('Hello, this is how I sound. I can read your tasks and updates to you.', { voiceUri: v.uri }); draw();
        } }, h('span', null, v.name.replace(/^Microsoft |^Google /, ''), h('small', null, v.lang + (v.natural ? ' · Natural' : ''))), on ? icon('check', 18) : null));
      });
      if (!inDemo) body.appendChild(h('button', { type: 'button', class: 'voice-opt studio' + (studio ? ' on' : ''), onclick: function () { Speech.setStudio(!studio); Speech.unlock(); if (!studio) Speech.speak('Hello, this is the studio voice.'); draw(); } },
        h('span', null, 'Studio voice (AI-made)', h('small', null, 'Very natural, but the free daily limit runs out quickly. Then your device voice takes over.')), studio ? icon('check', 18) : null));
    };
    draw();
    Speech.onVoicesChanged(function () { if (body.isConnected) draw(); });
    UI.modal({ title: 'Choose the voice', body: body, onClose: function () { Speech.stop(); }, actions: [{ label: 'Done', kind: 'primary' }] });
  }
  function settingsCard() {
    const box = h('div', { class: 'card' });
    const draw = function () {
      UI.clear(box);
      box.appendChild(h('h2', null, 'AI assistant'));
      box.appendChild(h('p', { class: 'muted small' }, 'The round AI bubble floats over every screen. Tap it and talk, or drag it where you like. Tap it again to tuck the chat away; tapping it once more pops it up and starts listening (the old messages are not shown, but the assistant still remembers them). Touch the chat to move it; touch the background to use the app behind it. The small Clear button next to the chat forgets it.'));
      const row = h('div', { class: 'row' });
      if (Speech.supported) {
        const on = Speech.enabled();
        row.appendChild(h('button', { type: 'button', class: 'tool-btn' + (on ? ' on' : ''), 'aria-pressed': on, onclick: function () { Speech.setEnabled(!Speech.enabled()); draw(); } }, icon(on ? 'volume' : 'volumeOff', 16), on ? 'Speaks answers when I speak' : 'Silent answers'));
        row.appendChild(h('button', { type: 'button', class: 'tool-btn', onclick: voicePicker }, icon('sparkles', 16), 'Choose voice'));
      }
      if (speechCtor() && !onIOS) {
        const q = quickOn();
        row.appendChild(h('button', { type: 'button', class: 'tool-btn' + (q ? ' on' : ''), 'aria-pressed': q, title: q ? 'Your phone turns your voice into words while you speak: the answer comes faster (English only).' : 'The recording is sent to the AI instead: slower, but it also understands Sinhala.', onclick: function () { try { localStorage.setItem('taskapp.quick', q ? 'off' : 'on'); } catch (e) { /* ignore */ } draw(); } }, icon('mic', 16), q ? 'Quick listening (English)' : 'Full listening (any language)'));
      }
      row.appendChild(h('button', { type: 'button', class: 'tool-btn', onclick: function () { try { localStorage.removeItem(POS_KEY); } catch (e) { /* ignore */ } B.pos = null; layout(); UI.toast('The bubble is back in its usual place.'); } }, icon('refresh', 16), 'Reset bubble position'));
      box.appendChild(row);
    };
    draw();
    return box;
  }

  /* ============================== public ============================== */
  // Called by the app on every screen once somebody is signed in.
  function ensure(App) {
    B.App = App;
    let fresh = false;
    if (B.uid !== App.S.user.id) { B.uid = App.S.user.id; B.history = []; B.pending = []; store.load(); fresh = true; if (B.built) { B.min = false; clearMessages(); drawCard(); } }
    if (!B.built) { build(); fresh = true; }
    if (fresh && B.pending.length) drawCard();           // an unsent draft is still waiting for an answer
    B.fab.classList.remove('hidden'); layout();
  }
  function where(o) { B.where = { task: (o && o.task) || '', archived: (o && o.archived) || '' }; }
  function hide() { if (!B.built) return; minimize(); B.fab.classList.add('hidden'); }   // the conversation waits, tucked away, for when the bubble is back
  function reset() {
    if (B.built) { endSession(); B.stack.remove(); B.typer.remove(); B.fab.remove(); window.removeEventListener('resize', layout); }
    try { Object.keys(sessionStorage).filter(function (k) { return k.indexOf('aib:') === 0; }).forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    B.min = false; B.built = false; B.uid = ''; B.history = []; B.pending = []; B.card = null; B.userEl = null; B.botEl = null; B.pos = null; B.where = { task: '', archived: '' };
  }
  function listenNow() { if (B.built) startListening(); }

  /* ============================== "Today at a glance" ============================== */

  function briefingCard(App) {
    const box = h('section', { class: 'brief', 'aria-label': 'Today at a glance' }), key = 'brief:' + App.S.user.id;
    let data = Api.cacheGet(key) || null, busy = false, failed = '', listening = false;
    function say() {
      if (listening) { Speech.stop(); listening = false; return draw(); }
      if (!data) return;
      Speech.unlock(); listening = true; draw();
      Speech.speak([data.briefing.headline].concat(data.briefing.items.slice(0, 3).map(function (i) { return i.text; })).join('. '), { onend: function () { listening = false; draw(); } });
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
        busy && b ? h('span', { class: 'brief-note' }, 'Updating…') : data && data.at ? h('span', { class: 'brief-note' }, (data.stale ? 'New activity since · ' : '') + 'Updated ' + UI.ago(data.at)) : null));
    }
    async function load(force) {
      if (busy) return;
      busy = true; failed = ''; draw();
      try {
        const r = await Api.call('briefing', { force: !!force }, { timeout: 45000 });
        data = { briefing: r.briefing, at: r.at, stale: r.stale }; Api.cacheSet(key, data);
      } catch (e) { if (e.code !== 'AUTH' && !data) failed = e.message || 'The overview is not available right now.'; else if (e.code !== 'AUTH') UI.toast(e.message, 'bad'); }
      busy = false; draw();
    }
    App.onLeave(function () { if (listening) Speech.stop(); });
    draw();
    // Only ask the AI again when there is nothing saved yet or the saved overview is more than 10 minutes old.
    function needsRefresh() { return !data || !data.briefing || !data.at || Date.now() - data.at > 600000 || !!data.stale; }
    // Reads the AI overview aloud (asking for it first when there is none yet). Used by the speaker button on the picture card.
    async function speak(done) {
      if (!data || !data.briefing || needsRefresh()) await load(false);
      if (!data || !data.briefing) { if (done) done(); return; }
      Speech.unlock();
      Speech.speak([data.briefing.headline].concat(data.briefing.items.slice(0, 3).map(function (i) { return i.text; })).join('. '), { onend: function () { if (done) done(); } });
    }
    return { el: box, load: load, needsRefresh: needsRefresh, speak: speak };
  }

  w.Assistant = { ensure: ensure, where: where, hide: hide, reset: reset, listen: listenNow, settingsCard: settingsCard, briefingCard: briefingCard };
})(window);
