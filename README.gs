/*******************************************************************
 * README - CPF Workflow
 *
 * How the online Course Permission Form works, and how to deploy it,
 * check it and fix it. This file holds no code; it is only notes.
 *
 *

 CONTENTS
   1. What this is
   2. Where everything lives
   3. How a form moves (the flow)
   4. Statuses, and what they mean
   5. Who can open what (sign-in and security)
   6. Things that run by themselves
   7. The CPF menu (in the Sheet)
   8. First-time deployment (from nothing)
   9. Checking that it works
  10. Everyday checks and fixes (common problems)
  11. Changing settings or code safely
  12. Handover: when the owner of this script leaves
  13. File map


 =================================================================
 1. WHAT THIS IS
 =================================================================
 The online version of the paper Exchange Office Course Permission Form (CPF)
 for Home University students going abroad on exchange.

 The student fills in a web page. The script then emails everyone
 who has to approve it, in the same order as the paper form. Each
 approver gets a link, opens a page, decides, and signs by typing
 or drawing. When the last signature (the Registrar, Step IV) is
 in, the script builds the final signed PDF and emails it to the
 student, the Exchange Office and the Registrar.

 THE SOURCE OF TRUTH is your institution's official paper form. The
 steps, the signature order, the signature wording, the Step I questions
 and the Conditions in the code all follow it (INCLUDE HERE: name and
 version of your paper form). When the office issues a new version of
 the form, compare it with Config.gs (STAGES, CONDITIONS, STEP_IV_TEXT,
 MIN_EARNED_CREDITS, MIN_GPA, AGREEMENT_TYPES, MAJOR_ACCREDITATIONS)
 and update those.

 Behaviour that differs from a plain paper form:
   - Earned credits (CFG.MIN_EARNED_CREDITS) and CGPA (CFG.MIN_GPA) are a
     hard block at intake, at the gate into Step III, on restart and on
     amendment. Forms started before CGPA was asked (blank) are not blocked.
   - Associate Dean assistants never sign: they are only copied on emails
     and reminders. Department assistants are copied too and MAY sign the
     head of department review (recorded as "Department Assistant").
   - The student types the head of department email; a mismatch with the
     Departments tab is held until the Exchange Office decides.
   - Every signer may Type, Draw or Upload their signature.
   - Grade required is prefilled (CFG.GRADE_DEFAULT) and not enforced by
     the code.
   - Each signer's IP address can be recorded in the Sheet only
     (CFG.CAPTURE_IP, off by default); it is never shown or printed.
   - A department may name a College/School Designate who signs instead
     of the head of department (optional designate_email).
   - The student signs once only, at the end of Step III: signing = agreeing
     to the Conditions (conditions_agreed / agreed_at are filled in then).
   - Every Exchange Office signature can be shown as signed by one account
     (CFG.EXO_SIGNER_DISPLAY); the Sheet and Log keep the real signer.
   - Students cannot enter CFG.BLOCKED_ADVISOR_EMAILS as their advisor.
   - Step IV has two signatures: the Registration Officer
     (CFG.REGISTRAR_EMAIL) checks, confirms and types the email of the
     Registrar (saved in registrar_email), and the Registrar signs last.
     Both Step IV emails and the completed email carry the CPF PDF with
     every signature and the approved courses' host syllabi. Above
     CFG.MAX_ATTACH_MB the syllabi go as a link to the student's Drive
     folder instead, shared view-only with the recipients.
   - Each host course records its credit system (CFG.CREDIT_SYSTEMS or a
     typed one) and whether it is online or in-person (CFG.DELIVERY_MODES).
   - Syllabus folders: CPF Syllabi, then one folder per semester, then one
     per student form.
   - Dark mode (web pages only, Styles.html): pages follow the device's
     light / dark setting; the sun / moon button saves the person's choice.
   - WHO THE APP RUNS AS. The web app runs as whoever made the ACTIVE
     deployment (Execute as: Me), and the daily triggers run as whoever
     installed them. That account sends every email (from its Gmail, as
     CFG.FROM_EMAIL only if it has that send-as alias) and owns every file
     the app saves. Check it with the web app link + ?page=whoami.
   - Lost links: the start page shows "Your forms" at the top, listing the
     signed-in student's own forms (getMyForms in WebApp.gs). It matches
     ONLY the account Google reports as signed in against student_email.

 It is all Google, nothing else to host:
   - this Apps Script project (the logic and the web pages)
   - the Google Sheet it is attached to (the database)
   - a Drive folder (syllabi, signed PDFs, catalog)
   - a second, PRIVATE Drive folder for drawn signature images,
     which are temporary (see SIGNATURE IMAGES in section 2)
   - Gmail (every email)

 Every email:
   - is sent from exchange-office.include-here@example.edu (CFG.FROM_EMAIL; see section 8 step 7),
   - has reply-to exchange-office.include-here@example.edu (CFG.REPLY_TO),
   - is copied to b00000000@example.edu (CFG.ALWAYS_CC),
   - has a subject starting with [CPF], so anyone can search for it.


 =================================================================
 2. WHERE EVERYTHING LIVES
 =================================================================
 Quick way to get all the links: in this editor pick printLinks
 (in Test.gs) in the function dropdown, press Run, and read the
 Execution log.

 THE SHEET (the database). All CPF data is in this one spreadsheet,
 the one this script is bound to.
   Tab           What is in it
   Submissions   one row per form: student, host university,
                 Step I answers, every Step III signature, status
   Courses       one row per course on a form (host course, Home University
                 equivalent, who decided, faculty review, the HoD email the
                  student typed and whether it matched: MATCH/MISMATCH)
   Departments   heads of department + assistants. This is what
                 decides who gets each course email. The student types the
                  HoD email on the course form; it is compared with this
                  tab (see HEAD OF DEPARTMENT EMAIL CHECK below)
   Log           every action: time, form, who, what. Best place
                 to see the full history of one form. The last two
                 columns are for people: student (name and ID) and
                 what_happened, one plain-English sentence per line,
                 including every email sent (to, copy, subject,
                 attachments, and in test mode where it really went).
                 The other columns are the raw codes for checking.
                 CPF menu > Explain older Log lines in plain English
                 fills the sentence for lines written before Oct 2026.
   Universities  official host university names, their country, and
                 the other ways students write them (aliases, comma
                 separated). Add partners here as they come up
   Semester tabs one read-only tab per exchange semester (Spring
                 2026, Fall 2026 ...), at the bottom of the Sheet,
                 oldest first. Rebuilt every day from the tabs above,
                 so edit Submissions and Courses, never these. A form
                 goes on the tab of the season and year the student
                 picked (or the semester it was submitted in, if that
                 cannot be read). "Academic year 2027/2028" goes on
                 Fall 2027, "Calendar year 2027" on Spring 2027

 HEAD OF DEPARTMENT EMAIL CHECK
 On the course form the student picks the Home University department and types
 the head of department email (it is not filled in for them). The
 script compares it with hod_email on the Departments tab (ignoring
 upper/lower case). The result is in hod_email_check (Courses tab):
   MATCH      same address: nothing special, the course goes to it.
   MISMATCH   different: the course saves as a draft but is HELD.
              The student cannot send it, and Exchange Office (exchange-office.include-here@example.edu) gets
              a "Confirm head of department email" email with the
              department, both addresses, the student, the course and
              a "Confirm or decline" link (?page=hodcheck, Exchange Office staff
              only). The portal shows the course as waiting for Exchange Office.
   CONFIRMED  Exchange Office confirmed: the course goes to the email the student
              typed, and that person reviews and signs it.
   DECLINED   Exchange Office declined: the course goes to the saved head of
              department, who reviews and signs it.
 After Exchange Office decides, the student is emailed and can send the course.
 Exchange Office is asked again only if the student changes the typed email or
 the department. If a head of department has changed for good, also
 update hod_email on the Departments tab. "Load department heads"
 never overrides a CONFIRMED course. hod_email_entered keeps what was
 typed. Code: saveCourse_, exoHodDecision and hodCheckPage_
 (Phase1_Courses.gs); emails mailExoHodCheck_ and
 mailStudentHodChecked_ (Email.gs). Go-live check lists held courses.
 
 STUDY ABROAD TERM
 The student picks Fall or Spring (CFG.STUDY_ABROAD_SEASONS, Oct 13,
 2026: Summer, Academic year and Calendar year removed) plus a year,
 stored as "Fall 2027". Older rows that say "Academic year
 2027/2028", "Calendar year 2027" or "Summer ..." are still read and
 sorted onto a semester tab.
 
  NOTHING IS ARCHIVED OR DELETED. Every form stays in Submissions,
 Courses and Log for good, so a student can amend a completed form at
 any time, however old it is.

 DRIVE FOLDER "CPF Syllabi" (in the script owner's Drive)
   - one subfolder per form: "<student id> - <name> - <CPF-ref>",
     holding the uploaded syllabi and the final signed PDF.
     Syllabi are shared "anyone at your institution with the link can view" so
     heads of department and faculty can open them.
   - "CPF Approved Courses" spreadsheet: the approved-course
     catalog (a separate workbook), one tab per host university.
     It has each approval's student name and ID (last two columns,
     first approval only), so share it only with staff who may see
     student data (view only). A host course appears once per Home University course it was
     approved against: it only gets a second row when it was
     approved as a DIFFERENT Home University course. Codes are compared ignoring
     case, spaces and punctuation ("ELN-301" = "eln 301").

 THE STUDENT LINK. In the Sheet: CPF menu > Show web app link.
 That is the only link to publish. Opening it with nothing after it
 shows the new-form page. Every other page is reached through the
 links inside emails.

 SIGNATURES. Every signer (Step I, the head of department or
 designate, the faculty member, each Step III / IV approver and the
 student) chooses one way to sign (Oct 2026: Upload added, and the
 typed name is required only for Type):
   Type    the typed full name is the signature
   Draw    they sign in a box with a finger, pen or mouse (works
           on phones, a Clear button starts again)
   Upload  they choose a saved PNG or JPG picture of their signature
           (scaled down in the browser and sent as a PNG, so it is
           checked, stored and deleted exactly like a drawing)
 For Draw and Upload the name is optional: without one the Sheet
 keeps "Drawn signature" / "Uploaded signature" and pages say just
 "Signed". Each signature records the method (typed / drawn /
 uploaded), the time, the signed-in institution account and the IP address.
 Pages and emails show only "Signed by <name> on <date> (<method>)"
 (plus the role for course approvals), never a picture and never an
 IP address. The CPF PDF (Step IV emails and the final signed PDF)
 has ONE signature per line: the typed name, or the drawn / uploaded
 picture, whichever was used, never both. The method is in the
 *_sig_method columns.

 IP ADDRESSES ARE KEPT IN THE SHEET ONLY. Columns: s1_ip, ADV_ip,
 DEAN_ip, FIN_ip, SPON_ip, EXO_ip, RO_ip, REG_ip and student_ip
 (Submissions tab), hod_ip and faculty_ip (Courses tab). They are
 NOT shown on any page, history panel, status view, email or API
 result, and NOT printed on the signed PDF or amendment PDFs. As a
 second guard, plain_ (Util.gs) strips every IP value (any *_ip,
 ip or ...Ip key) from everything sent to a browser, the same way it
 strips signature file ids. Under every signature box the page tells
 the signer that their IP address is recorded.
   How it works: a web app cannot see the visitor's IP address, so the
   browser looks it up itself (Script.html, from CFG.IP_LOOKUP_URL) and
   sends it with the signature. That makes it an audit trail, not proof:
   the signed-in institution account is what identifies the signer. "not
   reported" means the lookup was blocked (ad blocker, firewall).
   To switch it off, set CAPTURE_IP to false in Config.gs and redeploy.

 SIGNATURE IMAGES (drawn signatures; Signatures.gs). Temporary and
 private, by design:
   - Each drawn signature is saved as a PNG (checked on the server:
     a real PNG, at most CFG.SIGNATURE_MAX_KB) in ONE folder, "CPF
     Signature Images (private - do not share)", in the My Drive of
     the account that owns the script (the deploying account). Its
     id is the SIG_FOLDER_ID script property. Set up / repair tabs
     creates it. The script never shares the folder or a file and
     never makes a link to one.
   - NOBODY SHOULD EVER SHARE THIS FOLDER OR ANYTHING IN IT. Not with
     the office, not "anyone with the link". The Go-live check
     reports any sharing as FIX.
   - The Sheet keeps only the file id (*_sig_file columns). Ids are
     stripped from everything sent to a browser (plain_ in Util.gs),
     and no function returns an image to a page. Only the final-PDF
     builder reads the images (signatureImageForPdf_ and buildPdf_,
     both private: names ending in "_" cannot be called from a page).
   - The pictures are drawn ONLY into the final signed PDF, built
     after the last signature (the Registrar). That PDF is the
     permanent record.
   - After the final PDF is built, saved in the form's folder AND
     emailed, every image of that form is DELETED, its file id is
     cleared, and its *_sig_method cell becomes "drawn signature,
     image deleted on <date>" (audit trail; also on the Log tab as
     SIGNATURE_IMAGES_DELETED). If building, saving or emailing
     fails, the images are KEPT and the Log says PDF_FAILED or
     PDF_EMAIL_FAILED; CPF menu > Retry final PDFs finishes the job
     (it reuses a saved PDF and never rebuilds one).
   - HOW DELETION WORKS: through the Drive advanced service (switched
     on in appsscript.json: "Drive", v3), with Drive.Files.remove,
     which deletes permanently. If the service is not enabled (for
     example appsscript.json was not pasted), the code falls back to
     moving the file to the owner's Drive trash, which Google empties
     after 30 days; it never empties the whole trash. The Go-live
     check says which one is active. To enable it by hand: editor >
     Services (+) > Drive API > version v3 > identifier "Drive" > Add.
   - Daily cleanup (trigger cleanupSignatureImages, CPF menu > Clean
     up signature images now): deletes ONLY the images of forms
     DENIED or CANCELLED, and any file in the folder that no row
     points to (a redone review, "Change my courses"). Completed
     forms are left to Retry final PDFs.
   - A FORM IS NEVER CLEANED UP FOR BEING OLD. The images of a form
     that never completes stay in the private folder until the form
     is cancelled (type CANCELLED in its status cell), denied or
     completed.
   - Amendments never copy an image: a drawn signature carried into
     an amendment (Step I, earlier course approvals) shows on the
     amendment's PDF as "Drawn signature, see original signed PDF
     <ref>". Only the amendment's own new signatures are drawn on it.

 DRIVE FOLDERS ARE FOUND BY SAVED ID ONLY (ownedFolder_ in Util.gs).
 The "CPF Syllabi" folder (ROOT_FOLDER_ID) and the signature folder
 (SIG_FOLDER_ID) are created by the script, and only their saved ids
 are used afterwards. If no id is saved and a folder with the same
 name already exists, it is adopted ONLY if the script owner owns it
 and it is shared with nobody; otherwise a fresh folder is created and
 the Log tab says FOLDER_CREATED (and why). The catalog spreadsheet
 (CATALOG_ID) is likewise only ever opened by id. Drive also lists
 folders other people share with the owner, which is why a name alone
 is never trusted. The Go-live check confirms each folder is owned
 by the script owner and not shared.

 SCRIPT PROPERTIES (Project Settings, gear icon > Script
 properties). IDs the script saved for itself:
   SHEET_ID, ROOT_FOLDER_ID, CATALOG_ID
   SIG_FOLDER_ID  the private signature image folder. Never point it
                at another folder (ROOT_FOLDER_ID likewise).
   CPF_SECRET   the key that very old email links (with t=...) were
                signed with. Links no longer carry it, but NEVER
                change or delete it: old links would stop working.
   REF_SEQ_FA26 etc.  last reference number used that semester.
   AMEND_SEQ_<ref>  last amendment number used for that form, so
                an amendment number is never reused.
                Form references look like CPF-FA26-0001 (FA/SP/SU
                + year + running number). Self-test forms are
                CPF-TEST-...
   WEBAPP_URL   (optional) if set, used as the link in emails
                instead of the one Google reports.


 =================================================================
 3. HOW A FORM MOVES (THE FLOW)
 =================================================================
 STEP 0 - Student starts
   Student opens the student link, fills in their details, host
   university, advisor, scholarship / sponsor. (They do NOT agree to
   the conditions here: they review them and agree by signing once,
   at the end of Step III.) Their Home University email is taken from the account they are
   signed in with (they cannot type someone else's). They get an
   email with their portal link (keep it: it is how they get back
   in). A student can have any number of forms, one per host
   university and semester; a second form for the same trip is
   refused, however it is spelled.
   EARNED CREDITS: the student declares their number of earned
   credits. Fewer than 45 (CFG.MIN_EARNED_CREDITS), or anything that
   is not a number, is REFUSED: the form cannot be started. This is
   checked on the page and again on the server, and again at the
   gate into Step III and when amending, so it cannot be bypassed
   later. Older open forms below 45 are not deleted; the Go-live
   check lists them for the Exchange Office to handle by hand.
   FUNDING: the student answers "Have you received a Home University financial
   grant or scholarship?" and "Are you sponsored by an external
   organization?". These two answers alone decide whether Financial
   Grants and Scholarships and the Sponsorship Manager sign in Step
   III (Yes) or are recorded as N/A and skipped (No). The Exchange Office sees
   both answers, and what they mean, on every review page and email.
   Names, IDs and semesters are tidied ("TEST STUDENT" -> "Test
   Student", "B00000000" -> "b00000000") and the university is
   matched against the Universities tab ("eu1" -> "Example
   University One").

 STEP I - Approval by Exchange Office (the host university)
   exchange-office.include-here@example.edu gets a "Step I review" email. Any Exchange Office staff member
   answers the paper form's three questions:
     1. accredited institution recognized by the Ministry of
        Education: Yes / No
     2. study abroad agreement: Bilateral, ISEP: Exchange,
        ISEP: Direct, MOE Scholarship, One-way outgoing agreement,
        None - Visiting student
     3. appropriate accreditation for the major: Yes (tick every
        accreditation that applies) / No / N/A
   plus Comments / Special Requirements, then approves or declines
   and signs ("Signature of Exchange Office"). Declining needs a reason in the
   comments and ends the form (DENIED).
   ("Exchange Office use only - Student type and Study Abroad Program type" is
   NOT asked here: on the paper form it sits with the Exchange Office's Step III
   signature, so it is asked there. It is stored in the
   s1_program_type column, where older forms stored it at Step I.)

 STEP II - Course approvals (heads of department)
   - The student adds courses on their portal: host code, name,
     credits, the Home University department, and the host syllabus PDF (max
     CFG.MAX_UPLOAD_MB, 13 MB). Each course is its own row on the
     Courses tab. They can add courses before Step I is done but
     cannot send them until it is.
   - Sending: courses for the same head of department (HoD) go out
     as ONE batch: one email and one review page listing every
     course from that student for that HoD. The department
     assistant(s) are CC'd on it and on its reminders, and (since
     Oct 8, 2026) may also open the review page and sign it; their
     signature is recorded with the role "Department Assistant".
   - Before a course can be sent, its typed head of department
     email must match the Departments tab or be confirmed /
     declined by the Exchange Office (section 2, HEAD OF DEPARTMENT EMAIL CHECK).
   - Who signs for a department, as the paper form allows: the head
     of department (hod_email on the Departments tab) OR, if the
     college has one, the College/School Designate (the optional
     designate_email column). Either one may sign a batch. The batch
     email and its reminders go to both (assistants CC'd); the same
     review link works for both. The Courses tab records who signed
     (decision_by) and in which role (hod_role = HoD, Designate or
     Assistant);
     the review history, emails and the PDF show it as "Head of
     Department", "College/School Designate" or "Department
     Assistant". Leave designate_email
     empty and only the HoD signs (older rows work unchanged). CPF
     menu > Load department heads keeps each department's designate.
   - On the review page the HoD fills in, per course: Home University
     equivalent code / name / credits, what it counts as (and the
     GER area if it is a GER) (or, if Other, a typed description saved in the GER area field), grade required, prerequisites met.
     Grade required is prefilled with C and can be changed or left
     blank; the page says "Minimum grade C: a course passed with a
     grade below C will be rejected by the Registrar", and a blank
     grade prints as "Minimum grade C" on the PDF. The code does not
     check grades. Then approve, decline (reason required) or
     forward to a faculty member. One signature (drawn or typed)
     covers the whole batch.
   - Optional faculty review: a forwarded course goes to an
     @example.edu faculty member, who suggests the Home University equivalent,
     gives a match % and notes, and recommends approve / decline.
     The course then goes back to the HoD with the fields filled
     in, and the HoD makes the final call.
   - While a course is pending the student can still edit it (it
     goes back to draft and must be sent again, so the HoD reviews
     the final version), withdraw it, or add more courses.
   - The student gets one email per HoD decision batch. For a
     declined course they can fix it and resubmit the same course
     (the earlier syllabus is kept unless they upload a new one),
     submit a different course as the alternative, or withdraw it.
     Resubmitting or replacing turns the old row SUPERSEDED. There
     is no block on a course that was declined for another student;
     each request is reviewed on its own.
   - Every approved course is added to the approved-course catalog
     automatically (no duplicates, see section 2).

 THE GATE
   Unlocks once every course row is resolved: Step I is done, at
   least one course is approved, and no course is still draft,
   pending, with faculty, or declined (a declined course must be
   replaced or withdrawn). The student presses "I am satisfied -
   proceed to Step III". From here the course list is locked.

 STEPS III AND IV - signatures, one after another, exactly as on
 the paper form (STAGES in Config.gs):
   STEP III
   1. Signature of the Student's Advisor
        (sent to, and signable by, exactly the advisor email the
        student gave at intake; it must be an @example.edu staff
        address, not a student account, not the student's own.
        There is no fallback: if it is blank nobody can sign, and
        the Go-live check lists the form)
   2. Signature of the Student's Associate Dean
        (by college, ASSOC_DEANS in Config.gs; the Associate Dean's
        assistant is CC'd on the email and reminders only and
        cannot sign)
   3. Signature of the Office of Financial Grants and Scholarships
        (only if the student answered Yes to receiving a Home University
        financial grant or scholarship: INCLUDE HERE: your
        scholarship names)
   4. Signature of Sponsorship Manager
        (only if the student is sponsored by an external organization
        coordinated with the Home University Sponsorship Liaison Office)
   5. Signature of Exchange Office (any Exchange Office staff member), who also fills in
        "Exchange Office use only - Student type and Study Abroad Program type"
   6. Signature of Student ("by signing, you agree to the conditions
        stated on this form")
   STEP IV
   7. Signature of the Office of the Registrar. The Registration
        Officer registers the student as outgoing study abroad; the
        student emails them the signed CPF, their visa (or passport)
        and drops any Home University courses for that semester.
   A step that does not apply is recorded as "N/A" (not skipped),
   so the PDF shows every line like the paper form. Each step only
   starts when the one before it is done. Any decline in Step III or
   IV stops the form (DENIED).
   RESTART AFTER A DECLINE (Oct 12, 2026): if the decline was in
   Step III or IV (not Step I), the student's portal shows the
   reason and "Restart Steps III and IV". The student corrects the
   two funding answers (scholarship / sponsored), optionally goes
   back to Step II to change courses, and restarts: every Step III
   and IV signature is collected again from the advisor onwards;
   Step I and approved courses stay. Exchange Office gets a "Form restarted
   after a decline" email showing what changed, and the Log says
   RESTARTED_AFTER_DECLINE. Refused if the student already has
   another live form for the same trip, or (for an amendment) a
   newer amendment exists. Code: restartAfterDecline
   (Phase1_Courses.gs). A Step I decline stays final.

 COMPLETED
   After the Registrar signs, the final signed PDF is built (with
   the drawn signature pictures), saved in the form's Drive folder
   (link in the pdf_url column), and emailed to the student, CC Exchange Office
   and Registrar (and ALWAYS_CC), as the paper form's "CC: Student;
   Exchange Office" (pdf_sent_at records when). Then the form's signature images
   are deleted (section 2, SIGNATURE IMAGES). The PDF follows the
   paper form: student details, Step I, the Step II course table,
   the Step III signature lines, Step IV, and the 32 Conditions.

 CHANGING COURSES LATER (any time, as often as needed)
   - Step I / II: the student adds, edits or withdraws courses
     directly, even while others are waiting on departments.
   - Step III: "Change my courses" (reopenCourses) takes the form
     back to Step II and clears every Step III signature (their
     drawn images are deleted at once); the approver it was waiting
     on gets a "No action needed for now" email. Step III starts
     over from step 1 when the student passes the gate again
     (which checks the earned credits again). Nothing in the chain
     can be skipped.
   - Completed: "Amend this form" (amendForm) creates a new row,
     CPF-FA26-0001-A1 (then -A2 ...). Student details, Step I and
     every approved course are copied; carried courses keep their
     original approval (carried_from / approved_in columns) and can
     be removed or put back. New courses go to their HoDs as usual.
     Step I and Step III are NOT done again (Oct 2026): when the
     student confirms the course list, every Step III line is copied
     from the earlier form (carriedStage_ in Phase2_Chain.gs, Log:
     STAGE_CARRIED) and printed with "(carried from <ref>)". Only the
     student signature and Step IV (Registration Officer, Registrar)
     run again. Removing courses only works the same way.
     The amendment needs at least one change before Step III, and is
     refused if the form is below 45 earned credits. The earlier
     form stays valid until the amendment is COMPLETED (amended_by
     on the earlier row points at the amendment); the new PDF says
     which form it replaces and lists the changes. The earlier
     form's signed PDF is never rebuilt or changed. On the new PDF,
     signatures carried over from the earlier form (Step I, earlier
     course approvals) show their names, and a drawn one shows
     "Drawn signature, see original signed PDF <ref>" in place of
     the picture; the amendment's own new signatures show their
     pictures as usual, and are deleted after its PDF is sent.


 =================================================================
 4. STATUSES, AND WHAT THEY MEAN
 =================================================================
 Submissions tab, "status" column:
   STEP I - Exchange Office REVIEW                    waiting on the Exchange Office
   STEP II - COURSE APPROVALS             courses going to HoDs
   STEP III - APPROVALS IN PROGRESS       see current_stage:
        ADV = advisor, DEAN = associate dean, FIN = financial
        grants, SPON = sponsorship, Exchange Office = Exchange Office,
        RO = Registration Officer, REG = Registrar typed by
        the Registration Officer (both Step IV on the paper form; the status
        text still says STEP III so existing rows keep working)
   STEP III - AWAITING STUDENT SIGNATURE  current_stage = SIGN
   COMPLETED / DENIED / CANCELLED         closed, nothing waiting

 Courses tab, "status" column:
   DRAFT            student added it, not sent yet
   PENDING REVIEW   with the head of department
   WITH FACULTY     HoD forwarded it to a faculty member
   APPROVED / DENIED
   WITHDRAWN        student removed it
   SUPERSEDED       declined, then resubmitted or replaced
   On an amendment, a carried course (carried_from filled in) that
   the student removed is WITHDRAWN; the portal shows it as REMOVED.


 =================================================================
 5. WHO CAN OPEN WHAT (SIGN-IN AND SECURITY)
 =================================================================
 PRODUCTION: deploy with "Who has access: anyone in your institution" (set
 "access": "DOMAIN" in appsscript.json), so every visitor is signed in with an
 institution Google account. PUBLIC DEMO: this copy ships with
 "access": "ANYONE_ANONYMOUS" so anybody can open the link. Because the app
 runs as its owner (Execute as: Me), Google does not report the account of a
 visitor outside the owner's organization, so requireAccess_ refuses every
 page that needs a signed-in account and every action; visitors can see the
 start page and the Help & FAQ previews (?page=faq&role=student). Never use
 the public setting with real approver emails or real student data, and
 keep CFG.TEST_REDIRECT set. Links carry no
 secret code: every page and every action checks the signed-in
 account (requireAccess_ in Util.gs):
   student portal / signing   only the form's student_email
   HoD review page            only the batch's HoD (hod_email) or
                              the department's College/School
                              Designate (designate_email), or a
                              department assistant (assistant_email,
                              signs as Department Assistant), and
                              only if the form really has a
                              course for that HoD
   faculty review page        only the faculty member a course on
                              that form was forwarded to
   Step III / IV page         only that step's approver: exactly
                              the advisor email on the form, the
                              college's Associate Dean, or the
                              address in Config.gs; the Exchange Office step:
                              anyone in EXO_STAFF
   ASSOCIATE DEAN ASSISTANTS never sign. They are CC'd on the Step
   III email and reminders; opening the signing link with an
   assistant's account gives "You are copied on these emails as an
   assistant, for information only" (refuseAssistant_ in Util.gs).
   DEPARTMENT ASSISTANTS are CC'd on HoD emails and may sign the
   HoD review (Oct 8, 2026).
   Exchange Office "Confirm or decline" page (?page=hodcheck): Exchange Office staff only.
   Step I                     anyone in EXO_STAFF (Config.gs)
   Exchange Office staff can VIEW every page, and press "Send reminder now" for
   a student, but can only ACT on the Exchange Office steps.
   Exchange Office STAFF PORTAL (Oct 2026). The main CPF link opens the "EXO
   Staff portal" for Exchange Office staff (and ?page=staff opens it directly).
   It lists every form with search (name, student ID, email,
   reference, university, major) and filters (semester, year, host
   university, college, major, status), tiles that filter by step,
   course progress, who a Step III / IV form is waiting on, and an
   "Open form" button (plus "Step I" while Step I is open). Forms
   open in a new tab exactly as the student sees them.
   Who gets in: ONLY accounts on EXO_STAFF in Config.gs (plus
   CFG.EXO_EMAIL). There is no token, test-account or SELF_TEST_
   exception. The check (staffPortalAllowed_ in WebApp.gs) runs
   twice: in doGet before the page is built, and in getStaffForms()
   on every call, because any visitor could call a public function
   through google.script.run. The page itself holds no form data.
   Anyone else who opens the main link gets the normal student start
   page; at ?page=staff they get "EXO staff only" and nothing else.
   Opening a form from the portal still goes through requireAccess_,
   so staff can view and press "Send reminder now" but can only act
   on the Exchange Office steps. Staff who need a CPF for themselves (student
   workers) see "Your own forms" and "Start a new form" (?page=new)
   at the bottom of the portal.
   To give or remove access: edit EXO_STAFF, then redeploy (Deploy >
   Manage deployments > edit > New version). The self test checks
   that non-staff accounts, blank accounts and test accounts are
   refused.
   Nobody can approve their own form: if the signed-in account is
   the form's student (EXO_STAFF includes student workers), every
   approval action is refused.

 What a student cannot tamper with:
   - their email (taken from the sign-in, not typed),
   - course decisions, Home University equivalents, statuses, the chain order,
     or anyone's signature (all set server-side),
   - another student's form (the student_email check).
 What a student DOES declare themselves: scholarship and sponsor
 Yes/No (this decides whether Financial Grants and Sponsorship sign),
 credits, and who their advisor is. The advisor address must be an
 @example.edu staff address (not a b/g student account, not their own),
 but the code cannot know it is really their advisor. The Exchange Office sees
 all of these at Step I and should check them.
 The IP address is reported by the signer's browser, so it is an
 audit trail, not proof (see section 2).

 Other protections:
   - Drawn signature images: private folder, never shared, never
     shown on a page or in an email, ids stripped from everything
     sent to a browser, deleted after the final PDF (section 2).
     A drawn signature must be a real PNG under CFG.SIGNATURE_MAX_KB,
     checked on the server.
   - Maintenance tools (setUp, goLiveCheck, clearAllData, the link
     printers, sendReminders, refreshSemesterTabs,
     cleanupSignatureImages, retryFinalPdfs...) only run from
     the editor, the CPF menu or their own trigger; the web app
     refuses them (requireAdmin_ / requireAdminOrTrigger_ in Util.gs).
   - Every piece of text is stored exactly as typed (safeCell_):
     Sheets can never turn it into a date, a number or a formula.
   - Uploads must really be PDFs (checked on the file, not the name).
   - Every page escapes what it shows, so typed text cannot inject
     HTML or script.
   - clearAllData refuses to run while test mode is off.

 "Belongs to a different account" usually means the email on the
 form is wrong or an alias: fix it in the Sheet. Test who Google
 reports with the web app link + ?page=whoami


 =================================================================
 6. THINGS THAT RUN BY THEMSELVES
 =================================================================
 REMINDERS - every day at 8 AM (CFG.TZ), but only sends Mon-Thu
   (CFG.REMINDER_WEEKDAYS). Anyone who still has something waiting
   2 calendar days (CFG.REMINDER_AFTER_DAYS) after they were last emailed gets a reminder
   (HoD, faculty member, Exchange Office for Step I, current Step III approver),
   and keeps getting one every 2 days until they act. The HoD's and
   the Associate Dean's assistants are CC'd on reminders too. A reminder
   that falls on Fri-Sun goes out on Monday. To send on every day,
   set REMINDER_WEEKDAYS to [1, 2, 3, 4, 5, 6, 7].

 SEND REMINDER NOW - on the student portal the student can resend
   the email for whatever is currently waiting (a course with its
   HoD or faculty member, Step I, or the current Step III approver),
   once a minute per item, e.g. while standing in the approver's
   office. It restarts that person's 2-day clock.

 SEMESTER TABS - every day, one hour after the reminders. Rebuilds one
   read-only overview tab per exchange semester at the bottom of the
   Sheet. Nothing is moved or deleted. Semester = the season and year
   the student picked; if an old form has none, the semester the form
   was submitted in (Spring Jan-May, Summer Jun-Jul, Fall Aug-Dec). Run it any time from CPF menu > Refresh semester tabs
   now.

 SIGNATURE IMAGE CLEANUP - every day, two hours after the reminders
   (trigger cleanupSignatureImages). Deletes only the drawn signature
   images of forms that are DENIED or CANCELLED, and any image no row
   points to. Forms still in progress are never cleaned up, however
   old: their images stay in the private folder until the form is
   cancelled, denied or completed. Completed forms are never touched
   by it either. Run it any time from CPF menu > Clean up signature
   images now.

 All three need the triggers installed (CPF menu > Install
 triggers). To confirm they exist: this editor > Triggers (clock
 icon on the left) should list sendReminders, refreshSemesterTabs
 and cleanupSignatureImages.


 =================================================================
 7. THE CPF MENU (in the Sheet)
 =================================================================
   Set up / repair tabs       creates any missing tab or column.
                              Safe to run any time, never deletes.
   Show web app link          the student link
   Go-live check              health check, prints OK / FIX / NOTE
                              lines. Changes nothing. Run it first
                              whenever something seems off.
   Send reminders now         runs the reminder job now (only
                              people who are due get one), on any
                              day of the week
   Open approved-course catalog
   Rebuild approved-course catalog
                              re-adds every approved course.
                              Safe to run again (skips duplicates)
   Refresh semester tabs now  rebuilds the semester overview tabs
   Clean up signature images now
                              the daily signature cleanup, now
   Retry final PDFs           for completed forms whose final PDF
                              could not be built, saved or emailed:
                              reuses a saved PDF, emails it if it
                              was never sent, then deletes the
                              signature images. Safe to run again
   Install triggers           (re)creates the daily reminder,
                              semester tab and signature cleanup
                              triggers. Running it twice does not
                              duplicate them.
   Load department heads      OVERWRITES the Departments tab with
                              the list in SheetSetup.gs (DEPT_SEED)
                              and re-points open courses to the
                              right HoD

 If the CPF menu is missing, reload the Sheet (it is added when the
 Sheet opens).


 =================================================================
 8. FIRST-TIME DEPLOYMENT (FROM NOTHING)
 =================================================================
 Do this signed in as the account that will OWN the workflow
 (ideally the shared office account; see section 12).

   1. Create a new Google Sheet, e.g. "CPF Workflow". Extensions >
      Apps Script opens the script bound to it.
   2. Project Settings (gear icon) > tick "Show appsscript.json
      manifest file in editor". Open appsscript.json and replace its
      contents with the appsscript.json from this folder.
   3. Create every other file with the same name and paste its
      contents in:
        Script files (+ > Script): Catalog, Code, Config, Email,
          Faculty, Logo, Phase0_Intake, Phase1_Courses,
          Phase2_Chain, README, Semesters, SheetSetup, Signatures,
          Test, Util, WebApp. Type the name WITHOUT ".gs".
        HTML files (+ > HTML): FacultyReview, Help, Intake, Portal,
          Review, Script, Sign, Stage, StepOne, Styles. Type the
          name WITHOUT ".html", and replace the default content.
      File names must match exactly: the code includes pages by name.
           Delete the default "Code.gs" content if it still says
      myFunction (this folder's Code.gs replaces it).
   4. Save (Ctrl+S). Check Config.gs: approver emails, EXO_STAFF,
      FROM_EMAIL, REPLY_TO, ALWAYS_CC. Leave TEST_REDIRECT set to
      your own address for now (test mode).
   5. In the function dropdown pick setUp, press Run, and accept the
      permissions Google asks for. This creates every tab, fills
      Departments and Universities, creates the private signature
      folder, and saves SHEET_ID, SIG_FOLDER_ID and CPF_SECRET.
      Check the left-hand "Services" list shows "Drive" (it comes
      from appsscript.json; it is what deletes signature images
      permanently). If not: Services (+) > Drive API > v3 > Add.
   6. Deploy > New deployment > type: Web app.
        Execute as:     Me
        Who has access: Anyone (public demo) or
                        your institution only (production; see section 5)
      Deploy, and copy the web app URL.
   7. Gmail of the owner account > Settings > Accounts > "Send mail
      as" > add exchange-office.include-here@example.edu and verify it (skip if the owner IS
      exchange-office.include-here@example.edu). Until this is done, emails go out from the
      owner's own address, still with reply-to exchange-office.include-here@example.edu.
   8. Reload the Sheet. CPF menu > Install triggers.
   9. Run the checks in section 9 (self test while still in test
      mode).
  10. Go live: Config.gs > TEST_REDIRECT: '' (empty). Save, then
      redeploy (section 11, "After any code change"). Run CPF menu >
      Go-live check: everything should say OK. Publish the student
      link (CPF menu > Show web app link).


 =================================================================
 9. CHECKING THAT IT WORKS
 =================================================================
   - CPF menu > Go-live check. Prints OK / FIX / NOTE for: test
     mode, the sender, reply-to and CC, every approver address, Exchange Office
     staff, the Departments tab, triggers, the web app link, the
     catalog, forms stuck on a Step III stage that no longer exists
     or with no approver address, open forms below 45 earned
     credits, each department's optional designate, the "CPF
     Syllabi" and private signature folders (each exists, is owned by
     the script owner and is not shared), the catalog's owner, no
     shared signature files, no images left for completed forms,
     whether images are deleted permanently or moved to the trash,
     and leftover test data. It changes nothing.
   - runSelfTest (Test.gs, run from the editor). Only runs in test
     mode, so no real approver is emailed. Creates a fake form and
     pushes it through everything: the four funding answers, drawn
     signature checks, earned credits below 45 refused, intake,
     duplicate checks, Step I, courses, a decline and resubmit, a
     faculty review, HoD approvals (one with a blank grade), Step III
     in the right order, "Change my courses", a drawn student
     signature, completion with a PDF and the image deleted after
     it, then an amendment (no image copied). It then runs the extra
     checks (runSelfTestExtras_): intake refusals, a non-PDF upload,
     a held HoD email on "Save and send", edit / withdraw / reminder
     rules, every HoD input check, the catalog row, a sponsor-only
     form, Step III order and input checks, a Step I decline (and its
     drawn image cleaned up), a Step III decline, a cancelled form,
     an academic-year form and the semester tabs. These are a SECOND
     run: pick runSelfTestExtras after runSelfTest (each about 3
     minutes; together they would come close to the 6-minute limit).
     (Assistant refusal cannot be tested here: the self test plays
     every role from the editor. Test it by opening a review link
     with an assistant's account in test mode.) Every result is checked; the Execution log ends with
     ALL CHECKS PASSED or says exactly what failed.
     Afterwards run deleteTestData to remove only what it created.
   - Web app link + ?page=whoami shows which institution account Google
     reports for you and whether it counts as Exchange Office staff.
   - Web app link + ?page=faq&role=student (or hod, faculty, stage,
     exo) shows each role's Help & FAQ without any form data.
   - The Log tab shows every action and every email as it happens,
     in plain English in the what_happened column.


 =================================================================
 10. EVERYDAY CHECKS AND FIXES (COMMON PROBLEMS)
 =================================================================
 "Where is this student's form?"
   Submissions tab > find the student_id > status + current_stage.
   Then filter the Courses and Log tabs by that submission_id.
   The Log shows every step with time and who did it.
   Every form, old or new, is in Submissions; the semester tabs list
   them by semester.

 "The approver says they never got the email"
   - Log tab: look for COURSES_SENT / STAGE_STARTED for that form
     to confirm it was sent, and to which address. A MAIL_FAILED
     line means Gmail refused it (the detail says why, e.g. the
     daily sending quota).
   - Ask them to check spam and search for [CPF].
   - Ask the student to press "Send reminder now" on their portal.
   - Check Config.gs: if TEST_REDIRECT has an address, the system
     is in TEST MODE and every email goes to that one address.

 "The student lost their link"
   They can search their inbox for [CPF]. Otherwise run
   listStudentLinks (Test.gs) from this editor and copy their link
   from the Execution log.

 "A student says the form refuses their earned credits"
   Fewer than 45 (or not a number) is a hard block by Exchange Office rule. If
   their number really is 45 or more, they typed it wrong: ask them
   to start again. For an open form listed by the Go-live check as
   below 45: correct credits_completed on the Submissions tab if it
   was mistyped (it then passes the gate), or type CANCELLED in its
   status cell. Nothing is deleted automatically.

 "An assistant says the review link does not open"
   A DEPARTMENT assistant may open and sign the HoD review, but only
   if their address is in assistant_email on that department's row
   of the Departments tab (several, comma separated) and they are
   signed in with that account (check ?page=whoami). An ASSOCIATE
   DEAN's assistant is refused on purpose: they are CC'd for
   information only and should forward the email to the Associate
   Dean.

 "A student says they cannot send a course (head of department email)"
   The HoD email they typed is not the one on the Departments tab,
   so the course is held. Open the "Confirm head of department
   email" email sent to exchange-office.include-here@example.edu and press Confirm or Decline
   (Go-live check lists every held course). The student is then
   emailed and can send it.

 "A completed form has no PDF, or the student never got it"
   Log tab: PDF_FAILED or PDF_EMAIL_FAILED says why. The signature
   images are kept until it works. Fix the cause, then CPF menu >
   Retry final PDFs: it reuses a saved PDF (never rebuilds one),
   emails it if it was never sent, then deletes the images.

 "A head of department / assistant changed"
   - New courses: just edit their row in the Departments tab.
     Several assistants can go in one cell, comma separated.
     hod_email (the head of department) signs; a College/School
     Designate, if the college has one, goes in designate_email and
     may sign too. Department assistants (assistant_email) may sign
     the HoD review as well.
   - Courses already sent keep the old address. To move those too:
     update the same row in DEPT_SEED in SheetSetup.gs, save, then
     CPF menu > Load department heads. Then ask the student to press
     "Send reminder now" so the new HoD gets the email.
   - Re-check the department list every semester.

 "The Associate Dean / Registrar / Financial / Sponsorship person
 changed"
   Edit the email in Config.gs (ASSOC_DEANS, ASSOC_DEAN_ASSISTANTS,
   REGISTRAR_EMAIL, FINANCIAL_EMAIL, SPONSORSHIP_EMAIL), then
   redeploy (see section 11).

 "The student typed the wrong advisor email"
   Fix advisor_email on the Submissions tab. If the form is already
   waiting on the advisor, ask the student to press "Send reminder
   now" so the right person gets the email.

 "A reviewer gets 'There are no courses for you to review on this
 form'"
   They are signed in with an account that has no course on that
   form: either the wrong account (check ?page=whoami), or the
   course was moved to another HoD / withdrawn. Check the hod_email
   and faculty_email columns on the Courses tab.

 "An approver gets 'This is your own form'"
   The signed-in account is the form's student. Another approver
   (e.g. another Exchange Office staff member) has to act.

 "A form is stuck in Step III, waiting on a step that no longer
 exists"
   Only happens if a stage is removed from STAGES while a form is
   waiting on it. The Go-live check lists such forms. Ask the
   student to press "Change my courses" and then "I am satisfied -
   proceed to Step III": Step III restarts in the current order.

 "A page says 'The form is busy right now'"
   Another action held the lock for 30 seconds (CFG.LOCK_WAIT_MS).
   Wait a moment and try again. If it keeps happening, look at
   Executions (below) for a run that is slow or failing.

 "A student spelled the university differently"
   Add the official name and the spelling to the Universities tab
   (aliases column). New forms are then stored under the official
   name. To fix an existing form, correct host_university in the
   Submissions tab.

 "Cancel a form"
   There is no button for it. Type CANCELLED in its status cell.
   Reminders stop, and it stays in the Sheet like every other form.

 "Fix a typo in a form"
   You can edit cells in the Sheet directly. But:
   - never rename header cells in row 1 (the script finds columns
     by their header name; column order does not matter)
   - never change submission_id or course_row_id (links break)

 "The PDF is missing on a completed form"
   See "A completed form has no PDF, or the student never got it"
   above (CPF menu > Retry final PDFs).

 "A course is missing from the approved-course catalog"
   Log tab: CATALOG_FAILED gives the reason. CPF menu > Rebuild
   approved-course catalog adds anything missing (no duplicates).

 "Something failed / a page shows an error"
   This editor > Executions (list icon on the left) shows every
   run with its error message. Also check the Log tab. Then run the
   Go-live check.


 =================================================================
 11. CHANGING SETTINGS OR CODE SAFELY
 =================================================================
 All settings live in Config.gs: approver emails, Exchange Office staff, sender,
 reply-to, CC, reminder timing, minimum earned credits
 (MIN_EARNED_CREDITS), grade wording (GRADE_*), signature image size
 and lifetime (SIGNATURE_*), course types, GER
 areas, conditions text, semester dates, and the Step III chain
 (STAGES). Never put student data or Sheet contents in the code;
 IDs the script needs are saved as Script properties (section 2).

 CHANGING THE STEP III / IV CHAIN: only when the official paper form
   changes. Edit STAGES in Config.gs (the order of the list is the
   order of the chain; afterSignature marks the stage the student
   signs before; block is the paper form's wording of the line).
   Forms already in Step III carry on in the new order. A form
   waiting on a stage you removed is stuck: see "A form is stuck in
   Step III" in section 10.

 TEST MODE: Config.gs > TEST_REDIRECT.
   With an address in it, EVERY email goes to that address instead,
   with the real recipient shown in the subject and in a yellow
   banner. Set it to '' (empty) to go live.

 AFTER ANY CODE CHANGE you must redeploy, or the web pages keep
   running the old version:
   1. Save (Ctrl+S).
   2. Deploy > Manage deployments > pencil icon (Edit) >
      Version: "New version" > Deploy.
   This keeps the SAME link. Do NOT use "New deployment" for
   updates: that creates a different link.
   (Menu items, reminders and the semester tabs use the saved code
   straight away; only the web pages need the redeploy.)
   After an update that adds columns, run CPF menu > Set up / repair
   tabs once. (The Oct 2026 signature update added *_sig_method,
   *_sig_file and pdf_sent_at, and the private signature folder:
   until Set up / repair tabs has run, a drawn signature is refused
   with "Please choose Type for now"; typed ones work.)

 TESTING a change: put an address in TEST_REDIRECT, run runSelfTest,
   then deleteTestData (section 9).
   clearAllData WIPES every form, course, log row and the catalog.
   Only meant for before go-live. Do not run on live data. (The
   Sheet's File > Version history can restore it.)

 Do not rename the URL parameters in Email.gs to "sid" or "c":
 Google reserves them and the links would give a 400 error.


 =================================================================
 12. HANDOVER: WHEN THE OWNER OF THIS SCRIPT LEAVES
 =================================================================
 The web app runs as the account that deployed it. That account
 sends the emails (as exchange-office.include-here@example.edu if it is set up as a "Send mail
 as" address in that account's Gmail), owns the Drive folder, the
 catalog, the private signature folder, and owns the triggers. If that account
 is closed, the whole workflow stops. So before the owner leaves:

   1. Pick the new owner (ideally the exchange-office.include-here@example.edu account itself,
      or a permanent Exchange Office staff member).
   2. Transfer ownership of the Sheet (the script goes with it)
      and of the "CPF Syllabi" folder and everything inside it.
      File IDs do not change, so the script keeps finding them.
   3. Old owner: this editor > Triggers > delete your triggers.
   4. New owner: open the Sheet > CPF menu > Install triggers.
   5. New owner: Deploy > New deployment > Web app (Execute as:
      Me, Who has access: see section 5). Put the new link
      wherever the student link is published. Check CPF menu >
      Show web app link shows the new link.
      Forms already in progress: send people fresh links with
      listStudentLinks (Test.gs) if their old links stop working.
   6. New owner: in Gmail > Settings > Accounts > "Send mail as",
      add exchange-office.include-here@example.edu (unless the new owner IS exchange-office.include-here@example.edu).
   7. Config.gs: replace the old owner's personal address in
      ALWAYS_CC and TEST_REDIRECT, and remove them from EXO_STAFF
      if they leave the office. Save and redeploy.
   8. THE SIGNATURE FOLDER ("CPF Signature Images (private - do not
      share)", in the owner's My Drive, id in SIG_FOLDER_ID). It is
      owned by the script owner and must be owned by the NEW owner,
      or the script cannot read or delete the images. Nobody should
      ever share it, including during the handover. It only holds
      images of forms not yet completed (the rest are deleted after
      their final PDF), so the simplest path is:
        a. Old owner: CPF menu > Retry final PDFs, then Clean up
           signature images now.
        b. Old owner: in Drive, open the folder, select every file
           in it and the folder itself, Share > transfer ownership to
           the new owner (transferring a folder does NOT transfer the
           files in it; select them too). Do not add anyone else.
        c. Run the Go-live check as the new owner: the folder must
           be "owned by" the new owner and "not shared".
      If the transfer is impossible, the new owner can delete the
      SIG_FOLDER_ID script property: Set up / repair tabs then makes
      a new private folder (it will NOT adopt the old one, because
      the new owner does not own it). Drawn signatures still in the
      old folder then print as "Drawn signature, see original signed
      PDF" (a placeholder) on PDFs built later; ask the old owner to
      delete the old folder.
      The "CPF Syllabi" folder (ROOT_FOLDER_ID) must be transferred
      too (step 2), or the Go-live check reports it as not owned by
      the script owner.
   9. Run CPF menu > Go-live check. Everything should say OK.


 =================================================================
 13. FILE MAP
 =================================================================
   appsscript.json    project settings (time zone, web app access,
                      the Drive advanced service for deleting
                      signature images permanently)
   Catalog.gs         approved-course catalog
   Code.gs            short index of the files
   Config.gs          ALL settings: approvers, rules, wording,
                      statuses, Step III order (STAGES)
   Email.gs           every email the workflow sends + link builders
   Faculty.gs         optional faculty review inside Step II
   Logo.gs            Home University logo embedded for emails and PDF
   Phase0_Intake.gs   new form, university names, references,
                      Drive folders, uploads, Step I
   Phase1_Courses.gs  Step II: courses, HoD review, the gate,
                      "Change my courses", amendments,
                      "Send reminder now" buttons
   Phase2_Chain.gs    Step III chain, student signature, PDF,
                      daily reminders
   README.gs          this file
   Semesters.gs       the read-only overview tab per exchange semester
   SheetSetup.gs      setUp, the CPF menu, triggers, Departments
                      list (DEPT_SEED)
   Signatures.gs      Draw / Type signatures: checking a drawn PNG,
                      the private image folder, drawing images into
                      the final PDF only, deleting them afterwards,
                      the daily cleanup, Retry final PDFs
   Test.gs           self test, go-live check, link printers,
                      clean-up tools
   Util.gs            reading / writing the Sheet, locking, sign-in
                      and security checks, logging, signature and IP
                      helpers, small helpers
   WebApp.gs          doGet: decides which page to show; the Exchange Office
                      staff portal (who may open it, its form list)

   Pages (.html), in the same alphabetical order
   FacultyReview      faculty member review page
   Help               the Help & FAQ button and panel on every page,
                      with separate questions for students, heads of
                      department, faculty, Step III approvers and the
                      Exchange Office. Edit the questions and answers here, then
                      redeploy.
   Intake             new form (student)
   Portal             student's portal: courses, progress, resend
   Review             head of department review page
   Script             shared page code: the Draw / Type signature pad,
                      the IP address lookup that goes with a
                      signature, the history panel
   Sign               student signature page
   Staff              Exchange Office Staff portal: every form, search, filters
                      (data from getStaffForms in WebApp.gs)
   Stage              Step III approver page
   StepOne            Exchange Office Step I page
   Styles             shared look

   In the editor the files are listed in the same order, so this map
  and the left-hand file list match.


 *******************************************************************/
