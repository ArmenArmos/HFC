import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import {splitConversationSpeech} from '@/lib/voice-core/chunk';

/**
 * Streaming speech (WP V): the reply text is cut with the same sentence chunker the browser player used, each chunk is
 * synthesized by the existing speech path (synthesize / synthesizeStaffVoice), and each finished chunk is sent at once
 * as a server-sent event, so playback starts after the first chunk instead of after the whole reply. At most the chunk
 * being sent and the next one are synthesized at a time. The browser may stop at any moment (barge-in): the request
 * signal aborts the remaining synthesis. Nothing is stored; the text was already shown on screen. The non-streaming
 * routes stay as they are.
 *
 * Events: `chunk` {index, audioBase64, mime}, then `end` {count}; or `failed` {index} when a chunk could not be
 * synthesized or the limiter refused it mid-reply (the text stays on screen).
 */
export type SpeechChunk={status:'ok';audioBase64:string;mime:string}|{status:'unavailable'};
export interface SpeechStreamPorts<A>{
 actor:()=>Promise<A|null>;
 available:(actor:A)=>Promise<boolean>;
 /** One limiter claim per synthesized chunk, as the non-streaming route takes per request. */
 limit:(request:Request,actor:A)=>Promise<{ok:true}|{ok:false;retryAfter:number}>;
 synthesize:(actor:A,text:string,locale:PatientLocale,signal:AbortSignal)=>Promise<SpeechChunk>;
}
const json={'Cache-Control':'private, no-store'};
const reply=(status:string,code:number)=>Response.json({status},{status:code,headers:json});
export const SPEECH_STREAM_MAX_TEXT=1200;
const event=(name:string,data:unknown)=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

export function createSpeechStreamHandler<A>(ports:SpeechStreamPorts<A>){
 return async function POST(request:Request):Promise<Response>{
  if(!sameWorkspaceOrigin(request))return reply('unavailable',403);
  let actor:A|null;
  try{actor=await ports.actor();}catch{return reply('unavailable',401);}
  if(!actor)return reply('unavailable',401);
  try{if(!await ports.available(actor))return reply('unavailable',503);}catch{return reply('unavailable',503);}
  let body:{text:string;locale:PatientLocale};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  try{
   body=JSON.parse((await readClinicUploadBody(request.body?.pipeThrough(new TransformStream(),{signal:controller.signal})??null,16_384)).toString('utf8'));
   if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>SPEECH_STREAM_MAX_TEXT||!['hy','ru','en'].includes(body.locale))return reply('unavailable',400);
  }catch{return reply('unavailable',400);}
  finally{clearTimeout(timer);controller.abort();}
  const chunks=splitConversationSpeech(body.text);
  if(!chunks.length)return reply('unavailable',400);
  // The first chunk's claim decides the answer code; a later refusal ends the stream with a failed event.
  try{
   const admitted=await ports.limit(request,actor);
   if(!admitted.ok)return Response.json({status:'rate_limited'},{status:429,headers:{...json,'Retry-After':String(admitted.retryAfter)}});
  }catch{return reply('unavailable',503);}
  const who=actor,locale=body.locale,signal=request.signal,encoder=new TextEncoder();
  const synth=(i:number)=>ports.synthesize(who,chunks[i]!,locale,signal).catch(():SpeechChunk=>({status:'unavailable'}));
  const stream=new ReadableStream<Uint8Array>({
   async start(out){
    const send=(name:string,data:unknown)=>{if(!signal.aborted)out.enqueue(encoder.encode(event(name,data)));};
    let pending=synth(0);
    try{
     for(let i=0;i<chunks.length;i++){
      if(signal.aborted)break;
      let next:Promise<SpeechChunk>|null=null;
      if(i+1<chunks.length){
       const admitted=await ports.limit(request,who).catch(()=>({ok:false as const,retryAfter:0}));
       next=admitted.ok?synth(i+1):Promise.resolve({status:'unavailable'});
      }
      const result=await pending;
      if(signal.aborted)break;
      if(result.status!=='ok'||!/^audio\//.test(result.mime)||!result.audioBase64){send('failed',{index:i});break;}
      send('chunk',{index:i,audioBase64:result.audioBase64,mime:result.mime});
      if(!next){send('end',{count:chunks.length});break;}
      pending=next;
     }
    }catch{send('failed',{index:-1});}
    finally{try{out.close();}catch{/* already closed by the client */}}
   },
  });
  return new Response(stream,{status:200,headers:{...json,'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'}});
 };
}

type MemberActorLike={memberId:string};
/** The member and caregiver route: the phone session, member voice availability, the member_speech budget. */
export const memberSpeechStreamPorts:SpeechStreamPorts<MemberActorLike>={
 actor:async()=>(await import('./actor')).sessionActor(),
 available:async()=>(await import('./voice')).voiceAvailable(),
 limit:async(request,actor)=>(await import('@/lib/security/rate-limit')).rateLimit('member_speech',[{kind:'source'},{kind:'user',value:actor.memberId}],request.headers,{failClosed:true}),
 synthesize:async(_actor,text,locale,signal)=>(await import('./speech')).synthesize(text,locale,signal),
};

type StaffActorLike={id:string;role:import('@/lib/staff-zoe/voice').StaffVoiceRole};
/** Every staff role, through the same staff identity and speech path as /api/staff/zoe/speech. */
export const staffSpeechStreamPorts:SpeechStreamPorts<StaffActorLike>={
 actor:async()=>{
  const {staffVoiceSessionActor}=await import('@/lib/staff-zoe/voice-http');
  const {staffVoiceRoleOf}=await import('@/lib/staff-zoe/voice');
  const who=await staffVoiceSessionActor();
  const role=who?staffVoiceRoleOf(who.role,who.specialty):null;
  return who&&role?{id:who.id,role}:null;
 },
 available:async actor=>(await import('@/lib/staff-zoe/voice')).staffVoiceAvailable(actor.role),
 limit:async(request,actor)=>(await import('@/lib/security/rate-limit')).rateLimit('member_speech',[{kind:'source'},{kind:'user',value:actor.id}],request.headers,{failClosed:true}),
 synthesize:async(actor,text,locale,signal)=>(await import('@/lib/staff-zoe/voice')).synthesizeStaffVoice(actor.role,text,locale,signal),
};
