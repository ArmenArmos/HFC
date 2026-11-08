import assert from 'node:assert/strict';
import {sameReportContent,reportContentTransition} from '@/lib/service-workflow/report-associations';
import {SAMPLE_EXTRACTION} from '@/lib/reports/demo';
const at='2026-10-11T08:00:00Z';
const old={id:'r',revision:4,contentRevision:2,state:'confirmed',explanation:{summary:'Original'},extraction:structuredClone(SAMPLE_EXTRACTION),reviewed:structuredClone(SAMPLE_EXTRACTION),associations:[{requirementId:'q',rowIndices:[0],contentRevision:2,actorId:'d',actorLabel:'Fictional doctor',confirmedAt:at}],associationHistory:[]};
const edit=structuredClone(old);edit.reviewed.rows[0].literal='3.3';
const changed=reportContentTransition(old,edit,at);assert.equal(changed.contentRevision,3);assert.equal(changed.associations.length,0);assert.equal(changed.associationHistory[0].reason,'content-changed');
const explanation=reportContentTransition(old,{...old,explanation:{summary:'Updated explanation'}},at);assert.equal(explanation.contentRevision,2);assert.equal(explanation.associations.length,1);
const downgraded=reportContentTransition(old,{...old,state:'needs_review'},at);assert.equal(downgraded.contentRevision,2);assert.equal(downgraded.associations.length,0);assert.equal(downgraded.associationHistory[0].reason,'unconfirmed');
assert.equal(old.associations.length,1,'prior report is immutable');
console.log('Report content revision and association retirement checks passed.');

assert.equal(sameReportContent({rows:[{name:"LDL",literal:"3.2"}],reportDate:null},{reportDate:null,rows:[{literal:"3.2",name:"LDL"}]}),true,"database JSON key ordering must not make a saved source look dirty");
assert.equal(sameReportContent({rows:[{literal:"3.2"}]},{rows:[{literal:"3.3"}]}),false);
