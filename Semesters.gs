/*******************************************************************
 * Semesters.gs - one overview tab per exchange semester.
 *
 * Every form stays in the Submissions, Courses and Log tabs for good.
 * Nothing is archived, moved or deleted, and a student can amend a
 * completed form at any time, however old it is.
 *
 * refreshSemesterTabs() adds one read-only overview tab per exchange
 * semester ("Spring 2026", "Fall 2026" ...) at the bottom of this
 * workbook, oldest first. A form goes on the tab of the semester the
 * student typed in "Host semesters"; if that cannot be read, on the
 * tab of the semester it was submitted in. The tabs are rebuilt from
 * the master tabs every time, so edit Submissions and Courses, not
 * these tabs.
 *
 * Runs daily (CPF menu > Install triggers) or on demand (CPF menu >
 * Refresh semester tabs now).
 *******************************************************************/

/** Semester a date falls in, per CFG.SEMESTERS: { label: 'Fall 2026', key: sortable number }. */
function semesterOf_(date) {
  const d = new Date(date);
  const month = Number(Utilities.formatDate(d, CFG.TZ, 'M'));
  let year = Number(Utilities.formatDate(d, CFG.TZ, 'yyyy'));
  let index = CFG.SEMESTERS.map(s => s.startMonth).filter(m => m <= month).length - 1;
  if (index < 0) { index = CFG.SEMESTERS.length - 1; year--; }  // before the first start month
  return { label: CFG.SEMESTERS[index].name + ' ' + year, key: year * 10 + index };
}

/**
 * Reads a term such as "Fall 2027" ("fall-2027" and "2027 Fall" too) into { label, key, display },
 * or null. label/key = the semester the term STARTS in (used for the semester tabs and sorting);
 * display = how the term is stored on the form. They differ only for the two year-long options:
 * "Academic year 2027/2028" (label Fall 2027) and "Calendar year 2027" (label Spring 2027).
 */
function parseSemester_(text) {
  const names = CFG.SEMESTERS.map(s => s.name.toLowerCase());
  // "Academic year 2027/2028" starts in Fall 2027; "Calendar year 2027" starts in Spring 2027.
  const yr = /\b(academic|calendar) year\b\D{0,3}([1-9]\d{3})/i.exec(String(text || ''));
  if (yr) {
    const academic = yr[1].toLowerCase() === 'academic';
    const y = Number(yr[2]);
    const first = names.indexOf(academic ? 'fall' : 'spring');
    if (first > -1) {
      return { label: CFG.SEMESTERS[first].name + ' ' + y, key: y * 10 + first,
        display: academic ? 'Academic year ' + y + '/' + (y + 1) : 'Calendar year ' + y };
    }
  }
  const m = /\b(spring|summer|fall|autumn|winter)\b\D{0,3}([1-9]\d{3})|\b([1-9]\d{3})\D{0,3}(spring|summer|fall|autumn|winter)\b/i.exec(String(text || ''));
  if (!m) return null;
  const termWord = (m[1] || m[4]).toLowerCase().replace('autumn', 'fall');
  const termYear = Number(m[2] || m[3]);
  const termIndex = names.indexOf(termWord);
  if (termIndex === -1) return null;
  const label = CFG.SEMESTERS[termIndex].name + ' ' + termYear;
  return { label: label, key: termYear * 10 + termIndex, display: label };
}

/** The exchange semester of a form: its Host semesters term, else the semester it was submitted in. */
function semesterOfForm_(sub) {
  const term = parseSemester_(sub.host_semesters);
  if (term) return term;
  return sub.created_at ? semesterOf_(sub.created_at) : { label: 'Unsorted', key: 0 };
}

/**
 * The clean term for a new form ("Fall 2027", "Academic year 2027/2028", "Calendar year 2027"),
 * or an error when no season and year can be read. The year-long options keep their own wording
 * (before Oct 12, 2026 they were stored as their first semester only, which lost the choice).
 */
function hostSemester_(value) {
  // Oct 13, 2026: new forms are Fall or Spring only (CFG.STUDY_ABROAD_SEASONS). Summer, Academic year and
  // Calendar year are refused here; parseSemester_ still reads them so older rows keep their semester tab.
  const term = parseSemester_(value);
  const season = term && /^([A-Za-z]+) \d{4}$/.exec(term.display);
  if (!season || CFG.STUDY_ABROAD_SEASONS.indexOf(season[1]) === -1) {
    throw new Error('Please pick the semester you will study abroad: ' + CFG.STUDY_ABROAD_SEASONS.join(' or ') + ' and a four-digit year.');
  }
  return term.display;
}

