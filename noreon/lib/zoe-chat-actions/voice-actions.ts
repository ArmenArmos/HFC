'use server';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {voiceIntent,type VoiceAction} from '@/lib/voice-core/intent';
import {bpReadback,reminderReadback,reminderTarget,voiceLine} from '@/lib/voice-core/readback';
import type {CardActionResult,ZoeCard} from './registry';
import {noActor,sessionActor} from './actor';
import {openCard,type OpenInput} from './commands';
import {buildSnapshot,claimCard,postCard,readZoeCard,readZoeCards,recordCard,unclaimCard} from './server';
import {verifyVoiceReceipt} from './voice-receipt';
import {screenVoiceTranscripts} from './voice';
import {confirmVoiceCard,issueVoiceNonce,voicePendingSchema,withReminder,type VoiceConfirmResult,type VoicePending} from './voice-card';

/**
 * Voice to action for the member chat (WP V). Deterministic: the server re-derives the intent from the transcript with
 * lib/voice-core (the browser's guess is never trusted) and only OPENS a card. Every write waits for the member's
 * explicit confirmation on that card, by tap or by a spoken yes (confirmPendingCardByVoice), through the same command.
 * Emergencies are screened first, every time, with the chat's own deterministic screening; an urgent turn is never an
 * action: the client sends it through the ordinary urgent path.
 */
type Origin='batch'|'live';
const turnInput=z.strictObject({requestId:z.uuid(),transcript:z.string().trim().min(1).max(300),locale:z.enum(['hy','en','ru']),origin:z.enum(['batch','live']),receipt:z.string().max(128).optional()});
export type VoiceTurnResult=
 |{status:'urgent'}
 |{status:'none'}
 |{status:'opened';card:ZoeCard;speak:string;pending?:{action:VoicePending;nonce:string}}
 |{status:'navigate';href:string;speak:string}
 |{status:'unavailable'|'invalid'|'disabled'|'signed_out'|'rate_limited';speak?:string};

const cardPorts={post:postCard,readCards:readZoeCards,snapshot:(kind:Parameters<typeof buildSnapshot>[0],input?:OpenInput)=>buildSnapshot(kind,new Date(),input?.page,input?.askId,input?.typed)};
const nonceSecret=()=>process.env.SUPABASE_SERVICE_ROLE_KEY??'';

/** The chat's own deterministic emergency screening of one transcript, lexical first, then with the member's intake state. */
async function screened(text:string):Promise<boolean>{
 const lexical=screenVoiceTranscripts({primary:text,urgent:null},{enabled:false,active:false});
 if(lexical?.urgent)return true;
 const intake=await import('@/lib/zoe/app-chat').then(m=>m.readIntakeState()).catch(()=>null);
 return !!screenVoiceTranscripts({primary:text,urgent:null},intake)?.urgent;
}

/** A Live transcript reaches the server only as text. Screen it exactly as a recorded turn is screened. */
export const screenLiveTranscript=loggedAction('screenLiveTranscript',async function screenLiveTranscript(raw:unknown):Promise<{status:'ok';urgent:boolean}|{status:'invalid'|'signed_out'|'disabled'|'unavailable'}>{
 const parsed=z.string().trim().min(1).max(4096).safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 if(!await sessionActor()){const n=await noActor();return {status:n.status};}
 try{return {status:'ok',urgent:await screened(parsed.data)};}
 catch{return {status:'ok',urgent:true};} // Fail towards the urgent path, never away from it.
});

const failure=(r:CardActionResult):VoiceTurnResult=>({status:r.status==='disabled'||r.status==='signed_out'||r.status==='rate_limited'||r.status==='invalid'?r.status:'unavailable'});

