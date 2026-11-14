/**
 * Setup.gs - run these from the Apps Script editor (pick the function in the dropdown, press Run).
 * Results appear in the "Execution log".
 *
 *   setup()           ONE TIME. Creates the database sheet, Drive folders, company record and first admin.
 *   installTriggers() ONE TIME. Schedules the nightly backup + clean-up.
 *   smokeTest()       Runs the whole app against a temporary sheet/folders (nothing real is touched).
 *   selfTest()        Checks the Gemini key and models work.
 *   listModels()      Lists the Gemini models your key can use (useful if a model is retired).
 *   nightlyJob()      What the trigger runs (backup + remove expired sessions). Safe to run by hand.
 *
 * Before setup(), add these Script properties (Project Settings > Script properties):
 *   GEMINI_API_KEY, SETUP_COMPANY_NAME, SETUP_ADMIN_USERNAME, (optional) SETUP_ADMIN_NAME,
 *   (optional) SETUP_ADMIN_PASSWORD - if you leave it out, setup() generates a random temporary password
 *   and prints it ONCE in the execution log. Either way the admin must change it at first sign-in.
 * To rename the company later: change SETUP_COMPANY_NAME and run setup() again (it will not create a second admin).
 */

function setup() {
  const props = PropertiesService.getScriptProperties();
  const need = ['SETUP_COMPANY_NAME', 'SETUP_ADMIN_USERNAME'];
  need.forEach(function (k) { if (!props.getProperty(k)) throw new Error('Add the Script property ' + k + ' first (see the comment at the top of Setup.gs).'); });
  // No password supplied? Generate a random temporary one and show it ONCE in the execution log.
  let generated = '';
  if (!props.getProperty('SETUP_ADMIN_PASSWORD')) { generated = generatePassword_(); props.setProperty('SETUP_ADMIN_PASSWORD', generated); }

  // 1. Drive folders: TaskApp / {Voice, Archive, Backups}
  if (!props.getProperty('ROOT_FOLDER_ID')) props.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('TaskApp (' + props.getProperty('SETUP_COMPANY_NAME') + ')').getId());
  const root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
  [['VOICE_FOLDER_ID', 'Voice'], ['ARCHIVE_FOLDER_ID', 'Archive'], ['BACKUP_FOLDER_ID', 'Backups']].forEach(function (p) {
    if (!props.getProperty(p[0])) props.setProperty(p[0], root.createFolder(p[1]).getId());
  });

  // 2. Database spreadsheet (kept inside the root folder)
  if (!props.getProperty('SPREADSHEET_ID')) {
    const ss = SpreadsheetApp.create('TaskApp Database');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  // 3. Tables, company, first admin
  const result = getCore_().setup({
    companyName: props.getProperty('SETUP_COMPANY_NAME'),
    adminName: props.getProperty('SETUP_ADMIN_NAME') || 'Administrator',
    adminUsername: props.getProperty('SETUP_ADMIN_USERNAME'),
    adminPassword: props.getProperty('SETUP_ADMIN_PASSWORD')
  });
  if (result.createdAdmin) props.deleteProperty('SETUP_ADMIN_PASSWORD');

  Logger.log('Setup finished: ' + JSON.stringify(result));
  if (generated && result.createdAdmin) {
    Logger.log('FIRST SIGN-IN  username: ' + props.getProperty('SETUP_ADMIN_USERNAME').toLowerCase() + '   temporary password: ' + generated + '   (shown only now; you must choose a new password at first sign-in)');
  }
  Logger.log('Database: ' + SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')).getUrl());
  Logger.log('Drive folder: ' + root.getUrl());
  Logger.log('Now run installTriggers(), then smokeTest().');
}

function generatePassword_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 12; i++) { out += alphabet[parseInt(hex.substr(i * 2, 2), 16) % alphabet.length]; if (i === 3 || i === 7) out += '-'; }
  return out;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'nightlyJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyJob').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Nightly job scheduled for about 02:00 (script time zone: ' + Session.getScriptTimeZone() + ').');
}

function nightlyJob() {
  const props = PropertiesService.getScriptProperties();
  // Backup: copy the database sheet, keep the newest 14 copies.
  const folder = DriveApp.getFolderById(props.getProperty('BACKUP_FOLDER_ID'));
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(props.getProperty('SPREADSHEET_ID')).makeCopy('TaskApp backup ' + stamp, folder);
  const files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(14).forEach(function (f) { f.setTrashed(true); });
  Logger.log('Maintenance: ' + JSON.stringify(getCore_().maintenance()));
}

/* ------------------------------ smoke test ------------------------------ */

