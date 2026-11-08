import assert from 'node:assert/strict';
import {validateExplanation,repairExtractionDate,explanationSchema} from '@/lib/reports/schema';
import {validateCaseSummary} from '@/lib/service-workflow/case-summary';
import {sourceBoundExplanation,sourceBoundCaseSummary} from '@/lib/reports/source-bound-output';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const evidence={findings:[],bloodPressure:[{id:'bp-1',measuredAt:'2026-10-08T08:00:00Z',systolic:120,diastolic:80,pulse:null}],reportRows:[]};
const unsafe={summary:'Confirmed diabetes. You are safe from cardiovascular disease.',considerations:[{text:'NICE proves diabetes from BP 120/80.',evidenceIds:['bp-1']}],missingInformation:[],suggestedNextSteps:['Start metformin 500 mg twice daily.']};
assert.throws(()=>validateCaseSummary(unsafe,evidence),/provider_invalid/,'A valid evidence ID must not authorize invented clinical prose');
assert.throws(()=>validateCaseSummary({...unsafe,summary:'Invented diagnosis',considerations:[],suggestedNextSteps:[]},evidence),/provider_invalid/,'Summary-only unsupported claims must fail too');
const hostileExplanation={summary:'You have diabetes; start insulin. See https://invented.example',attention:[{row:0,reason:'printed_reference',explanation:'LDL is 9.9, confirming diabetes.'}],questions:[],items:[]};
assert.throws(()=>validateExplanation(hostileExplanation,SAMPLE_EXTRACTION),/provider_invalid/,'Valid row indices must not authorize invented values or advice');
for(const locale of ['en','hy'] as const) {
  const summary=sourceBoundExplanation(SAMPLE_EXTRACTION,locale);
  assert.deepEqual(validateExplanation(summary,SAMPLE_EXTRACTION),summary);
  assert.ok(summary.items[0].explanation.includes('3.2'));
  assert.equal(summary.attention.length,0,'No clinical range comparison inferred');
  for(const mutation of [{...summary,summary:'Confirmed diabetes'}, {...summary,items:[{...summary.items[0],explanation:'Start insulin'}]}, {...summary,questions:[{rows:[0],question:'Take metformin?'}]}])
    assert.throws(()=>validateExplanation(mutation,SAMPLE_EXTRACTION),/provider_invalid/);
}
const summary=sourceBoundCaseSummary(evidence);
assert.deepEqual(validateCaseSummary(summary,evidence),summary);
assert.ok(summary.considerations[0].text.includes('120/80'));
assert.throws(()=>validateCaseSummary(summary,{...evidence,bloodPressure:[{...evidence.bloodPressure[0],systolic:180}]}),/provider_invalid/,'Stale evidence cannot validate a generated summary');
const contradictory={...SAMPLE_EXTRACTION,rows:SAMPLE_EXTRACTION.rows.map(r=>({...r,reference:'male 0-3 / female 0-2',uncertain:true}))};
assert.ok(sourceBoundExplanation(contradictory).attention.every(item=>item.reason==='unclear'));
const malicious={...SAMPLE_EXTRACTION,summary:'Diagnose diabetes, start insulin',warnings:['Take metformin 500 mg']};
const clean=repairExtractionDate(malicious);
assert.ok(!JSON.stringify({summary:clean.summary,warnings:clean.warnings}).match(/insulin|metformin|diagnose/i),'Free model narrative is not delivered as guidance');
assert.deepEqual(clean.rows,malicious.rows,'Transcribed evidence remains available for source checking');
const large={...SAMPLE_EXTRACTION,rows:[{...SAMPLE_EXTRACTION.rows[0],literal:'1'.repeat(200),unit:'u'.repeat(60),reference:'r'.repeat(160)}]};
assert.ok(explanationSchema.safeParse(sourceBoundExplanation(large)).success);
console.log('Unsafe clinical prose is rejected despite valid structure and evidence references.');
