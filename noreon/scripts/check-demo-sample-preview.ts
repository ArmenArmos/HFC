import assert from 'node:assert/strict';
import {sampleReports, sampleReportPreview} from '@/lib/reports/demo';
const fixture = sampleReports()[0];
assert.equal(sampleReportPreview(fixture)?.rows[0].literal, '3.2');
assert.equal(sampleReportPreview({...fixture, extraction: {...fixture.extraction as object, rows: [{name:'Stored sample',literal:'9.1',unit:null,reference:null,page:1,snippet:'Stored sample 9.1',uncertain:false}]}})?.rows[0].literal, '9.1', 'Preview uses stored fixture values, not hard-coded replacement');
assert.equal(sampleReportPreview({...fixture, model:'gpt-5',prompt_version:'report-import-v1'}), null, 'Unpublished AI extraction remains private');
assert.equal(sampleReportPreview({...fixture, extraction:null}), null);
console.log('Sample preview only exposes validated prepared fixtures; AI reports remain redacted.');
