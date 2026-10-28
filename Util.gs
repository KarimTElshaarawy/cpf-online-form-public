/*******************************************************************
 * Util.gs - spreadsheet data layer, sign-in checks, text clean-up,
 * logging and small helpers.
 *
 * Each tab is read at most once per execution (one getValues call)
 * and kept in DB_, with lazy indexes on the key columns. Writes update
 * the sheet and the cached row object together, so the rest of the
 * request never re-reads the sheet. withLock_() clears the cache on
 * entry, so anything read under the lock is fresh.
 *
 * Every piece of text is written with a leading apostrophe (safeCell_).
 * Sheets then stores exactly what was typed and reads it back without
 * the apostrophe: "3-4" stays text instead of becoming a date, "00123"
 * keeps its zeros, and "=IMPORTXML(...)" can never run as a formula in
 * the Exchange Office's spreadsheet. Verified against this spreadsheet, 30 Sep 2026.
 *******************************************************************/

let DB_ = {};             // tab name -> { sh, head, col, rows, lastRow, idx, bySub }
let LOG_QUEUE_ = [];      // log lines written in one batch by flushLog_()
let SS_ = null;
let PROPS_ = null;

// ---------------------------------------------------------------- properties

function prop_(key) {
  if (!PROPS_) PROPS_ = PropertiesService.getScriptProperties().getProperties();
  return PROPS_[key] || '';
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  if (PROPS_) PROPS_[key] = value;
}

// ---------------------------------------------------------------- sheets

/** The spreadsheet this script works on. Bound sheet by default. */
function ss_() {
  if (SS_) return SS_;
  const id = prop_('SHEET_ID');
  if (id) return (SS_ = SpreadsheetApp.openById(id));
  SS_ = SpreadsheetApp.getActiveSpreadsheet();
  if (!SS_) throw new Error('No spreadsheet bound. Run setUp() from the editor once.');
  setProp_('SHEET_ID', SS_.getId());
  return SS_;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet tab: ' + name + '. Run setUp() from the editor.');
  return sh;
}

/** Reads a whole tab once and caches it for the rest of the execution. */
function table_(name) {
  if (DB_[name]) return DB_[name];
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(h => String(h).trim());
  const col = {};
  head.forEach((h, i) => { if (h) col[h] = i; });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (values[r].join('') !== '') rows.push(toRow_(head, values[r], r + 1));
  }
  return (DB_[name] = { sh, head, col, rows, lastRow: values.length, idx: {}, bySub: null });
}

/** Adds rows at the bottom when a write would go past the sheet's grid. */
function ensureRows_(sh, lastRowNeeded) {
  const max = sh.getMaxRows();
  if (lastRowNeeded > max) sh.insertRowsAfter(max, lastRowNeeded - max);
}