const SEMESTER_TAB_HEAD_ = ['Form', 'Version', 'Valid', 'Status', 'Student', 'Student ID', 'Student email',
  'College', 'Major', 'Host university', 'Country', 'Host semesters', 'Courses approved',
  'Courses', 'Submitted', 'Completed', 'Signed PDF'];

function semesterTabRow_(sub) {
  const courses = coursesFor_(sub.submission_id).filter(isLive_);
  const approved = courses.filter(c => c.status === CRS_STATUS.APPROVED).length;
  return [
    sub.submission_id, Number(sub.amendment_no) || 0, isSuperseded_(sub) ? 'Replaced by a newer version' : 'Current',
    sub.status, sub.student_name, sub.student_id, sub.student_email,
    sub.college, sub.major, sub.host_university, sub.host_country, sub.host_semesters,
    approved + ' of ' + courses.length,
    courses.map(c => c.host_course_code + ' ' + c.host_course_name + ' -> ' + (c.home_course_code || 'no Home University code yet') +
      ' [' + c.status + ']').join('\n'),
    sub.created_at ? fmt_(sub.created_at) : '', sub.completed_at ? fmt_(sub.completed_at) : '', sub.pdf_url || ''
  ];
}

/** Rebuilds the semester overview tabs at the bottom of the workbook. Never touches the master tabs. */
function refreshSemesterTabs(e) {
  requireAdminOrTrigger_(e);
  return withLock_(() => {
    const ss = ss_();
    const original = ss.getActiveSheet();
    const groups = {};
    readAll_(CFG.SHEETS.SUB).forEach(sub => {
      const sem = semesterOfForm_(sub);
      (groups[sem.label] = groups[sem.label] || { sem: sem, forms: [] }).forms.push(sub);
    });
    const ordered = Object.keys(groups).map(k => groups[k]).sort((a, b) => a.sem.key - b.sem.key);

    ordered.forEach(g => {
      const sh = ss.getSheetByName(g.sem.label) || ss.insertSheet(g.sem.label);
      g.forms.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const values = [SEMESTER_TAB_HEAD_].concat(g.forms.map(semesterTabRow_)).map(r => r.map(safeCell_));
      const width = SEMESTER_TAB_HEAD_.length;
      sh.clear();
      ensureRows_(sh, values.length + 1);
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      sh.getRange(1, 1, values.length, width).setValues(values);
      sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(CFG.BRAND_COLOR).setFontColor('#ffffff');
      sh.getRange(2, 1, Math.max(values.length - 1, 1), width).setVerticalAlignment('top');
      sh.getRange(2, 14, Math.max(values.length - 1, 1), 1).setWrap(true);
      sh.setColumnWidth(14, 380);
      sh.setFrozenRows(1);
      sh.setTabColor(CFG.BRAND_COLOR);
      if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
        sh.protect().setWarningOnly(true)
          .setDescription('Rebuilt automatically from Submissions, Courses and Log. Edit those tabs instead.');
      }
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(ss.getNumSheets());   // oldest first, so the newest ends up last
    });
    // Tabs of semesters that no longer have any form (for example after the data was cleared) are emptied.
    const tabName = new RegExp('^((' + CFG.SEMESTERS.map(s => s.name).join('|') + ') \\d{4}|Unsorted)$');
    ss.getSheets().forEach(sh => {
      if (groups[sh.getName()] || !tabName.test(sh.getName())) return;
      sh.clear();
      sh.getRange(1, 1, 1, SEMESTER_TAB_HEAD_.length).setValues([SEMESTER_TAB_HEAD_])
        .setFontWeight('bold').setBackground(CFG.BRAND_COLOR).setFontColor('#ffffff');
      sh.setFrozenRows(1);
    });
    ss.setActiveSheet(original);

    const msg = ordered.length ?
      'Semester tabs refreshed: ' + ordered.map(g => g.sem.label + ' (' + g.forms.length + ')').join(', ') :
      'No forms yet, so there are no semester tabs.';
    toast_(msg);
    return msg;
  });
}
