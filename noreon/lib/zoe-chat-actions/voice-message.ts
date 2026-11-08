import 'server-only';
import {authenticatedMemberConversation} from '@/lib/conversation-persistence/server';
import {storeZoeMessage,type StoreResult} from '@/lib/zoe/app-chat';
import {zoeStoreCode} from '@/lib/zoe/app-chat-contracts';
import {memberCommandSchema,receiveResultSchema} from '@/lib/conversation-persistence/contracts';
import {sessionActor} from './actor';
import {signLiveMarker,verifyVoiceReceipt} from './voice-receipt';

/** What the browser sends for a Gemini Live turn instead of a receipt (WP V). The server signs its own marker. */
export const LIVE_TURN='live';

/**
 * Invalid, expired or edited transcripts take the ordinary typed send. No client flag grants provenance. A Live turn
 * ('live') is stored with a server-signed Live marker, which grants no voice provenance (lib/zoe-chat-actions/voice-receipt.ts).
 */
export async function storeMessageWithVoiceReceipt(requestId:string,text:string,toDoctor:boolean,receipt?:unknown):Promise<StoreResult>{
 if(!receipt)return storeZoeMessage(requestId,text,toDoctor);
 const who=await sessionActor();
 if(who&&receipt===LIVE_TURN){
  try{receipt=signLiveMarker(who.memberId,text);}catch{return storeZoeMessage(requestId,text,toDoctor);}
 }
 else if(!who||!verifyVoiceReceipt(receipt,who.memberId,text))return storeZoeMessage(requestId,text,toDoctor);
 try{
  const repo=await authenticatedMemberConversation();
  if(!repo)return {ok:false,code:'unavailable'};
  // The existing authenticated receive inserts the receipt with the message, atomically.
  const r=receiveResultSchema.parse(await repo.call('conversation_receive',{p_command:memberCommandSchema.parse({requestId,text}),p_to_doctor:toDoctor,p_voice_receipt:receipt}));
  return r.ok?{ok:true}:{ok:false,code:zoeStoreCode(r.code)};
 }catch{return {ok:false,code:'failed'};}
}
