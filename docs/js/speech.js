/* speech.js - the assistant talking back (text-to-speech built into the browser; free, nothing is sent anywhere). */
(function (w) {
  'use strict';
  const KEY = 'taskapp.speak';
  const syn = w.speechSynthesis || null;
  let voices = [], gen = 0, speaking = false;

  function loadVoices() { try { voices = syn ? syn.getVoices() : []; } catch (e) { voices = []; } }
  if (syn) { loadVoices(); if (syn.addEventListener) syn.addEventListener('voiceschanged', loadVoices); }

  // Prefer a clear English voice. Sri Lankan listeners usually find British / Indian English easiest; US is the fallback.
  function pickVoice(lang) {
    if (!voices.length) loadVoices();
    const english = voices.filter(function (v) { return /^en[-_]/i.test(v.lang); });
    const score = function (v) {
      let s = 0;
      if (/en[-_]GB/i.test(v.lang)) s += 6; else if (/en[-_]IN/i.test(v.lang)) s += 5; else if (/en[-_]US/i.test(v.lang)) s += 3;
      if (/google|natural|online|neural/i.test(v.name)) s += 4;
      if (/female|sonia|libby|aria|samantha|karen|veena|heera/i.test(v.name)) s += 1;
      if (v.localService === false) s += 1;
      return s;
    };
    if (lang === 'si') { const si = voices.filter(function (v) { return /^si/i.test(v.lang); })[0]; if (si) return si; }
    return english.sort(function (a, b) { return score(b) - score(a); })[0] || null;
  }

  function clean(text) {
    return String(text || '').replace(/\(Note:[^)]*\)/g, '').replace(/[*_#`>~]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s*\n+\s*/g, '. ').replace(/\s+/g, ' ').trim();
  }
  // Long utterances are cut off after about 15 seconds in some browsers, so read sentence by sentence.
  function split(text) {
    const out = []; let cur = '';
    text.split(/(?<=[.!?])\s+/).forEach(function (s) {
      if ((cur + ' ' + s).length > 170 && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
    });
    if (cur) out.push(cur);
    return out;
  }

  const Speech = {
    supported: !!(syn && w.SpeechSynthesisUtterance),
    enabled: function () { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } },
    setEnabled: function (on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ } if (!on) Speech.stop(); },
    isSpeaking: function () { return speaking; },
    stop: function () { gen++; speaking = false; if (syn) { try { syn.cancel(); } catch (e) { /* ignore */ } } },
    // o: { onstart, onend (not called when stopped by stop()) }
    speak: function (text, o) {
      o = o || {}; Speech.stop();
      const parts = split(clean(text));
      if (!Speech.supported || !parts.length) { if (o.onend) o.onend(); return; }
      const my = ++gen; let i = 0;
      const sinhala = /[඀-෿]/.test(text);
      const next = function () {
        if (my !== gen) return;
        if (i >= parts.length) { speaking = false; if (o.onend) o.onend(); return; }
        const u = new SpeechSynthesisUtterance(parts[i++]), v = pickVoice(sinhala ? 'si' : 'en');
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = sinhala ? 'si-LK' : 'en-GB';
        u.rate = 1; u.pitch = 1; u.onend = next; u.onerror = next;
        try { syn.speak(u); } catch (e) { next(); }
      };
      speaking = true; if (o.onstart) o.onstart();
      next();
    }
  };
  w.Speech = Speech;
})(window);
