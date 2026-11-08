import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const id='aa110000-0000-4000-8000-000000000001';
let enabled=true,role='nurse',refused=false,calls:string[]=[];
let visitRows:Record<string,unknown>[]=[];
let messageQuotes:Record<string,unknown>[]=[],messagesFail=false;
const snapshot={id,revision:3,evidenceToken:'test',draft:null,draftSavedAt:null,draftStale:false,careNotes:[],evidence:{profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:[]}};
const {snapshotSchema}=await import('@/lib/patient-care/clinical-case-repository');
const exports:Record<string,unknown>={};
const deps:Record<string,unknown>={
 'zod':await import('zod'),'next/navigation':{unstable_rethrow:()=>{}},
 '@/lib/observability/with-logging':{loggedAction:(_n:string,f:unknown)=>f},
 '@/lib/patient-care/clinical-case-repository':{snapshotSchema,requireRealStaff:async()=>({identity:{role},client:{rpc:async(name:string)=>{calls.push(name);return {data:refused?null:snapshot,error:refused?{code:'42501'}:null};}}})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>'en'},'./config':{nurseChatEnabled:()=>enabled},
 '@/lib/staff-zoe/chat-reported':await import('@/lib/staff-zoe/chat-reported'),
 '@/lib/staff-zoe/server':{staffRecordReader:()=>async(tool:string)=>{calls.push(tool);if(tool==='member_messages'&&messagesFail)throw Error('Offline');return {tool,state:tool==='member_messages'&&messageQuotes.length?'ok':'none',facts:[],quotes:tool==='member_messages'?messageQuotes:[],missing:[],href:'/staff/real/members/'+id};}},
 '@/lib/staff/lab-stage-runtime':{readLabStages:async()=>{calls.push('samples');return {memberId:id,samples:[]};}},
 '@/lib/nurse-visit/runtime':{readNurseVisits:async()=>({enabled:true,visits:visitRows})},
 '@/lib/bp-week/server':{readStaffBpWeek:async()=>{calls.push('week');return {enabled:false};}},
};
const source=ts.transpileModule(readFileSync('lib/nurse-chat/member-card-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(source).runInNewContext({exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const read=exports.readNurseMemberCard as (member:unknown,card:unknown)=>Promise<{kind:string;card?:string}>;
for(const other of ['doctor','admin','clinic']){role=other;assert.equal((await read(id,'notes')).kind,'denied');assert.deepEqual(calls,[]);}
role='nurse';enabled=false;assert.equal((await read(id,'notes')).kind,'off');assert.deepEqual(calls,[]);enabled=true;
assert.equal((await read('bad','notes')).kind,'denied');assert.deepEqual(calls,[]);
refused=true;
for(const card of ['context','notes','samples','week']){assert.equal((await read(id,card)).kind,'denied');assert.deepEqual(calls.splice(0),['patient_clinical_case_snapshot'],'No downstream data before assignment');}
refused=false;
for(const card of ['context','notes','samples','week']){const result=await read(id,card);assert.equal(result.kind,'ready');assert.equal(result.card,card);assert.equal(calls.shift(),'patient_clinical_case_snapshot');calls=[];}
// The context card shows what the member wrote in the chat on the pressure and medicine cards, marked member reported; a failed message read adds nothing.
{
 messageQuotes=[{id:'member_messages.1',text:'My pressure is 150/95. I take amlodipine 5 mg. My LDL was 3.4 mmol/L.',date:'2026-11-03',at:'2026-11-03T08:00:00Z',flagged:false}];
 const withChat=await read(id,'context') as unknown as {cards:{tool:string;state:string;facts:{value:string;mark:string|null}[]}[]};
 assert.equal(withChat.cards.length,6,'Six cards as before; the messages are not a card of their own');
 const bp=withChat.cards.find(c=>c.tool==='bp')!,meds=withChat.cards.find(c=>c.tool==='adherence')!;
 assert.equal(bp.state,'ok');assert.deepEqual(bp.facts.map(f=>[f.value,f.mark]),[['150/95 mmHg','member_reported']]);
 assert.deepEqual(meds.facts.map(f=>[f.value,f.mark]),[['amlodipine 5 mg','member_reported']]);
 assert.deepEqual(withChat.cards.find(c=>c.tool==='overview')!.facts.map(f=>[f.value,f.mark]),[['3.4 mmol/L','member_reported']],'The LDL the member wrote sits on the overview card, marked');
 messagesFail=true;const failed=await read(id,'context') as unknown as {cards:{tool:string;state:string;facts:unknown[]}[]};
 assert.equal(failed.cards.length,6);assert.equal(failed.cards.find(c=>c.tool==='bp')!.state,'none','A failed message read adds nothing and says nothing new');
 messagesFail=false;messageQuotes=[];calls=[];
}
visitRows=[{memberId:id,completion:{summary:{samplesTaken:2}},samplesTaken:2},{memberId:'aa110000-0000-4000-8000-000000000002',completion:{},samplesTaken:3},{memberId:id,completion:null,samplesTaken:1}];
const samples=await read(id,'samples') as unknown as {visits:typeof visitRows};
assert.equal(samples.visits.length,1,'Sample context only includes completed visits belonging to the selected member');
assert.equal(samples.visits[0].samplesTaken,2,'Recorded completion counts survive an empty logistics sample list');
calls=[];
assert.equal((await read(id,'prescribe')).kind,'denied');assert.deepEqual(calls,[]);
console.log('Nurse member cards: flag, role, input and assignment gates; authorized reads passed (mocked I/O).');
