/*******************************************************************
 * Email.gs - every notification the workflow sends.
 *******************************************************************/

/**
 * Sends one branded email. While CFG.TEST_REDIRECT is set, the message goes
 * there instead, with the real recipients shown in the subject.
 * opts: { cc, title, attachments }
 */
/** The form the next email belongs to (set by each mail*_ function), so the Log tab can list it. */
let MAIL_SID_ = '';

function sendMail_(to, subject, bodyHtml, opts) {
  const sid = MAIL_SID_;
  MAIL_SID_ = '';
  if (!to) return false;
  const o = Object.assign({}, opts);
  o.cc = ccList_(to, o.cc);
  const test = !!CFG.TEST_REDIRECT;
  const recipient = test ? CFG.TEST_REDIRECT : to;
  // Exchange Office action emails (Oct 19, 2026): "[CPF] [ACTION REQUIRED] ..." so the Exchange Office can spot them.
  const fullSubject = CFG.SUBJECT_PREFIX + ' ' + (o.action ? '[ACTION REQUIRED] ' : '') + (test ? '[TEST to ' + to + (o.cc ? ' cc ' + o.cc : '') + '] ' : '') + subject;
  const options = {
    cc: test ? '' : o.cc,
    replyTo: CFG.REPLY_TO.join(','),
    // The header always shows the clean title; the test note goes in its own banner.
    htmlBody: wrap_(o.title || subject, (test ? testBanner_(to, o.cc) : '') + bodyHtml),
    inlineImages: { logo: logoBlob_() },
    attachments: o.attachments || [],
    name: CFG.SENDER_NAME
  };
  try {
    if (sendAsAlias_()) {
      GmailApp.sendEmail(recipient, fullSubject, plainText_(options.htmlBody), Object.assign({ from: CFG.FROM_EMAIL }, options));
    } else {
      MailApp.sendEmail(Object.assign({ to: recipient, subject: fullSubject }, options));
    }
    // Every email is listed on the Log tab: who it went to, the subject and the attachments.
    log_(sid, 'system', 'EMAIL_SENT', { to: to, cc: o.cc, subject: subject,
      files: (o.attachments || []).map(b => b.getName()), test: test ? CFG.TEST_REDIRECT : '' });
    return true;
  } catch (e) {
    // Never blocks the action that sent it, but shows up on the Log tab as MAIL_FAILED.
    console.error('mail to ' + recipient + ' failed: ' + e);
    log_(sid, 'system', 'MAIL_FAILED', { to: to, subject: subject, error: String(e) });
    return false;
  }
}

/**
 * The CC line: the caller's cc plus CFG.ALWAYS_CC, comma separated, without
 * duplicates and without anyone who is already the main recipient.
 */
function ccList_(to, cc) {
  const main = emailList_(to);
  return emailList_([].concat(cc || [], CFG.ALWAYS_CC || [])).
    filter((e, i, all) => all.indexOf(e) === i && main.indexOf(e) === -1)
    .join(',');
}

let SEND_AS_ = null;
/**
 * True when CFG.FROM_EMAIL is a verified "Send mail as" address of the account
 * running the script (Gmail > Settings > Accounts). Otherwise mail goes out from
 * that account, still with REPLY_TO, so nothing breaks before the alias exists.
 */
function sendAsAlias_() {
  if (SEND_AS_ === null) {
    SEND_AS_ = false;
    const alias = str_(CFG.FROM_EMAIL).toLowerCase();
    if (alias && alias !== str_(Session.getEffectiveUser().getEmail()).toLowerCase()) {
      try { SEND_AS_ = GmailApp.getAliases().map(a => a.toLowerCase()).indexOf(alias) > -1; }
      catch (e) { console.warn('Could not read Gmail send-as addresses: ' + e); }
    }
  }
  return SEND_AS_;
}

/** Text version for mail clients that do not show HTML. */
function plainText_(html) {
  return html.replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, '').
    replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&#8203;/g, '')
    .replace(/\n\s*\n+/g, '\n\n').trim();
}

/** Test-mode note at the top of the body: who the email is really meant for. */
function testBanner_(to, cc) {
  return '<div style="margin:0 0 18px;padding:10px 14px;background:#fff5e0;border-left:3px solid #c98a00;' +
    'border-radius:0 6px 6px 0;font-size:13px;color:#6b4700">' +
    '<b>Test mode.</b> When live, this email goes to <b>' + plainAddress_(to) + '</b>' +
    (cc ? ', cc <b>' + plainAddress_(cc) + '</b>' : '') + '.</div>';
}

/**
 * An email address as plain text. Gmail turns anything that looks like an
 * address into a blue link; zero-width spaces after '@' and '.' stop that.
 */
function plainAddress_(s) {
  return esc_(s).replace(/@/g, '@&#8203;').replace(/\./g, '.&#8203;');
}

