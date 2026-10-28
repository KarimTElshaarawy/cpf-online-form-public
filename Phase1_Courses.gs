/*******************************************************************
 * Phase1_Courses.gs - Step II, the course approval loop, and
 * changing a form later.
 *
 * One row per course. The student enters only the host-university
 * side; the head of department fills in the Home University equivalent when they
 * review it. The student may add, edit, withdraw and replace courses
 * until every row is resolved, then passes the gate into Step III.
 *
 * Changing courses later, at any point:
 *   Step I / II   add, edit or withdraw courses directly.
 *   Step III      "Change my courses" (reopenCourses) takes the form
 *                 back to Step II; Step III then starts over.
 *   Completed     "Amend this form" (amendForm) starts a new version,
 *                 CPF-FA26-0001-A1, -A2 ... with every approved course
 *                 carried over. New courses go to their heads of
 *                 department, carried ones can be removed. Step III is
 *                 copied from the earlier form; the student signs and
 *                 Step IV runs again. The earlier form stays valid until the
 *                 amendment is completed. No limit on amendments.
 *******************************************************************/

/** Courses of one form in the order they were added. Grouped once per read of the tab. */
function coursesFor_(sid) {
  const t = table_(CFG.SHEETS.CRS);
  if (!t.bySub) {
    t.bySub = {};
    t.rows.forEach(c => {
      const k = String(c.submission_id);
      (t.bySub[k] = t.bySub[k] || []).push(c);
    });
  }
  return (t.bySub[String(sid)] || []).slice().sort((a, b) => Number(a.seq) - Number(b.seq));
}

/** Withdrawn and superseded rows are history only. */
function isLive_(c) {
  return c.status !== CRS_STATUS.WITHDRAWN && c.status !== CRS_STATUS.SUPERSEDED;
}

/**
 * The form behind a student link. Only the student acts on it; Exchange Office staff may
 * view it ('view') and send reminders for the student ('resend').
 */
function getSubmission_(sid, t, mode) {
  const sub = subOrThrow_(sid);
  requireAccess_(sub.student_email, { exo: mode === 'view' || mode === 'resend',
    token: { scope: 'student', id: sub.submission_id, t: t } });
  return sub;
}

function ownCourse_(sub, courseRowId) {
  const c = findRow_(CFG.SHEETS.CRS, 'course_row_id', courseRowId);
  if (!c || String(c.submission_id) !== String(sub.submission_id)) throw new Error('Course not found.');
  return c;
}

function assertEditable_(sub) {
  if (EDITABLE_STATUSES.indexOf(sub.status) > -1) return;
  if (sub.status === STATUS.COMPLETED) throw new Error('This form is complete. Use "Amend this form" to change your courses.');
  if (REOPENABLE_STATUSES.indexOf(sub.status) > -1) {
    throw new Error('Your course list is locked while Step III runs. Use "Change my courses" to open it again.');
  }
  throw new Error('This form is closed (' + String(sub.status).toLowerCase() + ') and can no longer be changed.');
}

function touch_(sub) {
  update_(CFG.SHEETS.SUB, sub, { updated_at: new Date() });
}

// ------------------------------------------------------------ versions

/** The original form of a chain of amendments (the form itself when it is the original). */
function rootOf_(sub) {
  return str_(sub.root_id) || String(sub.submission_id);
}

/** A completed form replaced by a completed amendment is no longer the valid version. */
function isSuperseded_(sub) {
  const child = sub.amended_by ? findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amended_by) : null;
  return !!child && child.status === STATUS.COMPLETED;
}

/** Whether the student may amend this form now, and why not. */
function canAmend_(sub) {
  if (sub.status !== STATUS.COMPLETED) return { ok: false, reason: 'Only a completed form can be amended.' };
  const child = sub.amended_by ? findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amended_by) : null;
  if (child && child.status === STATUS.COMPLETED) {
    return { ok: false, reason: 'This form has been replaced by ' + child.submission_id + '. Amend that one instead.' };
  }
  if (child && CLOSED_STATUSES.indexOf(child.status) === -1) {
    return { ok: false, reason: 'Amendment ' + child.submission_id + ' is already in progress. Continue with that one; you can add courses to it at any time.' };
  }
  return { ok: true, reason: '' };
}

/** For an amendment: its number, the form it changes and what it changes. null for an original form. */
function amendmentInfo_(sub, courses) {
  const no = Number(sub.amendment_no) || 0;
  if (!no) return null;
  const list = courses || coursesFor_(sub.submission_id);
  return {
    no: no,
    amends: str_(sub.amends_id),
    root: rootOf_(sub),
    added: list.filter(c => !c.carried_from && isLive_(c) && c.status !== CRS_STATUS.DENIED).map(c => str_(c.host_course_code)),
    removed: list.filter(c => c.carried_from && c.status === CRS_STATUS.WITHDRAWN).map(c => str_(c.host_course_code))
  };
}

/** What the student portal shows about earlier and later versions of this form. */
function versionInfo_(sub) {
  const parent = sub.amends_id ? findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amends_id) : null;
  const child = sub.amended_by ? findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amended_by) : null;
  const can = canAmend_(sub);
  return {
    amendmentNo: Number(sub.amendment_no) || 0,
    amends: str_(sub.amends_id),
    amendsUrl: parent ? studentUrl_(parent) : '',          // '' when the earlier form cannot be found
    child: child ? { id: child.submission_id, status: child.status, url: studentUrl_(child) } : null,
    canAmend: can.ok,
    amendReason: can.reason,
    canReopen: REOPENABLE_STATUSES.indexOf(sub.status) > -1
  };
}

/** Next amendment number of a chain. Numbers are never reused. */
function nextAmendmentNo_(root) {
  const key = 'AMEND_SEQ_' + root;
  let n = Number(prop_(key)) || 0;
  readAll_(CFG.SHEETS.SUB).forEach(s => {
    if (rootOf_(s) === root) n = Math.max(n, Number(s.amendment_no) || 0);
  });
  n++;
  setProp_(key, String(n));
  return n;
}

// ------------------------------------------------------------ history

/**
 * Everything an approver is entitled to see about what happened before
 * them: Step I, every course decision so far, and every Step III step.
 * Each signature is shown as "Signed by <name> on <date>" with its method
 * (drawn / typed); never an image, an image file id or an IP address
 * (IPs stay in the Sheet only, and plain_ strips them as a second guard).
 */
/**
 * How an Exchange Office signer is shown (PDF, pages, history): always CFG.EXO_SIGNER_DISPLAY
 * (exchange-office-signer.include-here@example.edu) once someone has signed, whichever Exchange Office staff member it was.
 * The Sheet and the Log keep the real signer.
 */
function exoSignerDisplay_(by) {
  return str_(by) ? (str_(CFG.EXO_SIGNER_DISPLAY) || str_(by)) : '';
}

