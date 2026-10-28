/*******************************************************************
 * Phase0_Intake.gs - the student's first submission (page 1 of the
 * paper form): host university names, form references, Drive
 * folders, syllabus uploads, and Step I (Exchange Office).
 *******************************************************************/

// ---------------------------------------------------------------- Drive

/** The "CPF Syllabi" folder: by saved id only (ownedFolder_ in Util.gs never trusts a name alone). */
function rootFolder_() {
  return ownedFolder_('ROOT_FOLDER_ID', CFG.DRIVE_FOLDER_NAME);
}

/**
 * One folder per exchange semester inside CPF Syllabi ("Fall 2026", from semesterOfForm_), holding
 * one folder per student form (Oct 2026). Only a folder this script's account owns is reused.
 */
function semesterFolder_(sub) {
  const root = rootFolder_();
  const name = semesterOfForm_(sub).label;
  const me = str_(Session.getEffectiveUser().getEmail()).toLowerCase();
  const found = root.getFoldersByName(name);
  while (found.hasNext()) {
    const f = found.next();
    const owner = f.getOwner();
    if (owner && str_(owner.getEmail()).toLowerCase() === me) return f;
  }
  return root.createFolder(name);
}

/**
 * The form's Drive folder (CPF Syllabi > semester > student). Amendments share the folder of the
 * form they amend. A folder made before Oct 2026 sits directly in CPF Syllabi: it is moved into
 * its semester folder the next time it is used.
 */
function subFolder_(sub) {
  if (sub.drive_folder_id) {
    try {
      const f = DriveApp.getFolderById(sub.drive_folder_id);
      try {
        const parents = f.getParents();
        if (parents.hasNext() && parents.next().getId() === rootFolder_().getId()) f.moveTo(semesterFolder_(sub));
      } catch (x) { console.warn('Could not move the form folder into its semester folder: ' + x); }
      return f;
    } catch (e) { console.warn('Submission folder missing, recreating: ' + e); }
  }
  const f = semesterFolder_(sub).createFolder(sub.student_id + ' - ' + sub.student_name + ' - ' + sub.submission_id);
  update_(CFG.SHEETS.SUB, sub, { drive_folder_id: f.getId() });
  return f;
}

/** True when the bytes really are a PDF: "%PDF" within the first kilobyte, as the format allows. */
function isPdf_(bytes) {
  const end = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= end; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) return true;
  }
  return false;
}

/**
 * Saves a base64 PDF upload from the browser into the form's folder. The type the
 * browser reports is not trusted: the file itself must be a PDF.
 */
function saveUpload_(sub, file, label) {
  if (!file || !file.data) return '';
  if ((file.mimeType || 'application/pdf') !== 'application/pdf') throw new Error('Only PDF files are accepted.');
  const bytes = Utilities.base64Decode(file.data);
  if (bytes.length > CFG.MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error('The file is larger than ' + CFG.MAX_UPLOAD_MB + ' MB.');
  }
  if (!isPdf_(bytes)) throw new Error('That file is not a valid PDF. Please save or export the syllabus as a PDF and try again.');
  const name = str_(file.name).replace(/[^\w .()+-]/g, '_').slice(0, 120) || 'syllabus.pdf';
  const f = subFolder_(sub).createFile(Utilities.newBlob(bytes, 'application/pdf', label + ' - ' + name));
  f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getUrl();
}

// ---------------------------------------------------------------- host universities

/**
 * The Universities tab as a lookup: every official name and alias, reduced by
 * uniKey_(), points at { name, country }. Built once per read of the tab. A
 * missing tab just means typed names are kept as typed.
 */
function universityIndex_() {
  let t;
  try { t = table_(CFG.SHEETS.UNI); } catch (e) { return new Map(); }
  if (t.uni) return t.uni;
  const idx = new Map();
  t.rows.forEach(r => {
    const name = tidyText_(r.university);
    if (!name) return;
    const entry = { name: name, country: tidyText_(r.country) };
    [name].concat(str_(r.aliases).split(',')).forEach(a => {
      const k = uniKey_(a);
      if (k && !idx.has(k)) idx.set(k, entry);
    });
  });
  return (t.uni = idx);
}

/** The official name for whatever the student typed ("eu1" -> "Example University One"). */
function canonicalUniversity_(typed) {
  const clean = tidyText_(typed);
  const hit = universityIndex_().get(uniKey_(clean));
  return hit ? { name: hit.name, country: hit.country, known: true } : { name: clean, country: '', known: false };
}

/** Official names, for the suggestions list on the intake page. */
function universityNames_() {
  return Array.from(new Set(Array.from(universityIndex_().values()).map(e => e.name))).
    sort((a, b) => a.localeCompare(b));
}

