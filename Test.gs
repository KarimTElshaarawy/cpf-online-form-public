/*******************************************************************
 * Test.gs - end-to-end self test, go-live check, link printers and
 * data clean-up. These are Exchange Office maintenance tools: each one only runs
 * from the Apps Script editor or the CPF menu (requireAdmin_), never
 * from the web app. The self test refuses to run unless
 * CFG.TEST_REDIRECT holds an address, so no real approver is emailed.
 *******************************************************************/

const TEST_STUDENT_ID = 'b00000000';

/** Stops the self test with a clear message when something is wrong. */
function check_(ok, what) {
  if (!ok) throw new Error('Self test failed: ' + what);
}

/** Runs fn and expects it to be refused with an error containing 'text'. */
function expectError_(fn, text, what) {
  try {
    fn();
  } catch (e) {
    if (String(e.message).indexOf(text) > -1) return;
    throw new Error('Self test failed: ' + what + ' was refused for the wrong reason: ' + e.message);
  }
  throw new Error('Self test failed: ' + what + ' should have been refused.');
}

/** A fresh read of one form (the cache is dropped so this is what the sheet really holds). */
function reread_(sid) {
  DB_ = {};
  return findRow_(CFG.SHEETS.SUB, 'submission_id', sid);
}

/** Stand-in for the PDFs a student would attach. */
function fakeSyllabi_(sid) {
  coursesFor_(sid).filter(c => c.status === CRS_STATUS.DRAFT && !c.host_syllabus_url).
    forEach(c => update_(CFG.SHEETS.CRS, c, { host_syllabus_url: 'https://example.com/host-syllabus.pdf' }));
}

/** Approves everything waiting on one head of department, with one signature. */
function approveAll_(sid, hodEmail, answers) {
  const q = { ref: sid, hod: hodEmail.toLowerCase() };
  const items = getReview(q).pending.map(c => Object.assign({
    course_row_id: c.course_row_id, decision: 'APPROVE',
    course_type: CFG.COURSE_TYPES[0], ger_area: '', grade_required: 'C', prereqs_met: 'Yes',
    comments: 'Self test.'
  }, answers[c.host_course_code] || { home_course_code: 'TST 100', home_course_name: 'Test course', home_credits: '3' }));
  if (items.length) decideCourses(q, items, 'Test Head of Department');
  return items.length;
}

/** A tiny valid PNG (1 x 1 pixel), standing in for a drawn signature. */
const TEST_PNG_ = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Run from the editor after runSelfTest (test mode only). Clears the test student's forms first. */
function runSelfTestExtras() {
  requireAdmin_();
  if (!CFG.TEST_REDIRECT) {
    throw new Error('Refusing to run: CFG.TEST_REDIRECT is empty, so real approvers would be emailed.');
  }
  SELF_TEST_ = true;
  deleteTestData();
  const depts = getDepartments();
  const deptA = depts[0];
  const deptB = deptA && depts.find(d => d.hod_email.toLowerCase() !== deptA.hod_email.toLowerCase());
  check_(deptA && deptB, 'the Departments tab needs at least two heads of department (run setUp)');
  const steps = [];
  runSelfTestExtras_(steps, deptA, deptB, testIntake_());
  steps.push('');
  steps.push('ALL EXTRA CHECKS PASSED. Run deleteTestData to remove the test forms.');
  const out = steps.join('\n');
  console.log(out);
  return out;
}

/**
 * The second half of the self test (runSelfTestExtras): every path the main walk-through does not take. Uses four more
 * test forms (other universities and semesters, same test student) and checks each refusal by its
 * message, so a check that silently stops working is caught:
 *   intake rules, uploads, the held HoD email on "Save and send", editing / withdrawing / resending
 *   courses, HoD and faculty input checks, the catalog, sponsor-only funding, Step III order and
 *   input checks, declines at Step I and Step III, cancelled forms, signature cleanup of a declined
 *   form, the study abroad term, and the semester tabs.
 */
