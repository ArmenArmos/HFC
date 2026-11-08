import 'server-only';
import {createHmac} from 'node:crypto';
import {signVoiceReceipt,verifyVoiceReceipt} from '@/lib/zoe-chat-actions/voice-receipt';
import type {VoiceTranscripts} from '@/lib/zoe-chat-actions/voice-contract';
/** Key derivation separates staff receipts from member receipts, even if ids coincide. */
function staffKey(secret:string){
 if(secret.length<32)throw Error('Voice receipt unavailable');
 return createHmac('sha256',secret).update('noreon:staff-voice-receipt:v1').digest('hex');
}
export function signStaffVoiceReceipt(staffId:string,text:string,secret=process.env.SUPABASE_SERVICE_ROLE_KEY??'',now=Date.now(),transcripts?:VoiceTranscripts){
 return signVoiceReceipt(staffId,text,staffKey(secret),now,transcripts);
}
export function verifyStaffVoiceReceipt(receipt:unknown,staffId:string,text:string,at=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):receipt is string{
 try{return verifyVoiceReceipt(receipt,staffId,text,at,staffKey(secret));}catch{return false;}
}
