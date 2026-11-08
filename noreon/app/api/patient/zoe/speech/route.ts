import {sessionActor} from '@/lib/zoe-chat-actions/actor';
import {voiceAvailable} from '@/lib/zoe-chat-actions/voice';
import {synthesize} from '@/lib/zoe-chat-actions/speech';
import {rateLimit} from '@/lib/security/rate-limit';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import {withRouteLogging} from '@/lib/observability/with-logging';
import type {PatientLocale} from '@/lib/patient/copy';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
/** No storage. The wrapper records ids/status only; provider errors never escape. */
export const POST=withRouteLogging(async function POST(request:Request){
  const reply=(code:number)=>Response.json({status:'unavailable'},{status:code,headers});
  if(!sameWorkspaceOrigin(request))return reply(403);
  const who=await sessionActor();
  if(!who)return reply(401);
  if(!await voiceAvailable())return reply(503);
  try{
    const admitted=await rateLimit('member_speech',[{kind:'source'},{kind:'user',value:who.memberId}],request.headers,{failClosed:true});
    if(!admitted.ok)return Response.json({status:'unavailable'},{status:429,headers:{...headers,'Retry-After':String(admitted.retryAfter)}});
  }catch{return reply(503);}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  try{
    const bytes=await readClinicUploadBody(request.body?.pipeThrough(new TransformStream(),{signal:controller.signal})??null,16_384);
    const body=JSON.parse(bytes.toString('utf8'));
    if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>1200||!['hy','ru','en'].includes(body.locale))return reply(400);
    clearTimeout(timer);
    const result=await synthesize(body.text,body.locale as PatientLocale,request.signal);
    return Response.json(result,{status:result.status==='ok'?200:503,headers});
  }catch{return reply(400);}
  finally{clearTimeout(timer);controller.abort();}
});
