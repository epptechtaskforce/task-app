# CLAUDE.md - project guide for AI coding assistants

A task-assigning and monitoring web app for a company of about 20 people: managers assign tasks down an org pyramid, people
report progress with a slider, talk in a shared task conversation (text, voice, files), managers approve, finished tasks go to
a History archive, and a floating AI bubble answers questions, navigates the app and proposes actions.
Everything runs on free tools. Read `README.md` first for deployment; this file is the working knowledge.

## Architecture (no server of our own)

```
Browser (docs/, plain HTML/CSS/JS, GitHub Pages) --POST JSON, text/plain--> Google Apps Script web app (backend/)
                                                                              |- Core.gs      business rules, permissions, AI orchestration (pure JS, tested)
                                                                              |- Adapters.gs  Google Sheets (database), Drive (voice, files, archive), AI providers
                                                                              |- Code.gs      doGet/doPost entry points
                                                                              '- Setup.gs     one-time setup, backups, smoke/speed/mock-data helpers (run by hand in the editor)
```

- **One Core, three hosts.** `backend/Core.gs` runs in Apps Script, in the browser demo (`docs/js/core.js`, a generated copy)
  and in the Node tests. **After every edit of `Core.gs` run `node tools/sync-core.js`** (a test fails if the copy is stale).
- **Environment interface.** Core only talks to an `env` object (store, files, ai, clock, settings). `Adapters.gs` builds the real
  one (`makeEnv_`); `docs/js/memory-env.js` builds the in-memory one (demo + tests). New capabilities go through `env`.
- **Demo mode.** `?demo=1` runs everything in the browser with fake data (`docs/js/demo.js`, `demo-data.js`); the demo AI is a
  rule-based stand-in (`fakeAi` in `memory-env.js`).
- **Requests.** `docs/js/api.js` -> `Api.call(action, params, opts)`. Every request needs a login token except `info`/`login`.
  Errors carry `e.code` (`AUTH`, `FORBIDDEN`, `VALIDATION`, `LOCKED`, `MUSTCHANGE`, `AI_FAILED`...).

## Layout

| Path | What |
|---|---|
| `backend/Core.gs` | All actions (`A.login`, `A.createTask`, `A.assistant`, ...), tables, permissions, AI context builders, action validation (`cleanAction`) |
| `backend/Adapters.gs` | Sheets store with CacheService table cache, Drive files, AI providers (Gemini, Groq, Claude) and the provider chain |
| `backend/Setup.gs` | `setup`, `installTriggers`, `smokeTest`, `speedTest`, `speechTest`, mock-data tools (`mockSeed`, `mockStatus`, `mockClean`, `mockInspect`) |
| `docs/index.html` | Loads scripts with `?v=<number>`; **bump that number in every release** (browsers cache hard) |
| `docs/js/app.js` | Screens, routing, task list/filters, task page, admin pages, `App.showTask/showPage` |
| `docs/js/assistant.js` | The floating AI bubble and the home "Today at a glance" card |
| `docs/js/speech.js`, `audio.js` | Text-to-speech (device voices) and microphone recording/silence detection |
| `docs/js/org.js` | Admin org-chart canvas (job titles by layer, drag "arrows" between people) |
| `docs/js/config.js` | `backendUrl` (empty in the generic code; the company deployment fills it in its own branch) |
| `tests/` | `npm test` (Node 20+, no dependencies) |
| `tools/sync-core.js` | Copies `Core.gs` to `docs/js/core.js` |

## Product rules (enforced on the server, never only in the UI)

- Own username/password (salted iterated hash), lock-out after 5 wrong attempts for 15 minutes, forced change of temporary passwords.
- **Org pyramid.** Job titles have a layer (1 = top). The admin draws directional "arrows" (tethers) from a person to people below;
  you can only assign tasks to people your arrows point to; layers may be skipped; one person can have several managers.
- Admins manage accounts and the org chart but **cannot read other people's tasks**; a "pure admin" has no job title and no AI.
- Only assignees move the progress slider; 100% sends the task to the creator for approval; only the creator approves
  (task moves to the History archive with its conversation) or sends it back (progress 90%).
- Closed tasks are written to the archive (Drive JSON + `ArchiveIndex` row) first, then removed from the live sheet.
- User text must never run as a spreadsheet formula (the Sheets adapter prefixes risky text with an apostrophe).
- The app is **English only**. Sinhala/Tamil speech is translated to English; voice messages in a task chat show only as audio,
  while the English transcript and key points are kept hidden as the AI's memory of the task.
