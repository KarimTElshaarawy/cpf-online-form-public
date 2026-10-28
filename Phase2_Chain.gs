/*******************************************************************
 * Phase2_Chain.gs - the signatures after Step II, in the order of the
 * official paper form (STAGES in Config.gs):
 *   Step III  Advisor -> Associate Dean -> Financial Grants ->
 *             Sponsorship -> Exchange Office -> student signature
 *   Step IV   Registration Officer (confirms and names the Registrar),
 *          then the Office of the Registrar, which completes the form.
 * A step that does not apply is recorded as N/A, never skipped.
 *******************************************************************/

function stageByKey_(key) {
  return STAGES.find(s => s.key === key) || null;
}

/** "Step IV - Office of the Registrar": the paper-form step and who signs. */
function stageTitle_(stage) {
  return 'Step ' + (stage.step || 'III') + ' - ' + stage.label;
}

function stageApplies_(sub, stage) {
  return !stage.onlyIf || isYes_(sub[stage.onlyIf]);
}

/** The stage that runs right after the student signs, or null when the signature is the last step. */
function signatureNextStage_() {
  return STAGES.find(s => s.afterSignature) || null;
}

/** What happens once the student signs, as the end of a sentence ("After you sign, ..."). */
function afterSignatureText_() {
  const next = signatureNextStage_();
  return next ? 'the form goes to the ' + next.label + '.' :
    'the form is submitted as final and the signed PDF is emailed to you.';
}

/**
 * One Step III line of an amendment, copied from the form it amends (null when that form cannot
 * be found, so the line is then signed normally). The status, signer, date and typed name are kept;
 * a drawn or uploaded picture is never copied (carriedSignature_ points to the original signed PDF).
 * The comments say "Carried from <ref>", which the PDF prints next to the result.
 */
function carriedStage_(sub, stage, now) {
  const parent = findRow_(CFG.SHEETS.SUB, 'submission_id', sub.amends_id);
  if (!parent) return null;
  const k = stage.key;
  const before = str_(parent[k + '_comments']);
  const p = {};
  p[k + '_status'] = str_(parent[k + '_status']) || 'N/A';
  p[k + '_by'] = parent[k + '_by'] || '';
  p[k + '_at'] = parent[k + '_at'] || now;
  p[k + '_signature'] = parent[k + '_signature'] || '';
  p[k + '_ip'] = parent[k + '_ip'] || '';
  p[k + '_comments'] = /^Carried from /.test(before) ? before : 'Carried from ' + sub.amends_id + (before ? '. ' + before : '');
  return Object.assign(p, carriedSignature_(k, parent[k + '_sig_method'], sub.amends_id));
}

/** Stops the chain at the student's signature. */
function awaitSignature_(sub, patch) {
  Object.assign(patch, { status: STATUS.SIGNING, current_stage: 'SIGN' });
  update_(CFG.SHEETS.SUB, sub, patch);
  mailStudentSign_(sub);
  log_(sub.submission_id, 'system', 'AWAITING_SIGNATURE', '');
}

function stageEmail_(sub, stage) {
  // Exactly the advisor address the student gave at intake (validated there), and exactly
  // the college's Associate Dean. No fallback: a blank address must not let anyone else
  // sign. The Go-live check lists any form waiting on a step with no address.
  if (stage.to === 'advisor') return str_(sub.advisor_email).toLowerCase();
  // Step IV: the Registrar address the Registration Officer typed when confirming (RO stage).
  if (stage.to === 'registrar') return str_(sub.registrar_email).toLowerCase();
  if (stage.to === 'dean') return str_(CFG.ASSOC_DEANS[str_(sub.college).toUpperCase()]).toLowerCase();
  return str_(CFG[stage.to]).toLowerCase();
}

/**
 * Walks the chain from wherever it is, starting with 'patch' (the change
 * that triggered the walk). Marks non-applicable steps N/A, starts the next
 * real one, asks for the student's signature once every stage is done (or
 * before an afterSignature stage, if one is configured), and completes the
 * form when the signature is in. Everything is written in a single update.
 */