/**
 * An existing form the new one would duplicate: same student, host university and
 * semester, and either still open or completed and not replaced by an amendment.
 * Names are compared loosely (case, accents, punctuation, aliases), never exactly.
 */
function tripClash_(studentId, university, semesters) {
  const u = uniKey_(canonicalUniversity_(university).name);
  const s = semKey_(semesters);
  const mine = readAll_(CFG.SHEETS.SUB).filter(x =>
    str_(x.student_id).toLowerCase() === studentId &&
    semKey_(x.host_semesters) === s &&
    uniKey_(canonicalUniversity_(x.host_university).name) === u);
  return mine.find(x => CLOSED_STATUSES.indexOf(x.status) === -1) ||
    mine.find(x => x.status === STATUS.COMPLETED && !isSuperseded_(x)) || null;
}

// ---------------------------------------------------------------- intake

const INTAKE_REQUIRED = [
  'student_name', 'student_id', 'student_email', 'student_mobile', 'major', 'college',
  'student_class', 'current_semester', 'credits_completed', 'gpa',
  'host_university', 'host_semesters', 'advisor_name', 'advisor_email',
  // Oct 15, 2026: nothing on the intake page is optional, so the final PDF is never missing a line.
  'concentration', 'expected_graduation', 'host_contact_name', 'host_contact_email',
  'has_scholarship', 'has_sponsor'
];

/**
 * Called from the intake page. Any number of forms per student (one per host
 * university and semester). Returns the reference and the student's link.
 */
function createSubmission(p) {
  p = p || {};
  const me = currentUser_();
  // No signed-in account (for example an anonymous visitor of a public demo deployment): nothing is created.
  if (!me && !SELF_TEST_) throw new Error('Please sign in with your institution Google account to start a form.');
  if (me && !SELF_TEST_) p.student_email = me; // the institution account they signed in with
  // Checked first and on the server: the page checks too, but the browser cannot be trusted.
  const creditProblem = creditsError_(p.credits_completed);
  if (creditProblem) throw new Error(creditProblem);
  const gpaProblem = gpaError_(p.gpa);   // CGPA is required at intake
  if (gpaProblem) throw new Error(gpaProblem);
  requireFields_(p, INTAKE_REQUIRED, 'Missing required field: ');
  p.host_semesters = hostSemester_(p.host_semesters);
  if (!isEmail_(p.student_email)) throw new Error('Student email looks invalid.');
  if (!isEmail_(p.advisor_email)) throw new Error('Advisor email looks invalid.');
  // The advisor signs Step III with this address, so it must be an institution staff account,
  // never the student's own or another student's (b/g + 8 digits).
  const advisor = str_(p.advisor_email).toLowerCase();
  if (!advisor.endsWith('@' + CFG.FACULTY_EMAIL_DOMAIN) || /^[bg]\d{8}@/.test(advisor) ||
      advisor === str_(p.student_email).toLowerCase() ||
      (CFG.BLOCKED_ADVISOR_EMAILS || []).map(e => str_(e).toLowerCase()).indexOf(advisor) > -1) {
    throw new Error('Please enter your academic advisor\'s own @' + CFG.FACULTY_EMAIL_DOMAIN + ' email address.');
  }
  if (!isEmail_(p.host_contact_email)) throw new Error('The host university contact email looks invalid.');
  ['has_scholarship', 'has_sponsor'].forEach(k => {
    if (!/^(yes|no)$/i.test(str_(p[k]))) throw new Error('Please answer Yes or No: ' + (k === 'has_scholarship' ? 'Home University financial grant or scholarship' : 'external sponsor') + '.');
  });
  const college = str_(p.college).toUpperCase();
  if (CFG.COLLEGES.indexOf(college) === -1) throw new Error('Please choose your college.');

  const studentId = str_(p.student_id).toLowerCase().replace(/\s+/g, '');
  const uni = canonicalUniversity_(p.host_university);
  if (!tidyText_(p.host_country) && !str_(uni.country)) throw new Error('Missing required field: host country');

  return withLock_(() => {
    const clash = tripClash_(studentId, uni.name, p.host_semesters);
    if (clash && clash.status !== STATUS.COMPLETED) {
      throw new Error('You already have an open form for ' + clash.host_university + ' (' + clash.host_semesters +
        '), reference ' + clash.submission_id + '. Open it from "Your forms" at the top of this page or the link in your email, or contact ' +
        CFG.EXO_EMAIL + '. For a different university or semester, just start another form.');
    }
    if (clash) {
      throw new Error('You already have an approved form for ' + clash.host_university + ' (' + clash.host_semesters +
        '), reference ' + clash.submission_id + '. To change its courses, open it and use "Amend this form" ' +
        'instead of starting a new one.');
    }

    const now = new Date();
    const sub = append_(CFG.SHEETS.SUB, {
      submission_id: nextRef_(now),
      created_at: now, updated_at: now,
      status: STATUS.STEP1,
      student_name: tidyName_(p.student_name),
      student_id: studentId,
      student_email: str_(p.student_email).toLowerCase(),
      student_mobile: tidyText_(p.student_mobile),
      current_semester: tidyName_(p.current_semester),
      college: college,
      major: tidyText_(p.major),
      concentration: tidyText_(p.concentration),
      student_class: tidyText_(p.student_class),
      credits_completed: str_(p.credits_completed),
      gpa: Number(str_(p.gpa)).toFixed(2),
      expected_graduation: tidyName_(p.expected_graduation),
      host_university: uni.name,
      host_country: tidyText_(p.host_country) || uni.country,
      host_semesters: tidyName_(p.host_semesters),
      host_contact_name: tidyName_(p.host_contact_name),
      host_contact_email: str_(p.host_contact_email).toLowerCase(),
      advisor_name: tidyName_(p.advisor_name),
      advisor_email: str_(p.advisor_email).toLowerCase(),
      has_scholarship: isYes_(p.has_scholarship) ? 'Yes' : 'No',
      has_sponsor: isYes_(p.has_sponsor) ? 'Yes' : 'No',
      // Agreed when the student signs at the end of Step III (signSubmission), not at intake (Oct 14, 2026).
      conditions_agreed: '', agreed_at: '',
      amendment_no: 0,
      reminded_at: now
    });

    log_(sub.submission_id, sub.student_email, 'INTAKE_SUBMITTED',
      { credits: sub.credits_completed, min: CFG.MIN_EARNED_CREDITS, cgpa: sub.gpa, minCgpa: CFG.MIN_GPA, university: uni.known ? 'matched' : 'as typed' });
    mailStudentPortal_(sub);
    mailStepOne_(sub, false);
    return { url: studentUrl_(sub), submission_id: sub.submission_id };
  });
}