function runSelfTestExtras_(steps, deptA, deptB, base) {
  const form = (uni, sem, extra) => createSubmission(Object.assign({}, base,
    { host_university: uni, host_semesters: sem }, extra || {})).submission_id;
  const pdf = text => ({ name: 'syllabus.pdf', mimeType: 'application/pdf', data: Utilities.base64Encode(text) });
  const okPdf = pdf('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF');
  const stepOneOk = sid => submitStepOne(sid, '', { s1_accredited: 'Yes', s1_agreement: CFG.AGREEMENT_TYPES[0],
    s1_major_accreditation: [CFG.MAJOR_ACCREDITATIONS[0]], s1_comments: 'Self test.', decision: 'APPROVE',
    signature: 'Test Exchange Office Officer' });
  const course = (code, dept, hod, extra) => Object.assign({ alt_course_code: 'None', alt_course_name: 'None', host_course_code: code, host_course_name: 'Test ' + code,
    host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: dept.key, hod_email: hod }, extra || {});
  const row = (sid, code) => { DB_ = {}; return coursesFor_(sid).filter(c => courseKey_(c.host_course_code) === courseKey_(code) && isLive_(c))[0]; };
  steps.push('');
  steps.push('EXTRA CHECKS:');

  // ---- A. Intake rules
  const u = { host_university: 'eu1', host_semesters: 'Spring 2028' };
  expectError_(() => createSubmission(Object.assign({}, base, u, { advisor_email: 'b00000001@' + CFG.FACULTY_EMAIL_DOMAIN })),
    'academic advisor', 'a student account as the advisor');
  expectError_(() => createSubmission(Object.assign({}, base, u, { advisor_email: 'exchange-office-signer.include-here@example.edu' })),
    'academic advisor', 'a blocked advisor address (exchange-office-signer.include-here@example.edu)');
  expectError_(() => createSubmission(Object.assign({}, base, u, { advisor_email: 'someone@example.com' })),
    'academic advisor', 'an advisor outside the university');
  expectError_(() => createSubmission(Object.assign({}, base, u, { student_mobile: '' })), 'student mobile', 'a blank mobile number');
  expectError_(() => createSubmission(Object.assign({}, base, u, { host_semesters: 'Winter 2028' })), 'pick the semester',
    'a semester that is not offered');
  steps.push('intake: student-account advisor, outside advisor, blank mobile, Winter -> refused');

  // ---- B. Sponsored (no scholarship) form, every Step II input rule
  const b = form('eu1', 'Spring 2028', { has_scholarship: 'No', has_sponsor: 'Yes' });
  expectError_(() => signSubmission(b, '', 'Test Student'), 'not ready', 'signing before Step III');
  expectError_(() => submitStepOne(b, '', { s1_accredited: 'Yes', s1_agreement: CFG.AGREEMENT_TYPES[0],
    s1_major_accreditation: [CFG.MAJOR_ACCREDITATIONS[0]], s1_comments: '', decision: 'DENY', signature: 'Test Exchange Office Officer' }),
    'explain', 'declining Step I without a reason');
  expectError_(() => submitStepOne(b, '', { s1_accredited: 'Yes', s1_agreement: CFG.AGREEMENT_TYPES[0],
    s1_major_accreditation: [CFG.NO_MAJOR_ACCREDITATION, CFG.MAJOR_ACCREDITATIONS[0]], decision: 'APPROVE', signature: 'Test Exchange Office Officer' }),
    'cannot be ticked together', 'N/A ticked together with an accreditation');
  expectError_(() => saveCourse(b, '', course('UPL-100', deptA, deptA.hod_email), true), 'not completed Step I',
    'sending a course before Step I');
  stepOneOk(b);
  expectError_(() => saveCourse(b, '', course('UPL-100', deptA, deptA.hod_email, { host_syllabus: pdf('hello, not a pdf') })),
    'not a valid PDF', 'a syllabus that is not a PDF');
  check_(!row(b, 'UPL-100'), 'a refused upload saves nothing');
  // Oct 2026: two host courses for one Home University course need one title per code and a syllabus each.
  expectError_(() => saveCourse(b, '', course('TWO-100, TWO-200', deptA, deptA.hod_email, { host_course_name: 'Only one title', host_syllabus: okPdf })),
    'one course title for each', 'two host course codes with only one title');
  expectError_(() => saveCourse(b, '', course('TWO-100, TWO-200', deptA, deptA.hod_email,
    { host_course_name: 'Part one, Part two', host_syllabus: okPdf }), true),
    'one for each host course', 'two host courses sent with only one syllabus');
  expectError_(() => saveCourse(b, '', course('ALT-100', deptA, deptA.hod_email, { alt_course_code: '' })),
    'equivalent Home University course code', 'a course without a suggested equivalent Home University course');
  saveCourse(b, '', course('MCH-200', deptA, deptA.hod_email, { host_syllabus: okPdf }), true);
  let mch = row(b, 'MCH-200');
  check_(mch.hod_email_check === 'MATCH' && mch.status === CRS_STATUS.PENDING && /drive\.google\.com/.test(mch.host_syllabus_url),
    'matching HoD email: real PDF uploaded, saved and sent');
  const held = saveCourse(b, '', course('HLD-300', deptA, CFG.TEST_REDIRECT, { host_syllabus: okPdf }), true);
  const hld = row(b, 'HLD-300');
  check_(held.held === true && hld.status === CRS_STATUS.DRAFT && hld.hod_email_check === 'MISMATCH',
    '"Save and send" with a different HoD email saves, holds and does not send');
  expectError_(() => sendCourse(b, '', hld.course_row_id), 'Exchange Office is checking', 'sending a held course');
  withdrawCourse(b, '', hld.course_row_id);
  check_(!row(b, 'HLD-300'), 'held draft withdrawn');
  saveCourse(b, '', course('MCH-200', deptA, deptA.hod_email, { course_row_id: mch.course_row_id, host_course_name: 'Edited title' }));
  mch = row(b, 'MCH-200');
  check_(mch.status === CRS_STATUS.DRAFT && mch.host_course_name === 'Edited title', 'editing a pending course takes it back to draft');
  expectError_(() => resendCourse(b, '', mch.course_row_id), 'Only courses waiting', 'a reminder for a draft');
  sendCourse(b, '', mch.course_row_id);
  resendCourse(b, '', mch.course_row_id);
  expectError_(() => resendCourse(b, '', mch.course_row_id), 'just went out', 'a second reminder within a minute');
  expectError_(() => resendStepOne(b, ''), 'already complete', 'a Step I reminder after Step I');
  steps.push('Step I input checks; non-PDF refused; real PDF uploaded; held HoD email not sent; edit / withdraw / resend rules: OK');

  const q = { ref: b, hod: deptA.hod_email.toLowerCase() };
  const one = extra => [Object.assign({ course_row_id: mch.course_row_id, prereqs_met: 'Yes', comments: '' }, extra)];
  expectError_(() => decideCourses(q, one({ decision: 'DENY' }), 'Test Head of Department'), 'reason for declining',
    'a decline without a reason');
  expectError_(() => decideCourses(q, one({ decision: 'APPROVE', course_type: CFG.COURSE_TYPES[0] }), 'Test Head of Department'),
    'Home University course code', 'an approval without the Home University course');
  expectError_(() => decideCourses(q, one({ decision: 'APPROVE', home_course_code: 'GER 101', home_course_name: 'Test',
    home_credits: '3', course_type: CFG.GER_COURSE_TYPE, ger_area: '' }), 'Test Head of Department'), 'GER program area',
    'a GER approval without the area');
  expectError_(() => decideCourses(q, one({ decision: 'FORWARD', faculty_email: 'prof@example.com' }), 'Test Head of Department'),
    'faculty member', 'forwarding outside the university');
  expectError_(() => decideCourses(q, one({ decision: 'APPROVE' }), 'ab'), 'full name', 'a signature that is too short');
  decideCourses(q, one({ decision: 'APPROVE', home_course_code: 'GER 101', home_course_name: 'Test GER course', home_credits: '3',
    course_type: CFG.GER_COURSE_TYPE, ger_area: CFG.GER_AREAS[0], grade_required: 'C' }), 'Test Head of Department');
  check_(row(b, 'MCH-200').status === CRS_STATUS.APPROVED && row(b, 'MCH-200').ger_area === CFG.GER_AREAS[0], 'GER approval stored with its area');
  const subB = reread_(b);
  const cat = catalog_().getSheets().find(sh => sh.getName().toLowerCase() === tabName_(subB.host_university).toLowerCase());
  const catRows = cat ? cat.getDataRange().getValues() : [];
  const refCol = CATALOG_HEADERS.indexOf('CPF reference'), idCol = CATALOG_HEADERS.indexOf('Student ID');
  check_(catRows.some(r => String(r[refCol]) === b && String(r[idCol]) === TEST_STUDENT_ID),
    'the approval is in the approved-course catalog with the student ID');
  steps.push('HoD checks (decline reason, Home University course, GER area, faculty domain, short signature); GER approval; catalog row: OK');

  confirmGate(b, '');
  resendStage(b, '');
  expectError_(() => resendStage(b, ''), 'just went out', 'a second Step III reminder within a minute');
  expectError_(() => decideStage(b, 'ADV', '', 'DENY', '', 'Test Approver'), 'reason for declining', 'a Step III decline without a reason');
  expectError_(() => decideStage(b, 'DEAN', '', 'APPROVE', 'ok', 'Test Approver'), 'not the one currently', 'signing out of order');
  decideStage(b, 'ADV', '', 'APPROVE', 'ok', 'Test Approver');
  decideStage(b, 'DEAN', '', 'APPROVE', 'ok', 'Test Approver');
  let sb = reread_(b);
  check_(sb.FIN_status === 'N/A' && sb.current_stage === 'SPON', 'no scholarship: Financial Grants N/A, Sponsorship signs (got ' +
    sb.FIN_status + ', ' + sb.current_stage + ')');
  decideStage(b, 'SPON', '', 'APPROVE', 'ok', 'Test Approver');
  if (!str_(reread_(b).s1_program_type)) {
    expectError_(() => decideStage(b, 'EXO', '', 'APPROVE', 'ok', 'Test Approver', {}), 'Exchange Office use only', 'EXO approval without the program type');
  }
  sb = walkChain_(b, []);
  check_(sb.status === STATUS.COMPLETED && sb.SPON_status === 'APPROVED' && sb.FIN_status === 'N/A' && sb.pdf_url && sb.pdf_sent_at,
    'sponsored form completed with a PDF');
  steps.push('Step III: reminder cooldown, decline reason, order enforced, sponsor-only funding, Exchange Office program type: OK');

  // ---- C. Step I declined (drawn signature) -> closed; its image goes with the daily cleanup
  const c = form('Leiden', 'Spring 2029');
  submitStepOne(c, '', { s1_accredited: 'No', s1_agreement: CFG.AGREEMENT_TYPES[0], s1_major_accreditation: [CFG.MAJOR_NOT_ACCREDITED],
    s1_comments: 'Self test: not accredited.', decision: 'DENY',
    signature: { method: 'drawn', name: 'Test Exchange Office Officer', image: TEST_PNG_ } });
  let sc = reread_(c);
  check_(sc.status === STATUS.DENIED && str_(sc.s1_sig_file), 'Step I declined, drawn image kept until cleanup');
  expectError_(() => saveCourse(c, '', course('XYZ-100', deptA, deptA.hod_email)), 'closed', 'adding a course to a declined form');
  expectError_(() => resendStepOne(c, ''), 'closed', 'a reminder on a declined form');
  expectError_(() => restartAfterDecline(c, '', { has_scholarship: 'No', has_sponsor: 'No' }), 'Step III or IV',
    'restarting a form declined at Step I');
  cleanupSignatureImages();
  sc = reread_(c);
  check_(!str_(sc.s1_sig_file) && /image deleted/.test(str_(sc.s1_sig_method)), 'cleanup deleted the declined form\'s drawn image');
  steps.push('Step I decline: form closed, edits and reminders refused, drawn image deleted by the cleanup: OK');

  // ---- D. Declined in Step III -> closed for good
  const d = form('McMaster', 'Fall 2028');
  stepOneOk(d);
  saveCourse(d, '', course('DEC-100', deptB, deptB.hod_email, { host_syllabus: okPdf }), true);
  approveAll_(d, deptB.hod_email, {});
  confirmGate(d, '');
  decideStage(d, 'ADV', '', 'DENY', 'Self test: not approved.', 'Test Approver');
  const sd = reread_(d);
  check_(sd.status === STATUS.DENIED && sd.ADV_status === 'DENIED', 'advisor decline ends the form');
  expectError_(() => reopenCourses(d, ''), 'closed', '"Change my courses" on a declined form');
  expectError_(() => amendForm(d, ''), 'Only a completed form', 'amending a declined form');
  check_(getPortal(d, '').restart.ok === true, 'the portal offers a restart after a Step III decline');
  // The student corrects a funding answer (scholarship Yes -> No) and restarts Steps III and IV.
  restartAfterDecline(d, '', { has_scholarship: 'No', has_sponsor: 'No', changeCourses: false });
  let sd2 = reread_(d);
  check_(sd2.status === STATUS.GATED && sd2.current_stage === STAGES[0].key && !sd2.ADV_status && sd2.has_scholarship === 'No',
    'restart after decline: answers corrected, Step III starts again at the advisor');
  sd2 = walkChain_(d, []);
  check_(sd2.status === STATUS.COMPLETED && sd2.FIN_status === 'N/A' && sd2.SPON_status === 'N/A' && sd2.pdf_url,
    'restarted form completed with the corrected answers (Financial Grants and Sponsorship N/A)');
  steps.push('Step III decline: reopen and amend refused; funding answers corrected, Steps III and IV restarted and completed: OK');

  // ---- E. Fall / Spring only (Oct 13, 2026), cancelled form, semester tabs
  expectError_(() => form('UAB', 'Academic year 2028/2029'), 'Fall or Spring', 'an academic year term on a new form');
  expectError_(() => form('UAB', 'Summer 2028'), 'Fall or Spring', 'a summer term on a new form');
  const e = form('UAB', 'Fall 2028');
  const se = reread_(e);
  check_(se.host_semesters === 'Fall 2028', 'fall term stored as picked (got "' + se.host_semesters + '")');
  update_(CFG.SHEETS.SUB, se, { status: STATUS.CANCELLED });
  expectError_(() => resendStepOne(e, ''), 'closed', 'a reminder on a cancelled form');
  refreshSemesterTabs();
  const tab = ss_().getSheetByName('Fall 2028');
  check_(tab && tab.getRange(1, 1, tab.getLastRow(), 1).getValues().some(r => String(r[0]) === e),
    'fall form listed on the Fall 2028 semester tab');
  steps.push('only Fall / Spring accepted; cancelled form refuses reminders; semester tabs rebuilt: OK');
}