function wrap_(title, inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f4f3;padding:24px">' +
    '<div style="max-width:660px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e6e1df">' +
      '<div style="padding:18px 24px 14px"><img src="cid:logo" alt="Institution logo" width="327" height="36" style="display:block;border:0;max-width:100%;height:auto"></div>' +
      '<div style="background:' + CFG.BRAND_COLOR + ';color:#fff;padding:18px 24px">' +
        '<div style="font-size:12px;letter-spacing:.8px;opacity:.85">INTERNATIONAL EXCHANGE OFFICE</div>' +
        '<div style="font-size:18px;font-weight:bold;margin-top:4px">' + esc_(title) + '</div>' +
      '</div>' +
      '<div style="padding:24px;color:#22262b;font-size:14px;line-height:1.6">' + inner + '</div>' +
      '<div style="padding:16px 24px;background:#faf9f8;border-top:1px solid #f0ecea;color:#756d6a;font-size:12px">' +
        esc_(CFG.OFFICE) + ' &middot; ' + plainAddress_(CFG.EXO_EMAIL) +
      '</div>' +
    '</div></div>';
}

function button_(url, label) {
  return '<p style="margin:22px 0"><a href="' + esc_(url) + '" ' +
    'style="background:' + CFG.BRAND_COLOR + ';color:#fff;text-decoration:none;padding:11px 20px;' +
    'border-radius:6px;font-weight:bold;display:inline-block">' + esc_(label) + '</a></p>';
}

/** Two-column table; rows with an empty value are left out. */
function kv_(pairs) {
  return '<table style="border-collapse:collapse;font-size:14px">' +
    pairs.filter(p => p[1] !== '' && p[1] != null).map(p =>
      '<tr><td style="padding:5px 14px 5px 0;color:#756d6a;white-space:nowrap;vertical-align:top">' +
      esc_(p[0]) + '</td><td style="padding:5px 0"><b>' + esc_(p[1]) + '</b></td></tr>'
    ).join('') +
    '</table>';
}

function hi_(sub) {
  return '<p>Hi ' + esc_(str_(sub.student_name).split(' ')[0]) + ',</p>';
}

const MUTED_ = '<span style="color:#756d6a">';

/** The "what happened before you" block that every approver email carries. */
function priorHtml_(sub) {
  const h = history_(sub);
  const one = h.stepOne;
  let out = '<div style="margin:18px 0;padding:14px 16px;background:#f3f6fb;border-left:3px solid ' + CFG.BRAND_COLOR + '">' +
    '<div style="font-weight:bold;margin-bottom:8px">Approved so far</div>' +
    '<div style="font-size:13px;margin-bottom:8px"><b>Step I (Exchange Office)</b>: ' +
    (one.done ?
      esc_(one.agreement) + ' &middot; accreditation ' + esc_(one.accredited) +
        ' &middot; accreditation for the major: ' + esc_(one.majorAccreditation) +
        '<br>' + MUTED_ + esc_(signedText_(one.signature, one.at, one.method)) + '</span>'
      : 'not yet completed') +
    '</div>';

  const approved = h.courses.filter(c => c.status === CRS_STATUS.APPROVED);
  if (approved.length) {
    out += '<div style="font-size:13px;margin-bottom:8px"><b>Step II (departments)</b><ul style="margin:6px 0;padding-left:18px">' +
      approved.map(c =>
        '<li>' + esc_(c.hostCode) + ' &rarr; <b>' + esc_(c.homeCode) + '</b> ' +
        esc_(c.courseType) + (c.gerArea ? ' [' + esc_(c.gerArea) + ']' : '') +
        ', grade required ' + esc_(str_(c.gradeRequired) || CFG.GRADE_REMARK) +
        ' ' + MUTED_ + '- ' + esc_(c.dept) + ', ' + esc_(signedText_(c.signature, c.at, c.method, c.role)) + '</span></li>'
      ).join('') + '</ul></div>';
  }

  const stages = h.stages.filter(s => s.status);
  if (stages.length) {
    out += '<div style="font-size:13px"><b>Steps III and IV</b><ul style="margin:6px 0;padding-left:18px">' +
      stages.map(s =>
        '<li>' + esc_(s.block) + ': <b>' + esc_(s.status) + '</b>' +
        (s.detail ? '<br>' + MUTED_ + esc_(s.detail) + '</span>' : '') +
        (s.signature ? ' ' + MUTED_ + '- ' + esc_(signedText_(s.signature, s.at, s.method)) + '</span>' : '') +
        (s.comments ? '<br>' + MUTED_ + esc_(s.comments) + '</span>' : '') + '</li>'
      ).join('') + '</ul></div>';
  }
  return out + '</div>';
}

function studentBlock_(sub) {
  return kv_([
    ['Student', sub.student_name + ' (' + sub.student_id + ')'],
    ['College / major', sub.college + ' / ' + sub.major + (sub.concentration ? ', ' + sub.concentration : '')],
    ['Class', sub.student_class],
    ['Earned credits', sub.credits_completed],
    ['Cumulative GPA (CGPA)', sub.gpa],
    ['Host university', sub.host_university + (sub.host_country ? ', ' + sub.host_country : '')],
    ['Semester(s) abroad', sub.host_semesters],
    // The student's own answers at intake; they decide whether these two Step III lines apply.
    ['Financial grant or scholarship', sub.has_scholarship + (isYes_(sub.has_scholarship) ?
      ' (Financial Grants and Scholarships signs)' : ' (Financial Grants and Scholarships: N/A)')],
    ['Externally sponsored', sub.has_sponsor + (isYes_(sub.has_sponsor) ?
      ' (Sponsorship Manager signs)' : ' (Sponsorship Manager: N/A)')],
    ['Reference', sub.submission_id],
    ['Amends form', sub.amends_id]
  ]);
}

