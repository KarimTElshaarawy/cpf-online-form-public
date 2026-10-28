/*******************************************************************
 * Course Permission Form (CPF) for Outgoing Exchange Students
 * Config.gs - all tunable settings live here.
 *******************************************************************/

const CFG = {
  APP_NAME: 'Course Permission Form - Outgoing Exchange',
  OFFICE: 'International Exchange Office, [INCLUDE HERE: your institution name]',
  TZ: 'Etc/UTC',   // INCLUDE HERE: your time zone, e.g. 'America/New_York'

  // Safety valve: while this holds an address, EVERY email the workflow
  // sends is redirected there instead of the real recipient, with the real
  // recipient shown in the subject line. Set it back to '' to go live.
  TEST_REDIRECT: 'demo-inbox.include-here@example.edu',   // INCLUDE HERE: your own address while this is a public demo, so no real person is ever emailed
  // TEST ONLY: these accounts may open and sign ANY page, including their own form, but ONLY
  // while TEST_REDIRECT holds an address. Setting TEST_REDIRECT back to '' for go-live switches
  // this off by itself.
  TEST_SUPERUSERS: [],   // INCLUDE HERE: test accounts (lower case emails)

  // ---- Fixed approvers -------------------------------------------------
  EXO_EMAIL:         'exchange-office.include-here@example.edu',   // INCLUDE HERE
  REGISTRAR_EMAIL:   'registration-officer.include-here@example.edu',   // INCLUDE HERE: Registration Officer: confirms Step IV and types the Registrar's email (RO in STAGES)
  FINANCIAL_EMAIL:   'financial-grants.include-here@example.edu',   // INCLUDE HERE: Financial Grants & Scholarships
  SPONSORSHIP_EMAIL: 'sponsorship.include-here@example.edu',   // INCLUDE HERE: Sponsorship
  // Prefilled (and changeable) on the Registration Officer's Step IV page as the Registrar who signs last.
  DEFAULT_REGISTRAR_EMAIL: 'registrar.include-here@example.edu',   // INCLUDE HERE
  // Every Exchange Office signature (Step I and Step III) is shown as signed by this account on the PDF,
  // the pages and the history, whichever Exchange Office staff member signed. The actual
  // signer is still recorded in the Submissions sheet and the Log. '' = show the real signer.
  EXO_SIGNER_DISPLAY: 'exchange-office-signer.include-here@example.edu',   // INCLUDE HERE
  // Addresses a student may NOT enter as their academic advisor . Lower case.
  BLOCKED_ADVISOR_EMAILS: ['exchange-office-signer.include-here@example.edu'],   // INCLUDE HERE

  // ---- Sender ------------------------------------------------------------
  // Emails go out from FROM_EMAIL when it is set up as a "Send mail as" address
  // in the Gmail of the account that owns this script; otherwise from that
  // account itself. Replies always go to REPLY_TO (every address listed).
  // ALWAYS_CC is copied on every email the workflow sends (left out in test
  // mode, where everything already goes to TEST_REDIRECT).
  FROM_EMAIL: 'exchange-office.include-here@example.edu',   // INCLUDE HERE
  REPLY_TO: ['exchange-office.include-here@example.edu'],   // INCLUDE HERE
  ALWAYS_CC: ['exchange-office.include-here@example.edu'],   // INCLUDE HERE: the Exchange Office is copied on everything so it can keep track

  // Heads of department may forward a course to a faculty member on this domain.
  FACULTY_EMAIL_DOMAIN: 'example.edu',   // INCLUDE HERE: your institution's email domain

  // Associate Deans by college code: they sign Step III (DEAN in STAGES below).
  ASSOC_DEANS: {
    COLA: 'associate-dean-a.include-here@example.edu',   // INCLUDE HERE
    COLB: 'associate-dean-b.include-here@example.edu',
    COLC: 'associate-dean-c.include-here@example.edu',
    COLD: 'associate-dean-d.include-here@example.edu'
  },

  // Associate Dean assistants by college. They are CC'd on the Associate Dean's
  // email and reminders ONLY; assistants never sign or approve anything.
  // Several = comma separated; '' = none.
  ASSOC_DEAN_ASSISTANTS: {
    COLA: 'assistant-a.include-here@example.edu',   // INCLUDE HERE
    COLB: 'assistant-b.include-here@example.edu',
    COLC: 'assistant-c.include-here@example.edu',
    COLD: 'assistant-d.include-here@example.edu'
  },

  // ---- Sign-in (institution SSO) ------------------------------------------------
  // Pages open only for the institution account the step belongs to (checked against
  // the Google sign-in). These Exchange Office staff accounts can do Step I and the Exchange Office
  // signature in Step III, and can VIEW any page of any form. Lower case.
  EXO_STAFF: [
    // INCLUDE HERE: one lower-case email per staff account, e.g. 'staff.name@example.edu'
  ],

  // ---- Business rules --------------------------------------------------
  // Earned credits before the semester abroad. HARD BLOCK: a student with fewer
  // cannot start a form, move on to Step III or amend (INCLUDE HERE: your own minimum).
  MIN_EARNED_CREDITS: 45,
  // Cumulative GPA (CGPA), out of 4.00. HARD BLOCK like the earned credits: a student below this
  // cannot start a form, move on to Step III, restart or amend (INCLUDE HERE: the
  // study abroad eligibility rule of your catalog). Forms started before CGPA was asked
  // (blank CGPA) are not blocked after intake.
  MIN_GPA: 2.5,
  MAX_COURSES: 0,                   // 0 = unlimited courses per form
  REMINDER_AFTER_DAYS: 2,           // re-nudge a reviewer every 2 days until they act
  REMINDER_WEEKDAYS: [1, 2, 3, 4],  // days the 8 AM run may send: 1=Mon ... 7=Sun
  SIGNATURE_MIN_LENGTH: 4,          // typed-name signatures shorter than this are rejected
  // Drawn signatures (Signatures.gs): PNG only, at most this size. The images live in
  // a private Drive folder of the script owner and are deleted once the final signed
  // PDF is built, saved and sent, or when the form is denied or cancelled. Images of a
  // form still in progress are never deleted because the form is old.
  SIGNATURE_MAX_KB: 400,
  SIGNATURE_FOLDER_NAME: 'CPF Signature Images (private - do not share)',
  // Grade required (Step II): the head of department fills it in, prefilled with C.
  // Not enforced; when left blank the PDF prints GRADE_REMARK in its place.
  GRADE_DEFAULT: 'C',
  GRADE_REMARK: 'Minimum grade C',
  GRADE_REJECT_NOTE: 'Minimum grade C',
  CAPTURE_IP: false,                // the signer's IP address is NOT recorded
  IP_LOOKUP_URL: '',                 // no IP lookup
  REASON_MIN_LENGTH: 5,             // a decline must carry at least this much explanation
  REMINDER_HOUR: 8,                 // hour (CFG.TZ) the daily reminder trigger runs
  RESEND_COOLDOWN_SECONDS: 60,      // a student can resend the same approval email once per this
  LOCK_WAIT_MS: 30000,              // how long an action waits for another to finish before giving up

  // ---- Branding / wording ------------------------------------------------
  BRAND_COLOR: '#1f4e8c',           // email header, PDF headings, sheet header rows
  SENDER_NAME: 'International Exchange Office',   // INCLUDE HERE: your office name
  SUBJECT_PREFIX: '[CPF]',      // start of every email subject (students are told to search for it)
  DATE_FORMAT: 'dd MMM yyyy, HH:mm',
  CATALOG_NAME: 'CPF Approved Courses',

  COLLEGES: ['COLA', 'COLB', 'COLC', 'COLD'],   // INCLUDE HERE: your college / school codes (also in ASSOC_DEANS, ASSOC_DEAN_ASSISTANTS and DEPT_SEED)
  CLASSES: ['Freshman I','Freshman II', 'Sophomore I','Sophomore II', 'Junior I','Junior II', 'Senior I', 'Senior II'],

  // Step I - how the home university is linked to the host university
  AGREEMENT_TYPES: [
    'Bilateral',
    'ISEP: Exchange',
    'ISEP: Direct',
    'Ministry scholarship (INCLUDE HERE)',
    'One-way outgoing agreement',
    'None - Visiting student'
  ],

  // Step I, question 3 of the paper form: "has the appropriate accreditation for the
  // student's major (and concentration if any): Yes / No / N/A". The Exchange Office ticks every
  // accreditation that applies (= Yes), or one of the two answers below on its own.
  MAJOR_ACCREDITATIONS: [
    'ABET or Washington Accord',
    'AACSB or EQUIS',
    'NAAB',
    'No - not appropriately accredited for the major',
    'N/A'
  ],
  NO_MAJOR_ACCREDITATION: 'N/A',                                             // printed as N/A
  MAJOR_NOT_ACCREDITED: 'No - not appropriately accredited for the major',         // printed as No

  // What the Home University-equivalent course counts as (filled in by the department).
  // Choosing GER_COURSE_TYPE makes the department pick a GER area as well.
  GER_COURSE_TYPE: 'General Education Requirement (GER)',
  // Choosing OTHER_COURSE_TYPE makes the department type what the course counts as (saved in the GER area field).
  OTHER_COURSE_TYPE: 'Other',
  COURSE_TYPES: [
    'Major Required',
    'Major Elective',
    'Core Requirement',
    'Minor Requirement',
    'General Education Requirement (GER)',
    'Free Elective',
    'Other'
  ],

  // General education (GER) program areas
  GER_AREAS: [
    // INCLUDE HERE: your general education areas, in the order of your paper form
    '1. Area one (INCLUDE HERE)',
    '2. Area two (INCLUDE HERE)',
    '3. Area three (INCLUDE HERE)'
  ],

  // ---- Sheet / Drive ---------------------------------------------------
  SHEETS: {
    SUB:  'Submissions',
    CRS:  'Courses',
    DEPT: 'Departments',
    LOG:  'Log',
    UNI:  'Universities'   // official host university names + the other ways students write them
  },
  DRIVE_FOLDER_NAME: 'CPF Syllabi',

  // ---- Semesters (Semesters.gs) ----------------------------------------
  // A date belongs to the last semester whose startMonth it has reached.
  // The seasons a student can pick for the study abroad semester (Oct 13, 2026: Fall and Spring only).
  STUDY_ABROAD_SEASONS: ['Fall', 'Spring'],
  // Semester boundaries used to sort forms into semester tabs (by date for older forms); not the picker.
  SEMESTERS: [
    { name: 'Spring', startMonth: 1 },
    { name: 'Summer', startMonth: 6 },
    { name: 'Fall',   startMonth: 8 }
  ],
  // Every form stays in the Submissions, Courses and Log tabs for good, so it can be amended at any
  // time. Semesters.gs only builds one read-only overview tab per exchange semester ("Fall 2026").
  MAX_UPLOAD_MB: 13,

  // Each host course: how it is taught and which credit system its credits use (Oct 2026).
  DELIVERY_MODES: ['In-person', 'Online'],
  CREDIT_SYSTEMS: ['US credits', 'ECTS', 'UK credits'],  // plus "Other", where the student types the system's name

  // Step IV and completed emails carry the CPF PDF and every host syllabus as attachments while
  // they total at most this many MB (Gmail refuses about 25 MB). Above it, the syllabi go as a
  // link to the student's Drive folder instead, shared (view only) with the email's recipients.
  MAX_ATTACH_MB: 20,

  // ---- Conditions the student must agree to ----------------------------
  CONDITIONS: [
    // INCLUDE HERE: the conditions printed on your paper form, one per line, written as
    // 'Title - text'. The student agrees to them by signing at the end of Step III and they
    // are printed on the signed PDF. Keep the first and last entries or change the code that
    // refers to them. Example entries are shown below; replace them with your own rules.
    'Repeated Courses - INCLUDE HERE: your policy on repeating courses abroad.',
    'Eligibility - INCLUDE HERE: minimum GPA and earned credit hours (see MIN_GPA and MIN_EARNED_CREDITS above).',
    'Accreditation and Recognition - INCLUDE HERE: which host institutions are acceptable.',
    'Credit Systems - INCLUDE HERE: minimum credits per course for US credits, ECTS and UK modules.',
    'Contact Hours - INCLUDE HERE: contact-hour equivalence rule.',
    'Prerequisites - INCLUDE HERE: your prerequisite rule.',
    'Language of Instruction - INCLUDE HERE: your language rule.',
    'Online Courses - INCLUDE HERE: your online-course rule and limits.',
    'Passing Grades - INCLUDE HERE: the minimum grade for credit to transfer.',
    'Grades and Credits - INCLUDE HERE: how grades and credits are treated.',
    'Residence Requirements - INCLUDE HERE: residence requirements for graduation.',
    'Application and Deadlines - INCLUDE HERE: application deadlines and where to apply.',
    'Registration - INCLUDE HERE: registration requirements at the home university.',
    'After Completion - INCLUDE HERE: what the student must send after returning (transcript, verification form).',
    'Contacts - INCLUDE HERE: office contact addresses.',
    'General Rules - Students are always governed by the rules stipulated in the catalogs of the home university.'
  ],

  // Step IV of the paper form: what the student sends the Registration Officer.
  STEP_IV_TEXT: 'INCLUDE HERE: what the student must send the Registration Officer in Step IV, for example: ' +
    'a. The completed CPF (Course Permission Form) with all signatures and syllabi. ' +
    'b. A copy of the student visa or, if no visa is required, a copy of the passport. ' +
    'c. Any home-university courses registered for the study abroad semester must be dropped.'
};

