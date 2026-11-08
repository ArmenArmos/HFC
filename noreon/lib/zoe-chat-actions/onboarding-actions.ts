'use server';
import {createHash,createHmac} from 'node:crypto';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {medicinesCardEnabled,zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {saveReminderPreferences} from '@/app/patient/care/actions';
import {getReminderPreferences} from '@/lib/patient-care/reminder-repository';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {createClient} from '@/lib/supabase/server';
import {ZOE_CONSENT_VERSION} from '@/lib/zoe/member';
import {zoeScaffoldEnabled} from '@/lib/zoe/policy';
import {noActor,sessionActor} from './actor';
import {consentText} from './consent-text';
import {readMedicines} from './medicines-read';
import {profileInputSchema,restoreInputSchema,reviewInputSchema,runMedicineRestore,runMedicinesReview,runProfileSave,type ProfileInput,type ReviewInput} from './onboarding';
import {claimCard,readZoeCard,recordCard,unclaimCard} from './server';
import type {CardActionResult,ZoeCard} from './registry';
import {serviceRpc} from './server';
import {runV3StopFollowup} from './plan-jobs';
import {explicitStatin,stopIntent,type StopIntent} from './plan-followup';
import type {MedicineRow} from './thread';

const consentInput=z.strictObject({locale:z.enum(['hy','en','ru']),directAnswers:z.boolean()});
/** The chat consent under V3: the same gate as "Agree and turn on", with the hash of the text this locale showed. */
export const acceptZoeConsentShown=loggedAction('acceptZoeConsentShown',async function acceptZoeConsentShown(input:unknown):Promise<{ok:boolean}>{
 const parsed=consentInput.safeParse(input);
 if(!parsed.success||!zoeAppV3Enabled()||!zoeScaffoldEnabled())return {ok:false};
 const hash=createHash('sha256').update(consentText(parsed.data.locale,parsed.data.directAnswers)).digest('hex');
 const client=await createClient() as unknown as MedicinesRpc;
 const {data,error}=await client.rpc('zoe_consent_accept_shown',{p_wording_version:ZOE_CONSENT_VERSION,p_text_hash:hash});
 const ok=!error&&(data as {ok?:unknown}|null)?.ok===true;
 if(ok)revalidatePath('/patient','layout');
 return {ok};
});

async function writeProfile(v:ProfileInput):Promise<'saved'|'stale'|'failed'>{
 try{
  const {revision,preferences}=await getReminderPreferences();
  // Already there on a retry: a second write would only move the revision.
  if(preferences.quietStart!==v.sleep||preferences.quietEnd!==v.wake){
   const r=await saveReminderPreferences({...preferences,quietStart:v.sleep,quietEnd:v.wake},revision);
   if(!r.ok)return r.reason==='conflict'?'stale':'failed';
  }
  const client=await createClient() as unknown as MedicinesRpc;
  const {error}=await client.rpc('member_profile_card_save',{p_channel:v.channel,p_caregiver:v.caregiver});
  return error?'failed':'saved';
 }catch{return 'failed';}
}
/** Keyed, because a phone number's plain hash can be guessed: the card holds this, never the details. */
const contactProof=(channel:string,wake:string,sleep:string,caregiver:unknown)=>createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY??'').update(JSON.stringify([channel,wake,sleep,caregiver])).digest('hex');
const proveInput=(v:ProfileInput)=>contactProof(v.channel,v.wake,v.sleep,v.caregiver);
/** Whether the claim's save reached the record, read back from the member's own rows. */
async function profileLanded(claim:{channel:string;wake:string;sleep:string;proof:string}){
 const [{preferences},own]=await Promise.all([getReminderPreferences(),createClient().then(c=>c.from('member_preferences').select('preferred_channel,caregiver_contact').maybeSingle())]);
 if(own.error||!own.data||preferences.quietStart!==claim.sleep||preferences.quietEnd!==claim.wake)return false;
 return contactProof(own.data.preferred_channel??'',claim.wake,claim.sleep,own.data.caregiver_contact)===claim.proof;
}
export const saveProfileFromCard=loggedAction('saveProfileFromCard',async function saveProfileFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const parsed=profileInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return runProfileSave(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,save:writeProfile,proof:proveInput,landed:profileLanded},parsed.data);
});