/** For approvers: this is an amendment, and what it changes. '' for an original form. */
function amendNoteHtml_(sub) {
  const a = amendmentInfo_(sub);
  if (!a) return '';
  return '<div style="margin:0 0 16px;padding:10px 14px;background:#eef2fb;border-left:3px solid #2f4a8a;' +
    'border-radius:0 6px 6px 0;font-size:13px">' +
    '<b>Amendment ' + a.no + '</b> to form ' + esc_(a.amends) + '. Courses approved earlier are carried over ' +
    'with their original approval and do not need to be decided again.' +
    (a.added.length ? '<br>Added: <b>' + esc_(a.added.join(', ')) + '</b>' : '') +
    (a.removed.length ? '<br>Removed: <b>' + esc_(a.removed.join(', ')) + '</b>' : '') +
    '</div>';
}

function reminderPrefix_(isReminder) {
  return isReminder ? 'Reminder - ' : '';
}

// ---------------------------------------------------------------- students

function mailStudentPortal_(sub) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(sub.student_email, 'Your course permission form has started',
    hi_(sub) +
    '<p>Your course permission form for <b>' + esc_(sub.host_university) + '</b> has been created and ' +
    'sent to the Exchange Office for Step I, which checks the host university. You can start adding your courses now; ' +
    'they can be sent to heads of department once Step I is done.</p>' +
    '<p>Keep the link below - it is how you get back into your form.</p>' +
    button_(studentUrl_(sub), 'Open my form') +
    kv_([['Reference', sub.submission_id], ['Semester(s) abroad', sub.host_semesters]]));
}

function mailStudentStepOne_(sub, approved) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(sub.student_email,
    approved ? 'Step I approved - you can now send your courses' : 'Step I was not approved',
    hi_(sub) +
    (approved
      ? '<p>The Exchange Office has approved <b>' + esc_(sub.host_university) + '</b> in Step I. ' +
        'You can now send each course to the relevant head of department.</p>'
      : '<p>The Exchange Office could not approve <b>' + esc_(sub.host_university) + '</b> in Step I. ' +
        'Please contact the office for next steps.</p>') +
    kv_([
      ['Agreement', sub.s1_agreement],
      ['Comments', sub.s1_comments]
    ]) +
    button_(studentUrl_(sub), 'Open my form'),
    { cc: CFG.EXO_EMAIL });
}

/** One email per HoD submission, however many courses it decided. */
function mailStudentCourseDecisions_(sub, courses) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  const approved = courses.filter(c => c.status === CRS_STATUS.APPROVED);
  const declined = courses.filter(c => c.status === CRS_STATUS.DENIED);
  const tally = [
    approved.length ? approved.length + ' approved' : '',
    declined.length ? declined.length + ' not approved' : ''
  ].filter(Boolean).join(', ');

  sendMail_(sub.student_email,
    'Course decisions from ' + courses[0].dept_name + ': ' + tally,
    hi_(sub) +
    '<p><b>' + esc_(courses[0].dept_name) + '</b> has decided on ' +
    (courses.length === 1 ? 'the course below' : 'the ' + courses.length + ' courses below') + '.</p>' +
    courses.map(c => {
      const ok = c.status === CRS_STATUS.APPROVED;
      return '<div style="margin:14px 0;padding:12px 14px;border:1px solid #e6e1df;border-radius:8px">' +
        '<div style="font-weight:bold;margin-bottom:6px;color:' + (ok ? '#0f7b4f' : '#b3261e') + '">' +
        (ok ? 'Approved' : 'Not approved') + '</div>' +
        kv_([
          ['Host course', c.host_course_code + ' - ' + c.host_course_name],
          ['Home University equivalent', ok ? c.home_course_code + ' - ' + c.home_course_name : ''],
          ['Counts as', ok ? c.course_type + (c.ger_area ? ' (' + c.ger_area + ')' : '') : ''],
          ['Grade required', ok ? str_(c.grade_required) || CFG.GRADE_REMARK : ''],
          ['Prerequisites met', ok ? c.prereqs_met : ''],
          ['Comments', c.decision_comments]
        ]) + '</div>';
    }).join('') +
    kv_([['Reviewer', courses[0].decision_by]]) +
    (declined.length ? '<p>You can submit an alternative for each declined course from your form.</p>' : '') +
    button_(studentUrl_(sub), 'Open my form'),
    { cc: CFG.EXO_EMAIL });
}

