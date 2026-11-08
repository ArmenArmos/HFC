import assert from 'node:assert/strict';
import {firstNoteCardCommandSchema,firstNoteContextSchema,clinicalCardCommandSchema,clinicalCardForm,runFirstNoteCard} from '@/lib/doctor-decisions/approvals';

const id='11111111-1111-4111-8111-111111111111';
const context={memberId:id,revision:4,evidenceToken:'a'.repeat(32),appointmentsRevision:'b'.repeat(32)};
const note={version:'first-note-v1',memberId:id,submissionId:id,textEn:'Exact note',textHy:'Ճշգրիտ գրառում',builderVersion:'first-note-1',sources:[],edited:true,assessmentRevision:3};
const calls:unknown[]=[];
const client={async rpc(name:string,args?:Record<string,unknown>){calls.push({name,args});return {data:{status:'approved'},error:null};}};
assert.equal((await runFirstNoteCard(client,{context,note})).status,'approved');
assert.deepEqual(calls,[{name:'doctor_first_note_card_approve',args:{p_command:note,p_revision:4,p_evidence_token:context.evidenceToken,p_appointments_revision:context.appointmentsRevision}}]);
for(const missing of ['revision','evidenceToken','appointmentsRevision']){
 assert.equal((await runFirstNoteCard(client,{context:{...context,[missing]:undefined},note})).status,'invalid');
}
assert.equal(calls.length,1,'Missing shown evidence never reaches a command');
assert.equal((await runFirstNoteCard(client,{context,note:{...note,textEn:' Exact note '}})).status,'invalid','A card never silently approves trimmed text');
assert.equal(calls.length,1);
assert.equal(firstNoteCardCommandSchema.safeParse({context:{...context,memberId:'22222222-2222-4222-8222-222222222222'},note}).success,false);
for(const status of ['stale','access','already','urgent','not-ready','plan-active','disabled','unavailable']){
 assert.equal((await runFirstNoteCard({async rpc(){return {data:{status},error:null};}},{context,note})).status,status);
}
assert.equal((await runFirstNoteCard({async rpc(){return {data:null,error:{code:'42501'}};}},{context,note})).status,'access');
assert.equal((await runFirstNoteCard({async rpc(){return {data:null,error:{code:'40001'}};}},{context,note})).status,'stale');
assert.equal((await runFirstNoteCard({async rpc(){return {data:null,error:{code:'XX000'}};}},{context,note})).status,'outcome-unknown','Audit/DB failures are never reported as approved');
const publish={kind:'regimen',context,requestId:id,regimenHash:'c'.repeat(32),approved:true,changeSummary:'Exact replacement note'};
assert.equal(clinicalCardCommandSchema.safeParse(publish).success,true);
assert.equal(clinicalCardCommandSchema.safeParse({...publish,regimenHash:undefined}).success,false);
assert.equal(clinicalCardCommandSchema.safeParse({...publish,approved:false}).success,false);
assert.equal(clinicalCardCommandSchema.safeParse({...publish,kind:'prepare'}).success,false,'Cards never prepare recommendations');
console.log('Approval card contracts and first-note adapter passed (controlled DB IO).');