function smokeTest() {
  const problems = [];
  const check = function (cond, msg) { if (!cond) problems.push(msg); Logger.log((cond ? 'PASS  ' : 'FAIL  ') + msg); };
  const ss = SpreadsheetApp.create('TaskApp SMOKETEST (safe to delete)');
  const root = DriveApp.createFolder('TaskApp SMOKETEST (safe to delete)');
  const voice = root.createFolder('Voice'), archive = root.createFolder('Archive');
  const stubAi = {
    transcribe: function () { return { english: 'The work is finished', language: 'Sinhala', key_points: 'Work reported finished.' }; },
    summarize: function () { return { summary_en: 'ok', health: 'on_track', blockers: [], next_steps: [], progress_note: 'x' }; },
    assistant: function (input) { return { heard: 'hello', reply: 'Hi ' + input.userName, confirm: '', actions: [] }; },
    speak: function () { return { b64: Utilities.base64Encode('0000'), mime: 'audio/L16;codec=pcm;rate=24000' }; },
    briefing: function () { return { headline: 'All good', items: [{ tone: 'good', text: 'Nothing is late', task_id: '' }] }; }
  };
  try {
    const core = getCore_({ ssId: ss.getId(), voiceFolderId: voice.getId(), archiveFolderId: archive.getId(), ai: stubAi });
    const call = function (action, token, params) { return core.handle(Object.assign({ action: action, token: token }, params || {})); };
    const must = function (action, token, params) { const r = call(action, token, params); if (!r.ok) throw new Error(action + ' failed: ' + JSON.stringify(r)); return r.data; };

    core.setup({ companyName: 'Smoke Co', adminUsername: 'smoke-admin', adminPassword: 'Smoke-Test-1' });
    let t0 = Date.now();
    const first = must('login', null, { username: 'smoke-admin', password: 'Smoke-Test-1' });
    Logger.log('Login took ' + (Date.now() - t0) + ' ms (password hashing included)');
    check(first.user.mustChange === true, 'first login forces a password change');
    must('changePassword', first.token, { oldPassword: 'Smoke-Test-1', newPassword: 'Smoke-Test-2' });
    const admin = must('login', null, { username: 'smoke-admin', password: 'Smoke-Test-2' }).token;
    check(call('login', null, { username: 'smoke-admin', password: 'wrong' }).code === 'AUTH', 'wrong password is rejected');

    const boss = must('adminSaveJobTitle', admin, { title: 'Boss', level: 1 }).id;
    const staff = must('adminSaveJobTitle', admin, { title: 'Staff', level: 2 }).id;
    const u1 = must('adminSaveUser', admin, { name: 'Boss One', username: 'boss1', jobTitleId: boss });
    const u2 = must('adminSaveUser', admin, { name: 'Staff One', username: 'staff1', jobTitleId: staff });
    must('adminSaveLinks', admin, { links: [{ fromId: u1.user.id, toId: u2.user.id }], note: 'smoke' });
    const login = function (u) {
      const l = must('login', null, { username: u.user.username, password: u.tempPassword });
      must('changePassword', l.token, { oldPassword: u.tempPassword, newPassword: 'Smoke-' + u.user.username + '-9' });
      return must('login', null, { username: u.user.username, password: 'Smoke-' + u.user.username + '-9' }).token;
    };
    const boss1 = login(u1), staff1 = login(u2);

    check(call('createTask', staff1, { title: 'x', assigneeIds: [u1.user.id] }).code === 'FORBIDDEN', 'worker cannot assign upwards');
    const task = must('createTask', boss1, { title: 'Smoke task', description: 'd', assigneeIds: [u2.user.id] }).task;
    const risky = ['=1+1', '=IMPORTRANGE("x","y")', '+1+1', '-5', '@SUM(1)', "'quoted", "''two", 'normal text', '2026-12-31', '  spaced  '.trim()];
    risky.forEach(function (t) { must('postMessage', staff1, { taskId: task.id, text: t }); });
    const msgs = must('getTask', boss1, { taskId: task.id }).messages;
    risky.forEach(function (t) {
      check(msgs.some(function (m) { return m.text === t; }), 'text "' + t + '" is stored exactly as typed (never evaluated as a formula)');
    });
    const fake = Utilities.base64Encode('not-really-audio');
    const v = must('postVoice', staff1, { taskId: task.id, audioB64: fake, wavB64: fake, mime: 'audio/webm', secs: 3 });
    check(v.message.status === 'ok' && v.message.transcript === undefined, 'voice message saved and understood; the chat shows audio only');
    check(must('getAudio', boss1, { messageId: v.message.id }).b64 === fake, 'voice file can be read back from Drive');
    must('setProgress', staff1, { taskId: task.id, progress: 100 });
    must('approveTask', boss1, { taskId: task.id });
    check(must('listTasks', boss1).tasks.length === 0, 'closed task left the live list');
    const hist = must('listHistory', staff1, {});
    check(hist.total === 1, 'closed task appears in history');
    const doc = must('getArchived', staff1, { taskId: task.id });
    // created (system) + risky texts + voice + progress (system) = 3 + risky.length
    check(doc.messages.length === 3 + risky.length && doc.task.title === 'Smoke task', 'archived conversation (' + doc.messages.length + ' messages) can be opened from Drive');
    check(must('getAudio', staff1, { archived: true, taskId: task.id, messageId: v.message.id }).b64 === fake, 'voice file still playable after archiving');
    check(call('getArchived', admin, { taskId: task.id }).ok === false, 'admin cannot read other people\'s archived tasks');

    // profiles: picture + bio. First simulate a spreadsheet made before profiles existed (no Profiles sheet).
    const ssNow = SpreadsheetApp.openById(ss.getId());       // a fresh handle: the one from create() may not list sheets added since
    const profSheet = ssNow.getSheetByName('Profiles');
    check(!!profSheet, 'setup created the Profiles sheet');
    if (profSheet) ssNow.deleteSheet(profSheet);
    check(must('profiles', boss1, {}).profiles.length === 0, 'a spreadsheet without a Profiles sheet gets one on first use');
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    must('saveProfile', staff1, { bio: '=SUM(1)', photo: jpeg });
    check(must('profiles', boss1, {}).profiles.filter(function (p) { return p.userId === u2.user.id; })[0].bio === '=SUM(1)', 'bio that looks like a formula is stored as plain text');
    must('saveProfile', staff1, { bio: 'Ask me about irrigation' });
    const prof = must('profiles', boss1, {}).profiles.filter(function (p) { return p.userId === u2.user.id; })[0];
    check(prof && prof.bio === 'Ask me about irrigation' && prof.photo === jpeg, 'picture and bio saved, and the manager can read them');
    check(must('profiles', boss1, { have: JSON.parse('{"' + u2.user.id + '":' + prof.ver + '}') }).profiles[0].photo === undefined, 'an unchanged picture is not sent again');
    check(call('saveProfile', staff1, { photo: 'https://example.com/a.jpg' }).code === 'VALIDATION', 'only small JPEG pictures are accepted');

    // shared files (Attachments sheet is created on first use), the assistant and the overview (Briefings sheet)
    const t2 = must('createTask', boss1, { title: 'File task', assigneeIds: [u2.user.id] }).task;
    const pdf = Utilities.base64Encode('%PDF-1.4\nsmoke test file\n');
    const fm = must('postFile', staff1, { taskId: t2.id, name: 'Smoke report.pdf', b64: pdf, caption: 'draft' }).message;
    check(fm.type === 'file' && fm.file.name === 'Smoke report.pdf', 'a document can be shared in a task');
    check(must('getFile', boss1, { messageId: fm.id }).b64 === pdf, 'the shared document is stored in Drive and can be read back');
    check(call('postFile', staff1, { taskId: t2.id, name: 'x.exe', b64: pdf }).code === 'VALIDATION', 'programs cannot be shared');
    check(call('getFile', admin, { messageId: fm.id }).ok === false, 'admin cannot open files of other people\'s tasks');
    const as = must('assistant', boss1, { text: 'what is open?', taskId: t2.id });
    check(as.reply === 'Hi Boss One' && as.heard === 'hello', 'the assistant answers');
    check(as.spoken.length > 0, 'the answer is also given as text to speak');
    check(must('speak', boss1, { text: 'Hello there' }).mime.indexOf('audio/') === 0, 'the speak action returns audio');
    check(must('briefing', boss1, {}).briefing.headline === 'All good', 'the overview is made and saved (Briefings sheet)');
    must('setProgress', staff1, { taskId: t2.id, progress: 100 });
    must('approveTask', boss1, { taskId: t2.id });
    const doc2 = must('getArchived', staff1, { taskId: t2.id });
    const fm2 = doc2.messages.filter(function (m) { return m.type === 'file'; })[0];
    check(!!fm2 && must('getFile', staff1, { archived: true, taskId: t2.id, messageId: fm2.id }).b64 === pdf, 'a shared document is still readable after the task is archived');
  } finally {
    ss.getId() && DriveApp.getFileById(ss.getId()).setTrashed(true);
    root.setTrashed(true);
  }
  if (problems.length) throw new Error('Smoke test FAILED: ' + problems.join(' | '));
  Logger.log('ALL SMOKE TESTS PASSED');
}

/* ------------------------------ AI helpers ------------------------------ */

