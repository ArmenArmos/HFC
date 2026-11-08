import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import {validVoiceAudio} from '@/lib/zoe-chat-actions/voice';
import {VOICE_MAX_BYTES,type VoiceAudio,type VoiceTranscripts} from '@/lib/zoe-chat-actions/voice-contract';
import {staffVoiceAvailable,staffVoiceRoleOf,transcribeStaffVoice,synthesizeStaffVoice,type StaffVoiceRole,type StaffTranscriptionResult} from './voice';
import {signStaffVoiceReceipt} from './voice-receipt';
/** role: a workspace staff role (nurse, doctor, coordinator, admin) or 'clinic_admin' for the clinic portal administrator. */
export type StaffVoiceActor={id:string;role:string;specialty?:string|null};
type Actor=StaffVoiceActor;
type SpeechResult={status:'ok';audioBase64:string;mime:string}|{status:'unavailable'};
export interface StaffVoicePorts{
 actor:()=>Promise<Actor|null>;
 available:(role:StaffVoiceRole)=>Promise<boolean>;
 limit:(request:Request,id:string,kind:'transcribe'|'speech')=>Promise<{ok:true}|{ok:false;retryAfter:number}>;
 transcribe:(role:StaffVoiceRole,audio:VoiceAudio,locale:PatientLocale)=>Promise<StaffTranscriptionResult>;
 speech:(role:StaffVoiceRole,text:string,locale:PatientLocale,signal:AbortSignal)=>Promise<SpeechResult>;
 sign:(id:string,text:string,transcripts:VoiceTranscripts)=>string;
}
const headers={'Cache-Control':'private, no-store'};
/**
 * The signed-in staff identity of this request without redirects: the workspace staff plane first (nurse, doctor with
 * specialty, coordinator, Noreon administrator), then the clinic portal administrator. Anything else is no actor.
 */
export async function staffVoiceSessionActor():Promise<Actor|null>{
 try{
  const {currentPrincipals}=await import('@/lib/rbac/server');
  const p=await currentPrincipals();
  if(p.staffId&&p.staff)return {id:p.staffId,role:p.staff.role,specialty:p.staff.specialty??null};
  if(p.clinicUserId&&p.clinic?.capability==='clinic_admin')return {id:p.clinicUserId,role:'clinic_admin'};
  return null;
 }catch{return null;}
}
const reply=(status:string,code:number)=>Response.json({status},{status:code,headers});
/** Authenticated ports are injected in tests. No body is read before authorization and admission. */
export function createStaffVoiceHandlers(ports:StaffVoicePorts){
 async function admit(request:Request,kind:'transcribe'|'speech'){
  if(!sameWorkspaceOrigin(request))return reply('unavailable',403);
  let actor:Actor|null;
  try{actor=await ports.actor();}catch{return reply('unavailable',401);}
  // Every staff role from lib/rbac (WP V); a member, a caregiver or an unknown role is refused.
  const role:StaffVoiceRole|null=actor?staffVoiceRoleOf(actor.role,actor.specialty):null;
  if(!actor||!role)return reply('unavailable',401);
  try{
   if(!await ports.available(role))return reply('unavailable',503);
   const admitted=await ports.limit(request,actor.id,kind);
   if(!admitted.ok)return Response.json({status:'rate_limited'},{status:429,headers:{...headers,'Retry-After':String(admitted.retryAfter)}});
  }catch{return reply('unavailable',503);}
  return {actor,role};
 }
 async function boundedBody(request:Request,max:number){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  try{return await readClinicUploadBody(request.body?.pipeThrough(new TransformStream(),{signal:controller.signal})??null,max);}
  finally{clearTimeout(timer);controller.abort();}
 }
 return {
  async voice(request:Request){
   const admitted=await admit(request,'transcribe');if(admitted instanceof Response)return admitted;
   const declared=request.headers.get('content-length');
   if(declared&&(!/^\d+$/.test(declared)||Number(declared)>VOICE_MAX_BYTES))return reply('invalid',413);
   let audio:VoiceAudio;const locale=request.headers.get('x-voice-locale') as PatientLocale;
   try{
    audio={bytes:await boundedBody(request,VOICE_MAX_BYTES),mimeType:request.headers.get('content-type')??'',durationMs:Number(request.headers.get('x-voice-duration-ms'))};
    if(!validVoiceAudio(audio,locale))return reply('invalid',400);
   }catch{return reply('invalid',400);}
   try{
    const result=await ports.transcribe(admitted.role,audio,locale);
    if(result.status!=='ok')return reply(result.status,result.status==='invalid'?400:503);
    return Response.json({status:'ok',text:result.text,receipt:ports.sign(admitted.actor.id,result.text,result.transcripts)},{status:200,headers});
   }catch{return reply('unavailable',503);}
  },
  async speech(request:Request){
   const admitted=await admit(request,'speech');if(admitted instanceof Response)return admitted;
   let body:{text:string;locale:PatientLocale};
   try{
    body=JSON.parse((await boundedBody(request,16_384)).toString('utf8'));
    if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>1200||!['hy','ru','en'].includes(body.locale))return reply('unavailable',400);
   }catch{return reply('unavailable',400);}
   try{
    const result=await ports.speech(admitted.role,body.text,body.locale,request.signal);
    return Response.json(result,{status:result.status==='ok'?200:503,headers});
   }catch{return reply('unavailable',503);}
  },
 };
}
const defaults:StaffVoicePorts={
 actor:staffVoiceSessionActor,
 available:staffVoiceAvailable,
 limit:async(request,id,kind)=>(await import('@/lib/security/rate-limit')).rateLimit(kind==='speech'?'member_speech':'member_upload',[{kind:'source'},{kind:'user',value:id}],request.headers,{failClosed:true}),
 transcribe:transcribeStaffVoice,
 speech:synthesizeStaffVoice,
 sign:(id,text,transcripts)=>signStaffVoiceReceipt(id,text,undefined,undefined,transcripts),
};
export const staffVoiceHandlers=createStaffVoiceHandlers(defaults);
