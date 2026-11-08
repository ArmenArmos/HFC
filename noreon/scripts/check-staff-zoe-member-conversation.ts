import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as contracts from '@/lib/staff-zoe/contracts';
import {readChatMemberIdentities} from '@/lib/staff/chat-member-identity-read';
import {chatDoctorIdentity} from '@/lib/staff/real-staff-access';
import * as coordination from '@/lib/staff/real-coordination/schema';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as jsx from 'react/jsx-runtime';

// Catches insert-on-every-open in the history action, page and passive alert read.
// Execute production loaders/parsers; only auth and database IO are synthetic.
const id=(n:number)=>`e9200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doctor=id(9),a=id(1),b=id(2);
let enabled=true,zoeOn=true,role='doctor',actorId=doctor,assigned=true;
let lookupError:string|null=null,lookupThrows=false,malformed=false,wrongMember=false;
let inserted=0;
const calls:string[]=[];
const rows:{id:string;memberId:string;messages:{seq:number;role:'staff';body:string;content:null;at:string}[]}[]=[];
const client={async rpc(name:string,args?:Record<string,unknown>):Promise<{data:unknown;error:{code:string}|null}>{
 calls.push(name);
 if(name==='staff_zoe_status')return {data:zoeOn,error:null};
 if(name==='staff_chat_member_identities')return {data:assigned?(args?.p_members as string[]).map(member=>({id:member,name:'Synthetic member',birthDate:null,sex:null,clinic:null})):[],error:null};
 if(name==='staff_zoe_member_conversation'){
  if(lookupThrows)throw Error('Synthetic lookup failure');
  if(lookupError)return {data:null,error:{code:lookupError}};
  return {data:malformed?'invalid':assigned&&zoeOn?rows.findLast(row=>row.memberId===args?.p_member)?.id??null:null,error:null};
 }
 if(name==='staff_zoe_open'){
  if(!assigned||!zoeOn)return {data:{ok:false},error:null};
  // The real SQL always inserts. Never model this as an upsert or a canned id.
  const row={id:id(100+(++inserted)),memberId:String(args?.p_member),messages:[]};rows.push(row);
  return {data:{ok:true,conversationId:row.id},error:null};
 }
 if(name==='staff_zoe_read'){
  const row=rows.find(row=>row.id===args?.p_conversation);assert.ok(row);
  return {data:{enabled:zoeOn,id:row.id,member:{id:wrongMember?b:row.memberId,name:'Synthetic member',birthYear:null,sex:null},messages:row.messages},error:null};
 }
 if(name==='patient_coordination_members')return {data:{members:[],nextCursor:null},error:null};
 throw Error(`Unexpected RPC ${name}`);
}};
function load(file:string,overrides:Record<string,unknown>){
 const source=readFileSync(file,'utf8'),exports:Record<string,unknown>={};
 const modules={...Object.fromEntries(ts.preProcessFile(source).importedFiles.map(x=>[x.fileName,{}])),...overrides};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
 return exports;
}
const actor={requireRealStaff:async()=>({identity:{id:actorId,role},client})};
const logging={loggedAction:(_name:string,fn:unknown)=>fn};
const staffActions=load('lib/staff-zoe/actions.ts',{
 zod:{z},'@/lib/observability/with-logging':logging,'@/lib/patient-care/clinical-case-repository':actor,
 'next/navigation':{notFound:()=>{throw Error('Refused');}},
}) as typeof import('@/lib/staff-zoe/actions');
const reads=load('lib/staff-zoe/chat-v2-zoe-read.ts',{'./contracts':contracts});
const actions=load('lib/staff-zoe/chat-v2-actions.ts',{'./patient-labs':await import('@/lib/staff-zoe/patient-labs'),'@/lib/ai-plan/lab-evidence':await import('@/lib/ai-plan/lab-evidence'),
 zod:{z},'@/lib/observability/with-logging':logging,'@/lib/patient-care/clinical-case-repository':actor,
 '@/lib/staff/real-staff-access':{chatDoctorIdentity,chatDoctorEnabled:()=>enabled},
 '@/lib/staff/chat-member-identity-read':{readChatMemberIdentities},
 './actions':staffActions,'./chat-v2-zoe-read':reads,
 './card-read':{runDoctorCard:async()=>({kind:'ready',card:'alerts',incomplete:false,capped:false,inbox:{alerts:[]}})},
}) as typeof import('@/lib/staff-zoe/chat-v2-actions');
const PatientView=()=>null;
const {patientChatPage}=load('components/doctor-chat-v2/patient-chat-page.tsx',{
 '@/lib/staff-zoe/voice':{staffVoiceAvailable:async()=>false},
 zod:{z},'react/jsx-runtime':jsx,'./patient-chat':{PatientChat:PatientView},
 '@/lib/staff/real-staff-render':{requireRealStaffForRender:actor.requireRealStaff},
 '@/lib/staff/staff-locale':{staffLocale:async()=>'en'},'@/lib/staff/staff-locale-copy':copy,
 '@/lib/staff/chat-member-identity-read':{readChatMemberIdentities},'@/lib/staff/real-coordination/schema':coordination,
 '@/lib/ldl/runtime':{readDoctorLdl:async()=>null},'@/lib/doctor-completion/document-runtime':{readDoctorPlanVersions:async()=>[]},
 '@/lib/gp-report/config':{resultsReportEnabled:()=>false},
}) as typeof import('@/components/doctor-chat-v2/patient-chat-page');
async function visit(member:string){
 assert.equal((await patientChatPage(member)).type,PatientView);
 const history=await actions.readDoctorPatientChatHistory(member,doctor);
 assert.equal(history.kind,'history');if(history.kind!=='history')throw Error('History unavailable');
 assert.equal((await actions.readDoctorPatientChatAlerts(member,doctor)).kind,'alerts');
 return history;
}
const first=await visit(a);
rows.find(row=>row.id===first.target?.conversationId)!.messages.push({seq:1,role:'staff',body:'Saved A question',content:null,at:'2026-09-01T10:00:00Z'});
await visit(b);
const restored=await visit(a);
assert.equal(restored.target?.conversationId,first.target?.conversationId,'A → B → A reuses A conversation');
assert.equal(restored.turns[0]?.text,'Saved A question','Saved history survives the real insert-only open semantics');
assert.equal(inserted,2,'Page and passive alerts never insert additional conversations');
assert.ok(restored.turns.every(turn=>turn.memberId===a));
const before=inserted;
for(const error of ['42501','XX000']){lookupError=error;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,error==='42501'?'refused':'unavailable');}
lookupError=null;lookupThrows=true;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'unavailable');lookupThrows=false;
malformed=true;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'unavailable');malformed=false;
assert.equal(inserted,before,'Lookup failures never fall back to inserting');
wrongMember=true;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'refused');wrongMember=false;
zoeOn=false;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'refused');assert.equal((await actions.readDoctorPatientChatAlerts(a,doctor)).kind,'refused');zoeOn=true;
assigned=false;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'refused');assert.equal((await actions.readDoctorPatientChatAlerts(a,doctor)).kind,'refused');assigned=true;
for(const invalid of ['bad',null])assert.equal((await actions.readDoctorPatientChatHistory(invalid,doctor)).kind,'refused');
for(const denied of ['dark','nurse','admin','other doctor']){
 enabled=denied!=='dark';role=['nurse','admin'].includes(denied)?denied:'doctor';actorId=denied==='other doctor'?id(8):doctor;
 calls.length=0;assert.equal((await actions.readDoctorPatientChatHistory(a,doctor)).kind,'refused');assert.equal((await actions.readDoctorPatientChatAlerts(a,doctor)).kind,'refused');assert.deepEqual(calls,[]);
}
assert.equal(inserted,before);
console.log('Staff Zoe member conversation: real page/history/alert loaders preserve A → B → A with insert-only RPC IO; lookup failures, route binding, role, assignment and flags fail closed (no database).');