function mailStudentStageDecision_(sub, stage, approved, comments) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(sub.student_email,
    stage.label + ': ' + (approved ? 'approved' : 'not approved'),
    hi_(sub) +
    '<p>' + esc_('Step ' + (stage.step || 'III')) + ' - <b>' + esc_(stage.label) + '</b> has ' +
    (approved ? 'approved' : 'declined') + ' your form.</p>' +
    kv_([['Reference', sub.submission_id], ['Comments', comments]]) +
    button_(studentUrl_(sub), 'Open my form'),
    { cc: CFG.EXO_EMAIL });
}

function mailStudentSign_(sub) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(sub.student_email, 'Final step - sign your course permission form',
    hi_(sub) +
    '<p>Every Step III approval before your signature is done. By signing, you agree to the conditions ' +
    'stated on the form. Once you sign, ' + esc_(afterSignatureText_()) + '</p>' +
    button_(studentUrl_(sub, 'sign'), 'Review and sign'),
    { cc: CFG.EXO_EMAIL });
}

/** The final signed PDF to the student, CC Exchange Office and Registrar. True when Gmail accepted it. */
function mailCompleted_(sub, pdfBlob) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  // The student, Exchange Office and the Registration Officer all get the signed PDF and every host syllabus.
  const pack = cpfPackage_(sub, [sub.student_email, CFG.EXO_EMAIL, CFG.REGISTRAR_EMAIL], pdfBlob);
  const no = Number(sub.amendment_no) || 0;
  return sendMail_(sub.student_email,
    'Completed' + (no ? ' (amendment ' + no + ')' : '') + ' - ' + sub.student_name + ' (' + sub.student_id + ')',
    '<p>The course permission form below is complete and fully approved.' +
    (no ? ' It is <b>amendment ' + no + '</b> and replaces form ' + esc_(sub.amends_id) + '; this is the approved course list from now on.' : '') + '</p>' +
    studentBlock_(sub) +
    pack.html +
    '<p>Reminder for the student (Step IV of the form): ' + esc_(CFG.STEP_IV_TEXT) + '</p>',
    {
      cc: [CFG.EXO_EMAIL, CFG.REGISTRAR_EMAIL].join(','),
      title: no ? 'Course permission form amendment completed' : 'Course permission form completed',
      attachments: pack.attachments
    });
}

/** The student started an amendment: its new reference and link. */
function mailAmendmentStarted_(child, parent, carried) {
  MAIL_SID_ = str_(child && child.submission_id);   // which form the Log tab files this email under
  sendMail_(child.student_email, 'Amendment started: ' + child.submission_id,
    hi_(child) +
    '<p>You have started <b>amendment ' + esc_(child.amendment_no) + '</b> to your course permission form ' +
    esc_(parent.submission_id) + ' for <b>' + esc_(child.host_university) + '</b>. ' +
    esc_(carried) + ' approved course(s) have been carried over with their original approval.</p>' +
    '<p>Add any new courses and send them for approval, or remove courses you no longer need. When every ' +
    'course has a decision, confirm the course list. Step III is not signed again (its signatures are copied ' +
    'from your earlier form): you sign the amendment, then the Office of the Registrar completes Step IV. ' +
    'Your earlier form stays valid until this one is fully signed.</p>' +
    button_(studentUrl_(child), 'Open my amendment') +
    kv_([['Reference', child.submission_id], ['Amends form', parent.submission_id]]),
    { cc: CFG.EXO_EMAIL });
}

/** The student reopened their course list during Step III: the approver it was waiting on can stand down. */
function mailStageWithdrawn_(sub, stage) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(stageEmail_(sub, stage),
    'No action needed for now - ' + sub.student_name + ' (' + sub.student_id + ')',
    '<p>The ' + esc_('Step ' + (stage.step || 'III')) + ' request for the <b>' + esc_(stage.label) + '</b> signature on form ' + esc_(sub.submission_id) +
    ' is on hold: the student is changing their course list. There is nothing for you to do now. You will get ' +
    'a new email when the form is ready for your signature again.</p>' +
    studentBlock_(sub),
    { cc: stageCc_(sub, stage) });
}

// ---------------------------------------------------------------- reviewers

function mailStepOne_(sub, isReminder) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(CFG.EXO_EMAIL,
    reminderPrefix_(isReminder) + 'Step I review: ' + sub.student_name + ' (' + sub.student_id + ')',
    '<p>A new course permission form needs Step I: confirming the host university is accredited, ' +
    'which agreement it falls under, whether it has the right accreditation for the major, ' +
    'and the student type and study abroad program type.</p>' +
    studentBlock_(sub) +
    '<p>No course can be sent to a head of department until this is done.</p>' +
    button_(stepOneUrl_(sub), 'Complete Step I'),
    { action: true });
}

/**
 * One email to a head of department covering several courses.
 * courses: the courses this email is about (just sent, or all pending for a reminder).
 * waiting: every course from this student currently pending with this HoD.
 */
