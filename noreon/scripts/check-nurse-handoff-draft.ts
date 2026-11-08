// The hand-over summary (lib/nurse-chat/handoff-draft.ts, handoff-draft-read.ts): built by code from facts with dates, within the observation limit,
// failed sources said, the member's words quoted verbatim and shortened visibly, nothing the record does not hold.
import assert from 'node:assert/strict';
import {buildHandoffDraft,HANDOFF_DRAFT_MAX,type HandoffFacts} from '@/lib/nurse-chat/handoff-draft';
import {readHandoffFacts} from '@/lib/nurse-chat/handoff-draft-read';
import {draftIntent} from '@/lib/nurse-chat/draft-intent';

const base:HandoffFacts={asOf:'2026-11-04T05:30:00Z',identity:'Ani Example · 1 Jan 1986 · •••• 1234',
 bp:[{systolic:150,diastolic:95,pulse:78,measuredAt:'2026-11-03T04:10:00Z',source:'manual'},{systolic:148,diastolic:93,pulse:null,measuredAt:'2026-11-02T06:00:00Z',source:'visit'}],
 tasks:[{title:'Call about the results',dueAt:'2026-11-04T10:08:00Z'}],
 medicines:[{name:'Atorvastatin',dose:'20 mg',source:'plan',expected:7,taken:3,skipped:1,noReport:3}],medicinesFrom:'2026-10-29',medicinesTo:'2026-11-04',
 memberMessage:{text:'I have a headache since yesterday and my pressure was high',at:'2026-11-03T20:00:00Z'}};

const en=buildHandoffDraft(base,'en');
assert.ok(en.startsWith('Ani Example · 1 Jan 1986 · •••• 1234\nSummary as of 4 Nov 2026, 09:30.'));
assert.match(en,/- 150\/95 · pulse 78 · 3 Nov 2026, 08:10 · member/);assert.match(en,/- 148\/93 · 2 Nov 2026, 10:00 · visit/);
assert.ok(en.indexOf('150/95')<en.indexOf('148/93'),'Newest first');
assert.match(en,/Open tasks:\n- Call about the results · due 4 Nov 2026, 14:08/);
assert.match(en,/- Atorvastatin 20 mg: taken 3, skipped 1, no report 3 of 7/);
assert.match(en,/The member wrote on 4 Nov 2026, 00:00:\n“I have a headache since yesterday and my pressure was high”/,'The member\'s words are quoted verbatim and attributed');
assert.ok(en.endsWith('\n\nNurse observation: '),'An empty line is left for the nurse');
assert.doesNotMatch(en,/should|recommend|urgent|high risk|elevated|normal|diagnos/i,'No advice, judgement or threshold in the draft');
// All three languages build, within the limit.
for(const l of ['hy','ru'] as const){const d=buildHandoffDraft(base,l);assert.ok([...d].length<=HANDOFF_DRAFT_MAX);assert.ok(d.includes('150/95'));assert.ok(d.includes('“I have a headache'));}
// Failed sources are said, not left empty; no data is said as no data.
const failed=buildHandoffDraft({...base,bp:null,tasks:null,medicines:null,memberMessage:null},'en');
assert.match(failed,/Blood pressure: could not be read\./);assert.match(failed,/Tasks: could not be read\./);assert.match(failed,/Medicine reports: could not be read\./);assert.doesNotMatch(failed,/The member wrote/);
const none=buildHandoffDraft({...base,bp:[],tasks:[],medicines:[]},'en');assert.match(none,/Blood pressure: no readings in the last 7 days\./);assert.doesNotMatch(none,/Open tasks|Medicine doses/);
// Over budget: long identity, many readings, maximum-length tasks and medicines, a very long member message.
const heavy:HandoffFacts={...base,identity:'Very Long Example Name '.repeat(4)+'· 1 Jan 1986 · •••• 1234',
 bp:Array.from({length:12},(_,i)=>({systolic:150-i,diastolic:95-i,pulse:70+i,measuredAt:`2026-11-0${1+(i%4)}T0${i%10}:00:00Z`,source:'device' as const})),
 tasks:Array.from({length:9},(_,i)=>({title:`Task number ${i} `+'x'.repeat(200),dueAt:'2026-11-05T10:00:00Z'})),
 medicines:Array.from({length:6},(_,i)=>({name:`Medicine ${i} `+'m'.repeat(60),dose:'20 mg',source:'plan' as const,expected:7,taken:3,skipped:1,noReport:3})),
 memberMessage:{text:'word '.repeat(300),at:'2026-11-03T20:00:00Z'}};
