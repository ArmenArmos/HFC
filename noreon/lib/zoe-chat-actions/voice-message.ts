import 'server-only';
import {authenticatedMemberConversation} from '@/lib/conversation-persistence/server';
import {storeZoeMessage,type StoreResult} from '@/lib/zoe/app-chat';
import {zoeStoreCode} from '@/lib/zoe/app-chat-contracts';
import {memberCommandSchema,receiveResultSchema} from '@/lib/conversation-persistence/contracts';
import {sessionActor} from './actor';
import {verifyVoiceReceipt} from './voice-receipt';

/** Invalid, expired or edited transcripts take the ordinary typed send. No client flag grants provenance. */
export async function storeMessageWithVoiceReceipt(requestId:string,text:string,toDoctor:boolean,receipt?:unknown):Promise<StoreResult>{
 if(!receipt)return storeZoeMessage(requestId,text,toDoctor);
 const who=await sessionActor();
 if(!who||!verifyVoiceReceipt(receipt,who.memberId,text))return storeZoeMessage(requestId,text,toDoctor);
 try{
  const repo=await authenticatedMemberConversation();
  if(!repo)return {ok:false,code:'unavailable'};
  // The existing authenticated receive inserts the receipt with the message, atomically.
  const r=receiveResultSchema.parse(await repo.call('conversation_receive',{p_command:memberCommandSchema.parse({requestId,text}),p_to_doctor:toDoctor,p_voice_receipt:receipt}));
  return r.ok?{ok:true}:{ok:false,code:zoeStoreCode(r.code)};
 }catch{return {ok:false,code:'failed'};}
}
