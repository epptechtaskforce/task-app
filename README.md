# Task Manager - assign work, follow it, talk about it (with an AI companion)

A small internal app for a management team of about 20 people. Managers assign work down an org pyramid, people report progress with one slider,
everyone on a task shares one conversation (text, voice, photos, files), finished work is approved by the manager and archived, and a floating
**AI assistant** that sees the same screen as you answers questions, finds things, and prepares actions for you to approve.

It runs entirely on free tools: a static web app on GitHub Pages, a Google Apps Script backend, Google Sheets and Drive as the database and file store.
No server of your own, nothing to install for the users (it installs from a QR code like an app).

**Try it without any setup:** open the site with `?demo=1` (a fake company; everything stays in your browser).

## What it does

**Work**
- A manager assigns a task to one or several people **below them** in the org pyramid; everyone on the task shares **one conversation**.
- Assignees drag a **progress slider**. At 100% the task waits for the manager, who **approves** it or **sends it back**.
- Approved tasks move to **History** with their start and finish dates, who did what, the shared documents' names, a small summary, an **archive ID** and exactly where the archive zip is in Google Drive (see *Long-term archive* below).
- An **AI summary** at the top of every task shows where it stands (health, what is done, blockers, next steps).
- The **home screen is made to be glanced at**: simple cards (a progress doughnut, the title, who -> whom as faces, one time badge), a "Today" strip of coloured tiles
  and a week of dots. Colours carry the meaning (red late, amber waiting for approval, blue going, grey not started), words are kept to a minimum.