function advanceChain_(sub, patch) {
  Object.assign(sub, patch);
  const now = new Date();
  patch.updated_at = now;

  for (const s of STAGES) {
    if (sub[s.key + '_status']) continue;
    // Amendments (Oct 2026): Step III is not signed again. Each Step III line is copied from the form
    // being amended and marked "Carried from <ref>"; only new courses (Step II), the student's
    // signature and Step IV run again.
    const carried = sub.amends_id && (s.step || 'III') === 'III' ? carriedStage_(sub, s, now) : null;
    if (carried) {
      Object.assign(patch, carried);
      Object.assign(sub, carried);
      log_(sub.submission_id, 'system', 'STAGE_CARRIED', { stage: s.key, from: sub.amends_id });
      continue;
    }

    if (s.afterSignature && !sub.student_signature) {
      awaitSignature_(sub, patch);
      return;
    }
    if (!stageApplies_(sub, s)) {
      patch[s.key + '_status'] = 'N/A';
      patch[s.key + '_at'] = now;
      log_(sub.submission_id, 'system', 'STAGE_NA', s.key);
      continue;
    }
    patch.current_stage = s.key;
    patch.reminded_at = now;   // the new approver's 2-day reminder clock starts now
    update_(CFG.SHEETS.SUB, sub, patch);
    mailStage_(sub, s, false);
    log_(sub.submission_id, 'system', 'STAGE_STARTED', s.key);
    return;
  }
  if (!sub.student_signature) {
    awaitSignature_(sub, patch);
    return;
  }
  complete_(sub, patch);
}

/**
 * Last signature in: records completion, then builds, files and emails the FINAL
 * signed PDF (the only place drawn signature images ever appear) and, once that
 * has all worked, deletes the images (finishFinalPdf_ in Signatures.gs).
 */
function complete_(sub, patch) {
  Object.assign(patch, { status: STATUS.COMPLETED, current_stage: '', completed_at: new Date() });
  update_(CFG.SHEETS.SUB, sub, patch);
  log_(sub.submission_id, 'system', 'COMPLETED', '');
  if (sub.amends_id) log_(sub.amends_id, 'system', 'REPLACED_BY_AMENDMENT', sub.submission_id);
  finishFinalPdf_(sub);
}

// ------------------------------------------------------ approver pages

function stageSub_(sid, stageKey, t, mode) {
  const stage = stageByKey_(stageKey);
  if (!stage) throw new Error('Unknown step.');
  const sub = subOrThrow_(sid);
  // The approver for this step acts (the Exchange Office step: any Exchange Office staff); Exchange Office staff may view any step.
  // An Associate Dean's assistant is CC'd only and is refused here.
  refuseAssistant_(stageCc_(sub, stage), stageApprovers_(sub, stage), 'the ' + stage.label);
  requireAccess_(stageApprovers_(sub, stage), { exo: mode === 'view' || stage.key === 'EXO',
    token: { scope: 'stage:' + stageKey, id: sub.submission_id, t: t } });
  return { stage, sub };
}

/** Who may sign a Step III / IV step: the named approver only (never an assistant). */
function stageApprovers_(sub, stage) {
  return [stageEmail_(sub, stage)].filter(Boolean);
}

/** Copied on the Step III email and its reminders, for information only: the Associate Dean's assistant(s). */
function stageCc_(sub, stage) {
  return stage.key === 'DEAN' ? str_((CFG.ASSOC_DEAN_ASSISTANTS || {})[str_(sub.college).toUpperCase()]) : '';
}

