import assert from 'node:assert/strict';
import {runDoctorCard} from '@/lib/staff-zoe/card-read';
const member='11111111-1111-4111-8111-111111111111',conversation='22222222-2222-4222-8222-222222222222';
const calls:string[]=[];
let denied=false;
const client={async rpc(name:string){calls.push(name);
 if(name==='staff_zoe_status')return {data:true,error:null};
 if(name==='staff_zoe_read')return denied?{data:null,error:{code:'42501'}}:{data:{enabled:true,id:conversation,member:{id:member,name:'Fictional member',birthYear:1980,sex:null},messages:[]},error:null};
 if(name==='patient_clinical_case_snapshot')return {data:null,error:{code:'42501'}};
 throw Error('Unexpected RPC');
}};
const env={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true'};
const input={card:'results',conversationId:conversation};
assert.equal((await runDoctorCard(client,input,{})).kind,'refused');assert.equal(calls.length,0);
assert.equal((await runDoctorCard(client,{...input,conversationId:'bad'},env)).kind,'invalid');assert.equal(calls.length,0);
denied=true;assert.equal((await runDoctorCard(client,input,env)).kind,'refused');assert.ok(!calls.includes('patient_clinical_case_snapshot'));
denied=false;assert.equal((await runDoctorCard(client,input,env)).kind,'refused','Assignment is rechecked before any feature read');
assert.deepEqual(calls.filter(x=>x!=='staff_zoe_status'),['staff_zoe_read','staff_zoe_read','patient_clinical_case_snapshot']);
console.log('Doctor cards: flag, input, conversation scope and case denial prevent downstream reads (stubbed IO)');

const snapshot={id:member,revision:3,evidenceToken:'record-token',draft:null,draftSavedAt:null,draftStale:false,evidence:{profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:[]}};
const featureCalls:string[]=[];
const scoped={async rpc(name:string,args?:Record<string,unknown>){
 featureCalls.push(name);
 if(name==='staff_zoe_status'||name==='staff_zoe_read')return client.rpc(name);
 if(name==='patient_clinical_case_snapshot'){assert.equal(args?.p_user_id,member);return {data:snapshot,error:null};}
 if(name==='doctor_ldl_read')return {data:{enabled:false},error:null};
 if(name==='patient_coordination_queue'){assert.equal(args?.p_case,member);return {data:{tasks:[],nextCursor:null},error:null};}
 if(name==='patient_coordination_members'){assert.equal(args?.p_search,member);return {data:{members:[],nextCursor:null},error:null};}
 if(name==='care_alert_inbox')return {data:{ok:true,role:'doctor',asOf:'2026-11-01T00:00:00Z',alerts:[]},error:null};
 throw Error('Unexpected source');
}};
assert.equal((await runDoctorCard(scoped,{card:'tasks',conversationId:conversation},env)).kind,'ready');
assert.equal((await runDoctorCard(scoped,{card:'consultation',conversationId:conversation},env)).kind,'off');
assert.equal((await runDoctorCard(scoped,{card:'lab',conversationId:conversation,fileId:member},env)).kind,'off');
assert.equal((await runDoctorCard(scoped,{card:'alerts'},env)).kind,'off');
assert.ok(!featureCalls.includes('care_alert_inbox'),'Disabled alerts never read an inbox');
const alerts=await runDoctorCard(scoped,{card:'alerts',view:'resolved'},{...env,NOREON_CARE_ALERTS_ENABLED:'true'});
assert.equal(alerts.kind,'ready');if(alerts.kind==='ready'&&alerts.card==='alerts'){assert.equal(alerts.view,'resolved');assert.equal(alerts.inbox.alerts.length,0);}
assert.equal(featureCalls.filter(x=>x==='patient_clinical_case_snapshot').length,3,'A global alert list never reads a member case');
console.log('Doctor cards: scoped task reads, consultation/lab/alert switches and global resolved-list read passed (stubbed IO)');

// Invoke the actual logged server entry point with a fresh actor for every read.
const {readFileSync}=await import('node:fs');const {default:vm}=await import('node:vm');const {default:ts}=await import('typescript');
let actor='doctor',actorId=member,enabled=true,runs=0;
const actionExports:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('lib/staff-zoe/card-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:actionExports,require(name:string){
 if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
 if(name==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>({client,identity:{id:actorId,role:actor}})};
 if(name==='./workspace-config')return {doctorChatHomeEnabled:()=>enabled};
 if(name==='./card-read')return {runDoctorCard:async()=>{runs++;return {kind:'off'};}};
 throw Error('Unexpected action import');
}});
const action=actionExports.readDoctorCard as (raw:unknown,actor:string)=>Promise<{kind:string}>;
for(const role of ['admin','nurse']){actor=role;assert.equal((await action(input,member)).kind,'refused');}
actor='doctor';actorId=conversation;assert.equal((await action(input,member)).kind,'refused');
actorId=member;enabled=false;assert.equal((await action(input,member)).kind,'refused');assert.equal(runs,0);
enabled=true;assert.equal((await action(input,member)).kind,'off');assert.equal(runs,1);
console.log('Actual card action: doctor role, mounted actor and flag checked before feature IO (stubbed authentication)');

const resultsCalls:string[]=[];
const resultClient={async rpc(name:string,args?:Record<string,unknown>){
 resultsCalls.push(name);
 if(['staff_zoe_status','staff_zoe_read','patient_clinical_case_snapshot'].includes(name))return scoped.rpc(name,args);
 if(name==='doctor_member_documents')return {data:{version:'member-documents-v1',enabled:true,documents:[]},error:null};
 return {data:null,error:{code:'unavailable'}};
}};
const result=await runDoctorCard(resultClient,input,{...env,NOREON_DOCTOR_COMPLETION_ENABLED:'true',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline-placeholder'});
assert.equal(result.kind,'ready');if(result.kind==='ready'&&result.card==='results'){assert.equal(result.completion,true);assert.equal(result.lab,undefined,'A disabled Lab AI source stays absent');}
assert.ok(!resultsCalls.includes('doctor_lab_ai_overview'),'Completion alone cannot bypass the Lab AI application flag');
console.log('Results: completion enabled with Lab AI off performs no AI overview read (stubbed IO)');