// Actual server actions, with authentication and database IO replaced. No provider or hosted service is called.
const {readFileSync}=await import('node:fs');
const {createRequire}=await import('node:module');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const require=createRequire(import.meta.url);
const firstNoteRuntime=await import('@/lib/first-note/runtime');
const firstNoteSchemas=await import('@/lib/first-note/schema');
const exports:Record<string,unknown>={};
let enabled=true,multi=true,role='doctor',authCalls=0;
let rpcError:{code:string;message?:string}|null=null;
const serverCalls:{name:string;args?:Record<string,unknown>}[]=[];
const serverClient={async rpc(name:string,args?:Record<string,unknown>){serverCalls.push({name,args});return {data:{status:'approved'},error:rpcError};}};
const clinicalForms:FormData[]=[];
let clinicalResult={ok:true,message:'Care plan published.'};
const clinical=async(_previous:unknown,form:FormData)=>{clinicalForms.push(form);return clinicalResult;};
for(const path of ['lib/first-note/actions.ts','lib/doctor-decisions/approval-actions.ts']){
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,require(name:string){
  if(name==='next/cache')return {revalidatePath(){}};
  if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
  if(name==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>{authCalls++;return {identity:{id,role},client:serverClient};}};
  if(name==='@/lib/staff-zoe/workspace-config')return {doctorDecisionsEnabled:()=>enabled};
  if(name==='@/lib/patient-care/regimen-config')return {multiMedicineEnabled:()=>multi};
  if(name==='@/lib/patient-care/clinical-review-actions')return {realClinicalCommand:clinical};
  if(name==='./runtime')return firstNoteRuntime;
  if(name==='./schema')return firstNoteSchemas;
  if(name.endsWith('/approvals')||name==='./approvals')return {firstNoteContextSchema,runFirstNoteCard,clinicalCardCommandSchema,clinicalCardForm};
  return require(name);
 }});
}
const approve=exports.approveFirstNote as (note:unknown,context?:unknown)=>Promise<{status:string}>;
const press=exports.pressClinicalCard as (input:unknown)=>Promise<{ok:boolean;message:string}>;
enabled=false;const before=authCalls;
assert.equal((await approve(note,context)).status,'disabled');assert.equal((await press(publish)).ok,false);
assert.equal(authCalls,before,'Disabled card routes perform no authentication/read/write');
enabled=true;
for(role of ['nurse','admin']){
 assert.equal((await approve(note,context)).status,'access');assert.equal((await press(publish)).ok,false);
}
assert.equal(serverCalls.length+clinicalForms.length,0,'Wrong staff role cannot reach a command');
role='doctor';multi=false;assert.equal((await press(publish)).ok,false);assert.equal(clinicalForms.length,0);multi=true;
for(const field of ['revision','evidenceToken']){
 assert.equal((await press({...publish,context:{...context,[field]:undefined}})).ok,false);
}
assert.equal(clinicalForms.length,0,'Missing shown evidence never reaches the page action');
assert.equal((await approve(note,context)).status,'approved');
assert.equal(serverCalls[0].name,'doctor_first_note_card_approve');
rpcError={code:'42501'};assert.equal((await approve(note,context)).status,'access','Wrong assigned doctor is refused by the DB boundary');
rpcError={code:'XX000'};assert.equal((await approve(note,context)).status,'outcome-unknown','Audit failure is not reported as approval');
rpcError=null;
enabled=false;await approve(note);
assert.equal(serverCalls.at(-1)!.name,'doctor_first_note_approve','Old page still reaches its original command with cards off');
enabled=true;
assert.equal((await press(publish)).ok,true);
assert.deepEqual(Object.fromEntries(clinicalForms[0]),{id,revision:'4',token:context.evidenceToken,operation:'publish',requestId:id,regimenHash:publish.regimenHash,regimenApproved:'on',changeSummary:publish.changeSummary});
clinicalResult={ok:false,message:'The evidence or assignment changed. Reload and review.'};
assert.equal((await press(publish)).ok,false);
for(const command of [
 {kind:'consultation-decision',context,decision:'required',note:'Private reason'},
 {kind:'consultation-decision',context,decision:'not-required',note:'Private reason'},
 ...['phone','video','in-person'].map(mode=>({kind:'complete-consultation',context,completedAtLocal:'2026-10-31T12:00',mode,note:'Private completion'})),
]){
 await press(command);
 const form=clinicalForms.at(-1)!;
 assert.equal(form.get('operation'),command.kind);assert.equal(form.get('revision'),'4');assert.equal(form.get('token'),context.evidenceToken);
 assert.equal(form.get('note'),command.note);
}
console.log('Actual approval server action gates and existing-command routing passed (controlled auth/DB IO).');

const {readApprovalCards}=await import('@/lib/doctor-decisions/approval-read');
const at='2026-10-31T12:00:00Z';
const bundle={snapshot:{id,revision:4,evidenceToken:context.evidenceToken,draft:null,draftSavedAt:null,draftStale:false,
 evidence:{profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:{},assessment:{revision:3,answers:{},completed_at:at,urgent_rule:null},measurements:[],reports:[]}},
 firstNote:{version:'first-note-v1',enabled:true,completedAt:at,dueAt:at,urgent:false,planActive:false,note:null},
 regimen:{version:'regimen-review-v1',enabled:false,versions:[],draft:null},appointments:[],appointmentsRevision:context.appointmentsRevision,replacementId:null};