- Company data must never be public; production resources live under the company's own accounts, not personal ones.

## The AI

- **Who may use it:** Senior General Managers and above. `aiAllowed(ctx, user)` in `Core.gs`: the user's layer must be <= the layer of the
  job title that looks like "Senior General Manager" / "Senior GM" / "SGM"; script property `AI_MAX_LEVEL` (a layer number) overrides.
  Enforced in `assistant`, `briefing`, `speak` and creating NEW task summaries (`needAi`); `me`/`login` return `canUseAi`.
  Everyone can still read stored summaries; voice-message transcription stays automatic.
- **Providers** (`makeAi_()` in `Adapters.gs`): `CompositeAi_` tries Claude (if `ANTHROPIC_API_KEY`), then Groq (if `GROQ_API_KEY`: Llama / gpt-oss chat
  models, Whisper for any-language-to-English speech), then Gemini (`GEMINI_API_KEY`, always last, also the only one that can look at
  pictures/PDFs and make natural speech). A failing provider is skipped for 90 s; busy models are remembered per model.
- **The model only PROPOSES.** `A.assistant` returns `{heard, reply, spoken, confirm, actions}`. `cleanAction` validates every action against what the
  person may do; the browser executes after confirmation. Actions: `create_task`, `set_progress`, `post_message`, `approve_task`, `send_back`,
  `update_task` (need confirmation), `open_task` and `show_page` (navigation; no confirmation). Never let model output change data directly.
- **Security.** Task titles, messages and file contents are untrusted input (prompt-injection): the prompt says to follow only the person's own words.
- **Prompt and context.** `ASSISTANT_PROMPT_` and builders in `Adapters.gs`; context assembled in `Core.gs` (`aiContext`, `aiContextFit` tiers to keep prompts small for free-tier limits).
- **The bubble** (`assistant.js`): tap = pop up and listen; tap again = tuck away (history stays in memory, nothing old is shown); small Clear button forgets the
  conversation; the open chat is draggable; your spoken words are never shown as text (only your picture), typed ones are; the AI's answer is read aloud when you spoke.
  State lives in the single `B` object; history in `sessionStorage` (`aib:<userId>`), position in `localStorage`.

## Performance and reliability facts (Apps Script)

- Every request costs about 2-3 s even for trivial calls; roughly 1 in 10 requests is lost entirely. So `api.js` re-sends reads and sign-in after 4.5 s / 9.5 s
  (first answer wins) but **never re-sends writes**. Background polling (`poll()` in `app.js`) runs one request at a time. Do not add chatty polling.
- Tables are cached in CacheService and invalidated on writes; writes take a script lock. Keep prompts small; AI calls should come after the screen has loaded.
- UrlFetchApp has no timeout setting; the AI code enforces its own total time limits.

## Working here

```bash
npm test                  # all tests (core, features, sync check, adapters cache, AI providers, API client)
node tools/sync-core.js   # after editing backend/Core.gs
python -m http.server 8765 --directory docs   # then http://localhost:8765/?demo=1
```

- Add a test for every behaviour change (`tests/features.test.js` has helpers `makeApp`, `seed`, `spyAi`; AI-provider tests fake the Google services in `tests/ai-providers.test.js`).
- **Deploying the backend:** paste `Core.gs`, `Adapters.gs`, `Setup.gs` into the Apps Script editor, then Deploy > Manage deployments > edit > **New version**
  (same deployment id, so the web app URL does not change). A syntax error anywhere makes saving hang silently: check with `node -e "new Function(require('fs').readFileSync('backend/X.gs','utf8'))"` for plain files.
  Never run `setup()` again on a live system. Script properties hold keys and settings and are never committed.
- **Deploying the web app:** GitHub Pages serves `docs/`. Bump the `?v=` number in `docs/index.html`, commit, push, wait about a minute, test with a fresh `&nc=` query.
- **Branches.** `main` is generic code (safe to publish). A company deployment keeps its own branch that is `main` merged plus its real `backendUrl` in `docs/js/config.js`.
  Never put company names, usernames, URLs, keys or data in `main`. `HANDOVER.md` is deliberately git-ignored.
- Editing tips for AI assistants on Windows: write large files with the file-write tool; do not build JS/regex with backslashes inside shell heredocs (they get mangled).

## Conventions

- Plain ES2015+ JavaScript, no build step, no framework, no dependencies. All DOM text goes through `h()` / `textContent` (never `innerHTML` with user data).
- Comments explain *why*; user-facing wording is short and friendly.
- Keep `Core.gs` free of Google-specific calls (go through `env`).
