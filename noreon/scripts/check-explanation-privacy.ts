import assert from 'node:assert/strict';
import {validateStaffAiInput} from '@/lib/staff/ai-input';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
import type {CaseEvidence} from '@/lib/service-workflow/case-summary';
const original=structuredClone(SAMPLE_EXTRACTION);
const request={op:'explain',consent:true,locale:'en',reportId:'report-one',reportRevision:2,contentRevision:1};
const result=validateStaffAiInput(request,{evidenceRevision:0,evidence:{} as CaseEvidence,reports:[{id:"report-one",revision:2,contentRevision:1,state:"confirmed",reviewed:original}]});
assert.equal(result.op,'explain');
if(result.op==='explain'){
 assert.equal(result.reviewed.personName,null,'Subject identity is not needed for explanation');
 assert.equal(result.reviewed.laboratory,null,'Laboratory identity is not needed for explanation');
 assert.deepEqual(result.reviewed.rows,original.rows,'Printed values, references and row indexes must survive');
 assert.deepEqual(original,SAMPLE_EXTRACTION,'Saved clinical evidence is never modified');
}
console.log('Explanation request minimization removes structured identities while preserving source evidence.');