function getStageReview(sid, stageKey, t) {
  const { stage, sub } = stageSub_(sid, stageKey, t, 'view');
  return plain_({
    submission: sub,
    history: history_(sub),
    stage: { key: stage.key, label: stage.label, title: stageTitle_(stage),
      block: stage.block || ('Signature of ' + stage.label), note: stage.note || '' },
    // The Exchange Office fills in "Exchange Office use only - Student type and Study Abroad Program type" with its signature.
    askProgramType: stage.key === 'EXO',
    // The Registration Officer types the email of the Registrar who signs after them.
    askRegistrarEmail: !!stage.namesNextSigner,
    // Prefilled with CFG.DEFAULT_REGISTRAR_EMAIL; the Registration Officer can change it.
    registrarEmail: str_(sub.registrar_email) || (stage.namesNextSigner ? str_(CFG.DEFAULT_REGISTRAR_EMAIL) : ''),
    programType: str_(sub.s1_program_type),
    stepFourText: stage.step === 'IV' ? CFG.STEP_IV_TEXT : '',
    isCurrent: sub.current_stage === stageKey && sub.status === STATUS.GATED,
    decided: !!sub[stageKey + '_status']
  });
}

/**
 * One Step III / IV signature. extra = { programType } for the Exchange Office step
 * ("Exchange Office use only - Student type and Study Abroad Program type", required to approve).
 */
function decideStage(sid, stageKey, t, decision, comments, signature, extra, clientIp) {
  noteIp_(clientIp);
  const approve = decision_(decision) === 'APPROVE';
  const input = signatureInput_(signature, 'Please type your full name to sign this decision.');
  const sig = input.name;
  if (!approve) declineReason_(comments);
  const programType = tidyText_(extra && extra.programType);
  const registrarEmail = str_(extra && extra.registrarEmail).toLowerCase();

  return withLock_(() => {
    const { stage, sub } = stageSub_(sid, stageKey, t);
    refuseOwnForm_(sub);
    if (sub.status !== STATUS.GATED || sub.current_stage !== stageKey) {
      throw new Error('This step is not the one currently awaiting a decision.');
    }
    if (sub[stageKey + '_status']) throw new Error('This step has already been decided.');

    const who = currentUser_() || stageEmail_(sub, stage);
    const patch = {};
    patch[stageKey + '_status'] = approve ? 'APPROVED' : 'DENIED';
    patch[stageKey + '_by'] = who;
    patch[stageKey + '_at'] = new Date();
    patch[stageKey + '_comments'] = str_(comments);
    patch[stageKey + '_signature'] = sig;
    patch[stageKey + '_ip'] = ipNow_();
    if (stage.key === 'EXO') {
      // Kept in s1_program_type (where older forms stored it at Step I).
      if (programType) patch.s1_program_type = programType;
      if (approve && !programType && !str_(sub.s1_program_type)) {
        throw new Error('Please fill in "Exchange Office use only - Student type and Study Abroad Program type".');
      }
    }
    if (stage.namesNextSigner && approve) {
      const domain = '@' + CFG.FACULTY_EMAIL_DOMAIN;
      if (!isEmail_(registrarEmail) || registrarEmail.slice(-domain.length) !== domain) {
        throw new Error('Please type the email of the Registrar who signs next (an ' + domain + ' address).');
      }
      if ([stageEmail_(sub, stage), str_(who).toLowerCase(), str_(sub.student_email).toLowerCase()].indexOf(registrarEmail) > -1) {
        throw new Error('The Registrar who signs next must be someone other than you and the student.');
      }
      patch.registrar_email = registrarEmail;
    }
    // Last, after every check: a drawn signature is saved to the private folder here.
    Object.assign(patch, signaturePatch_(CFG.SHEETS.SUB, sub.submission_id, stageKey, input));

    log_(sub.submission_id, who, 'STAGE_' + decision, stageKey);
    if (approve) {
      Object.assign(sub, patch);
      mailStudentStageDecision_(sub, stage, true, comments);
      advanceChain_(sub, patch);
    } else {
      Object.assign(patch, { status: STATUS.DENIED, current_stage: '', updated_at: new Date() });
      update_(CFG.SHEETS.SUB, sub, patch);
      mailStudentStageDecision_(sub, stage, false, comments);
    }
    return { ok: true, decision: decision };
  });
}

// ------------------------------------------------------------- signature