/** One finished spoken turn: urgent, nothing to do (send it as a message), or the card it opens. */
export const openVoiceCard=loggedAction('openVoiceCard',async function openVoiceCard(raw:unknown):Promise<VoiceTurnResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const parsed=turnInput.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const v=parsed.data;
 const who=await sessionActor();
 if(!who){const n=await noActor();return {status:n.status==='disabled'?'disabled':n.status==='signed_out'?'signed_out':'unavailable'};}
 if(await screened(v.transcript).catch(()=>true))return {status:'urgent'};
 const action:VoiceAction=voiceIntent(v.transcript,v.locale,'patient');
 const l=v.locale;
 if(action.kind==='log_bp'){
  const origin:Origin=v.origin;
  const verified=origin==='batch'&&verifyVoiceReceipt(v.receipt,who.memberId,v.transcript);
  const typed={systolic:action.systolic,diastolic:action.diastolic,pulse:action.pulse,measuredAt:new Date().toISOString(),
   ...(verified?{entrySource:'patient_voice_confirmed' as const}:origin==='live'?{entrySource:'patient_voice_live_confirmed' as const}:{})};
  const r=await openCard(who,cardPorts,{requestId:v.requestId,kind:'bp',sourceSeq:null,typed});
  if(r.status!=='ok'||!r.card)return failure(r);
  const pending:VoicePending={kind:'bp'};
  const nonce=await issueVoiceNonce(who,{readCard:async()=>r.card,secret:nonceSecret()},r.card.id,pending);
  return {status:'opened',card:r.card,speak:bpReadback(l,action),...(nonce?{pending:{action:pending,nonce}}:{})};
 }
 if(action.kind==='set_reminder'){
  if(!memberChatOnlyEnabled())return {status:'unavailable',speak:voiceLine(l,'unavailable')};
  const r=await openCard(who,cardPorts,{requestId:v.requestId,kind:'account',sourceSeq:null});
  if(r.status!=='ok'||!r.card)return failure(r);
  const pending:VoicePending={kind:'reminders',time:action.time,target:reminderTarget(v.transcript)};
  const nonce=await issueVoiceNonce(who,{readCard:async()=>r.card,secret:nonceSecret()},r.card.id,pending);
  return {status:'opened',card:r.card,speak:reminderReadback(l,action.time,pending.target),...(nonce?{pending:{action:pending,nonce}}:{})};
 }
 if(action.kind==='confirm_dose'){
  const r=await openCard(who,cardPorts,{requestId:v.requestId,kind:'dose',sourceSeq:null});
  return r.status==='ok'&&r.card?{status:'opened',card:r.card,speak:voiceLine(l,'dose')}:failure(r);
 }
 if(action.kind==='contact_care_team'){
  // Never a model-chosen urgency: urgent words were screened above; this is the ordinary write-to-the-care-team card.
  const r=await openCard(who,cardPorts,{requestId:v.requestId,kind:'message',sourceSeq:null});
  return r.status==='ok'&&r.card?{status:'opened',card:r.card,speak:voiceLine(l,'contact')}:failure(r);
 }
 if(action.kind==='show_ldl'||action.kind==='show_bp_trend')return {status:'navigate',href:`/patient/chat/overview#ov-${action.kind==='show_ldl'?'ldl':'bp'}`,speak:voiceLine(l,'overview')};
 return {status:'none'};
});

const issueInput=z.strictObject({cardId:z.uuid(),action:voicePendingSchema});
/** The nonce for a pending choice a member made on a card (consents, caregiver, a typed BP card), so a spoken yes can confirm it. */
export const issueVoiceConfirmation=loggedAction('issueVoiceConfirmation',async function issueVoiceConfirmation(raw:unknown):Promise<{status:'ok';nonce:string}|{status:'invalid'|'disabled'|'signed_out'|'unavailable'}>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const parsed=issueInput.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who){const n=await noActor();return {status:n.status};}
 const nonce=await issueVoiceNonce(who,{readCard:readZoeCard,secret:nonceSecret()},parsed.data.cardId,parsed.data.action);
 return nonce?{status:'ok',nonce}:{status:'invalid'};
});

