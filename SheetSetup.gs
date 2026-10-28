/*******************************************************************
 * SheetSetup.gs - one-time setup: tabs, headers, menu, Departments.
 * Run setUp() once from the editor after pasting the code.
 *******************************************************************/

const SUB_HEADERS = [
  'submission_id', 'created_at', 'updated_at', 'status',
  'student_name', 'student_id', 'student_email', 'student_mobile',
  'current_semester', 'college', 'major', 'concentration', 'student_class',
  'credits_completed', 'gpa', 'expected_graduation',
  'host_university', 'host_country', 'host_semesters',
  'host_contact_name', 'host_contact_email',
  'advisor_name', 'advisor_email',
  'has_scholarship', 'has_sponsor',
  'conditions_agreed', 'agreed_at',
  's1_accredited', 's1_agreement', 's1_major_accreditation', 's1_program_type',
  's1_comments', 's1_by', 's1_at', 's1_signature',
  'gate_confirmed_at', 'current_stage',
  // one block per Step III / IV stage (keys match STAGES in Config.gs)
  'ADV_status', 'ADV_by', 'ADV_at', 'ADV_comments', 'ADV_signature',
  'DEAN_status', 'DEAN_by', 'DEAN_at', 'DEAN_comments', 'DEAN_signature',
  'FIN_status', 'FIN_by', 'FIN_at', 'FIN_comments', 'FIN_signature',
  'SPON_status', 'SPON_by', 'SPON_at', 'SPON_comments', 'SPON_signature',
  'EXO_status', 'EXO_by', 'EXO_at', 'EXO_comments', 'EXO_signature',
  'RO_status', 'RO_by', 'RO_at', 'RO_comments', 'RO_signature', 'registrar_email',
  'REG_status', 'REG_by', 'REG_at', 'REG_comments', 'REG_signature',
  'student_signature', 'signed_at',
  'drive_folder_id', 'pdf_url',
  'reminded_at',   // when whoever holds Step I / the current Step III stage was last emailed
  'completed_at',
  // versions (Phase1_Courses.gs): an amendment is a new version of a completed form
  'amends_id', 'root_id', 'amendment_no', 'amended_by', 'reopened_at',
  // IP address the signer's browser reported at each signature (Util.gs noteIp_)
  's1_ip', 'ADV_ip', 'DEAN_ip', 'FIN_ip', 'SPON_ip', 'EXO_ip', 'RO_ip', 'REG_ip', 'student_ip',
  // Signature method (typed / drawn / "drawn signature, image deleted on ...") and, only while a
  // drawn image is kept, its private Drive file id (Signatures.gs). Never shown to anyone.
  's1_sig_method', 's1_sig_file',
  'ADV_sig_method', 'ADV_sig_file', 'DEAN_sig_method', 'DEAN_sig_file',
  'FIN_sig_method', 'FIN_sig_file', 'SPON_sig_method', 'SPON_sig_file',
  'EXO_sig_method', 'EXO_sig_file', 'RO_sig_method', 'RO_sig_file', 'REG_sig_method', 'REG_sig_file',
  'student_sig_method', 'student_sig_file',
  'pdf_sent_at'    // when the final signed PDF was emailed (images are deleted only after this)
];

const CRS_HEADERS = [
  'course_row_id', 'submission_id', 'seq', 'created_at', 'updated_at',
  'host_course_code', 'host_course_name', 'host_credits', 'host_syllabus_url',
  'host_credit_system', 'host_mode',   // Oct 2026: US credits / ECTS / UK credits / typed; In-person / Online
  'dept_key', 'dept_name', 'hod_email', 'assistant_email',
  'home_course_code', 'home_course_name', 'home_credits',
  'course_type', 'ger_area', 'grade_required', 'prereqs_met',
  'status', 'sent_at', 'decision_by', 'decision_at', 'decision_comments',
  'hod_signature', 'hod_ip', 'replaces_row_id', 'reminded_at',
  // optional faculty review (Faculty.gs)
  'faculty_email', 'forwarded_by', 'forwarded_at', 'forward_note',
  'faculty_recommendation', 'faculty_match_pct', 'faculty_match_notes', 'faculty_signature', 'faculty_ip', 'faculty_at',
  // amendments: an approved course carried over from the earlier version, and where it was approved
  'carried_from', 'approved_in',
  // signature method and, while kept, the private drawn-image file id (Signatures.gs)
  'hod_sig_method', 'hod_sig_file', 'faculty_sig_method', 'faculty_sig_file',
  // optional College/School Designate (Departments tab) copied with the HoD, and who signed:
  // hod_role = 'HoD', 'Designate' or 'Assistant' (a department assistant may sign the HoD review)
  'designate_email', 'hod_role',
  // HoD email typed by the student and the check against the Departments tab:
  // MATCH, MISMATCH (held for the Exchange Office), CONFIRMED (EXO: send to the typed email), DECLINED (EXO: saved HoD)
  'hod_email_entered', 'hod_email_check',
  // Oct 2026: a second host syllabus (an entry with two host courses) and the student's suggested equivalent Home University course(s)
  'host_syllabus2_url', 'alt_course_code', 'alt_course_name'
];