function getSignPage(sid, t) {
  const sub = getSubmission_(sid, t, 'view');
  return plain_({
    submission: sub,
    history: history_(sub),
    conditions: CFG.CONDITIONS,
    ready: sub.status === STATUS.SIGNING,
    done: sub.status === STATUS.COMPLETED
  });
}

function signSubmission(sid, t, signature, clientIp) {
  noteIp_(clientIp);
  const input = signatureInput_(signature);
  return withLock_(() => {
    const sub = getSubmission_(sid, t);
    if (sub.status !== STATUS.SIGNING) throw new Error('The form is not ready to be signed yet.');
    log_(sub.submission_id, sub.student_email, 'STUDENT_SIGNED', input.method);
    advanceChain_(sub, Object.assign({
      student_signature: input.name, student_ip: ipNow_(), signed_at: new Date(),
      // The student agrees to the conditions here, by signing (Oct 14, 2026: no separate agreement at intake).
      conditions_agreed: 'Yes', agreed_at: new Date(),
      status: STATUS.GATED, current_stage: ''
    }, signaturePatch_(CFG.SHEETS.SUB, sub.submission_id, 'student', input)));
    return { ok: true };
  });
}

// ------------------------------------------------------------------- pdf

/** A plain <td>; extra lines (already escaped by the caller) are joined with <br>. */
function pdfCell_(...lines) {
  return '<td>' + lines.filter(x => str_(x)).map(esc_).join('<br>') + '</td>';
}

/** Label/value pairs for the details grids; 'cells' is [label, value, ...]. */
function pdfKv_(cells) {
  let out = '';
  for (let i = 0; i < cells.length; i += 2) {
    out += '<td class="l">' + esc_(cells[i]) + '</td><td class="v">' + esc_(cells[i + 1]) + '</td>';
  }
  return '<tr>' + out + '</tr>';
}

/** A date as the PDF prints it: the day only, never the time ("14 Oct 2026, 10:05" -> "14 Oct 2026"). */
function pdfDate_(v) {
  return str_(v).replace(/,?\s*\d{1,2}:\d{2}(:\d{2})?\s*$/, '');
}

/** Short role for the HoD column: HoD, Designate or Assistant. */
function pdfHodRole_(c) {
  const r = str_(c.role);
  return /Designate/.test(r) ? 'Designate' : /Assistant/.test(r) ? 'Assistant' : r ? 'HoD' : '';
}

/**
 * The signed PDF. isFinal = true only for the final signed PDF built at completion
 * (finishFinalPdf_): that is the ONLY time drawn signature images are read and drawn
 * in. Without it, a drawn signature shows as its note instead of the picture.
 *
 * Layout (Oct 14, 2026): ONE font size and one text colour everywhere (headings are
 * bold in the brand colour), compact single-line rows, no small print, no form IDs.
 * Order: student details, Step I, Step II courses (with in-person / online), Step III
 * signatures, the Conditions, the student's signature directly under them (the
 * student agrees to the conditions by signing), then Step IV. Dates show the day only.
 * The <!DOCTYPE html> matters: without it the converter renders tables at 16px.
 */