/** Sheets refuses to delete every non-frozen row, so keep one spare blank row. */
function keepSpareRow_(sh) {
  if (sh.getLastRow() >= sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
}

/** Row object keyed by header. _row (sheet row number) is hidden from JSON. */
function toRow_(head, values, rowNum) {
  const o = {};
  head.forEach((h, c) => { if (h) o[h] = values[c]; });
  Object.defineProperty(o, '_row', { value: rowNum });
  return o;
}

function readAll_(name) {
  return table_(name).rows;
}

/** Columns whose value never changes once a row is written, so lookups on them are indexed. */
const KEY_FIELDS_ = ['submission_id', 'course_row_id', 'dept_key'];

function findRow_(name, field, value) {
  const t = table_(name);
  const v = String(value);
  if (KEY_FIELDS_.indexOf(field) === -1) return t.rows.find(r => String(r[field]) === v) || null;
  if (!t.idx[field]) {
    const m = new Map();
    t.rows.forEach(r => { const k = String(r[field]); if (!m.has(k)) m.set(k, r); });
    t.idx[field] = m;
  }
  return t.idx[field].get(v) || null;
}

/** Keeps a table's lazy indexes in step with a newly appended row. */
function indexRow_(t, row) {
  Object.keys(t.idx).forEach(f => { const k = String(row[f]); if (!t.idx[f].has(k)) t.idx[f].set(k, row); });
  if (t.bySub) {
    const k = String(row.submission_id);
    (t.bySub[k] = t.bySub[k] || []).push(row);
  }
}

/** Text goes in with a leading apostrophe so Sheets keeps it exactly as typed (see the header). */
function safeCell_(v) {
  return typeof v === 'string' && v !== '' ? "'" + v : v;
}

/** Appends a row (matched by header name) and returns the cached row object. */
function append_(name, obj) {
  return appendMany_(name, [obj])[0];
}

/** Appends several rows with a single write; returns the cached row objects. */
function appendMany_(name, objs) {
  if (!objs.length) return [];
  const t = table_(name);
  const first = t.lastRow + 1;
  const matrix = objs.map(o => t.head.map(h => (h && h in o ? o[h] : '')));
  ensureRows_(t.sh, first + matrix.length - 1);
  t.sh.getRange(first, 1, matrix.length, t.head.length).setValues(matrix.map(r => r.map(safeCell_)));
  t.lastRow += matrix.length;
  return matrix.map((values, i) => {
    const row = toRow_(t.head, values, first + i);
    t.rows.push(row);
    indexRow_(t, row);
    return row;
  });
}

/**
 * Applies patch to a cached row object and writes only the changed cells,
 * one setValues call per run of adjacent columns. Keys without a matching
 * column are kept on the object only.
 */
function update_(name, row, patch) {
  const t = table_(name);
  Object.assign(row, patch);
  const cols = Object.keys(patch).
    filter(k => k in t.col).
    map(k => t.col[k]).
    sort((a, b) => a - b);

  for (let i = 0; i < cols.length; i++) {
    const start = i;
    while (i + 1 < cols.length && cols[i + 1] === cols[i] + 1) i++;
    const run = cols.slice(start, i + 1);
    t.sh.getRange(row._row, run[0] + 1, 1, run.length)
      .setValues([run.map(c => safeCell_(row[t.head[c]]))]);
  }
}

/** Deletes every row matching pred, bottom-up in contiguous blocks. */
function deleteWhere_(name, pred) {
  const t = table_(name);
  const doomed = t.rows.filter(pred).map(r => r._row).sort((a, b) => b - a);
  if (doomed.length) keepSpareRow_(t.sh);
  for (let i = 0; i < doomed.length; i++) {
    const start = i;
    while (i + 1 < doomed.length && doomed[i + 1] === doomed[i] - 1) i++;
    t.sh.deleteRows(doomed[i], i - start + 1);
  }
  delete DB_[name];
  return doomed.length;
}

/**
 * Script-wide lock around every state change. Clears the read cache on
 * entry, flushes queued log lines and pending writes before release.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_WAIT_MS)) {
    throw new Error('The form is busy right now. Please try again in a few seconds.');
  }
  DB_ = {};
  try {
    return fn();
  } finally {
    flushLog_();
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- logging

/** Queues a log line; flushLog_() writes the queue in one call. */
function log_(submissionId, actor, action, detail) {
  const line = [
    new Date(), submissionId || '', actor || '', action || '',
    typeof detail === 'string' ? detail : JSON.stringify(detail == null ? '' : detail)
  ];
  // Oct 2026: two readable columns at the end, the student and a plain-English sentence,
  // so anyone can read the Log tab without knowing the codes. Never blocks the action.
  let student = '';
  let sentence = '';
  try {
    student = logStudent_(submissionId);
    sentence = logSentence_(submissionId, actor, action, detail);
  } catch (e) {
    sentence = humanize_(action);
  }
  LOG_QUEUE_.push(line.concat([student, sentence]));
}

/** "Jane Doe (b00012345)" for the Log tab, or '' when the form is unknown. */
function logStudent_(sid) {
  if (!sid) return '';
  const sub = findRow_(CFG.SHEETS.SUB, 'submission_id', sid);
  return sub ? str_(sub.student_name) + ' (' + str_(sub.student_id) + ')' : '';
}

/** "COURSE_ADDED" -> "Course added". */
function humanize_(code) {
  const words = str_(code).toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One sentence in plain English for a Log line: who did what, to which course or step, and
 * for emails who got it, the subject and the attachments. Unknown codes fall back to the
 * code in words plus the details.
 */
function logSentence_(sid, actor, action, detail) {
  let d = detail;
  if (typeof d === 'string' && /^[[{]/.test(d)) { try { d = JSON.parse(d); } catch (e) { d = detail; /* not JSON after all: keep the text */ } }
  const o = d && typeof d === 'object' ? d : {};
  const text = typeof d === 'string' ? d : '';
  const sub = sid ? findRow_(CFG.SHEETS.SUB, 'submission_id', sid) : null;
  const actorEmail = str_(actor).toLowerCase();
  const who = !actorEmail || actorEmail === 'system' ? 'The system'
    : sub && actorEmail === str_(sub.student_email).toLowerCase() ? 'The student (' + actorEmail + ')' : actorEmail;
  const course = id => {
    const c = sid && id ? coursesFor_(sid).find(x => String(x.course_row_id) === String(id)) : null;
    return c ? (str_(c.host_course_code) + ' ' + str_(c.host_course_name)).trim() : str_(id);
  };
  const courses = ids => [].concat(ids || []).map(course).join(', ');
  const step = key => {
    const s = stageByKey_(str_(key));
    return s ? 'the ' + s.label + ' (Step ' + (s.step || 'III') + ')' : str_(key);
  };
  const list = v => emailList_(v).join(', ');
  switch (action) {
    case 'EMAIL_SENT': {
      const files = [].concat(o.files || []).filter(Boolean);
      return 'Email sent to ' + list(o.to) + (o.cc ? ', with a copy to ' + list(o.cc) : '') +
        '. Subject: "' + str_(o.subject) + '".' +
        (files.length ? ' Attached: ' + files.join(', ') + '.' : ' No attachments.') +
        (o.test ? ' TEST MODE: it was really delivered only to ' + o.test + '.' : '');
    }
    case 'MAIL_FAILED':
      return 'Email to ' + list(o.to) + ' could NOT be sent (subject "' + str_(o.subject) + '"). Error: ' + str_(o.error);
    case 'ATTACHMENTS_FAILED':
      return 'The CPF PDF and syllabi could not be attached to an email, so it went without them. Error: ' + text;
    case 'INTAKE_SUBMITTED':
      return who + ' started the form (intake page) with ' + str_(o.credits) + ' earned credits. It now waits for the Exchange Office to check the host university (Step I).';
    case 'STEP1_APPROVED':
      return who + ' approved Step I (host university check)' + (text ? '. Agreement type: ' + text : '') + '. The student can now add courses (Step II).';
    case 'STEP1_DECLINED':
      return who + ' declined Step I (host university check). The form is closed.';
    case 'STEP1_RESENT':
      return who + ' sent the Step I request to the Exchange Office again.';
    case 'COURSE_ADDED':
      return who + ' added the course ' + course(text) + ' (draft, not sent yet).';
    case 'COURSE_UPDATED':
      return who + ' edited the course ' + course(text) + '.';
    case 'COURSES_SENT':
      return who + ' sent ' + [].concat(o.courses || []).length + ' course(s) for approval to ' + list(o.to) + ': ' + courses(o.courses) + '.';
    case 'COURSES_RESENT':
      return who + ' sent the waiting course(s) to the head of department again.';
    case 'COURSE_WITHDRAWN':
      return who + ' withdrew the course ' + course(text) + '.';
    case 'COURSE_REMOVED':
      return who + ' removed the course ' + course(text) + ' (approved on the earlier form) from this amendment.';
    case 'COURSE_RESTORED':
      return who + ' put the course ' + course(text) + ' back on the form.';
    case 'COURSE_APPROVE':
      return who + ' approved the course ' + course(text) + ' for the department.';
    case 'COURSE_DENY':
      return who + ' declined the course ' + course(text) + ' for the department.';
    case 'COURSE_FORWARDED':
      return who + ' forwarded the course ' + course(o.course) + ' to ' + list(o.to) + ' (faculty member) for review.';
    case 'FACULTY_REVIEWED':
      return who + ' (faculty member) reviewed the course ' + course(o.course) + ': ' + str_(o.recommendation) +
        (o.match !== undefined && o.match !== '' ? ', ' + o.match + '% match' : '') + '. It goes back to the head of department.';
    case 'FACULTY_RESENT':
      return who + ' sent the faculty review request again.';
    case 'HOD_EMAIL_CONFIRMED':
      return who + ' (Exchange Office) confirmed the head of department email the student typed, so that person reviews the course.';
    case 'HOD_EMAIL_DECLINED':
      return who + ' (Exchange Office) declined the head of department email the student typed, so the saved head of department reviews the course.';
    case 'GATE_CONFIRMED':
      return who + ' confirmed the course list is final. Step III signatures start now.';
    case 'REOPENED':
      return who + ' chose "Change my courses": the form went back to Step II and the Step III signatures so far were cleared.';
    case 'RESTARTED_AFTER_DECLINE':
      return who + ' corrected the answers after a decline. Steps III and IV start again from the beginning.';
    case 'STAGE_STARTED':
      return 'The form is now waiting for ' + step(text) + ' to sign.';
    case 'STAGE_CARRIED':
      return 'Amendment: the line for ' + step(o.stage) + ' was copied from form ' + str_(o.from) + ' (amendments do not sign Step III again).';
    case 'STAGE_NA':
      return step(text).replace(/^the /, 'The ') + ' does not apply to this student, so it is marked N/A.';
    case 'STAGE_RESENT':
      return who + ' sent the signing request for ' + step(text || o.stage) + ' again.';
    case 'STAGE_APPROVE':
      return who + ' signed and approved as ' + step(text) + '.';
    case 'STAGE_DENY':
      return who + ' declined the form as ' + step(text) + '. The student is emailed the reason.';
    case 'AWAITING_SIGNATURE':
      return 'All approvals before the student are in. The student was asked to sign.';
    case 'STUDENT_SIGNED':
      return 'The student signed the form (' + (text || 'typed') + ' signature).';
    case 'COMPLETED':
      return 'The form is complete. The final signed PDF is built and emailed to the student, the Exchange Office and the Registration Officer.';
    case 'PDF_FAILED':
      return 'The final signed PDF could not be built or saved. Signature images were kept so it can be retried (CPF menu). Error: ' + text;
    case 'PDF_EMAIL_FAILED':
      return 'The final signed PDF was saved but the email with it failed. It can be retried from the CPF menu.';
    case 'AMENDMENT_STARTED':
      return who + ' started an amendment (a new version) of a completed form.';
    case 'AMENDS':
      return 'This form is an amendment of form ' + (text || str_(o.parent)) + '.';
    case 'REPLACED_BY_AMENDMENT':
      return 'This form was replaced by its completed amendment ' + text + '.';
    case 'CATALOG_ADDED':
      return 'Approved course(s) added to the course catalog workbook' + (text ? ': ' + text : '') + '.';
    case 'CATALOG_FAILED':
      return 'Approved course(s) could NOT be added to the course catalog workbook. Error: ' + text;
    case 'FOLDER_CREATED':
      return 'A Drive folder was created' + (text ? ': ' + text : '') + '.';
    case 'SIGNATURE_IMAGES_DELETED':
    case 'SIGNATURE_IMAGES_PARTLY_DELETED':
      return 'Drawn / uploaded signature pictures deleted after the final PDF was sent (' + str_(o.deleted) + ' deleted' +
        (Number(o.kept) ? ', ' + o.kept + ' could not be deleted yet' : '') + ').';
    case 'SIGNATURE_CLEANUP':
      return 'Daily clean-up of signature pictures' + (text ? ': ' + text : '') + '.';
    default: {
      const extra = text || Object.keys(o).map(k => k + ': ' + (/course/i.test(k) ? courses(o[k]) : JSON.stringify(o[k]))).join(', ');
      return (who === 'The system' ? '' : who + ': ') + humanize_(action) + (extra ? ' (' + extra + ')' : '') + '.';
    }
  }
}

/**
 * Fills the plain-English "student" and "what_happened" columns for Log lines written
 * before Oct 2026 (or any line where they are blank). Safe to run more than once.
 */
function explainLog() {
  requireAdmin_();
  const sh = sheet_(CFG.SHEETS.LOG);
  const last = sh.getLastRow();
  if (last < 2) return 'Nothing to explain.';
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const cStudent = head.indexOf('student');
  const cWhat = head.indexOf('what_happened');
  if (cStudent < 0 || cWhat < 0) throw new Error('Run setUp first: the Log tab has no student / what_happened columns yet.');
  const rows = sh.getRange(2, 1, last - 1, head.length).getValues();
  let n = 0;
  const out = rows.map(r => {
    if (str_(r[cWhat])) return [r[cStudent], r[cWhat]];
    n++;
    let studentText = '';
    let whatText = '';
    try { studentText = logStudent_(r[1]); whatText = logSentence_(str_(r[1]), r[2], str_(r[3]), r[4]); } catch (e) { whatText = humanize_(r[3]); }
    return [studentText, whatText];
  });
  sh.getRange(2, cStudent + 1, out.length, 1).setValues(out.map(x => [safeCell_(x[0])]));
  sh.getRange(2, cWhat + 1, out.length, 1).setValues(out.map(x => [safeCell_(x[1])]));
  sh.setColumnWidth(cStudent + 1, 200);
  sh.setColumnWidth(cWhat + 1, 640);
  sh.getRange(1, cWhat + 1, last, 1).setWrap(true);
  const msg = 'Explained ' + n + ' older log line(s).';
  console.log(msg);
  return msg;
}

/** Log columns are fixed: timestamp, submission_id, actor, action, detail, student, what_happened. */
function flushLog_() {
  if (!LOG_QUEUE_.length) return;
  const lines = LOG_QUEUE_;
  LOG_QUEUE_ = [];
  try {
    const sh = sheet_(CFG.SHEETS.LOG);
    const first = sh.getLastRow() + 1;
    ensureRows_(sh, first + lines.length - 1);
    sh.getRange(first, 1, lines.length, lines[0].length).setValues(lines.map(r => r.map(safeCell_)));
  } catch (e) {
    console.warn('log failed: ' + e);
  }
}

// ---------------------------------------------------------------- ids/tokens

function uid_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
}

function secret_() {
  const saved = prop_('CPF_SECRET');
  if (saved) return saved;
  const fresh = Utilities.getUuid() + Utilities.getUuid();
  setProp_('CPF_SECRET', fresh);
  return fresh;
}

/** Deterministic, unguessable 32-hex-char token for a (scope, id) pair. */
function token_(scope, id) {
  return Utilities.computeHmacSha256Signature(scope + '|' + id, secret_()).
    slice(0, 16)
    .map(b => ((b & 0xff) | 0x100).toString(16).slice(1))
    .join('');
}

/** Throws unless 'given' is the token for (scope, id). */
function checkToken_(scope, id, given) {
  if (!id || !given || !safeEqual_(token_(scope, id), String(given))) {
    if (id && given) badLinkAlert_(scope);   // a link was tried with a wrong token
    throw new Error('This link is not valid.');
  }
}

/**
 * Counts wrong-token attempts per signed-in account (CacheService, one hour). At 5 and again at 25
 * the Exchange Office gets one email naming the account, so someone guessing links is noticed. It never
 * throws and never puts a token in the email or the log.
 */
function badLinkAlert_(scope) {
  try {
    const me = currentUser_() || '(no account reported)';
    const cache = CacheService.getScriptCache();
    const key = 'badlink_' + Utilities.base64EncodeWebSafe(me).slice(0, 80);
    const n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 3600);
    console.warn('Invalid link (' + scope + ') from ' + me + ': attempt ' + n + ' this hour.');
    if (n === 5 || n === 25) {
      sendMail_(CFG.EXO_EMAIL, 'Security alert: repeated invalid links',
        '<p>The account <b>' + esc_(me) + '</b> opened or tried <b>' + n + '</b> form links with a wrong security code within one hour (area: ' +
        esc_(scope) + ').</p><p>A mistyped or old link does this a few times, so one or two are normal. Repeated attempts may mean someone is guessing links. ' +
        'Check the Executions log and the Log tab, and tell the institution IT team if it looks deliberate.</p>');
    }
  } catch (e) { console.warn('badLinkAlert_ failed: ' + e); }
}

/** Constant-time string comparison, so response timing does not leak the token. */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- validation

function str_(v) {
  return String(v == null ? '' : v).trim();
}

/** Throws "<prefix><field name>" for the first key of obj that is blank. */
function requireFields_(obj, keys, prefix) {
  const missing = keys.find(k => !str_(obj[k]));
  if (missing) throw new Error(prefix + missing.replace(/_/g, ' '));
}

function isEmail_(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str_(v));
}

/** A typed-name electronic signature, trimmed, or an error. */
function signature_(v, message) {
  const s = tidyText_(v);
  if (s.length < CFG.SIGNATURE_MIN_LENGTH) throw new Error(message || 'Please type your full name to sign.');
  return s;
}

let CLIENT_IP_ = '';

/**
 * Remembers the IP address that came with a signature (set once per signing call).
 * The signer's browser looks it up (Script.html), so it is an audit trail, not proof:
 * the signed-in institution account is what identifies the signer.
 */
function noteIp_(v) {
  const s = str_(v);
  CLIENT_IP_ = /^[0-9a-fA-F:.]{3,45}$/.test(s) ? s : '';
}

/** The IP to store with a signature: blank when capture is off, 'not reported' when the browser gave none. */
function ipNow_() {
  return ''; // IP addresses are never recorded
}

/** APPROVE or DENY, or an error. Never lets a blank choice through as a decision. */
function decision_(v) {
  if (v !== 'APPROVE' && v !== 'DENY') throw new Error('Please choose approve or decline.');
  return v;
}

function declineReason_(comments, message) {
  if (str_(comments).length < CFG.REASON_MIN_LENGTH) throw new Error(message || 'Please give a reason for declining.');
}

function isGer_(courseType) {
  return str_(courseType) === CFG.GER_COURSE_TYPE;
}

function isOther_(courseType) { return str_(courseType) === CFG.OTHER_COURSE_TYPE; }

function isYes_(v) {
  return v === true || /^(yes|true)$/i.test(str_(v));
}

// ---------------------------------------------------------------- what people type

/** Trimmed, with runs of spaces collapsed. */
function tidyText_(v) {
  return str_(v).replace(/\s+/g, ' ');
}

/** Lower case with accents removed: "Universitat Politècnica" -> "universitat politecnica". */
function fold_(v) {
  return str_(v).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * A person's name (or a semester) as typed, tidied: spaces collapsed, and text
 * typed ALL IN CAPITALS or all in lower case put into Title Case. Mixed case is
 * kept exactly, because it was typed that way on purpose ("McKenzie", "al-Example").
 */
function tidyName_(v) {
  const t = tidyText_(v);
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-'])(\S)/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/** Form references are upper case (CPF-FA26-0001); a reference typed by hand may not be. */
function refKey_(v) {
  return str_(v).toUpperCase();
}

/** A semester for comparisons: "Fall 2027", "fall-2027" and "FALL  2027" are the same. */
function semKey_(v) {
  return fold_(v).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Words that never tell two universities apart. */
const UNI_STOP_ = ['the', 'of', 'de', 'del', 'della', 'di', 'da', 'das', 'do', 'dos', 'der', 'des', 'du',
  'la', 'le', 'les', 'y', 'e', 'et', 'and', 'und', 'at', 'in',
  'university', 'universidad', 'universitat', 'universita', 'universite', 'universiteit', 'universiti',
  'universidade', 'universitet', 'univerzita', 'uniwersytet', 'univ', 'uni'];
const ROMAN_ = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/**
 * A university name reduced to what identifies it: accents, case, punctuation and
 * filler words dropped, stand-alone Roman numerals turned into digits. So
 * "Example University One" and "example univ 1" give the same key.
 * Abbreviations (EU1) are linked to the full name on the Universities tab.
 */
function uniKey_(v) {
  const words = fold_(v).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const key = words.filter(w => w && UNI_STOP_.indexOf(w) === -1).map(w => (ROMAN_[w] ? String(ROMAN_[w]) : w)).join('');
  return key || words.join('');
}

// ---------------------------------------------------------------- misc

let WEBAPP_URL_ = null;
function webAppUrl_() {
  if (WEBAPP_URL_ === null) {
    WEBAPP_URL_ = prop_('WEBAPP_URL');
    if (!WEBAPP_URL_) {
      try { WEBAPP_URL_ = ScriptApp.getService().getUrl() || ''; } catch (e) { WEBAPP_URL_ = ''; }
    }
  }
  return WEBAPP_URL_;
}

function fmt_(d) {
  return d ? Utilities.formatDate(new Date(d), CFG.TZ, CFG.DATE_FORMAT) : '';
}

const ESC_MAP_ = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP_[c]);
}

/** Test accounts with full access. Only ever true while test mode (TEST_REDIRECT) is on. */
function isTestSuperuser_(email) {
  const me = str_(email).toLowerCase();
  return !!(CFG.TEST_REDIRECT && me && emailList_(CFG.TEST_SUPERUSERS || []).indexOf(me) > -1);
}

/** Signed-in Home University user, or '' when the web app is open anonymously. */
function currentUser_() {
  try { return (Session.getActiveUser().getEmail() || '').toLowerCase(); }
  catch (e) { return ''; }
}

/**
 * Dates become strings so google.script.run can hand the object to the client.
 * Every value that leaves for a browser goes through here, so this is also where
 * values that must never reach a page are dropped:
 *   *_sig_file           signature image file ids
 *   *_ip, ip, ...Ip      IP addresses (they are kept in the Sheet ONLY)
 */
const PRIVATE_KEY_ = /(_sig_file$|_ip$|^ip$|[a-z]Ip$)/;
function plain_(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (PRIVATE_KEY_.test(k) ? undefined : v)));
}