function history_(sub) {
  const courses = coursesFor_(sub.submission_id);
  return {
    student: {
      name: sub.student_name, id: sub.student_id, email: sub.student_email,
      mobile: sub.student_mobile,
      college: sub.college, major: sub.major, concentration: sub.concentration,
      studentClass: sub.student_class, currentSemester: sub.current_semester,
      credits: sub.credits_completed, gpa: sub.gpa, expectedGraduation: sub.expected_graduation,
      hostUniversity: sub.host_university, hostCountry: sub.host_country,
      hostSemesters: sub.host_semesters,
      hostContactName: sub.host_contact_name, hostContactEmail: sub.host_contact_email,
      advisor: sub.advisor_name + (sub.advisor_email ? ' (' + sub.advisor_email + ')' : ''),
      scholarship: sub.has_scholarship, sponsored: sub.has_sponsor,
      reference: sub.submission_id, status: sub.status
    },
    amendment: amendmentInfo_(sub, courses),
    stepOne: {
      done: stepOneDone_(sub),
      accredited: sub.s1_accredited,
      agreement: sub.s1_agreement,
      majorAccreditation: majorAccreditationAnswer_(sub.s1_major_accreditation),   // Yes (...) / No / N/A
      programType: sub.s1_program_type,   // asked at the Exchange Office's Step III signature (older forms: at Step I)
      comments: sub.s1_comments,
      by: exoSignerDisplay_(sub.s1_by), at: fmt_(sub.s1_at), signature: sub.s1_signature,
      method: sigMethodLabel_(sub.s1_sig_method, sub.s1_signature)
    },
    courses: courses.map(c => ({
      seq: c.seq, status: c.status,
      hostCode: c.host_course_code, hostName: c.host_course_name, hostCredits: c.host_credits, hostCreditSystem: c.host_credit_system, hostMode: c.host_mode,
      homeCode: c.home_course_code, homeName: c.home_course_name, homeCredits: c.home_credits,
      courseType: c.course_type, gerArea: c.ger_area,
      gradeRequired: c.grade_required, prereqsMet: c.prereqs_met,
      dept: c.dept_name, by: c.decision_by, at: fmt_(c.decision_at),
      comments: c.decision_comments, signature: c.hod_signature,
      method: sigMethodLabel_(c.hod_sig_method, c.hod_signature),
      facultyMethod: sigMethodLabel_(c.faculty_sig_method, c.faculty_signature),
      role: hodRoleLabel_(c),
      syllabus: c.host_syllabus_url, syllabus2: c.host_syllabus2_url,
      altCode: c.alt_course_code, altName: c.alt_course_name,
      faculty: c.faculty_email, facultyRec: c.faculty_recommendation, matchPct: c.faculty_match_pct,
      matchNotes: c.faculty_match_notes, facultySignature: c.faculty_signature, facultyAt: fmt_(c.faculty_at),
      carried: !!c.carried_from, approvedIn: str_(c.approved_in)
    })),
    stages: STAGES.map(s => ({
      key: s.key, label: s.label,
      step: s.step || 'III', block: s.block || ('Signature of ' + s.label), note: s.note || '',
      // the Exchange Office's "Exchange Office use only" answer, shown with its signature as on the paper form
      detail: s.key === 'EXO' && str_(sub.s1_program_type) ?
        'Student type and Study Abroad Program type: ' + str_(sub.s1_program_type) : '',
      status: sub[s.key + '_status'],
      by: s.key === 'EXO' ? exoSignerDisplay_(sub[s.key + '_by']) : sub[s.key + '_by'], at: fmt_(sub[s.key + '_at']),
      comments: sub[s.key + '_comments'],
      signature: sub[s.key + '_signature'],
      method: sigMethodLabel_(sub[s.key + '_sig_method'], sub[s.key + '_signature']),
      current: sub.current_stage === s.key,
      afterSignature: !!s.afterSignature
    })),
    studentSignatureLabel: STUDENT_SIGNATURE_LABEL,
    studentSignature: sub.student_signature,
    studentMethod: sigMethodLabel_(sub.student_sig_method, sub.student_signature),
    signedAt: fmt_(sub.signed_at)
  };
}

/** Everything the student portal needs, in one round trip. */
function portal_(sub) {
  const gate = gateReady_(sub);
  return plain_({
    submission: sub,
    courses: coursesFor_(sub.submission_id),
    departments: getDepartments(),
    courseOptions: { modes: CFG.DELIVERY_MODES, creditSystems: CFG.CREDIT_SYSTEMS },
    history: history_(sub),
    version: versionInfo_(sub),
    stepOneDone: stepOneDone_(sub),
    creditProblem: creditsError_(sub.credits_completed) || gpaError_(sub.gpa, true),
    gateReady: gate.ok,
    gateReason: gate.reason,
    signUrl: studentUrl_(sub, 'sign'),
    restart: restartInfo_(sub)
  });
}

function getPortal(sid, t) {
  return portal_(getSubmission_(sid, t, 'view'));
}

// ------------------------------------------------------------ student edits

/**
 * Stops one host course being on a form twice. Codes are compared the way the
 * catalog compares them ("ELN-301" = "eln 301"). A declined row does not count:
 * the student may send the same course to a different department instead.
 */
function assertNewCourse_(sub, code, exceptRowId) {
  const key = courseKey_(code);
  if (!key) return;
  coursesFor_(sub.submission_id).forEach(c => {
    if (c.course_row_id === exceptRowId || courseKey_(c.host_course_code) !== key) return;
    if (c.carried_from && c.status === CRS_STATUS.WITHDRAWN) {
      throw new Error(c.host_course_code + ' was approved on your earlier form and you removed it from this one. ' +
        'Use "Put back" on it instead of adding it again.');
    }
    if (isLive_(c) && c.status !== CRS_STATUS.DENIED) {
      throw new Error(c.host_course_code + ' is already on this form (' + String(c.status).toLowerCase() + ').');
    }
  });
}

/**
 * Oct 2026: one course entry may hold one or two host courses that together match one Home University
 * course, typed comma-separated ("MAT201, MAT202" / "Calculus I, Calculus II").
 * courseList_ splits such a value into its parts.
 */
function courseList_(v) {
  return str_(v).split(',').map(s => tidyText_(s)).filter(Boolean);
}

/** How many syllabi a course needs: one per host course code (1 or 2). */
function syllabiNeeded_(c) {
  return Math.max(1, courseList_(c && c.host_course_code).length);
}

/** True when every host course of c has its syllabus (host_syllabus_url, and host_syllabus2_url for two). */
function hasSyllabi_(c) {
  return !!(c && c.host_syllabus_url) && (syllabiNeeded_(c) < 2 || !!c.host_syllabus2_url);
}

/**
 * Creates or updates one course row (host side only). Returns the row.
 * keepSyllabus is server-side only: the syllabus of a declined course that the
 * student is resubmitting, used when no new file is chosen.
 */
