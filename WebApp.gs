/*******************************************************************
 * WebApp.gs - routing. Every page is served from here; the pages
 * then talk back through google.script.run.
 *******************************************************************/

/** ?page= value -> HTML file. Anything else opens the portal (with ref) or intake. */
const PAGES = {
  stepone: 'StepOne',
  review: 'Review',
  stage: 'Stage',
  sign: 'Sign',
  faculty: 'FacultyReview',
  portal: 'Portal',
  new: 'Intake'      // Oct 2026: the start page by name (the main link opens the staff portal for Exchange Office staff)
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  // ?page=whoami - shows which institution account Google reports for the visitor (sign-in check).
  if (p.page === 'whoami') {
    const me = currentUser_();
    // Everyone sees which account they are signed in as. Only Exchange Office staff also see the staff line and
    // which account the app runs as / sends from (Oct 2026): nothing about the setup for anyone else.
    const staff = isExoStaff_(me);
    return HtmlService.createHtmlOutput('<div style="font:16px Arial;padding:30px"><h2>Who am I?</h2><p>Signed in as: <b>' +
      esc_(me || '(Google did not report an account)') + '</b></p>' +
      (staff
        ? '<p>Exchange Office staff: <b>yes</b></p>' +
          // The account the web app runs as (the active deployment's "Execute as"): emails go out from its
          // Gmail (as exchange-office.include-here@example.edu when it has that alias) and every file the app saves is owned by it.
          '<p>App runs as: <b>' + esc_(appRunsAs_()) + '</b>' + (sendAsAlias_() ? ' (sending as ' + esc_(CFG.FROM_EMAIL) + ')' :
            ' (the ' + esc_(CFG.FROM_EMAIL) + ' send-as alias is NOT set up on this account)') + '</p>'
        : '') +
      '</div>')
      .setTitle('Who am I - ' + CFG.APP_NAME);
  }
  // ?page=faq&role=student|hod|faculty|stage|exo - preview of one role's Help & FAQ (no form data).
  if (p.page === 'faq') return faqPreview_(p);
  if (p.page === 'hodcheck') return hodCheckPage_(p);
  // Exchange Office staff portal (Oct 2026): ?page=staff, or the main link (no page, no ref) for Exchange Office staff.
  // Everyone else keeps the intake page on the main link and is refused at ?page=staff.
  if (p.page === 'staff' || (!p.page && !p.ref)) {
    if (staffPortalAllowed_(currentUser_())) return staffPortalPage_();
    if (p.page === 'staff') return staffRefusedPage_();
  }
  const file = PAGES[p.page] || (p.ref ? PAGES.portal : 'Intake');
  const tpl = HtmlService.createTemplateFromFile(file);
  tpl.P = pageData_(p);
  tpl.P.page = file; // lets Help.html pick the right FAQ for this page
  if (file === 'Intake') {
    // Official university names, offered as suggestions so students pick the same spelling.
    try { tpl.P.universities = universityNames_(); } catch (err) { tpl.P.universities = []; }
  }
  return tpl.evaluate().
    setTitle(CFG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * What the pages read client-side (as P). URL values are echoed back as data,
 * never trusted: every server call re-checks the token.
 */
function pageData_(p) {
  return {
    sid: p.ref || '', t: p.t || '', c: p.crs || '', st: p.st || '', hod: p.hod || '', fac: p.fac || '',
    exo: CFG.EXO_EMAIL,
    me: currentUser_(),
    reminderDays: CFG.REMINDER_AFTER_DAYS,
    minCredits: CFG.MIN_EARNED_CREDITS,
    minGpa: CFG.MIN_GPA,
    gradeDefault: CFG.GRADE_DEFAULT,
    gradeRemark: CFG.GRADE_REMARK,
    gradeRejectNote: CFG.GRADE_REJECT_NOTE,
    maxUploadMb: CFG.MAX_UPLOAD_MB,
    semesterNames: CFG.STUDY_ABROAD_SEASONS,   // Oct 13, 2026: Fall and Spring only
    captureIp: !!(CFG.CAPTURE_IP && CFG.IP_LOOKUP_URL),
    ipLookupUrl: CFG.IP_LOOKUP_URL,
    colleges: CFG.COLLEGES,
    classes: CFG.CLASSES,
    conditions: CFG.CONDITIONS,
    ST: STATUS,
    CS: CRS_STATUS,
    editable: EDITABLE_STATUSES,
    closed: CLOSED_STATUSES,
    gerType: CFG.GER_COURSE_TYPE,
    otherType: CFG.OTHER_COURSE_TYPE,
    subjectPrefix: CFG.SUBJECT_PREFIX,
    facultyDomain: CFG.FACULTY_EMAIL_DOMAIN,
    afterSignature: afterSignatureText_()
  };
}

/** Static include (no scriptlets), e.g. Styles. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * The shared client script plus the page's P object. '<' is escaped so a
 * crafted URL parameter cannot close the <script> tag (reflected XSS).
 */
function clientScript_(P) {
  return '<script>var P = ' + JSON.stringify(P).replace(/</g, '\\u003c') + ';</script>' +
    include('Script') + include('Help');
}

/** Roles for the FAQ preview: role -> [page whose FAQ it shows, label]. */
const FAQ_ROLES_ = {
  student: ['Portal', 'Students'],
  hod: ['Review', 'Heads of department'],
  faculty: ['FacultyReview', 'Faculty reviewers'],
  stage: ['Stage', 'Step III approvers'],
  exo: ['StepOne', 'Exchange Office']
};

/** A page with only the Help & FAQ drawer, so anyone can see what each role sees. */
function faqPreview_(p) {
  const role = FAQ_ROLES_[p.role] ? p.role : 'student';
  const P = pageData_({ st: String(p.st || '') });
  P.page = FAQ_ROLES_[role][0];
  const url = ScriptApp.getService().getUrl();
  const tabs = Object.keys(FAQ_ROLES_).map(k =>
    '<a href="' + url + '?page=faq&role=' + k + '" style="display:inline-block;margin:4px 6px 4px 0;padding:7px 12px;' +
    'border-radius:999px;text-decoration:none;font-weight:600;' +
    (k === role ? 'background:var(--navy);color:#fff' : 'background:#eee;color:#222') + '">' +
    esc_(FAQ_ROLES_[k][1]) + '</a>').join('');
  const html = '<!DOCTYPE html><html><head><base target="_top">' + include('Styles') + '</head><body>' +
    '<div style="max-width:760px;margin:0 auto;padding:28px 18px;font-family:inherit">' +
    '<h2 style="margin:0 0 6px">Help &amp; FAQ preview</h2>' +
    '<p style="margin:0 0 12px;color:#555">This is what each person sees when they press <b>Help &amp; FAQ</b> on their page.</p>' +
    '<div>' + tabs + '</div></div>' +
    clientScript_(P) +
    '<script>setTimeout(function () { var b = document.querySelector(".hx-fab"); if (b) b.click(); }, 300);</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).
    setTitle('FAQ preview - ' + CFG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * "Your forms" on the start page (Oct 2026): the forms of the signed-in institution account, so a student
 * who lost their link can open the main link and carry on. Security:
 * - It lists ONLY forms whose student_email is exactly the account Google reports as signed in
 *   (createSubmission stores that same signed-in account as student_email). Nothing typed in the
 *   browser (ID, name, email) is used, so nobody can ask for someone else's forms.
 * - Without a Google-reported account the list is empty. Exchange Office staff and the test accounts get only
 *   their own forms here too (no staff or test exceptions).
 * - It returns only what the student already sees on their own form: reference, university,
 *   semester, status, start date and the form link. Every link checks the account again when
 *   it is opened (getSubmission_ / requireAccess_).
 */
function getMyForms() {
  const me = currentUser_();
  if (!me) return [];
  const time = d => (d ? new Date(d).getTime() : 0) || 0;
  return plain_(readAll_(CFG.SHEETS.SUB)
    .filter(s => str_(s.submission_id) && str_(s.student_email).toLowerCase() === me)
    .sort((a, b) => time(b.created_at) - time(a.created_at))
    .map(s => ({
      ref: str_(s.submission_id),
      university: str_(s.host_university),
      semester: str_(s.host_semesters),
      status: str_(s.status),
      started: fmt_(s.created_at),
      amendment: Number(s.amendment_no) || 0,
      url: studentUrl_(s)
    })));
}

/** The account the web app executes as (whoever made the active deployment with Execute as: Me). */
function appRunsAs_() {
  try { return str_(Session.getEffectiveUser().getEmail()).toLowerCase() || '(not reported)'; } catch (e) { return '(not reported)'; }
}

/* ================================================================ Exchange Office STAFF PORTAL (Oct 2026)
 * The main CPF link opens the staff portal for Exchange Office staff: every form, with search and filters,
 * and a link to open each one (the same page the student sees, in view mode).
 *
 * Security, in one place:
 * - The ONLY way in is the Google-reported account being on CFG.EXO_STAFF (or CFG.EXO_EMAIL).
 *   No link token, no test superuser, no SELF_TEST_ switch, nothing typed in the browser.
 * - doGet checks it before the page is built, and getStaffForms() checks it AGAIN on every call,
 *   because google.script.run lets any visitor call a public function directly.
 * - The page itself holds no form data; the list only arrives from getStaffForms().
 * - Opening a form from the list goes through getSubmission_ / requireAccess_ as always, so staff
 *   can view and press "Send reminder now", but can only act on the Exchange Office steps.
 * ================================================================ */

/** True only for an account on the Exchange Office staff list. The one rule for the staff portal. */
function staffPortalAllowed_(email) {
  const me = str_(email).toLowerCase();
  return !!me && isExoStaff_(me);
}

/** Throws unless the signed-in account is Exchange Office staff. Returns that account. */
function requireStaffPortal_() {
  const me = currentUser_();
  if (!staffPortalAllowed_(me)) {
    console.warn('Staff portal refused for ' + (me || '(no account reported)'));
    throw new Error('The staff portal is for Exchange Office staff only.');
  }
  return me;
}

/** The staff portal page (doGet calls this only after staffPortalAllowed_ said yes). */
function staffPortalPage_() {
  const tpl = HtmlService.createTemplateFromFile('Staff');
  tpl.P = pageData_({});            // settings only: no form data is put into the page
  tpl.P.page = 'Staff';             // Help & FAQ shows the Exchange Office questions
  tpl.P.newFormUrl = link_({ page: 'new' });
  return tpl.evaluate()
    .setTitle('Exchange Office Staff portal - ' + CFG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** What anyone else sees at ?page=staff. Says nothing about who is on the list. */
function staffRefusedPage_() {
  const me = currentUser_();
  return HtmlService.createHtmlOutput(
    '<div style="font:16px Arial;max-width:560px;margin:40px auto;padding:0 18px">' +
    '<h2>Exchange Office staff only</h2>' +
    '<p>This page is for the International Exchange Office team.' +
    (me ? ' You are signed in as <b>' + esc_(me) + '</b>.' : '') + '</p>' +
    '<p>Students: <a href="' + esc_(webAppUrl_()) + '" target="_top">open the CPF start page</a>. ' +
    'Questions: ' + esc_(CFG.EXO_EMAIL) + '</p></div>')
    .setTitle(CFG.APP_NAME);
}

/** "Fall 2027" -> { season: 'Fall', year: '2027' }. Longer wordings keep their first words. */
function staffTerm_(term) {
  const s = str_(term);
  const year = (s.match(/\b(20\d{2})\b/) || [])[1] || '';
  const m = s.match(/^(fall|spring|summer|academic year|calendar year)/i);
  const season = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : s.replace(/\s*\d.*$/, '');
  return { season: season, year: year };
}

/**
 * Every form, for the staff portal list. Exchange Office staff only, checked on every call.
 * Withdrawn and superseded courses are not counted.
 */
function getStaffForms() {
  const me = requireStaffPortal_();
  const time = d => (d ? new Date(d).getTime() : 0) || 0;
  const counts = {};
  readAll_(CFG.SHEETS.CRS).forEach(c => {
    const id = str_(c.submission_id);
    const st = str_(c.status);
    if (!id || st === CRS_STATUS.WITHDRAWN || st === CRS_STATUS.SUPERSEDED) return;
    const k = counts[id] || (counts[id] = { total: 0, approved: 0, denied: 0, pending: 0, draft: 0 });
    k.total++;
    if (st === CRS_STATUS.APPROVED) k.approved++;
    else if (st === CRS_STATUS.DENIED) k.denied++;
    else if (st === CRS_STATUS.DRAFT) k.draft++;
    else k.pending++;
  });
  const stageLabel = {};
  STAGES.forEach(s => { stageLabel[s.key] = s.label + ' (Step ' + s.step + ')'; });
  const forms = readAll_(CFG.SHEETS.SUB)
    .filter(s => str_(s.submission_id))
    .map(s => {
      const id = str_(s.submission_id);
      const status = str_(s.status);
      const term = staffTerm_(s.host_semesters);
      const open = CLOSED_STATUSES.indexOf(status) === -1;
      return {
        ref: id,
        name: str_(s.student_name),
        studentId: str_(s.student_id),
        email: str_(s.student_email).toLowerCase(),
        college: str_(s.college),
        major: str_(s.major),
        university: str_(s.host_university),
        country: str_(s.host_country),
        semester: str_(s.host_semesters),
        season: term.season,
        year: term.year,
        status: status,
        waitingOn: open && status === STATUS.GATED ? (stageLabel[str_(s.current_stage)] || '') : '',
        amendment: Number(s.amendment_no) || 0,
        started: fmt_(s.created_at),
        updated: fmt_(s.updated_at),
        startedMs: time(s.created_at),
        updatedMs: time(s.updated_at) || time(s.created_at),
        courses: counts[id] || { total: 0, approved: 0, denied: 0, pending: 0, draft: 0 },
        url: studentUrl_(s),
        stepOneUrl: status === STATUS.STEP1 ? stepOneUrl_(s) : ''
      };
    })
    .sort((a, b) => b.updatedMs - a.updatedMs);
  return plain_({ me: me, statuses: Object.keys(STATUS).map(k => STATUS[k]), forms: forms });
}
