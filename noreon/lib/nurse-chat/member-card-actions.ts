'use server';
import {z} from 'zod';
import {unstable_rethrow} from 'next/navigation';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff,snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {staffLocale} from '@/lib/staff/staff-locale';
import {staffRecordReader} from '@/lib/staff-zoe/server';
import {chatReportedFacts,withChatFacts} from '@/lib/staff-zoe/chat-reported';
import type {VisitRpc} from '@/lib/staff/visit-evidence-runtime';
import {readLabStages} from '@/lib/staff/lab-stage-runtime';
import {readStaffBpWeek} from '@/lib/bp-week/server';
import {readNurseVisits,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import {nurseChatEnabled} from './config';

const request=z.object({memberId:z.uuid(),card:z.enum(['context','notes','samples','week'])});
/** Reuses the member page's authenticated readers. Prove assignment before reading a card. */
export const readNurseMemberCard=loggedAction('readNurseMemberCard',async function readNurseMemberCard(memberId:unknown,card:unknown){
 if(!nurseChatEnabled())return {kind:'off' as const};
 const parsed=request.safeParse({memberId,card});
 if(!parsed.success)return {kind:'denied' as const};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {kind:'denied' as const};
  const result=await client.rpc('patient_clinical_case_snapshot',{p_user_id:parsed.data.memberId});
  if(result.error?.code==='42501')return {kind:'denied' as const};
  const snapshot=snapshotSchema.safeParse(result.data);
  if(result.error||!snapshot.success||snapshot.data.id!==parsed.data.memberId)return {kind:'unavailable' as const};
  const now=new Date();
  switch(parsed.data.card){
   case 'notes':return {kind:'ready' as const,card:'notes' as const,memberId:snapshot.data.id,revision:snapshot.data.revision,notes:snapshot.data.careNotes??[]};
   case 'context':{
    const locale=await staffLocale(identity.role),read=staffRecordReader(client as unknown as Parameters<typeof staffRecordReader>[0],locale,now);
    const [cards,messages]=await Promise.all([
     Promise.all((['overview','bp','plan','adherence','open_items','visits'] as const).map(tool=>read(tool,parsed.data.memberId,'nurse'))),
     // What the member wrote about her pressure and medicines shows on those cards, marked member reported. A failed read adds nothing.
     read('member_messages',parsed.data.memberId,'nurse').catch(()=>null),
    ]);
    const chat=messages?chatReportedFacts(messages.quotes,locale):{bp:[],medicines:[],ldl:[]};
    return {kind:'ready' as const,card:'context' as const,cards:cards.map(card=>card.tool==='bp'?withChatFacts(card,chat.bp):card.tool==='adherence'?withChatFacts(card,chat.medicines):card.tool==='overview'?withChatFacts(card,chat.ldl):card)};
   }
   case 'samples':{
    const data=await readLabStages({memberId:parsed.data.memberId,client:client as unknown as VisitRpc});
    const visits=await readNurseVisits(client as unknown as NurseVisitRpc);
    return {kind:'ready' as const,card:'samples' as const,data,visits:visits.enabled?visits.visits.filter(visit=>visit.memberId===parsed.data.memberId&&visit.completion):[]};
   }
   case 'week':return {kind:'ready' as const,card:'week' as const,data:await readStaffBpWeek(client,parsed.data.memberId),asOf:now.toISOString()};
  }
 }catch(error){unstable_rethrow(error);return {kind:'unavailable' as const};}
});
