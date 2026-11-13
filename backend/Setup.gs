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
    transcribe: function () { return { transcript: 'වැඩේ අවසන්', language: 'Sinhala', english_translation: 'The work is finished' }; },
    summarize: function () { return { summary_en: 'ok', summary_si: 'හරි', health: 'on_track', blockers: [], next_steps: [], progress_note: 'x' }; }
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
    check(v.message.status === 'ok' && v.message.transcript === 'වැඩේ අවසන්', 'voice message saved and transcribed (Sinhala text survives the sheet)');
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
  } finally {
    ss.getId() && DriveApp.getFileById(ss.getId()).setTrashed(true);
    root.setTrashed(true);
  }
  if (problems.length) throw new Error('Smoke test FAILED: ' + problems.join(' | '));
  Logger.log('ALL SMOKE TESTS PASSED');
}

/* ------------------------------ AI helpers ------------------------------ */

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
