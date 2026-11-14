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

- Own username/password (salted iterated hash), lock-out after 5 wrong attempts for 15 minutes, forced change of the default password: new accounts and admin resets all get `DEFAULT_PASSWORD` (`1111`, Core.gs); it only opens the change-password step and `checkPasswordPolicy` (min 8) never accepts it as a chosen password.
- **Org pyramid.** Job titles have a layer (1 = top). The admin draws directional "arrows" (tethers) from a person to people below;
  you can only assign tasks to people your arrows point to; layers may be skipped; one person can have several managers.
- Admins manage accounts and the org chart but **cannot read other people's tasks**; a "pure admin" has no job title and no AI.
- Only assignees move the progress slider; 100% sends the task to the creator for approval; only the creator approves
  (task moves to the History archive with its conversation) or sends it back (progress 90%).
- **Approving only CLOSES a task** (`approveTask`: status `closed`, `closedAt`, a few milliseconds under the lock). Filing it is done by a **background job**: `archiveJob()` (Setup.gs, hourly trigger made by `installTriggers()`, runs on Google's servers so no phone has to be on) calls `core.archiveWaiting()`, which runs `archiveClosed(taskId)` for each closed task, oldest first, within about 4.5 minutes (`archiveJobMore` continues a minute later). `env.archiveAtNight` is true only in `makeEnv_` (production); the demo, the tests and the Setup simulation/mock/smoke tools pass false and file at once. Until filed, a closed task is in History as `waiting: true` (`waitingRows`/`historyRows` in Core.gs; same shape as an ArchiveIndex row, `archiveNo` 0, no zip), its conversation still live in the Messages sheet, and the assistant lists it as completed. `archiveClosed` takes NO lock for the slow part: (1) short lock: claim (`Tasks.archiveStartedAt`, 15 min) and reserve the archive number (`Tasks.archiveNo`, kept on retries so numbers have no gaps); (2) no lock: build and check the zip(s); (3) short lock: only if the task's message and attachment counts are unchanged write the ArchiveIndex + full-history rows and remove the live rows, else `env.archive.discard` the zips and try again next run. A failure leaves everything as it was and goes to the audit log (`task.archive.failed`). `postMessage`/`postVoice`/`postFile` re-check inside the lock that the task is still open (`stillOpen`): a message that finishes sending after approval is refused clearly and its stored file removed. Stored attachments that no message points to are still put in the zip (`doc.unlinked`). The completed date is the approval time (`closedAt`), not the filing time.

Closed tasks are written to the archive first, then removed from the live sheet. `archiveClosed` (Core.gs) makes ONE zip per task in `My Drive/EPP/<person who assigned>/` named `EPP-0042 - Title - date.zip` (`env.archive.saveZip`; `Summary.txt`, `Conversation.txt` with voice written out, `Files/` renamed readably, `Voice (no transcript)/`). The archive number comes from `ArchiveIndex.archiveNo` (highest + 1, inside the write lock). Voice audio with a transcript is never put in the zip; the loose files are trashed only after the zip was written AND opened again and every entry matched what went in by name, size and a fingerprint of its bytes (Adapters `saveZip`/`zipPart_`; any difference removes the zip, keeps the originals and leaves the task open). Google Drive refuses one file of about 50 MB (measured with `archiveSizeTest*` in Setup.gs: ten random 5 MB documents did not fit), so a very big task is split into parts of at most `ZIP_PART_BYTES_` (30 MB of documents): `EPP-0042 - Title - date.zip` holds Summary.txt, Conversation.txt and the first documents, `... (part 2 of 3).zip` the rest, all in the same folder, and Summary.txt lists which part holds which document; originals are trashed only after ALL parts were checked. Names inside the zip are always unique and keep their ending (`entryName` in `archiveTask`). A shared document may be 10 MB (`LIMITS.maxFileB64` 14,000,000 base64 characters, `MAX_FILE_BYTES` in `docs/js/ui.js`; a 14 MB request body was accepted by the live web app); `archiveTask` runs inside the write lock (other writes wait 25 s, then answer BUSY), so a 200 MB task (about a minute) can make others' saves fail briefly; the browser waits 300 s for `approveTask`, 280 s for an upload. The `ArchiveIndex` row is all the app keeps (people, dates, `summaryText`, `purpose`, `docs` = names of shared documents, `fileCount`, `archiveNo`, `path`, `fileId`, `folderId`); `getArchived` of a zip row returns `detailsOnly` from that row, the History page shows the ID and the Drive path, and the assistant reads Summary.txt/Conversation.txt from the zip (`env.archive.readZip`) only for the task being looked at. `approveTask` first tries a last AI summary (outside the lock, failure ignored). Older archives (`storage` gdrive/memory, with `task.json`) still open in the app. The EPP folder id is the script property `EPP_FOLDER_ID` (found or made by name); `createEppFolders()` in Setup.gs makes the person folders. New table columns are appended at the END (positional reads); `ensureColumns` writes the header once.
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
- **Answers as points and pictures.** The prompt's FORMAT rule makes the model answer with a headline and `- ` points; a point may start with `[late]`, `[wait]`, `[good]` or `[info]` (coloured dot) and carry `[35%]` (mini progress bar). `botCard()` in `assistant.js` draws them; `speakable()` (Core) and `Speech.clean` strip them so they are never read aloud (35% is spoken as "35 percent"). Keep any new tag in all three places.
- **Summaries.** The AI summary at the top of a task page is stored with the task (`summary`, `summaryMsgCount`, `summaryAt`). `aiContext` hands it to the assistant (`summaryLines`: full for the open task, one line for others, first sentence when the prompt is tight; completed tasks keep it in the archive file), and the prompt's SUMMARY OF A TASK rule tells the model to give *that* summary when asked, plus anything newer.
- **Confirmation is decided by the person's words, not the model's wording.** While actions wait for an OK (`pending`), `A.assistant` treats short yes/no answers (`saidYes`/`saidNo`, typed or heard) and the model's `confirm` label as the decision, drops any re-proposed actions, and rewrites a reply that claims something is done when nothing ran (`claimsDone`). The browser then runs the actions and reports the real result.
- **Security.** Task titles, messages and file contents are untrusted input (prompt-injection): the prompt says to follow only the person's own words.
- **Prompt and context.** `ASSISTANT_PROMPT_` and builders in `Adapters.gs`; context assembled in `Core.gs` (`aiContext`, `aiContextFit` tiers to keep prompts small for free-tier limits).
- **The bubble** (`assistant.js`): tap = pop up and listen; tap again = tuck away (history stays in memory, nothing old is shown); small Clear button forgets the
  conversation; the open chat is draggable; there is no bubble for the user: what you say or type is never shown, only the AI's answer (read aloud when you spoke); a small keyboard button and the Clear button sit with the AI bubble.
  **Gestures:** tap a message of the assistant = it listens again; hold (about 0.4 s, with a tiny buzz) on the bubble or any message, then drag = move bubble and messages together.
  **Companion:** every question carries `App.screen()` (`kind` home/new/task/closed/history/account/admin plus a live look: list filter and shown tasks, the New task draft,
  the progress slider, a half-typed message). Each view registers `S.peek` (and the New task form `S.fill`). `screenText()` in `Core.gs` turns it into words for the model
  (ids checked against the person's own tasks and allowed assignees); the prompt's COMPANION paragraph tells the model to answer relative to that screen. `fill_task` fills the
  New task form for the person (no confirmation; they press the create button).
  State lives in the single `B` object; history in `sessionStorage` (`aib:<userId>`), position in `localStorage`.

## Installing the app (QR code)

`docs/install.html` + `docs/js/install.js` is the page a QR code points to: one big button. Not installed: **Install** (one tap where the browser allows it via
`beforeinstallprompt`; on iPhone a three-picture guide, since Safari has no install button). Installed: **Open** (tries to hand the address to the installed app, then tries to
close the tab). Already running as the installed app: goes straight to the app. Limits that cannot be coded around: a web page cannot see an iPhone's home screen, and browsers only let a page
close a tab it opened itself. Needs `manifest.webmanifest` (PNG icons, `related_applications` naming itself) and `sw.js` (a worker that caches nothing). The QR image itself contains the real
address, so it lives only in the company branch (`docs/install-qr.svg`, printable `docs/qr.html`); make one with `pip install segno` then `segno.make('<url>/install.html', error='q').save('install-qr.svg', scale=12)`.

## Updates reach installed phones (update.js)

An installed app is one long-lived window and GitHub Pages lets phones keep a page for 10 minutes (`max-age=600`), so a release does not reach it by itself. `docs/js/update.js` (loaded before
`app.js`, its own `?v=` is the running version) fetches the page the app opens from with `cache: 'reload'` at start, when the app returns to the foreground, when it goes online and every 5 minutes, and
compares the `app.js?v=` number. Newer: it reloads itself if nothing is typed / no popup / not listening / nothing sending (at most twice per version), else shows an "Update" button. The Account page shows the
version with a "Check for updates" button. `sw.js` asks the server `cache: 'no-cache'` for every page. **Bumping the `?v=` number in `docs/index.html` is what triggers all of this: forget it and nobody updates.**
First-time catch-up for a phone that still runs a copy from before update.js existed: close the app from the recent-apps list and open it again (after the 10 minutes).

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

## Full history sheet and the one-year live History

`HISTORY_COLUMNS` / `HISTORY_KEEP_DAYS` (365) in Core.gs; `historyRow(idxRow)` builds a row; `archiveTask` appends it through `env.history.append` right after inserting the `ArchiveIndex` row (a failure is logged and never blocks the approval); `maintenance()` (nightly) adds any live row that is missing from the full sheet (by Archive ID), then removes `ArchiveIndex` rows older than a year that are certainly in it (no Archive ID or an unreadable full sheet = nothing removed). `ArchiveIndex.dueDate` feeds "Days late". Archive numbers: `nextArchiveNo` = max(Settings `archiveCounter`, live max) + 1, `saveArchiveNo` stores it, so numbers survive pruning. Adapters: `HistorySheet_` (Sheet "EPP History (all completed tasks)" in the EPP folder, id in script property `HISTORY_SHEET_ID`; text columns are text, `safeCell_` stops formulas). `wipeWorkData` clears its rows (the file stays), `simulationClean` removes the simulation's rows. Nothing in Adapters.gs may touch `HISTORY_COLUMNS` while loading (tests load it alone). `nightlyJob` (Setup.gs) backs the sheet up too: `EPP History backup <date>` (14) and `EPP History monthly <yyyy-MM>` (12), rotated by name prefix (`backupRotate_`/`backupOnce_`), so kinds never push each other out; tested in `tests/backup.test.js`.

## History groups

`listHistory` takes `q`, `role` (all|mine|byme: assigned to me = I am an assignee, assigned by me = I created it), `from`/`to` (yyyy-MM-dd, the day of completion in company time, both ends included, swapped if the wrong way round, anything else is a VALIDATION error), `limit`/`offset`, and returns `total`, `counts` {all, mine, byme} (after search and dates, before the group) and `items`. The History page (`viewHistory`) mirrors the task list chips and keeps the choice in `S.hist` (fresh for each person).

## Drive access to one's archive folder

Table `DriveAccess` (userId, email, status requested|granted, folderId...). Actions: `driveStatus`, `requestDriveAccess` (only people who have an arrow going out; the email is typed by the person; cannot be swapped while granted), admin-only `adminDriveList` / `adminDriveGrant` (needs a request first) / `adminDriveRevoke` (withdraw or refuse). Granting calls `env.archive.shareFolder({person: niceName(name,60), email})` which shares ONLY `EPP/<person>` as Viewer (made through the Drive web service with `sendNotificationEmail=false`, see `driveApi_`: DriveApp's own sharing would email the person, which the product does not want; an address without a Google account is refused), keeps it private (no link), refuses the owner account and any account that already reaches the EPP folder or Drive root, and verifies the recorded permission is VIEW (else it takes it back). `getArchived` returns Drive links and `canOpen` only to the person whose folder it is, after the grant, plus `status`/`email` of their request (never to others). The UI lives ONLY on the History task page (`archivedDetails`: two buttons, or the Google-email request form); nothing about Drive on the Account page (a test guards that). Never add a code path that shares another folder, an editor role, or a link. Tests: `tests/drive-access.test.js` (fake Drive) and the `drive access` test in `tests/core.test.js`.

## Simulation (Setup.gs)

`simulateCompany` makes ~100 tasks over 13 weeks for the real accounts: the plan `simPlan_` (pure, seeded, tested in `tests/simulation.test.js`, including a run through Core's real rules) is executed through `core.handle` with the clock set back (`env.now` override), virtual in-memory sessions and a stub AI; it runs in ~3-minute chunks, stores progress in script property `SIM_STATE`, and re-schedules itself with a one-off trigger until done. `simulationClean('REMOVE THE SIMULATION')` removes only its ids. Never run `setup()` to "start over": use `wipeWorkData(...)`.

## Look and feel

- **Logo:** a berry with leaves and a tick (`docs/icon.svg`; `icon-maskable.svg` has extra safe margin). The PNGs (`icon-192/512`, `icon-maskable-512`, `apple-touch-icon`) are rendered from them
  (headless Edge/Chrome screenshot of the SVG at the target size). In the app the same drawing is `UI.logoMark(size)`, coloured by `.logomark` / `.lm-*` rules so it follows the appearance.
- **Appearance colours** (Account > Appearance: berry, ocean, forest, sunset, violet; light/dark) work only through `--accent`, `--accent-strong`, `--accent-2`, `--accent-soft`, `--brand-from`, `--brand-to`.
  **Never write a berry/pink colour literal in a style rule** (use `var(--accent)` or `color-mix(in srgb, var(--accent) 40%, transparent)` for glows and shadows); `tests/theme.test.js` fails if you do.
  This includes the page-background glow (`body::before`) and person avatars (hue list in `UI.avatar` has no pink). Check pseudo-elements too (`::before`/`::after`) when auditing computed colours.
  Red for late/listening/unread is meaning, not decoration, and is allowed. `UI.accent` also tints the phone's `theme-color` meta tag and the confetti.

## Conventions

- Plain ES2015+ JavaScript, no build step, no framework, no dependencies. All DOM text goes through `h()` / `textContent` (never `innerHTML` with user data).
- Comments explain *why*; user-facing wording is short and friendly.
- Keep `Core.gs` free of Google-specific calls (go through `env`).