function mailHod_(sub, courses, waiting, isReminder) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  const hod = courses[0].hod_email;
  const added = !isReminder && waiting.length > courses.length;
  const n = courses.length;
  const heading = isReminder ?
    'Reminder - ' + waiting.length + ' course(s) awaiting approval (' + sub.student_name + ')'
    : added ?
      n + ' more course(s) added for approval (' + sub.student_name + ')'
      : 'Course approval request: ' + n + ' course(s) (' + sub.student_name + ')';

  // To the head of department and, when set, the College/School Designate (either may sign);
  // the assistants are CC'd. Reminders use this same email, so they reach the same people.
  const pack = hodSyllabi_(courses, [hodRecipients_(hod, courses.concat(waiting)), assistantsOf_(courses.concat(waiting))]);
  sendMail_(hodRecipients_(hod, courses.concat(waiting)), heading,
    '<p>Dear Head of Department' + (designatesFor_(str_(hod).toLowerCase(), courses.concat(waiting)).length ?
      ' / College/School Designate' : '') + ',</p>' +
    '<p>' + esc_(sub.student_name) + ' (' + esc_(sub.student_id) + '), ' + esc_(sub.major) +
    ', is going on exchange to <b>' + esc_(sub.host_university) + '</b> in ' +
    esc_(sub.host_semesters) + ' and is asking to take ' +
    (n === 1 ? 'the course below' : 'the ' + n + ' courses below') +
    ' in place of Home University courses owned by your department.</p>' +
    '<table style="border-collapse:collapse;font-size:14px;margin:8px 0">' +
    '<tr><th style="text-align:left;padding:6px 14px 6px 0;color:#756d6a">Host course</th>' +
    '<th style="text-align:left;padding:6px 0;color:#756d6a">Credits</th></tr>' +
    courses.map(c => '<tr><td style="padding:4px 14px 4px 0"><b>' + esc_(c.host_course_code) + '</b> ' +
      esc_(c.host_course_name) +
      (str_(c.alt_course_code) ? '<br><span style="color:#756d6a">Suggested equivalent: ' + esc_(c.alt_course_code) +
        (str_(c.alt_course_name) && c.alt_course_name !== c.alt_course_code ? ' - ' + esc_(c.alt_course_name) : '') + '</span>' : '') +
      '</td><td style="padding:4px 0">' + esc_(hostCreditsText_(c)) + (c.host_mode ? ' · ' + esc_(c.host_mode) : '') + '</td></tr>').join('') +
    '</table>' +
    (waiting.length > n
      ? '<p>' + waiting.length + ' courses from this student are now waiting for you in total. All of them are on the same page.</p>'
      : '') +
    pack.html +
    '<p>On the review page you check each syllabus, enter the Home University equivalent course, what it counts as, ' +
    'the minimum grade, the Home University credits and whether the prerequisites are met, then approve or decline ' +
    'each course and sign once for all of them.</p>' +
    amendNoteHtml_(sub) +
    priorHtml_(sub) +
    button_(hodReviewUrl_(sub, hod), n === 1 && waiting.length === 1 ? 'Review this course' : 'Review the courses'),
    { cc: assistantsOf_(courses.concat(waiting)), attachments: pack.attachments });
}

/**
 * Host syllabi for the courses in a HoD email (Oct 2026), so the HoD can read them straight
 * from the email instead of only on the review page. Each file keeps its own type (Google
 * Docs come as PDF). Files are attached while they total at most CFG.MAX_ATTACH_MB (Gmail
 * refuses about 25 MB). A syllabus that does not fit is shared view-only with 'people' (in
 * test mode with CFG.TEST_REDIRECT only) and linked in the email instead; a syllabus that is a
 * web link rather than a Drive file is linked as it is.
 * Returns { attachments, html }. Never throws, so the email still goes if a file is missing.
 */
function hodSyllabi_(courses, people) {
  const pack = { attachments: [], html: '' };
  const viewers = CFG.TEST_REDIRECT ? [CFG.TEST_REDIRECT] : emailList_(people);
  const limit = CFG.MAX_ATTACH_MB * 1024 * 1024;
  const seen = {};
  const links = [];
  let attachedBytes = 0;
  let unreadable = 0;
  // Oct 2026: an entry with two host courses has two syllabi (host_syllabus2_url).
  const files = [];
  (courses || []).forEach(c => {
    const codes = courseList_(c.host_course_code);
    [c.host_syllabus_url, c.host_syllabus2_url].forEach((u, i) => {
      if (str_(u)) files.push({ c: c, url: str_(u), code: codes[i] || codes[0] || str_(c.host_course_code) || 'Course' });
    });
  });
  files.forEach(f => {
    const c = f.c, url = f.url, code = f.code;
    if (seen[url]) return;
    seen[url] = true;
    const id = driveIdFromUrl_(url);
    if (!id) { links.push({ code: code, url: url }); return; }
    try {
      const file = DriveApp.getFileById(id);
      const native = String(file.getMimeType()).indexOf('application/vnd.google-apps') === 0;
      const blob = file.getBlob();
      const size = blob.getBytes().length;
      if (attachedBytes + size <= limit) {
        const ext = native ? '.pdf' : ((String(file.getName()).match(/\.[A-Za-z0-9]{1,5}$/) || ['.pdf'])[0]);
        pack.attachments.push(blob.setName(code.replace(/[^A-Za-z0-9._-]+/g, '_') + ' syllabus' + ext));
        attachedBytes += size;
        return;
      }
      viewers.forEach(e => {
        try { file.addViewer(e); } catch (x) { console.warn('Could not share the syllabus with ' + e + ': ' + x); }
      });
      links.push({ code: code, url: file.getUrl() });
    } catch (e) {
      unreadable++;
      console.warn('Syllabus not attached for ' + c.course_row_id + ': ' + e);
    }
  });
  const n = pack.attachments.length;
  let html = '';
  if (n) html += '<p>Attached: ' + (n === 1 ? 'the host syllabus' : 'the ' + n + ' host syllabi') + '.</p>';
  if (links.length) {
    const one = links.length === 1;
    html += '<p>' + (n ? (one ? 'This syllabus is' : 'These syllabi are') + ' not attached (too large or a web link), so open ' + (one ? 'it' : 'them') + ' here:'
      : 'The ' + (one ? 'syllabus is' : 'syllabi are') + ' not attached (too large or a web link), so open ' + (one ? 'it' : 'them') + ' here:') + '</p>' +
      '<ul style="margin:4px 0 8px;padding-left:20px">' +
      links.map(l => '<li><a href="' + esc_(l.url) + '">' + esc_(l.code) + ' syllabus</a></li>').join('') + '</ul>';
  }
  if (unreadable) html += '<p>' + (unreadable === 1 ? 'One syllabus' : unreadable + ' syllabi') + ' could not be attached; please open ' + (unreadable === 1 ? 'it' : 'them') + ' on the review page.</p>';
  pack.html = html;
  return pack;
}

