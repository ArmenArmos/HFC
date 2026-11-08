import 'server-only';
import {z} from 'zod';
import {readFirstNoteQueueCount} from '@/lib/first-note/runtime';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import {memberSearchInputSchema} from '@/lib/staff/member-search-schema';
import {readDoctorDay} from '@/lib/doctor-inbox/day';
import {readBpMemberDevices,type BpRpc} from '@/lib/bp-device/runtime';
import {readMemberHistoryForStaff} from '@/lib/member-history/server';
import {chartSeries} from '@/lib/member-history/measures';
import {bpDevicesEnabled} from '@/lib/bp-device/config';
import {addDays,yerevanDate} from '@/lib/bp-week/model';
import {type L} from './contracts';
import {readWorkspaceSelection} from './workspace-read';
import {staffRecordReader} from './server';
import {readWorkspaceDecisions} from '@/lib/doctor-decisions/read';
import {doctorChatHomeEnabled,doctorDecisionsEnabled} from './workspace-config';

const requestSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('day')}),
 z.object({kind:z.literal('poll')}),
 memberSearchInputSchema.extend({kind:z.literal('members')}),
 memberSearchInputSchema.extend({kind:z.literal('missing_bp')}),
 z.object({kind:z.literal('select'),memberId:z.uuid()}),
 z.object({kind:z.literal('record'),conversationId:z.uuid()}),
]);
export type HomeRequest=z.infer<typeof requestSchema>;
export type HomeContext={client:BpRpc;role:string;locale:L};

/** Authentication is the caller's job. This gate runs on every home action, including polls and paging. */
export async function runDoctorHome(context:HomeContext,raw:unknown,env:Record<string,string|undefined>=process.env,now=new Date()){
 if(!doctorChatHomeEnabled(env)||context.role!=='doctor')return {kind:'refused' as const};
 const p=requestSchema.safeParse(raw);if(!p.success)return {kind:'invalid' as const};
 const {client,locale}=context,input=p.data;
 const status=await client.rpc('staff_zoe_status');
 if(status.error||status.data!==true)return {kind:'refused' as const};
 if(input.kind==='poll'){
  const [day,firstNoteCount]=await Promise.all([readDoctorDay(client,true,now,false),readFirstNoteQueueCount(client)]);
  return {kind:'poll' as const,day,firstNoteCount};
 }
 if(input.kind==='day')return {kind:'day' as const,day:await readDoctorDay(client,true,now)};
 if(input.kind==='members'||input.kind==='missing_bp'){
  const result=await runMemberIdentitySearch({query:input.query,cursor:input.cursor},client);
  if(!result.ok)return result.reason==='invalid'?{kind:'invalid' as const}:{kind:'unavailable' as const};
  if(input.kind==='members')return {kind:'members' as const,page:result.page,query:input.query};
  if(!bpDevicesEnabled(env))return {kind:'unavailable' as const};
  const today=yerevanDate(now),weekday=new Date(`${today}T00:00:00Z`).getUTCDay(),from=addDays(today,-((weekday+6)%7));
  const rows=[];let unknown=0;
  // Bounded to the audited search page. A failed or disabled BP read is unknown, never "has not logged".
  for(const row of result.page.rows){
   try{const data=await readBpMemberDevices(client,row.id);
    if(!data.readings){unknown++;continue;}
    if(!data.readings.some(r=>yerevanDate(new Date(r.measuredAt))>=from&&Date.parse(r.measuredAt)<=now.getTime()))rows.push(row);
   }catch{unknown++;}
  }
  return {kind:'missing_bp' as const,page:result.page,missingIds:rows.map(row=>row.id),query:input.query,from,to:today,unknown,asOf:now.toISOString()};
 }
 let conversationId:string;
 if(input.kind==='select'){
  const r=await client.rpc('staff_zoe_open',{p_member:input.memberId});
  const opened=z.object({ok:z.literal(true),conversationId:z.uuid()}).safeParse(r.data);
  if(r.error||!opened.success)return {kind:'refused' as const};
  conversationId=opened.data.conversationId;
 }else conversationId=input.conversationId;
 // The conversation read establishes the member. Never use a browser's member ID for the record or decisions.
 const data=await readWorkspaceSelection(client,conversationId,staffRecordReader(client,locale,now),true);
 if(!data?.conversation||data.refused)return {kind:'refused' as const};
 const memberId=data.conversation.member.id;
 // Decisions and BP both lock the case row, so one runs after the other.
 const decisions=doctorDecisionsEnabled(env)?await readWorkspaceDecisions(client,memberId):null;
 const bp=bpDevicesEnabled(env)?await readBpMemberDevices(client,memberId).catch(()=>null):null;
 const history=await readMemberHistoryForStaff(client,memberId);
 return {kind:'record' as const,conversation:data.conversation,glance:data.glance,decisions,bp:bp?.readings??null,bpState:!bpDevicesEnabled(env)?'off' as const:bp?.readings?'ok' as const:'unavailable' as const,charts:history?chartSeries(history.values,{bp:[],observations:[]},[]):null};
}
export type HomeResponse=Awaited<ReturnType<typeof runDoctorHome>>;