function saveCourse_(sub, course, keepSyllabus, keepSyllabus2) {
  assertEditable_(sub);
  const c = course || {};
  ['host_course_code', 'host_course_name', 'host_credits', 'dept_key', 'hod_email'].forEach(k => {
    if (!str_(c[k])) throw new Error('Please fill in: ' + k.replace(/_/g, ' '));
  });
  // Two host courses may match one Home University course: up to 2 codes and the same number of titles.
  const codes = courseList_(c.host_course_code).map(s => s.toUpperCase());
  const names = courseList_(c.host_course_name);
  if (codes.length > 2) throw new Error('Enter at most 2 host course codes, separated by a comma (for example MAT201, MAT202).');
  if (names.length !== codes.length) {
    throw new Error('Enter one course title for each course code, in the same order and separated by a comma ' +
      '(for example Calculus I, Calculus II). You entered ' + codes.length + ' code(s) and ' + names.length + ' title(s).');
  }
  // Suggested equivalent Home University course(s) from the student (alt_course_code / alt_course_name): required,
  // the student types None if not sure. The head of department still decides the Home University equivalent.
  if (!tidyText_(c.alt_course_code)) throw new Error('Please fill in the suggested equivalent Home University course code(s) (type None if you are not sure).');
  if (!tidyText_(c.alt_course_name)) throw new Error('Please fill in the suggested equivalent Home University course title(s) (type None if you are not sure).');
  const crsCol = table_(CFG.SHEETS.CRS).col;
  if (!('host_syllabus2_url' in crsCol) || !('alt_course_code' in crsCol) || !('alt_course_name' in crsCol)) {
    throw new Error('The course list needs an update first: the Exchange Office must run CPF menu > Set up / repair tabs. Please try again later.');
  }
  if (CFG.DELIVERY_MODES.indexOf(str_(c.host_mode)) === -1) {
    throw new Error('Please choose whether the host course is ' + CFG.DELIVERY_MODES.join(' or ').toLowerCase() + '.');
  }
  const creditSystem = tidyText_(c.host_credit_system);
  if (!creditSystem) throw new Error('Please choose the credit system of the host credits (' + CFG.CREDIT_SYSTEMS.join(', ') + ' or Other).');
  if (creditSystem.length > 40) throw new Error('Please keep the credit system name under 40 characters.');
  const dept = deptByKey_(c.dept_key);
  if (!dept) throw new Error('Unknown department.');
  // The student types the head of department's email; it is compared with the one saved on the
  // Departments tab. A match goes through as normal. A mismatch still saves as a draft, but it is
  // HELD (hod_email_check = MISMATCH): it cannot be sent until the Exchange Office confirms the typed email
  // (it then goes to that address) or declines it (it goes to the saved HoD). See exoHodDecision.
  const enteredHod = str_(c.hod_email).toLowerCase();
  if (!isEmail_(enteredHod)) throw new Error("Please enter a valid email address for the head of department.");
  if (!enteredHod.endsWith('@' + CFG.FACULTY_EMAIL_DOMAIN) || isStudentAccount_(enteredHod)) {
    throw new Error("Enter the head of department's @" + CFG.FACULTY_EMAIL_DOMAIN + " email, not a student account.");
  }
  const hodMatches = enteredHod === str_(dept.hod_email).toLowerCase();

  const existing = c.course_row_id ? ownCourse_(sub, c.course_row_id) : null;
  if (existing && existing.status === CRS_STATUS.FACULTY) {
    throw new Error('This course is with a faculty member for review and cannot be edited until it comes back.');
  }
  if (existing && existing.status !== CRS_STATUS.DRAFT && existing.status !== CRS_STATUS.PENDING) {
    throw new Error('A course that has already been decided cannot be edited. Add an alternative course instead.');
  }
  const code = codes.join(', ');
  assertNewCourse_(sub, code, existing ? existing.course_row_id : '');

  const all = coursesFor_(sub.submission_id);
  if (!existing && CFG.MAX_COURSES && all.filter(x => isLive_(x) && x.course_row_id !== c.replaces_row_id).length >= CFG.MAX_COURSES) {
    throw new Error('You have reached ' + CFG.MAX_COURSES + ' courses. Email ' + CFG.EXO_EMAIL + ' to add more.');
  }

  const now = new Date();
  const fields = {
    updated_at: now,
    host_course_code: code,
    host_course_name: names.join(', '),
    alt_course_code: tidyText_(c.alt_course_code).toUpperCase() === 'NONE' ? 'None' : tidyText_(c.alt_course_code).toUpperCase(),
    alt_course_name: tidyText_(c.alt_course_name).toUpperCase() === 'NONE' ? 'None' : tidyText_(c.alt_course_name),
    host_credits: tidyText_(c.host_credits),
    host_credit_system: creditSystem,
    host_mode: str_(c.host_mode),
    dept_key: dept.key, dept_name: dept.name,
    hod_email: dept.hod_email, assistant_email: dept.assistant_email,
    designate_email: dept.designate_email,
    hod_email_entered: enteredHod,
    hod_email_check: hodMatches ? 'MATCH' : 'MISMATCH'
  };
  // An Exchange Office decision is kept while the student keeps the same typed email AND the same department
  // (a confirmation is for one department's head only; changing the department asks the Exchange Office again).
  const decided = !hodMatches && existing && str_(existing.hod_email_entered).toLowerCase() === enteredHod &&
    str_(existing.dept_key) === str_(dept.key) &&
    (existing.hod_email_check === 'CONFIRMED' || existing.hod_email_check === 'DECLINED');
  if (decided) {
    fields.hod_email_check = existing.hod_email_check;
    if (existing.hod_email_check === 'CONFIRMED') {
      fields.hod_email = existing.hod_email;
      fields.assistant_email = existing.assistant_email;
      fields.designate_email = existing.designate_email;
    }
  }
  const notifyExo = !hodMatches && !decided && (!existing || existing.hod_email_check !== 'MISMATCH' ||
    str_(existing.hod_email_entered).toLowerCase() !== enteredHod || str_(existing.dept_key) !== str_(dept.key));
  if (c.host_syllabus) fields.host_syllabus_url = saveUpload_(sub, c.host_syllabus, 'Host syllabus');
  else if (keepSyllabus && !existing) fields.host_syllabus_url = keepSyllabus;
  // Second syllabus: only for an entry with two host courses (cleared if it now has one).
  if (codes.length < 2) fields.host_syllabus2_url = '';
  else if (c.host_syllabus2) fields.host_syllabus2_url = saveUpload_(sub, c.host_syllabus2, 'Host syllabus 2');
  else if (keepSyllabus2 && !existing) fields.host_syllabus2_url = keepSyllabus2;
  // Editing a course that is waiting for approval takes it back to draft, so the head of
  // department (possibly a different one, if the department changed) reviews the final version.
  // Any faculty review was of the old version, so it is cleared too.
  if (existing && existing.status === CRS_STATUS.PENDING) {
    Object.assign(fields, {
      status: CRS_STATUS.DRAFT, sent_at: '',
      faculty_email: '', forwarded_by: '', forwarded_at: '', forward_note: '',
      faculty_recommendation: '', faculty_match_pct: '', faculty_match_notes: '', faculty_signature: '', faculty_ip: '', faculty_at: '',
      faculty_sig_method: '', faculty_sig_file: ''   // an unreferenced drawn image is deleted by the daily cleanup
    });
  }

  touch_(sub);
  if (existing) {
    update_(CFG.SHEETS.CRS, existing, fields);
    log_(sub.submission_id, sub.student_email, 'COURSE_UPDATED', existing.course_row_id);
    if (notifyExo) mailExoHodCheck_(sub, Object.assign({}, existing, fields), dept);
    return existing;
  }
  const added = append_(CFG.SHEETS.CRS, Object.assign(fields, {
    course_row_id: uid_('C-'),
    submission_id: sub.submission_id,
    seq: all.length + 1,
    created_at: now,
    status: CRS_STATUS.DRAFT,
    replaces_row_id: c.replaces_row_id || ''
  }));
  log_(sub.submission_id, sub.student_email, 'COURSE_ADDED', added.course_row_id);
  if (notifyExo) mailExoHodCheck_(sub, added, dept);
  return added;
}

/** Lower-cased HoD email, the key courses are grouped by. */
function hodKey_(c) {
  return str_(c.hod_email).toLowerCase();
}

/** Every course from this student currently waiting on the given HoD. */
function pendingFor_(sub, hod) {
  return coursesFor_(sub.submission_id).
    filter(c => c.status === CRS_STATUS.PENDING && hodKey_(c) === hod);
}

/** Groups courses by head of department: { hodEmail: [courses] }. */
function byHod_(courses) {
  const groups = {};
  courses.forEach(c => { (groups[hodKey_(c)] = groups[hodKey_(c)] || []).push(c); });
  return groups;
}

/**
 * Sends draft courses for approval: every course is marked pending, then
 * each head of department gets ONE email covering all of their courses.
 * Returns the number of courses sent.
 */