const reads:string[]=[];
const read=async(data:unknown)=>readApprovalCards({async rpc(name){reads.push(name);return {data,error:null};}},id);
const prepared=await read(bundle);
assert.ok(prepared?.firstNote);
assert.ok(prepared?.firstNote?.draft?.text.en.includes('Fictional'));
assert.equal(prepared.firstNote.assessmentRevision,3);
assert.deepEqual(prepared.firstNote.context,context);
assert.deepEqual(reads,['doctor_approval_cards_read'],'Card reads never call a write or recommendation action');
assert.equal((await read({...bundle,firstNote:{version:'first-note-v1',enabled:false}}))?.firstNote,null);
assert.equal((await read({...bundle,firstNote:{...bundle.firstNote,urgent:true}}))?.firstNote?.draft,null);
assert.equal((await read({...bundle,firstNote:{...bundle.firstNote,planActive:true}}))?.firstNote?.draft,null);
assert.equal(await read({...bundle,snapshot:{...bundle.snapshot,evidenceToken:''}}),null,'Missing evidence cannot create an actionable card');
assert.equal(await read({...bundle,appointments:null}),null,'Unreadable appointments are never treated as no visit');
assert.equal(await read({...bundle,snapshot:{...bundle.snapshot,id:'22222222-2222-4222-8222-222222222222'}}),null,'A mismatched member bundle is refused');
console.log('Approval card read checks passed (frozen-RPC fixture; no database).');

// DA-01: the reply and approval RPCs lock the same case row with NOWAIT.
// Model that transaction boundary while exercising the actual readers and parsers.
const {readWorkspaceDecisions}=await import('@/lib/doctor-decisions/read');
const replyBundle={workspace:{ok:true,conversation:null},actions:{ok:false,code:'no_draft'},
 mode:{ok:true,doctorMode:false,zoeActive:true,since:null,byName:null,intakePaused:false},modeRevision:'c'.repeat(32)};
let locked=false,collisions=0;
const ordered=await readWorkspaceDecisions({async rpc(name,args){
 assert.equal(args?.p_member,id);
 if(name==='doctor_decision_items')return {data:{items:[]},error:null};
 if(locked){collisions++;return {data:null,error:{code:'55P03'}};}
 locked=true;
 try{
  await new Promise(resolve=>setTimeout(resolve,5));
  return {data:name==='doctor_decision_reply'?replyBundle:bundle,error:null};
 }finally{locked=false;}
}},id);
assert.equal(collisions,0,'Reads in one workspace request must not contend on their own case lock');
assert.ok(ordered.reply,'Reply remains available');assert.ok(ordered.approvals?.firstNote,'Approval remains available');

for(const failingRpc of ['doctor_decision_reply','doctor_approval_cards_read']){
 for(const errorCode of ['55P03','42501','XX000']){
  for(const persistent of [false,true]){
   let attempts=0;
   const result=await readWorkspaceDecisions({async rpc(name){
    if(name==='doctor_decision_items')return {data:{items:[]},error:null};
    if(name===failingRpc){attempts++;if(persistent||attempts===1)return {data:null,error:{code:errorCode}};}
    return {data:name==='doctor_decision_reply'?replyBundle:bundle,error:null};
   }},id);
   assert.equal(attempts,errorCode==='55P03'?2:1,'Only a lock collision is retried, exactly once');
   const available=failingRpc==='doctor_decision_reply'?result.reply:result.approvals;
   assert.equal(available!==null,errorCode==='55P03'&&!persistent,'A transient lock recovers; persistent errors stay unavailable');
   assert.ok(failingRpc==='doctor_decision_reply'?result.approvals:result.reply,'A failed reader does not hide the other cards');
  }
 }
}
console.log('DA-01: sequential case reads, one lock retry, bounded persistent failures and no retries on access/audit errors passed (controlled RPC IO).');