/**
 * Readable form reference: CPF-FA26-0001 = semester (FA/SP/SU + year) and a
 * running number that restarts each semester. Called under the lock in
 * createSubmission. Self-test forms get CPF-TEST-... so they use up no numbers.
 */
const SEM_CODES_ = { Spring: 'SP', Summer: 'SU', Fall: 'FA' };

function nextRef_(date) {
  if (SELF_TEST_) return uid_('CPF-TEST-');
  const parts = semesterOf_(date).label.split(' ');          // ['Fall', '2026']
  const code = (SEM_CODES_[parts[0]] || parts[0].slice(0, 2).toUpperCase()) + parts[1].slice(-2);
  const prefix = 'CPF-' + code + '-';
  const key = 'REF_SEQ_' + code;
  let n = Number(prop_(key)) || 0;
  // Never reuse a number that is still in the sheet, even if the counter was lost.
  readAll_(CFG.SHEETS.SUB).forEach(s => {
    const id = String(s.submission_id);
    if (id.indexOf(prefix) === 0) n = Math.max(n, parseInt(id.slice(prefix.length), 10) || 0);
  });
  n++;
  setProp_(key, String(n));
  return prefix + String(n).padStart(4, '0');
}

/**
 * The earned-credits rule, a HARD BLOCK: '' when the value is a whole or decimal
 * number of at least CFG.MIN_EARNED_CREDITS, otherwise the message to show.
 * Blank, non-numeric and negative values are refused too. Used at intake, at the
 * gate into Step III (so "Change my courses" cannot get round it) and on amendment.
 */
function creditsError_(v) {
  const s = str_(v);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return 'Please enter your number of earned credits as a number (for example 60).';
  }
  if (Number(s) < CFG.MIN_EARNED_CREDITS) {
    return 'You need at least ' + CFG.MIN_EARNED_CREDITS + ' earned credits to go abroad. ' +
      'Please contact the Exchange Office (' + CFG.EXO_EMAIL + ') if you think this is wrong.';
  }
  return '';
}

/**
 * The CGPA rule, a HARD BLOCK like the earned credits: '' when the value is a number from
 * CFG.MIN_GPA to 4.00, otherwise the message to show. allowBlank: forms started before
 * CGPA was asked have none; they are not blocked at the later checks (gate into Step III,
 * restart, amendment). At intake it is never blank.
 */
function gpaError_(v, allowBlank) {
  const s = str_(v);
  if (!s && allowBlank) return '';
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) > 4) {
    return 'Please enter your cumulative GPA (CGPA) as a number out of 4.00 (for example 3.25).';
  }
  if (Number(s) < CFG.MIN_GPA) {
    return 'You need a cumulative GPA (CGPA) of at least ' + Number(CFG.MIN_GPA).toFixed(2) + ' to go abroad. ' +
      'Please contact the Exchange Office (' + CFG.EXO_EMAIL + ') if you think this is wrong.';
  }
  return '';
}

