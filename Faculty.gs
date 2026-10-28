/*******************************************************************
 * Faculty.gs - optional faculty review inside Step II.
 *
 * On the review page a head of department can forward a course to the
 * faculty member who teaches it (an @example.edu address). That professor
 * gets one email per student listing every course forwarded to them,
 * opens their own page, suggests the Home University equivalent, gives a
 * recommendation, a match percentage and notes on where the courses
 * match, and signs. The course then goes back to the head of
 * department, who sees the professor's review with the Home University fields
 * already filled in, and makes the final decision as usual.
 *******************************************************************/

/** Lower-cased faculty email, the key forwarded courses are grouped by. */
function facultyKey_(c) {
  return str_(c.faculty_email).toLowerCase();
}

/** Every course from this student currently with the given faculty member. */
function withFaculty_(sub, fac) {
  return coursesFor_(sub.submission_id).
    filter(c => c.status === CRS_STATUS.FACULTY && facultyKey_(c) === fac);
}

/**
 * A student account looks like b00000000@example.edu (b or g, then the student ID digits). Faculty and
 * heads of department are never student accounts. In test mode (CFG.TEST_REDIRECT set) it is allowed,
 * because every email then goes to the tester anyway.
 */
// INCLUDE HERE: change the pattern to match your institution's student account format.
function isStudentAccount_(email) {
  return /^[bg]\d{5,}@/i.test(str_(email)) && !CFG.TEST_REDIRECT;
}

/** A forward target must be a real address on the university domain, and not a student account. */
function facultyEmail_(v, code) {
  const email = str_(v).toLowerCase();
  if (!isEmail_(email) || !email.endsWith('@' + CFG.FACULTY_EMAIL_DOMAIN)) {
    throw new Error('Enter the faculty member\'s @' + CFG.FACULTY_EMAIL_DOMAIN + ' email' + code + '.');
  }
  if (isStudentAccount_(email)) {
    throw new Error('That is a student account. Enter the faculty member\'s @' + CFG.FACULTY_EMAIL_DOMAIN + ' email' + code + '.');
  }
  return email;
}

/** Patch that hands a pending course to a faculty member. */
function forwardPatch_(d, who, now) {
  const code = d.host_course_code ? ' for ' + d.host_course_code : '';
  return {
    status: CRS_STATUS.FACULTY,
    faculty_email: facultyEmail_(d.faculty_email, code),
    forwarded_by: who,
    forwarded_at: now,
    forward_note: str_(d.forward_note),
    // a fresh review each time: clear anything left from an earlier one
    faculty_recommendation: '', faculty_match_pct: '', faculty_match_notes: '',
    faculty_signature: '', faculty_ip: '', faculty_at: '',
    faculty_sig_method: '', faculty_sig_file: '',   // an old drawn image becomes unreferenced; the daily cleanup deletes it
    reminded_at: now,
    updated_at: now
  };
}

/** Emails each professor once, listing all the courses just forwarded to them. */
function notifyFaculty_(sub, forwarded) {
  const groups = {};
  forwarded.forEach(c => { (groups[facultyKey_(c)] = groups[facultyKey_(c)] || []).push(c); });
  Object.keys(groups).forEach(fac => mailFaculty_(sub, groups[fac], withFaculty_(sub, fac), false));
}

// ------------------------------------------------------------ faculty page

/** q = { ref, fac, t } from the faculty link. */
function facultyScope_(q, mode) {
  q = q || {};
  const fac = str_(q.fac).toLowerCase();
  const sub = subOrThrow_(q.ref);
  requireAccess_(fac, { exo: mode === 'view', token: { scope: 'fac:' + fac, id: sub.submission_id, t: q.t } });
  const courses = coursesFor_(sub.submission_id).filter(c => isLive_(c) && fac && facultyKey_(c) === fac);
  requireCourses_(courses, mode);   // Phase1_Courses.gs: only a faculty member a course was forwarded to
  return { sub, fac, courses };
}

