'use server';
import {z} from 'zod';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {createClient} from '@/lib/supabase/server';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {loggedAction} from '@/lib/observability/with-logging';
import {noActor,sessionActor} from './actor';
import {documentInput,documentSnapshot} from './labs-contract';
import {runDocumentDetails} from './labs';
import {readZoeCard,claimCard,recordCard,postCard} from './server';
import type {CardActionResult} from './registry';

export const openDocumentCard=loggedAction('openDocumentCard',async function openDocumentCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=z.strictObject({documentId:z.uuid(),requestId:z.uuid()}).safeParse(raw);
 if(!v.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 try{
  const {data,error}=await (await createClient()as unknown as MedicinesRpc).rpc('zoe_v3_document_read',{p_document:v.data.documentId});
  const snapshot=error?null:documentSnapshot.safeParse(data);
  if(!snapshot?.success||!snapshot.data.document)return {status:'unavailable'};
  const r=await postCard(who.memberId,v.data.requestId,'document','chip',null,snapshot.data);
  return r.ok?{status:'ok',card:r.card}:{status:'unavailable'};
 }catch{return {status:'unavailable'};}
});
export const saveDocumentDetailsFromCard=loggedAction('saveDocumentDetailsFromCard',async function saveDocumentDetailsFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=documentInput.safeParse(raw);if(!v.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 return runDocumentDetails(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,save:async(id,p)=>{
  try{const {data,error}=await (await createClient()as unknown as MedicinesRpc).rpc('zoe_v3_document_details',{p_document:id,p_type:p.docType,p_study_date:p.studyDate});return !error&&data===true;}catch{return false;}
 }},v.data);
});

import {labAppointmentSnapshot,labReplyInput} from './labs-contract';
import {runLabReply} from './labs';
import {raiseAdminTask} from './raise-admin-task';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
async function currentLab(id:string){
 try{const {data,error}=await (await createClient()as unknown as MedicinesRpc).rpc('zoe_v3_lab_appointment',{p_appointment:id});const p=error?null:labAppointmentSnapshot.safeParse(data);return p?.success?p.data:null;}catch{return null;}
}
export const answerLabCard=loggedAction('answerLabCard',async function answerLabCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=labReplyInput.safeParse(raw);if(!v.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 return runLabReply(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,current:currentLab,
  raise:input=>raiseAdminTask(clinicalWriteClient()as unknown as MedicinesRpc,input)},v.data);
});
export const askAdminToChangeVisit=loggedAction('askAdminToChangeVisit',async function askAdminToChangeVisit(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=z.strictObject({cardId:z.uuid(),opId:z.uuid()}).safeParse(raw);if(!v.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const card=await readZoeCard(v.data.cardId);
 if(!card?.valid||card.kind!=='visit'||!card.snapshot.next)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const appointment=await currentLab(card.snapshot.next.appointmentId);
 if(!appointment||appointment.revision!==card.snapshot.next.revision)return {status:'stale',card};
 const claim=await claimCard(who.memberId,card.id,'booking',v.data.opId,{kind:'admin_change'});
 if(!claim.ok||claim.claim.payload.kind!=='admin_change')return {status:'stale',card};
 if(!await raiseAdminTask(clinicalWriteClient()as unknown as MedicinesRpc,{memberId:who.memberId,appointmentId:appointment.appointmentId,requestId:claim.claim.op,reason:'lab_reschedule'}))return {status:'unavailable',card};
 const r=await recordCard(who.memberId,card.id,'booking',{kind:'admin_change',ok:true,dialog:true},true);
 return r.ok?{status:'ok',card:r.card}:{status:'unavailable'};
});