function buildPdf_(sub, isFinal) {
  const withImages = isFinal === true;
  const h = history_(sub);
  const s1 = h.stepOne;
  const a = h.amendment;
  const raw = coursesFor_(sub.submission_id);   // same order as h.courses
  const sigHtml = (row, prefix) =>
    pdfSignatureHtml_(row[prefix + '_signature'], row[prefix + '_sig_method'], row[prefix + '_sig_file'], withImages);

  const courseRows = h.courses.
    map((c, i) => ({ c: c, r: raw[i] })).
    filter(x => x.c.status === CRS_STATUS.APPROVED).
    map((x, i) => {
      const c = x.c;
      return '<tr><td>' + (i + 1) + '</td>' +
        pdfCell_(c.hostCode, c.hostName) +
        pdfCell_(c.hostMode) +
        pdfCell_([c.hostCredits, c.hostCreditSystem].map(str_).filter(Boolean).join(' ')) +
        pdfCell_(c.homeCode, c.homeName) +
        pdfCell_(c.homeCredits) +
        pdfCell_(c.courseType, c.gerArea) +
        pdfCell_(str_(c.gradeRequired) || CFG.GRADE_DEFAULT) +
        pdfCell_(c.prereqsMet) +
        '<td>' + sigHtml(x.r, 'hod') + '<br>' + esc_([pdfHodRole_(c), pdfDate_(c.at)].filter(Boolean).join(', ')) +
          (c.facultySignature ? '<br>Faculty (' + esc_(c.matchPct) + '%): ' + sigHtml(x.r, 'faculty') : '') +
        '</td></tr>';
    })
    .join('');

  // One signature per line: who, signed by, the signature, the date (no time), the result.
  const sigRow = (line, by, sigCellHtml, at, result) =>
    '<tr><td>' + esc_(line) + '</td><td>' + esc_(by) + '</td><td>' + sigCellHtml + '</td><td>' +
    esc_(pdfDate_(at)) + '</td><td>' + esc_(result) + '</td></tr>';
  const sigTable = rows =>
    '<table><colgroup><col style="width:28%"><col style="width:27%"><col style="width:20%">' +
    '<col style="width:12%"><col style="width:13%"></colgroup>' +
    '<tr><th>Signatory</th><th>Signed by</th><th>Signature</th><th>Date</th><th>Result</th></tr>' +
    rows.join('') + '</table>';
  const stageRows = step => h.stages.
    filter(s => (s.step || 'III') === step).
    map(s => sigRow(s.label, s.by, sigHtml(sub, s.key), s.at, s.status || 'Pending'));

  const studentDetails =
    '<table><colgroup>' +
      '<col style="width:13%"><col style="width:20%"><col style="width:13%"><col style="width:20%">' +
      '<col style="width:13%"><col style="width:21%"></colgroup>' +
      pdfKv_(['Name', sub.student_name, 'Student ID', sub.student_id, 'Email', sub.student_email]) +
      pdfKv_(['College', sub.college,
        'Major', sub.major + (sub.concentration ? ' (' + sub.concentration + ')' : ''),
        'Class', sub.student_class]) +
      pdfKv_(['Current semester', sub.current_semester, 'Graduation', sub.expected_graduation,
        'Mobile', sub.student_mobile]) +
      pdfKv_(['Earned credits', sub.credits_completed, 'CGPA', sub.gpa,
        'Home University scholarship', sub.has_scholarship]) +
      pdfKv_(['Host university', sub.host_university, 'Host country', sub.host_country,
        'Sponsored', sub.has_sponsor]) +
      '<tr><td class="l">Semester abroad</td><td class="v">' + esc_(sub.host_semesters) + '</td>' +
        '<td class="l">Advisor</td><td class="v" colspan="3">' + esc_(h.student.advisor) + '</td></tr>' +
      '<tr><td class="l">Host contact</td><td class="v" colspan="5">' +
        esc_([sub.host_contact_name, sub.host_contact_email].map(str_).filter(Boolean).join(', ')) + '</td></tr>' +
    '</table>';

  const FS = '10px';   // the one font size used everywhere on the PDF (titles in the brand color)
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*{font-size:' + FS + ';color:#1a1a1a}' +
    'body{font-family:Arial,Helvetica,sans-serif;line-height:1.35;margin:16px 22px}' +
    'h1,h2{font-weight:bold;color:' + CFG.BRAND_COLOR + ';margin:10px 0 3px;text-transform:uppercase;letter-spacing:.3px}' +
    'h1{margin:6px 0 2px}' +
    'p{margin:0 0 3px}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:3px}' +
    'th,td{border:1px solid #d6d6d6;padding:2px 4px;text-align:left;vertical-align:middle;word-wrap:break-word}' +
    'th{background:#e9eff8;font-weight:bold}' +
    'tr{page-break-inside:avoid}' +
    'td.l{background:#f5f8fc}' +
    'td.v{font-weight:bold}' +
    '.crs td{vertical-align:top}' +
    'ol{margin:0;padding-left:16px}li{margin:0 0 1px}' +
    '</style></head><body>' +
    '<div style="border-bottom:2px solid ' + CFG.BRAND_COLOR + ';padding-bottom:5px">' +
      '<img src="' + logoDataUri_() + '" width="245" height="27"></div>' +
    '<h1>Course Permission Form - Outgoing Exchange' + (a ? ' - Amendment ' + a.no : '') + '</h1>' +

    '<h2>Student information</h2>' + studentDetails +

    (a ?
      '<h2>Changes in this amendment</h2><table><colgroup><col style="width:20%"><col style="width:80%"></colgroup>' +
          pdfKv_(['Courses added', a.added.length ? a.added.join(', ') : 'None']) +
          pdfKv_(['Courses removed', a.removed.length ? a.removed.join(', ') : 'None']) +
        '</table>'
      : '') +

    '<h2>Step I: Approval by Exchange Office</h2>' +
    '<table><colgroup><col style="width:58%"><col style="width:42%"></colgroup>' +
      pdfKv_(['1. Accredited institution recognized by its country\'s Ministry of Education', s1.accredited]) +
      pdfKv_(['2. Home University study abroad agreement', s1.agreement]) +
      pdfKv_(['3. Appropriate accreditation for the student\'s major (and concentration)', s1.majorAccreditation]) +
      (str_(s1.programType) ? pdfKv_(['Student type and study abroad program type (Exchange Office use only)', s1.programType]) : '') +
      (str_(s1.comments) ? pdfKv_(['Comments / special requirements', s1.comments]) : '') +
    '</table>' +
    sigTable([sigRow('Exchange Office', s1.by, sigHtml(sub, 's1'), s1.at, s1.signature ? 'APPROVED' : 'Pending')]) +

    '<h2>Step II: Approved courses</h2>' +
    '<table class="crs"><colgroup><col style="width:3%"><col style="width:17%"><col style="width:8%">' +
      '<col style="width:7%"><col style="width:17%"><col style="width:5%"><col style="width:12%">' +
      '<col style="width:6%"><col style="width:7%"><col style="width:18%"></colgroup>' +
      '<tr><th>#</th><th>Host course</th><th>Mode</th><th>Host credits</th><th>Home University equivalent</th><th>Home University cr.</th>' +
      '<th>Counts as</th><th>Grade</th><th>Prereqs met</th><th>HoD approval</th></tr>' +
      courseRows + '</table>' +
    '<p>' + esc_(CFG.GRADE_REJECT_NOTE) + '</p>' +

    '<h2>Step III: Signatures</h2>' + sigTable(stageRows('III')) +

    '<h2>Conditions</h2>' +
    // Oct 15, 2026: each condition's title (the text before the first ' - ') is printed in bold.
    '<ol>' + CFG.CONDITIONS.map(c => {
      const s = String(c), cut = s.indexOf(' - ');
      return '<li>' + (cut > -1 ? '<b>' + esc_(s.slice(0, cut)) + ' -</b> ' + esc_(s.slice(cut + 3)) : esc_(s)) + '</li>';
    }).join('') + '</ol>' +

    // The student signs right after reading the conditions; Step IV signs after the student.
    '<h2>Student\'s signature</h2>' +
    '<p>By signing, the student agrees to the conditions stated above.</p>' +
    sigTable([sigRow('Student', sub.student_name, sigHtml(sub, 'student'), h.signedAt,
      h.studentSignature ? 'SIGNED' : 'Pending')]) +

    '<h2>Step IV: Office of the Registrar</h2>' +
    sigTable(stageRows('IV')) +
    '</body></html>';

  return Utilities.newBlob(html, 'text/html', 'CPF.html').
    getAs('application/pdf')
    .setName('CPF - ' + sub.student_id + ' - ' + sub.student_name + (a ? ' - Amendment ' + a.no : '') + '.pdf');
}

// ------------------------------------------------------------- reminders

/**
 * Daily 8 AM trigger: re-nudges every reviewer who has had something
 * waiting for REMINDER_AFTER_DAYS. The trigger only sends on
 * CFG.REMINDER_WEEKDAYS; running it by hand from the CPF menu always sends.
 * Safe to run at any time: only people who are due get an email.
 */
function sendReminders(e) {
  requireAdminOrTrigger_(e);
  const today = Number(Utilities.formatDate(new Date(), CFG.TZ, 'u')); // 1=Mon ... 7=Sun
  if (e && e.triggerUid && CFG.REMINDER_WEEKDAYS.indexOf(today) === -1) {
    console.log('Reminders skipped: not a reminder day (' + today + ').');
    return;
  }

  withLock_(() => {
    if (!('reminded_at' in table_(CFG.SHEETS.SUB).col)) {
      throw new Error('The Submissions tab has no reminded_at column yet. Run CPF menu > Set up / repair tabs.');
    }
    // Due once REMINDER_AFTER_DAYS calendar days have passed. The trigger fires at any minute
    // within REMINDER_HOUR, so a strict 48 hours would often miss by minutes and slip to the
    // next reminder day; 12 hours of slack keeps it on day 2.
    const cutoff = new Date(Date.now() - CFG.REMINDER_AFTER_DAYS * 86400000 + 12 * 3600000);
    const isDue = d => d && new Date(d) <= cutoff;
    const subs = {};
    readAll_(CFG.SHEETS.SUB).forEach(s => { subs[s.submission_id] = s; });
    const isOpen = sub => sub && CLOSED_STATUSES.indexOf(sub.status) === -1;
    let sent = 0;

    // Heads of department and faculty reviewers: one reminder per student + person, listing
    // everything waiting on them, sent when any of it is due. All of it then restarts the clock.
    const hodGroups = {};
    const facGroups = {};
    readAll_(CFG.SHEETS.CRS).forEach(c => {
      if (!isOpen(subs[c.submission_id])) return;
      if (c.status === CRS_STATUS.PENDING) {
        const key = c.submission_id + '|' + hodKey_(c);
        (hodGroups[key] = hodGroups[key] || []).push(c);
      } else if (c.status === CRS_STATUS.FACULTY) {
        const key = c.submission_id + '|' + facultyKey_(c);
        (facGroups[key] = facGroups[key] || []).push(c);
      }
    });
    Object.keys(hodGroups).forEach(key => {
      const waiting = hodGroups[key];
      if (!waiting.some(c => isDue(c.reminded_at || c.sent_at))) return;
      mailHod_(subs[waiting[0].submission_id], waiting, waiting, true);
      const now = new Date();
      waiting.forEach(c => update_(CFG.SHEETS.CRS, c, { reminded_at: now }));
      sent++;
    });
    Object.keys(facGroups).forEach(key => {
      const reviewing = facGroups[key];
      if (!reviewing.some(c => isDue(c.reminded_at || c.forwarded_at))) return;
      mailFaculty_(subs[reviewing[0].submission_id], reviewing, reviewing, true);
      const now = new Date();
      reviewing.forEach(c => update_(CFG.SHEETS.CRS, c, { reminded_at: now }));
      sent++;
    });

    // Step I (Exchange Office) and the current Step III approver: every REMINDER_AFTER_DAYS since
    // they were last emailed. Older rows without reminded_at fall back to updated_at.
    Object.keys(subs).forEach(id => {
      const s = subs[id];
      if (!isDue(s.reminded_at || s.updated_at)) return;
      if (s.status === STATUS.STEP1) {
        mailStepOne_(s, true);
      } else if (s.status === STATUS.GATED && stageByKey_(s.current_stage)) {
        mailStage_(s, stageByKey_(s.current_stage), true);
      } else {
        return;
      }
      update_(CFG.SHEETS.SUB, s, { reminded_at: new Date() });
      sent++;
    });

    console.log(sent + ' reminder(s) sent.');
  });
}