// Run once by hand: asks the REAL Gemini model the assistant questions (uses a little of the free quota) and logs the answers.
function assistantTest() {
  const ai = new GeminiAi_();
  const context = 'TODAY: Friday 2026-11-13, 09:00 (company time zone)\nUSER: Kamala Silva (id U1), General Manager, layer 2\nPEOPLE WHO CAN GIVE ME TASKS: Nimal Perera\n' +
    'PEOPLE I CAN ASSIGN TASKS TO (use these ids):\n- Ruwan Jayasinghe (id U2), Field Officer\n- Ishara Dias (id U3), Field Officer\nOPEN TASKS (1):\n' +
    'TASK id=T1 | "Check irrigation in Block A" | in progress, 40% | due 2026-11-12 (OVERDUE by 1 day) | my role: creator (I assigned it) | from: Kamala Silva | to: Ruwan Jayasinghe | last activity 2026-11-11 16:00\n' +
    '  [11-11 16:00] Ruwan Jayasinghe: Two pumps are working, the third needs a new valve.\nRECENTLY COMPLETED TASKS (0 latest):\n(none)';
  const ask = function (text) { return ai.assistant({ context: context, history: [], text: text, audio: null, pending: [], focus: null, files: [], userName: 'Kamala Silva' }); };
  Logger.log(JSON.stringify(ask('What is overdue and why?')));
  Logger.log(JSON.stringify(ask('Give Ishara a task to count the crates in the packing shed by next Tuesday.')));
  Logger.log('SHOW A TASK: ' + JSON.stringify(ask('Show me the irrigation one.')));
  Logger.log('DICTATE: ' + JSON.stringify(ai.assistant({ context: context, history: [], text: 'Send this message, the roof repair is done and I will check the valves tomorrow', audio: null, pending: [], focus: { id: 'T1', title: 'Check irrigation in Block A' }, files: [], userName: 'Kamala Silva' })));
  Logger.log(JSON.stringify(ai.briefing({ context: context, userName: 'Kamala Silva' })));
  const t0 = Date.now(); const v = ai.speak('You have one task that is overdue. Ruwan says the third pump needs a new valve.');
  Logger.log('Natural voice: ' + v.mime + ', ' + v.b64.length + ' chars of audio, ' + (Date.now() - t0) + ' ms');
}

// Real voice-message test: the speech model says a Sinhala and an English sentence, then the app's own listener turns each into English.
function voiceTest() {
  const ai = new GeminiAi_();
  ['ඉරිගේෂන් පද්ධතියේ පොම්පය හදලා ඉවරයි, හෙට C කොටසට වතුර දානවා.', 'The pump is fixed and I will water block C tomorrow.'].forEach(function (said) {
    try {
      const v = ai.speak(said); const t0 = Date.now();
      Logger.log('SAID: ' + said + ' / HEARD: ' + JSON.stringify(ai.transcribe(v.b64, 'audio/wav', 'Task: Irrigation check. People: Ruwan Jayasinghe.')) + '  (' + (Date.now() - t0) + ' ms)');
    } catch (e) { Logger.log('FAILED for "' + said + '": ' + e); }
  });
}

function selfTest() {
  Logger.log(JSON.stringify(new GeminiAi_().summarize({
    task: { title: 'Test', description: '', progress: 50, status: 'open', dueDate: '', manager: 'Manager', assignees: ['Worker'] },
    messages: [
      { time: '09:00', from: 'Manager', role: 'manager', type: 'text', text: 'Please finish the report today.' },
      { time: '11:00', from: 'Worker', role: 'assignee', type: 'text', text: 'Half done, will finish by 4pm.' }
    ]
  })));
}

