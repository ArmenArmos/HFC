import 'server-only';
import {readDoctorUploadOverrides} from '@/lib/staff/doctor-upload-overrides';
import {z} from 'zod';
import {zoeRunsSchema,type ZoeRunView} from '@/lib/zoe/contracts';
import {st} from '@/lib/staff/staff-locale-copy';
import {snapshotSchema,type ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {readStaffBpWeek,type BpWeekRpc} from '@/lib/bp-week/server';
import {readStaffLabResults} from '@/lib/lab-ai/staff-results-server';
import {readDoctorLdl,type LdlRpc} from '@/lib/ldl/runtime';
import {readDoctorLdlResponses} from '@/lib/ldl/response-runtime';
import {readDoctorMedicineConcerns,readStaffMedicineReasons,readStaffMedicines} from '@/lib/member-medicines/server';
import {readDoctorPlanVersions,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {readNurseVisitRecord,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import {doctorInboxSchema} from '@/lib/doctor-inbox/contracts';
import {taskPageSchema} from '@/lib/staff/real-coordination/schema';
import {staffWorkspaceSchema} from '@/lib/conversation-persistence/contracts';
import {nurseWorkspaceSchema} from '@/lib/nurse-chat/contracts';
import {zoeServiceRpc} from '@/lib/zoe/server';
import {parseRouteConfig,configuredZoeRouting,providerMode} from '@/lib/zoe/route-config';
import {sealRunIo} from '@/lib/zoe/seal';
import type {ZoeProvider} from '@/lib/zoe/provider';
import type {Effort} from '@/lib/zoe/provider';
import {retryOnLock} from '@/lib/doctor-decisions/read';
import {beginResultSchema,type L,type StaffZoeRole,type ToolId,type ToolResult} from './contracts';
import {adherenceResult,bpResult,emptyResult,labsResult,ldlResult,messagesResult,openItemsResult,overviewResult,planResult,visitsResult} from './facts';
import {readDoctorFirstNote,type FirstNoteRpc} from '@/lib/first-note/runtime';
import {readZoeWhyTool} from './why-seam';
import {readLipidPlanner} from '@/lib/lipid-planner/runtime';
import {buildLipidPlan} from '@/lib/lipid-planner/plan';
import {lipidPlanResult} from './lipid-plan';
import {createStandInProvider} from './stand-in';
import {AccessLost,type ModelSet,type TurnPorts} from './turn';

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
type Env=Record<string,string|undefined>;

/** Fast endpoint and effort. The tier comes from staff_zoe_settings.model_tier; the model of the tier from AI settings. */
export function staffSpeed(env:Env=process.env):{fast:boolean;effort:Effort|null}{
 const e=env.NOREON_STAFF_ZOE_EFFORT;
 return {fast:env.NOREON_STAFF_ZOE_FAST!=='false',effort:e==='none'||e==='low'||e==='medium'||e==='high'?e:e==='default'?null:'low'};
}

const LOCKING_TOOLS:ReadonlySet<ToolId>=new Set(['bp','adherence','visits','member_messages']);

/** Same read definition for page cards and chat tools. Each underlying RPC enforces staff scope and records access.
 * No model or browser calls this directly; page callers authenticate first, chat callers also pass staff_zoe_gate.
 * Cache snapshots by member only within this reader/request, never across staff identities.
 */
export function staffRecordReader(client:Rpc,locale:L,now:Date){
 const snapshots=new Map<string,Promise<ClinicalSnapshot|null>>();
 const readSnapshot=(memberId:string)=>{
  if(!snapshots.has(memberId))snapshots.set(memberId,Promise.resolve(client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId})).then(r=>{
   if(r.error?.code==='42501')throw new AccessLost();
   if(r.error)return null;const p=snapshotSchema.safeParse(r.data);return p.success&&p.data.id===memberId?p.data:null;
  }));
  return snapshots.get(memberId)!;
 };
 // These reads authorize by locking the member's case row with NOWAIT or a short timeout, and that lock is held to the
 // end of each read. Run together they refuse each other, so they take turns. The rest stay parallel.
 let turn:Promise<unknown>=Promise.resolve();
 const inTurn=<T>(next:()=>Promise<T>)=>{const result=turn.then(next,next);turn=result.catch(()=>{});return result;};
 const read=async(tool:ToolId,memberId:string,role:StaffZoeRole):Promise<ToolResult>=>{
  const c={memberId,role,locale,now};
  const none=(state:'off'|'unavailable'|'not_permitted')=>emptyResult(tool,state,memberId,role);
  const doctor=role==='doctor';
  switch(tool){
   case 'overview':{const s=await readSnapshot(memberId);return s?overviewResult(s,c):none('unavailable');}
   case 'bp':{const [w,s]=await Promise.all([readStaffBpWeek(client as unknown as BpWeekRpc,memberId).catch(e=>{if((e as {code?:string}).code==='42501')throw new AccessLost();return null;}),readSnapshot(memberId)]);
    return w||s?bpResult(w,s,c):none('unavailable');}
   case 'labs':{if(!doctor)return none('not_permitted');const r=await readStaffLabResults(client,memberId);const checks=await readDoctorUploadOverrides(client,memberId);if(checks===null)return none('unavailable');return r?.enabled?labsResult(r,c,checks):checks.length?{...none('off'),state:'ok',identityChecks:checks}:r===undefined||r?.enabled===false?none('off'):none('unavailable');}
   case 'ldl':{if(!doctor)return none('not_permitted');const [d,responses]=await Promise.all([readDoctorLdl(client as unknown as LdlRpc,memberId),readDoctorLdlResponses(client as unknown as LdlRpc)]);
    return !d?none('unavailable'):!d.enabled?none('off'):ldlResult(d,responses,c);}
   // Nurse metadata comes from the same authorized snapshot as her publications, with no doctor-only read.
   case 'plan':{const [s,v]=await Promise.all([readSnapshot(memberId),doctor?readDoctorPlanVersions(client as unknown as DocumentRpc,memberId):Promise.resolve(null)]);return s?planResult(s,doctor?v:s.planVersions??null,c):none('unavailable');}
   case 'adherence':{const m=await readStaffMedicines(client as unknown as BpWeekRpc,memberId).catch(e=>{if((e as {code?:string}).code==='42501')throw new AccessLost();return null;});
    if(!m)return none('unavailable');if(!m.enabled)return none('off');
    const [reasons,concerns]=await Promise.all([readStaffMedicineReasons(client as unknown as BpWeekRpc,memberId),doctor?readDoctorMedicineConcerns(client as unknown as BpWeekRpc):Promise.resolve(null)]);
    return adherenceResult(m,reasons,concerns,c);}
   case 'open_items':{const [inbox,tasks,firstNote]=await Promise.all([doctor?Promise.resolve(client.rpc('doctor_ai_inbox')).then(r=>{const p=doctorInboxSchema.safeParse(r.data);return r.error||!p.success?null:p.data;}):Promise.resolve(null),
     Promise.resolve(client.rpc('patient_coordination_queue',{p_case:memberId})).then(r=>{if(r.error?.code==='42501')throw new AccessLost();const p=taskPageSchema.safeParse(r.data);return r.error||!p.success?null:p.data.tasks;}),
     // The doctor's first note to the member is an open item too; null means it could not be read, never "nothing waiting".
     doctor?readDoctorFirstNote(client as unknown as FirstNoteRpc,memberId):Promise.resolve(undefined)]);
    return openItemsResult({inbox,tasks,firstNote},c);}
   case 'visits':{const r=await readNurseVisitRecord(client as unknown as NurseVisitRpc,memberId);return r?visitsResult(r,c):none('unavailable');}
   case 'member_messages':{
    if(!doctor){
     // The nurse reads what her own conversation page shows, through the same RPC. Zoe's run history stays doctor only.
     const missing:string[]=[];
     let items:Extract<z.infer<typeof nurseWorkspaceSchema>,{ok:true}>['items']=[];
     try{
      const r=await retryOnLock(client).rpc('conversation_nurse_workspace',{p_member:memberId});
      if(r.error?.code==='42501')throw new AccessLost();
      const p=nurseWorkspaceSchema.safeParse(r.data);
      // The RPC answers an assignment lost between the gate and this read as {ok:false,code:'denied'}, not as a SQL error.
      if(p.success&&!p.data.ok&&p.data.code==='denied')throw new AccessLost();
      if(!r.error&&p.success&&p.data.ok)items=p.data.items;
      else missing.push(st(locale,'Member messages could not be read','Անդամի հաղորդագրությունները չհաջողվեց կարդալ','Не удалось прочитать сообщения участника'));
     }catch(e){if(e instanceof AccessLost||(e as {code?:string})?.code==='42501')throw new AccessLost();missing.push(st(locale,'Member messages could not be read','Անդամի հաղորդագրությունները չհաջողվեց կարդալ','Не удалось прочитать сообщения участника'));}
     const byTime=[...items].sort((a,b)=>a.at.localeCompare(b.at));
     const r=messagesResult(byTime.filter(m=>m.senderRole==='member').map((m,i)=>({seq:i,text:m.text,at:m.at})),c,
      byTime.filter(m=>m.senderRole==='nurse').map(m=>({text:m.text,at:m.at,senderName:m.senderName})),
      byTime.filter(m=>m.senderRole==='zoe').map(m=>({id:m.id,answer:m.text,finishedAt:m.at})));
     return {...r,missing,state:missing.length&&r.state==='none'?'unavailable':r.state};
    }
    const missing:string[]=[];
    let workspace:z.infer<typeof staffWorkspaceSchema>|null=null;
    let runs:ZoeRunView[]=[];
    try{
     const r=await retryOnLock(client).rpc('conversation_workspace',{p_member:memberId});
     if(r.error?.code==='42501')throw new AccessLost();
     const p=staffWorkspaceSchema.safeParse(r.data);
     if(!r.error&&p.success)workspace=p.data;
    }catch(e){if(e instanceof AccessLost||(e as {code?:string})?.code==='42501')throw new AccessLost(); /* Keep the other read and name the gap below. */ }
    if(!workspace)missing.push(st(locale,'Member messages could not be read','Անդամի հաղորդագրությունները չհաջողվեց կարդալ','Не удалось прочитать сообщения участника'));
    // Both conversation reads stay inside member_messages' sequential locking turn, as the staff doctor.
    try{
     const r=await retryOnLock(client).rpc('zoe_runs_for_doctor',{p_member:memberId});
     if(r.error?.code==='42501')throw new AccessLost();
     const p=zoeRunsSchema.safeParse(r.data);
     if(r.error||!p.success)throw Error('Zoe replies unavailable');
     runs=p.data.runs;
    }catch(e){if(e instanceof AccessLost||(e as {code?:string})?.code==='42501')throw new AccessLost();missing.push(st(locale,'Zoe replies could not be read','Զոյայի պատասխանները չհաջողվեց կարդալ','Не удалось прочитать ответы Зои'));}
    // The existing RPC is bounded to five runs, which can include runs without a reply.
    if(runs.length>=5&&runs.filter(r=>r.answer?.trim()).length<4)missing.push(st(locale,'Only replies in the recent Zoe runs read are available. Earlier replies were not read.','Հասանելի են միայն կարդացված վերջին Զոյա գործարկումների պատասխանները։ Ավելի վաղ պատասխանները չեն կարդացվել։','Доступны только ответы из прочитанных последних запусков Зои. Более ранние ответы не прочитаны.'));
    const r=messagesResult(workspace&&'messages'in workspace?workspace.messages:[],c,workspace&&'nurseReplies'in workspace?workspace.nurseReplies:[],runs);
    return {...r,missing,state:missing.length&&r.state==='none'?'unavailable':r.state};}
   case 'zoe_why':return readZoeWhyTool(client,c);
   case 'lipid_plan':{if(!doctor)return none('not_permitted');const r=await readLipidPlanner(client as unknown as LdlRpc,memberId);if(!r)return none('unavailable');if(!r.enabled)return none('off');
    const plan=buildLipidPlan(r);return plan?lipidPlanResult(plan,c):none('off');}
  }
 };
 return (tool:ToolId,memberId:string,role:StaffZoeRole)=>LOCKING_TOOLS.has(tool)?inTurn(()=>read(tool,memberId,role)):read(tool,memberId,role);
}

/** Chat adds the existing run/tool permission gate before the shared audited read. */
export function staffTools(client:Rpc,locale:L,now:Date){
 const read=staffRecordReader(client,locale,now);
 return async(tool:ToolId,run:{runId:string;memberId:string;role:StaffZoeRole}):Promise<ToolResult>=>{
  const gate=await client.rpc('staff_zoe_gate',{p_run:run.runId,p_tool:tool});
  if(gate.error)throw new AccessLost();
  const memberId=z.object({memberId:z.uuid()}).parse(gate.data).memberId;
  return read(tool,memberId,run.role);
 };
}

/** The model for a turn, from configuration. The stand-in where nothing may leave the server. */
export async function staffModels(tier:'low'|'medium'|'high',env:Env=process.env):Promise<ModelSet>{
 const mode=providerMode(env);
 if(mode==='off')return null;
 if(mode==='fake')return {primary:createStandInProvider(),fallback:null,fast:false,effort:null};
 const rpc=zoeServiceRpc(env);if(!rpc)return null;
 const config=parseRouteConfig(await rpc('zoe_route_config',{}));
 const t=config.tiers[tier];if(!t)return null;
 const routing=configuredZoeRouting(config,env);
 const primary=routing.providerFor(t.model) as ZoeProvider|null;if(!primary)return null;
 return {primary,fallback:t.fallback?routing.providerFor(t.fallback) as ZoeProvider|null:null,...staffSpeed(env)};
}

/**
 * The ports of a turn. begin and the tool reads run as the staff user. reserve and finish run with the service role, on
 * this server only: they keep the spend and the verdict out of a browser's reach, and they read nothing of the member.
 */
export function staffTurnPorts(client:Rpc,locale:L,env:Env=process.env):TurnPorts{
 const service=zoeServiceRpc(env);
 return {
  begin:async req=>{const r=await client.rpc('staff_zoe_begin',{p_conversation:req.conversationId,p_submission:req.submissionId,p_text:req.text});
   if(r.error?.code==='42501')throw new AccessLost();if(r.error)throw Error('Zoe is unavailable.');return beginResultSchema.parse(r.data);},
  read:staffTools(client,locale,new Date()),
  models:tier=>staffModels(tier,env),
  reserve:async(runId,estimateUsd,local,tier,model)=>{if(!service)return {ok:false,code:'no_service'};
   return z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string()})]).parse(await service('staff_zoe_reserve',{p_run:runId,p_estimate_usd:estimateUsd,p_local:local,p_tier:tier,p_model:model}));},
  finish:async(runId,input)=>{if(!service)throw Error('Zoe is unavailable.');await service('staff_zoe_finish',{p_run:runId,p_result:input});},
  seal:plain=>sealRunIo(plain,env),
  now:()=>Date.now(),
 };
}
