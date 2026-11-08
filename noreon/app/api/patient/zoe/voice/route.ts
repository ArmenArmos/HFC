import { sessionActor } from '@/lib/zoe-chat-actions/actor';
import { transcribe, voiceAvailable } from '@/lib/zoe-chat-actions/voice';
import { VOICE_MAX_BYTES } from '@/lib/zoe-chat-actions/voice-contract';
import { rateLimit } from '@/lib/security/rate-limit';
import { sameWorkspaceOrigin } from '@/lib/staff/request';
import { readClinicUploadBody } from '@/lib/clinic-portal/upload-server';
import type { PatientLocale } from '@/lib/patient/copy';
import { withRouteLogging } from '@/lib/observability/with-logging';
import { signVoiceReceipt } from '@/lib/zoe-chat-actions/voice-receipt';
export const runtime = 'nodejs';
const headers = {'Cache-Control':'private, no-store'};
/** No storage; the logging wrapper writes route, status and ids only, never request text, audio or provider errors. */
export const POST = withRouteLogging(async function POST(request:Request) {
  const reply = (status:string,code:number) => Response.json({status},{status:code,headers});
  if (!sameWorkspaceOrigin(request)) return reply('unavailable',403);
  const who = await sessionActor();
  if (!who) return reply('unavailable',401);
  if (!await voiceAvailable()) return reply('unavailable',503);
  try {
    const admitted = await rateLimit('member_upload',[{kind:'source'},{kind:'user',value:who.memberId}],request.headers,{failClosed:true});
    if (!admitted.ok) return Response.json({status:'rate_limited'},{status:429,headers:{...headers,'Retry-After':String(admitted.retryAfter)}});
  } catch { return reply('unavailable',503); }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>VOICE_MAX_BYTES)) return reply('invalid',413);
  try {
    // Bound slow uploads too. Cancelling releases the in-memory body; nothing is persisted.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),15_000);
    let bytes:Buffer;
    try {
      bytes = await readClinicUploadBody(request.body?.pipeThrough(new TransformStream(),{signal:controller.signal}) ?? null,VOICE_MAX_BYTES);
    } finally { clearTimeout(timer); }
    const result = await transcribe({bytes,mimeType:request.headers.get('content-type')??'',durationMs:Number(request.headers.get('x-voice-duration-ms'))},request.headers.get('x-voice-locale') as PatientLocale);
    return Response.json(result.status==='ok'?{status:'ok',text:result.text,urgent:result.urgent,receipt:signVoiceReceipt(who.memberId,result.text,undefined,undefined,result.transcripts)}:result,{status:result.status==='ok'?200:result.status==='invalid'?400:503,headers});
  } catch { return reply('invalid',400); }
});