// ---------------------------------------------------------------- sign-in (SSO)

/** Set by runSelfTest() so the self test can play every role from the editor. */
let SELF_TEST_ = false;

function emailList_(v) {
  return [].concat(v || []).reduce((all, x) =>
    all.concat(str_(x).toLowerCase().split(',').map(s => s.trim()).filter(Boolean)), []);
}

function isExoStaff_(email) {
  const me = str_(email).toLowerCase();
  return !!me && emailList_(CFG.EXO_STAFF.concat([CFG.EXO_EMAIL])).indexOf(me) > -1;
}

/**
 * Lets the call through only if the signed-in institution account is one of 'allowed'
 * (or Exchange Office staff, when opts.exo is true). If Google does not report the account,
 * an old-style link token (opts.token = { scope, id, t }) is accepted instead.
 */
function requireAccess_(allowed, opts) {
  if (SELF_TEST_) return;
  const o = opts || {};
  const me = currentUser_();
  if (isTestSuperuser_(me)) return;
  if (!me) {
    if (o.token && o.token.t) { checkToken_(o.token.scope, o.token.id, o.token.t); return; }
    throw new Error('Please sign in with your institution Google account to open this page.');
  }
  if (emailList_(allowed).indexOf(me) > -1) return;
  if (o.exo && isExoStaff_(me)) return;
  throw new Error('You are signed in as ' + me + ', but this page belongs to a different institution account. ' +
    'If you have another institution account, switch to it (Google account menu, top right) and reload. ' +
    'Otherwise contact ' + CFG.EXO_EMAIL + '.');
}