function sendCourses_(sub, courses) {
  assertEditable_(sub);
  if (!stepOneDone_(sub)) {
    throw new Error('The Exchange Office has not completed Step I yet. You can keep adding courses, ' +
      'but they cannot go to a head of department until the host university is approved.');
  }
  courses.forEach(c => {
    if (c.status !== CRS_STATUS.DRAFT) throw new Error(c.host_course_code + ' has already been sent.');
    if (!hasSyllabi_(c)) {
      throw new Error('Attach the host university ' + (syllabiNeeded_(c) > 1 ? 'syllabus of each course (2 PDFs)' : 'syllabus') + ' for ' + c.host_course_code + ' first.');
    }
    if (c.hod_email_check === 'MISMATCH') {
      throw new Error('The Exchange Office is checking the head of department email you entered for ' + c.host_course_code +
        '. You can send it once the Exchange Office has confirmed or declined it.');
    }
  });

  const now = new Date();
  courses.forEach(c => update_(CFG.SHEETS.CRS, c, { status: CRS_STATUS.PENDING, sent_at: now, updated_at: now }));

  const groups = byHod_(courses);
  Object.keys(groups).forEach(hod => {
    mailHod_(sub, groups[hod], pendingFor_(sub, hod), false);
    log_(sub.submission_id, sub.student_email, 'COURSES_SENT',
      { to: hod, courses: groups[hod].map(c => c.course_row_id) });
  });
  return courses.length;
}

/**
 * "Save and send" checks the send would work BEFORE saving anything. Otherwise a
 * failed send leaves the course saved (and a replaced course already SUPERSEDED)
 * behind an error message, and pressing the button again fails for a new reason.
 */
function assertCanSend_(sub, hasSyllabus) {
  if (!stepOneDone_(sub)) {
    throw new Error('The Exchange Office has not completed Step I yet. Use "Save course" for now; ' +
      'you can send it once the host university is approved.');
  }
  if (!hasSyllabus) throw new Error('Attach the host university syllabus (PDF), one for each host course, before sending, or use "Save course" for now.');
}

/** Save, and optionally send straight away, in one round trip. */
function saveCourse(sid, t, c, andSend) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    if (andSend) {
      const existing = c && c.course_row_id ? ownCourse_(sub, c.course_row_id) : null;
      assertCanSend_(sub, hasSyllabi_({
        host_course_code: c && c.host_course_code,
        host_syllabus_url: (c && c.host_syllabus) || (existing && existing.host_syllabus_url),
        host_syllabus2_url: (c && c.host_syllabus2) || (existing && existing.host_syllabus2_url)
      }));
    }
    // replaces_row_id is set by saveAlternative only, never by the browser.
    const row = saveCourse_(sub, Object.assign({}, c, { replaces_row_id: '' }));
    // A course whose typed HoD email the Exchange Office must check first is saved but not sent (sendCourses_
    // would throw AFTER the save, leaving the student with a saved course behind an error).
    const held = row.hod_email_check === 'MISMATCH';
    if (andSend && row.status === CRS_STATUS.DRAFT && !held) sendCourses_(sub, [row]);
    const portal = portal_(sub);
    portal.held = !!(andSend && held);
    return portal;
  });
}

/**
 * Adds a course in place of a declined one; the declined row becomes SUPERSEDED.
 * The new course may be the same one again (fixed and resubmitted) or a different
 * one. When it is the same course and no new file is chosen, the earlier syllabus
 * is kept.
 */
function saveAlternative(sid, t, deniedRowId, c, andSend) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    const old = ownCourse_(sub, deniedRowId);
    if (old.status !== CRS_STATUS.DENIED) throw new Error('Only a declined course can be replaced.');

    const same = courseKey_(c && c.host_course_code) === courseKey_(old.host_course_code);
    if (andSend) {
      assertCanSend_(sub, hasSyllabi_({
        host_course_code: c && c.host_course_code,
        host_syllabus_url: (c && c.host_syllabus) || (same && old.host_syllabus_url),
        host_syllabus2_url: (c && c.host_syllabus2) || (same && old.host_syllabus2_url)
      }));
    }
    const row = saveCourse_(sub, Object.assign({}, c, { course_row_id: '', replaces_row_id: deniedRowId }),
      same ? str_(old.host_syllabus_url) : '', same ? str_(old.host_syllabus2_url) : '');
    update_(CFG.SHEETS.CRS, old, { status: CRS_STATUS.SUPERSEDED, updated_at: new Date() });
    // Held for the Exchange Office's HoD email check: saved, sent later (same reason as in saveCourse).
    const held = row.hod_email_check === 'MISMATCH';
    if (andSend && !held) sendCourses_(sub, [row]);
    const portal = portal_(sub);
    portal.held = !!(andSend && held);
    return portal;
  });
}

function sendCourse(sid, t, courseRowId) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    sendCourses_(sub, [ownCourse_(sub, courseRowId)]);
    return portal_(sub);
  });
}

/**
 * Sends every draft that has a syllabus, all at once: one email per head
 * of department, all departments in parallel. Drafts without a syllabus stay.
 */
function sendAllDrafts(sid, t) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    const drafts = coursesFor_(sub.submission_id).filter(c => c.status === CRS_STATUS.DRAFT);
    const held = drafts.filter(c => c.hod_email_check === 'MISMATCH');
    const noSyllabus = drafts.filter(c => !hasSyllabi_(c) && c.hod_email_check !== 'MISMATCH');
    const ready = drafts.filter(c => hasSyllabi_(c) && c.hod_email_check !== 'MISMATCH');
    if (!ready.length) {
      if (!drafts.length) throw new Error('There are no draft courses to send.');
      if (!noSyllabus.length) {
        throw new Error('The Exchange Office is still checking the head of department email you entered for ' +
          held.map(c => c.host_course_code).join(', ') + '. You can send once the Exchange Office has confirmed or declined it.');
      }
      throw new Error('Attach a syllabus to your draft courses first.');
    }
    sendCourses_(sub, ready);
    const portal = portal_(sub);
    portal.sent = ready.length;
    portal.skipped = drafts.length - ready.length;
    portal.held = held.length;          // waiting for the Exchange Office's HoD email check
    portal.noSyllabus = noSyllabus.length;
    portal.hods = Object.keys(byHod_(ready)).length;
    return portal;
  });
}

/**
 * Withdraws a course that has no decision yet, or, on an amendment, removes a
 * course carried over from the earlier form (it can be put back until Step III).
 */
function withdrawCourse(sid, t, courseRowId) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    assertEditable_(sub);
    const c = ownCourse_(sub, courseRowId);
    const carried = !!c.carried_from && c.status === CRS_STATUS.APPROVED;
    if (!carried && [CRS_STATUS.DRAFT, CRS_STATUS.PENDING, CRS_STATUS.FACULTY, CRS_STATUS.DENIED].indexOf(c.status) === -1) {
      throw new Error('Only a course that is not yet approved can be withdrawn.');
    }
    update_(CFG.SHEETS.CRS, c, { status: CRS_STATUS.WITHDRAWN, updated_at: new Date() });
    touch_(sub);
    log_(sub.submission_id, sub.student_email, carried ? 'COURSE_REMOVED' : 'COURSE_WITHDRAWN', c.course_row_id);
    return portal_(sub);
  });
}

/** Puts back a carried-over course the student removed from an amendment. */
function restoreCourse(sid, t, courseRowId) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    assertEditable_(sub);
    const c = ownCourse_(sub, courseRowId);
    if (!c.carried_from || c.status !== CRS_STATUS.WITHDRAWN) {
      throw new Error('Only a course carried over from your earlier form can be put back.');
    }
    update_(CFG.SHEETS.CRS, c, { status: CRS_STATUS.APPROVED, updated_at: new Date() });
    touch_(sub);
    log_(sub.submission_id, sub.student_email, 'COURSE_RESTORED', c.course_row_id);
    return portal_(sub);
  });
}

// ------------------------------------------------- head of department review

/**
 * Resolves a review link to a student + head of department. Two link shapes:
 *   ref + hod   the batch link (current)
 *   crs         a single-course link from before batching; opens the same batch
 * q = { ref, hod, crs, t }
 */
