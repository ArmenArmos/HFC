import assert from 'node:assert/strict';
import {checkDraft,parseRegimenInput,REPEATED_MEDICINE,NEEDS_MEDICINE_NAME,NEEDS_MEDICINE_DOSE,NEEDS_MEDICINE_TIME,TOO_MANY_MEDICINES,BAD_TIME,TOO_MANY_TIMES,CHECK_DRAFT} from '@/lib/service-workflow/draft-input';
import {draftSchema,regimenNameKey,validReviewDraft} from '@/lib/service-workflow/publication';
import {doctorRegimenReviewSchema,memberRegimensSchema,regimenRows} from '@/lib/patient-care/regimen';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {currentPublishedReviewSchema} from '@/lib/patient-care/published-review';
import {planResult} from '@/lib/staff-zoe/facts';
import {planSnapshotSchema} from '@/lib/zoe/reply-draft';
import {healthDataBlock,healthDataSchema} from '@/lib/zoe/health-answer';
import {execFileSync} from 'node:child_process';
const base={explanation:'Fictional review',instructions:'Fictional instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const row=(name:string,dose='10 mg',times:unknown='09:00',instructions='')=>({name,dose,times,instructions});
const check=(rows:unknown[])=>checkDraft({...base,medicines:parseRegimenInput(JSON.stringify(rows))});

// The flag needs the real-review switch as well, and stays off by default.
assert.equal(multiMedicineEnabled({}),false);
assert.equal(multiMedicineEnabled({NOREON_MULTI_MEDICINE_ENABLED:'true'}),false);
assert.equal(multiMedicineEnabled({NOREON_MULTI_MEDICINE_ENABLED:'true',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fictional'}),true);

// Rows as typed: other keyboards' separators, trimmed, in the doctor's order.
const two=check([row(' Fictional statin ','20 mg','9:00، 21:00'),row('Fictional add-on')]);
assert.ok(two.ok);
assert.deepEqual(two.ok&&two.draft.medicines,[{name:'Fictional statin',dose:'20 mg',times:['09:00','21:00'],instructions:''},{name:'Fictional add-on',dose:'10 mg',times:['09:00'],instructions:''}]);
assert.ok(two.ok&&validReviewDraft(two.draft));

// An empty regimen is a plan without medicines. A blank row is refused, never dropped.
assert.ok(check([]).ok);
const fail=(rows:unknown[],...messages:string[])=>{const r=check(rows);assert.equal(r.ok,false);assert.deepEqual(!r.ok&&r.messages,messages);};
fail([row('')],NEEDS_MEDICINE_NAME);
fail([row('Fictional','')],NEEDS_MEDICINE_DOSE);
fail([row('Fictional','1 mg','')],NEEDS_MEDICINE_TIME);
fail([row('','','')],NEEDS_MEDICINE_NAME,NEEDS_MEDICINE_DOSE,NEEDS_MEDICINE_TIME);
fail([row('Fictional','1 mg','9am')],BAD_TIME);
fail([row('Fictional','1 mg','01:00,02:00,03:00,04:00,05:00')],TOO_MANY_TIMES);
fail([row('Fictional statin'),row(' fictional   STATIN ','20 mg')],REPEATED_MEDICINE);
fail(Array.from({length:9},(_,i)=>row(`Fictional ${i}`)),TOO_MANY_MEDICINES);
fail([row('x'.repeat(121))],'Shorten the medicine name to 120 characters or fewer.');
assert.deepEqual((checkDraft({...base,medicines:parseRegimenInput('not json')}) as {messages:string[]}).messages,[CHECK_DRAFT]);
assert.deepEqual((checkDraft({...base,medicines:parseRegimenInput('{"name":"x"}')}) as {messages:string[]}).messages,[CHECK_DRAFT]);
assert.equal(regimenNameKey('  Fictional   Statin '),'fictional statin');

// The one-medicine shape keeps working, and a regimen keeps nothing in the old fields.
assert.ok(validReviewDraft({...base,medicationName:'Fictional',medicationDose:'1 mg',medicationTimes:['09:00']}));
assert.equal(validReviewDraft({...base,medicationName:'Fictional',medicationDose:'1 mg',medicationTimes:['09:00'],medicines:[]}),false);
assert.deepEqual(regimenRows(null),[]);
assert.deepEqual(regimenRows({...base,medicationName:'Fictional',medicationDose:'1 mg',medicationInstructions:'Evening',medicationTimes:['09:00','21:00']}),[{name:'Fictional',dose:'1 mg',instructions:'Evening',times:'09:00, 21:00'}]);
assert.deepEqual(regimenRows({...base,medicines:[{name:'A',dose:'1',instructions:'',times:['09:00']}]}),[{name:'A',dose:'1',instructions:'',times:'09:00'}]);
assert.deepEqual(regimenRows(base),[]);

// Every read parses both draft shapes, the member's care page included.
const version={planId:'72000000-0000-4000-8000-000000000001',version:2,publishedAt:'2026-10-30T10:00:00+00:00',changeSummary:null,current:true,medicines:[{name:'A',dose:'1 mg',instructions:'',times:['09:00']}],
 changes:[{kind:'started',name:'A',dose:'1 mg',times:['09:00'],instructions:''},{kind:'stopped',name:'B',dose:'2 mg',times:['09:00']},{kind:'dose_changed',name:'C',fromDose:'1',toDose:'2'},{kind:'schedule_changed',name:'D',fromTimes:['09:00'],toTimes:['21:00']},{kind:'instructions_changed',name:'E',fromInstructions:'',toInstructions:'Evening'}]};
assert.ok(memberRegimensSchema.safeParse({version:'plan-regimens-v1',enabled:true,versions:[version]}).success);
assert.ok(doctorRegimenReviewSchema.safeParse({version:'regimen-review-v1',enabled:true,versions:[version],draft:{medicines:version.medicines,changes:version.changes,approvalHash:'0123456789abcdef0123456789abcdef'}}).success);
assert.equal(doctorRegimenReviewSchema.safeParse({version:'regimen-review-v1',enabled:true,versions:[],draft:{medicines:[],changes:[],approvalHash:'short'}}).success,false);
assert.ok(draftSchema.safeParse({...base,medicines:version.medicines}).success);
assert.ok(currentPublishedReviewSchema.safeParse({planId:version.planId,publishedAt:version.publishedAt,draft:{...base,medicines:version.medicines},sourceRows:[]}).success);

// Doctor Zoe's plan read takes a regimen: every medicine is its own fact, and a one-medicine plan reads as before.
const ctx={memberId:version.planId,role:'doctor',locale:'en'} as never;
const planFacts=(draft:unknown)=>planResult({publications:[{planId:version.planId,publishedAt:version.publishedAt,draft}]} as never,[{planId:version.planId,version:1,publishedAt:version.publishedAt,changeSummary:null,current:true}],ctx).facts.map(f=>f.value);
const staffFacts=planFacts({...base,medicines:[{name:'Fictional statin',dose:'40 mg',instructions:'Evening',times:['21:00']},{name:'Fictional add-on',dose:'10 mg',instructions:'',times:['09:00','21:00']}]});
assert.ok(staffFacts.includes('Fictional statin 40 mg, 21:00, Evening')&&staffFacts.includes('Fictional add-on 10 mg, 09:00, 21:00'),JSON.stringify(staffFacts));
assert.ok(planFacts({...base,medicationName:'Fictional',medicationDose:'1 mg',medicationTimes:['09:00']}).includes('Fictional 1 mg, 09:00'));

// Zoe's strict parsers take what the database hands them for a regimen at the largest size (zoe_run_plan, zoe_run_health_context).
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(container?.startsWith('supabase_db_')){
 const big=Array.from({length:8},(_,i)=>({name:`Fictional medicine ${i} ${'n'.repeat(99)}`,dose:'d'.repeat(120),instructions:'i'.repeat(500),times:['08:00','12:00','16:00','20:00']}));
 const short=[{name:'Fictional statin',dose:'40 mg',instructions:'Evening',times:['21:00']},{name:'Fictional add-on',dose:'10 mg',instructions:'',times:['09:00']}];
 for(const medicines of [big,short]){
  const input=`select public._zoe_plan_medicines('${JSON.stringify({...base,medicines})}'::jsonb);`;
  const z=JSON.parse(execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At'],{input,encoding:'utf8'}));
  const plan={explanation:'Fictional',instructions:'Fictional',followUp:'',...z};
  assert.ok(planSnapshotSchema.safeParse({planId:version.planId,publishedAt:version.publishedAt,...plan}).success,'reply-draft schema');
  assert.ok(healthDataSchema.safeParse({bpWeek:null,labs:[],plan:{...plan,publishedDaysAgo:0}}).success,'health schema');
  assert.ok(healthDataBlock({bpWeek:null,labs:[],plan:{...plan,publishedDaysAgo:0}}).includes('Medicine prescribed by the doctor'));
 }
}

// Every fixed message reaches the doctor in Armenian and Russian.
for(const message of [NEEDS_MEDICINE_NAME,NEEDS_MEDICINE_DOSE,NEEDS_MEDICINE_TIME,TOO_MANY_MEDICINES,REPEATED_MEDICINE,'Plans with several medicines are switched off. Reload the case.','Not published: confirm that you reviewed every medicine and dose.',
 'Not published: the medicines changed since you reviewed them, or a newer plan was published. Reload the case and review the medicines again.','Not published: plans with several medicines are switched off. Contact the Noreon team.','Not published: the current plan has several medicines and this draft cannot hold them. Contact the Noreon team.']){
 for(const locale of ['hy','ru'] as const)assert.notEqual(staffServerText(locale,message),message,`${locale}: ${message}`);
}
console.log('Several-medicine drafts: form input, both shapes and copy.');