/**
 * Guard for the Exchange Office maintenance tools (menu items, editor functions). Apps Script
 * would also let any web-app visitor call a public function through
 * google.script.run, and in the web app the code runs with the owner's authority
 * on the visitor's behalf, so the signed-in user and the effective user differ.
 * From the editor, the Sheet menu or a trigger they are the same person; only
 * that case is let through.
 */
function requireAdmin_() {
  const me = currentUser_();
  let runAs = '';
  try { runAs = str_(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { console.log('Ignored: ' + e); /* unknown: refuse */ }
  if (me && me === runAs) return;
  throw new Error('This is an Exchange Office maintenance tool. Run it from the Apps Script editor or the CPF menu in the Sheet.');
}

/**
 * Associate Dean assistants never sign: they are CC'd on the Step III email and
 * reminders for information only. (Department assistants MAY sign the HoD review since
 * Oct 8, 2026; reviewScope_ lets them in, so this guard is only used for Step III.) When an assistant's account opens a signing link it
 * gets this clear refusal instead of the page. Signers and Exchange Office staff are not affected.
 */
function refuseAssistant_(assistants, signers, whoSigns) {
  if (SELF_TEST_) return;
  const me = currentUser_();
  if (!me || emailList_(signers).indexOf(me) > -1 || isExoStaff_(me)) return;
  if (emailList_(assistants).indexOf(me) > -1) {
    throw new Error('You are copied on these emails as an assistant, for information only. Only ' + whoSigns +
      ' can open and sign this page; please forward the email to them.');
  }
}

/**
 * No one approves their own form. EXO_STAFF includes student-worker accounts,
 * who could otherwise sign Step I and the Exchange Office step of a form they submitted.
 * Called by every approver action (Step I, head of department, faculty, Step III).
 */
function refuseOwnForm_(sub) {
  if (SELF_TEST_) return;
  const me = currentUser_();
  if (isTestSuperuser_(me)) return;
  if (me && me === str_(sub.student_email).toLowerCase()) {
    throw new Error('This is your own form, so you cannot approve or review it. Please ask another approver.');
  }
}

/**
 * Guard for jobs that run from a time trigger as well as from the CPF menu
 * (sendReminders, refreshSemesterTabs). A web-app visitor could pass a fake event
 * object, so the trigger id must belong to one of this project's real triggers;
 * anything else needs requireAdmin_.
 */
function requireAdminOrTrigger_(e) {
  const uid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (uid) {
    try {
      if (ScriptApp.getProjectTriggers().some(t => String(t.getUniqueId()) === uid)) return;
    } catch (err) { console.log('Could not list triggers: ' + err); }
  }
  requireAdmin_();
}

/** The form behind a reference (matched case-insensitively), or an error. */
function subOrThrow_(sid) {
  const sub = findRow_(CFG.SHEETS.SUB, 'submission_id', refKey_(sid));
  if (!sub) {
    throw new Error('Form not found. Please check the link in your email, or contact ' +
      CFG.EXO_EMAIL + ' for help.');
  }
  return sub;
}

// ---------------------------------------------------------------- Drive folders

/** The account the script runs as (the owner, for the web app, menu and triggers). */
function ownerEmail_() {
  try { return str_(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { return ''; }
}

/**
 * True when a Drive folder or file is owned by the script owner and shared with nobody:
 * no link sharing and no editors or viewers besides the owner.
 */
function isOwnedAndPrivate_(item) {
  try {
    const me = ownerEmail_();
    const owner = item.getOwner() ? str_(item.getOwner().getEmail()).toLowerCase() : '';
    if (!me || owner !== me) return false;
    if (item.getSharingAccess() !== DriveApp.Access.PRIVATE) return false;
    return !item.getEditors().concat(item.getViewers())
      .some(u => { const e = str_(u.getEmail()).toLowerCase(); return e && e !== me; });
  } catch (e) {
    return false;
  }
}

/**
 * The script's own Drive folder for propKey. Never trusts a folder just because of its
 * name: Drive also lists folders other people share with the owner.
 *   1. A saved id (script property propKey) that still opens: always used.
 *   2. No usable id: a folder with this name is adopted ONLY if the script owner owns it
 *      and it is shared with nobody.
 *   3. Otherwise a fresh folder is created in the owner's My Drive (logged, including
 *      when a same-named folder was found but not adopted).
 * The id is then saved, and only the id is used from then on.
 */
function ownedFolder_(propKey, name) {
  const id = prop_(propKey);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
      console.warn(propKey + ' points at a folder in the trash; finding or creating another.');
    } catch (e) {
      console.warn(propKey + ' folder cannot be opened (' + e + '); finding or creating another.');
    }
  }
  let rejected = 0;
  const it = DriveApp.getFoldersByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (isOwnedAndPrivate_(f)) {
      setProp_(propKey, f.getId());
      log_('', 'system', 'FOLDER_ADOPTED', name + ' (owned by the script owner, not shared)');
      return f;
    }
    rejected++;
  }
  const f = DriveApp.createFolder(name);
  setProp_(propKey, f.getId());
  log_('', 'system', 'FOLDER_CREATED', name + (rejected ?
    ' (a fresh folder: ' + rejected + ' folder(s) with this name exist but are not owned by the script owner or are shared, so they were NOT used)' : ''));
  console.log('Created Drive folder "' + name + '"' + (rejected ? ' (same-named folders were not used: not owned or shared)' : ''));
  return f;
}

function toast_(msg) {
  console.log(msg);
  try { ss_().toast(msg, 'CPF', 6); } catch (e) { console.log('(no Sheet open for a toast)'); }
}

/** "6 ECTS": a host course's credits with their credit system (rows from before Oct 2026 have none). */
function hostCreditsText_(c) {
  return [str_(c.host_credits), str_(c.host_credit_system)].filter(Boolean).join(' ');
}
