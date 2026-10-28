/*******************************************************************
 * Catalog.gs - the approved-course catalog for the Exchange Office.
 *
 * A separate spreadsheet (it now includes the student's name and ID for
 * each approval, so share it only with staff who may see student data) with one tab per host university. Every time
 * a head of department approves a course, the equivalence is added.
 *
 * No duplicates: a host course appears once per Home University course it was
 * approved against. The same host course gets a second row only when
 * it was approved as a DIFFERENT Home University course. Codes are compared
 * ignoring case, spaces and punctuation ("ELN-301" = "eln 301").
 * The first approval is kept; later identical approvals are skipped.
 * University tabs use the official name from the Universities tab, so
 * "EU1" and "Example University One" share one tab.
 *******************************************************************/

const CATALOG_HEADERS = [
  'Host course code', 'Host course name', 'Host credits',
  'Home University course code', 'Home University course name', 'Home University credits',
  'Counts as', 'Minimum grade', 'Home University department',
  'Approved by', 'Approver email', 'Approved on',
  'Host syllabus', 'Host university', 'Host country', 'CPF reference',
  'Faculty reviewer', 'Match %',
  'Student name', 'Student ID',
  'Host credit system', 'Online / In-person'   // Oct 2026, added on the right so older tabs keep their columns
];
// Positions of the two codes used for the duplicate check.
const CATALOG_HOST_COL = 0;
const CATALOG_HOME_COL = 3;

/** One catalog row, in CATALOG_HEADERS order. */
function catalogRow_(sub, c) {
  return [
    c.host_course_code, c.host_course_name, c.host_credits,
    c.home_course_code, c.home_course_name, c.home_credits,
    c.course_type + (c.ger_area ? ' (' + c.ger_area + ')' : ''), str_(c.grade_required) || CFG.GRADE_REMARK, c.dept_name,
    c.hod_signature, c.decision_by, c.decision_at,
    [c.host_syllabus_url, c.host_syllabus2_url].map(str_).filter(Boolean).join('\n'), sub.host_university, sub.host_country, sub.submission_id,
    c.faculty_signature ? c.faculty_signature + ' (' + c.faculty_email + ')' : '', c.faculty_match_pct,
    sub.student_name, sub.student_id,
    str_(c.host_credit_system), str_(c.host_mode)
  ];
}

let CATALOG_SS_ = null;

/** Opens the catalog spreadsheet, creating it inside the CPF Drive folder the first time. */
function catalog_() {
  if (CATALOG_SS_) return CATALOG_SS_;
  const id = prop_('CATALOG_ID');
  if (id) {
    try { return (CATALOG_SS_ = SpreadsheetApp.openById(id)); } catch (e) { console.warn('Catalog missing, recreating: ' + e); }
  }
  CATALOG_SS_ = SpreadsheetApp.create(CFG.CATALOG_NAME);
  CATALOG_SS_.setSpreadsheetTimeZone(CFG.TZ);
  DriveApp.getFileById(CATALOG_SS_.getId()).moveTo(rootFolder_());
  setProp_('CATALOG_ID', CATALOG_SS_.getId());
  return CATALOG_SS_;
}