function reviewScope_(q, mode) {
  q = q || {};
  const link = q.crs ? legacyCourseLink_(q) : { ref: refKey_(q.ref), hod: str_(q.hod).toLowerCase() };
  const student = subOrThrow_(link.ref);
  const courses = coursesFor_(student.submission_id).filter(c => isLive_(c) && hodKey_(c) === link.hod);
  // ONLY the head of department, or the department's College/School Designate (optional
  // designate_email on the Departments tab), opens and signs; Exchange Office staff may view. The department assistants
  // (assistant_email) may also open and sign, recorded with hod_role 'Assistant'.
  const designates = designatesFor_(link.hod, courses);
  const assistants = emailList_(courses.map(c => c.assistant_email).concat(
    readAll_(CFG.SHEETS.DEPT).filter(d => str_(d.hod_email).toLowerCase() === link.hod).map(d => d.assistant_email)));
  const signers = [link.hod].concat(designates, assistants);
  requireAccess_(signers, { exo: mode === 'view',
    token: q.crs ? null : { scope: 'hod:' + link.hod, id: student.submission_id, t: q.t } });
  requireCourses_(courses, mode);
  return { sub: student, hod: link.hod, designates: designates, assistants: assistants, courses };
}

/**
 * The College/School Designate(s) who may sign instead of this head of department: the
 * designate_email on these course rows and on the Departments rows of this HoD. [] when
 * none is set (older rows: the column is empty, so only the HoD signs, as before).
 */
function designatesFor_(hod, courses) {
  return emailList_((courses || []).map(c => c.designate_email).concat(
    readAll_(CFG.SHEETS.DEPT).filter(d => str_(d.hod_email).toLowerCase() === hod).map(d => d.designate_email)))
    .filter((e, i, all) => e !== hod && all.indexOf(e) === i);
}

/** Who received a batch email: the head of department plus any designate, comma separated. */
function hodRecipients_(hod, courses) {
  return [str_(hod).toLowerCase()].concat(designatesFor_(str_(hod).toLowerCase(), courses)).join(',');
}

/** How a course approval was signed, for pages, emails and the PDF ('' before anyone signed). */
function hodRoleLabel_(c) {
  if (!str_(c.hod_signature)) return '';
  return c.hod_role === 'Designate' ? 'College/School Designate' : (c.hod_role === 'Assistant' ? 'Department Assistant' : 'Head of Department');
}

/**
 * The hod= and fac= values come from the URL, so anyone can put their own address
 * there. Without this check any institution account could open any student's form (and its
 * history) by naming itself. A reviewer only gets in when the form really has a
 * course for them; Exchange Office staff may still view any form.
 */
function requireCourses_(courses, mode) {
  if (courses.length || SELF_TEST_) return;
  if (mode === 'view' && isExoStaff_(currentUser_())) return;
  throw new Error('There are no courses for you to review on this form. If you think this is wrong, contact ' +
    CFG.EXO_EMAIL + '.');
}

/** A pre-batching crs link: checks its token, returns the submission + HoD it points at. */
function legacyCourseLink_(q) {
  if (!SELF_TEST_ && !currentUser_()) checkToken_('course', q.crs, q.t);
  const c = findRow_(CFG.SHEETS.CRS, 'course_row_id', q.crs);
  if (!c) throw new Error('Course not found.');
  return { ref: c.submission_id, hod: hodKey_(c) };
}

function review_(scope) {
  return plain_({
    submission: scope.sub,
    history: history_(scope.sub),
    hod: scope.hod,
    pending: scope.courses.filter(c => c.status === CRS_STATUS.PENDING),
    withFaculty: scope.courses.filter(c => c.status === CRS_STATUS.FACULTY),
    decided: scope.courses.filter(c => c.status === CRS_STATUS.APPROVED || c.status === CRS_STATUS.DENIED),
    courseTypes: CFG.COURSE_TYPES,
    gerAreas: CFG.GER_AREAS
  });
}

function getReview(q) {
  return review_(reviewScope_(q, 'view'));
}

// grade_required is filled in by the head of department too (prefilled with C). Since Oct 15, 2026
// it is required on an approval, so the final PDF never has a blank minimum grade.
const HOME_SIDE_FIELDS = ['home_course_code', 'home_course_name', 'home_credits', 'course_type'];

/** Checks one course decision; returns the patch to write (the signature cells are added later). */
function coursePatch_(d, who, signature, now) {
  const approve = d.decision === 'APPROVE';
  const code = d.host_course_code ? ' for ' + d.host_course_code : '';
  const patch = {
    status: approve ? CRS_STATUS.APPROVED : CRS_STATUS.DENIED,
    decision_by: who, decision_at: now,
    decision_comments: str_(d.comments),
    hod_signature: signature,
    hod_ip: ipNow_(),
    updated_at: now
  };
  if (!approve) {
    declineReason_(d.comments, 'Please give the student a reason for declining' + code + '.');
    return patch;
  }
  if (!tidyText_(d.grade_required)) throw new Error('Please fill in the minimum grade required' + code + '.');
  return Object.assign(patch, homeSide_(d, code));
}

/** The Home University-equivalent fields (HoD approval or a faculty recommendation), checked. */
function homeSide_(d, code) {
  HOME_SIDE_FIELDS.forEach(k => {
    if (!str_(d[k])) throw new Error('Please fill in ' + k.replace(/home_/, 'Home University ').replace(/_/g, ' ') + code + '.');
  });
  if (CFG.COURSE_TYPES.indexOf(d.course_type) === -1) throw new Error('Please choose what the course counts as' + code + '.');
  const isGer = isGer_(d.course_type);
  if (isGer && CFG.GER_AREAS.indexOf(d.ger_area) === -1) throw new Error('Please choose the GER program area' + code + '.');
  const isOther = isOther_(d.course_type);
  if (isOther && !tidyText_(d.other_type)) throw new Error('Please type what the course counts as' + code + '.');
  if (!d.prereqs_met) throw new Error('Please state whether the prerequisites are met' + code + '.');
  return {
    home_course_code: tidyText_(d.home_course_code).toUpperCase(),
    home_course_name: tidyText_(d.home_course_name),
    home_credits: tidyText_(d.home_credits),
    course_type: d.course_type,
    ger_area: isGer ? d.ger_area : (isOther ? tidyText_(d.other_type) : ''),
    grade_required: tidyText_(d.grade_required),
    prereqs_met: isYes_(d.prereqs_met) ? 'Yes' : 'No'
  };
}

/**
 * The HoD decides any number of their pending courses with one signature.
 * items: [{ course_row_id, decision: 'APPROVE' | 'DENY' | 'FORWARD' | '',
 *           home_course_code, ... comments, faculty_email, forward_note }]
 * A blank decision leaves that course pending; FORWARD sends it to a faculty
 * member for review (Faculty.gs). Everything is validated before anything is
 * written, so a mistake on one course saves nothing.
 */