// ------------------------------------------------------------ Step I (Exchange Office)

function stepOneDone_(sub) {
  return !!sub.s1_at;
}

function stepOneSub_(sid, t) {
  const sub = subOrThrow_(sid);
  requireAccess_([], { exo: true, token: { scope: 'step1', id: sub.submission_id, t: t } }); // Exchange Office staff only
  return sub;
}

function getStepOne(sid, t) {
  const sub = stepOneSub_(sid, t);
  return plain_({
    submission: sub,
    agreementTypes: CFG.AGREEMENT_TYPES,
    majorAccreditations: CFG.MAJOR_ACCREDITATIONS,
    decided: stepOneDone_(sub),
    history: history_(sub)
  });
}

/* Step I has exactly the paper form's three questions plus comments. "Exchange Office use only -
 * Student type and Study Abroad Program type" belongs to the Exchange Office's Step III signature
 * on the paper form, so it is asked there (decideStage); it is still stored in the
 * s1_program_type column so older forms keep their answer. */
const STEP1_QUESTIONS = {
  s1_accredited: 'the accreditation question',
  s1_agreement: 'the type of agreement'
};

/** The ticked accreditations, checked against the list, stored as "A, B". */
function majorAccreditation_(ticked) {
  const list = (Array.isArray(ticked) ? ticked : [ticked]).map(str_).filter(Boolean);
  if (!list.length) throw new Error('Please tick the accreditation(s) the host university holds for the major.');
  list.forEach(a => {
    if (CFG.MAJOR_ACCREDITATIONS.indexOf(a) === -1) throw new Error('Unknown accreditation: ' + a);
  });
  [CFG.NO_MAJOR_ACCREDITATION, CFG.MAJOR_NOT_ACCREDITED].forEach(alone => {
    if (list.length > 1 && list.indexOf(alone) > -1) throw new Error('"' + alone + '" cannot be ticked together with anything else.');
  });
  return list.join(', ');
}

/** Question 3 as the paper form answers it: "Yes (ABET ...)", "No" or "N/A". */
function majorAccreditationAnswer_(stored) {
  const v = str_(stored);
  if (!v) return '';
  if (v === CFG.NO_MAJOR_ACCREDITATION) return 'N/A';
  if (v === CFG.MAJOR_NOT_ACCREDITED) return 'No';
  return 'Yes (' + v + ')';
}

/** Exchange Office completes Step I. Until this is done no course can be sent out. */
function submitStepOne(sid, t, d, clientIp) {
  d = d || {};
  noteIp_(clientIp);
  const declined = decision_(d.decision) === 'DENY';
  // Declining ends the form, so like every other decline it must say why (the student is emailed the comments).
  if (declined) declineReason_(d.s1_comments, 'Please explain in the comments why Step I is declined.');
  Object.keys(STEP1_QUESTIONS).forEach(k => {
    if (!str_(d[k])) throw new Error('Please answer ' + STEP1_QUESTIONS[k] + '.');
  });
  if (d.s1_accredited !== 'Yes' && d.s1_accredited !== 'No') throw new Error('Please answer ' + STEP1_QUESTIONS.s1_accredited + '.');
  if (CFG.AGREEMENT_TYPES.indexOf(d.s1_agreement) === -1) throw new Error('Please choose ' + STEP1_QUESTIONS.s1_agreement + '.');
  const accreditation = majorAccreditation_(d.s1_major_accreditation);
  const input = signatureInput_(d.signature, 'Please type your full name to sign Step I.');

  return withLock_(() => {
    const sub = stepOneSub_(sid, t);
    refuseOwnForm_(sub);
    if (stepOneDone_(sub)) throw new Error('Step I has already been completed.');

    const who = currentUser_() || CFG.EXO_EMAIL;
    const now = new Date();
    update_(CFG.SHEETS.SUB, sub, Object.assign({
      s1_accredited: d.s1_accredited,
      s1_agreement: d.s1_agreement,
      s1_major_accreditation: accreditation,
      s1_comments: str_(d.s1_comments),
      s1_by: who, s1_at: now, s1_signature: input.name, s1_ip: ipNow_(),
      status: declined ? STATUS.DENIED : STATUS.COURSES,
      updated_at: now
    }, signaturePatch_(CFG.SHEETS.SUB, sub.submission_id, 's1', input)));

    log_(sub.submission_id, who, declined ? 'STEP1_DECLINED' : 'STEP1_APPROVED', d.s1_agreement);
    mailStudentStepOne_(sub, !declined);
    return { ok: true, declined: declined };
  });
}
