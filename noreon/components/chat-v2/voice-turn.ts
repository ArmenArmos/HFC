import {confirmPendingCardByVoice,issueVoiceConfirmation,openVoiceCard} from '@/lib/zoe-chat-actions/voice-actions';
import {confirmationAnswer} from '@/lib/voice-core/confirm';
import {voiceIntent} from '@/lib/voice-core/intent';
import type {VoicePending} from '@/lib/zoe-chat-actions/voice-card';
import type {ZoeCard} from '@/lib/zoe-chat-actions/registry';
import type {PatientLocale} from '@/lib/patient/copy';

/**
 * The member chat's voice-to-action step (WP V), loaded only when a voice turn is sent. The server decides everything
 * (lib/zoe-chat-actions/voice-actions.ts): this only routes one finished spoken turn to the pending card's spoken
 * confirmation, to a card the turn opens, or back to the ordinary send. An urgent turn always takes the ordinary send,
 * which is the urgent path.
 */
export type VoicePendingState={cardId:string;nonce:string;action:VoicePending}|null;
export type VoiceTurn={text:string;receipt?:string;origin:'batch'|'live';urgent:boolean};
export type VoiceTurnOutcome={kind:'send'}|{kind:'handled';speak:string;cards:ZoeCard[];pending:VoicePendingState|'keep';href?:string};

export async function handleVoiceTurn(turn:VoiceTurn,locale:PatientLocale,pending:VoicePendingState):Promise<VoiceTurnOutcome>{
 if(turn.urgent||!turn.text.trim())return {kind:'send'};
 const receipt=turn.origin==='batch'&&turn.receipt?{receipt:turn.receipt}:{};
 if(pending&&confirmationAnswer(turn.text,locale)){
  const r=await confirmPendingCardByVoice({cardId:pending.cardId,opId:crypto.randomUUID(),nonce:pending.nonce,transcript:turn.text,locale,origin:turn.origin,...receipt,action:pending.action});
  const cards=[...('card'in r&&r.card?[r.card]:[]),...('next'in r&&r.next?[r.next]:[])];
  // A refused confirmation keeps the card for a tap; only a definite answer ends the spoken confirmation.
  return {kind:'handled',speak:r.speak??'',cards,pending:r.status==='unverified'||r.status==='unavailable'||r.status==='failed'?'keep':null};
 }
 // Most spoken turns are ordinary messages: only a turn the shared parser reads as an action asks the server, which decides again.
 if(voiceIntent(turn.text,locale,'patient').kind==='none')return {kind:'send'};
 const r=await openVoiceCard({requestId:crypto.randomUUID(),transcript:turn.text,locale,origin:turn.origin,...receipt});
 if(r.status==='opened')return {kind:'handled',speak:r.speak,cards:[r.card],pending:r.pending?{cardId:r.card.id,nonce:r.pending.nonce,action:r.pending.action}:'keep'};
 if(r.status==='navigate')return {kind:'handled',speak:r.speak,cards:[],pending:'keep',href:r.href};
 if(r.status==='unavailable'&&r.speak)return {kind:'handled',speak:r.speak,cards:[],pending:'keep'};
 return {kind:'send'};
}

/** A card the member is about to confirm asks for a nonce, so a spoken yes can confirm the same choice. */
export async function pendingFor(cardId:string,action:VoicePending):Promise<VoicePendingState>{
 const r=await issueVoiceConfirmation({cardId,action}).catch(()=>null);
 return r?.status==='ok'?{cardId,nonce:r.nonce,action}:null;
}