/** Every department assistant on these courses (one HoD can head several departments). */
function assistantsOf_(courses) {
  return emailList_(courses.map(c => c.assistant_email)).join(',');
}

function mailStage_(sub, stage, isReminder) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  // Step IV (Registration Officer, then Registrar): the CPF PDF and the host syllabi come with it.
  const pack = stage.step === 'IV' ? cpfPackage_(sub, [stageEmail_(sub, stage)]) : { attachments: [], html: '' };
  sendMail_(stageEmail_(sub, stage),
    reminderPrefix_(isReminder) + stageTitle_(stage) + ': ' + sub.student_name +
    ' (' + sub.student_id + ')',
    '<p>The course list below has been approved by every relevant head of department and now needs the ' +
    '<b>' + esc_(stage.block || stage.label) + '</b> line of the form (' + esc_('Step ' + (stage.step || 'III')) + ').</p>' +
    (stage.note ? '<p style="color:#756d6a;font-size:13px">' + esc_(stage.note) + '</p>' : '') +
    (stage.step === 'IV' ? '<p>' + esc_(CFG.STEP_IV_TEXT) + '</p>' : '') +
    amendNoteHtml_(sub) +
    studentBlock_(sub) +
    priorHtml_(sub) +
    pack.html +
    button_(stageUrl_(sub, stage.key), 'Review and sign'),
    { cc: stageCc_(sub, stage), attachments: pack.attachments, action: stage.key === 'EXO' });
}

/** One email to a faculty member, listing every course a head of department forwarded to them. */
function mailFaculty_(sub, courses, reviewing, isReminder) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  const fac = courses[0].faculty_email;
  const n = courses.length;
  sendMail_(fac,
    (isReminder ? 'Reminder - ' : '') + 'Faculty review requested: ' + n + ' course(s) (' + sub.student_name + ')',
    '<p>Dear colleague,</p>' +
    '<p>' + esc_(courses[0].dept_name) + ' has asked you to review ' +
    (n === 1 ? 'a course' : n + ' courses') + ' that ' + esc_(sub.student_name) + ' (' + esc_(sub.student_id) +
    ') wants to take at <b>' + esc_(sub.host_university) + '</b> in place of a Home University course you teach.</p>' +
    courses.map(c => '<div style="margin:12px 0;padding:10px 14px;border:1px solid #e6e1df;border-radius:8px">' +
      kv_([
        ['Host course', c.host_course_code + ' - ' + c.host_course_name],
        ['Credits at host', hostCreditsText_(c)],
          ['Taught', c.host_mode || '-'],
        ['Note from the head of department', c.forward_note]
      ]) + '</div>').join('') +
    (reviewing.length > n ? '<p>' + reviewing.length + ' courses from this student are waiting for your review in total.</p>' : '') +
    '<p>On the review page you open each syllabus, suggest the Home University equivalent, say how closely the courses match ' +
    '(a percentage and a short note on where they match), and recommend approving or declining. ' +
    'The head of department then makes the final decision.</p>' +
    button_(facultyReviewUrl_(sub, fac), n === 1 && reviewing.length === 1 ? 'Review this course' : 'Review the courses'));
}

