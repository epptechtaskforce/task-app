/**
 * Core.gs - business logic of the Task App (pure JavaScript, no Google APIs).
 *
 * This ONE file is used in three places:
 *   1. Google Apps Script backend  (Store/Files/Ai adapters live in Adapters.gs)
 *   2. The browser "demo mode"      (docs/js/core.js is a copy - run `node tools/sync-core.js`)
 *   3. Automated tests              (tests/core.test.js, run with `node tests/core.test.js`)
 *
 * Everything the outside world provides (database, files, AI, clock, locking)
 * comes in through the `env` object passed to createCore(env). See ENV CONTRACT below.
 *
 * ENV CONTRACT
 *   env.now()                      -> epoch milliseconds
 *   env.uuid()                     -> random unique string
 *   env.randomToken()              -> long random hex string (session tokens, temp passwords)
 *   env.sha256Hex(string)          -> hex digest
 *   env.lock(fn)                   -> runs fn while holding a global write lock, returns fn()'s value
 *   env.log(message)               -> diagnostics
 *   env.formatDate(ms)             -> "YYYY-MM-DD HH:mm" in the company time zone
 *   env.hashRounds                 -> (optional) password hash rounds
 *   env.store.init(TABLES)         -> create tables/columns if missing
 *   env.store.all(table)           -> array of row objects
 *   env.store.insert(table, row)
 *   env.store.insertMany(table, rows)
 *   env.store.update(table, key, patch) -> updated row
 *   env.store.removeWhere(table, predicate) -> number removed
 *   env.files.saveAudio({taskId, messageId, b64, mime}) -> fileId
 *   env.files.readAudio(fileId)    -> {b64, mime}
 *   env.files.saveFile({taskId, messageId, name, mime, b64}) -> fileId     (photos and documents shared in a task)
 *   env.files.readFile(fileId)     -> {b64, mime}
 *   env.archive.saveZip({person, zipName, files:[{name,content,mime}], moves:[{id,name}], trashIds}) -> {storage:'zip', path, fileId, folderId}   (one zip in the folder of the person who assigned the task)
 *   env.archive.read({storage, path, fileId}) -> JSON text of task.json   (only for archives made before the zip format)
 *   env.archive.readZip({fileId, path}, ['Summary.txt','Conversation.txt']) -> {name: text}   (text files inside a task's zip)
 *   env.ai.transcribe(b64, mime, hints) -> {english, language, key_points}   (always English; Sinhala is translated)
 *   env.ai.summarize(input)        -> {summary_en, progress_note, health, blockers, next_steps}
 *   env.ai.assistant(input)        -> {heard, reply, confirm, actions[]}      (the private secretary; see A.assistant)
 *   env.ai.briefing(input)         -> {headline, items[{tone, text, task_id}]} (the home-page overview; see A.briefing)
 *   env.ai.speak(text)             -> {b64, mime}  natural-sounding speech (raw 16-bit PCM); optional, the browser falls back to its own voice
 */
'use strict';

const APP_VERSION = '1.0.0';
const SESSION_DAYS = 14;
const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;
const DEFAULT_HASH_ROUNDS = 300;
const REJECT_PROGRESS = 90;
const MIN_PASSWORD = 8;
const LIMITS = {
  name: 80, title: 120, description: 2000, text: 4000, transcript: 8000, note: 300,
  maxAssignees: 20, maxAudioB64: 6000000, maxWavB64: 9000000, maxVoiceSecs: 150, maxLinks: 3000,
  bio: 300, photo: 20000,  // photo = a small square JPEG as a data: URL (the browser shrinks it to about 128 px before sending)
  maxFileB64: 7000000,     // about 5 MB of file (base64 text is 4/3 bigger)
  thumb: 9000,             // small preview picture stored with a shared image
  fileName: 100, maxAssistB64: 3200000, maxAssistText: 1500
};
// What may be shared in a task. Checked by file extension AND by the first bytes of the file (so a renamed program is refused).
const FILE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet'
};
const FILE_MAGIC = { jpg: '/9j/', jpeg: '/9j/', png: 'iVBORw0K', gif: 'R0lGOD', webp: 'UklGR', pdf: 'JVBERi', docx: 'UEsDB', xlsx: 'UEsDB', pptx: 'UEsDB', odt: 'UEsDB', ods: 'UEsDB', doc: '0M8R4KGx', xls: '0M8R4KGx', ppt: '0M8R4KGx', rtf: 'e1xydGY' };
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/;
const AUDIO_MIMES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'];

// Column types: s = string, n = number, b = boolean, j = JSON value
const TABLES = {
  Settings:     { key: 'key', cols: { key: 's', value: 's' } },
  JobTitles:    { key: 'id', cols: { id: 's', title: 's', level: 'n', createdAt: 'n' } },
  Users:        { key: 'id', cols: { id: 's', name: 's', username: 's', jobTitleId: 's', isAdmin: 'b', active: 'b', passSalt: 's', passHash: 's', mustChange: 'b', failCount: 'n', lockedUntil: 'n', createdAt: 'n', lastLogin: 'n' } },
  Links:        { key: 'id', cols: { id: 's', fromId: 's', toId: 's', createdAt: 'n' } },
  LinkVersions: { key: 'id', cols: { id: 's', version: 'n', createdBy: 's', createdAt: 'n', note: 's', links: 'j' } },
  Sessions:     { key: 'tokenHash', cols: { tokenHash: 's', userId: 's', expires: 'n', createdAt: 'n', lastSeen: 'n' } },
  Tasks:        { key: 'id', cols: { id: 's', title: 's', description: 's', creatorId: 's', assigneeIds: 'j', status: 's', progress: 'n', progressBy: 's', dueDate: 's', createdAt: 'n', updatedAt: 'n', pendingAt: 'n', closedAt: 'n', summary: 'j', summaryMsgCount: 'n', summaryAt: 'n' } },
  Messages:     { key: 'id', cols: { id: 's', taskId: 's', senderId: 's', type: 's', text: 's', transcript: 's', translation: 's', lang: 's', audioFileId: 's', audioMime: 's', audioSecs: 'n', status: 's', createdAt: 'n' } },
  Reads:        { key: 'id', cols: { id: 's', taskId: 's', userId: 's', lastReadAt: 'n' } },
  Profiles:     { key: 'userId', cols: { userId: 's', bio: 's', photo: 's', ver: 'n' } },
  Attachments:  { key: 'id', cols: { id: 's', taskId: 's', name: 's', mime: 's', size: 'n', fileId: 's', thumb: 's', w: 'n', h: 'n', createdAt: 'n' } },   // id = the id of the message that carries the file
  Briefings:    { key: 'userId', cols: { userId: 's', sig: 's', at: 'n', data: 'j' } },                                                               // the last home-page overview made for each person
  ArchiveIndex: { key: 'id', cols: { id: 's', title: 's', creatorId: 's', creatorName: 's', assigneeNames: 's', participantIds: 'j', createdAt: 'n', closedAt: 'n', storage: 's', path: 's', fileId: 's', summaryText: 's', messageCount: 'n', folderId: 's', purpose: 's', fileCount: 'n', archiveNo: 'n', docs: 'j' } },
  AuditLog:     { key: 'id', cols: { id: 's', at: 'n', userId: 's', action: 's', detail: 's' } }
};

