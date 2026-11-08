import assert from 'node:assert/strict';
import {taskReasons} from '@/lib/care-queue/contracts';

const task={reason:'bp_member_reported_high',summary:{entrySource:'patient_text_entry',systolic:180,diastolic:80}};
assert.equal(taskReasons(task,'en'),'180/80 mmHg · Member-reported, not verified','both queue surfaces must name the value and provenance');
console.log('PASS unverified BP task wording');

const {readReportedBpTasks}=await import('@/lib/care-queue/server');
const {ReportedBpTasks}=await import('@/components/staff/reported-bp-tasks');
const {unverifiedBpLabel}=await import('@/lib/patient/bp-provenance');
const React=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const row={...task,id:'b4000000-0000-4000-8000-000000000003',memberId:'b4000000-0000-4000-8000-000000000004',memberName:'Synthetic',queue:'nurse' as const,zone:null,ruleVersion:'typed-bp-1',redFlagsStatus:null,suggestedAction:'verify_bp',slaDeadline:null,status:'sent' as const,stateSeq:0,sandbox:false,createdAt:'2026-11-05T12:00:00Z',seenAt:null,answeredAt:null};
const inbox={ok:true,asOf:row.createdAt,role:'nurse',tasks:[row]};
const calls:{name:string;args:unknown}[]=[];
const client={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:inbox,error:null};}};
const rows=await readReportedBpTasks(client,'live');
assert.equal(rows?.[0].id,row.id,'Tasks reads the original Care queue row identity');
assert.deepEqual(calls,[{name:'care_queue_inbox',args:{p_queue:'nurse',p_view:'live'}}]);
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(ReportedBpTasks,{tasks:rows,locale,view:'live'}));
 assert.ok(html.includes(`180/80 ${{en:'mmHg',hy:'մմ ս.ս.',ru:'мм рт. ст.'}[locale]}`)&&html.includes(unverifiedBpLabel(locale)),`${locale} Tasks renders exact value and localized unit and label`);
 assert.ok(html.includes(`#task-${row.id}`),'Tasks opens the same task in Care queue');
}
assert.equal(await readReportedBpTasks({rpc:async()=>({data:null,error:{code:'failed'}})},'live'),null,'unavailable queue is not an empty list');
const unavailable=renderToStaticMarkup(React.createElement(ReportedBpTasks,{tasks:null,locale:'en',view:'live'}));
assert.match(unavailable,/could not load/);
console.log('PASS Tasks reads and displays the shared Care queue task; unavailable stays unknown');