function decideCourses(q, items, signature, clientIp) {
  noteIp_(clientIp);
  const input = signatureInput_(signature, 'Please type your full name to sign.');
  const sig = input.name;
  const chosen = (items || []).filter(d => d && d.decision);
  if (!chosen.length) throw new Error('Choose a decision for at least one course.');
  chosen.forEach(d => { if (d.decision !== 'FORWARD') decision_(d.decision); });

  return withLock_(() => {
    const scope = reviewScope_(q);
    refuseOwnForm_(scope.sub);
    const now = new Date();
    const who = currentUser_() || scope.hod;

    const work = chosen.map(d => {
      const c = scope.courses.find(x => x.course_row_id === d.course_row_id);
      if (!c) throw new Error('A course on this page no longer belongs to this review. Please reload.');
      if (c.status !== CRS_STATUS.PENDING) {
        throw new Error(c.host_course_code + ' is no longer waiting for a decision (decided, edited or withdrawn). Please reload.');
      }
      const one = Object.assign({}, d, { host_course_code: c.host_course_code });
      return { c, patch: d.decision === 'FORWARD' ? forwardPatch_(one, who, now) : coursePatch_(one, who, sig, now) };
    });

    // One signature covers the batch: a drawn one is saved once and every decided course points at it.
    // The role records whether the head of department or the College/School Designate signed.
    const decided = work.filter(w => w.patch.status !== CRS_STATUS.FACULTY);
    if (decided.length) {
      const me = currentUser_();
      const role = me && me !== scope.hod && scope.designates.indexOf(me) > -1 ? 'Designate' : (scope.assistants.indexOf(me) > -1 ? 'Assistant' : 'HoD');
      const sigCells = Object.assign({ hod_role: role },
        signaturePatch_(CFG.SHEETS.CRS, scope.sub.submission_id, 'hod', input));
      decided.forEach(w => Object.assign(w.patch, sigCells));
    }

    work.forEach(w => {
      update_(CFG.SHEETS.CRS, w.c, w.patch);
      const action = { [CRS_STATUS.APPROVED]: 'COURSE_APPROVE', [CRS_STATUS.DENIED]: 'COURSE_DENY',
        [CRS_STATUS.FACULTY]: 'COURSE_FORWARDED' }[w.patch.status];
      log_(scope.sub.submission_id, who, action,
        w.patch.status === CRS_STATUS.FACULTY ? { course: w.c.course_row_id, to: w.patch.faculty_email } : w.c.course_row_id);
    });

    const done = work.filter(w => w.patch.status !== CRS_STATUS.FACULTY).map(w => w.c);
    const approved = done.filter(c => c.status === CRS_STATUS.APPROVED);
    const forwarded = work.filter(w => w.patch.status === CRS_STATUS.FACULTY).map(w => w.c);
    if (approved.length) catalogAdd_(scope.sub, approved);
    if (done.length) mailStudentCourseDecisions_(scope.sub, done);
    if (forwarded.length) notifyFaculty_(scope.sub, forwarded);

    const result = review_(scope);
    result.saved = work.length;
    return result;
  });
}

// ------------------------------------------------------------------- gate

function gateReady_(sub) {
  if (!stepOneDone_(sub)) return { ok: false, reason: 'The Exchange Office has not completed Step I yet.' };
  // Hard block, checked again here so "Change my courses", amendments and forms
  // started before the rule (or edited in the Sheet) cannot reach Step III below the minimum.
  const creditProblem = creditsError_(sub.credits_completed) || gpaError_(sub.gpa, true);
  if (creditProblem) return { ok: false, reason: creditProblem };

  const courses = coursesFor_(sub.submission_id);
  const count = { approved: 0, open: 0, denied: 0 };
  courses.filter(isLive_).forEach(c => {
    if (c.status === CRS_STATUS.APPROVED) count.approved++;
    else if (c.status === CRS_STATUS.DENIED) count.denied++;
    else count.open++;
  });

  if (!count.approved) return { ok: false, reason: 'You need at least one approved course.' };
  if (count.open) return { ok: false, reason: count.open + ' course(s) still need to be sent or decided.' };
  if (count.denied) return { ok: false, reason: count.denied + ' declined course(s) still need to be replaced or withdrawn.' };
  const a = amendmentInfo_(sub, courses);
  if (a && !a.added.length && !a.removed.length) {
    return { ok: false, reason: 'This amendment has no changes yet. Add a course, or remove one you no longer need.' };
  }
  return { ok: true, reason: '' };
}

/** "I'm satisfied - proceed to Step III". Locks Step II and starts the chain. */
function confirmGate(sid, t) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    assertEditable_(sub);
    const gate = gateReady_(sub);
    if (!gate.ok) throw new Error(gate.reason);
    const now = new Date();
    log_(sub.submission_id, sub.student_email, 'GATE_CONFIRMED', '');
    advanceChain_(sub, { status: STATUS.GATED, gate_confirmed_at: now, updated_at: now });
    return portal_(sub);
  });
}

// ------------------------------------------------- changing courses later

/**
 * "Change my courses" during Step III: takes the form back to Step II so courses
 * can be added or removed. Every Step III signature collected so far is cleared
 * (the list they signed is changing) and asked for again when the student moves
 * on; the approver it was waiting on is told that nothing is needed for now.
 */
function reopenCourses(sid, t) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    if (REOPENABLE_STATUSES.indexOf(sub.status) === -1) {
      if (sub.status === STATUS.COMPLETED) throw new Error('This form is complete. Use "Amend this form" to change it.');
      if (EDITABLE_STATUSES.indexOf(sub.status) > -1) throw new Error('Your course list is already open for changes.');
      throw new Error('This form is closed and can no longer be changed.');
    }
    const waitingOn = sub.status === STATUS.GATED ? stageByKey_(sub.current_stage) : null;
    const cleared = STAGES.filter(s => sub[s.key + '_status'] && sub[s.key + '_status'] !== 'N/A').map(s => s.key);
    const now = new Date();
    const patch = {
      status: STATUS.COURSES, current_stage: '', gate_confirmed_at: '',
      student_signature: '', student_ip: '', signed_at: '',
      reopened_at: now, updated_at: now, reminded_at: now
    };
    STAGES.forEach(s => ['_status', '_by', '_at', '_comments', '_signature', '_ip', '_sig_method', '_sig_file']
      .forEach(f => { patch[s.key + f] = ''; }));
    patch.student_sig_method = '';
    patch.student_sig_file = '';
    // The cleared signatures' drawn images are deleted now (they will never be used).
    const prefixes = STAGES.map(s => s.key).concat(['student']);
    const images = storedSignatureSlots_(sub).filter(s => s.sheet === CFG.SHEETS.SUB && prefixes.indexOf(s.prefix) > -1)
      .map(s => str_(sub[s.prefix + '_sig_file']));
    update_(CFG.SHEETS.SUB, sub, patch);
    images.forEach(id => deleteSignatureFile_(id));   // one that fails is unreferenced now: the daily cleanup retries it
    log_(sub.submission_id, sub.student_email, 'REOPENED', { signaturesCleared: cleared, drawnImagesDeleted: images.length });
    if (waitingOn) mailStageWithdrawn_(sub, waitingOn);
    return portal_(sub);
  });
}

// ------------------------------------------- restart after a Step III / IV decline

/** The Step III / IV stage that declined this form, or null (Step I declines and other forms: null). */
function declinedStage_(sub) {
  if (sub.status !== STATUS.DENIED || !stepOneDone_(sub)) return null;
  return STAGES.find(s => sub[s.key + '_status'] === 'DENIED') || null;
}

/**
 * Whether the student may correct their answers and run Steps III and IV again after a decline.
 * Only for a decline in Step III / IV (a Step I decline is about the host university and stays final),
 * and for an amendment only while it is still the form's latest amendment.
 */
function restartInfo_(sub) {
  const stage = declinedStage_(sub);
  if (!stage) return { ok: false };
  if (sub.amends_id) {
    const parent = findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amends_id);
    if (parent && str_(parent.amended_by) !== String(sub.submission_id)) {
      return { ok: false, reason: 'A newer amendment of form ' + sub.amends_id + ' exists. Continue with that one.' };
    }
  }
  return { ok: true, stage: stage.key, label: stage.block || stage.label, comments: str_(sub[stage.key + '_comments']) };
}

/** The cleared Step III / IV cells (status, signatures, student signature) and the drawn images to delete. */
function stepThreeReset_(sub) {
  const patch = { current_stage: '', gate_confirmed_at: '', student_signature: '', student_ip: '', signed_at: '',
    student_sig_method: '', student_sig_file: '' };
  STAGES.forEach(s => ['_status', '_by', '_at', '_comments', '_signature', '_ip', '_sig_method', '_sig_file']
    .forEach(f => { patch[s.key + f] = ''; }));
  const prefixes = STAGES.map(s => s.key).concat(['student']);
  const images = storedSignatureSlots_(sub).filter(s => s.sheet === CFG.SHEETS.SUB && prefixes.indexOf(s.prefix) > -1)
    .map(s => str_(sub[s.prefix + '_sig_file']));
  return { patch: patch, images: images };
}

