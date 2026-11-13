# Task Manager - assign, follow and archive work (with voice updates)

A small internal app for a management team of about 20 people.

- Managers assign a task to one or **several people** below them. Everyone on the task shares **one conversation**.
- People answer by **text or voice message** (English, or Sinhala which the AI turns into English). A voice message appears in the chat as audio only; the AI listens to it and remembers it for the task, for summaries and for the assistant.
- Assignees drag a **progress slider**. At 100% the task waits for the manager's **Agree** (or "send back").
- An **AI summary** tells the manager where the task stands, based on the conversation.
- Approved tasks move to **History** (start date, completion date, full conversation, voice files).
- An **admin** creates job titles, accounts and draws the **org chart**: arrows decide who may assign tasks to whom.

**Try it without any setup:** open the site with `?demo=1` (fake company, everything stays in your browser).

## How it is built

```
Browser (GitHub Pages, plain HTML/CSS/JS)  --POST JSON-->  Google Apps Script web app
                                                           |-- Core.gs      business logic (pure JS, tested)
                                                           |-- Adapters.gs  Sheets (database), Drive (voice + archive), Gemini (AI)
                                                           '-- Setup.gs     one-time setup, backups, smoke test
```

| Piece | Where | Why |
|---|---|---|
| Business rules, permissions, task state machine | `backend/Core.gs` | One file used by the real backend, the browser demo and the tests |
| Google adapters | `backend/Adapters.gs` | Swap Sheets/Drive/Gemini without touching the rules |
| Web app | `docs/` | Served by GitHub Pages |
| In-browser demo | `docs/js/demo.js`, `docs/js/memory-env.js` | Fake data, same logic |
| Tests | `tests/` | `npm test` (Node 20+, no dependencies) |

Free to run: Google Apps Script + Sheets + Drive + Gemini free tier + GitHub Pages.

### Rules the code enforces (see `tests/core.test.js`)
- Sign-in with own username/password (salted, iterated hashes; lock-out after 5 wrong attempts; forced change of temporary passwords).
- A person can only assign tasks to people their **arrows** (tethers) point to, and arrows only point **down** the pyramid. Skipping layers is allowed.
- Admins manage accounts and the org chart but **cannot read other people's tasks**.
- Only assignees move the slider; only the person who assigned the task can approve or send it back.
- Closed tasks are written to the archive first, then removed from the live sheet (the sheet stays small).
- Text typed by users can never run as a spreadsheet formula. (A plain-text cell format is *not* enough: Google Sheets still evaluates `=...` there. The Sheets adapter prefixes risky text with an apostrophe, and `smokeTest()` checks this on a real sheet.)

## Deploy your own

1. **Google account** that will own the app (use a dedicated account, not a personal one). Create a Gemini API key at <https://aistudio.google.com/apikey>.
2. **Apps Script**: new project at <https://script.google.com>. Create four files and paste `backend/Core.gs`, `Adapters.gs`, `Code.gs`, `Setup.gs`.
3. **Script properties** (Project Settings): `GEMINI_API_KEY`, `SETUP_COMPANY_NAME`, `SETUP_ADMIN_USERNAME` (optional: `SETUP_ADMIN_NAME`, and `SETUP_ADMIN_PASSWORD` - if omitted, `setup()` generates a temporary password and prints it once in the execution log).
4. Run `setup()` (approve the permission prompts). Then `installTriggers()` and `smokeTest()` (it must end with `ALL SMOKE TESTS PASSED`).
5. **Deploy > New deployment > Web app**: Execute as *Me*, access *Anyone* (every call needs a login). Copy the `/exec` URL.
6. Put the URL in `docs/js/config.js` (`backendUrl`) and publish `docs/` with GitHub Pages.
7. Open the site, sign in as the admin, set a new password, then create job titles, users and the org chart.

After changing backend code: Deploy > Manage deployments > edit > **New version**.

## Developing

```bash
npm test                 # run all tests
node tools/sync-core.js  # after editing backend/Core.gs, refresh docs/js/core.js (a test checks this)
python -m http.server 8765 --directory docs   # then open http://localhost:8765/?demo=1
```

## Known limits
- Google Sheets is the database: fine for dozens of users, not thousands. Closed tasks leave the sheet, which keeps it small.
- No push notifications (the app polls while open). Unread dots and a badge show new messages.
- Free Gemini tier can be slow or busy; the backend tries several models and reports clearly when the AI is unavailable. Free-tier content may be used by Google to improve its models: use a paid key if that matters.
- Voice messages are limited to 2 minutes. Voice playback needs a browser that can play the format it was recorded in (any current phone or desktop browser).
