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
 *   env.archive.save({folder, files:[{name,content,mime}], audioFileIds}) -> {storage, path, fileId}
 *   env.archive.read({storage, path, fileId}) -> JSON text of task.json
 *   env.ai.transcribe(b64, mime)   -> {transcript, language, english_translation}
 *   env.ai.summarize(input)        -> {summary_en, summary_si, progress_note, health, blockers, next_steps}
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
  maxAssignees: 20, maxAudioB64: 6000000, maxWavB64: 9000000, maxVoiceSecs: 150, maxLinks: 3000
};
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
  ArchiveIndex: { key: 'id', cols: { id: 's', title: 's', creatorId: 's', creatorName: 's', assigneeNames: 's', participantIds: 'j', createdAt: 'n', closedAt: 'n', storage: 's', path: 's', fileId: 's', summaryText: 's', messageCount: 'n' } },
  AuditLog:     { key: 'id', cols: { id: 's', at: 'n', userId: 's', action: 's', detail: 's' } }
};

function createCore(env) {
  const ROUNDS = env.hashRounds || DEFAULT_HASH_ROUNDS;

  /* ============================== helpers ============================== */

  function fail(code, message) { const e = new Error(message); e.code = code; return e; }
  function newId(prefix) { return prefix + env.uuid().replace(/-/g, '').slice(0, 10); }
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
  function generateTempPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const token = env.randomToken();
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += alphabet[parseInt(token.substr(i * 2, 2), 16) % alphabet.length];
      if (i === 3 || i === 7) out += '-';
    }
    return out;
  }
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
  function msgView(ctx, m) {
    const s = brief(ctx, m.senderId);
    return { id: m.id, taskId: m.taskId, senderId: m.senderId, senderName: m.senderId ? s.name : 'System', senderTitle: s.jobTitle, type: m.type, text: m.text, transcript: m.transcript, translation: m.translation, lang: m.lang, status: m.status, hasAudio: !!m.audioFileId, audioSecs: m.audioSecs, createdAt: m.createdAt };
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
      lastMessage: last ? { senderName: last.senderId ? brief(ctx, last.senderId).name : 'System', type: last.type, text: clip(last.type === 'voice' ? (last.transcript || 'Voice message') : last.text, 90), at: last.createdAt } : null
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
    const list = function (x) { return Array.isArray(x) ? x.map(function (i) { return clip(i, 300); }).slice(0, 8) : []; };
    const health = ['on_track', 'at_risk', 'blocked', 'done', 'unknown'].indexOf(o.health) >= 0 ? o.health : 'unknown';
    return { summary_en: clip(o.summary_en, 1200), summary_si: clip(o.summary_si, 1500), progress_note: clip(o.progress_note, 600), health: health, blockers: list(o.blockers), next_steps: list(o.next_steps) };
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

  function meView(ctx, user) {
    const company = (ctx.rows('Settings').filter(function (x) { return x.key === 'companyName'; })[0] || {}).value || '';
    return { user: publicUser(ctx, user), companyName: company, canAssign: ctx.rows('Links').some(function (l) { return l.fromId === user.id; }) };
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
      const temp = req.password ? String(req.password) : generateTempPassword();
      checkPasswordPolicy(temp, username);
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
      const temp = generateTempPassword();
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

  A.assignable = { run: function (ctx, user) {
    const titles = titlesById(ctx), users = usersById(ctx), seen = {};
    return ctx.rows('Links').filter(function (l) { return l.fromId === user.id; }).map(function (l) { return users[l.toId]; })
      .filter(function (u) { if (!u || !u.active || seen[u.id]) return false; seen[u.id] = 1; return true; })
      .map(function (u) { return { id: u.id, name: u.name, jobTitle: (titles[u.jobTitleId] || {}).title || '', level: levelOf(u, titles) }; })
      .sort(function (a, b) { return a.level - b.level || a.name.localeCompare(b.name); });
  } };

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
      const r = env.ai.transcribe(wavB64 || audioB64, wavB64 ? 'audio/wav' : mime) || {};
      patch = { status: 'ok', transcript: clip(r.transcript, LIMITS.transcript), translation: clip(r.english_translation, LIMITS.transcript), lang: clip(r.language, 40) };
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
      const doc = JSON.parse(env.archive.read(idx));
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
    const input = {
      task: { title: t.title, description: t.description, progress: t.progress, status: t.status, dueDate: t.dueDate, manager: brief(ctx, t.creatorId).name, assignees: t.assigneeIds.map(function (id) { return brief(ctx, id).name; }) },
      messages: msgs.map(function (m) { return { time: env.formatDate(m.createdAt), from: m.senderId ? brief(ctx, m.senderId).name : 'System', role: m.senderId === t.creatorId ? 'manager' : (m.senderId ? 'assignee' : 'system'), type: m.type, text: m.type === 'voice' ? (m.transcript || '(voice message, not transcribed)') : m.text }; })
    };
    let summary;
    try { summary = normalizeSummary(env.ai.summarize(input)); }
    catch (e) { env.log('summary failed: ' + e); throw fail('AI_FAILED', 'The AI summary is not available right now. Please try again in a minute.'); }
    ctx.write(function () { update(ctx, 'Tasks', t.id, { summary: summary, summaryMsgCount: content, summaryAt: env.now() }); });
    return { summary: summary, summaryStale: false };
  } };

  /* ---------------- history / archive ---------------- */

  function archiveIndexFor(ctx, user, taskId) {
    const idx = ctx.rows('ArchiveIndex').filter(function (x) { return x.id === String(taskId || ''); })[0];
    if (!idx || idx.participantIds.indexOf(user.id) < 0) throw fail('NOT_FOUND', 'Task not found');
    return idx;
  }

  A.listHistory = { run: function (ctx, user, req) {
    const q = String(req.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.limit) || 30, 100)), offset = Math.max(0, Number(req.offset) || 0);
    let rows = ctx.rows('ArchiveIndex').filter(function (x) { return x.participantIds.indexOf(user.id) >= 0; });
    if (q) rows = rows.filter(function (x) { return (x.title + ' ' + x.creatorName + ' ' + x.assigneeNames + ' ' + x.summaryText).toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) { return b.closedAt - a.closedAt; });
    return { total: rows.length, items: rows.slice(offset, offset + limit).map(function (x) { return { id: x.id, title: x.title, creatorName: x.creatorName, assigneeNames: x.assigneeNames, createdAt: x.createdAt, closedAt: x.closedAt, summaryText: x.summaryText, messageCount: x.messageCount }; }) };
  } };

  A.getArchived = { run: function (ctx, user, req) {
    const idx = archiveIndexFor(ctx, user, req.taskId);
    return JSON.parse(env.archive.read(idx));
  } };

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'task'; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function renderArchiveHtml(doc) {
    const t = doc.task;
    const msgs = doc.messages.map(function (m) {
      const body = m.type === 'voice'
        ? '<em>Voice message (' + m.audioSecs + 's)</em><div>' + esc(m.transcript || 'No transcript available') + '</div>' + (m.translation && m.translation !== m.transcript ? '<div class="tr">English: ' + esc(m.translation) + '</div>' : '')
        : '<div>' + esc(m.text) + '</div>';
      return '<div class="m ' + esc(m.type) + '"><div class="who">' + esc(m.senderName) + ' &middot; ' + esc(m.time) + '</div>' + body + '</div>';
    }).join('\n');
    const s = t.summary && t.summary.summary_en ? '<h2>AI summary</h2><p>' + esc(t.summary.summary_en) + '</p><p>' + esc(t.summary.summary_si) + '</p>' : '';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(t.title) + '</title>' +
      '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1c2430}.m{border:1px solid #dde2ea;border-radius:10px;padding:10px;margin:8px 0}.m.system{background:#f3f5f8;color:#586272;font-size:.9em}.who{font-size:.8em;color:#6b7685}.tr{color:#6b7685;font-size:.9em}dl{display:grid;grid-template-columns:140px 1fr;gap:4px 12px}dt{color:#6b7685}</style></head><body>' +
      '<h1>' + esc(t.title) + '</h1><dl><dt>Assigned by</dt><dd>' + esc(t.creator.name) + '</dd><dt>Assigned to</dt><dd>' + esc(t.assignees.map(function (a) { return a.name; }).join(', ')) + '</dd>' +
      '<dt>Started</dt><dd>' + esc(t.startedText) + '</dd><dt>Completed</dt><dd>' + esc(t.completedText) + '</dd><dt>Progress</dt><dd>' + t.progress + '%</dd></dl>' +
      (t.description ? '<p>' + esc(t.description) + '</p>' : '') + s + '<h2>Conversation</h2>' + msgs + '</body></html>';
  }

  function archiveTask(ctx, closer, t) {
    const msgs = messagesOf(ctx, t.id), closedAt = env.now();
    const doc = {
      version: 1, id: t.id,
      task: { id: t.id, title: t.title, description: t.description, creator: brief(ctx, t.creatorId), assignees: t.assigneeIds.map(function (id) { return brief(ctx, id); }), createdAt: t.createdAt, closedAt: closedAt, startedText: env.formatDate(t.createdAt), completedText: env.formatDate(closedAt), dueDate: t.dueDate, progress: 100, approvedBy: closer.name, summary: t.summary || null },
      messages: msgs.map(function (m) { return { id: m.id, senderId: m.senderId, senderName: m.senderId ? brief(ctx, m.senderId).name : 'System', type: m.type, text: m.text, transcript: m.transcript, translation: m.translation, lang: m.lang, status: m.status, audioFileId: m.audioFileId, audioMime: m.audioMime, audioSecs: m.audioSecs, createdAt: m.createdAt, time: env.formatDate(m.createdAt) }; })
    };
    const d = env.formatDate(closedAt);
    const folder = d.slice(0, 4) + '/' + d.slice(5, 7) + '/' + t.id + '-' + slug(t.title);
    const saved = env.archive.save({
      folder: folder,
      files: [{ name: 'task.json', content: JSON.stringify(doc, null, 1), mime: 'application/json' }, { name: 'conversation.html', content: renderArchiveHtml(doc), mime: 'text/html' }],
      audioFileIds: msgs.map(function (m) { return m.audioFileId; }).filter(Boolean)
    });
    const participantIds = [t.creatorId].concat(t.assigneeIds);
    insert(ctx, 'ArchiveIndex', { id: t.id, title: t.title, creatorId: t.creatorId, creatorName: doc.task.creator.name, assigneeNames: doc.task.assignees.map(function (a) { return a.name; }).join(', '), participantIds: participantIds, createdAt: t.createdAt, closedAt: closedAt, storage: saved.storage, path: saved.path, fileId: saved.fileId, summaryText: clip(t.summary && t.summary.summary_en, 400), messageCount: countContent(msgs) });
    // Only after the archive is safely written do we remove the live rows.
    removeWhere(ctx, 'Messages', function (m) { return m.taskId === t.id; });
    removeWhere(ctx, 'Reads', function (r) { return r.taskId === t.id; });
    removeWhere(ctx, 'Tasks', function (x) { return x.id === t.id; });
    audit(ctx, closer, 'task.archive', t.id);
    return { archived: true, id: t.id };
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

  return { handle: handle, setup: setup, maintenance: maintenance, TABLES: TABLES, _renderArchiveHtml: renderArchiveHtml };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createCore: createCore, TABLES: TABLES, LIMITS: LIMITS };