function listModels() {
  const res = UrlFetchApp.fetch(GEMINI_BASE.replace(/models\/$/, 'models') + '?pageSize=200', { headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('ListModels error ' + res.getResponseCode());
  Logger.log(JSON.parse(res.getContentText()).models
    .filter(function (x) { return (x.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (x) { return x.name.replace('models/', ''); }).join('\n'));
}

/* ============================== MOCK DATA (for trying the app before real use) ============================== */
// mockInspect()  Shows who is in the system (names, job titles, arrows, task counts). Changes nothing.
function mockInspect() {
  const env = makeEnv_({});
  const core = createCore(env);
  core.TABLES && env.store.init(core.TABLES);
  const users = env.store.all('Users'), titles = env.store.all('JobTitles'), links = env.store.all('Links');
  const t = {}; titles.forEach(function (x) { t[x.id] = x.title + ' (layer ' + x.level + ')'; });
  const u = {}; users.forEach(function (x) { u[x.id] = x.name; });
  Logger.log('USERS (' + users.length + '):\n' + users.map(function (x) { return '- ' + x.name + ' | ' + x.username + ' | ' + (t[x.jobTitleId] || 'no title') + ' | ' + (x.active ? 'active' : 'inactive') + (x.isAdmin ? ' | admin' : '') + (x.mustChange ? ' | has NOT changed the first password yet' : ''); }).join('\n'));
  Logger.log('ARROWS (' + links.length + '):\n' + links.map(function (l) { return u[l.fromId] + ' -> ' + u[l.toId]; }).join('\n'));
  Logger.log('TASKS: open ' + env.store.all('Tasks').length + ', completed ' + env.store.all('ArchiveIndex').length + ', messages ' + env.store.all('Messages').length);
}

// mockSeed()     Fills the REAL app with about two months of invented work between the people who already exist (their accounts and
//                arrows are never changed). It runs in batches: run it again until the log says "ALL DONE".
// mockStatus()   Shows how far it got.
// mockClean()    Removes everything mockSeed made (tasks, messages, photos, voice files, History entries, Drive folders go to the Drive
//                trash), and nothing else. Your own real tasks are never touched.
// How it works safely: the backend is called exactly like a signed-in person would call it (so every rule is checked), but the
// accounts are only "borrowed" in memory for the run: nothing is written to Users or Sessions, no password is needed, and the AI is
// switched off (the invented voice messages get their text from the story below).

// Where the sample pictures live: the "mock" folder of the published site. Set the script property MOCK_BASE_URL to its address,
// for example https://<account>.github.io/<repository>/mock/   (a setting, so no address is written into the code).
function mockBase_() {
  const b = PropertiesService.getScriptProperties().getProperty('MOCK_BASE_URL');
  if (!b) throw new Error('Set the script property MOCK_BASE_URL to the address of the mock folder of your published site, for example https://<account>.github.io/<repository>/mock/');
  return String(b).replace(/\/?$/, '/');
}
// The story is told by made-up people. When the real accounts have other names, the script property MOCK_PEOPLE maps each made-up name
// to the real person's name, as JSON: {"maya":"<real name, lowercase>", "noel":"<real name>", ...}. Without it the story names are looked up as they are.
function mockAlias_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('MOCK_PEOPLE') || '{}') || {}; } catch (e) { throw new Error('MOCK_PEOPLE is not valid JSON'); }
}

// Events: ['s',day,hour,who,text] typed update, ['v',day,hour,who,secs,what was said] voice message, ['i',day,hour,who,kind,caption] photo,
// ['f',day,hour,who,docKey,caption] document, ['p',day,hour,who,percent] progress slider, ['ok',day,hour] manager approves (-> History),
// ['back',day,hour,note] manager sends it back. day = days ago, hour = hour of that day. due = days from today (negative = late).
const MOCK_TASKS_ = [
  /* ---------- finished and approved (they end up in History) ---------- */
  { t: 'Harvest totals report for September', d: 'Collect picking totals for every block and send me one summary before the Friday review.', by: 'maya', to: ['rhea', 'sam'], day: 58, hour: 9, due: -53, ev: [
    ['s', 58, 10, 'maya', 'Please have this ready before the Friday review.'], ['s', 57, 15, 'rhea', 'Blocks A and B are counted. Waiting for the C totals.'],
    ['v', 56, 11, 'sam', 14, 'Block C counting is finished. The total picked in Block C was 3975 kilos and 201 kilos were rejected.'], ['f', 56, 16, 'rhea', 'totals-csv', 'Block totals as a sheet'], ['p', 55, 9, 'rhea', 100], ['ok', 55, 14]] },
  { t: 'Replace blocked drippers in Block B', d: 'Walk rows 1 to 14, replace every blocked emitter and note how many were changed.', by: 'maya', to: ['sam'], day: 56, hour: 8, due: -52, ev: [
    ['s', 56, 12, 'sam', 'Started at row 1. Many emitters are clogged with algae.'], ['i', 55, 10, 'sam', 'drip', 'Row 4 with the new emitters fitted'], ['p', 55, 15, 'sam', 50],
    ['s', 54, 11, 'sam', 'Rows 8 to 14 done. 63 emitters replaced in total.'], ['p', 54, 12, 'sam', 100], ['ok', 54, 16]] },
  { t: 'Set up the packing line for export order 118', d: 'Line 2 must be ready with labels, punnets and the metal detector tested.', by: 'noel', to: ['tara', 'vik'], day: 54, hour: 9, due: -50, ev: [
    ['s', 54, 14, 'tara', 'Labels and punnets are in. Metal detector test is booked for tomorrow.'], ['i', 53, 11, 'vik', 'crates', 'Line 2 stacked and ready'],
    ['f', 53, 15, 'tara', 'packing-pdf', 'Packing plan for the order'], ['p', 52, 10, 'tara', 100], ['ok', 52, 15]] },
  { t: 'Calibrate the Brix meter and log the readings', d: 'Use the reference solution and record three readings per batch for two weeks.', by: 'maya', to: ['rhea'], day: 52, hour: 10, due: -40, ev: [
    ['s', 52, 15, 'rhea', 'Calibrated with the reference solution. Reading is within 0.1.'], ['i', 45, 11, 'rhea', 'chart', 'Two weeks of readings'], ['p', 39, 10, 'rhea', 100], ['ok', 38, 14]] },
  { t: 'Prepare the board update on export growth', d: 'One page with the volumes, the new buyers and what we need from the board.', by: 'zane', to: ['maya'], day: 50, hour: 9, due: -43, ev: [
    ['s', 49, 11, 'maya', 'First draft is with the COO for the logistics numbers.'], ['f', 46, 16, 'maya', 'board-pdf', 'Final one-pager'], ['p', 45, 9, 'maya', 100], ['ok', 45, 13]] },
  { t: 'Pest scouting in Blocks A to D', d: 'Check 20 plants per block for mites and aphids and photograph anything suspicious.', by: 'maya', to: ['rhea', 'vik', 'sam'], day: 47, hour: 8, due: -43, ev: [
    ['i', 46, 10, 'rhea', 'field', 'Block A, leaves look clean'], ['s', 46, 13, 'vik', 'Block C has light mite damage on the lower leaves.'],
    ['v', 45, 9, 'sam', 21, 'Block D looks clean, no mites. I checked twenty plants near the gate and found only a few aphids on two plants.'],
    ['i', 45, 12, 'vik', 'field', 'Block C damage, close to the south fence'], ['s', 45, 16, 'maya', 'Thanks. We will spray Block C on Monday.'], ['p', 44, 10, 'rhea', 100], ['ok', 44, 15]] },
  { t: 'Service the cold room compressor', d: 'Book the technician, keep the room below 4 degrees while the work is done.', by: 'noel', to: ['vik'], day: 45, hour: 9, due: -42, ev: [
    ['s', 45, 14, 'vik', 'Technician comes Thursday morning. I will move the stock to room 1.'], ['i', 43, 12, 'vik', 'cold', 'Room back to 2.4 degrees after the service'], ['p', 43, 13, 'vik', 100], ['ok', 43, 16]] },
  { t: 'Fix the fence near the Block D gate', d: 'Wild boar broke the lower wire. Repair and add two more posts.', by: 'maya', to: ['sam'], day: 43, hour: 8, due: -40, ev: [
    ['s', 42, 10, 'sam', 'Posts are on site. Starting the repair.'], ['i', 41, 14, 'sam', 'field', 'Fence repaired, two new posts'], ['p', 41, 15, 'sam', 100], ['ok', 41, 17]] },
  { t: 'Truck slots for the October dispatch', d: 'Match the truck slots with the harvest forecast and share the schedule with the packing house.', by: 'noel', to: ['maya'], day: 40, hour: 9, due: -36, ev: [
    ['s', 39, 11, 'maya', 'Draft schedule is ready, checking it against the forecast.'], ['f', 38, 15, 'maya', 'trucks-pdf', 'Truck schedule for October'], ['p', 38, 16, 'maya', 100], ['ok', 37, 9]] },
  { t: 'Weekly quality sampling, three batches', d: 'Take samples from three batches, record firmness and sugar, and report any batch below grade.', by: 'maya', to: ['tara', 'rhea'], day: 38, hour: 9, due: -33, ev: [
    ['s', 37, 12, 'tara', 'Batch 1 and 2 are fine. Batch 3 firmness is slightly low.'], ['i', 36, 11, 'rhea', 'chart', 'Firmness and sugar results'], ['p', 35, 10, 'tara', 100], ['ok', 35, 14]] },
  { t: 'Review the packaging supplier quotes', d: 'Compare the three quotes on price, delivery time and minimum order.', by: 'zane', to: ['noel'], day: 35, hour: 10, due: -28, ev: [
    ['s', 34, 14, 'noel', 'Supplier B is cheapest but needs 6 weeks. Supplier A delivers in 2 weeks.'], ['f', 31, 11, 'noel', 'quotes-pdf', 'Comparison of the three quotes'], ['s', 31, 12, 'zane', 'Go with A for the next two orders.'], ['p', 30, 9, 'noel', 100], ['ok', 30, 12]] },
  { t: 'Negotiate the cold storage contract renewal', d: 'The contract ends next month. Get a better price per pallet or a longer term.', by: 'zane', to: ['noel'], day: 33, hour: 10, due: -25, ev: [
    ['s', 32, 11, 'noel', 'The owner offered 4 percent off for a two year term.'], ['s', 31, 9, 'zane', 'Ask for 6 percent and a clause for extra space in peak weeks.'], ['s', 28, 15, 'noel', 'Agreed at 5 percent with the peak week clause.'], ['p', 27, 10, 'noel', 100], ['ok', 27, 14]] },
  { t: 'Fertiliser application in Blocks A to C', d: 'Apply the planned mix, record the quantity used per block.', by: 'maya', to: ['rhea', 'sam'], day: 32, hour: 7, due: -28, ev: [
    ['v', 31, 10, 'rhea', 18, 'I started the fertiliser in Block A this morning. The mixer is working fine and we will finish A and B today.'], ['i', 30, 11, 'sam', 'field', 'Block B after the application'],
    ['s', 30, 15, 'rhea', 'A and B are done. 240 kg used in A, 210 kg in B.'], ['p', 29, 10, 'rhea', 100], ['ok', 29, 13]] },
  { t: 'Safety drill and extinguisher check', d: 'Run the fire drill with the packing house staff and check every extinguisher tag.', by: 'noel', to: ['tara'], day: 28, hour: 9, due: -24, ev: [
    ['s', 27, 11, 'tara', 'Drill planned for Wednesday 10 am.'], ['i', 25, 14, 'tara', 'extinguisher', 'All tags updated, two extinguishers replaced'], ['p', 25, 15, 'tara', 100], ['ok', 25, 17]] },
  { t: 'Update the cold chain temperature log', d: 'The log has gaps for the last two weeks. Fill them from the data logger.', by: 'maya', to: ['vik'], day: 25, hour: 10, due: -22, ev: [
    ['s', 24, 12, 'vik', 'Downloaded the data logger file, entering it now.'], ['i', 23, 11, 'vik', 'sheet', 'Updated log, no gaps left'], ['p', 23, 12, 'vik', 100], ['ok', 23, 15]] },
  { t: 'Clear the weeds along the irrigation canal', d: 'Both sides of the main canal, from the pump house to Block E.', by: 'maya', to: ['sam', 'rhea'], day: 21, hour: 8, due: -16, ev: [
    ['s', 20, 12, 'sam', 'Started from the pump house side with the two helpers.'], ['i', 18, 11, 'rhea', 'leak', 'Canal bank after clearing'], ['p', 17, 10, 'rhea', 100], ['ok', 17, 14]] },
  { t: 'Count and label the new picking crates', d: 'About 400 new crates. Number them and record them in the stock sheet.', by: 'noel', to: ['vik', 'tara'], day: 17, hour: 9, due: -13, ev: [
    ['s', 16, 13, 'vik', 'Counted 412 crates. Labelling now.'], ['i', 14, 10, 'tara', 'crates', 'Labelled stack, ready for the blocks'], ['p', 14, 11, 'vik', 100], ['ok', 14, 15]] },
  { t: 'Retrain the pickers on ripeness grading', d: 'Short session with the picture cards for every picking team.', by: 'maya', to: ['rhea', 'sam'], day: 13, hour: 9, due: -9, ev: [
    ['v', 12, 10, 'rhea', 24, 'We finished the grading session with teams one and two. The picture cards help a lot and the pickers now understand the colours.'], ['i', 11, 12, 'sam', 'field', 'Team 3 with the grading cards'],
    ['s', 11, 15, 'rhea', 'All five teams are done. Rejects dropped the next day.'], ['p', 10, 10, 'rhea', 100], ['ok', 10, 14]] },
  { t: 'Approve the Q4 harvest forecast', d: 'Check the forecast sheet and confirm the numbers for the buyers.', by: 'zane', to: ['maya'], day: 9, hour: 10, due: -5, ev: [
    ['s', 8, 11, 'maya', 'Forecast is 12 percent above last year. Details in the sheet.'], ['f', 7, 15, 'maya', 'forecast-csv', 'Q4 forecast by block'], ['p', 6, 9, 'maya', 100], ['ok', 5, 11]] },
  { t: 'Dispatch checklist for the Colombo order', d: 'Check labels, temperature, seals and paperwork before the truck leaves.', by: 'noel', to: ['tara'], day: 6, hour: 9, due: -3, ev: [
    ['s', 5, 12, 'tara', 'Labels and seals checked. Truck arrives at 4 pm.'], ['i', 4, 17, 'tara', 'truck', 'Truck loaded and sealed'], ['p', 3, 9, 'tara', 100], ['ok', 3, 12]] },

  /* ---------- finished, waiting for the manager to approve ---------- */
  { t: 'Prepare the packing schedule for Friday', d: 'Match the truck slots with the harvest forecast.', by: 'maya', to: ['rhea', 'sam'], day: 4, hour: 9, due: 0, ev: [
    ['s', 3, 11, 'rhea', 'Drafted and shared with the packing house.'], ['i', 2, 14, 'sam', 'crates', 'Crate stacks for the first truck'], ['p', 0, 8, 'rhea', 100]] },
  { t: 'Monthly lab results summary', d: 'Summarise the pesticide residue and sugar results from the lab for the file.', by: 'noel', to: ['vik'], day: 3, hour: 10, due: 1, unread: true, ev: [
    ['s', 2, 12, 'vik', 'All residue results are well under the limit.'], ['f', 1, 15, 'vik', 'lab-pdf', 'Lab summary for this month'], ['p', 1, 16, 'vik', 100]] },
  { t: 'Summarise export order status for the board', d: 'One short note: orders shipped, orders pending and any risk to the dates.', by: 'zane', to: ['noel'], day: 3, hour: 14, due: 2, ev: [
    ['s', 2, 10, 'noel', 'Four orders shipped, two pending. No date is at risk right now.'], ['p', 0, 9, 'noel', 100]] },

  /* ---------- in progress ---------- */
  { t: 'Check irrigation in Block C', d: 'Walk the lines and report any leaks or blocked drippers.', by: 'maya', to: ['rhea', 'sam'], day: 6, hour: 9, due: 2, ev: [
    ['v', 5, 10, 'rhea', 14, 'I walked rows one to ten in Block C. The water pressure is good. I will check the rest of the rows this afternoon.'], ['s', 5, 14, 'sam', 'Rows 1 to 10 are fine. Two drippers blocked in row 11, fixing now.'],
    ['i', 3, 11, 'rhea', 'leak', 'Leak at the joint near row 12'], ['s', 3, 15, 'maya', 'Please fix the joint first, it wastes the most water.'], ['p', 2, 10, 'sam', 60]] },
  { t: 'Transplant new seedlings in Block E', d: 'About 3,000 seedlings. Keep 40 cm between plants.', by: 'maya', to: ['sam', 'tara'], day: 5, hour: 8, due: 5, ev: [
    ['s', 4, 11, 'sam', 'First 1,200 are in. Soil is moist enough.'], ['i', 3, 12, 'tara', 'field', 'New rows in Block E, day 2'],
    ['v', 1, 10, 'sam', 17, 'We planted another eight hundred seedlings in Block E. The soil is moist and the seedlings look healthy.'], ['p', 1, 11, 'sam', 40]] },
  { t: 'Install the shelving in cold room 2', d: 'Six racks, anchored to the floor, and move the stock back.', by: 'noel', to: ['tara', 'vik'], day: 4, hour: 9, due: 6, ev: [
    ['s', 3, 12, 'vik', 'Racks delivered. Two are missing the corner brackets.'], ['s', 3, 14, 'noel', 'Ask the supplier to send them tomorrow.'], ['i', 1, 13, 'tara', 'cold', 'Room 2 with the first racks in place'], ['p', 1, 14, 'vik', 25]] },
  { t: 'Draft the next season expansion plan', d: 'Land, water, labour and the investment needed for 10 more acres.', by: 'zane', to: ['maya'], day: 3, hour: 10, due: 10, ev: [
    ['s', 2, 11, 'maya', 'I have the land and water numbers. Labour costs are next.'], ['f', 1, 16, 'maya', 'plan-pdf', 'First draft of the plan'], ['p', 1, 17, 'maya', 30]] },
  { t: 'Send soil samples to the lab', d: 'Five samples from different blocks, labelled, with the request form.', by: 'maya', to: ['vik'], day: 2, hour: 9, due: 4, ev: [
    ['i', 1, 10, 'vik', 'drip', 'Taking the sample next to the drip line in Block B'], ['s', 1, 13, 'vik', 'Three samples collected, two more tomorrow.'], ['p', 1, 14, 'vik', 50]] },
  { t: 'Prepare the supplier audit documents', d: 'Collect certificates, spray records and training logs for the audit.', by: 'noel', to: ['maya'], day: 1, hour: 11, due: 7, unread: true, ev: [
    ['s', 1, 15, 'maya', 'I have the training logs. The spray records are still with the field team.'], ['f', 0, 9, 'maya', 'audit-pdf', 'Spray record list so far'], ['p', 0, 10, 'maya', 20]] },
  { t: 'Update the harvest forecast sheet', d: 'Use the latest picking numbers and move the forecast for the next three weeks.', by: 'maya', to: ['rhea'], day: 2, hour: 15, due: 3, ev: [
    ['s', 1, 9, 'rhea', 'Picking numbers are in. Working on the next three weeks.'], ['p', 1, 10, 'rhea', 45]] },

  /* ---------- overdue ---------- */
  { t: 'Repair the pump house roof', d: 'The roof leaks over the electric panel. Repair before the rains get heavier.', by: 'maya', to: ['sam'], day: 21, hour: 9, due: -9, ev: [
    ['s', 20, 12, 'sam', 'Checked the roof. We need sheets and screws from the hardware shop.'], ['s', 17, 10, 'maya', 'Did the materials arrive?'], ['s', 17, 14, 'sam', 'Not yet, the shop says Monday.'],
    ['i', 12, 11, 'sam', 'leak', 'Water marks next to the panel after last night rain'], ['p', 12, 12, 'sam', 35], ['s', 8, 9, 'maya', 'This is now late. Please tell me what you need to finish.']] },
  { t: 'Weekly equipment inspection report', d: 'Check sprayers, pumps and the tractor and report anything that needs repair.', by: 'maya', to: ['tara', 'rhea'], day: 18, hour: 8, due: -6, ev: [
    ['v', 17, 11, 'rhea', 19, 'I checked the sprayers and the water pumps. Sprayer two has a worn seal and pump three is making a noise. I have not checked the tractor yet.'], ['s', 15, 14, 'tara', 'Sprayer 2 has a worn seal. Ordered a spare.'], ['p', 14, 10, 'rhea', 70], ['s', 7, 10, 'maya', 'Report still missing the tractor and the pumps.']] },
  { t: 'Reconcile the packaging material stock', d: 'Count punnets, labels and cartons and match them to the stock sheet.', by: 'noel', to: ['vik'], day: 15, hour: 10, due: -4, ev: [
    ['s', 14, 12, 'vik', 'Counting punnets today, labels tomorrow.'], ['f', 11, 15, 'vik', 'stock-csv', 'Stock count so far'], ['p', 10, 16, 'vik', 55], ['s', 5, 11, 'noel', 'Two carton sizes are still missing from the count.']] },
  { t: 'Submit the compliance checklist to the exporter', d: 'Complete every section, attach the certificates and submit through the exporter portal.', by: 'zane', to: ['maya', 'noel'], day: 12, hour: 9, due: -2, ev: [
    ['s', 11, 12, 'noel', 'Logistics sections are complete. Waiting for the farm sections.'], ['f', 7, 14, 'maya', 'compliance-pdf', 'Farm sections as a draft'], ['p', 6, 15, 'maya', 80], ['s', 3, 9, 'zane', 'The exporter called. We must submit by this week.']] },

  /* ---------- sent back once, now being reworked ---------- */
  { t: 'Mark the irrigation valves on the site map', d: 'Every valve numbered on the printed site map, so night staff can find them.', by: 'maya', to: ['rhea'], day: 10, hour: 9, due: 1, ev: [
    ['s', 9, 12, 'rhea', 'Marked the valves in A and B.'], ['p', 7, 11, 'rhea', 100], ['back', 7, 15, 'Blocks C and D are missing, and valve 14 is in the wrong place.'], ['s', 6, 10, 'rhea', 'Understood, going to C and D tomorrow.'],
    ['i', 3, 12, 'rhea', 'sheet', 'Updated map with C and D'], ['p', 3, 13, 'rhea', 70]] },

  /* ---------- just assigned ---------- */
  { t: 'Send the Q4 budget draft', d: '', by: 'zane', to: ['noel'], day: 0, hour: 8, due: 2, unread: true, ev: [] },
  { t: 'Plan the weekend harvest shifts', d: 'Two shifts on Saturday, one on Sunday. Check who can work.', by: 'maya', to: ['rhea', 'vik'], day: 0, hour: 9, due: 1, unread: true, ev: [] },
  { t: 'Arrange transport for the Sunday dispatch', d: 'Confirm the truck, the driver and the loading time with the packing house.', by: 'noel', to: ['tara'], day: 1, hour: 16, due: 1, unread: true, ev: [
    ['s', 0, 8, 'tara', 'I called the transporter. Will confirm the time this afternoon.']] }
];

function mockPdf_(title, lines) {
  const esc = function (s) { return String(s).replace(/[\\()]/g, '\\$&'); };
  let content = 'BT /F1 20 Tf 56 780 Td (' + esc(title) + ') Tj /F1 12 Tf 0 -34 Td 18 TL\n';
  lines.forEach(function (l) { content += '(' + esc(l) + ') Tj T*\n'; }); content += 'ET';
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length ' + content.length + '>>\nstream\n' + content + '\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
  out += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
  return Utilities.base64Encode(out);
}
function mockDoc_(key) {
  const csv = function (name, text) { return { name: name, b64: Utilities.base64Encode(text) }; };
  const pdf = function (name, title, lines) { return { name: name, b64: mockPdf_(title, lines) }; };
  const d = {
    'totals-csv': function () { return csv('block-totals-september.csv', 'Block,Picked kg,Rejected kg\nA,4820,160\nB,4310,142\nC,3975,201\nD,2210,64\n'); },
    'forecast-csv': function () { return csv('q4-harvest-forecast.csv', 'Block,October kg,November kg,December kg\nA,5200,5600,4800\nB,4700,5100,4300\nC,4300,4700,3900\nD,2600,2900,2400\nE,0,1200,2600\n'); },
    'stock-csv': function () { return csv('packaging-stock-count.csv', 'Item,Counted,In sheet\nPunnets 250g,18400,18650\nLabels,22100,22100\nCartons small,1320,1500\nCartons large,610,\n'); },
    'packing-pdf': function () { return pdf('packing-plan-order-118.pdf', 'Packing plan - export order 118', ['Line 2, two shifts.', 'Punnets 250 g, 12 per carton.', 'Metal detector test before the first pallet.', 'Pallets: 14, cold room 1 until dispatch.']); },
    'board-pdf': function () { return pdf('export-growth-board-update.pdf', 'Export growth - board update', ['Volumes up 18 percent on last season.', 'Two new buyers in the Gulf region.', 'Need: approval for a second cold room.']); },
    'trucks-pdf': function () { return pdf('october-truck-schedule.pdf', 'October truck schedule', ['Mon, Wed, Fri 4 pm - Colombo.', 'Tue, Thu 6 am - Airport cargo.', 'Extra truck on peak weeks, book 3 days ahead.']); },
    'quotes-pdf': function () { return pdf('packaging-quotes-comparison.pdf', 'Packaging quotes', ['Supplier A: delivery 2 weeks, minimum 5,000.', 'Supplier B: cheapest, delivery 6 weeks.', 'Supplier C: highest price, same-week delivery.']); },
    'lab-pdf': function () { return pdf('lab-results-summary.pdf', 'Lab results summary', ['Residue tests: all below the limit.', 'Sugar (Brix): 11.2 to 12.8.', 'Next samples due in 4 weeks.']); },
    'plan-pdf': function () { return pdf('expansion-plan-draft.pdf', 'Expansion plan - draft 1', ['10 acres next to Block E.', 'Water: second borehole needed.', 'Labour: 12 more pickers in season.']); },
    'audit-pdf': function () { return pdf('spray-records-list.pdf', 'Spray records', ['Blocks A to D, last 90 days.', 'Products and dates listed.', 'Missing: Block E, to be added.']); },
    'compliance-pdf': function () { return pdf('compliance-checklist-draft.pdf', 'Exporter compliance checklist', ['Section 1 - Farm: complete.', 'Section 2 - Packing: complete.', 'Section 3 - Traceability: draft.']); }
  };
  return d[key]();
}
// a soft three-second "voice-like" sample (the invented voice messages have no real recording)
function mockWavB64_() {
  const rate = 16000, n = rate * 3, bytes = [];
  const put16 = function (v) { bytes.push(v & 255, (v >> 8) & 255); }, put32 = function (v) { bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }, str = function (s) { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };
  str('RIFF'); put32(36 + n * 2); str('WAVE'); str('fmt '); put32(16); put16(1); put16(1); put32(rate); put32(rate * 2); put16(2); put16(16); str('data'); put32(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate, f0 = 130 + 25 * Math.sin(t * 2.3), syl = Math.pow(Math.abs(Math.sin(t * 9.4)), 0.7) * (Math.sin(t * 1.7) > -0.8 ? 1 : 0.1);
    const s = (Math.sin(6.2832 * f0 * t) + 0.5 * Math.sin(6.2832 * 2 * f0 * t) + 0.35 * Math.sin(6.2832 * 3 * f0 * t)) * 0.07 * syl;
    put16(Math.round(Math.max(-1, Math.min(1, s)) * 32767) & 65535);
  }
  return Utilities.base64Encode(bytes.map(function (b) { return b > 127 ? b - 256 : b; }));
}

function mockSeed() {
  const props = PropertiesService.getScriptProperties(), started = Date.now();
  const state = JSON.parse(props.getProperty('MOCK_STATE') || '{"next":0,"ids":[],"failed":[],"done":false}');
  if (state.done) { Logger.log('The mock data is already in place. Run mockClean() first if you want to start again.'); return; }
  let said = '';
  const ai = { transcribe: function () { return { english: said, language: 'English', key_points: '' }; },
    summarize: function () { throw new Error('AI is off while seeding'); }, assistant: function () { throw new Error('AI is off while seeding'); }, briefing: function () { throw new Error('AI is off while seeding'); } };
  const env = makeEnv_({ ai: ai }), core = createCore(env);
  env.store.init(core.TABLES);
  const realAll = env.store.all.bind(env.store);
  const alias = mockAlias_(), people = {}, byName = {}, tok = {}, virtual = [];
  realAll('Users').filter(function (u) { return u.active && !u.isAdmin; }).forEach(function (u) { people[String(u.name).toLowerCase()] = u; });
  const needed = {}; MOCK_TASKS_.forEach(function (s) { needed[s.by] = 1; s.to.forEach(function (n) { needed[n] = 1; }); });
  const realName = function (n) { return String(alias[n] || n).toLowerCase(); };
  const missing = Object.keys(needed).filter(function (n) { return !people[realName(n)]; });
  if (missing.length) throw new Error('These people are not in the system (the story needs them): ' + missing.map(function (n) { return realName(n); }).join(', ') + '. Map the story names to your people with the script property MOCK_PEOPLE.');
  Object.keys(needed).forEach(function (n) {
    const u = people[realName(n)]; byName[n] = u; tok[n] = 'mock-' + Utilities.getUuid();
    virtual.push({ tokenHash: env.sha256Hex('token:' + tok[n]), userId: u.id, expires: 9e15, createdAt: 0, lastSeen: 9e15 });
  });
  // "borrow" the accounts in memory only: nothing is written to Users or Sessions
  env.store.all = function (name) {
    const rows = realAll(name);
    if (name === 'Users') return rows.map(function (u) { return Object.assign({}, u, { mustChange: false }); });
    if (name === 'Sessions') return rows.concat(virtual);
    return rows;
  };
  let clock = Date.now(); env.now = function () { return clock; };
  const call = function (action, who, params) {
    const r = core.handle(Object.assign({ action: action, token: tok[who] }, params || {}));
    if (!r.ok) throw new Error(action + ' as ' + who + ' failed: ' + r.error);
    return r.data;
  };
  const tz = Session.getScriptTimeZone(), mid = new Date(); mid.setHours(0, 0, 0, 0);
  const M0 = mid.getTime(), real = Date.now(), DAY = 86400000, HOUR = 3600000;
  const when = function (day, hour) { return Math.min(M0 - day * DAY + hour * HOUR, real - 120000); };
  const ymd = function (n) { return Utilities.formatDate(new Date(M0 + n * DAY), tz, 'yyyy-MM-dd'); };
  const save = function () { props.setProperty('MOCK_STATE', JSON.stringify(state)); };
  const imgs = {}, img = function (kind) {
    if (!imgs[kind]) {
      const f = UrlFetchApp.fetch(mockBase_() + kind + '.jpg'), t = UrlFetchApp.fetch(mockBase_() + kind + '.thumb.jpg');
      imgs[kind] = { b64: Utilities.base64Encode(f.getContent()), thumb: 'data:image/jpeg;base64,' + Utilities.base64Encode(t.getContent()) };
    }
    return imgs[kind];
  };
  const wav = mockWavB64_();
  let n = 0;
  for (let i = state.next; i < MOCK_TASKS_.length; i++) {
    if (Date.now() - started > 210000) { Logger.log('Stopping for now (time limit). ' + i + ' of ' + MOCK_TASKS_.length + ' tasks are done. Run mockSeed() again.'); return; }
    const spec = MOCK_TASKS_[i];
    try {
      clock = when(spec.day, spec.hour);
      const task = call('createTask', spec.by, { title: spec.t, description: spec.d, assigneeIds: spec.to.map(function (nm) { return byName[nm].id; }), dueDate: ymd(spec.due) }).task;
      state.ids.push(task.id); save();
      const events = spec.ev.map(function (e, k) { return { e: e, k: k, t: when(e[1], e[2]) }; }).sort(function (a, b) { return a.t - b.t || a.k - b.k; });
      let closed = false;
      events.forEach(function (x) {
        const e = x.e, kind = e[0]; clock = x.t;
        if (kind === 's') call('postMessage', e[3], { taskId: task.id, text: e[4] });
        else if (kind === 'v') { said = e[5] || ''; call('postVoice', e[3], { taskId: task.id, audioB64: wav, wavB64: wav, mime: 'audio/wav', secs: e[4] }); }
        else if (kind === 'i') { const im = img(e[4]); n++; call('postFile', e[3], { taskId: task.id, name: e[4] + '-' + (state.ids.length) + '-' + n + '.jpg', b64: im.b64, thumb: im.thumb, w: 720, h: 500, caption: e[5] }); }
        else if (kind === 'f') { const d = mockDoc_(e[4]); call('postFile', e[3], { taskId: task.id, name: d.name, b64: d.b64, caption: e[5] }); }
        else if (kind === 'p') call('setProgress', e[3], { taskId: task.id, progress: e[4] });
        else if (kind === 'ok') { call('approveTask', spec.by, { taskId: task.id }); closed = true; }
        else if (kind === 'back') call('rejectTask', spec.by, { taskId: task.id, note: e[3] });
      });
      if (!closed && !spec.unread) { clock = real; [spec.by].concat(spec.to).forEach(function (who) { call('getTask', who, { taskId: task.id }); }); }   // already read (opening a task marks it read)
      state.next = i + 1; save();
      Logger.log((i + 1) + '/' + MOCK_TASKS_.length + ' ' + spec.t);
    } catch (e) {
      state.failed.push({ i: i, title: spec.t, error: String(e) }); state.next = i + 1; save();
      Logger.log('FAILED at task ' + (i + 1) + ' (' + spec.t + '): ' + e + ' - it is skipped; the part that was made is removed by mockClean().');
    }
  }
  state.done = true; save();
  Logger.log('ALL DONE. ' + state.ids.length + ' mock tasks' + (state.failed.length ? ', ' + state.failed.length + ' failed (see MOCK_STATE)' : '') + '. Remove them later with mockClean().');
}

function mockStatus() {
  const s = JSON.parse(PropertiesService.getScriptProperties().getProperty('MOCK_STATE') || 'null');
  Logger.log(s ? 'Mock tasks made: ' + s.ids.length + ', next index ' + s.next + ' of ' + MOCK_TASKS_.length + (s.done ? ', finished' : ', NOT finished') + (s.failed && s.failed.length ? ', failed: ' + JSON.stringify(s.failed) : '') : 'No mock data has been made.');
}

function mockClean() {
  const props = PropertiesService.getScriptProperties(), state = JSON.parse(props.getProperty('MOCK_STATE') || 'null');
  if (!state || !state.ids.length) { Logger.log('There is no mock data to remove.'); return; }
  const env = makeEnv_({}), core = createCore(env); env.store.init(core.TABLES);
  const ids = {}; state.ids.forEach(function (id) { ids[id] = 1; });
  const trash = function (fileId) { if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ } } };
  env.store.all('Messages').filter(function (m) { return ids[m.taskId]; }).forEach(function (m) { trash(m.audioFileId); });
  env.store.all('Attachments').filter(function (a) { return ids[a.taskId]; }).forEach(function (a) { trash(a.fileId); });
  env.store.all('ArchiveIndex').filter(function (x) { return ids[x.id]; }).forEach(function (x) {
    try { const parents = DriveApp.getFileById(x.fileId).getParents(); while (parents.hasNext()) parents.next().setTrashed(true); } catch (e) { /* already gone */ }
  });
  const out = {
    messages: env.store.removeWhere('Messages', function (m) { return ids[m.taskId]; }),
    attachments: env.store.removeWhere('Attachments', function (a) { return ids[a.taskId]; }),
    reads: env.store.removeWhere('Reads', function (r) { return ids[r.taskId]; }),
    tasks: env.store.removeWhere('Tasks', function (t) { return ids[t.id]; }),
    history: env.store.removeWhere('ArchiveIndex', function (x) { return ids[x.id]; }),
    audit: env.store.removeWhere('AuditLog', function (a) { return ids[a.detail]; }),
    overviews: env.store.removeWhere('Briefings', function () { return true; })
  };
  props.deleteProperty('MOCK_STATE');
  Logger.log('Mock data removed: ' + JSON.stringify(out) + '. Drive folders and files went to the Drive trash.');
}

