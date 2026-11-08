'use server';
import {z} from 'zod';
import {questionMemberIdentities} from '@/lib/staff/chat-member-identity-read';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import type {MemberSearchInput} from '@/lib/staff/member-search-schema';
import {openStaffZoe,type OpenResult} from '@/lib/staff-zoe/actions';
import {readChatZoeHistory,resolveQuestionMember,questionMemberTokens,type ChatQuestionMemberResponse,type ChatZoeHistoryResponse} from '@/lib/staff-zoe/chat-v2-zoe-read';
import {nurseChatEnabled} from './config';

async function chatNurse(expectedNurseId:unknown){
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return null;
 try{
  const actor=await requireRealStaff();
  return actor.identity.role==='nurse'&&actor.identity.id===expectedNurseId?actor:null;
 }catch{return null;}
}

export const openNurseChatZoe=loggedAction('openNurseChatZoe',async function openNurseChatZoe(memberId:unknown,expectedNurseId:unknown):Promise<OpenResult|{kind:'refused'}>{
 if(!await chatNurse(expectedNurseId)||!z.uuid().safeParse(memberId).success)return {kind:'refused'};
 try{return await openStaffZoe(memberId);}catch{return {ok:false};}
});

export const readNurseChatZoeHistory=loggedAction('readNurseChatZoeHistory',async function readNurseChatZoeHistory(expectedNurseId:unknown):Promise<ChatZoeHistoryResponse>{
 const actor=await chatNurse(expectedNurseId);if(!actor)return {kind:'refused'};
 return readChatZoeHistory(actor.client as unknown as Parameters<typeof readChatZoeHistory>[0]);
});

export const findNurseChatQuestionMember=loggedAction('findNurseChatQuestionMember',async function findNurseChatQuestionMember(question:unknown,expectedNurseId:unknown,current?:{memberId:string;memberName:string}):Promise<ChatQuestionMemberResponse>{
 const actor=await chatNurse(expectedNurseId);if(!actor)return {kind:'refused'};
 if(typeof question!=='string'||!question.trim()||!questionMemberTokens(question,Infinity))return {kind:'refused'};
 if(current!==undefined&&!z.strictObject({memberId:z.uuid(),memberName:z.string().min(1).max(1000)}).safeParse(current).success)return {kind:'refused'};
 const search=async(query:string,cursor:MemberSearchInput['cursor']=null)=>{
  const result=await runMemberIdentitySearch({query,cursor},actor.client);
  return result.ok?{kind:'members' as const,page:result.page}:{kind:'unavailable' as const};
 };
 try{
  // A remembered target is only a hint. Confirm it still belongs to this nurse
  // before the shared resolver can keep it for a question without a name.
  if(current){
   const hint=current;
   const result=await search(hint.memberName.normalize('NFKC').toLowerCase());
   if(result.kind!=='members')return {kind:'unavailable'};
   const row=result.page.rows.find(row=>row.id===hint.memberId);
   if(!row?.name)return {kind:'refused'};
   current={memberId:row.id,memberName:row.name};
  }
  return await questionMemberIdentities(actor.client as unknown as Parameters<typeof questionMemberIdentities>[0],await resolveQuestionMember(question,current,search));
 }catch{return {kind:'unavailable'};}
});