function facultyView_(scope) {
  return plain_({
    submission: scope.sub,
    history: history_(scope.sub),
    fac: scope.fac,
    pending: scope.courses.filter(c => c.status === CRS_STATUS.FACULTY),
    reviewed: scope.courses.filter(c => c.status !== CRS_STATUS.FACULTY && c.faculty_at),
    courseTypes: CFG.COURSE_TYPES,
    gerAreas: CFG.GER_AREAS
  });
}

function getFacultyReview(q) {
  return facultyView_(facultyScope_(q, 'view'));
}

/** Checks one faculty review; returns the patch to write. */
function facultyPatch_(d, _fac, signature, now) {
  const code = d.host_course_code ? ' for ' + d.host_course_code : '';
  const recommend = d.recommendation;
  if (recommend !== 'APPROVE' && recommend !== 'DENY') throw new Error('Choose a recommendation' + code + '.');
  const pct = Number(d.match_pct);
  if (str_(d.match_pct) === '' || isNaN(pct) || pct < 0 || pct > 100) {
    throw new Error('Enter a match percentage from 0 to 100' + code + '.');
  }
  if (str_(d.match_notes).length < CFG.REASON_MIN_LENGTH) {
    throw new Error('Describe where the courses match (or do not)' + code + '.');
  }
  const patch = {
    status: CRS_STATUS.PENDING,   // back to the head of department for the final decision
    faculty_recommendation: recommend === 'APPROVE' ? 'Recommends approval' : 'Recommends declining',
    faculty_match_pct: Math.round(pct),
    faculty_match_notes: str_(d.match_notes),
    faculty_signature: signature,
    faculty_ip: ipNow_(),
    faculty_at: now,
    reminded_at: now,
    updated_at: now
  };
  // Approval needs the Home University side; a "decline" recommendation may leave it blank.
  return recommend === 'APPROVE' ? Object.assign(patch, homeSide_(d, code)) : patch;
}

/**
 * The professor reviews any number of their forwarded courses with one
 * signature. items: [{ course_row_id, recommendation: 'APPROVE' | 'DENY' | '',
 * match_pct, match_notes, home_course_code, ... }]. Blank = decide later.
 */
function submitFacultyReview(q, items, signature, clientIp) {
  noteIp_(clientIp);
  const input = signatureInput_(signature, 'Please type your full name to sign.');
  const sig = input.name;
  const chosen = (items || []).filter(d => d && d.recommendation);
  if (!chosen.length) throw new Error('Choose a recommendation for at least one course.');

  return withLock_(() => {
    const scope = facultyScope_(q);
    refuseOwnForm_(scope.sub);
    const now = new Date();
    const work = chosen.map(d => {
      const c = scope.courses.find(x => x.course_row_id === d.course_row_id);
      if (!c || c.status !== CRS_STATUS.FACULTY) {
        throw new Error('A course on this page is no longer waiting for your review. Please reload.');
      }
      return { c, patch: facultyPatch_(Object.assign({ host_course_code: c.host_course_code }, d), scope.fac, sig, now) };
    });

    // One signature covers every course reviewed now; a drawn one is saved once (private folder).
    const sigCells = signaturePatch_(CFG.SHEETS.CRS, scope.sub.submission_id, 'faculty', input);
    work.forEach(w => Object.assign(w.patch, sigCells));

    work.forEach(w => {
      update_(CFG.SHEETS.CRS, w.c, w.patch);
      log_(scope.sub.submission_id, scope.fac, 'FACULTY_REVIEWED',
        { course: w.c.course_row_id, recommendation: w.patch.faculty_recommendation, match: w.patch.faculty_match_pct });
    });

    // Tell each head of department once, with their batch link.
    const byHodGroups = byHod_(work.map(w => w.c));
    Object.keys(byHodGroups).forEach(hod => mailHodFacultyReviewed_(scope.sub, byHodGroups[hod], pendingFor_(scope.sub, hod)));

    const result = facultyView_(scope);
    result.saved = work.length;
    return result;
  });
}
