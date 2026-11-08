'use server';
import {unstable_rethrow} from 'next/navigation';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import type {MemberSearchResult} from '@/lib/staff/member-search-schema';
import {nurseChatEnabled} from './config';
import {z} from 'zod';
import {nurseVisitSources,type NurseVisitReady,type NurseVisitList} from '@/lib/nurse-visit/schema';
import {readNurseVisit,readNurseVisits,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';

export const searchNurseChatMembers=loggedAction('searchNurseChatMembers',async function searchNurseChatMembers(query:unknown):Promise<MemberSearchResult>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return {ok:false,reason:'unavailable'};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {ok:false,reason:'unavailable'};
  // The existing identity search validates input and enforces current assignments in SQL.
  return await runMemberIdentitySearch({query,cursor:null},client);
 }catch(error){unstable_rethrow(error);return {ok:false,reason:'unavailable'};}
});

export const readNurseChatVisit=loggedAction('readNurseChatVisit',async function readNurseChatVisit(memberId:unknown,source:unknown,visitId:unknown):Promise<NurseVisitReady|'unavailable'|null>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return null;
 const parsed=z.object({memberId:z.uuid(),source:z.enum(nurseVisitSources),visitId:z.uuid()}).safeParse({memberId,source,visitId});
 if(!parsed.success)return null;
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return null;
  const data=await readNurseVisit(client as unknown as NurseVisitRpc,parsed.data.memberId,parsed.data.source,parsed.data.visitId);
  if('status'in data&&data.status==='unavailable')return 'unavailable';
  return 'enabled'in data&&data.enabled&&data.visit.id===parsed.data.visitId&&data.visit.source===parsed.data.source?data:null;
 }catch(error){unstable_rethrow(error);if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='42501')return null;return 'unavailable';}
});

export type NurseChatVisitsRead=
 | {status:'ready';data:Extract<NurseVisitList,{enabled:true}>}
 | {status:'refused'|'unavailable'};

/** A failed read keeps the last list. Only a known refusal removes it. */
export const readNurseChatVisits=loggedAction('readNurseChatVisits',async function readNurseChatVisits():Promise<NurseChatVisitsRead>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return {status:'refused'};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {status:'refused'};
  // nurse_visit_list scopes rows to current nurse assignments and care access,
  // retaining its existing date window and recently completed visits.
  const data=await readNurseVisits(client as unknown as NurseVisitRpc);
  if(!data.enabled||data.role!=='nurse')return {status:'refused'};
  return {status:'ready',data};
 }catch(error){unstable_rethrow(error);return {status:typeof error==='object'&&error!==null&&'code'in error&&error.code==='42501'?'refused':'unavailable'};}
});
