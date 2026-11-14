/* speech.js - the assistant talking back.
 * 1. The voice of the device (default): free, instant, no limit. Phones and Microsoft Edge ship very natural voices; the person
 *    can pick the best one installed on their device (Speech.voices / setVoice).
 * 2. Optional "studio voice": a Gemini speech model through the backend. Sounds great but the free daily quota is small,
 *    so it is off by default, and when the quota runs out the device voice takes over by itself.
 * Nothing is stored; the audio is played and thrown away. */
(function (w) {
  'use strict';
  const KEY = 'taskapp.speak', KEY_ENGINE = 'taskapp.engine', KEY_VOICE = 'taskapp.voiceuri';
  const syn = w.speechSynthesis || null;
  let voices = [], gen = 0, speaking = false, failUntil = 0, player = null;

  function loadVoices() { try { voices = syn ? syn.getVoices() : []; } catch (e) { voices = []; } }
  if (syn) { loadVoices(); if (syn.addEventListener) syn.addEventListener('voiceschanged', loadVoices); }

  /* ---------- the voice built into the browser (fallback) ---------- */
  function isNatural(v) { return /natural|neural|online|enhanced|premium|siri|google|wavenet/i.test(v.name); }
  function score(v) {
    let s = 0;
    if (/en[-_]GB/i.test(v.lang)) s += 6; else if (/en[-_]IN/i.test(v.lang)) s += 5; else if (/en[-_](US|AU)/i.test(v.lang)) s += 3;
    if (/natural|neural|online|enhanced|premium|siri|wavenet/i.test(v.name)) s += 10; else if (/google/i.test(v.name)) s += 5;
    if (/female|sonia|libby|aria|jenny|samantha|karen|veena|heera|neerja|serena|moira/i.test(v.name)) s += 1;
    return s;
  }
  function englishVoices() {
    if (!voices.length) loadVoices();
    return voices.filter(function (v) { return /^en[-_]/i.test(v.lang); }).sort(function (a, b) { return score(b) - score(a); });
  }
  function pickVoice(lang, uri) {
    const english = englishVoices();
    if (uri) { const chosen = voices.filter(function (v) { return v.voiceURI === uri; })[0]; if (chosen) return chosen; }
    if (lang === 'si') { const si = voices.filter(function (v) { return /^si/i.test(v.lang); })[0]; if (si) return si; }
    let saved = ''; try { saved = localStorage.getItem(KEY_VOICE) || ''; } catch (e) { /* storage blocked */ }
    const mine = saved ? english.filter(function (v) { return v.voiceURI === saved; })[0] : null;
    return mine || english[0] || null;
  }
  function clean(text) {
    return String(text || '').replace(/\(Note:[^)]*\)/g, '').replace(/\[(?:late|urgent|bad|overdue|blocked|wait|watch|pending|good|ok|done|info|note)\]\s*/gi, '').replace(/\[(\d{1,3})%\]/g, '$1 percent').replace(/\(?\b(?:task\s+|user\s+)?ids?\b[\s:=#]*[A-Za-z](?=[A-Za-z0-9]*\d)[A-Za-z0-9]{7,14}\b\)?/gi, '').replace(/\b[A-Za-z](?=[0-9a-f]*\d)[0-9a-f]{9,11}\b/g, '').replace(/[*_#`>~]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s*\n+\s*/g, '. ').replace(/\s+/g, ' ').trim();
  }
  function sentences(text, max) {
    const out = []; let cur = '';
    text.split(/(?<=[.!?])\s+/).forEach(function (s) {
      if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
    });
    if (cur) out.push(cur);
    return out;
  }
  function browserSpeak(parts, my, o) {
    if (!syn || !w.SpeechSynthesisUtterance) { speaking = false; if (o.onend) o.onend(); return; }
    let i = 0; const sinhala = /[඀-෿]/.test(parts.join(' '));
    const next = function () {
      if (my !== gen) return;
      if (i >= parts.length) { speaking = false; if (o.onend) o.onend(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]), v = pickVoice(sinhala ? 'si' : 'en', o.voiceUri);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = sinhala ? 'si-LK' : 'en-GB';
      u.rate = 0.97; u.pitch = 1; u.onend = next; u.onerror = next;
      try { syn.speak(u); } catch (e) { next(); }
    };
    next();
  }

  /* ---------- the natural voice ---------- */
  // The backend sends raw 16-bit PCM; wrap it so an <audio> element can play it.
  function pcmUrl(b64, mime) {
    if (/^UklGR/.test(b64)) { const raw = atob(b64), u8 = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i); return URL.createObjectURL(new Blob([u8], { type: 'audio/wav' })); }   // already a WAV file
    const rate = Number((/rate=(\d+)/.exec(mime || '') || [])[1]) || 24000;
    const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n, true);
    const bytes = new Uint8Array(buf); for (let i = 0; i < n; i++) bytes[44 + i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function silentUrl() {
    const b = new Uint8Array(44 + 2), v = new DataView(b.buffer), str = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 38, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function fetchPart(text) {
    return w.Api.call('speak', { text: text }, { timeout: 45000 }).then(function (r) { return pcmUrl(r.b64, r.mime); });
  }
  function playUrl(url, my) {
    return new Promise(function (resolve, reject) {
      if (!player) player = new Audio();
      player.onended = function () { resolve(); };
      player.onerror = function () { reject(new Error('playback failed')); };
      player.src = url;
      const p = player.play(); if (p && p.catch) p.catch(reject);
    });
  }

  const Speech = {
    supported: !!(syn && w.SpeechSynthesisUtterance) || !!w.Audio,
    enabled: function () { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } },
    setEnabled: function (on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ } if (!on) Speech.stop(); },
    // 'device' (default) or 'studio' (Gemini, limited free quota)
    studio: function () { try { return localStorage.getItem(KEY_ENGINE) === 'studio'; } catch (e) { return false; } },
    setStudio: function (on) { try { localStorage.setItem(KEY_ENGINE, on ? 'studio' : 'device'); } catch (e) { /* storage blocked */ } },
    // English voices installed on this device, best first: [{ uri, name, lang, natural }]
    voices: function () { return englishVoices().map(function (v) { return { uri: v.voiceURI, name: v.name, lang: v.lang, natural: isNatural(v) }; }); },
    voice: function () { const v = pickVoice('en'); return v ? v.voiceURI : ''; },
    setVoice: function (uri) { try { localStorage.setItem(KEY_VOICE, uri || ''); } catch (e) { /* storage blocked */ } },
    onVoicesChanged: function (fn) { if (syn && syn.addEventListener) syn.addEventListener('voiceschanged', fn); },
    isSpeaking: function () { return speaking; },
    // Call this from a tap/click: phones only allow sound that was "unlocked" by a touch.
    unlock: function () {
      try { if (!player) player = new Audio(); if (!player.__unlocked) { player.__unlocked = true; player.src = silentUrl(); const p = player.play(); if (p && p.catch) p.catch(function () { player.__unlocked = false; }); } } catch (e) { /* ignore */ }
    },
    stop: function () { gen++; speaking = false; if (player) { try { player.pause(); player.onended = null; } catch (e) { /* ignore */ } } if (syn) { try { syn.cancel(); } catch (e) { /* ignore */ } } },
    // o: { onstart, onend (not called when stopped by stop()) }
    speak: function (text, o) {
      o = o || {}; Speech.stop();
      const plain = clean(text);
      if (!plain) { if (o.onend) o.onend(); return; }
      const my = ++gen; speaking = true;
      const useNatural = Speech.studio() && !o.voiceUri && w.Api && w.Api.token && !w.Api.demo && Date.now() > failUntil;
      if (!useNatural) { if (o.onstart) o.onstart(); return browserSpeak(sentences(plain, 170), my, o); }
      // the first sentence alone (so it starts as soon as possible), then the rest in chunks
      const firstMatch = /^.*?[.!?](?=\s|$)/.exec(plain), first = firstMatch ? firstMatch[0] : plain, parts = [first].concat(sentences(plain.slice(first.length).trim(), 150).filter(Boolean)), jobs = [];
      const job = function (i) { if (i < parts.length && !jobs[i]) { jobs[i] = fetchPart(parts[i]); jobs[i].catch(function () { /* handled when its turn comes */ }); } return jobs[i]; };
      (async function () {
        let started = false;
        for (let i = 0; i < parts.length; i++) {
          job(i); job(i + 1);                                           // the next sentence is prepared while this one plays
          let url;
          try { url = await jobs[i]; }
          catch (e) {                                                   // not available: say the rest with the browser's voice, and stop asking for a while
            failUntil = Date.now() + 5 * 60000;
            if (my !== gen) return;
            if (!started && o.onstart) o.onstart();
            return browserSpeak(sentences(parts.slice(i).join(' '), 170), my, o);
          }
          if (my !== gen) return;
          if (!started) { started = true; if (o.onstart) o.onstart(); }
          try { await playUrl(url, my); }
          catch (e) { if (my !== gen) return; failUntil = Date.now() + 5 * 60000; return browserSpeak(sentences(parts.slice(i).join(' '), 170), my, o); }
          if (my !== gen) return;
        }
        speaking = false; if (o.onend) o.onend();
      })();
    }
  };
  w.Speech = Speech;
})(window);