/*
 * The signatures after Step II, exactly as the official paper form collects them
 * (your paper form), one after another:
 *   STEP III  Student's Advisor -> Student's Associate Dean
 *             -> Office of Financial Grants and Scholarships (only if scholarship)
 *             -> Sponsorship Manager (only if sponsored) -> Exchange Office
 *             -> the STUDENT signs (agreeing to the conditions on the form)
 *   STEP IV   Registration Officer checks and confirms, typing the Registrar's email,
 *             then the Office of the Registrar (that typed address) signs and completes the form.
 * A stage whose onlyIf field is "No" is recorded as N/A rather than skipped,
 * so the finished form shows every line exactly like the paper original.
 * afterSignature: the student signs just before this stage.
 * namesNextSigner: approving this stage requires typing the email of the next signer, saved
 *   as registrar_email. The stage with to 'registrar' goes to that address.
 * step: the step of the paper form the signature belongs to (shown in emails,
 * on the approver page and on the PDF).
 * 'advisor' sends to the advisor email the student typed; createSubmission only
 * accepts a staff address on the institution's domain that is not the student's own.
 */
const STAGES = [
  { key: 'ADV',  label: "Student's Advisor",                           to: 'advisor',           onlyIf: null,              step: 'III',
    block: "Signature of the Student's Advisor" },
  { key: 'DEAN', label: "Student's Associate Dean",                    to: 'dean',              onlyIf: null,              step: 'III',
    block: "Signature of the Student's Associate Dean" },
  { key: 'FIN',  label: 'Office of Financial Grants and Scholarships', to: 'FINANCIAL_EMAIL',   onlyIf: 'has_scholarship', step: 'III',
    block: 'Signature of the Office of Financial Grants and Scholarships',
    note: 'INCLUDE HERE: the home university scholarships that count, for example merit or dean\'s list scholarships' },
  { key: 'SPON', label: 'Sponsorship Manager',                         to: 'SPONSORSHIP_EMAIL', onlyIf: 'has_sponsor',     step: 'III',
    block: 'Signature of Sponsorship Manager',
    note: 'INCLUDE HERE: students sponsored by external organizations coordinated with your sponsorship office (get approval from the sponsor first before applying abroad)' },
  { key: 'EXO',  label: 'Exchange Office',                                         to: 'EXO_EMAIL',         onlyIf: null,              step: 'III',
    block: 'Signature of Exchange Office',
    note: 'Exchange Office use only - Student type and Study Abroad Program type' },
  { key: 'RO',   label: 'Registration Officer',                        to: 'REGISTRAR_EMAIL', onlyIf: null,              step: 'IV',
    block: 'Confirmation of the Registration Officer', afterSignature: true, namesNextSigner: true,
    note: 'Check the form and the attached syllabi. To confirm, sign and type the email of the Registrar who signs last; or decline it with a reason.' },
  { key: 'REG',  label: 'Office of the Registrar',                     to: 'registrar',       onlyIf: null,              step: 'IV',
    block: 'Signature of the Office of the Registrar',
    note: 'The Registration Officer has checked and confirmed this form. Your signature is the last one and completes it.' }
];

