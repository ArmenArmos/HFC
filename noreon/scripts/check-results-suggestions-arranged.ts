/** QA 178: the Tests page never suggests a test that is already requested, booked, done or ordered. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {arrangedTestIds,withoutArrangedTests} from '@/lib/patient-care/suggestion-filter';
const t=(id:string,en:string)=>({id,name:{hy:`hy ${en}`,en,ru:`ru ${en}`}});
const plan=[t('lipid-ldl','Lipid profile and LDL-C'),t('hba1c','HbA1c'),t('ecg','ECG')];
const ids=(list:{id:string}[])=>list.map(x=>x.id);

assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({}))),['lipid-ldl','hba1c','ecg'],'Nothing arranged: every suggestion stays');
// A completed home-visit request (the QA 178 member) and an open one both cover their tests.
for(const status of ['completed','requested','confirmed'])
 assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({requests:[{status,requirements:[{id:'lipid-ldl'}]}]}))),['hba1c','ecg'],`${status} request`);
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({requests:[{status:'cancelled',requirements:[{id:'lipid-ldl'}]}]}))),['lipid-ldl','hba1c','ecg'],'A cancelled request is suggested again');
// Clinic visits: booked or attended cover their programme; a cancelled one does not.
const visit=(status:string)=>({status,program:[{id:'hba1c'}],current:{coveredTestIds:['hba1c']},proposed:{coveredTestIds:['hba1c']}});
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[visit('confirmed')]}))),['lipid-ldl','ecg']);
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[visit('cancelled')]}))),['lipid-ldl','hba1c','ecg']);
// Astra #404 F2: only what is arranged for the current programme hides a suggestion.
const prog=(currentProgramme:boolean,open:boolean)=>({currentProgramme,open});
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{...visit('confirmed'),programme:prog(false,false)}]}))),['lipid-ldl','hba1c','ecg'],'An earlier completed programme’s visit does not hide the test');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{...visit('confirmed'),programme:prog(false,true)}]}))),['lipid-ldl','ecg'],'An earlier visit still open covers its tests');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{...visit('confirmed'),programme:prog(true,false)}]}))),['lipid-ldl','ecg'],'A current programme visit covers its tests');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{status:'failed',program:[{id:'hba1c'}],current:null,proposed:{coveredTestIds:['hba1c']},programme:prog(true,false)}]}))),['lipid-ldl','hba1c','ecg'],'A failed first booking with no accepted visit is suggested again');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{status:'failed',program:[{id:'hba1c'},{id:'ecg'}],current:{coveredTestIds:['hba1c']},proposed:{coveredTestIds:['hba1c','ecg']},programme:prog(true,false)}]}))),['lipid-ldl','ecg'],'A failed change keeps only the accepted visit’s tests');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{status:'notification-pending',program:[{id:'hba1c'}],current:null,proposed:{coveredTestIds:['hba1c']},programme:prog(true,false)}]}))),['lipid-ldl','ecg'],'A pending booking covers its tests');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({appointments:[{...visit('cancelled'),programme:prog(true,false)}]}))),['lipid-ldl','hba1c','ecg'],'A cancelled current visit is suggested again');
assert.deepEqual(ids(withoutArrangedTests(plan,arrangedTestIds({requests:[{status:'completed',contextStale:true,requirements:[{id:'lipid-ldl'}]}]}))),['lipid-ldl','hba1c','ecg'],'A request from an earlier questionnaire context does not hide the test');
// Care-team orders match by name; a cancelled order does not hide the suggestion.
assert.deepEqual(ids(withoutArrangedTests(plan,new Set(),[{title:'ECG',status:'ordered'}])),['lipid-ldl','hba1c']);
assert.deepEqual(ids(withoutArrangedTests(plan,new Set(),[{title:'ECG',status:'cancelled'}])),['lipid-ldl','hba1c','ecg']);
// Failed reads leave suggestions as before.
assert.equal(withoutArrangedTests(plan,arrangedTestIds({requests:null,appointments:undefined})).length,3);
assert.match(readFileSync('components/patient-care/member-results-content.tsx','utf8'),/withoutArrangedTests\(buildPlan\(decision\), arrangedTestIds\(/,'The Tests page filters its suggestions');
console.log('Results suggestions: requested, booked, done and ordered tests are not suggested again; cancelled ones are.');