/**
 * Departments. designate_email (optional) is the College/School Designate who may sign
 * the department's courses instead of the head of department. The department assistant(s)
 * (assistant_email) are CC'd on every HoD email and may also sign the HoD review (role Assistant).
 */
const DEPT_HEADERS = ['dept_key', 'dept_name', 'college', 'hod_name', 'hod_email', 'assistant_email', 'designate_email'];

// student and what_happened (Oct 2026): the plain-English columns anyone can read (Util.gs logSentence_).
const LOG_HEADERS = ['timestamp', 'submission_id', 'actor', 'action', 'detail', 'student', 'what_happened'];

const UNI_HEADERS = ['university', 'country', 'aliases'];

/**
 * Host universities: the official name, the country, and other ways students write it
 * (comma separated). Whatever a student types is matched against all of them, ignoring
 * case, accents, punctuation and words like "University", "of" or "de", and stored under
 * the official name. So "eu1", "EU 1" and "Example University One" are one
 * university for duplicate checks and in the approved-course catalog. Only used to fill an
 * Universities tab. Setup fills an empty tab and adds any missing ones to a filled tab (it
 * never changes existing rows); after that, add partners on the tab itself.
 */
const UNI_SEED = [
  // INCLUDE HERE: your partner universities: official name, country, aliases (comma separated)
  ['Example University One', 'Country A', 'EU1, Example Uni One, Example Univ 1'],
  ['Example University Two', 'Country B', 'EU2, Example Uni Two, Example Univ 2']
];

/**
 * Heads of department + administrative assistants. INCLUDE HERE: take them from each
 * department's page, and re-check every semester:
 * edit here, then run CPF menu > Load department heads (or edit the
 * Departments tab directly). The assistant is CC'd on every HoD email (and may sign the HoD review);
 * several assistants can be listed, comma separated.
 * Columns: dept_key, dept_name, college, hod_name, hod_email, assistant_email
 */
const DEPT_SEED = [
  ['COLA-DEP1', 'Department One (INCLUDE HERE)', 'COLA', 'INCLUDE HERE: head name', 'hod-a1.include-here@example.edu', 'assistant-a1.include-here@example.edu'],
  ['COLA-DEP2', 'Department Two (INCLUDE HERE)', 'COLA', 'INCLUDE HERE: head name', 'hod-a2.include-here@example.edu', 'assistant-a2.include-here@example.edu'],
  ['COLB-DEP1', 'Department Three (INCLUDE HERE)', 'COLB', 'INCLUDE HERE: head name', 'hod-b1.include-here@example.edu', 'assistant-b1.include-here@example.edu'],
  ['COLC-DEP1', 'Department Four (INCLUDE HERE)', 'COLC', 'INCLUDE HERE: head name', 'hod-c1.include-here@example.edu', 'assistant-c1.include-here@example.edu'],
  ['COLD-DEP1', 'Department Five (INCLUDE HERE)', 'COLD', 'INCLUDE HERE: head name', 'hod-d1.include-here@example.edu', 'assistant-d1.include-here@example.edu']
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CPF')
    .addItem('Set up / repair tabs', 'setUp')
    .addItem('Show web app link', 'showLink')
    .addItem('Go-live check', 'goLiveCheck')
    .addItem('Send reminders now', 'sendReminders')
    .addSeparator()
    .addItem('Open approved-course catalog', 'showCatalogLink')
    .addItem('Rebuild approved-course catalog', 'rebuildCatalog')
    .addSeparator()
    .addItem('Refresh semester tabs now', 'refreshSemesterTabs')
    .addItem('Explain older Log lines in plain English', 'explainLog')
    .addSeparator()
    .addItem('Clean up signature images now', 'cleanupSignatureImages')
    .addItem('Retry final PDFs (completed forms missing their PDF or holding signature images)', 'retryFinalPdfs')
    .addSeparator()
    .addItem('Install triggers (reminders, semester tabs, signature cleanup)', 'installTriggers')
    .addItem('Load department heads (overwrites Departments tab)', 'loadDepartments')
    .addToUi();
}