/** Tells a head of department that a faculty review is back and waiting for their final decision. */
function mailHodFacultyReviewed_(sub, courses, waiting) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  const hod = courses[0].hod_email;
  const pack = hodSyllabi_(courses, [hodRecipients_(hod, courses.concat(waiting)), assistantsOf_(courses.concat(waiting))]);
  sendMail_(hodRecipients_(hod, courses.concat(waiting)),
    'Faculty review done: ' + courses.length + ' course(s) ready for your decision (' + sub.student_name + ')',
    '<p>Dear Head of Department,</p>' +
    '<p>The faculty review you asked for is back. Each course is waiting for your final decision, with the ' +
    'suggested Home University equivalent already filled in.</p>' +
    courses.map(c => '<div style="margin:12px 0;padding:10px 14px;border:1px solid #e6e1df;border-radius:8px">' +
      kv_([
        ['Host course', c.host_course_code + ' - ' + c.host_course_name],
        ['Reviewed by', c.faculty_signature + ' (' + c.faculty_email + ')'],
        ['Recommendation', c.faculty_recommendation],
        ['Match', c.faculty_match_pct + '%'],
        ['Where it matches', c.faculty_match_notes],
        ['Suggested Home University equivalent', c.home_course_code ? c.home_course_code + ' - ' + c.home_course_name : '']
      ]) + '</div>').join('') +
    (waiting.length > courses.length ? '<p>' + waiting.length + ' courses from this student are waiting for you in total.</p>' : '') +
    pack.html +
    button_(hodReviewUrl_(sub, hod), 'Make the final decision'),
    { cc: assistantsOf_(courses.concat(waiting)), attachments: pack.attachments });
}

// ---------------------------------------------------------------- urls
//
// Links carry no secret code: every page checks the signed-in institution account
// (requireAccess_ in Util.gs). Old links that still carry t= keep working.
// References are matched case-insensitively, so a hand-typed link still opens.
//
// WARNING: do not rename these query parameters to 'sid' or 'c'. Google's
// front end reserves both and answers any Apps Script web app URL carrying
// them with a 400 "Page Not Found" before the script ever runs. Verified
// against this deployment on 22 Sep 2026: ref, crs, t, st and page are fine.
// 'hod' and 'fac' (Sep 28) are used the same way; 'hod' was verified live.

function link_(params) {
  return webAppUrl_() + '?' + Object.keys(params).
    map(k => k + '=' + encodeURIComponent(params[k])).
    join('&');
}

function studentUrl_(sub, page) {
  const p = { ref: sub.submission_id };
  if (page) p.page = page;
  return link_(p);
}

function stepOneUrl_(sub) {
  return link_({ page: 'stepone', ref: sub.submission_id });
}

/** One review page per student + faculty member, listing the courses forwarded to them. */
function facultyReviewUrl_(sub, facultyEmail) {
  return link_({ page: 'faculty', ref: sub.submission_id, fac: str_(facultyEmail).toLowerCase() });
}

/** One review page per student + head of department, listing all their courses. */
function hodReviewUrl_(sub, hodEmail) {
  return link_({ page: 'review', ref: sub.submission_id, hod: str_(hodEmail).toLowerCase() });
}

function stageUrl_(sub, stageKey) {
  return link_({ page: 'stage', ref: sub.submission_id, st: stageKey });
}


/**
 * Tells Exchange Office that the head of department email a student typed is not the one saved on the
 * Departments tab. The course is HELD (the student cannot send it) until Exchange Office opens the link and
 * confirms (the course goes to the typed email) or declines (it goes to the saved head of
 * department); see exoHodDecision in Phase1_Courses.gs. The student is emailed the outcome.
 */
/** FYI to the Exchange Office: a student restarted Steps III and IV after a decline, and what they changed. */
function mailExoRestarted_(sub, before, info) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  const changed = before.has_scholarship !== sub.has_scholarship || before.has_sponsor !== sub.has_sponsor;
  sendMail_(CFG.EXO_EMAIL, 'Form restarted after a decline: ' + sub.student_name + ' (' + sub.student_id + ')',
    '<p>The form below was declined at <b>' + esc_(info.label) + '</b>' +
    (info.comments ? ' (' + esc_(info.comments) + ')' : '') + '. The student has restarted Steps III and IV; ' +
    'every Step III / IV signature is asked for again, starting with the advisor.</p>' +
    kv_([
      ['Financial grant or scholarship', before.has_scholarship + (changed && before.has_scholarship !== sub.has_scholarship ? ' -> ' + sub.has_scholarship : '')],
      ['Externally sponsored', before.has_sponsor + (changed && before.has_sponsor !== sub.has_sponsor ? ' -> ' + sub.has_sponsor : '')],
      ['Answers changed', changed ? 'Yes' : 'No']
    ]) +
    studentBlock_(sub) +
    '<p>You see these answers again at the Exchange Office signature in Step III.</p>',
    { title: 'Form restarted after a decline' });
}

/** The Exchange Office has decided on the head of department email the student typed: the course can be sent now. */
function mailStudentHodChecked_(sub, course, confirmed) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  sendMail_(sub.student_email, 'Head of department email checked: ' + course.host_course_code,
    hi_(sub) +
    '<p>The Exchange Office has checked the head of department email you entered for <b>' + esc_(course.host_course_code) +
    ' - ' + esc_(course.host_course_name) + '</b>.</p>' +
    '<p>' + (confirmed
      ? 'It was <b>confirmed</b>: the course will go to ' + esc_(course.hod_email) + '.'
      : 'It was <b>not confirmed</b>: the course will go to the head of department on file for ' +
        esc_(course.dept_name) + ', ' + esc_(course.hod_email) + '.') + '</p>' +
    '<p>You can now send the course for approval from your form.</p>' +
    button_(studentUrl_(sub), 'Open my form'));
}