/** Approves every Step III / IV step, and signs as the student (drawn), until the form is closed. */
function walkChain_(sid, steps) {
  let sub = reread_(sid);
  for (let guard = 0; guard < 20 && CLOSED_STATUSES.indexOf(sub.status) === -1; guard++) {
    if (sub.current_stage === 'SIGN') {
      signSubmission(sid, '', { method: 'drawn', name: 'Test Student', image: TEST_PNG_ });
      steps.push('   student signed (drawn)');
    } else if (sub.current_stage) {
      const st = sub.current_stage;
      decideStage(sid, st, '', 'APPROVE', 'Approved (self test).', 'Test Approver',
        { programType: 'Undergraduate - semester exchange (self test)', registrarEmail: 'registrar.selftest@example.edu' });
      steps.push('   ' + st + ' approved');
    } else {
      break;
    }
    sub = reread_(sid);
  }
  return sub;
}

/** The test student's intake answers, shared by runSelfTest and runSelfTestExtras. */
function testIntake_() {
  return {
    student_name: 'TEST STUDENT', student_id: ' B00000000 ', student_email: CFG.TEST_REDIRECT,
    student_mobile: '+00 000 000 0000',
    college: 'cola', major: 'Computer Engineering', concentration: 'None',
    student_class: 'Junior', current_semester: 'spring 2027',
    credits_completed: '60', gpa: '3.2', expected_graduation: 'Spring 2028',
    host_university: 'eu1', host_country: 'Country A', host_semesters: 'Fall 2027',
    host_contact_name: 'Exchange Office', host_contact_email: 'exchange@example.edu',
    // Never emailed: the self test only runs in test mode, where every email goes to TEST_REDIRECT.
    advisor_name: 'Test Advisor', advisor_email: 'cpf.selftest.advisor@' + CFG.FACULTY_EMAIL_DOMAIN,
    has_scholarship: 'Yes', has_sponsor: 'No',
    conditions_agreed: true   // ignored since Oct 14, 2026: the student agrees by signing
  };
}

/**
 * Walks a fake form through everything a real one can do, checking each
 * result: intake (university alias, text kept exactly as typed, duplicate
 * trip refused), Step I, courses (duplicate course refused), send all,
 * faculty review, head of department approvals, Step III, "Change my
 * courses" in the middle of Step III, completion, then an amendment
 * (carried courses, remove / put back, new course, Step III again).
 * About 3 minutes. Then run runSelfTestExtras for every other path
 * (declines, refusals, held HoD emails, uploads, reminders, cleanup,
 * catalog, semester tabs); they are two runs because together they come
 * close to the 6-minute Apps Script limit. Clean up with deleteTestData.
 */
