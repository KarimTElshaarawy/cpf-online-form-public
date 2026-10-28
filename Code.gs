/*******************************************************************
 * CPF Workflow - International Exchange Office
 *
 *   README.gs          how everything works, and how to run and fix it
 *   Config.gs          settings, approvers, Exchange Office staff, conditions, statuses
 *   Util.gs            cached sheet data layer, sign-in checks, text clean-up, logging
 *   SheetSetup.gs      setUp(), the CPF menu, Departments and Universities lists
 *   Email.gs           every notification the workflow sends
 *   Phase0_Intake.gs   first submission, university names, references, uploads, Step I
 *   Phase1_Courses.gs  the per-course approval loop, the gate, changing courses later
 *                      (Change my courses, amendments), Send reminder now
 *   Faculty.gs         optional faculty review inside Step II
 *   Phase2_Chain.gs    Step III chain, signature, PDF, daily reminders
 *   Catalog.gs         approved-course catalog for the Exchange Office (one tab per university)
 *   Semesters.gs       one read-only overview tab per exchange semester
 *   Signatures.gs      Draw / Type signatures; private drawn images, used only in
 *                      the final PDF and deleted after it
 *   WebApp.gs          doGet routing; the Exchange Office staff portal (EXO_STAFF only)
 *   Logo.gs            embedded Home University logo
 *   Test.gs            self test, go-live check and data clean-up tools
 *   *.html             the pages people see; Help.html is the Help & FAQ panel
 *
 * First run: open the Sheet, CPF menu > Set up / repair tabs,
 * then Deploy > New deployment > Web app.
 *******************************************************************/