/** "ELN-301 " -> "ELN301" */
function courseKey_(code) {
  return str_(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Tab names: no []*?/\: and at most 100 characters. */
function tabName_(university) {
  return (str_(university).replace(/[\[\]*?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown university').
    slice(0, 100);
}

/** The university's tab, matched case-insensitively; created with headers if missing. */
function catalogTab_(ss, university) {
  const name = tabName_(university);
  const existing = ss.getSheets().find(sh => sh.getName().toLowerCase() === name.toLowerCase());
  if (existing) {
    // Tabs made before a column was added get the new headers on the right.
    const have = existing.getLastColumn();
    if (have < CATALOG_HEADERS.length) {
      if (existing.getMaxColumns() < CATALOG_HEADERS.length) {
        existing.insertColumnsAfter(existing.getMaxColumns(), CATALOG_HEADERS.length - existing.getMaxColumns());
      }
      existing.getRange(1, have + 1, 1, CATALOG_HEADERS.length - have)
        .setValues([CATALOG_HEADERS.slice(have)])
        .setFontWeight('bold').setBackground(CFG.BRAND_COLOR).setFontColor('#ffffff');
    }
    return existing;
  }

  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, CATALOG_HEADERS.length).setValues([CATALOG_HEADERS])
    .setFontWeight('bold').setBackground(CFG.BRAND_COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return sh;
}

/**
 * Adds approved courses to the catalog, skipping duplicates.
 * entries: [{ sub, course }]. One read and one write per university tab.
 * Returns the number of new rows.
 */
function catalogAddMany_(entries) {
  const byUni = {};
  entries.forEach(e => {
    const name = tabName_(e.sub.host_university);
    (byUni[name] = byUni[name] || []).push(e);
  });

  const ss = catalog_();
  let added = 0;
  Object.keys(byUni).forEach(uni => {
    const sh = catalogTab_(ss, uni);
    const last = sh.getLastRow();
    const seen = new Set(last < 2 ? [] :
      sh.getRange(2, 1, last - 1, CATALOG_HEADERS.length).getValues()
        .map(r => courseKey_(r[CATALOG_HOST_COL]) + '|' + courseKey_(r[CATALOG_HOME_COL])));

    const rows = [];
    byUni[uni].forEach(({ sub, course }) => {
      const key = courseKey_(course.host_course_code) + '|' + courseKey_(course.home_course_code);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(catalogRow_(sub, course));
    });

    if (rows.length) {
      ensureRows_(sh, last + rows.length);
      sh.getRange(last + 1, 1, rows.length, CATALOG_HEADERS.length).setValues(rows.map(r => r.map(safeCell_)));
      added += rows.length;
    }
  });
  return added;
}

/**
 * Called when a head of department approves courses. A catalog problem
 * is logged but never blocks the approval itself.
 */
function catalogAdd_(sub, courses) {
  try {
    const newRows = catalogAddMany_(courses.map(course => ({ sub, course })));
    log_(sub.submission_id, 'system', 'CATALOG_ADDED',
      newRows + ' new of ' + courses.length + ' approved (rest already in the catalog)');
  } catch (e) {
    console.error('catalog failed: ' + e);
    log_(sub.submission_id, 'system', 'CATALOG_FAILED', String(e));
  }
}

/** CPF menu: adds every course ever approved (oldest first). Safe to run again. */
function rebuildCatalog() {
  requireAdmin_();
  return withLock_(() => {
    const subs = {};
    readAll_(CFG.SHEETS.SUB).forEach(s => { subs[s.submission_id] = s; });
    const entries = readAll_(CFG.SHEETS.CRS).
      filter(c => c.status === CRS_STATUS.APPROVED && subs[c.submission_id]).
      sort((a, b) => new Date(a.decision_at) - new Date(b.decision_at)).
      map(c => ({ sub: subs[c.submission_id], course: c }));
    const msg = catalogAddMany_(entries) + ' course(s) added to the catalog (' +
      entries.length + ' approved in total).';
    toast_(msg);
    return msg;
  });
}

/**
 * Deletes catalog rows whose CPF reference makes isDoomedRef() true, then
 * drops university tabs left empty. Used by the clean-up tools in Test.gs.
 * Returns the number of rows removed.
 */
function catalogRemove_(isDoomedRef) {
  if (!prop_('CATALOG_ID')) return 0;
  const ss = catalog_();
  const refCol = CATALOG_HEADERS.indexOf('CPF reference');
  let removed = 0;

  ss.getSheets().forEach(sh => {
    const last = sh.getLastRow();
    if (last < 2) return;
    const rows = sh.getRange(2, 1, last - 1, CATALOG_HEADERS.length).getValues();
    const keep = rows.filter(r => !isDoomedRef(String(r[refCol])));
    if (keep.length === rows.length) return;
    removed += rows.length - keep.length;
    sh.getRange(2, 1, rows.length, CATALOG_HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, CATALOG_HEADERS.length).setValues(keep.map(r => r.map(safeCell_)));
  });

  // A spreadsheet must keep one tab, so an empty 'Sheet1' stands in when all go.
  ss.getSheets().filter(sh => sh.getLastRow() < 2 && sh.getName() !== 'Sheet1').forEach(sh => {
    if (ss.getSheets().length === 1) ss.insertSheet('Sheet1');
    ss.deleteSheet(sh);
  });
  return removed;
}

function showCatalogLink() {
  requireAdmin_();
  const msg = 'Approved-course catalog:\n\n' + catalog_().getUrl() +
    '\n\nShare this spreadsheet with the Exchange Office team (view only is enough).';
  console.log(msg);
  // The pop-up only works from the CPF menu in the Sheet; from the editor, read the Execution log.
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log('Ignored: ' + e); /* no Sheet open */ }
  return msg;
}
