import 'server-only';
import {log} from '@/lib/observability/logger';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import {readChatMemberIdentities} from '@/lib/staff/chat-member-identity-read';
import {readBpMemberDevices} from '@/lib/bp-device/runtime';
import {readDoctorLdl} from '@/lib/ldl/runtime';
import {assessLdl} from '@/lib/ldl/status';
import {addDays,yerevanDate} from '@/lib/bp-week/model';
import type {ChatMemberIdentity} from '@/lib/staff/chat-member-identity-schema';
import type {MemberSearchInput} from '@/lib/staff/member-search-schema';
import type {ChatWho} from './chat-v2-read';
import type {PanelResponse,PanelMember,PanelGraph,PanelBar} from './panel';
type Rpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** Queue authorization uses requested IDs, independently of the bounded roster used for graphs.
 * All reads use the admitted doctor session and existing audited, assignment-scoped RPCs.
 */
export async function readDoctorPanel(client:Rpc,doctorId:string,queue:ChatWho,now=new Date(),metrics=true):Promise<PanelResponse>{
 try{
  const queueIds=[...new Set([...queue.alerts,...queue.windows,...queue.items,...queue.labs,...queue.plans,...queue.uploads,...queue.identityChecks].map(row=>row.memberId))];
  const queueIdentities:ChatMemberIdentity[]=[];let queueComplete=true;
  for(let start=0;start<queueIds.length;start+=50){
   const rows=await readChatMemberIdentities(client,queueIds.slice(start,start+50));
   if(rows)queueIdentities.push(...rows);else queueComplete=false;
  }
  if(!queueComplete)log.warn('doctor_panel_source_missing',{rpc:'staff_chat_member_identities'});
  // This RPC rechecks current assignment, including queue members beyond the roster's 200-member cap.
  const own=new Set(queueIdentities.map(row=>row.id)),filter=<T extends {memberId:string}>(rows:T[])=>rows.filter(row=>own.has(row.memberId));
  const who:ChatWho={...queue,missing:[...new Set([...(queue.missing??[]),...(!queueComplete?['member_identities']:[])])],alerts:filter(queue.alerts),windows:filter(queue.windows),items:filter(queue.items),labs:filter(queue.labs),plans:filter(queue.plans),uploads:filter(queue.uploads),identityChecks:filter(queue.identityChecks),urgentIncomplete:queue.urgentIncomplete||!queueComplete,incomplete:queue.incomplete||!queueComplete};
  // Other work is known in aggregate, but cannot be attributed to individual members.
  const othersWaiting=queue.others.rest>0;
  who.p0Total=who.alerts.length+who.windows.filter(w=>!who.alerts.some(a=>a.memberId===w.memberId)).length;
  who.uploadTotal=who.uploads.length;
  const urgent=new Set([...who.alerts.map(row=>row.memberId),...who.windows.map(row=>row.memberId)]);
  const needs=new Set([...who.items,...who.labs,...who.plans,...who.uploads,...who.identityChecks].map(row=>row.memberId));
  // Summary callers need no roster or metric reads at all.
  if(!metrics)return {kind:'panel',rows:[],graphs:[],who,asOf:now.toISOString()};
  const ids:string[]=[];let cursor:MemberSearchInput['cursor']=null,complete=false;
  try{
   for(let page=0;page<4;page++){
    const result=await runMemberIdentitySearch({query:'',cursor},client);
    if(!result.ok)break;
    ids.push(...result.page.rows.filter(row=>row.doctorId===doctorId).map(row=>row.id));
    if(!result.page.hasMore){complete=true;break;}
    if(!result.page.nextCursor)break;
    cursor=result.page.nextCursor;
   }
  }catch{/* Roster failure suppresses aggregates, never the authorized queue. */}
  if(new Set(ids).size!==ids.length)complete=false;
  const identities:ChatMemberIdentity[]=[];
  const uniqueIds=[...new Set(ids)];
  for(let start=0;start<uniqueIds.length;start+=50){
   const rows=await readChatMemberIdentities(client,uniqueIds.slice(start,start+50));
   if(rows)identities.push(...rows);else complete=false;
  }
  // Reassignment between reads cannot leak a stale member record or produce a complete total.
  if(uniqueIds.some(id=>!identities.some(row=>row.id===id)))complete=false;
  const today=yerevanDate(now),weekday=new Date(`${today}T00:00:00Z`).getUTCDay(),monday=addDays(today,-((weekday+6)%7)),periodStart=addDays(monday,-21);
  let readingsComplete=true;
  const rows:PanelMember[]=[],readings=new Map<string,{at:string;memberId:string}[]>(),ldlStatus=new Map<string,string>();
  for(let start=0;start<identities.length;start+=4){
   const batch=await Promise.all(identities.slice(start,start+4).map(async identity=>{
    const bpRead=await readBpMemberDevices(client,identity.id).catch(()=>null);
    const ldl=await readDoctorLdl(client,identity.id).catch(()=>null);
    const goal=ldl?.enabled?[...ldl.goals].sort((a,b)=>b.version-a.version)[0]??null:null;
    const assessment=ldl?.enabled?assessLdl({goal,observations:ldl.observations.filter(o=>o.on<=yerevanDate(now))}):null;
    ldlStatus.set(identity.id,assessment?.status==='at_goal'?'at_goal':assessment?.status==='above_goal'?'above_goal':'unknown');
    const allBp=bpRead?.readings;
    const bpRows=(allBp??[]).filter(r=>Number.isFinite(Date.parse(r.measuredAt))&&Date.parse(r.measuredAt)<=now.getTime()).sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt));
    // The audited combined RPC returns at most 500 readings. A full window is known only if the cap
    // was not reached or its oldest returned instant is strictly before the plotted period.
    if(!allBp||allBp.length>=500&&!allBp.some(r=>yerevanDate(new Date(r.measuredAt))<periodStart))readingsComplete=false;
    readings.set(identity.id,bpRows.map(r=>({at:r.measuredAt,memberId:identity.id})));
    const bp=bpRows[0],latest=assessment?.newest;
    return {identity,risk:goal?.category??null,attention:urgent.has(identity.id)?'urgent' as const:needs.has(identity.id)?'needs_me' as const:who.incomplete||who.capped||othersWaiting?'unknown' as const:'none' as const,
     unavailable:!allBp||ldl===null,bp:bp?{systolic:bp.systolic,diastolic:bp.diastolic,at:bp.measuredAt,unverified:bp.source==='manual'}:null,
     ldl:latest?{value:latest.mmol,on:latest.on,counted:latest.counts}:null};
   }));
   rows.push(...batch);
  }
  if(!complete)return {kind:'panel',rosterComplete:false,rows,graphs:[],who,asOf:now.toISOString()};
  const bars=(keys:string[],pick:(key:string)=>string[]):PanelBar[]=>keys.map(key=>{const memberIds=pick(key);return {key,count:memberIds.length,memberIds};});
  const graphs:PanelGraph[]=[{kind:'risk',total:rows.length,bars:bars(['very_high','high','moderate','low','unknown'],key=>rows.filter(r=>(r.risk??'unknown')===key).map(r=>r.identity.id))}];
  // A failed/disabled read is unknown, never an above-goal member. The existing assessor applies reviewed-source rules
  // and the doctor's saved goal (whose defaults come from THRESHOLD); this module invents no clinical cut points.
  graphs.push({kind:'ldl',total:rows.length,bars:bars(['at_goal','above_goal','unknown'],key=>rows.filter(r=>ldlStatus.get(r.identity.id)===key).map(r=>r.identity.id))});
  // This graph counts open alerts only; other waiting work cannot change its membership.
  if(queueComplete&&!queue.incomplete&&!queue.capped){
   const days=Array.from({length:7},(_,i)=>addDays(today,i-6));
   graphs.push({kind:'alerts',total:rows.length,bars:days.map(key=>{
    const alerts=who.alerts.filter(a=>a.alert.state!=='resolved'&&yerevanDate(new Date(a.alert.createdAt))===key);
    return {key,count:alerts.length,memberIds:[...new Set(alerts.map(a=>a.memberId))]};
   })});
  }
  if(readingsComplete){
   const weeks=Array.from({length:4},(_,i)=>addDays(monday,(i-3)*7));
   graphs.push({kind:'readings',total:rows.length,bars:weeks.map(key=>{
    const points=[...readings.values()].flat().filter(r=>{const day=yerevanDate(new Date(r.at));return day>=key&&day<addDays(key,7);});
    return {key,count:points.length,memberIds:[...new Set(points.map(r=>r.memberId))]};
   })});
  }
  return {kind:'panel',rows,graphs,who,asOf:now.toISOString()};
 }catch{return {kind:'unavailable'};}
}
