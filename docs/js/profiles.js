/* profiles.js - pictures and short bios of the people you work with.
 * The server sends only what changed (a version number per person), so this is one small call, kept in this browser
 * and wiped at sign-out like the rest of the saved data. If the server does not know the "profiles" action yet
 * (older backend), everything quietly falls back to initials.
 */
(function (w) {
  'use strict';
  const KEY = 'profiles';
  const P = {
    map: {}, last: 0, busy: null, listeners: [],
    load: function () { P.map = (w.Api && w.Api.cacheGet(KEY)) || {}; },
    get: function (id) { return P.map[id] || null; },
    photo: function (id) { const p = P.map[id]; return (p && p.photo) || ''; },
    bio: function (id) { const p = P.map[id]; return (p && p.bio) || ''; },
    onChange: function (fn) { P.listeners.push(fn); },
    emit: function () { P.listeners.forEach(function (f) { try { f(); } catch (e) { /* a listener must never break the others */ } }); },
    store: function () { if (w.Api) w.Api.cacheSet(KEY, P.map); },
    reset: function () { P.map = {}; P.last = 0; P.busy = null; },
    // Ask for changes. Skipped when asked again within a minute (unless force).
    refresh: function (force) {
      if (!w.Api || !w.Api.token) return Promise.resolve();
      if (P.busy) return P.busy;
      if (!force && Date.now() - P.last < 60000) return Promise.resolve();
      P.last = Date.now();
      P.busy = (async function () {
        try {
          const have = {}; Object.keys(P.map).forEach(function (id) { have[id] = P.map[id].ver; });
          const r = await w.Api.call('profiles', { have: have });
          let changed = false;
          r.profiles.forEach(function (p) {
            const cur = P.map[p.userId] || {};
            const next = { bio: p.bio || '', ver: p.ver || 0, photo: p.photo !== undefined ? p.photo : (cur.photo || '') };
            if (cur.bio !== next.bio || cur.ver !== next.ver || cur.photo !== next.photo) { P.map[p.userId] = next; changed = true; }
          });
          if (changed) { P.store(); P.emit(); }
        } catch (e) { /* offline, or an older backend: initials are shown instead */ }
        finally { P.busy = null; }
      })();
      return P.busy;
    },
    // patch: { bio?, photo? }  (photo = JPEG data URL, '' removes it)
    saveMine: async function (patch) {
      const r = await w.Api.call('saveProfile', patch);
      const p = r.profile;
      P.map[p.userId] = { bio: p.bio || '', ver: p.ver || 0, photo: p.photo || '' };
      P.store(); P.emit();
      return p;
    }
  };
  w.Profiles = P;
})(window);
