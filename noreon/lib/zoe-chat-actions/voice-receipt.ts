import 'server-only';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

import type {VoiceTranscripts} from './voice-contract';

// 128-bit transcript digests plus a full HMAC fit the existing 128-character DB bound.
const transcriptHash=(text:string|null)=>createHash('sha256').update(JSON.stringify(text)).digest().subarray(0,16).toString('base64url');
const dualSignature=(memberId:string,text:string,issuedAt:number,primary:string,urgent:string,secret:string)=>{
 if(secret.length<32)throw Error('Voice receipt unavailable');
 return createHmac('sha256',secret).update('noreon:voice-transcript:v2\n').update(JSON.stringify({memberId,text,issuedAt,primary,urgent})).digest('base64url');
};

const TTL_MS=10*60_000;
function signature(memberId:string,text:string,issuedAt:number,secret:string){
 if(secret.length<32)throw Error('Voice receipt unavailable');
 return createHmac('sha256',secret).update('noreon:voice-transcript:v1\n').update(JSON.stringify({memberId,text,issuedAt})).digest('hex');
}
/** The receipt contains no transcript. Only the authenticated transcription route issues one. */
export function signVoiceReceipt(memberId:string,text:string,secret=process.env.SUPABASE_SERVICE_ROLE_KEY??'',now=Date.now(),transcripts?:VoiceTranscripts):string{
 if(transcripts){
  const primary=transcriptHash(transcripts.primary),urgent=transcriptHash(transcripts.urgent);
  return `${now}.${primary}.${urgent}.${dualSignature(memberId,text,now,primary,urgent,secret)}`;
 }
 return `${now}.${signature(memberId,text,now,secret)}`;
}
/** At send use now; at recovery use the immutable message creation time, never the recovery time. */
export function verifyVoiceReceipt(receipt:unknown,memberId:string,text:string,at=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):receipt is string{
 try{
  if(typeof receipt!=='string'||!Number.isFinite(at))return false;
  if(/^\d{13}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(receipt)){
   const [time,primary,urgent,mac]=receipt.split('.'),issuedAt=Number(time);
   if(issuedAt>at+30_000||at-issuedAt>TTL_MS)return false;
   const expected=dualSignature(memberId,text,issuedAt,primary,urgent,secret);
   return timingSafeEqual(Buffer.from(mac),Buffer.from(expected));
  }
  if(!/^\d{13}\.[a-f0-9]{64}$/.test(receipt))return false;
  const [time,mac]=receipt.split('.'),issuedAt=Number(time);
  if(issuedAt>at+30_000||at-issuedAt>TTL_MS)return false;
  return timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(memberId,text,issuedAt,secret),'hex'));
 }catch{return false;}
}

/**
 * A Live turn's marker (WP V). The transcript of a Gemini Live session reaches the server only through the browser, so
 * nothing attests what was said: the marker records only that the member sent this text as a spoken Live turn. It never
 * verifies as a voice receipt (different format and key), so it never grants 'patient_voice_confirmed'; it labels a BP
 * card opened from that message 'patient_voice_live_confirmed' and gives Zoe's reply the voice style.
 */
const liveKey=(secret:string)=>{if(secret.length<32)throw Error('Voice receipt unavailable');return createHmac('sha256',secret).update('noreon:voice-live-marker:v1').digest();};
const liveMac=(memberId:string,text:string,issuedAt:number,secret:string)=>createHmac('sha256',liveKey(secret)).update(JSON.stringify({memberId,text,issuedAt})).digest('base64url');
export const LIVE_MARKER=/^live\.\d{13}\.[A-Za-z0-9_-]{43}$/;
export function signLiveMarker(memberId:string,text:string,secret=process.env.SUPABASE_SERVICE_ROLE_KEY??'',now=Date.now()):string{
 return `live.${now}.${liveMac(memberId,text,now,secret)}`;
}
export function verifyLiveMarker(marker:unknown,memberId:string,text:string,at=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):marker is string{
 try{
  if(typeof marker!=='string'||!LIVE_MARKER.test(marker)||!Number.isFinite(at))return false;
  const [,time,mac]=marker.split('.'),issuedAt=Number(time);
  if(issuedAt>at+30_000||at-issuedAt>TTL_MS)return false;
  return timingSafeEqual(Buffer.from(mac!),Buffer.from(liveMac(memberId,text,issuedAt,secret)));
 }catch{return false;}
}
