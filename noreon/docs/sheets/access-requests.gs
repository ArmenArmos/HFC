/**
 * Receives the homepage form and appends one row.
 *
 * This file is not built or deployed by this repo. It is the source of the Apps
 * Script bound to the requests spreadsheet, kept here so the endpoint the app
 * depends on is reviewable rather than existing only inside somebody's Google
 * account. Editing it here changes nothing until it is pasted into the script
 * editor and redeployed; see README.md in this folder.
 */

/** Must equal SHEETS_WEBHOOK_SECRET in the app's environment. */
var SECRET = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');

/** The tab rows are appended to. */
var SHEET_NAME = 'Requests';

var HEADERS = [
  'Received',
  'Intent',
  'First name',
  'Last name',
  'Email',
  'Notes',
  'Language',
];

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * A web app deployed "anyone, even anonymous" is a URL anybody can find and
 * POST to, so the shared secret is the only thing between the form and a
 * spreadsheet full of junk. It is compared here before anything is written.
 *
 * Apps Script cannot return 401 from a web app — every response is 200 — so the
 * caller decides by reading `ok`, not the status. The server action does.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty body' });
    }

    var body = JSON.parse(e.postData.contents);

    if (!SECRET || body.secret !== SECRET) {
      return json({ ok: false, error: 'bad secret' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
    }
    // A sheet somebody cleared by hand still needs its header row back, so this
    // checks the row rather than assuming the first write created it.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }

    // Two people submitting at the same moment would otherwise race for the
    // same row. The lock is cheap and this endpoint is low traffic.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      sheet.appendRow([
        new Date(),
        body.intent || '',
        body.firstName || '',
        body.lastName || '',
        body.email || '',
        body.notes || '',
        body.locale || '',
      ]);
    } finally {
      lock.releaseLock();
    }

    return json({ ok: true });
  } catch (error) {
    // Logged to the script's executions view, not returned: the caller gets a
    // flat failure, because an error string from here would reach a stranger.
    console.error(error);
    return json({ ok: false, error: 'write failed' });
  }
}

/** A GET on the deployment URL, so "is it alive" does not need a POST. */
function doGet() {
  return json({ ok: true, service: 'noreon access requests' });
}