/** Wording of the student's signature line on the paper form. */
const STUDENT_SIGNATURE_LABEL = 'Signature of Student (by signing, you agree to the conditions stated on this form)';

/** Submission lifecycle. */
const STATUS = {
  STEP1:     'STEP I - Exchange Office REVIEW',
  COURSES:   'STEP II - COURSE APPROVALS',
  GATED:     'STEP III - APPROVALS IN PROGRESS',
  SIGNING:   'STEP III - AWAITING STUDENT SIGNATURE',
  COMPLETED: 'COMPLETED',
  DENIED:    'DENIED',
  CANCELLED: 'CANCELLED'
};

const CRS_STATUS = {
  DRAFT:      'DRAFT',
  PENDING:    'PENDING REVIEW',   // with the head of department
  FACULTY:    'WITH FACULTY',     // forwarded by the HoD to a faculty member, comes back PENDING
  APPROVED:   'APPROVED',
  DENIED:     'DENIED',
  WITHDRAWN:  'WITHDRAWN',
  SUPERSEDED: 'SUPERSEDED'
};

/** Statuses in which the student can still change the course list. */
const EDITABLE_STATUSES = [STATUS.STEP1, STATUS.COURSES];
/** Statuses in which the student can take the course list back to Step II ("Change my courses"). */
const REOPENABLE_STATUSES = [STATUS.GATED, STATUS.SIGNING];
/** Statuses in which the form is finished and nothing is waiting on anyone. */
const CLOSED_STATUSES = [STATUS.COMPLETED, STATUS.DENIED, STATUS.CANCELLED];