// speedTest()  Times the assistant on your real data (as the first active person, without changing anything): whole request, the model
//              call alone, typed and spoken, so we can see where the waiting goes. Writes nothing.
function speedTest() {
  const real = makeAi_(), env = makeEnv_({ ai: real }), core = createCore(env); env.store.init(core.TABLES);   // the same AI chain the app uses (Claude / Groq if they have keys, then Gemini)
  Logger.log('AI chain: ' + (prop_('ANTHROPIC_API_KEY') ? 'Claude, ' : '') + (prop_('GROQ_API_KEY') ? 'Groq (' + groqModels_().join(', ') + '), ' : '') + 'Gemini');
  const props = PropertiesService.getScriptProperties(), before = props.getProperty('ASSISTANT_AUDIO_MODEL');
  const realAll = env.store.all.bind(env.store);
  const me = realAll('Users').filter(function (u) { return u.active && !u.isAdmin; })[0], tok = 'speed-' + Utilities.getUuid();
  const virtual = [{ tokenHash: env.sha256Hex('token:' + tok), userId: me.id, expires: 9e15, createdAt: 0, lastSeen: 9e15 }];
  env.store.all = function (name) { const rows = realAll(name); if (name === 'Users') return rows.map(function (u) { return Object.assign({}, u, { mustChange: false }); }); if (name === 'Sessions') return rows.concat(virtual); return rows; };
  const run = function (label, req) {
    GEMINI_LOG_.length = 0; const a = Date.now(), r = core.handle(Object.assign({ action: 'assistant', token: tok, history: [] }, req)), total = Date.now() - a;
    const model = GEMINI_LOG_.reduce(function (n, x) { return n + x.ms; }, 0);
    Logger.log(label + ': total ' + total + ' ms (model ' + model + ' ms, rest ' + (total - model) + ' ms) ' + GEMINI_LOG_.map(function (x) { return x.model + ' ' + x.code; }).join(',') + ' | HEARD: ' + (r.ok ? r.data.heard : r.error));
  };
  Logger.log('Asking as ' + me.name);
  run('typed', { text: 'What needs my attention today?' });
  const phrases = ['Which tasks are overdue and who is responsible for them?', 'Give Vik a task to check the cold room temperature by Friday.', 'ඉරිගේෂන් පද්ධතියේ ඉදිරි වැට මොනවාද කියලා කියන්න'];
  const samples = [];
  phrases.forEach(function (ph) { try { samples.push({ ph: ph, b64: new GeminiAi_().speak(ph).b64 }); } catch (e) { Logger.log('could not make a speech sample (' + e + ')'); } });
  try {
    ['main', 'fast'].forEach(function (order) {
      props.setProperty('ASSISTANT_AUDIO_MODEL', order);
      samples.forEach(function (x, i) { run('SPOKEN [' + order + ' model first] sample ' + (i + 1), { wavB64: x.b64 }); });
    });
  } finally { if (before === null) props.deleteProperty('ASSISTANT_AUDIO_MODEL'); else props.setProperty('ASSISTANT_AUDIO_MODEL', before); }
}

