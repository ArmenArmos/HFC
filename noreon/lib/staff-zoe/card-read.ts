import 'server-only';
import {z} from 'zod';
import {readEverydayConversation} from './everyday-read';
import {conversationReadSchema} from './contracts';
import {doctorChatHomeEnabled,doctorDecisionsEnabled} from './workspace-config';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {readClinicLabSources} from '@/lib/patient-care/clinic-lab-sources';
import {readRequiredEvidenceSources} from '@/lib/patient-care/required-evidence';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {readDoctorDocuments,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {labAiEnabled} from '@/lib/lab-ai/config';
import {readLab,readLabOverview} from '@/lib/lab-ai/doctor-runtime';
import {readStaffLabResults} from '@/lib/lab-ai/staff-results-server';
import {readMemberHistoryForStaff} from '@/lib/member-history/server';
import {readMemberUploadApprovals} from '@/lib/lab-ai/member-approval-server';
import {readStaffMemberSafety} from '@/lib/member-safety/staff';
import {memberPageSchema,taskPageSchema} from '@/lib/staff/real-coordination/schema';
import {readDoctorLdl} from '@/lib/ldl/runtime';
import {readGpReport,readApprovedGpReport} from '@/lib/gp-report/runtime';
import {languageBlocks} from '@/lib/gp-report/document';
import {readWorkspaceDecisions} from '@/lib/doctor-decisions/read';
import {careAlertsEnabled,careAlertInboxSchema} from '@/lib/care-alerts/contracts';
import {readDoctorUrgentInbox} from '@/lib/doctor-inbox/urgent-inbox-server';
import {mergeUrgent,type UrgentWindow} from '@/lib/doctor-inbox/urgent-windows';

const inputSchema=z.discriminatedUnion('card',[
 z.object({card:z.literal('alerts'),view:z.enum(['live','resolved']).default('live')}),
 z.object({card:z.literal('lab'),conversationId:z.uuid(),fileId:z.uuid()}),
 z.object({card:z.enum(['results','uploads','safety','tasks','consultation','gp','ldl','conversation','observations']),conversationId:z.uuid()}),
]);
export type DoctorCardRequest=z.input<typeof inputSchema>;

/** Caller authenticates a doctor and the mounted actor. Every read retains the page's RPC/feature gates.
 * Member IDs come only from the authorized conversation, followed by a fresh, audited case snapshot.
 * Cards are explicit snapshots: never called by background polling or an AI tool.
 */
export async function runDoctorCard(client:DocumentRpc,raw:unknown,env:Record<string,string|undefined>=process.env){
 if(!doctorChatHomeEnabled(env))return {kind:'refused' as const};
 const parsed=inputSchema.safeParse(raw);if(!parsed.success)return {kind:'invalid' as const};
 const input=parsed.data;
 const status=await client.rpc('staff_zoe_status');
 if(status.error||status.data!==true)return {kind:'refused' as const};
 if(input.card==='alerts'){
  if(!careAlertsEnabled(env))return {kind:'off' as const};
  if(input.view==='live'){
   const urgent=await readDoctorUrgentInbox(client);
   const items=mergeUrgent(urgent.alerts,urgent.windows);
   const windows:UrgentWindow[]=items.filter(item=>item.kind==='urgent_window');
   return {kind:'ready' as const,card:'alerts' as const,view:input.view,
    inbox:{ok:true as const,role:'doctor' as const,asOf:urgent.asOf,alerts:urgent.alerts.map(item=>item.alert)},
    windows,urgentTotal:items.length,incomplete:urgent.unavailable.length>0,capped:urgent.capped};
  }
  const r=await client.rpc('care_alert_inbox',{p_view:input.view,p_limit:100});
  if(r.error)return {kind:r.error.code==='42501'?'refused' as const:'unavailable' as const};
  const p=careAlertInboxSchema.safeParse(r.data);
  return p.success?{kind:'ready' as const,card:'alerts' as const,inbox:p.data,view:input.view,windows:[] as UrgentWindow[],urgentTotal:0,incomplete:false,capped:p.data.alerts.length>=100}:{kind:'unavailable' as const};
 }
 const r=await client.rpc('staff_zoe_read',{p_conversation:input.conversationId});
 const conversation=conversationReadSchema.safeParse(r.data);
 if(r.error||!conversation.success||!conversation.data.enabled)return {kind:'refused' as const};
 const memberId=conversation.data.member.id;
 const s=await client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId});
 if(s.error)return {kind:s.error.code==='42501'?'refused' as const:'unavailable' as const};
 const p=snapshotSchema.safeParse(s.data);
 if(!p.success||p.data.id!==memberId)return {kind:'unavailable' as const};
 const snapshot=p.data,base={kind:'ready' as const,memberId,conversationId:conversation.data.id};
 switch(input.card){
  case 'observations':return {...base,card:'observations' as const,snapshot};
  case 'conversation':{
   if(!doctorDecisionsEnabled(env))return {kind:'off' as const};
   const data=await readEverydayConversation(client,memberId,env);
   return data.kind==='ready'?{...base,...data,card:'conversation' as const}:data;
  }
  case 'lab':{
   if(!labAiEnabled(env))return {kind:'off' as const};
   const data=await readLab(client,memberId,input.fileId);
   if(data==='access')return {kind:'refused' as const};
   if(!data)return {kind:'unavailable' as const};
   return data.enabled?{...base,card:'lab' as const,data}:{kind:'off' as const};
  }
  case 'results':{
   const completion=doctorCompletionEnabled(env);
   const [clinicLab,requiredEvidence,documents,lab,values]=await Promise.all([
    readClinicLabSources(client,memberId),readRequiredEvidenceSources(client,memberId),
    completion?readDoctorDocuments(client,memberId):null,
    completion&&labAiEnabled(env)?readLabOverview(client,memberId):undefined,
    readStaffLabResults(client,memberId),
   ]);
   return {...base,card:'results' as const,snapshot,clinicLab,requiredEvidence,completion,documents,lab,values};
  }
  case 'uploads':{
   const [history,ai]=await Promise.all([readMemberHistoryForStaff(client,memberId),readStaffLabResults(client,memberId)]);
   const approval=ai?.enabled?await readMemberUploadApprovals(client,memberId):undefined;
   return {...base,card:'uploads' as const,history,ai,approval};
  }
  case 'safety':{
   const data=await readStaffMemberSafety(client,memberId);
   if(data==='refused')return {kind:'refused' as const};
   if(!data)return {kind:'unavailable' as const};
   return data.enabled?{...base,card:'safety' as const,data}:{kind:'off' as const};
  }
  case 'tasks':{
   const [tasks,members]=await Promise.all([client.rpc('patient_coordination_queue',{p_case:memberId}),client.rpc('patient_coordination_members',{p_search:memberId})]);
   if(tasks.error?.code==='42501'||members.error?.code==='42501')return {kind:'refused' as const};
   const page=taskPageSchema.safeParse(tasks.data),memberPage=memberPageSchema.safeParse(members.data);
   if(tasks.error||members.error||!page.success||!memberPage.success)return {kind:'unavailable' as const};
   return {...base,card:'tasks' as const,page:page.data,memberPage:memberPage.data};
  }
  case 'consultation':{
   if(!doctorDecisionsEnabled(env))return {kind:'off' as const};
   return {...base,card:'consultation' as const,data:await readWorkspaceDecisions(client,memberId)};
  }
  case 'ldl':{
   const data=await readDoctorLdl(client,memberId);
   if(!data)return {kind:'unavailable' as const};
   return data.enabled?{...base,card:'ldl' as const,data}:{kind:'off' as const};
  }
  case 'gp':{
   const gp=await readGpReport(client,memberId);
   if(gp.status!=='ready')return {kind:gp.status==='off'?'off' as const:'unavailable' as const};
   const approved=gp.read.versions.find(v=>v.sourceToken===gp.read.token);
   const frozen=approved?await readApprovedGpReport(client,memberId,approved.version):null;
   if(approved&&!frozen)return {kind:'unavailable' as const};
   return {...base,card:'gp' as const,token:gp.read.token,versions:gp.read.versions,currentApproved:frozen?.approval.version??null,
    blocks:{hy:languageBlocks(frozen?.report??gp.report,frozen?.approval??null,'hy'),en:languageBlocks(frozen?.report??gp.report,frozen?.approval??null,'en')}};
  }
 }
}
export type DoctorCardResponse=Awaited<ReturnType<typeof runDoctorCard>>;