function setUp() {
  requireAdmin_();
  const ss = ss_();
  setProp_('SHEET_ID', ss.getId());
  secret_();

  ensureTab_(ss, CFG.SHEETS.SUB, SUB_HEADERS);
  ensureTab_(ss, CFG.SHEETS.CRS, CRS_HEADERS);
  const dept = ensureTab_(ss, CFG.SHEETS.DEPT, DEPT_HEADERS);
  ensureTab_(ss, CFG.SHEETS.LOG, LOG_HEADERS);
  const uni = ensureTab_(ss, CFG.SHEETS.UNI, UNI_HEADERS);
  signatureFolder_();   // the private drawn-signature folder in the owner's My Drive (never shared)

  if (dept.getLastRow() < 2) writeDepartments_(DEPT_SEED.map(r => deptSeedRow_(r, '')));
  // Empty tab: write the whole list. Otherwise add only the seed universities that are not
  // there yet (matched by official name or alias), so existing rows and edits are never touched.
  if (uni.getLastRow() < 2) {
    uni.getRange(2, 1, UNI_SEED.length, UNI_HEADERS.length).setValues(UNI_SEED);
  } else {
    const have = new Set();
    uni.getRange(2, 1, uni.getLastRow() - 1, UNI_HEADERS.length).getValues().forEach(row => {
      [row[0]].concat(String(row[2] || '').split(',')).forEach(a => { const k = uniKey_(a); if (k) have.add(k); });
    });
    const missing = UNI_SEED.filter(row => !have.has(uniKey_(row[0])));
    if (missing.length) uni.getRange(uni.getLastRow() + 1, 1, missing.length, UNI_HEADERS.length).setValues(missing);
  }

  // Drop the default empty tab if it is still there.
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  ss.setSpreadsheetTimeZone(CFG.TZ);
  toast_('CPF tabs are ready.');
  return 'ok';
}

/** Creates the tab if needed and appends any missing headers on the right. */
function ensureTab_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const width = sh.getLastColumn();
  const have = width ? sh.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).trim()) : [];
  const missing = headers.filter(h => have.indexOf(h) === -1);
  const cols = have.length + missing.length;
  if (cols > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);

  sh.getRange(1, 1, 1, cols)
    .setFontWeight('bold').setBackground(CFG.BRAND_COLOR).setFontColor('#ffffff')
    .setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 32);
  // New tabs come with 26 columns; empty ones past the headers still count toward the
  // spreadsheet's cell limit, so drop them (only when nothing is written there).
  if (sh.getMaxColumns() > cols && sh.getLastColumn() <= cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
  delete DB_[name];
  return sh;
}

function showLink() {
  const url = webAppUrl_();
  const msg = url ? 'Student link:\n\n' + url :
    'Not deployed yet. Deploy > New deployment > Web app, then run this again.';
  console.log(msg);
  // The pop-up only works from the CPF menu in the Sheet; run from the editor, read the Execution log.
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log('Ignored: ' + e); /* no Sheet open */ }
  return msg;
}

/** (Re)installs the time triggers; running it twice never duplicates them. */
function installTriggers() {
  requireAdmin_();
  // archiveFinishedSemesters was the old monthly archive; it is removed if it is still installed.
  const handlers = ['sendReminders', 'refreshSemesterTabs', 'cleanupSignatureImages', 'archiveFinishedSemesters'];
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.indexOf(t.getHandlerFunction()) > -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendReminders').timeBased().atHour(CFG.REMINDER_HOUR).everyDays(1)
    .inTimezone(CFG.TZ).create();
  const tabsHour = (CFG.REMINDER_HOUR + 1) % 24;
  ScriptApp.newTrigger('refreshSemesterTabs').timeBased().atHour(tabsHour).everyDays(1)
    .inTimezone(CFG.TZ).create();
  const cleanHour = (CFG.REMINDER_HOUR + 2) % 24;
  ScriptApp.newTrigger('cleanupSignatureImages').timeBased().atHour(cleanHour).everyDays(1)
    .inTimezone(CFG.TZ).create();
  const msg = 'Triggers installed: reminders daily at ' + CFG.REMINDER_HOUR + ':00, semester tabs daily at ' +
    tabsHour + ':00, signature image cleanup daily at ' + cleanHour + ':00.';
  toast_(msg);
  return msg;
}

