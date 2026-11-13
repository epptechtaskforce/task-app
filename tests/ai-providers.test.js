'use strict';
// Tests the AI adapters in backend/Adapters.gs (Claude first when a key exists, Gemini as the back-up, busy models skipped) against fake Apps Script services.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function world(props, route) {
  const calls = [], cache = new Map();
  const sandbox = {
    console: { error: function () {}, log: function () {} },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cache.has(k) ? cache.get(k) : null; }, put: function (k, v) { cache.set(k, String(v)); }, getAll: function () { return {}; }, remove: function (k) { cache.delete(k); } }; } },
    UrlFetchApp: { fetch: function (url, opts) {
      const body = typeof opts.payload === 'string' ? JSON.parse(opts.payload) : (opts.payload || {}); calls.push({ url: url, body: body, headers: opts.headers });
      const r = route(url, body, calls.length);
      return { getResponseCode: function () { return r.code; }, getContentText: function () { return r.text; } };
    } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    Utilities: { base64Decode: function (s) { return Buffer.from(s, 'base64'); }, newBlob: function (b, mime, name) { return { bytes: b, mime: mime, name: name, getDataAsString: function () { return Buffer.from(b).toString('utf8'); } }; } },
    Session: { getScriptTimeZone: function () { return 'UTC'; } },
    DriveApp: {}, SpreadsheetApp: {}, ScriptApp: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Adapters.gs'), 'utf8'), sandbox);
  return { sb: sandbox, calls: calls, cache: cache };
}
const gemini = (obj) => ({ code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const claude = (obj, fenced) => ({ code: 200, text: JSON.stringify({ content: [{ type: 'text', text: fenced ? '```json\n' + JSON.stringify(obj) + '\n```' : JSON.stringify(obj) }] }) });
const INPUT = { context: 'TODAY: x', history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], text: 'What is late?', audio: null, pending: [], focus: null, files: [], userName: 'Geeth' };

test('without a Claude key the AI is Gemini only', () => {
  const w = world({ GEMINI_API_KEY: 'g' }, () => gemini({ reply: 'from gemini' }));
  const ai = w.sb.makeAi_();
  assert.equal(ai.constructor.name, 'GeminiAi_');
  assert.equal(ai.assistant(INPUT).reply, 'from gemini');
  assert.ok(w.calls[0].url.indexOf('generativelanguage.googleapis.com') > 0);
});

test('with a Claude key, text questions go to Claude with the same instructions, history and a JSON-only reminder', () => {
  const w = world({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'sk-test' }, (url) => url.indexOf('anthropic') > 0 ? claude({ reply: 'from claude', actions: [] }, true) : gemini({ reply: 'from gemini' }));
  const out = w.sb.makeAi_().assistant(INPUT);
  assert.equal(out.reply, 'from claude');                                           // a ```json fence is handled
  assert.equal(w.calls.length, 1);
  const c = w.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['x-api-key'], 'sk-test'); assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.body.model, 'claude-haiku-5-5');
  assert.ok(c.body.system.includes('=== CONTEXT ===') && c.body.system.includes('JSON object only'));
  assert.deepEqual(c.body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(c.body.messages[2].content[c.body.messages[2].content.length - 1].text, 'What is late?');
});

