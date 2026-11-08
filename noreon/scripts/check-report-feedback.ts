import assert from 'node:assert/strict';
import { reportFailureCode, reportFailureMessage } from '@/lib/reports/feedback';
import { processUploadBatch } from '@/lib/reports/upload-batch';

for (const locale of ['en', 'hy'] as const) {
  assert.ok(reportFailureMessage('invalid_file', locale).includes('PDF'));
  assert.ok(reportFailureMessage('duplicate', locale).includes(locale === 'en' ? 'already uploaded' : 'արդեն վերբեռնված'));
  assert.ok(!reportFailureMessage('invalid_file', locale).includes('storage'));
  assert.ok(reportFailureMessage('report_limit', locale).includes('10'));
  assert.notEqual(reportFailureMessage('invalid_file', locale), reportFailureMessage('unavailable', locale));
}
assert.equal(reportFailureCode('sensitive internal detail'), 'unavailable');
for (const code of ['invalid_file', 'duplicate', 'report_limit', 'rate_limited']) {
  const failures = await processUploadBatch([1], async () => { throw new Error(reportFailureCode(code)); }, () => {});
  assert.equal(failures[0].error, code, 'The upload batch retains the actionable failure code');
}
console.log('Report feedback checks passed: localized file/duplicate/quota feedback and safe error-code propagation.');
