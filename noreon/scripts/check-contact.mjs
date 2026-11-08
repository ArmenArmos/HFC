import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validContact } from '../lib/marketing/contact.ts';

const input = { id: 'test-request-00000001', name: 'Website test', email: 'test@example.com', message: '=sample', callback: true, phone: '+374 99 123456', website: '' };
assert.equal(validContact(input), true);
for (const change of [{ email: 'bad' }, { message: '' }, { phone: '' }, { callback: 'true' }, { name: 'x'.repeat(101) }, { id: 'short' }]) {
  assert.equal(validContact({ ...input, ...change }), false);
}
const rows = [];
const emails = [];
const cache = new Map();
let mailFails = false;
const sheet = {
  getLastRow: () => rows.length,
  appendRow: row => rows.push(row),
  setFrozenRows() {},
  getRange: (row, col, count) => ({ getValues: () => rows.slice(row - 1, row - 1 + count), setValue: value => { rows[row - 1][col - 1] = value; } }),
};
const context = vm.createContext({
  console, Date,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-secret' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
  CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
  Utilities: { base64EncodeWebSafe: value => Buffer.from(value).toString('base64url') },
  MailApp: { getRemainingDailyQuota: () => 10, sendEmail: email => { if (mailFails) throw new Error('test'); emails.push(email); } },
});
vm.runInContext(readFileSync(new URL('../docs/sheets/contact-requests.gs', import.meta.url), 'utf8'), context);
const post = data => context.doPost({ postData: { contents: JSON.stringify({ ...data, intent: 'contact', secret: 'test-secret' }) } });
assert.equal(context.doGet().contactVersion, 1);
assert.equal(post({ ...input, secret: undefined, email: 'bad' }).ok, false);
assert.equal(rows.length, 0);
assert.equal(post(input).notified, true);
assert.equal(rows.length, 2);
assert.equal(rows[1][4], "'=sample");
assert.equal(emails[0].to, 'info@noreon.health');
assert.equal(emails[0].replyTo, input.email);
assert.match(emails[0].body, /Phone: \+374/);
assert.equal(post(input).ok, true);
assert.equal(emails.length, 1);
assert.equal(rows.length, 2);
assert.equal(post({ ...input, id: 'test-request-00000002' }).ok, false);
mailFails = true;
const retry = { ...input, id: 'test-request-00000003', email: 'second@example.com' };
assert.equal(post(retry).ok, false);
assert.equal(rows[2][7], 'Pending');
mailFails = false;
assert.equal(post(retry).ok, true);
assert.equal(rows.length, 3);
assert.equal(rows[2][7], 'Sent');
assert.equal(emails.length, 2);
console.log('Contact validation, callback notification, saved requests, formula escaping, throttling, deduplication and notification retry passed.');

const { sendContact } = await import('../app/(marketing)/contact/actions.ts');
process.env.SHEETS_WEBHOOK_URL = 'https://example.invalid/test';
process.env.SHEETS_WEBHOOK_SECRET = 'test-secret';
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
assert.equal((await sendContact(input)).ok, false);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, contactVersion: 1, notified: true }) });
assert.equal((await sendContact(input)).ok, true);
globalThis.fetch = async () => { throw new Error('test transport failure'); };
assert.equal((await sendContact(input)).ok, false);
console.log('Server action rejects old webhook responses and transport failures; accepts confirmed contact delivery.');