/** Runs the tap's own command for a confirmed pending action. Imports are lazy so each feature keeps its own switch. */
async function perform(memberId:string,card:ZoeCard,action:VoicePending,opId:string):Promise<CardActionResult>{
 const who=await sessionActor();
 if(!who||who.memberId!==memberId)return {status:'signed_out'};
 if(action.kind==='bp'){
  if(!card.valid||card.kind!=='bp'||!card.snapshot.typed)return {status:'invalid'};
  const t=card.snapshot.typed;
  // The numbers and time the card shows, never the transcript's: the save is the tap's command (recordBpFromCard).
  const {recordBpFromCard}=await import('./actions');
  return recordBpFromCard({cardId:card.id,submissionId:opId,systolic:t.systolic,diastolic:t.diastolic,pulse:t.pulse,measuredAt:t.measuredAt});
 }
 if(action.kind==='reminders'){
  const {getReminderPreferences}=await import('@/lib/patient-care/reminder-repository');
  const saved=await getReminderPreferences();
  const input=withReminder(saved.preferences,action);
  if(!input)return {status:'invalid',card};
  const {saveAccountFromCard}=await import('./account-actions');
  const r=await saveAccountFromCard({cardId:card.id,opId,kind:'reminders',input,expectedRevision:saved.revision});
  return r.status==='ok'&&r.result&&!r.result.ok?{status:r.result.reason==='conflict'?'stale':'failed',card}:r;
 }
 if(action.kind==='consent'){
  const {memberConsentsEnabled}=await import('@/lib/consents/schema');
  if(!memberConsentsEnabled())return {status:'disabled'};
  const [{runConsentDecision},{sessionCaregiverRpc}]=await Promise.all([import('@/lib/consents/server'),import('@/lib/caregivers/server')]);
  // The browser input shape (method 'tap'); the server records the decision as spoken.
  return runConsentDecision(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,unclaim:(c,i,o)=>unclaimCard(who.memberId,c,i,o),rpc:await sessionCaregiverRpc()},
   {cardId:card.id,opId,kind:action.consent,granted:action.granted,locale:action.locale,method:'tap'},'voice');
 }
 const {caregiversEnabled}=await import('@/lib/caregivers/schema');
 if(!caregiversEnabled())return {status:'disabled'};
 const caregivers=await import('@/lib/caregivers/server');
 const ports={readCard:readZoeCard,claim:claimCard,record:recordCard,unclaim:(c:string,i:string,o:string)=>unclaimCard(who.memberId,c,i,o),rpc:await caregivers.sessionCaregiverRpc(),proof:caregivers.caregiverProof};
 if(action.kind==='caregiver_invite')return caregivers.runCaregiverInvite(who,ports,{cardId:card.id,opId,name:action.name,relationship:action.relationship,phone:action.phone,scopes:action.scopes,locale:action.locale,method:'tap'},'voice');
 if(action.kind==='caregiver_scopes')return caregivers.runCaregiverScopes(who,ports,{cardId:card.id,opId,linkId:action.linkId,revision:action.revision,scopes:action.scopes,locale:action.locale},'voice');
 return caregivers.runCaregiverRevoke(who,ports,{cardId:card.id,opId,linkId:action.linkId,revision:action.revision});
}

/**
 * A spoken yes (or no) to the member's most recent pending card. Checks the card, its nonce and revision and the strict
 * confirmation before anything runs; the write is the tap's own command. A no only closes the spoken confirmation.
 */
export const confirmPendingCardByVoice=loggedAction('confirmPendingCardByVoice',async function confirmPendingCardByVoice(raw:unknown):Promise<VoiceConfirmResult&{speak?:string}>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const who=await sessionActor();
 if(!who){const n=await noActor();return {status:n.status};}
 const result=await confirmVoiceCard(who,{readCard:readZoeCard,readCards:readZoeCards,secret:nonceSecret(),
  verifyReceipt:(receipt,memberId,text)=>verifyVoiceReceipt(receipt,memberId,text),
  perform:(card,action,opId)=>perform(who.memberId,card,action,opId)},raw);
 if(result.status==='saved')revalidatePath('/patient/chat');
 const l=z.object({locale:z.enum(['hy','en','ru'])}).safeParse(raw).data?.locale??'hy';
 const speak=result.status==='saved'?voiceLine(l,'saved'):result.status==='cancelled'?voiceLine(l,'cancelled'):result.status==='not_confirmed'?voiceLine(l,'notConfirmed')
  :result.status==='stale'||result.status==='not_latest'||result.status==='closed'?voiceLine(l,'stale'):voiceLine(l,'failed');
 return {...result,speak};
});
