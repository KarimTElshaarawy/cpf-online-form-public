# CPF Online Form (public template)

A Google Apps Script web app that moves an outgoing-exchange **Course Permission Form**
through its approvals: student intake, exchange-office review, head-of-department course
approvals, step III/IV signatures and a final signed PDF. It runs entirely on Google
(Sheets, Drive, Gmail); there is nothing else to host. Full documentation is in `README.gs`.

This is a sanitized copy: every person, email address, student ID, institution name, logo,
brand colour, partner university and institution-specific policy text has been removed or
replaced with an `INCLUDE HERE` placeholder.

## Placeholders to fill in (search the project for `INCLUDE HERE`)

| Where | What |
|---|---|
| `Config.gs` | institution name, time zone, all approver / staff / sender emails, email domain (`example.edu`), college codes, conditions text, Step IV text, GER areas, scholarship and sponsor wording, minimum credits and GPA, brand colour |
| `SheetSetup.gs` | `DEPT_SEED` (departments and heads), `UNI_SEED` (partner universities) |
| `Logo.gs` | `LOGO_B64`, base64 of your own logo (a 1x1 transparent pixel is the placeholder) |
| `appsscript.json` | time zone |

Naming: `EXO` / "Exchange Office" is the office that runs the programme. `home_*` fields
are the home-university course fields (equivalent course code, name, credits).
College codes `COLA`..`COLD` and the 5 sample departments are dummies.

## Running it as a public demo

`appsscript.json` is set to `"access": "ANYONE_ANONYMOUS"` and `CFG.TEST_REDIRECT` holds a
placeholder address, so anyone with the link can open it and no real person is emailed.
Visitors outside the owner's organization are not identified by Google, so the app shows
the start page and the Help & FAQ previews but refuses every action that needs a
signed-in account. Do not deploy publicly with real approver emails or real student data.
For a real deployment set `"access": "DOMAIN"` and clear `TEST_REDIRECT` after testing.

## Deploy

See `README.gs`, section 8: create a Sheet, open Extensions > Apps Script, paste every file,
run `setUp`, then Deploy > Web app (Execute as: Me).

## Git hygiene

Create the new repository from these files with a fresh history. Do not fork or push the
original repository's history. Set a no-reply `git config user.email` before committing.