// ---------------------------------------------------------------- departments

function deptView_(d) {
  return {
    key: d.dept_key, name: d.dept_name, college: d.college,
    // The head of department signs the department's courses. No HoD on file: send to the
    // Exchange Office so it gets noticed and fixed. Never to the Associate Dean.
    hod_email: str_(d.hod_email) || CFG.EXO_EMAIL,
    // Optional College/School Designate: may sign instead of the HoD ('' on older rows).
    designate_email: str_(d.designate_email).toLowerCase(),
    assistant_email: str_(d.assistant_email) // CC'd and reminded; may also sign the HoD review (role Assistant)
  };
}

/** A DEPT_SEED row (6 values) as a full Departments row, with the given designate. */
function deptSeedRow_(r, designate) {
  return DEPT_HEADERS.map((h, i) => (h === 'designate_email' ? designate || '' : (i < r.length ? r[i] : '')));
}

/** Replaces the Departments rows, writing each value under its own header (column order does not matter). */
function writeDepartments_(rows) {
  const sh = ensureTab_(ss_(), CFG.SHEETS.DEPT, DEPT_HEADERS);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
  if (rows.length) {
    ensureRows_(sh, rows.length + 1);
    sh.getRange(2, 1, rows.length, head.length).setValues(rows.map(r =>
      head.map(h => { const i = DEPT_HEADERS.indexOf(h); return i > -1 ? safeCell_(r[i]) : ''; })));
  }
  delete DB_[CFG.SHEETS.DEPT];
}

/** Departments, for the course form dropdown. */
function getDepartments() {
  return readAll_(CFG.SHEETS.DEPT).filter(d => d.dept_key).map(deptView_);
}

function deptByKey_(key) {
  const d = findRow_(CFG.SHEETS.DEPT, 'dept_key', key);
  return d ? deptView_(d) : null;
}

/**
 * Writes DEPT_SEED into the Departments tab (replacing what is there),
 * then re-points every course that is still DRAFT or PENDING REVIEW at
 * the correct head of department, designate and assistant. Designates are
 * typed on the tab (DEPT_SEED has none), so each department keeps the one it had.
 */
function loadDepartments() {
  requireAdmin_();
  return withLock_(() => {
    ensureTab_(ss_(), CFG.SHEETS.DEPT, DEPT_HEADERS);
    const keep = {};
    readAll_(CFG.SHEETS.DEPT).forEach(d => { if (str_(d.designate_email)) keep[str_(d.dept_key)] = str_(d.designate_email); });
    writeDepartments_(DEPT_SEED.map(r => deptSeedRow_(r, keep[r[0]])));

    const msg = DEPT_SEED.length + ' departments loaded (designates kept). ' + refreshCourseApprovers_() +
      ' open course(s) re-pointed to the right head of department.';
    toast_(msg);
    return msg;
  });
}

/**
 * Re-copies HoD, designate and assistant emails from the Departments tab onto open course rows.
 * Rows where the Exchange Office CONFIRMED the HoD email the student typed (hod_email_check = CONFIRMED) are
 * left alone: that decision overrides the Departments tab for that course.
 */
function refreshCourseApprovers_() {
  let n = 0;
  readAll_(CFG.SHEETS.CRS).forEach(c => {
    if (c.status !== CRS_STATUS.DRAFT && c.status !== CRS_STATUS.PENDING) return;
    if (c.hod_email_check === 'CONFIRMED') return;
    const d = deptByKey_(c.dept_key);
    if (!d) return;
    if (c.hod_email !== d.hod_email || c.assistant_email !== d.assistant_email || c.dept_name !== d.name ||
        str_(c.designate_email).toLowerCase() !== d.designate_email) {
      update_(CFG.SHEETS.CRS, c, { hod_email: d.hod_email, assistant_email: d.assistant_email, dept_name: d.name,
        designate_email: d.designate_email });
      n++;
    }
  });
  return n;
}