test('the model can be chosen, and a model that refuses "temperature" is asked again without it', () => {
  let n = 0;
  const w = world({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' }, () => (++n === 1 ? { code: 400, text: 'temperature is not supported' } : claude({ headline: 'h', items: [] })));
  const out = w.sb.makeAi_().briefing({ context: 'c', userName: 'u' });
  assert.equal(out.headline, 'h');
  assert.equal(w.calls[0].body.model, 'claude-sonnet-5-5'); assert.equal(w.calls[0].body.temperature, 0.3); assert.equal(w.calls[1].body.temperature, undefined);
});

test('spoken questions and voice messages stay with Gemini because Claude cannot hear', () => {
  const w = world({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'k' }, () => gemini({ reply: 'g', english: 'said' }));
  const ai = w.sb.makeAi_();
  ai.assistant(Object.assign({}, INPUT, { audio: { b64: 'AAAA', mime: 'audio/wav' }, text: '' }));
  ai.transcribe('AAAA', 'audio/wav', 'hints');
  assert.ok(w.calls.every((c) => c.url.indexOf('anthropic') < 0));
});

test('if Claude fails, Gemini answers, and Claude is left alone for a couple of minutes', () => {
  const w = world({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'k' }, (url) => url.indexOf('anthropic') > 0 ? { code: 529, text: 'overloaded' } : gemini({ reply: 'from gemini' }));
  const ai = w.sb.makeAi_();
  assert.equal(ai.assistant(INPUT).reply, 'from gemini');
  const first = w.calls.length;
  assert.ok(w.calls[0].url.indexOf('anthropic') > 0);
  assert.equal(ai.assistant(INPUT).reply, 'from gemini');
  assert.ok(w.calls.slice(first).every((c) => c.url.indexOf('anthropic') < 0));         // not tried again straight away
});

test('files are passed to Claude as images, PDFs or text', () => {
  const w = world({ ANTHROPIC_API_KEY: 'k' }, () => claude({ reply: 'ok' }));
  const files = [{ name: 'a.jpg', mime: 'image/jpeg', b64: 'AAAA' }, { name: 'b.pdf', mime: 'application/pdf', b64: 'BBBB' }, { name: 'c.csv', mime: 'text/csv', b64: Buffer.from('x,y\n1,2').toString('base64') }];
  w.sb.makeAi_().assistant(Object.assign({}, INPUT, { files: files }));
  const kinds = w.calls[0].body.messages[w.calls[0].body.messages.length - 1].content.map((b) => b.type + (b.text && b.text.indexOf('x,y') > 0 ? ':csv' : ''));
  assert.ok(kinds.includes('image') && kinds.includes('document') && kinds.includes('text:csv'));
});

test('a Gemini model that just said "busy" is tried last for a few minutes', () => {
  const w = world({ GEMINI_API_KEY: 'g' }, (url) => (/gemini-3\.1-flash-lite/.test(url) ? { code: 503, text: 'busy' } : gemini({ reply: 'ok' })));
  const ai = w.sb.makeAi_();
  ai.assistant(INPUT);                                                                 // typed: the fast model first, it is busy, the next one answers
  assert.ok(/flash-lite/.test(w.calls[0].url) && !/flash-lite/.test(w.calls[1].url));
  const before = w.calls.length;
  ai.assistant(INPUT);
  assert.ok(!/flash-lite/.test(w.calls[before].url));                                   // the busy one is not waited for again
});

const groqChat = (obj) => ({ code: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
const GROQ_MODELS = { code: 200, text: JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }, { id: 'whisper-large-v3' }, { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-20b' }, { id: 'something-else' }] }) };
const isGroq = (u) => u.indexOf('api.groq.com') > 0;

test('Groq: the best available models are found, and the chat request is shaped like the OpenAI API with JSON mode', () => {
  const w = world({ GROQ_API_KEY: 'gsk-test' }, (url) => (/\/models$/.test(url) ? GROQ_MODELS : isGroq(url) ? groqChat({ reply: 'from groq', actions: [] }) : gemini({ reply: 'g' })));
  const out = w.sb.makeAi_().assistant(INPUT);
  assert.equal(out.reply, 'from groq');
  const chat = w.calls.filter((c) => /chat\/completions$/.test(c.url))[0];
  assert.equal(chat.headers.Authorization, 'Bearer gsk-test');
  assert.equal(chat.body.model, 'llama-3.3-70b-versatile');                                 // preferred over the 8B one even though it is listed later
  assert.deepEqual(chat.body.response_format, { type: 'json_object' });
  assert.equal(chat.body.messages[0].role, 'system'); assert.ok(chat.body.messages[0].content.includes('=== CONTEXT ==='));
  assert.deepEqual(chat.body.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(chat.body.reasoning_effort, undefined);
});

test('Groq: a model that says "slow down" (429) is skipped, the next one answers, and the busy one is left alone next time', () => {
  const w = world({ GROQ_API_KEY: 'k', GROQ_MODELS: 'llama-3.3-70b-versatile,openai/gpt-oss-20b' }, (url, body) => (body.model === 'llama-3.3-70b-versatile' ? { code: 429, text: 'rate limit' } : groqChat({ reply: 'second model' })));
  const ai = w.sb.makeAi_();
  assert.equal(ai.assistant(INPUT).reply, 'second model');
  assert.equal(w.calls[1].body.reasoning_effort, 'low');                                   // gpt-oss: no long hidden thinking
  const n = w.calls.length;
  ai.assistant(INPUT);
  assert.equal(w.calls[n].body.model, 'openai/gpt-oss-20b');                                // went straight to the one that works
});

test('Groq: when every model is busy, Gemini answers (and Groq is not asked again for a minute or two)', () => {
  const w = world({ GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g', GROQ_MODELS: 'a,b' }, (url) => (isGroq(url) ? { code: 429, text: 'busy' } : gemini({ reply: 'from gemini' })));
  const ai = w.sb.makeAi_();
  assert.equal(ai.assistant(INPUT).reply, 'from gemini');
  const n = w.calls.length;
  assert.equal(ai.assistant(INPUT).reply, 'from gemini');
  assert.ok(w.calls.slice(n).every((c) => !isGroq(c.url)));
});

test('Groq: a spoken question is heard by Whisper (any language to English, with names as hints) and then answered like a typed one', () => {
  const w = world({ GROQ_API_KEY: 'k', GROQ_MODELS: 'llama-3.3-70b-versatile' }, (url) => (/audio\/translations$/.test(url) ? { code: 200, text: JSON.stringify({ text: ' Give Janith a task to check the cold room. ' }) } : groqChat({ heard: 'wrong', reply: 'done', actions: [] })));
  const out = w.sb.makeAi_().assistant(Object.assign({}, INPUT, { text: '', audio: { b64: Buffer.from('RIFFxxxx').toString('base64'), mime: 'audio/wav' } }));
  const whisper = w.calls.filter((c) => /translations$/.test(c.url))[0];
  assert.equal(whisper.body.model, 'whisper-large-v3'); assert.equal(whisper.body.file.name, 'speech.wav'); assert.ok(whisper.body.prompt.includes('TODAY'));
  const chat = w.calls.filter((c) => /chat\/completions$/.test(c.url))[0];
  assert.equal(chat.body.messages[chat.body.messages.length - 1].content, 'Give Janith a task to check the cold room.');
  assert.equal(out.heard, 'Give Janith a task to check the cold room.');                  // what Whisper heard, not the chat model's guess
  assert.ok(w.calls.every((c) => c.url.indexOf('generativelanguage') < 0));
});

test('Groq: if Whisper fails, Gemini listens to the sound instead', () => {
  const w = world({ GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g' }, (url) => (isGroq(url) ? { code: 500, text: 'down' } : gemini({ heard: 'ok', reply: 'from gemini' })));
  const out = w.sb.makeAi_().assistant(Object.assign({}, INPUT, { text: '', audio: { b64: 'AAAA', mime: 'audio/wav' } }));
  assert.equal(out.reply, 'from gemini');
  const g = w.calls.filter((c) => c.url.indexOf('generativelanguage') > 0)[0];
  assert.ok(JSON.stringify(g.body).indexOf('inlineData') > 0);                              // the audio went to Gemini
});

test('Groq: voice messages in a chat are written in English by Whisper (names as hints)', () => {
  const w = world({ GROQ_API_KEY: 'k' }, () => ({ code: 200, text: JSON.stringify({ text: 'The pump is fixed.' }) }));
  const out = w.sb.makeAi_().transcribe('AAAA', 'audio/webm', 'Task: Irrigation. People: Janith.');
  assert.equal(out.english, 'The pump is fixed.');
  assert.equal(w.calls[0].body.file.name, 'speech.webm'); assert.ok(w.calls[0].body.prompt.includes('Janith'));
});

test('Groq cannot look at pictures or PDFs, so a question with files goes to a provider that can', () => {
  const w = world({ GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g' }, (url) => (isGroq(url) ? groqChat({ reply: 'groq' }) : gemini({ reply: 'from gemini, with the picture' })));
  const out = w.sb.makeAi_().assistant(Object.assign({}, INPUT, { files: [{ name: 'a.jpg', mime: 'image/jpeg', b64: 'AAAA' }] }));
  assert.equal(out.reply, 'from gemini, with the picture');
  assert.ok(w.calls.every((c) => !isGroq(c.url)));
});

test('the chain order is Claude, then Groq, then Gemini', () => {
  const w = world({ ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g', GEMINI_API_KEY: 'x', GROQ_MODELS: 'm' }, (url) => (url.indexOf('anthropic') > 0 ? { code: 529, text: 'overloaded' } : isGroq(url) ? groqChat({ reply: 'groq answered' }) : gemini({ reply: 'gemini' })));
  assert.equal(w.sb.makeAi_().assistant(INPUT).reply, 'groq answered');
  assert.ok(w.calls[0].url.indexOf('anthropic') > 0 && isGroq(w.calls[1].url));
});