function runSelfTest() {
  requireAdmin_();
  if (!CFG.TEST_REDIRECT) {
    throw new Error('Refusing to run: CFG.TEST_REDIRECT is empty, so real approvers would be emailed.');
  }
  SELF_TEST_ = true; // play every role from the editor without the sign-in check
  // A failed earlier run leaves its test form open, which blocks a new one; clear only the test student's data first.
  deleteTestData();
  const steps = [];

  const depts = getDepartments();
  const deptA = depts[0];
  const deptB = deptA && depts.find(d => d.hod_email.toLowerCase() !== deptA.hod_email.toLowerCase());
  check_(deptA && deptB, 'the Departments tab needs at least two heads of department (run setUp)');
  const answers = {
    'ELN-301': { home_course_code: 'ELE 340', home_course_name: 'Electronics II', home_credits: '3' },
    'ELN-302': { home_course_code: 'ELE 341', home_course_name: 'Analog Electronics', home_credits: '3' },
    // grade required is mandatory on an approval since Oct 15, 2026
    'MAT-210': { home_course_code: 'MTH 221', home_course_name: 'Linear Algebra', home_credits: '3', grade_required: 'C' }
  };

  // ---- 0. Rules that need no form: Financial Grants / Sponsorship for all four intake answers
  [['Yes', 'Yes'], ['Yes', 'No'], ['No', 'Yes'], ['No', 'No']].forEach(pair => {
    const f = { has_scholarship: pair[0], has_sponsor: pair[1] };
    check_(stageApplies_(f, stageByKey_('FIN')) === (pair[0] === 'Yes') &&
      stageApplies_(f, stageByKey_('SPON')) === (pair[1] === 'Yes'),
      'Financial Grants / Sponsorship apply for scholarship ' + pair[0] + ', sponsored ' + pair[1]);
  });
  // Drawn signatures: only a real PNG is accepted
  expectError_(() => signatureInput_({ method: 'drawn', name: 'Test Person', image: 'data:image/png;base64,SGVsbG8gd29ybGQ=' }),
    'could not be read', 'a drawn signature that is not a PNG');
  expectError_(() => signatureInput_({ method: 'drawn', name: 'Test Person', image: 'data:image/jpeg;base64,' + TEST_PNG_.split(',')[1] }),
    'could not be read', 'a drawn signature that is not a PNG data URL');
  check_(signatureInput_({ method: 'drawn', name: 'Test Person', image: TEST_PNG_ }).method === 'drawn', 'a valid drawn PNG is accepted');
  // Oct 15, 2026: each method requires only its own input. Draw / Upload need the picture, not the name.
  check_(signatureInput_({ method: 'drawn', name: '', image: TEST_PNG_ }).name === 'Drawn signature', 'a drawing without a typed name is accepted');
  check_(signatureInput_({ method: 'uploaded', name: '', image: TEST_PNG_ }).name === 'Uploaded signature', 'an upload without a typed name is accepted');
  expectError_(() => signatureInput_({ method: 'drawn', name: 'Test Person', image: '' }), 'could not be read', 'Draw chosen with nothing drawn');
  expectError_(() => signatureInput_({ method: 'uploaded', name: 'Test Person', image: '' }), 'could not be read', 'Upload chosen with no picture');
  check_(signatureInput_({ method: 'uploaded', name: 'Test Person', image: TEST_PNG_ }).method === 'uploaded', 'an uploaded signature is accepted');
  expectError_(() => signatureInput_({ method: 'typed', name: '' }), 'full name', 'a typed signature without a name');
  // Oct 2026: the Log tab explains every line in plain English, emails included.
  const sentence = logSentence_('', 'system', 'EMAIL_SENT', { to: 'a@example.edu', cc: 'exchange-office.include-here@example.edu', subject: 'Test', files: ['CPF.pdf'], test: '' });
  check_(sentence.indexOf('Email sent to a@example.edu, with a copy to exchange-office.include-here@example.edu') === 0 && sentence.indexOf('Attached: CPF.pdf') > -1,
    'the Log explains an email in plain English (got: ' + sentence + ')');
  // Oct 2026: "Your forms" on the start page lists only the signed-in account's own forms.
  const meNow = currentUser_();
  const myForms = getMyForms();
  check_(myForms.every(f => str_((findRow_(CFG.SHEETS.SUB, 'submission_id', f.ref) || {}).student_email).toLowerCase() === meNow),
    'Your forms lists only forms of the signed-in account');
  check_(readAll_(CFG.SHEETS.SUB).filter(s => str_(s.student_email).toLowerCase() !== meNow)
    .every(s => myForms.every(f => f.ref !== str_(s.submission_id))), 'Your forms never shows another student\'s form');
  check_(myForms.every(f => Object.keys(f).sort().join() === 'amendment,ref,semester,started,status,university,url'),
    'Your forms returns only the reference, university, semester, status, date and link');
  // Oct 2026: the Exchange Office staff portal opens only for accounts on EXO_STAFF (no token, test or SELF_TEST_ exception).
  const staffList = emailList_(CFG.EXO_STAFF);
  check_(staffList.length > 0 && staffList.every(e => staffPortalAllowed_(e)), 'every EXO_STAFF account can open the staff portal');
  check_(!staffPortalAllowed_('') && !staffPortalAllowed_(null), 'the staff portal refuses a visitor Google does not report');
  check_(!staffPortalAllowed_('b00000000@example.edu') && !staffPortalAllowed_('someone@example.org'), 'the staff portal refuses accounts that are not on EXO_STAFF');
  check_(emailList_(CFG.TEST_SUPERUSERS || []).filter(e => !isExoStaff_(e)).every(e => !staffPortalAllowed_(e)),
    'test accounts that are not Exchange Office staff cannot open the staff portal, even in test mode');
  let staffThrew = false, staffOut = null;
  try { staffOut = getStaffForms(); } catch (e) { staffThrew = true; }
  check_(staffPortalAllowed_(meNow) ? !staffThrew : staffThrew, 'the staff portal list answers Exchange Office staff only, even while SELF_TEST_ is on');
  if (staffOut) check_(JSON.stringify(staffOut).search(/sig_file|_ip"/) === -1, 'the staff portal list carries no signature file ids or IP addresses');
  check_(JSON.stringify(plain_({ s1_sig_file: 'x', courses: [{ hod_sig_file: 'y' }] })).indexOf('sig_file') === -1,
    'signature file ids never leave for a browser');
  const ipProbe = JSON.stringify(plain_({ s1_ip: '203.0.113.1', student_ip: '203.0.113.2', ip: '203.0.113.3',
    courses: [{ hod_ip: '203.0.113.4', faculty_ip: '203.0.113.5', facultyIp: '203.0.113.6' }], studentIp: '203.0.113.7' }));
  check_(ipProbe.indexOf('203.0.113') === -1, 'IP addresses never leave for a browser');
  // Study abroad term (Oct 13, 2026): new forms are Fall or Spring only; older year-long / summer rows are still read
  ['Academic year 2027/2028', 'Calendar year 2027', 'Summer 2027'].forEach(t =>
    expectError_(() => hostSemester_(t), 'Fall or Spring', 'the term ' + t + ' on a new form'));
  check_(parseSemester_('Academic year 2027/2028').label === 'Fall 2027', 'an older academic year row still sorts under Fall 2027');
  check_(hostSemester_('Spring 2028') === 'Spring 2028', 'Spring is accepted');
  check_(hostSemester_('fall-2027') === 'Fall 2027', 'a season and year is tidied to "Fall 2027"');
  steps.push('Financial Grants / Sponsorship rules, drawn-signature checks, id stripping and study abroad terms: OK');

  // ---- 1. Intake: a nickname for the university, text Sheets would otherwise change
  const intake = testIntake_();
  // Earned credits: a hard block at 45
  ['44', '0', '-5', 'abc', '', '45 credits'].forEach(bad => expectError_(
    () => createSubmission(Object.assign({}, intake, { credits_completed: bad })),
    'earned credits', 'earned credits "' + bad + '"'));
  steps.push('earned credits 44, 0, -5, abc, blank and "45 credits" -> refused');
  // CGPA: a hard block at CFG.MIN_GPA (2.50), out of 4.00
  ['2.49', '0', '4.5', 'abc', '', '-1'].forEach(bad => expectError_(
    () => createSubmission(Object.assign({}, intake, { gpa: bad })),
    'CGPA', 'CGPA "' + bad + '"'));
  steps.push('CGPA 2.49, 0, 4.5, abc, blank and -1 -> refused');
  const sid = createSubmission(intake).submission_id;
  let sub = reread_(sid);
  check_(sub.host_university === 'Example University One', 'university alias gave "' + sub.host_university + '"');
  check_(sub.host_country === 'Country A', 'country from the Universities tab gave "' + sub.host_country + '"');
  check_(sub.student_mobile === '+00 000 000 0000', 'mobile stored as "' + sub.student_mobile + '"');
  check_(!('gpa' in table_(CFG.SHEETS.SUB).col) || Number(sub.gpa) === 3.2, 'CGPA stored as "' + sub.gpa + '"');
  check_(sub.student_name === 'Test Student' && sub.student_id === TEST_STUDENT_ID && sub.college === 'COLA',
    'name / id / college tidied to "' + sub.student_name + '" / "' + sub.student_id + '" / "' + sub.college + '"');
  steps.push('intake -> ' + sid + ' (eu1 -> ' + sub.host_university + ', ' + sub.host_country + ')');
  expectError_(() => createSubmission(Object.assign({}, intake,
    { host_university: 'EXAMPLE UNIVERSITY ONE', host_semesters: 'fall-2027' })),
    'already have an open form', 'a second form for the same university and semester');
  steps.push('same trip typed differently -> refused');

  // ---- 2. Step I and courses
  submitStepOne(sid, '', {
    s1_accredited: 'Yes', s1_agreement: CFG.AGREEMENT_TYPES[0],
    s1_major_accreditation: [CFG.MAJOR_ACCREDITATIONS[0]],
    s1_comments: 'Self test.',
    decision: 'APPROVE', signature: 'Test Exchange Office Officer'
  });
  steps.push('step I signed');

  [
    // The HoD email is typed by the student; the self test types the test address, so it is a mismatch with the saved HoD and the Exchange Office check email goes to TEST_REDIRECT.
    { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'ELN-301', host_course_name: 'Digital Electronics', host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: CFG.TEST_REDIRECT },
    { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'ELN-302', host_course_name: 'Analog Circuits', host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: CFG.TEST_REDIRECT },
    { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'MAT-210', host_course_name: 'Linear Algebra', host_credits: '5', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptB.key, hod_email: CFG.TEST_REDIRECT }
  ].forEach(c => saveCourse(sid, '', c));
  expectError_(() => saveCourse(sid, '', { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'eln 301', host_course_name: 'Again',
    host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: CFG.TEST_REDIRECT }), 'already on this form', 'the same host course twice');
  fakeSyllabi_(sid);
  // The typed HoD email differs from the saved one, so the courses are held until Exchange Office decides.
  expectError_(() => sendAllDrafts(sid, ''), 'head of department email', 'sending courses whose typed HoD email the Exchange Office has not decided on');
  coursesFor_(sid).forEach(c => check_(c.hod_email_check === 'MISMATCH', 'a typed HoD email that differs from the saved one is held for the Exchange Office'));
  coursesFor_(sid).forEach(c => exoHodDecision(c.course_row_id, 'DECLINE')); // declined: they go to the saved heads
  steps.push('typed HoD email differs: held for Exchange Office, then declined, so the saved head of department gets them');
  steps.push('3 courses added (2 for ' + deptA.name + ', 1 for ' + deptB.name + '); duplicate refused');

  const sent = sendAllDrafts(sid, '');
  steps.push('send all -> ' + sent.sent + ' course(s) in ' + sent.hods + ' email(s)');

  // ---- 2b. A declined course is fixed and the same course resubmitted
  const qA = { ref: sid, hod: deptA.hod_email.toLowerCase() };
  const toDecline = getReview(qA).pending.filter(c => c.host_course_code === 'ELN-302')[0];
  decideCourses(qA, [{ course_row_id: toDecline.course_row_id, decision: 'DENY',
    comments: 'Self test: please send the weekly topics.' }], 'Test Head of Department');
  saveAlternative(sid, '', toDecline.course_row_id, { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'ELN-302', host_course_name: 'Analog Circuits',
    host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: deptA.hod_email }, true);
  DB_ = {};
  const eln302 = coursesFor_(sid).filter(c => courseKey_(c.host_course_code) === courseKey_('ELN-302'));
  const oldRow = eln302.filter(c => c.course_row_id === toDecline.course_row_id)[0];
  const newRow = eln302.filter(c => c.course_row_id !== toDecline.course_row_id)[0];
  check_(oldRow.status === CRS_STATUS.SUPERSEDED, 'declined row is superseded');
  check_(newRow && newRow.status === CRS_STATUS.PENDING, 'same course resubmitted and sent');
  check_(newRow && newRow.host_syllabus_url === oldRow.host_syllabus_url, 'earlier syllabus kept');
  steps.push('ELN-302 declined, fixed and resubmitted as the same course');

  // ---- 3. Faculty review, then every head of department approves
  // Must be an address on the university domain (the form refuses others); in test mode it is redirected to TEST_REDIRECT anyway.
  const fac = ('cpf.selftest.faculty@' + CFG.FACULTY_EMAIL_DOMAIN).toLowerCase();
  const toFaculty = getReview({ ref: sid, hod: deptB.hod_email.toLowerCase() }).pending[0];
  decideCourses({ ref: sid, hod: deptB.hod_email.toLowerCase() }, [{ course_row_id: toFaculty.course_row_id,
    decision: 'FORWARD', faculty_email: fac, forward_note: 'Self test: please compare with MTH 221.' }],
    'Test Head of Department');
  submitFacultyReview({ ref: sid, fac: fac }, [Object.assign({
    course_row_id: toFaculty.course_row_id, recommendation: 'APPROVE', match_pct: 90,
    match_notes: 'Self test: same topics and depth.',
    course_type: CFG.COURSE_TYPES[0], ger_area: '', grade_required: 'C', prereqs_met: 'Yes'
  }, answers[toFaculty.host_course_code])], 'Test Faculty Member');
  steps.push(deptB.name + ': forwarded to a faculty member, reviewed (90%) and returned');
  [deptA, deptB].forEach(d => steps.push(d.name + ': ' + approveAll_(sid, d.hod_email, answers) + ' approved'));

  // ---- 4. Step III, "Change my courses" half way, then all the way
  confirmGate(sid, '');
  sub = reread_(sid);
  const firstStage = sub.current_stage;
  check_(firstStage === STAGES[0].key, 'Step III starts with ' + STAGES[0].key + ' (got "' + firstStage + '")');
  decideStage(sid, firstStage, '', 'APPROVE', 'Approved (self test).', 'Test Approver');
  reopenCourses(sid, '');
  sub = reread_(sid);
  check_(sub.status === STATUS.COURSES && STAGES.every(s => !sub[s.key + '_status']) && !sub.current_stage,
    'reopen during Step III');
  steps.push('Step III started, ' + firstStage + ' signed, "Change my courses" -> back to Step II, signatures cleared');
  confirmGate(sid, '');
  steps.push('Step III again:');
  sub = walkChain_(sid, steps);
  check_(sub.status === STATUS.COMPLETED && sub.pdf_url, 'original form completed with a PDF');
  check_(sub.ADV_status === 'APPROVED' && sub.DEAN_status === 'APPROVED' && sub.FIN_status === 'APPROVED',
    'advisor, associate dean and Financial Grants (scholarship = Yes) signed');
  check_(sub.SPON_status === 'N/A', 'Sponsorship recorded as N/A for a student who is not sponsored');
  check_(new Date(sub.EXO_at) >= new Date(sub.FIN_at) && new Date(sub.signed_at) >= new Date(sub.EXO_at) &&
    new Date(sub.REG_at) >= new Date(sub.signed_at), 'paper-form order: ... Exchange Office, then the student, then the Registrar');
  check_(str_(sub.s1_program_type), 'the Exchange Office filled in the student type and program type');
  check_(!str_(sub.student_sig_file) && /^drawn signature, image deleted on /.test(str_(sub.student_sig_method)) && sub.pdf_sent_at,
    'the drawn student signature image was deleted after the final PDF was saved and sent ("' + sub.student_sig_method + '")');
  check_(coursesFor_(sid).some(c => c.host_course_code === 'MAT-210' && c.status === CRS_STATUS.APPROVED && str_(c.grade_required) === 'C'),
    'the minimum grade required is saved');
  check_(coursesFor_(sid).filter(c => c.status === CRS_STATUS.APPROVED).every(c => c.hod_role === 'HoD'),
    'each course approval records who signed it (HoD here; a designate signing records Designate)');
  check_(history_(sub).courses.some(c => c.role === 'Head of Department'), 'the review history shows the signer role');
  // Oct 13, 2026: signer IPs are no longer captured (CFG.CAPTURE_IP false), so none may be stored.
  check_(CFG.CAPTURE_IP || (!str_(sub.s1_ip) && !str_(sub.student_ip) && !str_(sub.EXO_ip)),
    'no IP addresses are recorded with the signatures (IP capture is off)');
  steps.push('original -> ' + sub.status + ', pdf ' + sub.pdf_url);
  expectError_(() => createSubmission(intake), 'already have an approved form', 'a new form for a completed trip');

  // ---- 5. Amendment
  const a1 = amendForm(sid, '').submission_id;
  check_(a1 === sid + '-A1', 'amendment reference ' + a1);
  expectError_(() => amendForm(sid, ''), 'already in progress', 'a second amendment while one is open');
  const carried = coursesFor_(a1);
  check_(carried.length === 3 && carried.every(c => c.status === CRS_STATUS.APPROVED && c.carried_from && c.approved_in === sid),
    'the 3 approved courses carried over');
  expectError_(() => confirmGate(a1, ''), 'no changes', 'Step III for an amendment with no changes');
  const drop = carried.find(c => c.host_course_code === 'ELN-302');
  withdrawCourse(a1, '', drop.course_row_id);
  restoreCourse(a1, '', drop.course_row_id);
  withdrawCourse(a1, '', drop.course_row_id);
  expectError_(() => saveCourse(a1, '', { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'ELN 302', host_course_name: 'Analog Circuits',
    host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: deptA.hod_email }), 'Put back', 'adding a removed carried course again');
  saveCourse(a1, '', { alt_course_code: 'None', alt_course_name: 'None', host_course_code: 'PHY-101', host_course_name: 'Physics I', host_credits: '6', host_credit_system: 'ECTS', host_mode: 'In-person', dept_key: deptA.key, hod_email: CFG.TEST_REDIRECT });
  // Exchange Office CONFIRMS the typed head of department email: the course goes to the typed address, not the saved head.
  const phy = coursesFor_(a1).filter(c => courseKey_(c.host_course_code) === courseKey_('PHY-101'))[0];
  check_(phy && phy.hod_email_check === 'MISMATCH', 'PHY-101 is held for the Exchange Office (typed HoD email differs)');
  exoHodDecision(phy.course_row_id, 'CONFIRM');
  const phyAfter = coursesFor_(a1).filter(c => courseKey_(c.host_course_code) === courseKey_('PHY-101'))[0];
  check_(phyAfter.hod_email_check === 'CONFIRMED' && str_(phyAfter.hod_email).toLowerCase() === CFG.TEST_REDIRECT.toLowerCase(),
    'after the Exchange Office confirms, the course routes to the typed email');
  fakeSyllabi_(a1);
  sendAllDrafts(a1, '');
  approveAll_(a1, deptA.hod_email, answers);
  check_(getReview({ ref: a1, hod: deptA.hod_email.toLowerCase() }).pending.every(c => courseKey_(c.host_course_code) !== courseKey_('PHY-101')),
    'the saved head of department no longer sees a course the Exchange Office confirmed for the typed email');
  check_(approveAll_(a1, CFG.TEST_REDIRECT, answers) === 1, 'the confirmed typed email reviews and signs the course');
  steps.push('amendment ' + a1 + ': 3 carried, ELN-302 removed / put back / removed, PHY-101 added and approved');
  confirmGate(a1, '');
  steps.push('Amendment (Step III is copied, not signed again):');
  const done = walkChain_(a1, steps);
  check_(done.status === STATUS.COMPLETED && done.pdf_url, 'amendment completed with a PDF');
  // Oct 2026: an amendment does not sign Step III again; every Step III line is copied from the earlier form.
  const parentRow = findRow_(CFG.SHEETS.SUB, 'submission_id', done.amends_id);
  STAGES.filter(s => (s.step || 'III') === 'III').forEach(s => {
    check_(done[s.key + '_status'] === parentRow[s.key + '_status'] && /^Carried from /.test(str_(done[s.key + '_comments'])),
      'the amendment carries Step III line ' + s.key + ' from the earlier form');
  });
  check_(done.student_signature && done.RO_status === 'APPROVED' && done.REG_status === 'APPROVED',
    'the amendment is still signed by the student and goes through Step IV');
  check_(CFG.CAPTURE_IP || !str_(done.s1_ip), 'the amendment stores no IP address (IP capture is off)');
  check_(coursesFor_(a1).every(c => !str_(c.hod_sig_file) && !str_(c.faculty_sig_file)) && !str_(done.s1_sig_file),
    'no signature image is copied into an amendment');
  check_(!storedSignatureSlots_(done).length, 'the amendment holds no signature images once complete');
  check_(isSuperseded_(reread_(sid)), 'the original is replaced once the amendment is complete');
  check_(!canAmend_(reread_(sid)).ok && canAmend_(reread_(a1)).ok, 'only the newest version can be amended');
  const info = amendmentInfo_(reread_(a1));
  check_(info.added.join() === 'PHY-101' && info.removed.join() === 'ELN-302', 'amendment changes ' + JSON.stringify(info));
  expectError_(() => createSubmission(intake), 'already have an approved form', 'a new form once the amendment is done');
  steps.push('amendment -> ' + done.status + ', pdf ' + done.pdf_url);

  steps.push('');
  steps.push('ALL CHECKS PASSED. Now run runSelfTestExtras (every other path), then deleteTestData.');

  const out = steps.join('\n');
  console.log(out);
  return out;
}

/**
 * Everything that must be right before real students use the form: every
 * approver email on file and well-formed, the sender, triggers, test mode,
 * leftover test data. Prints one line per check; nothing is changed.
 */
function goLiveCheck() {
  requireAdmin_();
  const lines = [];
  const ok = (good, text, fixText) => lines.push(good ? 'OK    ' + text : 'FIX   ' + (fixText || text));
  const warn = text => lines.push('NOTE  ' + text);
  const auEmail = e => isEmail_(e) && str_(e).toLowerCase().endsWith('@' + CFG.FACULTY_EMAIL_DOMAIN);

  // Sending
  ok(!CFG.TEST_REDIRECT, CFG.TEST_REDIRECT ?
    'Test mode is ON: every email goes to ' + CFG.TEST_REDIRECT + ' (set TEST_REDIRECT to "" in Config.gs)'
    : 'Test mode is off: emails go to the real people');
  ok(sendAsAlias_(), sendAsAlias_()
    ? 'Emails are sent from ' + CFG.FROM_EMAIL
    : 'Emails are sent from ' + Session.getEffectiveUser().getEmail() + ', not ' + CFG.FROM_EMAIL +
      ' (add it under Gmail > Settings > Accounts > "Send mail as")');
  ok(CFG.REPLY_TO.every(isEmail_), 'Replies go to ' + CFG.REPLY_TO.join(', '));
  ok((CFG.ALWAYS_CC || []).every(isEmail_), 'Every email is copied to ' + ((CFG.ALWAYS_CC || []).join(', ') || 'nobody'));

  // Fixed approvers
  [['EXO', CFG.EXO_EMAIL], ['Registrar', CFG.REGISTRAR_EMAIL], ['Financial Grants', CFG.FINANCIAL_EMAIL],
    ['Sponsorship', CFG.SPONSORSHIP_EMAIL]].forEach(p => ok(auEmail(p[1]), p[0] + ': ' + (p[1] || 'MISSING')));
  const order = [];
  STAGES.forEach(s => { if (s.afterSignature && order.indexOf('student signs') === -1) order.push('student signs'); order.push(s.key); });
  if (order.indexOf('student signs') === -1) order.push('student signs');
  lines.push('NOTE  Signature order (Steps III and IV): ' + order.join(' -> ') + ' -> completed');
  const hasDean = !!stageByKey_('DEAN');
  if (hasDean) CFG.COLLEGES.forEach(col => ok(auEmail(CFG.ASSOC_DEANS[col]), 'Associate Dean ' + col + ': ' + (CFG.ASSOC_DEANS[col] || 'MISSING')));
  // Sign-in: Exchange Office staff must be institution accounts, or they cannot open the form at all
  CFG.EXO_STAFF.forEach(e => {
    if (auEmail(e)) ok(true, 'EXO staff: ' + e);
    else warn('EXO staff ' + e + ' is not an @' + CFG.FACULTY_EMAIL_DOMAIN + ' account; it can only get in if Google lets that account open the form (check with ?page=whoami)');
  });
  if (hasDean) CFG.COLLEGES.forEach(col => {
    const a = str_((CFG.ASSOC_DEAN_ASSISTANTS || {})[col]);
    if (!a) warn('No Associate Dean assistant set for ' + col + ' (optional)');
    else a.split(',').map(str_).forEach(x => ok(auEmail(x), 'Associate Dean assistant ' + col + ': ' + x));
  });
  ok(!CFG.CAPTURE_IP || !CFG.IP_LOOKUP_URL || /^https:\/\//.test(CFG.IP_LOOKUP_URL), 'IP lookup address is https (or blank)');

  // Tabs
  ok('amended_by' in table_(CFG.SHEETS.SUB).col && 'carried_from' in table_(CFG.SHEETS.CRS).col &&
    'gpa' in table_(CFG.SHEETS.SUB).col &&
    'student_sig_file' in table_(CFG.SHEETS.SUB).col && 'pdf_sent_at' in table_(CFG.SHEETS.SUB).col &&
    'hod_sig_file' in table_(CFG.SHEETS.CRS).col && 'hod_role' in table_(CFG.SHEETS.CRS).col &&
    'designate_email' in table_(CFG.SHEETS.CRS).col && 'designate_email' in table_(CFG.SHEETS.DEPT).col,
    'Submissions and Courses tabs have every column',
    'Some columns are missing (CPF menu > Set up / repair tabs)');
  let unis = [];
  try { unis = readAll_(CFG.SHEETS.UNI).filter(u => str_(u.university)); } catch (e) { console.log('Ignored: ' + e); /* tab missing */ }
  ok(unis.length > 0, unis.length + ' universities on the Universities tab (whatever students type is matched to these)',
    'The Universities tab is missing or empty (CPF menu > Set up / repair tabs)');

  // Departments tab (what the workflow actually uses)
  const depts = readAll_(CFG.SHEETS.DEPT).filter(d => d.dept_key);
  ok(depts.length > 0, depts.length + ' departments on the Departments tab');
  const seen = {};
  depts.forEach(d => {
    const label = d.dept_key + ' ' + d.dept_name;
    if (seen[d.dept_key]) ok(false, label + ': the key ' + d.dept_key + ' is listed twice');
    seen[d.dept_key] = true;
    if (!auEmail(d.hod_email)) ok(false, label + ': head of department email ' + (str_(d.hod_email) || 'MISSING'));
    str_(d.assistant_email).split(',').map(str_).filter(Boolean).forEach(a => {
      if (!auEmail(a)) ok(false, label + ': assistant email "' + a + '" looks wrong');
    });
    if (!str_(d.assistant_email)) warn(label + ': no assistant to CC (optional)');
    // Optional College/School Designate: one Home University address, not the HoD, not an assistant.
    const des = str_(d.designate_email).toLowerCase();
    if (des) {
      ok(auEmail(des) && des !== str_(d.hod_email).toLowerCase() && emailList_(d.assistant_email).indexOf(des) === -1,
        label + ': College/School Designate ' + des + ' may sign instead of the HoD',
        label + ': designate_email "' + des + '" must be one @' + CFG.FACULTY_EMAIL_DOMAIN +
        ' address that is neither the HoD nor an assistant (assistants sign as Department Assistant)');
    }
    if (CFG.COLLEGES.indexOf(str_(d.college)) === -1) ok(false, label + ': college "' + d.college + '" is not one of ' + CFG.COLLEGES.join(', '));
  });
  CFG.COLLEGES.forEach(col => {
    if (!depts.some(d => d.college === col)) ok(false, 'No department listed for ' + col);
  });
  const seed = {};
  DEPT_SEED.forEach(r => { seed[r[0]] = r; });
  // designate_email is typed on the tab only (DEPT_SEED has none), so it is not compared.
  const differs = depts.filter(d => !seed[d.dept_key] ||
    DEPT_HEADERS.some((h, i) => h !== 'designate_email' && str_(d[h]) !== str_(seed[d.dept_key][i]))).map(d => d.dept_key);
  if (differs.length) warn('Departments tab differs from the list in SheetSetup.gs for: ' + differs.join(', ') +
    ' (fine if you edited the tab on purpose)');

  // Running
  const handlers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  const fixTriggers = ' is not installed (CPF menu > Install triggers)';
  ok(handlers.indexOf('sendReminders') > -1, 'Daily reminder trigger installed', 'Daily reminder trigger' + fixTriggers);
  ok(handlers.indexOf('refreshSemesterTabs') > -1, 'Semester tabs trigger installed', 'Semester tabs trigger' + fixTriggers);
  ok(handlers.indexOf('cleanupSignatureImages') > -1, 'Signature image cleanup trigger installed',
    'Signature image cleanup trigger' + fixTriggers);
  ok(!!webAppUrl_(), 'Web app link: ' + webAppUrl_(), 'The web app is not deployed yet');
  ok(!!prop_('CATALOG_ID'), 'Approved-course catalog exists', 'The approved-course catalog has not been created yet (it appears with the first approval)');

  // Forms waiting on a Step III stage that is no longer in STAGES (for example after the
  // chain was changed) are stuck: nobody can decide them and no reminder goes out.
  const subs = readAll_(CFG.SHEETS.SUB);
  const stuck = subs.filter(s => s.status === STATUS.GATED && !stageByKey_(s.current_stage)).map(s => s.submission_id);
  ok(!stuck.length, 'No form is waiting on a Step III stage that no longer exists',
    stuck.length + ' form(s) wait on a Step III stage that is no longer in STAGES: ' + stuck.join(', ') +
    '. Ask each student to press "Change my courses" and then "proceed to Step III" again; Step III then restarts in the current order.');

  // Forms waiting on a step that has no approver address (e.g. a blank advisor email): nobody can sign.
  const noSigner = subs.filter(s => s.status === STATUS.GATED && stageByKey_(s.current_stage) &&
    !stageEmail_(s, stageByKey_(s.current_stage))).map(s => s.submission_id + ' (' + s.current_stage + ')');
  ok(!noSigner.length, 'Every form in Step III / IV has an address for the step it waits on',
    noSigner.length + ' form(s) wait on a step with no approver address: ' + noSigner.join(', ') +
    '. Fill in advisor_email on the Submissions tab (or the address in Config.gs), then ask the student to press "Send reminder now".');

  // Earned credits (hard block at CFG.MIN_EARNED_CREDITS): open forms below it are NOT deleted;
  // they cannot pass the gate or be amended until the Exchange Office deals with them by hand.
  const lowCredits = subs.filter(s => CLOSED_STATUSES.indexOf(s.status) === -1 && creditsError_(s.credits_completed))
    .map(s => s.submission_id + ' (' + (str_(s.credits_completed) || 'blank') + ')');
  ok(!lowCredits.length, 'No open form is below ' + CFG.MIN_EARNED_CREDITS + ' earned credits',
    lowCredits.length + ' open form(s) are below ' + CFG.MIN_EARNED_CREDITS + ' earned credits (or not a number): ' +
    lowCredits.join(', ') + '. They cannot move on to Step III. Handle each by hand: correct credits_completed on ' +
    'the Submissions tab if it was mistyped, or type CANCELLED in its status cell.');

  // Courses held because the HoD email the student typed differs from the Departments tab: the
  // student cannot send them until the Exchange Office confirms or declines (link in the Exchange Office's email).
  const openIds = new Set(subs.filter(s => CLOSED_STATUSES.indexOf(s.status) === -1).map(s => String(s.submission_id)));
  const heldHod = readAll_(CFG.SHEETS.CRS).filter(c => c.hod_email_check === 'MISMATCH' && openIds.has(String(c.submission_id)) &&
    isLive_(c)).map(c => c.submission_id + ' ' + c.host_course_code);
  if (heldHod.length) warn(heldHod.length + ' course(s) wait for the Exchange Office to confirm or decline a typed head of department email: ' +
    heldHod.join(', ') + ' (use the link in the "Confirm head of department email" emails)');

  // Drive folders and files: found only by saved id; each must be owned by the script owner.
  const me = ownerEmail_();
  const ownerOf = item => { try { return str_(item.getOwner().getEmail()).toLowerCase(); } catch (e) { return ''; } };
  const folderCheck = (propKey, label) => {
    const f = (() => { try { return prop_(propKey) ? DriveApp.getFolderById(prop_(propKey)) : null; } catch (e) { return null; } })();
    ok(!!f, label + ' folder exists (' + propKey + ')',
      'The ' + label + ' folder does not exist yet or cannot be opened (CPF menu > Set up / repair tabs creates it)');
    if (!f) return null;
    ok(ownerOf(f) === me, 'The ' + label + ' folder is owned by the script owner (' + me + ')',
      'The ' + label + ' folder is owned by ' + (ownerOf(f) || 'someone else') + ', not by the script owner (' + me +
      '). Transfer it (README section 12).');
    ok(isOwnedAndPrivate_(f) || ownerOf(f) !== me, 'The ' + label + ' folder is not shared with anyone',
      'The ' + label + ' folder is SHARED. Remove every person and link from the folder itself in Drive.');
    return f;
  };
  folderCheck('ROOT_FOLDER_ID', 'CPF Syllabi');
  const folder = folderCheck('SIG_FOLDER_ID', 'private signature');
  if (prop_('CATALOG_ID')) {
    try {
      const cat = DriveApp.getFileById(prop_('CATALOG_ID'));
      ok(ownerOf(cat) === me, 'The approved-course catalog is owned by the script owner',
        'The approved-course catalog is owned by ' + (ownerOf(cat) || 'someone else') + '. Transfer it to ' + me + '.');
    } catch (e) {
      ok(false, '', 'The approved-course catalog (CATALOG_ID) cannot be opened: ' + e);
    }
  }

  // Drawn signature images: no shared files, nothing left for completed forms
  if (folder) {
    let files = 0, sharedFiles = 0;
    const it = folder.getFiles();
    while (it.hasNext() && files < 500) {
      const f = it.next();
      files++;
      if (!isOwnedAndPrivate_(f)) sharedFiles++;
    }
    ok(!sharedFiles, files + ' file(s) in the signature folder, all owned by the script owner and none shared',
      sharedFiles + ' signature file(s) are SHARED or not owned by the script owner. Remove their sharing in Drive right away, then run CPF menu > Clean up signature images now.');
    const noPdf = subs.filter(s => s.status === STATUS.COMPLETED && !str_(s.pdf_url)).map(s => s.submission_id);
    ok(!noPdf.length, 'Every completed form has its signed PDF saved',
      noPdf.length + ' completed form(s) have no saved PDF: ' + noPdf.join(', ') + '. Run CPF menu > Retry final PDFs.');
    const leftover = subs.filter(s => s.status === STATUS.COMPLETED && storedSignatureSlots_(s).length).map(s => s.submission_id);
    ok(!leftover.length, 'No completed form still holds signature images',
      leftover.length + ' completed form(s) still hold signature images (their PDF was not built, saved or sent): ' +
      leftover.join(', ') + '. Run CPF menu > Retry final PDFs.');
  }
  if (typeof Drive === 'undefined') {
    warn('The Drive advanced service is not enabled, so signature images are moved to the Drive trash (Google empties it after 30 days) instead of being deleted permanently. See README section 2.');
  } else {
    ok(true, 'Drive advanced service enabled: signature images are deleted permanently');
  }

  // Leftovers
  const tests = subs.filter(s => str_(s.student_id).toLowerCase() === TEST_STUDENT_ID).length;
  ok(!tests, tests ? tests + ' self-test form(s) still in the sheet (run deleteTestData)' : 'No self-test forms left');
  if (subs.length - tests) warn((subs.length - tests) + ' other form(s) in the sheet - clear them too if they were only testing');

  const fixes = lines.filter(l => l.indexOf('FIX') === 0).length;
  lines.unshift(fixes ? fixes + ' thing(s) to fix before going live:' : 'Ready to go live.');
  const out = lines.join('\n');
  console.log(out);
  return out;
}

/** Prints the three links the Exchange Office needs: the form, the submissions sheet, the catalog. */
function printLinks() {
  requireAdmin_();
  const out = [
    'CPF form:                ' + webAppUrl_(),
    'Submissions sheet:       ' + ss_().getUrl(),
    'Approved-course catalog: ' + catalog_().getUrl()
  ].join('\n');
  console.log(out);
  return out;
}

/** Prints the portal link (and Step I link while pending) for every submission. */
function listStudentLinks() {
  requireAdmin_();
  const out = readAll_(CFG.SHEETS.SUB).map(s =>
    s.submission_id + '  ' + s.student_name + ' [' + s.status + ']\n  ' + studentUrl_(s) +
    (stepOneDone_(s) ? '' : '\n  STEP I: ' + stepOneUrl_(s))
  ).join('\n');
  console.log(out);
  return out;
}

/** Deletes the script properties whose names start with one of the prefixes; returns their names. */
function dropProps_(prefixes) {
  const props = PropertiesService.getScriptProperties();
  const doomed = Object.keys(props.getProperties()).filter(k => prefixes.some(p => k.indexOf(p) === 0));
  doomed.forEach(k => props.deleteProperty(k));
  PROPS_ = null;
  return doomed;
}

/**
 * Wipes every row from Submissions, Courses and Log (keeping the headers,
 * Departments and Universities) and every row of the approved-course catalog,
 * and restarts form numbers at -0001. Meant for clearing testing before go-live,
 * so it refuses to run while test mode is off (that would be live data). Both
 * files keep their version history (File > Version history) if something must
 * come back.
 */
function clearAllData() {
  requireAdmin_();
  if (!CFG.TEST_REDIRECT) {
    throw new Error('Refusing to wipe: test mode is off, so this is live data. ' +
      'If you really mean it, put an address back in TEST_REDIRECT (Config.gs) first.');
  }
  return withLock_(() => {
    // Every drawn signature image goes too (before the rows that point at them).
    let images = 0;
    readAll_(CFG.SHEETS.SUB).forEach(s => { images += purgeSignatureImages_(s, 'all data cleared'); });
    LOG_QUEUE_ = [];
    const lines = [CFG.SHEETS.SUB, CFG.SHEETS.CRS, CFG.SHEETS.LOG].map(name => {
      const sh = sheet_(name);
      const rows = sh.getLastRow() - 1;
      if (rows > 0) {
        keepSpareRow_(sh);
        sh.deleteRows(2, rows);
      }
      delete DB_[name];
      return name + ': ' + (rows > 0 ? 'cleared ' + rows + ' row(s)' : 'already empty');
    });
    lines.push('Signature images: deleted ' + images + ' (any others left in the folder go with the next cleanup)');
    lines.push('Catalog: removed ' + catalogRemove_(() => true) + ' row(s)');
    const seq = dropProps_(['REF_SEQ_', 'AMEND_SEQ_']);
    lines.push('Reference numbers reset, next form is CPF-...-0001' + (seq.length ? ' (cleared ' + seq.join(', ') + ')' : ''));
    const msg = lines.join('\n');
    console.log(msg);
    return msg;
  });
}

/** Sets the form counter back to CPF-...-0001. Refuses while any form exists, so no number can be issued twice. */
function resetCpfCounter() {
  requireAdmin_();
  return withLock_(() => {
    const forms = readAll_(CFG.SHEETS.SUB).length;
    if (forms) {
      throw new Error('There are still ' + forms + ' form(s) in the Submissions tab. Run deleteTestData (or clearAllData) first, so no number is issued twice.');
    }
    const cleared = dropProps_(['REF_SEQ_', 'AMEND_SEQ_']);
    const msg = 'Counter reset, the next form is CPF-...-0001' + (cleared.length ? ' (cleared ' + cleared.join(', ') + ')' : ' (it was already at 1)');
    console.log(msg);
    return msg;
  });
}

/** Removes only what runSelfTest() created (the test student's forms and their amendments). */
function deleteTestData() {
  requireAdmin_();
  return withLock_(() => {
    const ids = new Set(readAll_(CFG.SHEETS.SUB).
      filter(s => str_(s.student_id).toLowerCase() === TEST_STUDENT_ID)
      .map(s => String(s.submission_id)));
    if (!ids.size) return 'nothing to delete';

    const mine = r => ids.has(String(r.submission_id));
    // Drawn signature images of the test forms (left behind if the self test stopped half way).
    readAll_(CFG.SHEETS.SUB).filter(mine).forEach(s => purgeSignatureImages_(s, 'self-test data deleted'));
    LOG_QUEUE_ = LOG_QUEUE_.filter(line => !ids.has(String(line[1])));   // no log lines for rows about to go
    deleteWhere_(CFG.SHEETS.CRS, mine);
    deleteWhere_(CFG.SHEETS.LOG, mine);
    deleteWhere_(CFG.SHEETS.SUB, mine);
    const fromCatalog = catalogRemove_(ref => ids.has(ref));
    dropProps_(Array.from(ids).map(id => 'AMEND_SEQ_' + id));
    const msg = 'deleted ' + ids.size + ' test submission(s) and ' + fromCatalog + ' catalog row(s): ' +
      Array.from(ids).join(', ');
    console.log(msg);
    return msg;
  });
}