/**
 * After a Step III / IV decline (for example the Sponsorship Manager declines because the student is
 * not actually sponsored), the student corrects their funding answers and the form runs Steps III and IV
 * again from the first signature (the advisor). Every Step III / IV signature is asked for again; Step I
 * and the approved courses stay. a = { has_scholarship, has_sponsor, changeCourses }: with changeCourses
 * the form goes back to Step II first (as "Change my courses"), otherwise Step III starts straight away.
 * The Exchange Office is emailed what changed. The decline stays in the Log.
 */
function restartAfterDecline(sid, t, a) {
  a = a || {};
  ['has_scholarship', 'has_sponsor'].forEach(k => {
    if (!/^(yes|no)$/i.test(str_(a[k]))) throw new Error('Please answer Yes or No: ' + (k === 'has_scholarship' ? 'Home University financial grant or scholarship' : 'external sponsor') + '.');
  });
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    const info = restartInfo_(sub);
    if (!info.ok) throw new Error(info.reason || 'Only a form declined in Step III or IV can be restarted.');
    const creditProblem = creditsError_(sub.credits_completed) || gpaError_(sub.gpa, true);
    if (creditProblem) throw new Error(creditProblem);
    // No second live form for the same trip (the student may have started a fresh one after the decline).
    const clash = tripClash_(str_(sub.student_id).toLowerCase(), sub.host_university, sub.host_semesters);
    if (clash && rootOf_(clash) !== rootOf_(sub)) {
      throw new Error('You already have form ' + clash.submission_id + ' for this university and semester. Continue with that one.');
    }
    const before = { has_scholarship: sub.has_scholarship, has_sponsor: sub.has_sponsor };
    const reset = stepThreeReset_(sub);
    const now = new Date();
    const patch = Object.assign(reset.patch, {
      has_scholarship: isYes_(a.has_scholarship) ? 'Yes' : 'No',
      has_sponsor: isYes_(a.has_sponsor) ? 'Yes' : 'No',
      reopened_at: now, updated_at: now, reminded_at: now
    });
    log_(sub.submission_id, sub.student_email, 'RESTARTED_AFTER_DECLINE',
      { declinedAt: info.stage, before: before, after: { has_scholarship: patch.has_scholarship, has_sponsor: patch.has_sponsor },
        changeCourses: !!a.changeCourses });
    if (a.changeCourses) {
      update_(CFG.SHEETS.SUB, sub, Object.assign(patch, { status: STATUS.COURSES }));
    } else {
      // Same checks as the gate: Step I done, courses resolved, at least one approved.
      Object.assign(sub, { has_scholarship: patch.has_scholarship, has_sponsor: patch.has_sponsor });
      const gate = gateReady_(sub);
      if (!gate.ok && !/no changes/.test(gate.reason)) throw new Error(gate.reason);
      advanceChain_(sub, Object.assign(patch, { status: STATUS.GATED, gate_confirmed_at: now }));
    }
    reset.images.forEach(id => deleteSignatureFile_(id)); // one that fails is unreferenced now: the daily cleanup retries it
    mailExoRestarted_(sub, before, info);
    return portal_(sub);
  });
}

/** Fields an amendment copies from the form it amends: the student, the trip, and Step I. */
const AMEND_COPY_FIELDS_ = [
  'student_name', 'student_id', 'student_email', 'student_mobile',
  'current_semester', 'college', 'major', 'concentration', 'student_class',
  'credits_completed', 'gpa', 'expected_graduation',
  'host_university', 'host_country', 'host_semesters', 'host_contact_name', 'host_contact_email',
  'advisor_name', 'advisor_email', 'has_scholarship', 'has_sponsor',
  'conditions_agreed', 'agreed_at',
  's1_accredited', 's1_agreement', 's1_major_accreditation', 's1_program_type',
  's1_comments', 's1_by', 's1_at', 's1_signature', 's1_ip',
  'drive_folder_id'
];

/**
 * Signature cells for a signature copied into an amendment. The image itself is never
 * copied or shared between forms (it belongs to the earlier form's final PDF and is
 * deleted with it): a drawn signature becomes "drawn signature, see original signed PDF <ref>".
 */
function carriedSignature_(prefix, method, fromRef) {
  const cells = {};
  cells[prefix + '_sig_file'] = '';
  const m = str_(method);
  cells[prefix + '_sig_method'] = /see original signed PDF/i.test(m) ? m :   // already carried: keep the first form's ref
    /^(drawn|uploaded)/i.test(m) ? (/^uploaded/i.test(m) ? 'uploaded' : 'drawn') + ' signature, see original signed PDF ' + fromRef : m;
  return cells;
}

/**
 * "Amend this form": starts a new version of a completed form. Everything is
 * copied, including every approved course with its original approval; the
 * student then adds or removes courses (only new ones go to a head of department);
 * Step III is copied from the earlier form (carriedStage_), then the student signs and
 * Step IV runs again. The earlier form stays valid until the amendment is completed; the new
 * PDF then says which form it replaces.
 */
function amendForm(sid, t) {
  return withLock_(() => {
    const parent = getSubmission_(sid, t);
    const can = canAmend_(parent);
    if (!can.ok) throw new Error(can.reason);
    // The amendment copies the credits, so the hard block applies here too.
    const creditProblem = creditsError_(parent.credits_completed) || gpaError_(parent.gpa, true);
    if (creditProblem) throw new Error(creditProblem);

    const root = rootOf_(parent);
    const no = nextAmendmentNo_(root);
    const now = new Date();
    const fields = {};
    AMEND_COPY_FIELDS_.forEach(k => { fields[k] = parent[k]; });
    const child = append_(CFG.SHEETS.SUB, Object.assign(fields,
      carriedSignature_('s1', parent.s1_sig_method, parent.submission_id), {
      submission_id: root + '-A' + no,
      created_at: now, updated_at: now,
      status: STATUS.COURSES,
      amends_id: parent.submission_id, root_id: root, amendment_no: no,
      reminded_at: now
    }));

    const approved = coursesFor_(parent.submission_id).filter(c => c.status === CRS_STATUS.APPROVED);
    appendMany_(CFG.SHEETS.CRS, approved.map((c, i) => {
      const row = {};
      CRS_HEADERS.forEach(h => { row[h] = c[h]; });
      Object.assign(row, carriedSignature_('hod', c.hod_sig_method, parent.submission_id),
        carriedSignature_('faculty', c.faculty_sig_method, parent.submission_id));
      return Object.assign(row, {
        course_row_id: uid_('C-'),
        submission_id: child.submission_id,
        seq: i + 1,
        created_at: now, updated_at: now, reminded_at: '',
        carried_from: c.course_row_id,
        approved_in: str_(c.approved_in) || parent.submission_id
      });
    }));

    update_(CFG.SHEETS.SUB, parent, { amended_by: child.submission_id, updated_at: now });
    log_(parent.submission_id, parent.student_email, 'AMENDMENT_STARTED', child.submission_id);
    log_(child.submission_id, parent.student_email, 'AMENDS', { form: parent.submission_id, carried: approved.length });
    mailAmendmentStarted_(child, parent, approved.length);
    return { url: studentUrl_(child), submission_id: child.submission_id };
  });
}

/* ------------------------------------------------------------------
 * "Send reminder now" buttons. The student can re-send whichever
 * approval email is currently waiting (a course with its head of
 * department or faculty member, Step I with the Exchange Office, or the current
 * Step III approver), e.g. while standing in the approver's office.
 * One reminder per item per minute.
 * ------------------------------------------------------------------ */