for(const l of ['en','hy','ru'] as const){
 const d=buildHandoffDraft(heavy,l);
 assert.ok([...d].length<=HANDOFF_DRAFT_MAX,`${l}: within the limit (${[...d].length})`);assert.ok(d.endsWith(' '),'Room for the nurse remains');assert.ok(2000-[...d].length>=500,'At least 500 characters stay free');
 assert.match(d,/…” \(/,'A long quote is shortened with a visible mark');assert.ok(/not shown/.test(d)||/не показано/.test(d)||/ցուցադրված չէ/.test(d),`${l}: omissions are said`);
}
// The reader: last 7 days of readings only, tasks of this member that are open, counts from the medicines model, failures are null.
const now=new Date('2026-11-04T10:00:00Z');
const mid='c0000000-0000-4000-8000-000000000001';
const reading=(at:string,source='manual')=>({id:'d0000000-0000-4000-8000-000000000001',systolic:130,diastolic:80,pulse:null,measuredAt:at,source,serial:null});
const bpData=(readings:unknown)=>({version:'bp-device-v1',memberId:mid,current:null,history:[],available:[],readings});
const med={id:'d1000000-0000-4000-8000-000000000001',source:'plan',name:'Atorvastatin',dose:'20 mg',times:['08:00'],startedOn:'2026-10-01',endDate:null,effectiveAt:null,doses:[{dueAt:'2026-11-04T08:00:00+04:00',status:'taken',recordedAt:'2026-11-04T09:00:00+04:00'}]};
const clientFor=(opts:{bp?:unknown|'throw';meds?:unknown|'throw';visits?:unknown|'fail'})=>({rpc:async(name:string)=>{
 if(name==='nurse_visit_record'){if(opts.visits==='fail')return {data:null,error:{message:'x'}};return {data:opts.visits??{version:'nurse-visit-v1',enabled:true,visits:[]},error:null};}
 if(name==='bp_staff_member_devices'){if(opts.bp==='throw')throw new Error('x');return {data:bpData(opts.bp??[]),error:null};}
 if(name==='member_medicines_staff_read'){if(opts.meds==='throw')throw new Error('x');return {data:opts.meds??{version:'member-medicines-v1',enabled:false},error:null};}
 throw new Error('unexpected '+name);
}});
const task=(over:Record<string,unknown>)=>({id:'t',caseId:mid,title:'Task',status:'open',dueAt:null,...over}) as never;
const facts=await readHandoffFacts(clientFor({bp:[reading('2026-11-03T08:00:00Z'),reading('2026-10-20T08:00:00Z'),reading('2026-11-05T08:00:00Z')],meds:{version:'member-medicines-v1',enabled:true,today:'2026-11-04',days:7,now:now.toISOString(),self:[],plan:[med]}}),mid,[task({}),task({id:'u',caseId:'c0000000-0000-4000-8000-000000000009',title:'Other member'}),task({id:'v',status:'completed'})],now);
assert.deepEqual(facts.bp?.map(r=>r.measuredAt),['2026-11-03T08:00:00Z'],'Only readings of the last 7 days, none dated after now');
assert.deepEqual(facts.tasks?.map(x=>x.title),['Task'],'Only this member\'s open tasks');
assert.equal(facts.medicines?.[0]?.taken,1);assert.equal(facts.medicines?.[0]?.noReport,6);assert.equal(facts.medicinesFrom,'2026-10-29');assert.equal(facts.medicinesTo,'2026-11-04');
const broken=await readHandoffFacts(clientFor({bp:'throw',meds:'throw'}),mid,null,now);assert.deepEqual([broken.bp,broken.medicines,broken.tasks],[null,null,null],'A failed source is null, never empty');
const off=await readHandoffFacts(clientFor({}),mid,[],now);assert.equal(off.medicines,null,'A disabled medicines source is unknown');
// The request words: whole messages that ask for the summary; anything else is not a command.
for(const text of ['draft a handoff for the doctor','Draft a hand-over','prepare a handoff summary','summarize for the doctor','Zoe, please write the handoff for the doctor','подготовь передачу врачу','составь сводку для врача','պատրաստիր փոխանցում բժշկի համար'])assert.deepEqual(draftIntent(text),{kind:'draft-handoff'},text);
for(const text of ['hand over to the doctor','draft a message to the member','draft a check-in','what is the handoff status','draft a handoff for the doctor and send it','','x'.repeat(300)])assert.equal(draftIntent(text),null,text);
assert.equal(draftIntent(null),null);
// A BP the nurse recorded in a visit is part of the readings: the summary must not say "no readings" over it.
const visitRow={visit:{source:'home-request',id:'e0000000-0000-4000-8000-000000000001',memberId:mid,memberName:'Member',arrangementToken:'1',startsAt:'2026-11-04T08:00:00Z',endsAt:null,mode:'home',location:null,bookingStatus:'confirmed',completion:null},steps:[],completion:null,
 items:[{key:'measure:bp',kind:'measurement',field:'bp',mark:{done:true,note:null,values:{systolic:148,diastolic:93,pulse:72},recordedAt:'2026-11-04T05:00:00Z',nurseName:'Narine'}},{key:'measure:weight',kind:'measurement',field:'weight',mark:{done:true,note:null,values:{value:82},recordedAt:'2026-11-04T05:00:00Z',nurseName:'Narine'}}]};
const withVisit=await readHandoffFacts(clientFor({bp:[],visits:{version:'nurse-visit-v1',enabled:true,visits:[visitRow]}}),mid,[],now);
assert.deepEqual(withVisit.bp?.map(r=>[r.systolic,r.diastolic,r.pulse,r.source]),[[148,93,72,'visit']],'A visit BP is included, with its source');
const old=await readHandoffFacts(clientFor({bp:[],visits:{version:'nurse-visit-v1',enabled:true,visits:[{...visitRow,items:[{...visitRow.items[0],mark:{...visitRow.items[0]!.mark,recordedAt:'2026-10-01T05:00:00Z'}}]}]}}),mid,[],now);
assert.deepEqual(old.bp,[],'A visit BP older than 7 days is not included');
const unread=await readHandoffFacts(clientFor({bp:[]}),mid,[],now);assert.deepEqual(unread.bp,[],'No visit marks: no readings, said as such');
const visitFail=await readHandoffFacts(clientFor({bp:[],visits:'fail'}),mid,[],now);assert.equal(visitFail.bp,null,'No readings and an unreadable visit record: could not be read, not "no readings"');
// Typed observations keep their provenance through the real read-to-draft entry point.
const typedFacts=await readHandoffFacts(clientFor({bp:[{...reading('2026-11-03T08:00:00Z'),systolic:190,diastolic:120,entrySource:'patient_text_entry'}]}),mid,[],now);
assert.equal(typedFacts.bp?.[0]?.entrySource,'patient_text_entry');
for(const [locale,label] of [['en','Member-reported, not verified'],['hy','Անդամի հաղորդածը, չստուգված'],['ru','Со слов участника, не проверено']] as const){
 const draft=buildHandoffDraft({...base,...typedFacts,memberMessage:{text:'My BP is 190/120',at:now.toISOString()}},locale);
 assert.ok(draft.split('\n').find(line=>line.includes('- 190/120'))?.includes(label));
 assert.ok(draft.includes('“My BP is 190/120”'));
 assert.ok(draft.split('\n').find(line=>line.includes('“My BP is 190/120”'))?.includes(label),'Quoted typed BP retains its label in the copied draft');
}
console.log('Nurse hand-over summary: built from facts with dates, within the limit in en/hy/ru, failed sources said, quote verbatim and visibly shortened, no judgement.');
