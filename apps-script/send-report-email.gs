/**
 * apps-script/send-report-email.gs
 * ===================================
 * ALTERNATIVE to the app's own "Email Report" button
 * (app/api/send-report/route.ts + lib/mailer.ts): sends the summary
 * email straight from Google Sheets itself, using an installable
 * onChange trigger -- so no GMAIL_USER/GMAIL_APP_PASSWORD env vars are
 * needed in the app at all. Apps Script sends as whatever Google
 * account owns this Sheet.
 *
 * This fires automatically whenever "Save to Google Sheet" on the
 * Summary page appends a row -- there's no separate button for this
 * path, it just happens. Keep both this AND the app's own Email Report
 * button if you want either trigger to work (they don't conflict).
 *
 * Setup (one-time):
 *   1. Open the Google Sheet -> Extensions -> Apps Script.
 *   2. Delete the default Code.gs contents and paste this whole file in.
 *   3. Update SHEET_TAB_NAME below if your tab isn't "Sheet1" (must
 *      match GOOGLE_SHEET_TAB in .env.local / Vercel).
 *   4. In the editor's toolbar, pick `setup` from the function dropdown
 *      and click Run. The first run asks you to authorize Gmail/Sheets
 *      access for this script -- approve it (it's acting as you, the
 *      Sheet's owner).
 *   5. Done. Every row the app appends from now on triggers an email.
 *
 * Column layout assumed (A-L, matches app/api/save-result/route.ts):
 *   A Timestamp, B Name, C Email, D DOB, E Province,
 *   F Test1 Human%, G Test1 Geometric%,
 *   H Test2 Face%, I Test2 Object%,
 *   J Test3 Accuracy%,
 *   K Overall Score, L Risk Level.
 */

const SHEET_TAB_NAME = "Sheet1"; // must match GOOGLE_SHEET_TAB in the app
const LAST_ROW_PROPERTY = "LAST_EMAILED_ROW";

function setup() {
  // Clear any previous trigger for this function first, so re-running
  // setup() doesn't create duplicates that'd send the same email twice.
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "onSheetChange") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onSheetChange")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onChange()
    .create();

  // Start from the sheet's current last row so setup() itself doesn't
  // fire an email for every row that already exists.
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TAB_NAME);
  PropertiesService.getScriptProperties().setProperty(
    LAST_ROW_PROPERTY, String(sheet.getLastRow()),
  );
  Logger.log("Trigger installed -- new rows from now on will send an email.");
}

function onSheetChange() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TAB_NAME);
  const lastRow = sheet.getLastRow();
  const props = PropertiesService.getScriptProperties();
  const lastEmailed = Number(props.getProperty(LAST_ROW_PROPERTY) || "0");

  if (lastRow <= lastEmailed) return; // nothing new (e.g. just a formatting change)

  for (let row = lastEmailed + 1; row <= lastRow; row++) {
    sendReportForRow(sheet, row);
  }
  props.setProperty(LAST_ROW_PROPERTY, String(lastRow));
}

function sendReportForRow(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
  const [
    , name, email, , , // A-E: timestamp, name, email, dob, province
    humanPct, geometricPct, // F-G: Test 1
    facePct, objectPct, // H-I: Test 2
    accuracyPct, // J: Test 3
    overallScore, riskLevel, // K-L
  ] = values;

  if (!email) return; // nothing to send to

  const subject = "Your LookAtMe Screening Summary";
  const body =
    `Hi ${name || "there"},\n\n` +
    "Here is the screening summary for your recent session.\n\n" +
    `Overall Score: ${overallScore} / 100\n` +
    `Risk Level: ${riskLevel}\n` +
    `Test 1 -- Human/Geometric: ${humanPct}% / ${geometricPct}%\n` +
    `Test 2 -- Face/Object: ${facePct}% / ${objectPct}%\n` +
    `Test 3 -- Accuracy: ${accuracyPct}%\n\n` +
    "This is a preliminary screening tool, not a diagnostic instrument. " +
    "Discuss results with a qualified healthcare professional.";

  MailApp.sendEmail(email, subject, body);
}
