/**
 * @OnlyCurrentDoc
 * Bound to the contact requests spreadsheet; redeploy its web app after updating.
 */
function contactJson(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return contactJson({ ok: true, service: 'noreon contact requests', contactVersion: 1 });
}
function safeCell(value) {
  return /^\s*[=+@-]/.test(value) ? "'" + value : value;
}
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret || body.secret !== secret) return contactJson({ ok: false });
    if (body.intent !== 'contact' || typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.id)
      || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100
      || typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) || body.email.length > 320
      || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000
      || typeof body.callback !== 'boolean' || typeof body.phone !== 'string' || body.phone.length > 50
      || (body.callback && !/^[+\d().\s-]{6,50}$/.test(body.phone.trim()))) return contactJson({ ok: false });
    lock.waitLock(10000);
    var book = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName('Contact requests') || book.insertSheet('Contact requests');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Request ID', 'Received', 'Name', 'Email', 'Message', 'Callback', 'Phone', 'Notification']);
      sheet.setFrozenRows(1);
    }
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues() : [];
    var row = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === body.id) {
        row = i + 2;
        if (rows[i][7] === 'Sent') return contactJson({ ok: true, contactVersion: 1, notified: true });
        // A retry sends the originally saved message, never a modified replacement.
        body.name = String(rows[i][2]).replace(/^'/, '');
        body.email = String(rows[i][3]).replace(/^'/, '');
        body.message = String(rows[i][4]).replace(/^'/, '');
        body.callback = rows[i][5] === 'Yes';
        body.phone = String(rows[i][6]).replace(/^'/, '');
        break;
      }
    }
    var cache = CacheService.getScriptCache();
    var emailKey = 'contact:' + Utilities.base64EncodeWebSafe(body.email.toLowerCase());
    var total = Number(cache.get('contact-count') || '0');
    if (!row && (cache.get(emailKey) || total >= 10)) return contactJson({ ok: false });
    if (!row) {
      cache.put(emailKey, '1', 60);
      cache.put('contact-count', String(total + 1), 60);
      sheet.appendRow([body.id, new Date(), safeCell(body.name.trim()), safeCell(body.email.trim()), safeCell(body.message.trim()), body.callback ? 'Yes' : 'No', safeCell(body.callback ? body.phone.trim() : ''), 'Pending']);
      row = sheet.getLastRow();
    }
    if (MailApp.getRemainingDailyQuota() < 1) return contactJson({ ok: false });
    MailApp.sendEmail({
      to: 'info@noreon.health',
      replyTo: body.email.trim(),
      subject: body.callback ? 'Noreon website: callback requested' : 'Noreon website: new enquiry',
      body: 'Name: ' + body.name + '\nEmail: ' + body.email + '\nCallback: ' + (body.callback ? 'Yes\nPhone: ' + body.phone : 'No') + '\n\nMessage:\n' + body.message + '\n\nRequest ID: ' + body.id,
      name: 'Noreon website'
    });
    sheet.getRange(row, 8).setValue('Sent');
    return contactJson({ ok: true, contactVersion: 1, notified: true });
  } catch (error) {
    console.error('Contact request failed');
    return contactJson({ ok: false });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
/** Run once in the editor to grant permission to send notifications, without sending an email. */
function authorizeContactNotifications() {
  return MailApp.getRemainingDailyQuota();
}
