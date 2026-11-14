/**
 * memory-env.js - an in-memory implementation of the Core `env` contract.
 * Used by (a) the automated tests (Node) and (b) the browser "demo mode"
 * (fake data, nothing leaves the browser). The real backend uses Adapters.gs instead.
 */
(function (root) {
  'use strict';

  /* ---- tiny synchronous SHA-256 (the real backend uses Utilities.computeDigest) ---- */
  const SHA = (function () {
    const K = [], H0 = [];
    (function () {
      let n = 0, c = 2;
      const frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
      while (n < 64) {
        let prime = true;
        for (let i = 2; i * i <= c; i++) if (c % i === 0) { prime = false; break; }
        if (prime) { if (n < 8) H0[n] = frac(Math.pow(c, 1 / 2)); K[n] = frac(Math.pow(c, 1 / 3)); n++; }
        c++;
      }
    })();
    function utf8(s) { return unescape(encodeURIComponent(s)); }
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    return function hex(message) {
      const s = utf8(message), len = s.length, words = [];
      for (let i = 0; i < len; i++) words[i >> 2] |= s.charCodeAt(i) << (24 - (i % 4) * 8);
      words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
      words[(((len + 8) >> 6) << 4) + 15] = len * 8;
      const h = H0.slice(), w = new Array(64);
      for (let o = 0; o < words.length; o += 16) {
        for (let i = 0; i < 64; i++) {
          if (i < 16) w[i] = words[o + i] | 0;
          else {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
          }
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
          const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) | 0;
          hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
      }
      return h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
    };
  })();

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function clone(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function defaultFor(type) { return type === 'n' ? 0 : type === 'b' ? false : type === 'j' ? null : ''; }

  function MemoryStore(onChange) { this.schema = {}; this.t = {}; this.onChange = onChange || function () {}; }
  MemoryStore.prototype.init = function (schema) {
    this.schema = schema;
    for (const name in schema) if (!this.t[name]) this.t[name] = [];
  };
  MemoryStore.prototype._norm = function (table, row) {
    const cols = this.schema[table].cols, out = {};
    for (const c in cols) {
      let v = row[c];
      if (v === undefined || v === null) v = defaultFor(cols[c]);
      out[c] = cols[c] === 'n' ? Number(v) : cols[c] === 'b' ? !!v : cols[c] === 'j' ? clone(v) : String(v);
    }
    return out;
  };
  MemoryStore.prototype.all = function (table) { return clone(this.t[table]); };
  MemoryStore.prototype.insert = function (table, row) { this.t[table].push(this._norm(table, row)); this.onChange(this); };
  MemoryStore.prototype.insertMany = function (table, rows) {
    const self = this; rows.forEach(function (r) { self.t[table].push(self._norm(table, r)); }); this.onChange(this);
  };
  MemoryStore.prototype.update = function (table, key, patch) {
    const k = this.schema[table].key, arr = this.t[table];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i][k] === key) { arr[i] = this._norm(table, Object.assign({}, arr[i], patch)); this.onChange(this); return clone(arr[i]); }
    }
    throw new Error('Row not found in ' + table + ': ' + key);
  };
  MemoryStore.prototype.removeWhere = function (table, pred) {
    const before = this.t[table].length;
    this.t[table] = this.t[table].filter(function (r) { return !pred(r); });
    if (this.t[table].length !== before) this.onChange(this);
    return before - this.t[table].length;
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function formatDate(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Fake AI used in tests and demo mode (the real one calls Gemini).
  function fakeAi() {
    return {
      transcribe: function () { return { english: '(demo) This is a sample of what the AI understood from the voice message.', language: 'English', key_points: '' }; },
      // Demo stand-ins: they only read the context they are given and cannot really understand speech or questions.
      assistant: function (input) {
        const lines = String(input.context).split(/\r?\n/).filter(function (l) { return l.indexOf('TASK id=') === 0; });
        const titles = lines.map(function (l) { return (/"([^"]*)"/.exec(l) || [])[1]; }).filter(Boolean);
        const late = lines.filter(function (l) { return l.indexOf('OVERDUE') >= 0; }).length;
        const said = String(input.text || '').toLowerCase();
        if (/^(yes|yeah|ok|okay|go ahead|confirm|do it)( |$|[.!,])/.test(said) && input.pending.length) return { heard: '', reply: 'Done.', confirm: 'yes', actions: [] };
        if (/^(no|cancel|stop)( |$|[.!,])/.test(said) && input.pending.length) return { heard: '', reply: 'Okay, I will not do that.', confirm: 'no', actions: [] };
        const ctxLines = String(input.context).split(/\r?\n/);
        const tidy = function (t) { t = t.trim().replace(/\s+/g, ' '); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : ''; };
        // the stand-in sees the screen too: "where am I" reads it back, and on the New task form it fills the form ("title ...", "assign to <name>")
        const scr = String(input.screen || '');
        if (scr && /where am i|what am i looking at|what is on (?:my|this) screen/i.test(said)) return { heard: '', confirm: '', reply: '(Demo) ' + (scr.split('\n')[1] || '').split('. ')[0].replace(/\.$/, '') + '.', actions: [] };
        if (scr.indexOf('NEW TASK form') >= 0) {
          const ft = /^(?:call it|title it|title)[:,]?\s+(.+)$/i.exec(said ? String(input.text).trim() : ''), asg = /^assign(?: it)? to\s+(.+?)\.?$/i.exec(String(input.text || '').trim());
          if (ft) return { heard: '', confirm: '', reply: '(Demo) I filled in the title.', actions: [{ type: 'fill_task', title: ft[1].replace(/\.$/, '') }] };
          if (asg) {
            const row = ctxLines.filter(function (l) { return l.indexOf('- ') === 0 && l.toLowerCase().indexOf(asg[1].toLowerCase()) >= 0 && /\(id /.test(l); })[0];
            const pid = row && (/\(id ([^)]+)\)/.exec(row) || [])[1];
            if (pid) return { heard: '', confirm: '', reply: '(Demo) Assigned.', actions: [{ type: 'fill_task', assignee_ids: [pid] }] };
          }
        }
        // dictating a message: "send this message ..." / "tell them ..." (or, while a draft waits, "change it to ...")
        const dict = /^(?:send|post|write|tell them|tell)(?: this)?(?: a)?(?: message)?(?: in the chat)?(?: that)?[:,]?\s+(.+)$/i.exec(String(input.text || '').trim()), change = /^(?:change it to|make it|say)[:,]?\s+(.+)$/i.exec(String(input.text || '').trim());
        if ((dict || (change && input.pending.length)) && input.focus) return { heard: '', confirm: '', reply: 'Here is your message. Send it, edit it or delete it?', actions: [{ type: 'post_message', task_id: input.focus.id, text: tidy((dict || change)[1]) }] };
        // "show my overdue tasks / history / account": the stand-in navigates too
        const nav = /^(?:show|list|open|go to|take me to|display)\b.*?\b(overdue|late|awaiting approval|waiting for approval|in progress|not started|history|completed|closed|account|settings)\b/i.exec(String(input.text || '').trim());
        if (nav) {
          const k = nav[1].toLowerCase(), map = { overdue: 'late', late: 'late', 'awaiting approval': 'wait', 'waiting for approval': 'wait', 'in progress': 'active', 'not started': 'new' };
          if (/history|completed|closed/.test(k)) return { heard: '', confirm: '', reply: '(Demo) Here are the completed tasks.', actions: [{ type: 'show_page', page: 'history' }] };
          if (/account|settings/.test(k)) return { heard: '', confirm: '', reply: '(Demo) Opening your account.', actions: [{ type: 'show_page', page: 'account' }] };
          return { heard: '', confirm: '', reply: '(Demo) Here are the tasks: ' + k + '.', actions: [{ type: 'show_page', page: 'tasks', filter: map[k] }] };
        }
        // "show me / open / find <task>": match the words against the open and completed tasks, and ask when it is not clear
        const find = /^(open|show me|show|go to|take me to|find|where is)\b[\s:,]*(?:the |my )?(.+?)(?: task)?\??$/i.exec(String(input.text || '').trim());
        if (find) {
          const words = find[2].toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && ['the', 'task', 'for', 'one'].indexOf(w) < 0; });
          const cands = ctxLines.map(function (l) { const m = /^(?:TASK id=|- id=)(\S+)(?: \|)? "([^"]*)"/.exec(l); return m ? { id: m[1], title: m[2], done: l.indexOf('- id=') === 0 } : null; }).filter(Boolean)
            .map(function (c) { return { c: c, n: words.filter(function (w) { return c.title.toLowerCase().indexOf(w) >= 0; }).length }; }).filter(function (x) { return x.n > 0; }).sort(function (x, y) { return y.n - x.n; });
          if (!words.length || !cands.length) return { heard: '', confirm: '', actions: [], reply: '(Demo) I could not find a task like that. Tell me a few words from its title.' };
          if (cands.length > 1 && cands[0].n === cands[1].n) return { heard: '', confirm: '', actions: [], reply: '(Demo) Which one do you mean: ' + cands.slice(0, 3).map(function (x) { return x.c.title; }).join(', or ') + '?' };
          const pick = cands[0].c;
          return { heard: '', confirm: '', reply: '(Demo) ' + (/^(open|go to|take me)/i.test(find[1]) ? 'Opening ' + pick.title + '.' : 'Here it is: ' + pick.title + '.'), actions: [{ type: 'open_task', task_id: pick.id, mode: /^(open|go to|take me)/i.test(find[1]) ? 'enter' : 'show' }] };
        }
        if (input.focus) {   // a question about one conversation: answer from what was said there
          const all = String(input.context).split(/\r?\n/), at = all.findIndex(function (l) { return l.indexOf('TASK id=' + input.focus.id) === 0; });
          if (at >= 0) {
            const head = all[at], said_ = [];
            for (let i = at + 1; i < all.length && /^\s/.test(all[i]); i++) if (/^\s+\[/.test(all[i])) said_.push(all[i].trim().replace(/^\[[^\]]*\]\s*/, ''));
            const pct = (/(\d+)%/.exec(head) || [])[1], overdue = head.indexOf('OVERDUE') >= 0, last = said_[said_.length - 1] || 'nothing yet';
            const hit = said_.filter(function (m) { return /waiting|missing|not yet|need|problem|blocked|late|broken|leak|still/i.test(m); });
            let r;
            if (/block|problem|stuck|issue|risk/.test(said)) r = hit.length ? 'Possibly. ' + hit.slice(-2).join(' ') : 'Nothing is blocking it in the conversation so far.';
            else if (/latest|last|new/.test(said)) r = 'The latest message: ' + last;
            else if (/next|step|do now/.test(said)) r = (overdue ? 'It is overdue, so the first step is to agree a new finish date. ' : '') + 'Next: ' + (pct && Number(pct) < 100 ? 'continue to the end and report again' : 'the manager can approve it') + '.';
            else if (/photo|file|picture|document/.test(said)) r = 'I have looked at the shared files. ' + (said_.filter(function (m) { return /shared a file/i.test(m); }).length ? 'They match what the team described.' : 'Nobody has shared a file yet.');
            else r = 'Here is where we are' + (pct ? ' (' + pct + '% done' + (overdue ? ', overdue' : '') + ')' : '') + '. ' + said_.slice(-3).join(' ');
            return { heard: '', confirm: '', actions: [], reply: '(Demo) ' + r };
          }
        }
        return { heard: input.audio ? '(demo) voice is not transcribed in demo mode' : '', confirm: '', actions: [],
          reply: '(Demo) You have ' + titles.length + ' open task' + (titles.length === 1 ? '' : 's') + (late ? ', ' + late + ' overdue' : '') + '.' + lines.slice(0, 4).map(function (l) {
            const t = (/"([^"]*)"/.exec(l) || [])[1], pc = (/in progress, (\d+)%/.exec(l) || [])[1];
            return '\n- [' + (l.indexOf('OVERDUE') >= 0 ? 'late' : l.indexOf('WAITING FOR APPROVAL') >= 0 ? 'wait' : 'good') + '] ' + t + (pc ? ' [' + pc + '%]' : '');
          }).join('') };
      },
      briefing: function (input) {
        const lines = String(input.context).split(/\r?\n/).filter(function (l) { return l.indexOf('TASK id=') === 0; });
        return { headline: '(Demo) You have ' + lines.length + ' open task' + (lines.length === 1 ? '' : 's') + '.',
          items: lines.slice(0, 3).map(function (l) { return { tone: l.indexOf('OVERDUE') >= 0 ? 'urgent' : 'info', text: (/"([^"]*)"/.exec(l) || [])[1] + ' - ' + ((/\| ([^|]*%[^|]*|WAITING[^|]*) \|/.exec(l) || [])[1] || ''), task_id: (/id=(\S+)/.exec(l) || [])[1] }; }) };
      },
      summarize: function (input) {
        const msgs = input.messages.filter(function (m) { return m.role !== 'system'; });
        const last = msgs[msgs.length - 1];
        const p = input.task.progress;
        return {
          summary_en: input.task.assignees.join(', ') + ' reported ' + msgs.length + ' update(s). Progress is ' + p + '%. Latest: "' + (last ? String(last.text).slice(0, 120) : 'none') + '"',
          progress_note: 'Progress is at ' + p + '%.',
          health: p >= 100 ? 'done' : p >= 50 ? 'on_track' : 'at_risk',
          blockers: [], next_steps: p >= 100 ? [] : ['Continue the work and report again']
        };
      }
    };
  }

  /**
   * options: { persistKey?: string (browser localStorage), now?: () => ms, ai?: {...}, hashRounds?: number }
   */
  function createMemoryEnv(options) {
    options = options || {};
    const files = {}, archives = {}, counters = {};
    let counter = 0;
    let timer = null, filesDirty = false;
    const saveNow = function (s) {
      timer = null;
      try { root.localStorage.setItem(options.persistKey, JSON.stringify({ t: s.t, archives: archives })); } catch (e) { /* quota */ }
      if (filesDirty) { filesDirty = false; try { root.localStorage.setItem(options.persistKey + '.files', JSON.stringify(files)); } catch (e) { /* quota: files then only live until the page is closed */ } }
    };
    const store = new MemoryStore(function (s) {
      if (options.persistKey && root.localStorage && !timer) timer = setTimeout(function () { saveNow(s); }, 150);   // one write per burst of changes
    });
    if (options.persistKey && root.localStorage) {
      try {
        const saved = JSON.parse(root.localStorage.getItem(options.persistKey) || 'null');
        if (saved) { store.t = saved.t; Object.assign(archives, saved.archives || {}); }
        Object.assign(files, JSON.parse(root.localStorage.getItem(options.persistKey + '.files') || '{}'));
      } catch (e) { /* ignore */ }
    }
    const byContent = {};   // the same picture or sound is stored once
    const keep = function (o) {
      const k = o.mime + '|' + o.b64.length + '|' + o.b64.slice(0, 40) + o.b64.slice(-40);
      if (byContent[k] && files[byContent[k]]) return byContent[k];
      const id = 'F' + randomHex(6); files[id] = { b64: o.b64, mime: o.mime }; byContent[k] = id; filesDirty = true;
      return id;
    };
    const env = {
      hashRounds: options.hashRounds || 50,
      now: options.now || function () { return Date.now(); },
      uuid: function () { counter++; return randomHex(16).slice(0, 28) + ('0000' + counter).slice(-4); },
      randomToken: function () { return randomHex(32); },
      sha256Hex: SHA,
      lock: function (fn) { return fn(); },
      log: options.log || function () {},
      formatDate: formatDate,
      store: store,
      setting: function (name) { return (options.settings || {})[name] || ''; },
      counter: function (key, seconds) {
        const b = Math.floor(env.now() / (seconds * 1000)), c = counters[key];
        counters[key] = { b: b, n: c && c.b === b ? c.n + 1 : 1 }; return counters[key].n;
      },
      files: {
        saveAudio: function (o) { return keep(o); },
        readAudio: function (id) { if (!files[id]) throw new Error('Audio is not available in demo mode after a page reload'); return files[id]; },
        saveFile: function (o) { return keep(o); },
        readFile: function (id) { if (!files[id]) throw new Error('This file is not available in demo mode after a page reload'); return files[id]; }
      },
      archive: {
        save: function (o) {
          const json = o.files.filter(function (f) { return f.name === 'task.json'; })[0];
          const id = 'AR' + randomHex(6);
          archives[id] = json.content;
          return { storage: 'memory', path: o.folder, fileId: id };
        },
        read: function (idx) { if (!archives[idx.fileId]) throw new Error('Archive not found'); return archives[idx.fileId]; }
      },
      ai: options.ai || fakeAi(),
      _files: files, _archives: archives
    };
    return env;
  }

  const api = { createMemoryEnv: createMemoryEnv, sha256Hex: SHA, fakeAi: fakeAi, MemoryStore: MemoryStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoryEnv = api;
})(typeof window !== 'undefined' ? window : globalThis);