/** Runs send() for a still-open form. send calls cooldown(key) to allow one resend per key per minute. */
function resend_(sid, t, send) {
  return withLock_(() => {
    const sub = getSubmission_(sid, t, 'resend');
    if (CLOSED_STATUSES.indexOf(sub.status) !== -1) {
      throw new Error('This form is closed, so there is nothing to remind anyone about.');
    }
    const cache = CacheService.getScriptCache();
    const to = send(sub, key => {
      const k = key + '_' + sub.submission_id;
      if (cache.get(k)) throw new Error('A reminder just went out. Please wait a minute before sending it again.');
      cache.put(k, '1', CFG.RESEND_COOLDOWN_SECONDS);
    });
    return {
      portal: portal_(sub),
      // Where the email really went, so the student can tell the approver.
      to: CFG.TEST_REDIRECT ? CFG.TEST_REDIRECT + ' (TEST MODE - meant for ' + to + ')' : to
    };
  });
}

/**
 * Re-sends the batch email for whoever holds this course: the head of
 * department (all their pending courses) or the faculty member reviewing it.
 */
function resendCourse(sid, t, courseRowId) {
  return resend_(sid, t, (sub, cooldown) => {
    const c = ownCourse_(sub, courseRowId);
    const now = new Date();
    if (c.status === CRS_STATUS.FACULTY) {
      cooldown('rs_fac_' + facultyKey_(c));
      const reviewing = withFaculty_(sub, facultyKey_(c));
      mailFaculty_(sub, reviewing, reviewing, true);
      reviewing.forEach(x => update_(CFG.SHEETS.CRS, x, { reminded_at: now, updated_at: now }));
      log_(sub.submission_id, currentUser_() || sub.student_email, 'FACULTY_RESENT', { to: c.faculty_email, courses: reviewing.length });
      return c.faculty_email;
    }
    if (c.status !== CRS_STATUS.PENDING) throw new Error('Only courses waiting for a decision can have a reminder sent.');
    cooldown('rs_hod_' + hodKey_(c));
    const waiting = pendingFor_(sub, hodKey_(c));
    mailHod_(sub, waiting, waiting, true);
    waiting.forEach(x => update_(CFG.SHEETS.CRS, x, { reminded_at: now, updated_at: now }));
    const to = hodRecipients_(hodKey_(c), waiting);
    log_(sub.submission_id, currentUser_() || sub.student_email, 'COURSES_RESENT', { to: to, courses: waiting.length });
    return to;
  });
}

function resendStepOne(sid, t) {
  return resend_(sid, t, (sub, cooldown) => {
    if (stepOneDone_(sub)) throw new Error('Step I is already complete.');
    cooldown('rs_s1');
    mailStepOne_(sub, true);
    update_(CFG.SHEETS.SUB, sub, { reminded_at: new Date() });
    log_(sub.submission_id, currentUser_() || sub.student_email, 'STEP1_RESENT', { to: CFG.EXO_EMAIL });
    return CFG.EXO_EMAIL;
  });
}

function resendStage(sid, t) {
  return resend_(sid, t, (sub, cooldown) => {
    const stage = stageByKey_(sub.current_stage);
    if (sub.status !== STATUS.GATED || !stage || sub[stage.key + '_status']) {
      throw new Error('No Step III approval is waiting right now.');
    }
    cooldown('rs_st');
    const to = stageEmail_(sub, stage);
    if (!to) throw new Error('There is no email address on file for this step. Please contact ' + CFG.EXO_EMAIL + '.');
    mailStage_(sub, stage, true);
    update_(CFG.SHEETS.SUB, sub, { reminded_at: new Date() });
    log_(sub.submission_id, currentUser_() || sub.student_email, 'STAGE_RESENT', { stage: stage.key, to: to });
    return to;
  });
}


// ------------------------------------------- Exchange Office check of a typed head of department email

/**
 * Exchange Office decides on a head of department email the student typed that is not the one saved on the
 * Departments tab. CONFIRM: the course routes to the typed email, which can then sign.
 * DECLINE: it routes to the saved head of department.
 */
function exoHodDecision(courseRowId, decision) {
  requireAccess_([], { exo: true });
  if (decision !== 'CONFIRM' && decision !== 'DECLINE') throw new Error('Unknown decision.');
  return withLock_(() => {
    const c = readAll_(CFG.SHEETS.CRS).find(x => String(x.course_row_id) === String(courseRowId));
    if (!c) throw new Error('This course no longer exists.');
    if (c.hod_email_check !== 'MISMATCH') return 'Already decided (' + str_(c.hod_email_check) + '). Nothing changed.';
    const sub = subOrThrow_(c.submission_id);
    refuseOwnForm_(sub); // EXO_STAFF includes student workers: nobody decides on their own form
    const patch = { updated_at: new Date() };
    if (decision === 'CONFIRM') {
      patch.hod_email = str_(c.hod_email_entered).toLowerCase();
      patch.assistant_email = '';
      patch.designate_email = '';
      patch.hod_email_check = 'CONFIRMED';
    } else {
      patch.hod_email_check = 'DECLINED';
    }
    update_(CFG.SHEETS.CRS, c, patch);
    const who = currentUser_() || CFG.EXO_EMAIL;
    log_(sub.submission_id, who, decision === 'CONFIRM' ? 'HOD_EMAIL_CONFIRMED' : 'HOD_EMAIL_DECLINED',
      { course: c.course_row_id, entered: c.hod_email_entered, routedTo: c.hod_email });
    // The student was told they cannot send the course until the Exchange Office decides, so tell them it is free now.
    if (CLOSED_STATUSES.indexOf(sub.status) === -1) mailStudentHodChecked_(sub, c, decision === 'CONFIRM');
    return decision === 'CONFIRM'
      ? 'Confirmed. ' + c.host_course_code + ' will go to ' + patch.hod_email + ', who can sign it.'
      : 'Declined. ' + c.host_course_code + ' will go to the saved head of department, ' + str_(c.hod_email) + '.';
  });
}

/** The page behind the "Confirm or decline" link in the Exchange Office email. */
function hodCheckPage_(p) {
  const me = currentUser_();
  const c = readAll_(CFG.SHEETS.CRS).find(x => String(x.course_row_id) === String(p.crs));
  let body;
  if (!isExoStaff_(me) && !isTestSuperuser_(me)) {
    body = '<p>Only Exchange Office staff can open this page. Signed in as: <b>' + esc_(me || 'unknown') + '</b></p>';
  } else if (!c) {
    body = '<p>This course no longer exists.</p>';
  } else if (c.hod_email_check !== 'MISMATCH') {
    body = '<p>Already decided: <b>' + esc_(c.hod_email_check) + '</b>.</p>';
  } else {
    body = '<p><b>Course:</b> ' + esc_(c.host_course_code) + ' - ' + esc_(c.host_course_name) + '<br>' +
      '<b>Department:</b> ' + esc_(c.dept_name) + '<br>' +
      '<b>Saved head of department:</b> ' + esc_(c.hod_email) + '<br>' +
      '<b>Email the student entered:</b> ' + esc_(c.hod_email_entered) + '</p>' +
      '<button onclick="go(\'CONFIRM\')">Confirm: send to the entered email</button> ' +
      '<button onclick="go(\'DECLINE\')">Decline: send to the saved head</button>' +
      '<p id="msg"></p>' +
      '<script>function go(d){document.getElementById("msg").textContent="Saving...";' +
      'google.script.run.withSuccessHandler(function(m){document.getElementById("msg").textContent=m;})' +
      '.withFailureHandler(function(e){document.getElementById("msg").textContent=e.message;})' +
      '.exoHodDecision(' + JSON.stringify(String(c.course_row_id)) + ',d);}</script>';
  }
  return HtmlService.createHtmlOutput('<div style="font:16px Arial;padding:30px;max-width:640px"><h2>Check head of department email</h2>' + body + '</div>')
    .setTitle('Check head of department email - ' + CFG.APP_NAME);
}