type ReviewRow={id:string;name:string;dose:string|null;times:string[];status:string|null;stopReason:string|null};
export type ReviewRead={plan:{id:string;name:string;dose:string;times:string[]}[];own:ReviewRow[];stopped:ReviewRow[]};
const details=z.array(z.object({id:z.uuid(),status:z.string().nullable(),stopReason:z.string().nullable(),stopped:z.boolean(),name:z.string(),dose:z.string().nullable(),times:z.array(z.string())}));
/** The medicines card's list in the new chat: both lists, and what the member has said about their own. */
export const readMedicinesForReview=loggedAction('readMedicinesForReview',async function readMedicinesForReview(id:unknown):Promise<{status:'ok';data:ReviewRead}|{status:Exclude<CardActionResult['status'],'ok'>;card?:ZoeCard}>{
 if(!medicinesCardEnabled()||!zoeAppV3Enabled())return {status:'disabled'};
 if(!z.uuid().safeParse(id).success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const card=await readZoeCard(id as string);
 if(!card?.valid||card.kind!=='medicines')return {status:'invalid'};
 try{
  // A save whose reply was lost: finish it, so the receipt is here after a reload and the list is not offered again.
  const held=card.state==='open'&&!card.outcome.medicines?card.claims.medicines:undefined;
  if(held?.payload.kind==='review'&&held.payload.changes&&who){
   const r=await runMedicinesReview(who,reviewPortsFor(who.memberId),{cardId:card.id,opId:held.op,changes:held.payload.changes,added:held.payload.added} as ReviewInput);
   if(r.card?.state==='done')return {status:'closed',card:r.card};
  }
  const [read,raw]=await Promise.all([readMedicines(),(await createClient() as unknown as MedicinesRpc).rpc('member_medicine_details_read')]);
  if(!read.enabled)return {status:'disabled'};
  if(card.snapshot.token!==read.token)return {status:'stale'};
  const known=raw.error?null:details.safeParse(raw.data);
  if(!known?.success)return {status:'unavailable'};
  const row=({id,name,dose,times,status,stopReason}:z.infer<typeof details>[number]):ReviewRow=>({id,name,dose,times,status,stopReason});
  return {status:'ok',data:{plan:read.plan.map(m=>({id:m.id,name:m.name,dose:m.dose,times:m.times})),own:known.data.filter(d=>!d.stopped).map(row),stopped:known.data.filter(d=>d.stopped).map(row)}};
 }catch{return {status:'unavailable'};}
});

const reviewPortsFor=(memberId:string)=>({readCard:readZoeCard,claim:claimCard,record:recordCard,save:writeReview,unclaim:(c:string,i:string,o:string)=>unclaimCard(memberId,c,i,o),afterSave:async(rows:MedicineRow[],stops:StopIntent[])=>{
 if(!zoeAppV3Enabled()||!rows.some(r=>r.status==='course_stopped'&&explicitStatin(r.name)))return 'none' as const;
 const rpc=serviceRpc();return rpc&&await runV3StopFollowup(rpc,memberId,stops)?'sent' as const:'pending' as const;
},current:async()=>{
 const [read,names]=await Promise.all([readMedicines(),allNames()]);
 return {enabled:read.enabled,token:read.token,names};
}});
const savedReview=z.object({status:z.literal('saved'),rows:z.array(z.strictObject({name:z.string(),status:z.string().nullable(),stopReason:z.string().nullable(),added:z.boolean()})),stops:z.array(stopIntent),savedAt:z.string()});
async function writeReview(v:Pick<ReviewInput,'changes'|'added'>,cardId:string):Promise<{status:'saved'|'not-found'|'limit'|'invalid'|'disabled'|'unavailable';rows?:MedicineRow[];stops?:StopIntent[];savedAt?:string}>{
 if(!v.changes.length&&!v.added.length)return {status:'invalid'};
 try{
  const client=await createClient() as unknown as MedicinesRpc;
  const {data,error}=await client.rpc('zoe_v3_medicines_save',{p_card:cardId});
  const status=(data as {status?:string}|null)?.status;
  if(!error&&status==='saved'){
   const saved=savedReview.safeParse(data);if(!saved.success)return {status:'unavailable'};
   revalidatePath('/patient/medicines');revalidatePath('/patient/dashboard');return saved.data;
  }
  return {status:!error&&(status==='saved'||status==='not-found'||status==='limit'||status==='invalid'||status==='disabled')?status:'unavailable'};
 }catch{return {status:'unavailable'};}
}
const allNames=async()=>{
 const {data,error}=await (await createClient()as unknown as MedicinesRpc).rpc('member_medicine_details_read');
 if(error)throw Error('Medicine names unavailable');
 return new Map(details.parse(data).map(m=>[m.id,m.name]));
};
export const reviewMedicinesFromCard=loggedAction('reviewMedicinesFromCard',async function reviewMedicinesFromCard(raw:unknown){
 if(!medicinesCardEnabled()||!zoeAppV3Enabled())return {status:'disabled' as const};
 const parsed=reviewInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid' as const};
 const who=await sessionActor();
 if(!who)return noActor();
 return runMedicinesReview(who,reviewPortsFor(who.memberId),parsed.data);
});

/** Undoes "Was a course": the medicine is back on the list with its reminders. */
export const restoreMedicineFromCard=loggedAction('restoreMedicineFromCard',async function restoreMedicineFromCard(raw:unknown){
 if(!medicinesCardEnabled()||!zoeAppV3Enabled())return {status:'disabled' as const};
 const parsed=restoreInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid' as const};
 const who=await sessionActor();
 if(!who)return noActor();
 return runMedicineRestore(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,unclaim:(c,i,o)=>unclaimCard(who.memberId,c,i,o),names:allNames,restore:async id=>{
  try{
   const client=await createClient() as unknown as MedicinesRpc;
   const {data,error}=await client.rpc('member_medicine_restore',{p_id:id});
   const status=(data as {status?:string}|null)?.status;
   if(error)return 'unavailable';
   if(status==='saved'){revalidatePath('/patient/medicines');revalidatePath('/patient/dashboard');}
   return status==='saved'||status==='not-found'||status==='duplicate'||status==='limit'||status==='disabled'?status:'unavailable';
  }catch{return 'unavailable';}
 }},parsed.data);
});