**Conversation**
- Text, **voice messages** (English, or Sinhala which the AI turns into English; shown as audio, with the transcript kept as the AI's memory), photos and documents.

**The AI assistant** (for Senior General Managers and above)
- A round bubble floats over every screen. Tap it and talk (or type with the small keyboard button); tap an answer to talk again; hold and drag to move it.
- It **sees the screen you see** (which list, which task, what you have typed into the New task form) and answers in that context; it can also **navigate** (show late tasks, open a task, search History)
  and **fill in the New task form** for you.
- It **only proposes** changes (post a message, set progress, create or edit a task, approve, send back). You confirm with a button or by saying "yes"; the server checks every action against what you are allowed to do.
- Answers come as a short headline and points, with coloured dots and tiny progress bars where that helps; they are read aloud without the pictures.
- Asking for a task's summary gives the same summary that is shown at the top of that task.

**Admin**
- Creates job titles (each has a layer), accounts and the **org chart**: arrows decide who may assign tasks to whom. Admins cannot read other people's tasks.

**On the phone**
- Opens from a **QR code** (`install.html`): one big Install button (or Open, once installed). It updates itself when a new version is published.
- Five **appearance colours** (berry, ocean, forest, sunset, violet), light and dark, all repainting the whole app.

## How it is built

```
Browser (docs/, plain HTML/CSS/JS, GitHub Pages)  --POST JSON-->  Google Apps Script web app (backend/)
                                                                   |-- Core.gs      business rules, permissions, AI orchestration (pure JS, tested)
                                                                   |-- Adapters.gs  Sheets (database), Drive (voice, files, archive), AI providers
                                                                   |-- Code.gs      web entry points
                                                                   '-- Setup.gs     one-time setup, backups, smoke/speed tests, sample-data tools
```

| Piece | Where | Why |
|---|---|---|
| Business rules, permissions, task state machine, AI action checks | `backend/Core.gs` | One file used by the real backend, the browser demo and the tests |
| Google adapters and AI providers | `backend/Adapters.gs` | Swap Sheets/Drive/AI services without touching the rules |
| Web app | `docs/` | Served by GitHub Pages; the screens are in `app.js`, the AI bubble in `assistant.js` |
| Installable app | `docs/install.html`, `manifest.webmanifest`, `sw.js`, `update.js` | QR install page, icons, a service worker that caches nothing, self-update |
| In-browser demo | `docs/js/demo.js`, `docs/js/memory-env.js` | Fake data, same logic |
| Tests | `tests/` | `npm test` (Node 20+, no dependencies) |

`docs/js/core.js` is a generated copy of `Core.gs` (`node tools/sync-core.js`); a test fails if it is stale. For a deeper tour (architecture, product rules, AI design, deployment
recipe, conventions) read [`CLAUDE.md`](CLAUDE.md): it is written for anyone, human or AI assistant, who continues the work.

### Rules the code enforces (see `tests/`)
- Sign-in with own username/password (salted, iterated hashes; lock-out after 5 wrong attempts for 15 minutes; forced change of temporary passwords).
- A person can only assign tasks to people their **arrows** point to; arrows only point **down** the pyramid; skipping layers is allowed; a person can have several managers.
- Admins manage accounts and the org chart but **cannot read other people's tasks**.
- Only assignees move the slider; only the person who assigned the task can approve or send it back.
- Closed tasks are written to the Drive archive first, then removed from the live sheet (the sheet stays small): see *Long-term archive*.
- Text typed by users can never run as a spreadsheet formula. (A plain-text cell format is *not* enough: Google Sheets still evaluates `=...` there. The Sheets adapter prefixes risky text with an apostrophe, and `smokeTest()` checks this on a real sheet.)
- The AI never changes data by itself: it proposes, the person confirms, the server validates. Task text and messages are treated as untrusted input (prompt injection).
- Free-tier Apps Script loses roughly one request in ten and each takes a few seconds, so reads and sign-in are re-sent automatically (the first answer wins); writes are never re-sent.

## Deploy your own

1. **Google account** that will own the app (use a dedicated account, not a personal one). For the AI, create at least one free key: Gemini at <https://aistudio.google.com/apikey>
   (optionally Groq, or Anthropic for the best quality; the app tries them in order and falls back).
2. **Apps Script**: new project at <https://script.google.com>. Create four files and paste `backend/Core.gs`, `Adapters.gs`, `Code.gs`, `Setup.gs`.
3. **Script properties** (Project Settings): `GEMINI_API_KEY`, `SETUP_COMPANY_NAME`, `SETUP_ADMIN_USERNAME` (optional: `SETUP_ADMIN_NAME`, `SETUP_ADMIN_PASSWORD` - if omitted, `setup()` generates a temporary password;
   `GROQ_API_KEY`, `ANTHROPIC_API_KEY`; `AI_MAX_LEVEL` = the lowest layer number allowed to use the AI, by default the layer of the job title that looks like "Senior General Manager").
4. Run `setup()` (approve the permission prompts). Then `installTriggers()` and `smokeTest()` (it must end with `ALL SMOKE TESTS PASSED`).
5. **Deploy > New deployment > Web app**: Execute as *Me*, access *Anyone* (every call needs a login). Copy the `/exec` URL.
6. Put the URL in `docs/js/config.js` (`backendUrl`) and publish `docs/` with GitHub Pages (**bump the `?v=` number in `docs/index.html` with every release**: that is what makes installed phones update).
7. Open the site, sign in as the admin, set a new password, then create job titles, users and the org chart.
8. **QR code**: encode `<your site>/install.html` (for example `pip install segno`, then `segno.make('<your site>/install.html', error='q').save('install-qr.svg', scale=12)`) and print it.

After changing backend code: Deploy > Manage deployments > edit > **New version** (same deployment, so the address does not change).

Two-branch tip: keep `main` generic (safe to publish) and a separate branch that is `main` plus your real `backendUrl` and QR code, and publish Pages from that branch.
Keep keys and addresses in script properties, never in the repository (`tests/generic.test.js` guards against this).

## Developing

```bash
npm test                 # all tests: rules, features, AI providers, API client, theme, updates, generic-code guard
node tools/sync-core.js  # after editing backend/Core.gs, refresh docs/js/core.js
python -m http.server 8765 --directory docs   # then open http://localhost:8765/?demo=1
```

## Long-term archive

Everything that is finished is kept in Google Drive as **one zip file per task**, in a folder for the person who assigned it:

```
My Drive / EPP / <person who assigned the task> / EPP-0042 - Submit the compliance checklist - 2026-11-14.zip
                                                     Summary.txt        purpose, who assigned, who did it, started / completed / days, AI summary, what is in the zip
                                                     Conversation.txt   every message in order; voice messages are written out ("Said: ...", plus key points)
                                                     Files/             every shared document and picture, named "2026-11-12 09-10 Name - original name.pdf"
                                                     Voice (no transcript)/   only if a voice message could not be written down: its audio goes in so nothing is lost
```

- **The archive ID** (`EPP-0042`, counting up) is in the zip's name, in `Summary.txt` and on the History page, so a task can be found in Drive by its number.
- **EPP folder and person folders**: run `createEppFolders()` once in the Apps Script editor (and again when someone new gets the right to assign tasks). It makes the `EPP` folder in the Drive of the account that owns the app and one folder for every person who can assign tasks. If a folder is missing when a task is archived, the app makes it.
- **Voice audio is not kept** (it is the biggest thing in a task): the words are in `Conversation.txt` and the audio is never put in the zip unless it could not be transcribed.
- **The loose files are removed only after the zip has been written and opened again to check it** (they go to the Drive trash, which Drive empties after 30 days). If anything fails the task is simply not archived and nothing is lost.
- **History in the app** shows the main details: title, who assigned and who it was assigned to, dates, the names of the shared documents, a small summary (the AI summary is made when the task is approved, if the approver may use the AI and none exists yet), the archive ID and the Drive path with "Open in Google Drive" buttons. The full conversation and the files are read from the zip in Drive, by whoever has access to that Drive folder. (The assistant can still answer questions about a completed task you are looking at: it reads the zip's text files for that one task.)
- Older archives (made before the zip format) are still readable in the app; they keep their own folder, `conversation.html` and voice audio.
- Backups: the nightly job copies the database sheet to the backup folder (newest 14 kept). The `EPP` folder is plain files: copy it to another drive now and then for a second copy.

## Known limits
- Google Sheets is the database: fine for dozens of users, not thousands. Closed tasks leave the sheet, which keeps it small.
- No push notifications (the app polls while open). Unread dots and a badge show new messages.
- Free AI tiers can be slow or busy; the backend tries several models and providers and reports clearly when the AI is unavailable. Free-tier content may be used by the provider to improve its models: use a paid key if that matters.
- Voice messages are limited to 2 minutes. Voice playback needs a browser that can play the format it was recorded in (any current phone or desktop browser).
- A web page cannot see an iPhone's home screen, so on iPhone the install page always offers "Install" (with a three-picture guide), and browsers only let a page close a tab it opened itself.

## Licence

[MIT](LICENSE): free to use, copy, change and share, with the copyright notice kept. No warranty.