function createCore(env) {
  const ROUNDS = env.hashRounds || DEFAULT_HASH_ROUNDS;

  /* ============================== helpers ============================== */

  function fail(code, message) { const e = new Error(message); e.code = code; return e; }
  function newId(prefix) { return prefix + env.uuid().replace(/-/g, '').slice(0, 10); }
  // Ids such as "Tb639c32335" are for the app, not for people: they are never shown or read aloud, even if a model quotes one.
  function noIds(text) {
    return String(text == null ? '' : text)
      .replace(/\(?\b(?:task\s+|user\s+)?ids?\b[\s:=#]*[A-Za-z](?=[A-Za-z0-9]*\d)[A-Za-z0-9]{7,14}\b\)?/gi, '')
      .replace(/\b[A-Za-z](?=[0-9a-f]*\d)[0-9a-f]{9,11}\b/g, '')
      .replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
  }
  function clip(v, max) { return String(v == null ? '' : v).slice(0, max); }

  function str(v, field, max, opts) {
    const s = String(v == null ? '' : v).trim();
    const min = opts && opts.min !== undefined ? opts.min : 1;
    if (s.length < min) throw fail('VALIDATION', field + ' is required');
    if (s.length > max) throw fail('VALIDATION', field + ' is too long (max ' + max + ' characters)');
    return s;
  }

  function makeCtx() {
    const memo = {};
    const ctx = {
      memo: memo,
      idx: {},
      rows: function (t) { if (!memo[t]) memo[t] = env.store.all(t); return memo[t]; },
      reset: function () { Object.keys(memo).forEach(function (k) { delete memo[k]; }); },
      write: function (fn) { return env.lock(function () { ctx.reset(); return fn(); }); }
    };
    return ctx;
  }
  function insert(ctx, t, row) { env.store.insert(t, row); delete ctx.memo[t]; return row; }
  function insertMany(ctx, t, rows) { if (rows.length) env.store.insertMany(t, rows); delete ctx.memo[t]; }
  function update(ctx, t, key, patch) { const r = env.store.update(t, key, patch); delete ctx.memo[t]; return r; }
  function removeWhere(ctx, t, pred) { const n = env.store.removeWhere(t, pred); delete ctx.memo[t]; return n; }
  function audit(ctx, user, action, detail) {
    insert(ctx, 'AuditLog', { id: newId('A'), at: env.now(), userId: user ? user.id : '', action: action, detail: clip(detail, 500) });
  }

  // Stored format is "<rounds>:<hex>" so the work factor can be changed later without breaking old passwords.
  function hashPassword(password, salt, rounds) {
    rounds = rounds || ROUNDS;
    let h = env.sha256Hex(salt + ':' + password);
    for (let i = 0; i < rounds; i++) h = env.sha256Hex(h + salt + password);
    return rounds + ':' + h;
  }
  function verifyPassword(user, password) {
    const rounds = parseInt(String(user.passHash).split(':')[0], 10) || ROUNDS;
    return safeEqual(hashPassword(password, user.passSalt, rounds), user.passHash);
  }
  function safeEqual(a, b) {
    a = String(a); b = String(b);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }
  // The password every new account starts with, and the one an admin reset gives back. It is deliberately simple to hand over; it only
  // opens the "choose a new password" screen (mustChange), and the rules for a NEW password (checkPasswordPolicy) do not accept it.
  const DEFAULT_PASSWORD = '1111';
  function checkPasswordPolicy(password, username) {
    const p = String(password || '');
    if (p.length < MIN_PASSWORD) throw fail('VALIDATION', 'Password must be at least ' + MIN_PASSWORD + ' characters');
    if (p.length > 100) throw fail('VALIDATION', 'Password is too long');
    if (p.toLowerCase() === String(username || '').toLowerCase()) throw fail('VALIDATION', 'Password must not be the same as the username');
    if (/^(.)\1+$/.test(p)) throw fail('VALIDATION', 'Password is too simple');
  }
  function setPassword(ctx, userId, password, mustChange) {
    const salt = env.randomToken().slice(0, 32);
    return update(ctx, 'Users', userId, { passSalt: salt, passHash: hashPassword(password, salt), mustChange: !!mustChange, failCount: 0, lockedUntil: 0 });
  }

  /* ---- lookups (all read through ctx so one request reads each sheet once) ---- */
  // The id maps are rebuilt only when the underlying rows were re-read (brief() is called many times per request).
  function indexBy(ctx, table, slot) {
    const rows = ctx.rows(table);
    if (!ctx.idx[slot] || ctx.idx[slot].rows !== rows) {
      const m = {}; rows.forEach(function (r) { m[r.id] = r; });
      ctx.idx[slot] = { rows: rows, map: m };
    }
    return ctx.idx[slot].map;
  }
  function usersById(ctx) { return indexBy(ctx, 'Users', 'users'); }
  function titlesById(ctx) { return indexBy(ctx, 'JobTitles', 'titles'); }
  function levelOf(user, titles) { const t = titles[user.jobTitleId]; return t ? t.level : null; }
  function publicUser(ctx, u) {
    const t = titlesById(ctx)[u.jobTitleId];
    return { id: u.id, name: u.name, username: u.username, jobTitleId: u.jobTitleId, jobTitle: t ? t.title : '', level: t ? t.level : null, isAdmin: !!u.isAdmin, active: !!u.active, mustChange: !!u.mustChange, lastLogin: u.lastLogin || 0 };
  }
  function brief(ctx, id) {
    const u = usersById(ctx)[id]; if (!u) return { id: id, name: 'Unknown', jobTitle: '' };
    const t = titlesById(ctx)[u.jobTitleId];
    return { id: u.id, name: u.name, jobTitle: t ? t.title : '' };
  }
  function isParticipant(t, uid) { return t.creatorId === uid || t.assigneeIds.indexOf(uid) >= 0; }

  function loadTask(ctx, me, taskId, opts) {
    const t = ctx.rows('Tasks').filter(function (x) { return x.id === String(taskId || ''); })[0];
    if (!t || !isParticipant(t, me.id)) throw fail('NOT_FOUND', 'Task not found');
    if (opts && opts.open && t.status === 'closed') throw fail('VALIDATION', 'This task is closed');
    return t;
  }

  /* ---- views sent to the browser (never include password data) ---- */
  function messagesOf(ctx, taskId) {
    return ctx.rows('Messages').filter(function (m) { return m.taskId === taskId; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
  }
  function attachmentOf(ctx, messageId) { return indexBy(ctx, 'Attachments', 'att')[messageId] || null; }
  function fileView(a) {
    if (!a) return { name: 'File', mime: '', size: 0, isImage: false, thumb: '', w: 0, h: 0 };
    return { name: a.name, mime: a.mime, size: a.size, isImage: String(a.mime).indexOf('image/') === 0, thumb: a.thumb || '', w: a.w || 0, h: a.h || 0 };
  }
  function msgView(ctx, m) {
    const s = brief(ctx, m.senderId);
    const v = { id: m.id, taskId: m.taskId, senderId: m.senderId, senderName: m.senderId ? s.name : 'System', senderTitle: s.jobTitle, type: m.type, text: m.text, status: m.status, hasAudio: !!m.audioFileId, audioSecs: m.audioSecs, createdAt: m.createdAt };   // a voice message is shown as audio only; what the AI understood from it stays on the server
    if (m.type === 'file') v.file = fileView(attachmentOf(ctx, m.id));
    return v;
  }
  function countContent(msgs) { return msgs.filter(function (m) { return m.type !== 'system'; }).length; }
  function taskView(ctx, me, t, opts) {
    const msgs = messagesOf(ctx, t.id);
    const reads = ctx.rows('Reads').filter(function (r) { return r.id === t.id + '|' + me.id; })[0];
    const lastRead = reads ? reads.lastReadAt : 0;
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const unread = msgs.some(function (m) { return m.createdAt > lastRead && m.senderId !== me.id && m.type !== 'system'; });
    const content = countContent(msgs);
    const v = {
      id: t.id, title: t.title, status: t.status, progress: t.progress, progressBy: t.progressBy ? brief(ctx, t.progressBy).name : '',
      dueDate: t.dueDate, createdAt: t.createdAt, updatedAt: t.updatedAt, pendingAt: t.pendingAt, closedAt: t.closedAt,
      creator: brief(ctx, t.creatorId), assignees: t.assigneeIds.map(function (id) { return brief(ctx, id); }),
      role: t.creatorId === me.id ? 'creator' : 'assignee', unread: unread, messageCount: content,
      lastMessage: last ? { senderName: last.senderId ? brief(ctx, last.senderId).name : 'System', type: last.type, text: clip(last.type === 'voice' ? 'Voice message' : last.type === 'file' ? (last.text || 'Shared a file') : last.text, 90), at: last.createdAt } : null
    };
    if (opts && opts.detail) {
      v.description = t.description;
      v.summary = t.summary && t.summary.summary_en !== undefined ? t.summary : null;
      v.summaryAt = t.summaryAt || 0;
      v.summaryStale = content > (t.summaryMsgCount || 0);
    }
    return v;
  }

  function normalizeSummary(o) {
    o = o || {};
    const list = function (x) { return Array.isArray(x) ? x.map(function (i) { return noIds(clip(i, 300)); }).slice(0, 8) : []; };
    const health = ['on_track', 'at_risk', 'blocked', 'done', 'unknown'].indexOf(o.health) >= 0 ? o.health : 'unknown';
    return { summary_en: noIds(clip(o.summary_en, 1200)), progress_note: noIds(clip(o.progress_note, 600)), health: health, blockers: list(o.blockers), next_steps: list(o.next_steps) };
  }

  /* ============================== sessions / auth ============================== */

  function authenticate(ctx, token) {
    if (!token || typeof token !== 'string') throw fail('AUTH', 'Please sign in');
    const th = env.sha256Hex('token:' + token);
    const s = ctx.rows('Sessions').filter(function (x) { return x.tokenHash === th; })[0];
    if (!s || s.expires < env.now()) throw fail('AUTH', 'Your session has expired. Please sign in again');
    const u = usersById(ctx)[s.userId];
    if (!u || !u.active) throw fail('AUTH', 'This account is not active');
    if (env.now() - s.lastSeen > 3600000) { // refresh at most hourly
      ctx.write(function () { update(ctx, 'Sessions', th, { lastSeen: env.now(), expires: env.now() + SESSION_DAYS * 86400000 }); });
    }
    return u;
  }

  function createSession(ctx, userId) {
    const token = env.randomToken();
    const th = env.sha256Hex('token:' + token);
    const t = env.now();
    insert(ctx, 'Sessions', { tokenHash: th, userId: userId, expires: t + SESSION_DAYS * 86400000, createdAt: t, lastSeen: t });
    return token;
  }

  /* ============================== actions ============================== */

  const ALLOWED_WHILE_MUST_CHANGE = { me: 1, changePassword: 1, logout: 1, info: 1 };
  const A = {};

  A.info = { auth: false, run: function (ctx) {
    const s = ctx.rows('Settings').filter(function (x) { return x.key === 'companyName'; })[0];
    return { companyName: s ? s.value : '', version: APP_VERSION, ready: ctx.rows('Users').length > 0 };
  } };

  A.login = { auth: false, run: function (ctx, _u, req) {
    const username = String(req.username || '').trim().toLowerCase();
    const password = String(req.password || '');
    const u = ctx.rows('Users').filter(function (x) { return x.username === username; })[0];
    if (!u || !u.active) { hashPassword(password, 'dummy-salt'); throw fail('AUTH', 'Wrong username or password'); }
    if (u.lockedUntil > env.now()) throw fail('LOCKED', 'Too many failed attempts. Try again in ' + Math.ceil((u.lockedUntil - env.now()) / 60000) + ' minute(s).');
    const ok = verifyPassword(u, password);
    if (!ok) {
      ctx.write(function () {
        const fresh = usersById(ctx)[u.id];
        const fails = (fresh.failCount || 0) + 1;
        update(ctx, 'Users', u.id, fails >= LOCK_AFTER_FAILS ? { failCount: 0, lockedUntil: env.now() + LOCK_MINUTES * 60000 } : { failCount: fails });
      });
      throw fail('AUTH', 'Wrong username or password');
    }
    return ctx.write(function () {
      update(ctx, 'Users', u.id, { failCount: 0, lockedUntil: 0, lastLogin: env.now() });
      // (expired sessions are cleared by maintenance() every night; doing it here made every sign-in rewrite the whole sheet)
      const token = createSession(ctx, u.id);
      const fresh = usersById(ctx)[u.id];
      return Object.assign({ token: token }, meView(ctx, fresh));   // same payload as "me", so the browser needs no second call
    });
  } };

  A.logout = { run: function (ctx, user, req) {
    const th = env.sha256Hex('token:' + req.token);
    ctx.write(function () { removeWhere(ctx, 'Sessions', function (s) { return s.tokenHash === th; }); });
    return { loggedOut: true };
  } };

  // Who may use the AI (assistant bubble, home overview, new task summaries, natural voice): Senior General Managers and everyone
  // above them. The cut-off is the layer of the job title that looks like "Senior General Manager" / "Senior GM" / "SGM"; the
  // script property AI_MAX_LEVEL (a layer number, 1 = top) overrides it. People without a job title (the Administrator) have no AI.
  function aiLevelCap(ctx) {
    const set = parseInt(env.setting && env.setting('AI_MAX_LEVEL'), 10);
    if (set > 0) return set;
    let cap = 0;
    ctx.rows('JobTitles').forEach(function (t) { if (/senior\s+(general\s+)?manager|senior\s+gm|(^|[^a-z])sgm([^a-z]|$)/i.test(t.title) && t.level > cap) cap = t.level; });
    return cap;
  }
  function aiAllowed(ctx, user) {
    const lvl = levelOf(user, titlesById(ctx)), cap = aiLevelCap(ctx);
    return !!cap && lvl !== null && lvl !== undefined && lvl <= cap;
  }
  function needAi(ctx, user) {
    if (!aiAllowed(ctx, user)) throw fail('FORBIDDEN', 'The AI assistant is available to Senior General Managers and above.');
  }
  function meView(ctx, user) {
    const company = (ctx.rows('Settings').filter(function (x) { return x.key === 'companyName'; })[0] || {}).value || '';
    return { user: publicUser(ctx, user), companyName: company, canAssign: ctx.rows('Links').some(function (l) { return l.fromId === user.id; }), canUseAi: aiAllowed(ctx, user) };
  }
  A.me = { run: function (ctx, user) { return meView(ctx, user); } };

  A.changePassword = { run: function (ctx, user, req) {
    const oldPw = String(req.oldPassword || ''), newPw = String(req.newPassword || '');
    if (!verifyPassword(user, oldPw)) throw fail('AUTH', 'Current password is wrong');
    checkPasswordPolicy(newPw, user.username);
    if (oldPw === newPw) throw fail('VALIDATION', 'Choose a different password');
    const th = env.sha256Hex('token:' + req.token);
    ctx.write(function () {
      setPassword(ctx, user.id, newPw, false);
      removeWhere(ctx, 'Sessions', function (s) { return s.userId === user.id && s.tokenHash !== th; }); // sign out other devices
      audit(ctx, user, 'changePassword', user.username);
    });
    return { changed: true };
  } };

  /* ---------------- profiles (picture + short bio) ---------------- */

  // Who may see whose picture and bio: yourself, people you share an open task with, people you can assign tasks to,
  // the people who can assign tasks to you, and (for administrators) everyone. Same spirit as the rest of the app:
  // nobody gets a company-wide directory.
  function visibleUserIds(ctx, user) {
    const users = usersById(ctx), ok = {};
    ok[user.id] = 1;
    if (user.isAdmin) { Object.keys(users).forEach(function (id) { ok[id] = 1; }); return ok; }
    ctx.rows('Links').forEach(function (l) { if (l.fromId === user.id) ok[l.toId] = 1; if (l.toId === user.id) ok[l.fromId] = 1; });
    ctx.rows('Tasks').forEach(function (t) {
      if (t.status === 'closed' || !isParticipant(t, user.id)) return;
      ok[t.creatorId] = 1; t.assigneeIds.forEach(function (id) { ok[id] = 1; });
    });
    return ok;
  }

  // req.have = { userId: version } of what this browser already holds; photos are only sent when they changed.
  A.profiles = { run: function (ctx, user, req) {
    const have = req.have && typeof req.have === 'object' ? req.have : {};
    const ok = visibleUserIds(ctx, user), users = usersById(ctx);
    const out = ctx.rows('Profiles').filter(function (p) { return ok[p.userId] && users[p.userId] && users[p.userId].active; }).map(function (p) {
      const v = { userId: p.userId, bio: p.bio, ver: p.ver || 0, hasPhoto: !!p.photo };
      if (Number(have[p.userId]) !== (p.ver || 0)) v.photo = p.photo || '';
      return v;
    });
    return { profiles: out };
  } };

  // req.bio (text) and/or req.photo (a JPEG data: URL, or '' to remove the picture). Fields that are not sent stay as they are.
  A.saveProfile = { run: function (ctx, user, req) {
    const patch = {};
    if (req.bio !== undefined) patch.bio = str(req.bio, 'Bio', LIMITS.bio, { min: 0 });
    if (req.photo !== undefined) {
      const photo = String(req.photo || '');
      if (photo && (photo.length > LIMITS.photo || !PHOTO_RE.test(photo))) throw fail('VALIDATION', 'The picture must be a small JPEG image');
      patch.photo = photo;
    }
    if (!Object.keys(patch).length) throw fail('VALIDATION', 'Nothing to save');
    return ctx.write(function () {
      patch.ver = env.now();
      const row = ctx.rows('Profiles').filter(function (p) { return p.userId === user.id; })[0];
      if (row) update(ctx, 'Profiles', user.id, patch);
      else insert(ctx, 'Profiles', Object.assign({ userId: user.id, bio: '', photo: '' }, patch));
      const p = ctx.rows('Profiles').filter(function (x) { return x.userId === user.id; })[0];
      return { profile: { userId: user.id, bio: p.bio, ver: p.ver, hasPhoto: !!p.photo, photo: p.photo } };
    });
  } };

  /* ---------------- admin ---------------- */

  A.adminOverview = { admin: true, run: function (ctx) {
    const titles = ctx.rows('JobTitles').slice().sort(function (a, b) { return a.level - b.level || a.title.localeCompare(b.title); });
    return {
      jobTitles: titles,
      users: ctx.rows('Users').map(function (u) { return publicUser(ctx, u); }).sort(function (a, b) { return (a.level || 99) - (b.level || 99) || a.name.localeCompare(b.name); }),
      links: ctx.rows('Links').map(function (l) { return { fromId: l.fromId, toId: l.toId }; }),
      versions: ctx.rows('LinkVersions').slice().sort(function (a, b) { return b.version - a.version; }).slice(0, 20).map(function (v) { return { version: v.version, createdAt: v.createdAt, createdBy: brief(ctx, v.createdBy).name, note: v.note, linkCount: v.links.length }; })
    };
  } };

  A.adminSaveJobTitle = { admin: true, run: function (ctx, user, req) {
    const title = str(req.title, 'Job title', 60);
    const level = Number(req.level);
    if (!Number.isInteger(level) || level < 1 || level > 20) throw fail('VALIDATION', 'Level must be a whole number from 1 (top) to 20');
    return ctx.write(function () {
      const dup = ctx.rows('JobTitles').filter(function (t) { return t.title.toLowerCase() === title.toLowerCase() && t.id !== req.id; })[0];
      if (dup) throw fail('VALIDATION', 'A job title with that name already exists');
      if (req.id) {
        const existing = titlesById(ctx)[req.id];
        if (!existing) throw fail('NOT_FOUND', 'Job title not found');
        const users = usersById(ctx), titles = titlesById(ctx);
        const lvl = function (uid) { const u = users[uid]; if (!u) return null; if (u.jobTitleId === req.id) return level; return levelOf(u, titles); };
        const broken = ctx.rows('Links').filter(function (l) { const a = lvl(l.fromId), b = lvl(l.toId); return a === null || b === null || a >= b; });
        if (broken.length) throw fail('VALIDATION', 'Changing the level would break ' + broken.length + ' tether(s). Remove them in the Org chart first.');
        update(ctx, 'JobTitles', req.id, { title: title, level: level });
        audit(ctx, user, 'jobTitle.update', title + ' L' + level);
        return titlesById(ctx)[req.id];
      }
      const row = insert(ctx, 'JobTitles', { id: newId('J'), title: title, level: level, createdAt: env.now() });
      audit(ctx, user, 'jobTitle.create', title + ' L' + level);
      return row;
    });
  } };

  A.adminDeleteJobTitle = { admin: true, run: function (ctx, user, req) {
    return ctx.write(function () {
      if (ctx.rows('Users').some(function (u) { return u.jobTitleId === req.id; })) throw fail('VALIDATION', 'Some users still have this job title');
      const n = removeWhere(ctx, 'JobTitles', function (t) { return t.id === req.id; });
      if (n) audit(ctx, user, 'jobTitle.delete', String(req.id));
      return { deleted: n };
    });
  } };

  A.adminSaveUser = { admin: true, run: function (ctx, user, req) {
    const name = str(req.name, 'Name', LIMITS.name);
    const username = str(req.username, 'Username', 30).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw fail('VALIDATION', 'Username may use letters, numbers, dot, dash and underscore (3-30 characters)');
    const isAdmin = !!req.isAdmin;
    const active = req.active === undefined ? true : !!req.active;
    const jobTitleId = String(req.jobTitleId || '');
    if (jobTitleId && !titlesById(ctx)[jobTitleId]) throw fail('VALIDATION', 'Unknown job title');
    if (!jobTitleId && !isAdmin) throw fail('VALIDATION', 'Choose a job title (only pure admin accounts may have none)');
    return ctx.write(function () {
      const all = ctx.rows('Users');
      if (all.some(function (u) { return u.username === username && u.id !== req.id; })) throw fail('VALIDATION', 'That username is already taken');
      if (req.id) {
        const existing = usersById(ctx)[req.id];
        if (!existing) throw fail('NOT_FOUND', 'User not found');
        const activeAdmins = all.filter(function (u) { return u.isAdmin && u.active && u.id !== req.id; }).length + ((isAdmin && active) ? 1 : 0);
        if (activeAdmins < 1) throw fail('VALIDATION', 'There must always be at least one active admin');
        if (req.id === user.id && !active) throw fail('VALIDATION', 'You cannot deactivate your own account');
        const titles = titlesById(ctx), oldLevel = levelOf(existing, titles), newLevel = jobTitleId ? titles[jobTitleId].level : null;
        if (oldLevel !== newLevel) {
          const users = usersById(ctx);
          const lvl = function (uid) { return uid === req.id ? newLevel : levelOf(users[uid], titles); };
          const broken = ctx.rows('Links').filter(function (l) { return (l.fromId === req.id || l.toId === req.id) && (lvl(l.fromId) === null || lvl(l.toId) === null || lvl(l.fromId) >= lvl(l.toId)); });
          if (broken.length) throw fail('VALIDATION', 'Changing this job title would break ' + broken.length + ' tether(s). Remove them in the Org chart first.');
        }
        update(ctx, 'Users', req.id, { name: name, username: username, jobTitleId: jobTitleId, isAdmin: isAdmin, active: active });
        if (!active) removeWhere(ctx, 'Sessions', function (s) { return s.userId === req.id; });
        audit(ctx, user, 'user.update', username);
        return { user: publicUser(ctx, usersById(ctx)[req.id]) };
      }
      const temp = req.password ? String(req.password) : DEFAULT_PASSWORD;
      if (req.password) checkPasswordPolicy(temp, username);   // a password the admin typed must follow the rules; the default is allowed once
      const id = newId('U');
      insert(ctx, 'Users', { id: id, name: name, username: username, jobTitleId: jobTitleId, isAdmin: isAdmin, active: active, passSalt: '', passHash: '', mustChange: true, failCount: 0, lockedUntil: 0, createdAt: env.now(), lastLogin: 0 });
      setPassword(ctx, id, temp, true);
      audit(ctx, user, 'user.create', username);
      return { user: publicUser(ctx, usersById(ctx)[id]), tempPassword: temp };
    });
  } };

  A.adminResetPassword = { admin: true, run: function (ctx, user, req) {
    return ctx.write(function () {
      const u = usersById(ctx)[req.userId];
      if (!u) throw fail('NOT_FOUND', 'User not found');
      const temp = DEFAULT_PASSWORD;
      setPassword(ctx, u.id, temp, true);
      removeWhere(ctx, 'Sessions', function (s) { return s.userId === u.id; });
      audit(ctx, user, 'user.resetPassword', u.username);
      return { tempPassword: temp };
    });
  } };

  A.adminSaveLinks = { admin: true, run: function (ctx, user, req) {
    const list = Array.isArray(req.links) ? req.links : [];
    if (list.length > LIMITS.maxLinks) throw fail('VALIDATION', 'Too many tethers');
    const note = clip(req.note, LIMITS.note);
    return ctx.write(function () {
      const users = usersById(ctx), titles = titlesById(ctx), seen = {}, clean = [];
      list.forEach(function (l) {
        const a = users[l && l.fromId], b = users[l && l.toId];
        if (!a || !b) throw fail('VALIDATION', 'A tether refers to a user that does not exist');
        const la = levelOf(a, titles), lb = levelOf(b, titles);
        if (la === null || lb === null) throw fail('VALIDATION', a.name + ' / ' + b.name + ' needs a job title before being tethered');
        if (la >= lb) throw fail('VALIDATION', 'A tether must go from a higher layer to a lower layer (' + a.name + ' -> ' + b.name + ')');
        const k = a.id + '>' + b.id;
        if (!seen[k]) { seen[k] = 1; clean.push({ fromId: a.id, toId: b.id }); }
      });
      removeWhere(ctx, 'Links', function () { return true; });
      const t = env.now();
      insertMany(ctx, 'Links', clean.map(function (l) { return { id: newId('L'), fromId: l.fromId, toId: l.toId, createdAt: t }; }));
      const version = ctx.rows('LinkVersions').reduce(function (m, v) { return Math.max(m, v.version); }, 0) + 1;
      insert(ctx, 'LinkVersions', { id: newId('V'), version: version, createdBy: user.id, createdAt: t, note: note, links: clean });
      audit(ctx, user, 'links.finalize', 'v' + version + ' (' + clean.length + ' tethers)');
      return { version: version, linkCount: clean.length };
    });
  } };

  /* ---------------- tasks ---------------- */

  function assignableFor(ctx, user) {
    const titles = titlesById(ctx), users = usersById(ctx), seen = {};
    return ctx.rows('Links').filter(function (l) { return l.fromId === user.id; }).map(function (l) { return users[l.toId]; })
      .filter(function (u) { if (!u || !u.active || seen[u.id]) return false; seen[u.id] = 1; return true; })
      .map(function (u) { return { id: u.id, name: u.name, jobTitle: (titles[u.jobTitleId] || {}).title || '', level: levelOf(u, titles) }; })
      .sort(function (a, b) { return a.level - b.level || a.name.localeCompare(b.name); });
  }
  A.assignable = { run: function (ctx, user) { return assignableFor(ctx, user); } };

  A.createTask = { run: function (ctx, user, req) {
    const title = str(req.title, 'Title', LIMITS.title);
    const description = str(req.description, 'Description', LIMITS.description, { min: 0 });
    const dueDate = String(req.dueDate || '');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw fail('VALIDATION', 'Due date must look like 2026-12-31');
    const ids = Array.isArray(req.assigneeIds) ? req.assigneeIds.map(String).filter(function (v, i, a) { return a.indexOf(v) === i; }) : [];
    if (!ids.length) throw fail('VALIDATION', 'Choose at least one person');
    if (ids.length > LIMITS.maxAssignees) throw fail('VALIDATION', 'Too many people on one task (max ' + LIMITS.maxAssignees + ')');
    const allowed = {};
    ctx.rows('Links').forEach(function (l) { if (l.fromId === user.id) allowed[l.toId] = 1; });
    const users = usersById(ctx);
    ids.forEach(function (id) {
      if (!allowed[id] || !users[id] || !users[id].active) throw fail('FORBIDDEN', 'You are not allowed to assign tasks to one of the chosen people');
    });
    return ctx.write(function () {
      const t = env.now(), id = newId('T');
      insert(ctx, 'Tasks', { id: id, title: title, description: description, creatorId: user.id, assigneeIds: ids, status: 'open', progress: 0, progressBy: '', dueDate: dueDate, createdAt: t, updatedAt: t, pendingAt: 0, closedAt: 0, summary: null, summaryMsgCount: 0, summaryAt: 0 });
      insert(ctx, 'Messages', { id: newId('M'), taskId: id, senderId: '', type: 'system', text: user.name + ' created this task', transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: t });
      const task = ctx.rows('Tasks').filter(function (x) { return x.id === id; })[0];
      return { task: taskView(ctx, user, task, { detail: true }) };
    });
  } };

  A.listTasks = { run: function (ctx, user) {
    const mine = ctx.rows('Tasks').filter(function (t) { return t.status !== 'closed' && isParticipant(t, user.id); });
    const views = mine.map(function (t) { return taskView(ctx, user, t); });
    const rank = function (v) { return v.status === 'pending' && v.role === 'creator' ? 0 : 1; };
    views.sort(function (a, b) { return rank(a) - rank(b) || b.updatedAt - a.updatedAt; });
    return { tasks: views, serverTime: env.now() };
  } };

  A.getTask = { run: function (ctx, user, req) {
    const t = loadTask(ctx, user, req.taskId);
    const msgs = messagesOf(ctx, t.id);
    const view = taskView(ctx, user, t, { detail: true });
    const newest = msgs.length ? msgs[msgs.length - 1].createdAt : 0;
    const read = ctx.rows('Reads').filter(function (r) { return r.id === t.id + '|' + user.id; })[0];
    if (newest && (!read || read.lastReadAt < newest)) {
      ctx.write(function () {
        const id = t.id + '|' + user.id;
        if (ctx.rows('Reads').some(function (r) { return r.id === id; })) update(ctx, 'Reads', id, { lastReadAt: newest });
        else insert(ctx, 'Reads', { id: id, taskId: t.id, userId: user.id, lastReadAt: newest });
      });
    }
    return { task: view, messages: msgs.map(function (m) { return msgView(ctx, m); }), serverTime: env.now() };
  } };

  A.postMessage = { run: function (ctx, user, req) {
    const t = loadTask(ctx, user, req.taskId, { open: true });
    const text = str(req.text, 'Message', LIMITS.text);
    return ctx.write(function () {
      const row = insert(ctx, 'Messages', { id: newId('M'), taskId: t.id, senderId: user.id, type: 'text', text: text, transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: env.now() });
      update(ctx, 'Tasks', t.id, { updatedAt: row.createdAt });
      return { message: msgView(ctx, row) };
    });
  } };

  A.postVoice = { run: function (ctx, user, req) {
    const t = loadTask(ctx, user, req.taskId, { open: true });
    const audioB64 = String(req.audioB64 || ''), wavB64 = String(req.wavB64 || '');
    if (!audioB64) throw fail('VALIDATION', 'No audio received');
    if (audioB64.length > LIMITS.maxAudioB64 || wavB64.length > LIMITS.maxWavB64) throw fail('VALIDATION', 'That voice message is too long. Keep it under 2 minutes.');
    const mime = String(req.mime || 'audio/webm').split(';')[0].trim().toLowerCase();
    if (AUDIO_MIMES.indexOf(mime) < 0) throw fail('VALIDATION', 'Unsupported audio format');
    const secs = Math.max(0, Math.min(Math.round(Number(req.secs) || 0), LIMITS.maxVoiceSecs));
    const msgId = newId('M');
    const fileId = env.files.saveAudio({ taskId: t.id, messageId: msgId, b64: audioB64, mime: mime });
    ctx.write(function () {
      const row = insert(ctx, 'Messages', { id: msgId, taskId: t.id, senderId: user.id, type: 'voice', text: '', transcript: '', translation: '', lang: '', audioFileId: fileId, audioMime: mime, audioSecs: secs, status: 'transcribing', createdAt: env.now() });
      update(ctx, 'Tasks', t.id, { updatedAt: row.createdAt });
    });
    let patch;
    try { // AI call happens OUTSIDE the lock so other people are never blocked by a slow model
      const hints = 'Task: ' + t.title + '. People: ' + [t.creatorId].concat(t.assigneeIds).map(function (id) { return brief(ctx, id).name; }).join(', ') + '.';
      const r = env.ai.transcribe(wavB64 || audioB64, wavB64 ? 'audio/wav' : mime, hints) || {};
      // transcript = what was said, in English (Sinhala is translated); translation = the key points. Both are only for the AI's memory of the task.
      patch = { status: 'ok', transcript: clip(r.english || r.english_translation || r.transcript, LIMITS.transcript), translation: clip(r.key_points, 600), lang: clip(r.language, 40) };
    } catch (e) {
      env.log('transcribe failed: ' + e);
      patch = { status: 'failed', transcript: '', translation: '' };
    }
    const updated = ctx.write(function () { return update(ctx, 'Messages', msgId, patch); });
    return { message: msgView(ctx, updated), transcribeFailed: patch.status === 'failed' };
  } };

  A.getAudio = { run: function (ctx, user, req) {
    let fileId = '';
    if (req.archived) {
      const idx = archiveIndexFor(ctx, user, req.taskId);
      const doc = readArchiveDoc(idx);
      const m = (doc.messages || []).filter(function (x) { return x.id === req.messageId; })[0];
      fileId = m ? m.audioFileId : '';
    } else {
      const m = ctx.rows('Messages').filter(function (x) { return x.id === req.messageId; })[0];
      if (m) { loadTask(ctx, user, m.taskId); fileId = m.audioFileId; }
    }
    if (!fileId) throw fail('NOT_FOUND', 'Audio not found');
    const a = env.files.readAudio(fileId);
    return { b64: a.b64, mime: a.mime };
  } };

  /* ---------------- photos and documents shared in a task ---------------- */

  function cleanFileName(v) {
    const n = String(v == null ? '' : v).split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._()\-]/gu, '_').replace(/^\.+/, '').trim();
    const dot = n.lastIndexOf('.');
    if (dot < 1) return '';
    const ext = n.slice(dot + 1).toLowerCase();
    const base = n.slice(0, dot).slice(0, LIMITS.fileName - ext.length - 1) || 'file';
    return base + '.' + ext;
  }

  A.postFile = { run: function (ctx, user, req) {
    const t = loadTask(ctx, user, req.taskId, { open: true });
    const name = cleanFileName(req.name);
    if (!name) throw fail('VALIDATION', 'That file has no usable name or type');
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const mime = FILE_TYPES[ext];
    if (!mime) throw fail('VALIDATION', 'That kind of file cannot be shared here. Use photos, PDF, Word, Excel, PowerPoint or text files.');
    const b64 = String(req.b64 || '');
    if (!b64) throw fail('VALIDATION', 'No file received');
    if (b64.length > LIMITS.maxFileB64) throw fail('VALIDATION', 'That file is too big. The limit is 5 MB.');
    if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) throw fail('VALIDATION', 'The file could not be read');
    if (FILE_MAGIC[ext] && b64.indexOf(FILE_MAGIC[ext]) !== 0) throw fail('VALIDATION', 'This does not look like a real .' + ext + ' file');
    const size = Math.floor(b64.length * 3 / 4) - (b64.slice(-2) === '==' ? 2 : b64.slice(-1) === '=' ? 1 : 0);
    const caption = str(req.caption, 'Caption', LIMITS.text, { min: 0 });
    const isImage = mime.indexOf('image/') === 0;
    const thumb = isImage && typeof req.thumb === 'string' && req.thumb.length <= LIMITS.thumb && PHOTO_RE.test(req.thumb) ? req.thumb : '';
    const dim = function (v) { return Math.max(0, Math.min(Math.round(Number(v) || 0), 20000)); };
    const msgId = newId('M');
    const fileId = env.files.saveFile({ taskId: t.id, messageId: msgId, name: name, mime: mime, b64: b64 });   // the slow part happens outside the lock
    return ctx.write(function () {
      const at = env.now();
      insert(ctx, 'Attachments', { id: msgId, taskId: t.id, name: name, mime: mime, size: size, fileId: fileId, thumb: thumb, w: dim(req.w), h: dim(req.h), createdAt: at });
      const row = insert(ctx, 'Messages', { id: msgId, taskId: t.id, senderId: user.id, type: 'file', text: caption, transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: at });
      update(ctx, 'Tasks', t.id, { updatedAt: at });
      return { message: msgView(ctx, row) };
    });
  } };

  A.getFile = { run: function (ctx, user, req) {
    let fileId = '', name = 'file', mime = 'application/octet-stream';
    if (req.archived) {
      const idx = archiveIndexFor(ctx, user, req.taskId);
      const doc = readArchiveDoc(idx);
      const m = (doc.messages || []).filter(function (x) { return x.id === req.messageId; })[0];
      if (m && m.file) { fileId = m.file.fileId; name = m.file.name; mime = m.file.mime; }
    } else {
      const a = ctx.rows('Attachments').filter(function (x) { return x.id === String(req.messageId || ''); })[0];
      if (a) { loadTask(ctx, user, a.taskId); fileId = a.fileId; name = a.name; mime = a.mime; }
    }
    if (!fileId) throw fail('NOT_FOUND', 'File not found');
    const f = env.files.readFile(fileId);
    return { b64: f.b64, mime: mime, name: name };
  } };

  // The person who gave the task can correct its title, details or due date later.
  A.updateTask = { run: function (ctx, user, req) {
    return ctx.write(function () {
      const t = loadTask(ctx, user, req.taskId, { open: true });
      if (t.creatorId !== user.id) throw fail('FORBIDDEN', 'Only the person who assigned the task can change it');
      const patch = {}, notes = [];
      if (req.title !== undefined) { const v = str(req.title, 'Title', LIMITS.title); if (v !== t.title) { patch.title = v; notes.push('renamed the task to "' + v + '"'); } }
      if (req.description !== undefined) { const v = str(req.description, 'Description', LIMITS.description, { min: 0 }); if (v !== t.description) { patch.description = v; notes.push('edited the details'); } }
      if (req.dueDate !== undefined) {
        const d = String(req.dueDate || '');
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw fail('VALIDATION', 'Due date must look like 2026-12-31');
        if (d !== t.dueDate) { patch.dueDate = d; notes.push(d ? 'changed the due date to ' + d : 'removed the due date'); }
      }
      if (notes.length) {
        const now = env.now(); patch.updatedAt = now;
        update(ctx, 'Tasks', t.id, patch);
        insert(ctx, 'Messages', { id: newId('M'), taskId: t.id, senderId: '', type: 'system', text: user.name + ' ' + notes.join(' and '), transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: now });
      }
      const fresh = ctx.rows('Tasks').filter(function (x) { return x.id === t.id; })[0];
      return { task: taskView(ctx, user, fresh, { detail: true }) };
    });
  } };

  A.setProgress = { run: function (ctx, user, req) {
    const progress = Number(req.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw fail('VALIDATION', 'Progress must be a whole number from 0 to 100');
    return ctx.write(function () {
      const t = loadTask(ctx, user, req.taskId, { open: true });
      if (t.assigneeIds.indexOf(user.id) < 0) throw fail('FORBIDDEN', 'Only the people assigned to this task can update its progress');
      const now = env.now(), status = progress === 100 ? 'pending' : 'open';
      if (progress === t.progress && status === t.status) return { task: taskView(ctx, user, t, { detail: true }) };
      update(ctx, 'Tasks', t.id, { progress: progress, progressBy: user.id, status: status, updatedAt: now, pendingAt: status === 'pending' ? now : 0 });
      insert(ctx, 'Messages', { id: newId('M'), taskId: t.id, senderId: '', type: 'system', text: user.name + ' set progress to ' + progress + '%' + (status === 'pending' ? ' - waiting for approval' : ''), transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: now });
      const fresh = ctx.rows('Tasks').filter(function (x) { return x.id === t.id; })[0];
      return { task: taskView(ctx, user, fresh, { detail: true }) };
    });
  } };

  A.rejectTask = { run: function (ctx, user, req) {
    const note = clip(req.note, LIMITS.note).trim();
    return ctx.write(function () {
      const t = loadTask(ctx, user, req.taskId, { open: true });
      if (t.creatorId !== user.id) throw fail('FORBIDDEN', 'Only the person who assigned the task can send it back');
      if (t.status !== 'pending') throw fail('VALIDATION', 'This task is not waiting for approval');
      const now = env.now();
      update(ctx, 'Tasks', t.id, { status: 'open', progress: REJECT_PROGRESS, updatedAt: now, pendingAt: 0 });
      insert(ctx, 'Messages', { id: newId('M'), taskId: t.id, senderId: '', type: 'system', text: user.name + ' sent the task back for more work' + (note ? ': ' + note : ''), transcript: '', translation: '', lang: '', audioFileId: '', audioMime: '', audioSecs: 0, status: 'ok', createdAt: now });
      const fresh = ctx.rows('Tasks').filter(function (x) { return x.id === t.id; })[0];
      return { task: taskView(ctx, user, fresh, { detail: true }) };
    });
  } };

  A.approveTask = { run: function (ctx, user, req) {
    // The archive keeps the task's AI summary. If it is missing or out of date it is made now, before the lock is taken (an AI call can be slow)
    // and only for people who may use the AI; if it fails the task is archived without it.
    try {
      const t0 = loadTask(ctx, user, req.taskId, { open: true });
      if (t0.creatorId === user.id && t0.status === 'pending' && aiAllowed(ctx, user)) A.refreshSummary.run(ctx, user, { taskId: t0.id });
    } catch (e) { env.log('final summary skipped: ' + e); }
    return ctx.write(function () {
      const t = loadTask(ctx, user, req.taskId, { open: true });
      if (t.creatorId !== user.id) throw fail('FORBIDDEN', 'Only the person who assigned the task can approve it');
      if (t.status !== 'pending') throw fail('VALIDATION', 'The task must be at 100% before it can be approved');
      return archiveTask(ctx, user, t);
    });
  } };

  A.refreshSummary = { run: function (ctx, user, req) {
    const t = loadTask(ctx, user, req.taskId, { open: true });
    const msgs = messagesOf(ctx, t.id);
    const content = countContent(msgs);
    if (!content) return { summary: null, summaryStale: false };
    if (t.summary && t.summary.summary_en !== undefined && t.summaryMsgCount === content && !req.force) return { summary: t.summary, summaryStale: false };
    needAi(ctx, user);                                                       // a new summary costs an AI call: only for those allowed to use the AI
    const input = {
      task: { title: t.title, description: t.description, progress: t.progress, status: t.status, dueDate: t.dueDate, manager: brief(ctx, t.creatorId).name, assignees: t.assigneeIds.map(function (id) { return brief(ctx, id).name; }) },
      messages: msgs.map(function (m) { return { time: env.formatDate(m.createdAt), from: m.senderId ? brief(ctx, m.senderId).name : 'System', role: m.senderId === t.creatorId ? 'manager' : (m.senderId ? 'assignee' : 'system'), type: m.type, text: m.type === 'voice' ? voiceMemo(m) : m.type === 'file' ? aiMsgText(ctx, m) : m.text }; })
    };
    let summary;
    try { summary = normalizeSummary(env.ai.summarize(input)); }
    catch (e) { env.log('summary failed: ' + e); throw fail('AI_FAILED', 'The AI summary is not available right now. Please try again in a minute.'); }
    ctx.write(function () { update(ctx, 'Tasks', t.id, { summary: summary, summaryMsgCount: content, summaryAt: env.now() }); });
    return { summary: summary, summaryStale: false };
  } };

  /* ============================== AI: the private secretary and the home overview ============================== */
  // The assistant can only PROPOSE actions. The browser shows them in plain words, the person confirms, and the browser then
  // performs them through the normal actions above, so the assistant never has more rights than the person using it.

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function aiNow() { const d = env.formatDate(env.now()); return { date: d.slice(0, 10), time: d.slice(11), weekday: DAY_NAMES[new Date(d.slice(0, 10) + 'T12:00:00Z').getUTCDay()] }; }
  function niceDate(ymd) { const d = new Date(ymd + 'T12:00:00Z'); return DAY_NAMES[d.getUTCDay()].slice(0, 3) + ' ' + d.getUTCDate() + ' ' + MONTH_SHORT[d.getUTCMonth()]; }
  function openTasksOf(ctx, user) { return ctx.rows('Tasks').filter(function (t) { return t.status !== 'closed' && isParticipant(t, user.id); }); }

  // What the AI remembers of a voice message: the English text, plus the key points when it was long.
  function voiceMemo(m) {
    if (!m.transcript) return '(voice message, not understood)';
    return m.transcript.length > 280 && m.translation ? m.transcript + ' [key points: ' + m.translation + ']' : m.transcript;
  }

  function aiMsgText(ctx, m) {
    if (m.type === 'voice') return '(voice) ' + voiceMemo(m);
    if (m.type === 'file') { const a = attachmentOf(ctx, m.id); return '(shared a file: ' + (a ? a.name : 'file') + ')' + (m.text ? ' ' + m.text : ''); }
    if (m.type === 'system') return '(system) ' + m.text;
    return m.text;
  }

  // The AI summary that sits at the top of a task page, as lines for the assistant. level: 'full' (every part, for the task on screen),
  // 'short' (one line with the main parts), 'tiny' (the first sentences only, when the prompt has to stay small).
  const HEALTH_WORDS = { on_track: 'on track', at_risk: 'at risk', blocked: 'blocked', done: 'looks complete', unknown: 'unclear' };
  function summaryLines(s, level, newer, when) {
    if (!s || !s.summary_en) return [];
    const join = function (a) { return (Array.isArray(a) ? a : []).filter(Boolean).join('; '); };
    const health = HEALTH_WORDS[s.health] || '';
    if (level === 'tiny') return ['  AI summary' + (health ? ' (' + health + ')' : '') + ': ' + clip(s.summary_en, 220)];
    if (level === 'short') {
      const bits = [clip(s.summary_en, 420)];
      if (s.progress_note) bits.push('so far: ' + clip(s.progress_note, 200));
      if (join(s.blockers)) bits.push('blockers: ' + clip(join(s.blockers), 200));
      if (join(s.next_steps)) bits.push('next steps: ' + clip(join(s.next_steps), 200));
      return ['  AI summary' + (health ? ' (' + health + ')' : '') + ': ' + bits.join(' | ')];
    }
    const L = ['  AI SUMMARY (exactly what the task page shows at the top; this is what to give when asked for the summary):', '    summary: ' + clip(s.summary_en, 1200)];
    if (health) L.push('    health: ' + health);
    if (s.progress_note) L.push('    so far: ' + clip(s.progress_note, 600));
    if (join(s.blockers)) L.push('    blockers: ' + join(s.blockers));
    if (join(s.next_steps)) L.push('    next steps: ' + join(s.next_steps));
    if (when) L.push('    (written ' + when + (newer > 0 ? '; ' + newer + ' newer message' + (newer === 1 ? '' : 's') + ' since: add anything important from them' : '') + ')');
    return L;
  }

  // Everything this person is allowed to see, as plain text for the model. perTask = how many recent messages per task.
  // focusId: the task the person is looking at gets its whole recent conversation; tight: fewer and shorter lines (the free AI services have small limits)
  function aiContext(ctx, user, perTask, withPeople, focusId, tight) {
    const users = usersById(ctx), titles = titlesById(ctx), now = aiNow(), my = titles[user.jobTitleId], L = [];
    L.push('TODAY: ' + now.weekday + ' ' + now.date + ', ' + now.time + ' (company time zone)');
    L.push('USER: ' + user.name + ' (id ' + user.id + ')' + (my ? ', ' + my.title + ', layer ' + my.level : '') + (user.isAdmin ? ', system administrator' : ''));
    const bosses = ctx.rows('Links').filter(function (l) { return l.toId === user.id; }).map(function (l) { return users[l.fromId]; }).filter(function (u) { return u && u.active; });
    L.push('PEOPLE WHO CAN GIVE ME TASKS: ' + (bosses.length ? bosses.map(function (u) { return u.name; }).join(', ') : 'nobody'));
    if (withPeople) {
      const ppl = assignableFor(ctx, user);
      L.push('PEOPLE I CAN ASSIGN TASKS TO (use these ids):');
      ppl.forEach(function (p) { L.push('- ' + p.name + ' (id ' + p.id + '), ' + (p.jobTitle || 'no job title')); });
      if (!ppl.length) L.push('- nobody');
    }
    const mine = openTasksOf(ctx, user).sort(function (a, b) { return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.updatedAt - a.updatedAt; });
    const ids = {}; mine.forEach(function (t) { ids[t.id] = []; });
    let anyFile = false;
    ctx.rows('Messages').forEach(function (m) { if (ids[m.taskId]) { ids[m.taskId].push(m); if (m.type === 'file') anyFile = true; } });
    const filesOf = {};
    if (anyFile) ctx.rows('Attachments').forEach(function (a) { if (ids[a.taskId]) (filesOf[a.taskId] = filesOf[a.taskId] || []).push(a.name); });
    L.push('OPEN TASKS (' + mine.length + '):');
    if (!mine.length) L.push('(none)');
    mine.forEach(function (t) {
      let due = t.dueDate ? 'due ' + t.dueDate : 'no due date';
      if (t.dueDate && t.status !== 'pending') {
        const days = Math.round((new Date(t.dueDate + 'T12:00:00Z') - new Date(now.date + 'T12:00:00Z')) / 86400000);
        if (days < 0) due += ' (OVERDUE by ' + (-days) + ' day' + (days === -1 ? '' : 's') + ')'; else if (days === 0) due += ' (today)'; else if (days === 1) due += ' (tomorrow)';
      }
      L.push('TASK id=' + t.id + ' | "' + clip(t.title, 120) + '" | ' + (t.status === 'pending' ? 'WAITING FOR APPROVAL (100%)' : 'in progress, ' + t.progress + '%') + ' | ' + due + ' | my role: ' + (t.creatorId === user.id ? 'creator (I assigned it)' : 'assignee') +
        ' | from: ' + brief(ctx, t.creatorId).name + ' | to: ' + t.assigneeIds.map(function (id) { return brief(ctx, id).name; }).join(', ') + ' | last activity ' + env.formatDate(t.updatedAt));
      if (t.description) L.push('  details: ' + clip(t.description, t.id === focusId ? 500 : (tight ? 120 : 200)));
      summaryLines(t.summary, t.id === focusId ? 'full' : (tight ? 'tiny' : 'short'), countContent(ids[t.id]) - (t.summaryMsgCount || 0), t.summaryAt ? env.formatDate(t.summaryAt).slice(0, 16) : '').forEach(function (l) { L.push(l); });
      if (filesOf[t.id]) L.push('  files shared: ' + filesOf[t.id].slice(0, 8).join(', '));
      ids[t.id].sort(function (a, b) { return a.createdAt - b.createdAt; }).slice(-(t.id === focusId ? 25 : perTask)).forEach(function (m) {
        L.push('  [' + env.formatDate(m.createdAt).slice(5) + '] ' + (m.senderId ? brief(ctx, m.senderId).name : 'System') + ': ' + clip(aiMsgText(ctx, m), t.id === focusId ? 300 : (tight ? 140 : 200)).replace(/\s+/g, ' '));
      });
    });
    const done = ctx.rows('ArchiveIndex').filter(function (x) { return x.participantIds.indexOf(user.id) >= 0; }).sort(function (a, b) { return b.closedAt - a.closedAt; }).slice(0, tight ? 10 : 20);
    L.push('COMPLETED TASKS, newest first (' + done.length + '; use the id to open one):');
    if (!done.length) L.push('(none)');
    done.forEach(function (x) { L.push('- id=' + x.id + ' "' + clip(x.title, 100) + '" from ' + x.creatorName + ' to ' + x.assigneeNames + ', completed ' + env.formatDate(x.closedAt).slice(0, 10) + (x.summaryText ? ': ' + clip(x.summaryText, tight ? 70 : 110) : '')); });
    return L.join('\n');
  }
  function aiContextFit(ctx, user, withPeople, budget, focusId) {
    let text = '';
    [[3, false], [2, true], [1, true]].some(function (p) { text = aiContext(ctx, user, p[0], withPeople, focusId, p[1]); return text.length <= budget; });
    return text.length > budget ? text.slice(0, budget) + '\n(older information left out)' : text;
  }

  // Photos / PDFs of the task the person is looking at, so the assistant can read them (at most 3 files, about 4 MB).
  function focusFiles(ctx, taskId) {
    const out = []; let total = 0;
    ctx.rows('Attachments').filter(function (a) { return a.taskId === taskId; }).sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (a) {
      if (out.length >= 3) return;
      const readable = a.mime.indexOf('image/') === 0 || a.mime === 'application/pdf' || a.mime === 'text/plain' || a.mime === 'text/csv';
      if (!readable || a.size > 2500000 || total + a.size > 4000000) return;
      try { out.push({ name: a.name, mime: a.mime, b64: env.files.readFile(a.fileId).b64 }); total += a.size; } catch (e) { env.log('could not read ' + a.fileId + ': ' + e); }
    });
    return out;
  }

  // Checks one action proposed by the model against what this person may really do. Returns {ok: action} or {err: reason}.
  function cleanAction(ctx, user, a, mineById, allowed) {
    if (!a || typeof a !== 'object') return { err: 'one of the actions was not understood' };
    const type = String(a.type || ''), q = function (s) { return '"' + clip(s, 60) + '"'; };
    const users = usersById(ctx), nameOf = function (id) { return users[id] ? users[id].name : 'someone'; };
    const dueOk = function (d) { return d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d); };
    if (type === 'create_task') {
      const title = clip(a.title, LIMITS.title).trim();
      if (!title) return { err: 'a new task needs a title' };
      const due = String(a.due_date || '').trim();
      if (!dueOk(due)) return { err: 'the due date was not clear' };
      const given = (Array.isArray(a.assignee_ids) ? a.assignee_ids : []).map(String).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      const ids = given.filter(function (id) { return allowed[id]; });
      if (!ids.length) return { err: 'I could not match that task to someone you are allowed to assign tasks to' };
      return { ok: { type: type, title: title, description: clip(a.description, LIMITS.description).trim(), dueDate: due, assigneeIds: ids, needsConfirm: true,
        label: 'Create the task ' + q(title) + ' for ' + ids.map(nameOf).join(', ') + (due ? ', due ' + niceDate(due) : '') }, partial: ids.length < given.length };
    }
    if (type === 'fill_task') {   // fills in the New task form on screen for the person (nothing is created: they press the button themselves)
      const out = { type: type, needsConfirm: false, label: 'Fill in the new task form' };
      let any = false, partial = false;
      if (a.title !== undefined && a.title !== null && clip(a.title, LIMITS.title).trim()) { out.title = clip(a.title, LIMITS.title).trim(); any = true; }
      if (a.description !== undefined && a.description !== null) { out.description = clip(a.description, LIMITS.description).trim(); any = true; }
      if (a.due_date !== undefined && a.due_date !== null) {
        const d = String(a.due_date).trim();
        if (!dueOk(d)) return { err: 'the due date was not clear' };
        out.dueDate = d; any = true;
      }
      if (Array.isArray(a.assignee_ids)) {
        const given = a.assignee_ids.map(String).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
        out.assigneeIds = given.filter(function (id) { return allowed[id]; }); partial = out.assigneeIds.length < given.length; any = true;
      }
      if (!any) return { err: 'there was nothing to fill in' };
      return { ok: out, partial: partial };
    }
    if (type === 'show_page') {   // navigation: the app moves to the place the person asked to see (nothing is changed, so no confirmation)
      const page = ['tasks', 'history', 'account'].indexOf(a.page) >= 0 ? a.page : 'tasks';
      const filter = page === 'tasks' && ['all', 'mine', 'byme', 'late', 'wait', 'active', 'new'].indexOf(a.filter) >= 0 ? a.filter : 'all';
      const search = page === 'account' ? '' : clip(a.search, 80).trim();
      const ids = page !== 'tasks' ? [] : (Array.isArray(a.task_ids) ? a.task_ids : []).map(String).filter(function (id, i, arr) { return mineById[id] && arr.indexOf(id) === i; }).slice(0, 12);
      const what = { tasks: 'your task list', history: 'completed tasks', account: 'your account' }[page];
      return { ok: { type: 'show_page', page: page, filter: filter, q: search, taskIds: ids, needsConfirm: false, label: 'Show ' + what + (search ? ' for ' + q(search) : '') } };
    }
    const task = mineById[String(a.task_id || '')];
    if (['set_progress', 'post_message', 'approve_task', 'send_back', 'update_task', 'open_task'].indexOf(type) < 0) return { err: 'one of the actions was not understood' };
    if (!task && type === 'open_task') {   // a completed task (History)
      const ix = ctx.rows('ArchiveIndex').filter(function (x) { return x.id === String(a.task_id || '') && x.participantIds.indexOf(user.id) >= 0; })[0];
      if (ix) return { ok: { type: 'open_task', taskId: ix.id, archived: true, mode: 'enter', needsConfirm: false, label: 'Open ' + q(ix.title) + ' (completed)' } };
    }
    if (!task) return { err: 'I could not find that task among your open tasks' };
    if (type === 'set_progress') {
      const p = Math.round(Number(a.progress));
      if (!(p >= 0 && p <= 100)) return { err: 'the progress value was not clear' };
      if (task.assigneeIds.indexOf(user.id) < 0) return { err: 'only the people assigned to ' + q(task.title) + ' can update its progress' };
      return { ok: { type: type, taskId: task.id, progress: p, needsConfirm: true, label: 'Set progress of ' + q(task.title) + ' to ' + p + '%' + (p === 100 ? ' (it will go to your manager for approval)' : '') } };
    }
    if (type === 'post_message') {
      const text = clip(a.text, LIMITS.text).trim();
      if (!text) return { err: 'the message was empty' };
      return { ok: { type: type, taskId: task.id, text: text, needsConfirm: true, label: 'Post this in ' + q(task.title) + ': "' + clip(text, 140) + '"' } };
    }
    if (type === 'approve_task' || type === 'send_back') {
      if (task.creatorId !== user.id) return { err: 'only the person who assigned ' + q(task.title) + ' can ' + (type === 'approve_task' ? 'approve' : 'send back') + ' it' };
      if (task.status !== 'pending') return { err: q(task.title) + ' is not waiting for approval' };
      const note = clip(a.note, LIMITS.note).trim();
      return { ok: { type: type, taskId: task.id, note: type === 'send_back' ? note : '', needsConfirm: true, label: type === 'approve_task' ? 'Approve and close ' + q(task.title) : 'Send ' + q(task.title) + ' back for more work' + (note ? ': "' + note + '"' : '') } };
    }
    if (type === 'update_task') {
      if (task.creatorId !== user.id) return { err: 'only the person who assigned ' + q(task.title) + ' can change it' };
      const patch = {}, bits = [];
      if (a.title !== undefined && a.title !== null && clip(a.title, LIMITS.title).trim()) { patch.title = clip(a.title, LIMITS.title).trim(); bits.push('rename it to ' + q(patch.title)); }
      if (a.description !== undefined && a.description !== null) { patch.description = clip(a.description, LIMITS.description).trim(); bits.push('change the details'); }
      if (a.due_date !== undefined && a.due_date !== null) {
        const d = String(a.due_date).trim();
        if (!dueOk(d)) return { err: 'the due date was not clear' };
        patch.dueDate = d; bits.push(d ? 'move the due date to ' + niceDate(d) : 'remove the due date');
      }
      if (!bits.length) return { err: 'there was nothing to change' };
      return { ok: { type: type, taskId: task.id, patch: patch, needsConfirm: true, label: 'For ' + q(task.title) + ': ' + bits.join(' and ') } };
    }
    // "show" = highlight the task in the list; "enter" = go into it
    return { ok: { type: 'open_task', taskId: task.id, mode: a.mode === 'enter' ? 'enter' : 'show', needsConfirm: false, label: 'Open ' + q(task.title) } };
  }

  // The conversation of a completed task, as text for the assistant (the person is looking at it in History).
  function archivedText(ctx, ix) {
    if (ix.storage === 'zip') {
      const L = ['THE PERSON IS LOOKING AT THIS COMPLETED TASK: "' + clip(ix.title, 120) + '" (id=' + ix.id + ') from ' + ix.creatorName + ' to ' + ix.assigneeNames + ', started ' + env.formatDate(ix.createdAt).slice(0, 10) + ', completed ' + env.formatDate(ix.closedAt).slice(0, 10) + (ix.archiveNo ? ', archive ID ' + archiveCode(ix.archiveNo) : '') + '.',
        'Its full conversation and files are in one zip in Google Drive (' + ix.path + '); only the details below are known here.'];
      if (ix.purpose) L.push('details: ' + clip(ix.purpose, 300));
      if (ix.summaryText) L.push('summary: ' + clip(ix.summaryText, 400));
      if ((ix.docs || []).length) L.push('documents shared: ' + ix.docs.map(function (d) { return d.name; }).join(', '));
      // the person is looking at this task: read its Summary.txt and Conversation.txt from inside the zip (only this one task, only now)
      let inside = {};
      try { inside = env.archive.readZip ? env.archive.readZip(ix, ['Summary.txt', 'Conversation.txt']) : {}; } catch (e) { env.log('archive zip read failed: ' + e); }
      if (inside['Summary.txt']) L.push('ARCHIVED SUMMARY (the same text as Summary.txt in the zip; this is what to give when asked for the summary):', clip(inside['Summary.txt'], 2000));
      if (inside['Conversation.txt']) L.push('ARCHIVED CONVERSATION (latest lines):', clip(inside['Conversation.txt'].split('\n').slice(-70).join('\n'), 7000));
      return L.join('\n');
    }
    let doc;
    try { doc = JSON.parse(env.archive.read(ix)); } catch (e) { env.log('archive read failed: ' + e); return ''; }
    const L = ['THE PERSON IS LOOKING AT THIS COMPLETED TASK: "' + clip(ix.title, 120) + '" (id=' + ix.id + ') from ' + ix.creatorName + ' to ' + ix.assigneeNames + ', started ' + env.formatDate(ix.createdAt).slice(0, 10) + ', completed ' + env.formatDate(ix.closedAt).slice(0, 10) + '.'];
    if (doc.task && doc.task.description) L.push('details: ' + clip(doc.task.description, 300));
    const full = summaryLines(doc.task && doc.task.summary, 'full', 0, '');
    if (full.length) full.forEach(function (l) { L.push(l.trim() === l ? l : l.slice(2)); });
    else if (ix.summaryText) L.push('summary: ' + clip(ix.summaryText, 400));
    (doc.messages || []).slice(-60).forEach(function (m) {
      const what = m.type === 'voice' ? '(voice) ' + (m.transcript || 'not understood') : m.type === 'file' ? '(shared a file: ' + (m.file ? m.file.name : 'file') + ') ' + (m.text || '') : m.type === 'system' ? '(system) ' + m.text : m.text;
      L.push('  [' + (m.time || '').slice(5) + '] ' + (m.senderName || 'System') + ': ' + clip(what, 240).replace(/\s+/g, ' '));
    });
    return L.join('\n');
  }

  // What the person is looking at right now, in words, so the assistant and the person look at the same screen (the companion idea).
  // Everything here comes from the browser, so it is only used as text for the model: ids are checked against the person's own tasks.
  function screenText(ctx, user, s, mineById, allowed) {
    if (!s || typeof s !== 'object') return '';
    const kind = ['home', 'new', 'task', 'closed', 'history', 'account', 'admin'].indexOf(s.kind) >= 0 ? s.kind : '';
    if (!kind) return '';
    const L = ['THE PERSON\'S SCREEN RIGHT NOW (you and the person are looking at the same screen; "here", "this", "these", "that one" mean what is on it):'];
    const users = usersById(ctx), q = function (v) { return '"' + clip(v, 120) + '"'; };
    if (kind === 'home') {
      const f = { all: 'all their open tasks', mine: 'only tasks assigned to them', byme: 'only tasks they assigned to others', late: 'only late (overdue) tasks', wait: 'only tasks waiting for approval', active: 'only tasks in progress', 'new': 'only tasks not started yet' };
      L.push('The HOME screen with their task list. The list shows ' + (f[s.filter] || f.all) + (clip(s.q, 80).trim() ? '; the search box says ' + q(clip(s.q, 80).trim()) : '') + '.');
      const shown = (Array.isArray(s.shown) ? s.shown : []).map(String).filter(function (id, i, arr) { return mineById[id] && arr.indexOf(id) === i; }).slice(0, 25);
      L.push(shown.length ? 'Tasks listed on the screen (' + shown.length + '): ' + shown.map(function (id) { return q(mineById[id].title) + ' (id=' + id + ')'; }).join('; ') : 'No task is listed on the screen at the moment.');
      L.push('Here you can answer about their tasks, point tasks out, filter or search the list (show_page), open a task, or start a new one.');
    } else if (kind === 'new') {
      const d = s.draft && typeof s.draft === 'object' ? s.draft : {};
      const title = clip(d.title, LIMITS.title).trim(), desc = clip(d.description, 300).trim(), due = /^\d{4}-\d{2}-\d{2}$/.test(String(d.due || '')) ? String(d.due) : '';
      const who = (Array.isArray(d.assigneeIds) ? d.assigneeIds : []).map(String).filter(function (id, i, arr) { return allowed[id] && arr.indexOf(id) === i; }).map(function (id) { return users[id] ? users[id].name : ''; }).filter(Boolean);
      L.push('The NEW TASK form (nothing is created yet). Filled in so far: title ' + (title ? q(title) : '(empty)') + '; assigned to ' + (who.length ? who.join(', ') : 'nobody yet') + '; due ' + (due ? niceDate(due) : 'not set') + '; details ' + (desc ? q(desc) : 'none') + '.');
      L.push('Help them finish it: use the fill_task action to fill in or change the form for them (they press the create button themselves), and tell them what is still missing (a title and at least one person). Only use create_task if they clearly tell you to create it now.');
    } else if (kind === 'task') {
      L.push('The page of one open task (the task is named below), where they read its conversation and update progress. Its AI summary is shown at the top of the page: when asked for the summary, give the AI SUMMARY from the CONTEXT.');
      const sl = Math.round(Number(s.slider));
      if (s.slider !== undefined && s.slider !== null && sl >= 0 && sl <= 100) L.push('Their progress slider currently shows ' + sl + '%.');
      const draft = clip(s.draft, 300).trim();
      if (draft) L.push('They have started typing this message (not sent yet): ' + q(draft));
    } else if (kind === 'closed') L.push('The page of a COMPLETED task in History (read only; the task is named below).');
    else if (kind === 'history') L.push('The HISTORY list of completed tasks' + (clip(s.q, 80).trim() ? '; the search box says ' + q(clip(s.q, 80).trim()) : '') + '.');
    else if (kind === 'account') L.push('Their ACCOUNT page (profile, password, voice and display settings).');
    else L.push('An ADMINISTRATOR page (users, job titles or the org chart). You cannot change anything there.');
    return L.join('\n');
  }

  // Short spoken or typed answers to "shall I go ahead?" ("yes", "yes please send it", "okay go ahead" / "no", "cancel that").
  // Anything longer or with a change of mind in it ("yes but make it shorter") is left to the model, which then returns the corrected action.
  function plainWords(s) { return String(s || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function saidYes(s) {
    const t = plainWords(s);
    if (!t || t.split(' ').length > 8) return false;
    if (/\b(not|don't|dont|no|never|wait|stop|cancel|but|instead|change|edit|add|rather|actually|shorter|longer)\b/.test(t)) return false;
    return /^(yes|yeah|yep|yup|yea|ok|okay|sure|correct|confirm|confirmed|approve|approved|agreed|alright|please do|go ahead|do it|send it|send that|send this|send|post it|please send|that's right|thats right|sounds good|looks good|perfect|fine)\b/.test(t)
      || /\b(go ahead|send it|send that|do it|confirm it)\b/.test(t);
  }
  function saidNo(s) {
    const t = plainWords(s);
    if (!t || t.split(' ').length > 4 || /\b(change|edit|instead|make|shorter|longer|add)\b/.test(t)) return false;
    return /^(no|nope|nah|cancel|stop|delete|don't|dont|do not|never mind|nevermind|leave it|forget it|scrap that|discard)\b/.test(t);
  }
  // The reply as it is spoken: the picture tags ([late], [35%]) are for the screen only.
  function speakable(text) {
    return String(text || '').replace(/\[(?:late|urgent|bad|overdue|blocked|wait|watch|pending|good|ok|done|info|note)\]\s*/gi, '').replace(/\[(\d{1,3})%\]/g, '$1 percent');
  }
  // Does this reply claim that something was sent / done?
  function claimsDone(reply) {
    const t = String(reply || '').split('\n\n(Note:')[0].trim().slice(0, 200);
    return /^(done|sent|posted|all done|all set)\b/i.test(t)
      || /\bi(?:'ve| have)?\s+(?:just\s+)?(?:sent|posted|created|approved|done)\b/i.test(t)
      || /\b(?:message|task|it|that)\s+(?:has been|was|is now|is)\s+(?:sent|posted|created|approved|done)\b/i.test(t);
  }

  A.assistant = { run: function (ctx, user, req) {
    needAi(ctx, user);
    const text = clip(req.text, LIMITS.maxAssistText).trim();
    let audio = null;
    if (req.wavB64 || req.audioB64) {
      const wav = String(req.wavB64 || ''), b64 = wav || String(req.audioB64);
      if (b64.length > LIMITS.maxAssistB64) throw fail('VALIDATION', 'That was too long. Please keep each question under a minute.');
      const mime = wav ? 'audio/wav' : String(req.mime || 'audio/webm').split(';')[0].trim().toLowerCase();
      if (AUDIO_MIMES.indexOf(mime) < 0) throw fail('VALIDATION', 'Unsupported audio format');
      audio = { b64: b64, mime: mime };
    }
    if (!text && !audio) throw fail('VALIDATION', 'Please say or type something');
    const history = (Array.isArray(req.history) ? req.history : []).slice(-12)
      .map(function (m) { return { role: m && m.role === 'assistant' ? 'assistant' : 'user', text: clip(m && m.text, LIMITS.maxAssistText) }; }).filter(function (m) { return m.text; });
    const pending = (Array.isArray(req.pending) ? req.pending : []).slice(0, 6).map(function (p) { return clip(p, 300); }).filter(Boolean);
    let focus = null, files = [];
    if (req.taskId) {
      const ft = ctx.rows('Tasks').filter(function (x) { return x.id === String(req.taskId) && isParticipant(x, user.id); })[0];
      if (ft) { focus = { id: ft.id, title: ft.title }; files = focusFiles(ctx, ft.id); }
    }
    let context = aiContextFit(ctx, user, true, 16000, focus ? focus.id : '');   // a small prompt is faster, and fits the free AI services' limits
    if (!focus && req.archivedId) {
      const ix = ctx.rows('ArchiveIndex').filter(function (x) { return x.id === String(req.archivedId) && x.participantIds.indexOf(user.id) >= 0; })[0];
      if (ix) { focus = { id: ix.id, title: ix.title }; context += '\n\n' + archivedText(ctx, ix); }
    }
    const mineById = {}; openTasksOf(ctx, user).forEach(function (t) { mineById[t.id] = t; });
    const allowed = {}; assignableFor(ctx, user).forEach(function (p) { allowed[p.id] = 1; });
    const screen = screenText(ctx, user, req.screen, mineById, allowed);
    let raw;
    try { raw = env.ai.assistant({ context: context, history: history, text: text, audio: audio, pending: pending, focus: focus, files: files, screen: screen, userName: user.name }); }
    catch (e) { env.log('assistant failed: ' + e); throw fail('AI_FAILED', 'The assistant is not available right now. Please try again in a minute.'); }
    raw = raw || {};
    // A waiting confirmation is decided by what the PERSON said (or the model's own yes/no label), never by how the model words its answer:
    // a model can say "Sent!" without sending anything, or re-propose the same action instead of confirming it.
    let decided = '';
    if (pending.length) {
      const said = text || clip(raw.heard, LIMITS.maxAssistText);
      decided = saidYes(said) ? 'yes' : saidNo(said) ? 'no' : (raw.confirm === 'yes' || raw.confirm === 'no') ? raw.confirm : '';
    }
    const actions = [], problems = [];
    (Array.isArray(raw.actions) && !decided ? raw.actions : []).slice(0, 5).forEach(function (a) {
      const r = cleanAction(ctx, user, a, mineById, allowed);
      if (r.ok) { actions.push(r.ok); if (r.partial) problems.push('I left out someone you are not allowed to assign tasks to'); } else problems.push(r.err);
    });
    let reply = noIds(clip(raw.reply, 2500)).trim() || 'Sorry, I did not catch that. Could you say it again?';
    if (problems.length) reply += '\n\n(Note: ' + problems.filter(function (p, i, arr) { return arr.indexOf(p) === i; }).join('; ') + '.)';
    const confirm = decided;
    // Something is still waiting for the person's OK and nothing has been done: the answer must not say it has been
    if (pending.length && !decided && !actions.length && claimsDone(reply)) reply = 'That is not done yet. Say yes, or tap the button, to go ahead.';
    // what is said aloud is the whole answer, word for word (the note about actions that could not be done stays on screen only)
    const spoken = speakable(reply.split('\n\n(Note:')[0].trim());
    return { heard: clip(raw.heard, LIMITS.maxAssistText).trim(), reply: reply, spoken: spoken, confirm: confirm, actions: actions };
  } };

  // Natural-sounding speech for the assistant's answers (a few seconds of audio per call). The browser falls back to its own voice if this fails.
  A.speak = { run: function (ctx, user, req) {
    needAi(ctx, user);
    const text = clip(req.text, 400).replace(/\s+/g, ' ').trim();
    if (!text) throw fail('VALIDATION', 'Nothing to say');
    if (!env.ai.speak) throw fail('AI_FAILED', 'Natural voice is not available');
    let r;
    try { r = env.ai.speak(text); } catch (e) { env.log('speak failed: ' + e); throw fail('AI_FAILED', 'Natural voice is not available right now'); }
    return { b64: r.b64, mime: r.mime };
  } };

  // The overview at the top of the home page. Made again only when something changed (and at most every 20 minutes), kept per person.
  A.briefing = { run: function (ctx, user, req) {
    needAi(ctx, user);
    const mine = openTasksOf(ctx, user), now = aiNow();
    if (!mine.length) return { briefing: { headline: 'You have no open tasks right now.', items: [] }, at: env.now(), stale: false };
    const sig = env.sha256Hex(now.date + '|' + mine.map(function (t) { return [t.id, t.status, t.progress, t.dueDate, t.updatedAt, t.assigneeIds.length].join(':'); }).sort().join('|'));
    const row = ctx.rows('Briefings').filter(function (b) { return b.userId === user.id; })[0];
    const recent = row && row.data && env.now() - row.at < 20 * 60000;
    if (row && row.data && !req.force && (row.sig === sig || recent)) return { briefing: row.data, at: row.at, stale: row.sig !== sig };
    let raw;
    try { raw = env.ai.briefing({ context: aiContextFit(ctx, user, false, 18000), userName: user.name }) || {}; }
    catch (e) { env.log('briefing failed: ' + e); throw fail('AI_FAILED', 'The overview is not available right now.'); }
    const tones = ['urgent', 'watch', 'good', 'info'], mineIds = {}; mine.forEach(function (t) { mineIds[t.id] = 1; });
    const data = {
      headline: noIds(clip(raw.headline, 240)).trim() || 'Here is where things stand.',
      items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 6).map(function (i) { return { tone: tones.indexOf(i && i.tone) >= 0 ? i.tone : 'info', text: noIds(clip(i && i.text, 260)).trim(), taskId: i && mineIds[i.task_id] ? i.task_id : '' }; }).filter(function (i) { return i.text; })
    };
    const at = env.now();
    ctx.write(function () {
      if (row) update(ctx, 'Briefings', user.id, { sig: sig, at: at, data: data });
      else insert(ctx, 'Briefings', { userId: user.id, sig: sig, at: at, data: data });
    });
    return { briefing: data, at: at, stale: false };
  } };

  /* ---------------- history / archive ---------------- */

  // Archives made before the zip format keep a task.json the app can read; a zip is for people to open in Drive, so the app keeps only the index row.
  function readArchiveDoc(idx) {
    if (idx.storage === 'zip') throw fail('NOT_FOUND', 'This task is archived as a zip file in Google Drive (' + idx.path + ')');
    return JSON.parse(env.archive.read(idx));
  }
  function archiveIndexFor(ctx, user, taskId) {
    const idx = ctx.rows('ArchiveIndex').filter(function (x) { return x.id === String(taskId || ''); })[0];
    if (!idx || idx.participantIds.indexOf(user.id) < 0) throw fail('NOT_FOUND', 'Task not found');
    return idx;
  }

  A.listHistory = { run: function (ctx, user, req) {
    const q = String(req.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.limit) || 30, 100)), offset = Math.max(0, Number(req.offset) || 0);
    let rows = ctx.rows('ArchiveIndex').filter(function (x) { return x.participantIds.indexOf(user.id) >= 0; });
    if (q) rows = rows.filter(function (x) { return (x.title + ' ' + x.creatorName + ' ' + x.assigneeNames + ' ' + x.summaryText + ' ' + (x.archiveNo ? archiveCode(x.archiveNo) : '') + ' ' + (x.docs || []).map(function (d) { return d.name; }).join(' ')).toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) { return b.closedAt - a.closedAt; });
    return { total: rows.length, items: rows.slice(offset, offset + limit).map(function (x) { return { id: x.id, title: x.title, creatorName: x.creatorName, assigneeNames: x.assigneeNames, createdAt: x.createdAt, closedAt: x.closedAt, summaryText: x.summaryText, messageCount: x.messageCount, archiveCode: x.archiveNo ? archiveCode(x.archiveNo) : '', docCount: x.fileCount || 0 }; }) };
  } };

  A.getArchived = { run: function (ctx, user, req) {
    const idx = archiveIndexFor(ctx, user, req.taskId);
    if (idx.storage === 'zip') {
      // The page for a task archived as a zip: the main details, from the index row, and exactly where to find the rest.
      const ids = idx.participantIds || [], parts = String(idx.path || '').split('/');
      return {
        version: 3, detailsOnly: true, id: idx.id,
        task: { id: idx.id, title: idx.title, description: idx.purpose || '', creator: brief(ctx, idx.creatorId), assignees: ids.slice(1).map(function (id) { return brief(ctx, id); }), createdAt: idx.createdAt, closedAt: idx.closedAt, approvedBy: idx.creatorName, summary: idx.summaryText ? { summary_en: idx.summaryText } : null },
        documents: idx.docs || [], messageCount: idx.messageCount,
        archive: { code: idx.archiveNo ? archiveCode(idx.archiveNo) : '', path: idx.path, person: parts[1] || '', zipName: parts[2] || '', folderUrl: idx.folderId ? 'https://drive.google.com/drive/folders/' + idx.folderId : '', fileUrl: idx.fileId ? 'https://drive.google.com/file/d/' + idx.fileId + '/view' : '' }
      };
    }
    const doc = readArchiveDoc(idx);   // the stored copy keeps what the AI understood from voice messages; the browser only gets the audio
    (doc.messages || []).forEach(function (m) { if (m.type === 'voice' && m.audioFileId) { delete m.transcript; delete m.translation; } });   // audio still there: shown as audio only. Audio removed to save space: the words are all that is left, so they are shown.
    doc.archive = { path: idx.path, folderUrl: idx.folderId ? 'https://drive.google.com/drive/folders/' + idx.folderId : '' };
    return doc;
  } };

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'task'; }

  // Names that read well in Google Drive (and on Windows): no slashes, colons, quotes or line breaks.
  function niceName(s, max) { return String(s == null ? '' : s).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 60).trim() || 'untitled'; }
  function sizeText(n) { const k = Number(n || 0) / 1024; return k >= 1024 ? (k / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(k)) + ' KB'; }
  function mmss(s) { s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function names(list) { return list.map(function (a) { return a.name; }).join(', '); }
  function indent(s) { return String(s == null ? '' : s).replace(/\r?\n/g, '\n    '); }
  // The number printed on every archived task ("EPP-0042"): the next one after the highest used so far.
  function archiveCode(n) { return 'EPP-' + ('0000' + Number(n || 0)).slice(-4); }
  function nextArchiveNo(ctx) { return ctx.rows('ArchiveIndex').reduce(function (hi, x) { return Math.max(hi, Number(x.archiveNo) || 0); }, 0) + 1; }

  // Conversation.txt: the whole conversation as plain text. Voice messages are written out (the audio itself is not kept).
  function renderConversationText(doc) {
    const t = doc.task, L = [];
    L.push('CONVERSATION - ' + t.title, 'Archive ID ' + (doc.archiveCode || '-') + '. Assigned by ' + t.creator.name + ' to ' + names(t.assignees), 'Started ' + t.startedText + ', completed ' + t.completedText, new Array(61).join('='), '');
    doc.messages.forEach(function (m) {
      const at = '[' + m.time + '] ';
      if (m.type === 'system') L.push(at + '(' + indent(m.text) + ')');
      else if (m.type === 'voice') {
        L.push(at + m.senderName + ' sent a voice message (' + mmss(m.audioSecs) + ')');
        L.push('    Said: ' + (indent(m.transcript) || '(no transcript available' + (m.audioFileId ? '; the audio is kept in the folder "Voice (no transcript)"' : '') + ')'));
        if (m.translation) L.push('    Key points: ' + indent(m.translation));
      } else if (m.type === 'file' && m.file) {
        L.push(at + m.senderName + ' shared a file: ' + (m.file.archivedAs ? 'Files/' + m.file.archivedAs : m.file.name) + ' (' + sizeText(m.file.size) + ')');
        if (m.text) L.push('    ' + indent(m.text));
      } else L.push(at + m.senderName + ': ' + indent(m.text));
    });
    return L.join('\n') + '\n';
  }

  // Summary.txt: one short page that says what the task was, who did what and when, and what is in the zip.
  function renderSummaryText(doc, info) {
    const t = doc.task, s = t.summary, L = [], join = function (a) { return (Array.isArray(a) ? a : []).filter(Boolean).join('; '); };
    const files = doc.messages.filter(function (m) { return m.file; }), voices = doc.messages.filter(function (m) { return m.type === 'voice'; });
    const days = Math.max(0, Math.round((t.closedAt - t.createdAt) / 86400000));
    L.push('TASK ARCHIVE ' + info.code, new Array(61).join('='), 'Archive ID:   ' + info.code, 'Stored in:    Google Drive > EPP > ' + info.person + ' > ' + info.zipName, '',
      'Task:         ' + t.title, 'Purpose:      ' + (t.description ? indent(t.description) : '(no description)'),
      'Assigned by:  ' + t.creator.name, 'Done by:      ' + names(t.assignees), 'Started:      ' + t.startedText, 'Completed:    ' + t.completedText + ' (' + days + (days === 1 ? ' day' : ' days') + ')',
      'Due date:     ' + (t.dueDate || '(none)'), 'Approved by:  ' + t.approvedBy, '');
    if (s && s.summary_en) {
      L.push('HOW IT WENT', indent(s.summary_en));
      if (s.progress_note) L.push('So far: ' + indent(s.progress_note));
      if (join(s.blockers)) L.push('Blockers: ' + join(s.blockers));
      if (join(s.next_steps)) L.push('Next steps: ' + join(s.next_steps));
      L.push('');
    }
    L.push('IN THIS ZIP',
      '  Summary.txt       this page',
      '  Conversation.txt  the whole conversation (' + countContent(doc.messages) + ' messages' + (voices.length ? ', ' + voices.length + ' voice message' + (voices.length === 1 ? '' : 's') + ' written out' : '') + ')',
      '  Files/            ' + (files.length ? files.length + ' shared document' + (files.length === 1 ? '' : 's') + ' and picture' + (files.length === 1 ? '' : 's') : 'nothing was shared'));
    files.forEach(function (m) { L.push('                    - ' + (m.file.archivedAs || m.file.name) + ' (' + sizeText(m.file.size) + ')'); });
    if (voices.some(function (m) { return !m.audioFileId; })) L.push('', 'Voice messages are not kept as audio, to save space: what was said is written in Conversation.txt.');
    return L.join('\n') + '\n';
  }

  // The plain-words summary used when nobody made an AI summary: who, to whom, when, what for.
  function plainGist(doc) {
    const t = doc.task, days = Math.max(0, Math.round((t.closedAt - t.createdAt) / 86400000));
    return 'Assigned by ' + t.creator.name + ' to ' + names(t.assignees) + ', done in ' + days + (days === 1 ? ' day' : ' days') + '.' + (t.description ? ' ' + t.description : '');
  }

  // When a task is approved everything about it becomes ONE zip file, in the folder of the person who assigned it:
  //   Google Drive > EPP > <person who assigned> > "EPP-0042 - Title - 2026-11-14.zip"
  // inside: Summary.txt, Conversation.txt (voice messages written out), Files/ (shared documents and pictures, readable names).
  // Voice audio is not kept. The loose files are thrown away (Drive trash) only after the zip has been written and checked. The
  // ArchiveIndex row keeps just the few lines the History page shows: people, dates, documents' names, summary, the number and the place.
  function archiveTask(ctx, closer, t) {
    const msgs = messagesOf(ctx, t.id), closedAt = env.now();
    const hasFiles = msgs.some(function (m) { return m.type === 'file'; });
    const fileOf = function (m) { const a = hasFiles && m.type === 'file' ? attachmentOf(ctx, m.id) : null; return a ? { name: a.name, mime: a.mime, size: a.size, fileId: a.fileId } : undefined; };
    const no = nextArchiveNo(ctx), code = archiveCode(no);
    const doc = {
      version: 3, id: t.id, archiveCode: code,
      task: { id: t.id, title: t.title, description: t.description, creator: brief(ctx, t.creatorId), assignees: t.assigneeIds.map(function (id) { return brief(ctx, id); }), createdAt: t.createdAt, closedAt: closedAt, startedText: env.formatDate(t.createdAt), completedText: env.formatDate(closedAt), dueDate: t.dueDate, progress: 100, approvedBy: closer.name, summary: t.summary || null },
      messages: msgs.map(function (m) { return { id: m.id, senderId: m.senderId, senderName: m.senderId ? brief(ctx, m.senderId).name : 'System', type: m.type, text: m.text, transcript: m.transcript, translation: m.translation, audioFileId: m.audioFileId, audioMime: m.audioMime, audioSecs: m.audioSecs, createdAt: m.createdAt, time: env.formatDate(m.createdAt), file: fileOf(m) }; })
    };
    // Shared documents and pictures go into "Files" with names a person can read. A voice message is large: once its words are written down
    // the audio is simply not put in the zip. One without a transcript goes in (folder "Voice (no transcript)"), so nothing is ever lost.
    const moves = [], trash = [], taken = {};
    doc.messages.forEach(function (m) {
      const stamp = String(m.time).replace(':', '-') + ' ' + niceName(String(m.senderName).split(' ')[0], 20);
      if (m.file && m.file.fileId) {
        let nm = niceName(stamp + ' - ' + m.file.name, 120), n = 1;
        while (taken[nm.toLowerCase()]) nm = niceName(stamp + ' - (' + (++n) + ') ' + m.file.name, 120);
        taken[nm.toLowerCase()] = 1; m.file.archivedAs = nm;
        moves.push({ id: m.file.fileId, name: 'Files/' + nm }); trash.push(m.file.fileId);
      }
      if (m.type === 'voice' && m.audioFileId) {
        trash.push(m.audioFileId);
        if (String(m.transcript || '').trim()) { m.audioFileId = ''; m.audioRemoved = true; }
        else moves.push({ id: m.audioFileId, name: 'Voice (no transcript)/' + niceName(stamp + ' - voice message.' + (String(m.audioMime || '').split(';')[0].split('/')[1] || 'audio').replace('x-m4a', 'm4a'), 120) });
      }
    });
    if (env.store.ensureColumns) { try { env.store.ensureColumns('ArchiveIndex'); } catch (e) { env.log('ensureColumns failed: ' + e); } }   // an older sheet gets the newer columns the first time (never a reason to stop an approval)
    const d = env.formatDate(closedAt), person = niceName(doc.task.creator.name, 60);
    const zipName = niceName(code + ' - ' + t.title, 90) + ' - ' + d.slice(0, 10) + '.zip';
    const saved = env.archive.saveZip({
      person: person, zipName: zipName,
      files: [{ name: 'Summary.txt', content: renderSummaryText(doc, { code: code, person: person, zipName: zipName }), mime: 'text/plain' }, { name: 'Conversation.txt', content: renderConversationText(doc), mime: 'text/plain' }],
      moves: moves, trashIds: trash
    });
    const participantIds = [t.creatorId].concat(t.assigneeIds);
    const docs = doc.messages.filter(function (m) { return m.file; }).slice(0, 40).map(function (m) { return { name: clip(m.file.name, 100), size: m.file.size, by: m.senderName, at: m.time.slice(0, 10) }; });
    const gist = t.summary && t.summary.summary_en ? t.summary.summary_en : plainGist(doc);
    insert(ctx, 'ArchiveIndex', { id: t.id, title: t.title, creatorId: t.creatorId, creatorName: doc.task.creator.name, assigneeNames: names(doc.task.assignees), participantIds: participantIds, createdAt: t.createdAt, closedAt: closedAt, storage: saved.storage, path: saved.path, fileId: saved.fileId, summaryText: clip(gist, 400), messageCount: countContent(msgs), folderId: saved.folderId || '', purpose: clip(t.description, 300), fileCount: docs.length, archiveNo: no, docs: docs });
    // Only after the archive is safely written do we remove the live rows.
    removeWhere(ctx, 'Messages', function (m) { return m.taskId === t.id; });
    if (hasFiles) removeWhere(ctx, 'Attachments', function (a) { return a.taskId === t.id; });
    removeWhere(ctx, 'Reads', function (r) { return r.taskId === t.id; });
    removeWhere(ctx, 'Tasks', function (x) { return x.id === t.id; });
    audit(ctx, closer, 'task.archive', t.id);
    return { archived: true, id: t.id, archiveCode: code };
  }

  /* ============================== dispatcher ============================== */

  function handle(req) {
    const ctx = makeCtx();
    try {
      req = req || {};
      const a = A[req.action];
      if (!a || !Object.prototype.hasOwnProperty.call(A, req.action)) throw fail('VALIDATION', 'Unknown action');
      let user = null;
      if (a.auth !== false) {
        user = authenticate(ctx, req.token);
        if (user.mustChange && !ALLOWED_WHILE_MUST_CHANGE[req.action]) throw fail('MUSTCHANGE', 'Please choose a new password first');
        if (a.admin && !user.isAdmin) throw fail('FORBIDDEN', 'Administrators only');
      }
      return { ok: true, data: a.run(ctx, user, req) };
    } catch (e) {
      if (e && e.code) return { ok: false, code: e.code, error: e.message };
      env.log('Unexpected error in ' + (req && req.action) + ': ' + (e && e.stack || e));
      return { ok: false, code: 'ERROR', error: 'Something went wrong on the server. ' + clip(e && e.message, 150) };
    }
  }

  /* ============================== setup / maintenance ============================== */

  // Called once by the developer (see Setup.gs). Creates the tables, the company record and the first admin.
  function setup(p) {
    env.store.init(TABLES);
    const ctx = makeCtx();
    const companyName = str(p.companyName, 'Company name', 80);
    const username = str(p.adminUsername, 'Admin username', 30).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Admin username may use letters, numbers, dot, dash, underscore (3-30 chars)');
    checkPasswordPolicy(p.adminPassword, username);
    return ctx.write(function () {
      const existing = ctx.rows('Settings').filter(function (x) { return x.key === 'companyName'; })[0];
      if (existing) update(ctx, 'Settings', 'companyName', { value: companyName });
      else insert(ctx, 'Settings', { key: 'companyName', value: companyName });
      if (ctx.rows('Users').some(function (u) { return u.isAdmin; })) return { createdAdmin: false, message: 'An admin already exists; company name updated only.' };
      const id = newId('U');
      insert(ctx, 'Users', { id: id, name: clip(p.adminName || 'Administrator', LIMITS.name), username: username, jobTitleId: '', isAdmin: true, active: true, passSalt: '', passHash: '', mustChange: true, failCount: 0, lockedUntil: 0, createdAt: env.now(), lastLogin: 0 });
      setPassword(ctx, id, String(p.adminPassword), true);
      audit(ctx, { id: id }, 'setup', companyName);
      return { createdAdmin: true, username: username };
    });
  }

  function maintenance() {
    const ctx = makeCtx();
    return ctx.write(function () {
      const expired = removeWhere(ctx, 'Sessions', function (s) { return s.expires < env.now(); });
      const keep = env.now() - 365 * 86400000;
      const oldAudit = removeWhere(ctx, 'AuditLog', function (a) { return a.at < keep; });
      return { expiredSessions: expired, oldAudit: oldAudit };
    });
  }

  return { handle: handle, setup: setup, maintenance: maintenance, TABLES: TABLES, _renderConversationText: renderConversationText, _renderSummaryText: renderSummaryText };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createCore: createCore, TABLES: TABLES, LIMITS: LIMITS };