// speechTest()  Spoken questions through the real AI chain, using two small recordings from the website (read-only, writes nothing).
function speechTest() {
  const real = makeAi_(), env = makeEnv_({ ai: real }), core = createCore(env); env.store.init(core.TABLES);
  const realAll = env.store.all.bind(env.store);
  const me = realAll('Users').filter(function (u) { return u.active && !u.isAdmin; })[0], tok = 'speech-' + Utilities.getUuid();
  const virtual = [{ tokenHash: env.sha256Hex('token:' + tok), userId: me.id, expires: 9e15, createdAt: 0, lastSeen: 9e15 }];
  env.store.all = function (name) { const rows = realAll(name); if (name === 'Users') return rows.map(function (u) { return Object.assign({}, u, { mustChange: false }); }); if (name === 'Sessions') return rows.concat(virtual); return rows; };
  Logger.log('AI chain: ' + (prop_('ANTHROPIC_API_KEY') ? 'Claude, ' : '') + (prop_('GROQ_API_KEY') ? 'Groq, ' : '') + 'Gemini; asking as ' + me.name);
  ['speech1.wav', 'speech2.wav', 'speech1.wav'].forEach(function (f, i) {
    const wav = UrlFetchApp.fetch(mockBase_() + f.replace('.wav', '.txt')).getContentText().trim();   // the recording as base64 text (the repository refuses .wav files on purpose)
    GEMINI_LOG_.length = 0; const a = Date.now(), r = core.handle({ action: 'assistant', token: tok, history: [], wavB64: wav }), total = Date.now() - a;
    Logger.log('spoken ' + (i + 1) + ' (' + f + '): ' + total + ' ms | ' + GEMINI_LOG_.map(function (x) { return x.model + ' ' + x.code + ' ' + x.ms + 'ms'; }).join(', ') + ' | HEARD: ' + (r.ok ? r.data.heard + ' | REPLY: ' + String(r.data.reply).slice(0, 110) : r.error));
  });
}
