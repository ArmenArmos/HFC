import assert from 'node:assert/strict';
import {doctorChatHomeEnabled,doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {readDoctorDay,doctorDayCounts} from '@/lib/doctor-inbox/day';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';

const env={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true'};
assert.equal(doctorChatHomeEnabled({}),false);
assert.equal(doctorChatHomeEnabled({...env,NOREON_DOCTOR_WORKSPACE:'false'}),false);
assert.equal(doctorChatHomeEnabled({...env,NOREON_DOCTOR_CHAT_HOME:'TRUE'}),false);
assert.equal(doctorHomePath('doctor',env),'/staff/real/doctor-workspace');
for(const role of ['admin','nurse'])assert.equal(doctorHomePath(role,env),'/staff/real/members');
assert.equal(doctorHomePath('doctor',{}),'/staff/real/members');
// A nurse starts in the nurse chat when it is on, whatever the doctor switches say; an admin keeps the list.
assert.equal(doctorHomePath('nurse',{NOREON_NURSE_CHAT:'true'}),'/staff/real/nurse-chat');
assert.equal(doctorHomePath('nurse',{...env,NOREON_NURSE_CHAT:'true'}),'/staff/real/nurse-chat');
assert.equal(doctorHomePath('nurse',{NOREON_NURSE_CHAT:'TRUE'}),'/staff/real/members');
assert.equal(doctorHomePath('admin',{NOREON_NURSE_CHAT:'true'}),'/staff/real/members');
assert.deepEqual(workspaceIntent('show my patients'),{kind:'members',query:''});
for(const phrase of ['Who needs my attention first?','who needs my attention','Who needs me now','Who should I see first?','Who is waiting for me?','What needs me today','What needs my attention first','Кому нужно моё внимание?','Кто ждёт меня сегодня'])assert.deepEqual(workspaceIntent(phrase),{kind:'today'},phrase);
// Questions that only look similar stay questions about one member.
for(const phrase of ['Who needs my attention about Mariam Example?','Who needs a statin?','What needs me to know about the record?'])assert.notDeepEqual(workspaceIntent(phrase),{kind:'today'},phrase);
assert.deepEqual(workspaceIntent('show dashboard'),{kind:'dashboard'});
assert.deepEqual(workspaceIntent('BP chart'),{kind:'bp'});
for(const phrase of ['BP graph','show his blood pressure chart','show her BP graph','график давления','ճնշման գրաֆիկ'])assert.deepEqual(workspaceIntent(phrase),{kind:'bp'},phrase);
for(const phrase of ['BP chart and double his dose','show his blood pressure chart for Anna','why is his BP high?'])assert.notDeepEqual(workspaceIntent(phrase),{kind:'bp'},phrase);
assert.deepEqual(workspaceIntent('who is overdue'),{kind:'overdue'});
assert.deepEqual(workspaceIntent("who hasn't logged BP this week"),{kind:'missing_bp'});
assert.equal(workspaceIntent('recommend a statin').kind,'unsupported');

const calls:string[]=[];
const rpc={async rpc(name:string){calls.push(name);
 if(name==='care_alert_inbox')return {data:{ok:true,role:'doctor',asOf:'2026-10-31T10:00:00Z',alerts:[]},error:null};
 if(name==='doctor_urgent_windows')return {data:{ok:true,windows:[],total:0},error:null};
 if(name==='doctor_ai_inbox')return {data:{version:'doctor-inbox-v1',ok:true,asOf:'2026-10-31T10:00:00Z',p0:[],p0Total:2,items:[],laneCap:50,unavailable:[],zoeAnswered:[],zoeAnsweredTotal:0},error:null};
 if(name==='doctor_medicine_concerns')return {data:{ok:true,items:[]},error:null};
 if(name==='doctor_ldl_responses')return {data:{version:'ldl-response-v1',enabled:false},error:null};
 if(name==='doctor_first_note_queue')return {data:{version:'first-note-queue-v1',enabled:false,items:[],closed:[]},error:null};
 if(name==='patient_coordination_queue')return {data:{tasks:[],nextCursor:null},error:null};
 throw Error('Unexpected RPC');
}};
const today=await readDoctorDay(rpc,false),chat=await readDoctorDay(rpc,false);
assert.deepEqual(doctorDayCounts(today),doctorDayCounts(chat),'Today and chat share all counts');
assert.equal(doctorDayCounts(today).total,0);
assert.ok(!calls.includes('patient_coordination_queue'),'Flag off does not add task reads');
await assert.rejects(()=>readDoctorDay({rpc:async()=>({data:null,error:{code:'42501'}})},true));
console.log('Doctor chat home: flags, commands, shared Today counts and read refusal passed');

const {doctorNoticeUrl,staffNoticeDestination}=await import('@/lib/staff-zoe/notice-link');
const memberId='11111111-1111-4111-8111-111111111111';
const original=`https://backoffice.noreon.health/staff/real/conversations/${memberId}`;
assert.equal(doctorNoticeUrl(original,{}),original);
assert.equal(doctorNoticeUrl(original,env),`https://backoffice.noreon.health/staff/real/notice/conversations/${memberId}`);
assert.equal(staffNoticeDestination(`/staff/real/conversations/${memberId}`,'doctor',env),'/staff/real/doctor-workspace');
for(const role of ['admin','nurse'])assert.equal(staffNoticeDestination(`/staff/real/conversations/${memberId}`,role,env),`/staff/real/conversations/${memberId}`);
for(const url of ['https://app.noreon.health/patient/zoe','https://backoffice.noreon.health.evil/staff/real/today','https://backoffice.noreon.health/staff/real/invite#token','https://backoffice.noreon.health/staff/real/today?x=1'])assert.equal(doctorNoticeUrl(url,env),url);
assert.equal(staffNoticeDestination('/staff/real/../../elsewhere','doctor',env),null);
console.log('Doctor Telegram notices: role-aware workspace links, flag-off and excluded URLs passed');

const {runDoctorHome}=await import('@/lib/staff-zoe/home-read');
const {member,other,at,sourceData,memberRow}=await import('./doctor-chat-home-fixture');
const audits:string[]=[];let denyAudit=false,denyBp=false;
const scoped={async rpc(name:string,args?:Record<string,unknown>){
 if(name==='staff_zoe_status')return {data:true,error:null};
 if(name==='staff_zoe_open'||name==='staff_zoe_read')return {data:null,error:{code:'42501'}};
 if(name==='patient_clinical_case_search_identity'){
  assert.equal(args?.p_query,'');
  if(denyAudit)return {data:null,error:{code:'audit_failed'}};
  audits.push(`member_search:${member}`);
  return {data:{rows:[memberRow],hasMore:false,nextCursor:null},error:null};
 }
 if(name==='bp_staff_member_devices'){
  assert.equal(args?.p_member,member,'Only audited assigned search results are read');
  if(denyBp)return {data:null,error:{code:'42501'}};
  audits.push(`bp:${member}`);
  return {data:{version:'bp-device-v1',memberId:member,current:null,history:[],available:[],readings:[]},error:null};
 }
 if(name==='patient_coordination_snapshot'){
  if(denyAudit)return {data:null,error:{code:'audit_failed'}};
  audits.push(`task_snapshot:${member}`);
 }
 if(name in sourceData)return {data:sourceData[name],error:null};
 throw Error(`Unexpected RPC ${name}`);
}};
const context={client:scoped,role:'doctor',locale:'en' as const};
// A fresh replay leaves staff_zoe_enabled=false. Inbox HTTP success does not enable the workspace.
// Use the empty envelope emitted by doctor_ai_inbox with no assigned work, including nurse activity.
const freshInbox={version:'doctor-inbox-v1',ok:true,asOf:at,p0:[],p0Total:0,items:[],laneCap:50,unavailable:[],zoeAnswered:[],zoeAnsweredTotal:0,nurseActivity:[]};
for(const enabled of [false,true]){
 const freshCalls:string[]=[];
 const freshClient={async rpc(name:string,args?:Record<string,unknown>){
  freshCalls.push(name);
  if(name==='staff_zoe_status')return {data:enabled,error:null};
  if(name==='care_alert_inbox')return {data:{ok:true,role:'doctor',asOf:'2026-10-31T10:00:00Z',alerts:[]},error:null};
 if(name==='doctor_urgent_windows')return {data:{ok:true,windows:[],total:0},error:null};
 if(name==='doctor_ai_inbox')return {data:freshInbox,error:null};
  return scoped.rpc(name,args);
 }};
 const opened=await runDoctorHome({...context,client:freshClient},{kind:'day'},env,new Date(at));
 assert.equal(opened.kind,enabled?'day':'refused');
 assert.equal(freshCalls.includes('doctor_ai_inbox'),enabled,'Disabled staff Zoe refuses before reading inbox data');
 if(opened.kind==='day')assert.equal(opened.day.inbox.items.length,0,'A fresh empty inbox parses successfully');
}

for(const role of ['admin','nurse'])assert.equal((await runDoctorHome({...context,role},{kind:'day'},env)).kind,'refused');
assert.equal((await runDoctorHome(context,{kind:'day'},{})).kind,'refused');
assert.equal((await runDoctorHome(context,{kind:'select',memberId:other},env)).kind,'refused','Wrong doctor/unassigned member cannot open a record');
assert.equal((await runDoctorHome(context,{kind:'record',conversationId:other},env)).kind,'refused');
assert.equal((await runDoctorHome(context,{kind:'members',query:'x',cursor:null},env)).kind,'invalid','A short search is validation failure, not lost access');
const invalidDob=await runDoctorHome({...context,client:{async rpc(name:string,args?:Record<string,unknown>){
 if(name==='staff_zoe_status')return {data:true,error:null};
 assert.equal(name,'patient_clinical_case_search_identity');assert.equal(args?.p_query,'31.02.1968');
 return {data:null,error:{code:'22023',message:'Enter a valid date of birth'}};
}}},{kind:'members',query:'31.02.1968',cursor:null},env);
assert.equal(invalidDob.kind,'invalid','SQL date validation survives the home search boundary');
const list=await runDoctorHome(context,{kind:'members',query:'',cursor:null},env);
assert.equal(list.kind,'members');if(list.kind==='members')assert.deepEqual(list.page.rows.map(r=>r.id),[member]);
assert.ok(audits.includes(`member_search:${member}`),'The audited search is the only member list source');
const fullDay=await readDoctorDay(scoped,true,new Date(at));
assert.deepEqual(doctorDayCounts(fullDay),{alerts:0,today:1,week:1,routine:0,medicines:1,ldl:1,firstNotes:1,tasks:1,total:6});
const homeDay=await runDoctorHome(context,{kind:'day'},env,new Date(at));
assert.equal(homeDay.kind,'day');if(homeDay.kind==='day')assert.deepEqual(doctorDayCounts(homeDay.day),doctorDayCounts(fullDay));
assert.ok(audits.includes(`task_snapshot:${member}`),'Overdue tasks go through the audited snapshot');
const pollCalls:string[]=[];
const pollClient={async rpc(name:string,args?:Record<string,unknown>){
 pollCalls.push(name);
 if(name==='doctor_first_note_queue_count')return {data:{version:'first-note-queue-count-v1',enabled:true,count:1},error:null};
 return scoped.rpc(name,args);
}};
const polled=await runDoctorHome({...context,client:pollClient},{kind:'poll'},env,new Date(at));
assert.equal(polled.kind,'poll');
if(polled.kind==='poll'){assert.equal(polled.firstNoteCount?.count,1);assert.equal(polled.day.firstNotes,null);}
assert.ok(!pollCalls.includes('doctor_first_note_queue'),'Polling must not read or audit first-note member details');
const failedCount=await runDoctorHome({...context,client:{async rpc(name:string,args?:Record<string,unknown>){
 if(name==='doctor_first_note_queue_count')return {data:null,error:{code:'42501'}};
 return scoped.rpc(name,args);
}}},{kind:'poll'},env,new Date(at));
assert.equal(failedCount.kind,'poll');if(failedCount.kind==='poll')assert.equal(failedCount.firstNoteCount,null,'A failed count is unavailable, never zero');
const failedDetails=await readDoctorDay({async rpc(name:string,args?:Record<string,unknown>){
 if(name==='doctor_first_note_queue')return {data:null,error:{code:'audit_failed'}};
 return scoped.rpc(name,args);
}},true,new Date(at));
assert.equal(failedDetails.firstNotes,null,'Failed first-note auditing shows an unavailable source');

const missing=await runDoctorHome(context,{kind:'missing_bp',query:'',cursor:null},{...env,NOREON_BP_DEVICES_ENABLED:'true'},new Date(at));
assert.equal(missing.kind,'missing_bp');if(missing.kind==='missing_bp'){assert.equal(missing.from,'2026-10-26');assert.equal(missing.missingIds.length,1);assert.equal(missing.unknown,0);}
denyBp=true;
const unknown=await runDoctorHome(context,{kind:'missing_bp',query:'',cursor:null},{...env,NOREON_BP_DEVICES_ENABLED:'true'},new Date(at));
assert.equal(unknown.kind,'missing_bp');if(unknown.kind==='missing_bp'){assert.equal(unknown.missingIds.length,0);assert.equal(unknown.unknown,1,'Denied BP is unknown, never no readings');}
denyAudit=true;
assert.equal((await runDoctorHome(context,{kind:'members',query:'',cursor:null},env)).kind,'unavailable');
assert.equal((await readDoctorDay(scoped,true,new Date(at))).tasks,null,'Failed task audit is unavailable, never an empty successful queue');
console.log('Doctor day: all source counts, assigned scope, audit RPCs, denied records and unknown BP passed (mocked IO)');

// Exercise the real notice dispatcher with a fake adapter: the exact neutral text survives link routing.
const {dispatchAuthMessage}=await import('@/lib/telegram-runtime/dispatch');
const savedFlags={workspace:process.env.NOREON_DOCTOR_WORKSPACE,home:process.env.NOREON_DOCTOR_CHAT_HOME};
let delivered:import('@/lib/telegram-channel/outbound').SystemTextPayload|undefined;
try{
 process.env.NOREON_DOCTOR_WORKSPACE='true';process.env.NOREON_DOCTOR_CHAT_HOME='true';
 const text='A new message is waiting. Open the staff app.';
 const r=await dispatchAuthMessage(async(name)=>{
  if(name==='telegram_auth_message_claim')return {ok:true,fresh:true,envelope:{messageId:member,attemptId:other,address:'123456',text,keyboard:{kind:'open_url',label:'Open Noreon',url:original}}};
  assert.equal(name,'telegram_auth_message_outcome');return {ok:true};
 },{deliverText:async payload=>{delivered=payload;return {kind:'accepted',providerRef:'fictional'};}},member,other);
 assert.equal(r.state,'outcome_recorded');assert.equal(delivered?.text,text);
 assert.equal(delivered?.keyboard?.kind,'open_url');
 if(delivered?.keyboard?.kind==='open_url')assert.equal(delivered.keyboard.url,doctorNoticeUrl(original,env));
}finally{
 if(savedFlags.workspace===undefined)delete process.env.NOREON_DOCTOR_WORKSPACE;else process.env.NOREON_DOCTOR_WORKSPACE=savedFlags.workspace;
 if(savedFlags.home===undefined)delete process.env.NOREON_DOCTOR_CHAT_HOME;else process.env.NOREON_DOCTOR_CHAT_HOME=savedFlags.home;
}
console.log('Actual notice dispatcher: neutral text unchanged, workspace link delivered to fake adapter');

// Actual exported server action: actor scope from the mounted page cannot be reused by another signed-in doctor.
const {readFileSync}=await import('node:fs');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
let actionEnabled=true,actionRole='doctor',authCalls=0,homeRuns=0,failHome=false;
const actionExports:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('lib/staff-zoe/home-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:actionExports,require(name:string){
 if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
 if(name==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>{authCalls++;return {client:scoped,identity:{id:member,role:actionRole}};}};
 if(name==='@/lib/staff/staff-locale')return {staffLocale:async()=>'en'};
 if(name==='./workspace-config')return {doctorChatHomeEnabled:()=>actionEnabled};
 if(name==='./home-read')return {runDoctorHome:async()=>{homeRuns++;if(failHome)throw Error('Private provider detail');return {kind:'day',day:fullDay};}};
 throw Error(`Unexpected import ${name}`);
}});
const action=actionExports.readDoctorHome as (raw:unknown,expected:unknown)=>Promise<{kind:string}>;
actionEnabled=false;assert.equal((await action({kind:'day'},member)).kind,'refused');assert.equal(authCalls,0);
actionEnabled=true;assert.equal((await action({kind:'day'},other)).kind,'refused');assert.equal(homeRuns,0,'A tab for another doctor reads no queues');
actionRole='nurse';assert.equal((await action({kind:'day'},member)).kind,'refused');assert.equal(homeRuns,0);
actionRole='doctor';assert.equal((await action({kind:'day'},member)).kind,'day');assert.equal(homeRuns,1);
failHome=true;assert.equal((await action({kind:'day'},member)).kind,'unavailable','Provider detail is not exposed in errors');
console.log('Actual home action: role, flag, mounted actor, no-read refusal and fixed failure envelope passed');
