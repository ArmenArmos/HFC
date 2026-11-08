import assert from 'node:assert/strict';
import {checkDraft,parseMedicationTimes as times,BAD_TIME,TOO_MANY_TIMES,NEEDS_DOSE,NEEDS_TIME} from '@/lib/service-workflow/draft-input';
import {staffServerText} from '@/lib/staff/staff-server-copy';
// Gohar QA 161: three times typed on any keyboard save, and a refused draft names the field that failed.
const cases:Array<[string,string[]]>=[
 ['09:00, 15:00, 20:00',['09:00','15:00','20:00']],
 ['09:00,15:00,20:00',['09:00','15:00','20:00']],
 ['09:00 15:00 20:00',['09:00','15:00','20:00']],
 ['09:00; 15:00; 20:00',['09:00','15:00','20:00']],
 ['09:00/15:00/20:00',['09:00','15:00','20:00']],
 ['09:00، 15:00',['09:00','15:00']],          // Arabic comma
 ['09:00՝ 15:00',['09:00','15:00']],           // Armenian comma
 ['09:00，15:00',['09:00','15:00']],           // full-width comma
 ['9:00, 18:30',['09:00','18:30']],            // single-digit hour gets its zero
 ['9։00',['09:00']],                           // Armenian full stop typed as a colon
 [' , 09:00 ,, ',['09:00']],
 ['',[]],
 ['9am',['9am']],                              // kept as typed so the schema refuses it
];
for(const [input,want] of cases)assert.deepEqual(times(input),want,`times(${JSON.stringify(input)})`);
assert.deepEqual(times(null),[]);

const base={explanation:'Your readings are steady.',instructions:'Keep measuring twice a day.',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[] as string[]};
const ok=checkDraft({...base,medicationName:'Amlodipine',medicationDose:'5 mg',medicationTimes:times('09:00, 15:00, 20:00')});
assert.equal(ok.ok,true,'three valid times save');
const fail=(over:Record<string,unknown>)=>{const r=checkDraft({...base,...over});assert.equal(r.ok,false,JSON.stringify(over));return r.ok?[]:r.messages;};
assert.deepEqual(fail({explanation:'  '}),['Add the review explanation.']);
assert.deepEqual(fail({instructions:''}),['Add the care instructions.']);
assert.deepEqual(fail({explanation:'a'.repeat(1501)}),['Shorten the review explanation to 1500 characters or fewer.']);
assert.deepEqual(fail({instructions:'a'.repeat(1501)}),['Shorten the care instructions to 1500 characters or fewer.']);
assert.deepEqual(fail({followUp:'a'.repeat(501)}),['Shorten the follow-up to 500 characters or fewer.']);
assert.deepEqual(fail({medicationName:'a'.repeat(121),medicationDose:'5 mg',medicationTimes:['09:00']}),['Shorten the medicine name to 120 characters or fewer.']);
assert.deepEqual(fail({medicationName:'A',medicationDose:'a'.repeat(121),medicationTimes:['09:00']}),['Shorten the dose to 120 characters or fewer.']);
assert.deepEqual(fail({medicationInstructions:'a'.repeat(501)}),['Shorten the medicine instructions to 500 characters or fewer.']);
assert.deepEqual(fail({medicationName:'A',medicationDose:'5 mg',medicationTimes:times('25:00')}),[BAD_TIME]);
assert.deepEqual(fail({medicationName:'A',medicationDose:'5 mg',medicationTimes:times('8, 20:00')}),[BAD_TIME]);
assert.deepEqual(fail({medicationName:'A',medicationDose:'5 mg',medicationTimes:times('06:00 10:00 14:00 18:00 22:00')}),[TOO_MANY_TIMES]);
assert.deepEqual(fail({medicationName:'A',medicationTimes:['09:00']}),[NEEDS_DOSE]);
assert.deepEqual(fail({medicationName:'A',medicationDose:'5 mg'}),[NEEDS_TIME]);
assert.deepEqual(fail({medicationName:'A'}),[NEEDS_DOSE,NEEDS_TIME]);
// Exact limits still pass; trimmed text is what counts, as in the schema.
assert.equal(checkDraft({...base,explanation:'a'.repeat(1500),followUp:` ${'a'.repeat(500)} `}).ok,true);
// A dose or times without a medicine name are allowed, as workspace_valid_review_draft allows them.
assert.equal(checkDraft({...base,medicationDose:'5 mg'}).ok,true);
// Several failures are listed together, in form order.
assert.deepEqual(fail({explanation:'',followUp:'a'.repeat(501),medicationName:'A'}),['Add the review explanation.','Shorten the follow-up to 500 characters or fewer.',NEEDS_DOSE,NEEDS_TIME]);

// Every message has Armenian and Russian text, and a multi-line result is translated line by line.
const all=['Add the review explanation.','Add the care instructions.','Shorten the review explanation to 1500 characters or fewer.','Shorten the care instructions to 1500 characters or fewer.','Shorten the follow-up to 500 characters or fewer.','Shorten the medicine name to 120 characters or fewer.','Shorten the dose to 120 characters or fewer.','Shorten the medicine instructions to 500 characters or fewer.',BAD_TIME,TOO_MANY_TIMES,NEEDS_DOSE,NEEDS_TIME,'The case details are out of date. Reload the case and save again.'];
for(const m of all)for(const l of ['hy','ru'] as const){const t=staffServerText(l,m);assert.notEqual(t,m,`${l}: ${m}`);const n=m.match(/\d+/g);if(n)for(const d of n)assert.ok(t.includes(d),`${l} keeps ${d}: ${m}`);}
assert.equal(staffServerText('ru',`${NEEDS_DOSE}\n${NEEDS_TIME}`),`${staffServerText('ru',NEEDS_DOSE)}\n${staffServerText('ru',NEEDS_TIME)}`);
assert.equal(staffServerText('en',`${NEEDS_DOSE}\n${NEEDS_TIME}`),`${NEEDS_DOSE}\n${NEEDS_TIME}`);
console.log('draft field errors: ok');