function mailExoHodCheck_(sub, course, dept) {
  MAIL_SID_ = str_(sub && sub.submission_id);   // which form the Log tab files this email under
  try {
    sendMail_(CFG.EXO_EMAIL, 'Confirm head of department email: ' + dept.name + ' (' + sub.student_name + ')',
      '<p>A student entered a head of department email that does not match the one saved for the department.</p>' +
      '<p><b>Department:</b> ' + esc_(dept.name) + '<br>' +
      '<b>Saved head of department email:</b> ' + esc_(dept.hod_email) + '<br>' +
      '<b>Email the student entered:</b> ' + esc_(course.hod_email_entered) + '<br>' +
      '<b>Student:</b> ' + esc_(sub.student_name) + ' (' + esc_(sub.student_id) + ')<br>' +
      '<b>Course:</b> ' + esc_(course.host_course_code) + ' - ' + esc_(course.host_course_name) + '<br>' +
      '<b>Form:</b> ' + esc_(sub.submission_id) + '</p>' +
      '<p>Is the email the student entered the head of this department?<br>' +
      '<b>Confirm:</b> the course goes to the email the student entered, and that person can sign.<br>' +
      '<b>Decline:</b> the course goes to the saved head of department, who signs.<br>' +
      'The student cannot send the course until you decide.</p>' +
      '<p><a href="' + link_({ page: 'hodcheck', crs: course.course_row_id }) + '">Confirm or decline</a></p>' +
      '<p>If the head of department has changed for good, also update the hod_email on the Departments tab.</p>',
      { title: 'Check head of department email', action: true });
  } catch (e) {
    console.error('mailExoHodCheck_ failed: ' + e);
  }
}

/**
 * What the Step IV emails and the completed email carry (Oct 2026): the CPF PDF with every
 * signature so far (drawn ones included) and the host syllabus of each approved course.
 * Everything is attached while it totals at most CFG.MAX_ATTACH_MB. Above that, only the PDF is
 * attached and the syllabi are a link to the student's Drive folder (CPF Syllabi > semester >
 * student), shared view-only with 'people' (in test mode with CFG.TEST_REDIRECT only).
 * pdfBlob: the final PDF when there is one, otherwise it is built here.
 * Returns { attachments, html }. Never throws, so the email still goes if something fails.
 */
function cpfPackage_(sub, people, pdfBlob) {
  const pack = { attachments: [], html: '' };
  try {
    const pdf = pdfBlob || buildPdf_(sub, true);
    const syllabi = [];
    coursesFor_(sub.submission_id)
      .filter(c => c.status === CRS_STATUS.APPROVED && str_(c.host_syllabus_url))
      // Oct 2026: an entry with two host courses has two syllabi (host_syllabus2_url).
      .reduce((all, c) => all.concat([c.host_syllabus_url, c.host_syllabus2_url]
        .map((u, i) => ({ c: c, url: str_(u), code: courseList_(c.host_course_code)[i] || str_(c.host_course_code) }))
        .filter(f => f.url)), [])
      .forEach(f => {
        const c = f.c;
        const id = driveIdFromUrl_(f.url);
        if (!id) return;
        try {
          const name = (str_(f.code).replace(/[^A-Za-z0-9._-]+/g, '_') || 'course') + ' syllabus.pdf';
          syllabi.push(DriveApp.getFileById(id).getBlob().setName(name));
        } catch (e) {
          console.warn('Syllabus not found for ' + c.course_row_id + ': ' + e);
        }
      });
    const total = [pdf].concat(syllabi).reduce((n, b) => n + b.getBytes().length, 0);
    const what = syllabi.length + ' host ' + (syllabi.length === 1 ? 'syllabus' : 'syllabi');
    if (total <= CFG.MAX_ATTACH_MB * 1024 * 1024) {
      pack.attachments = [pdf].concat(syllabi);
      pack.html = '<p>Attached: the course permission form (PDF) and the ' + what + '.</p>';
    } else {
      pack.attachments = [pdf];
      const folder = subFolder_(sub);
      const viewers = CFG.TEST_REDIRECT ? [CFG.TEST_REDIRECT] : emailList_(people);
      viewers.forEach(e => {
        try { folder.addViewer(e); } catch (x) { console.warn('Could not share the syllabus folder with ' + e + ': ' + x); }
      });
      pack.html = '<p>The course permission form is attached as a PDF. The ' + what +
        ' are too large to attach together, so they are in this Drive folder: ' +
        '<a href="' + esc_(folder.getUrl()) + '">open the syllabus folder</a>.</p>';
    }
  } catch (e) {
    console.error('cpfPackage_ failed: ' + e);
    log_(sub.submission_id, 'system', 'ATTACHMENTS_FAILED', String(e));
  }
  return pack;
}
