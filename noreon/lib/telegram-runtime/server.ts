import 'server-only';
import {doctorTelegramEnabled} from '@/lib/doctor-telegram/config';
import {handleDoctorTelegram} from '@/lib/doctor-telegram/handler';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {createTelegramWebhook,type TelegramContactPort,type TelegramRedoPort,type TelegramInboxPort,type TelegramDeadLetterPort,type TelegramMediaPort} from '@/lib/telegram-channel/ingress';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {inboxEventFrom,telegramHttpsPort} from '@/lib/telegram-channel/link';
import {nurseTelegramEnabled,outboundConfig,telegramAccountRef,telegramBot,telegramEnabled,webhookConfig} from './config';
import {runAuthCleanup,runTelegramSweep,type TelegramCardHandlers,type TelegramServiceRpc} from './dispatch';
import {answerRefusedPress,cardKeyboard,handleCardPress,handleRedo,noticeKeyboard,offerTelegramCards,openMenu,processedSchema} from './cards';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {runLdlResponseSweep,type LdlServiceRpc} from '@/lib/ldl/response-runtime';
import {runCareAlertSweep} from '@/lib/care-alerts/server';
import {runUnreadUrgentPass,runZoeSweep,zoePipelineEnabled} from '@/lib/zoe/server';
import {runZoePasses} from '@/lib/zoe/passes';
import {signinLinkOrigin} from '@/lib/telegram-auth/signin-link-config';

/** Service-role RPC for the channel only. Errors carry the PostgREST code, never the request. */
export function serviceRpc(deadlineAt?:number):TelegramServiceRpc|null{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return null;
 const client=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return async(name,args,timeoutMs)=>{
  if(name==='channel_inbox_process'&&doctorTelegramEnabled())args={...args,p_doctor_telegram_enabled:true};
  const remaining=deadlineAt===undefined?undefined:Math.min(timeoutMs??Infinity,name.startsWith('telegram_nurse_')?2_000:Infinity,deadlineAt-Date.now());
  if(remaining!==undefined&&remaining<=0)throw Error('Telegram sweep deadline reached');
  const query=client.rpc(name as keyof Database['public']['Functions'],args as never);
  const {data,error}=await(remaining===undefined?query:query.abortSignal(AbortSignal.timeout(Math.ceil(remaining))));
  if(error)throw Error(`Telegram channel database unavailable (${error.code??'rpc'})`);
  return data;
 };
}

const commitResult=z.union([z.strictObject({status:z.enum(['committed','committed-duplicate']),eventId:z.string(),fingerprint:z.string()}),z.object({status:z.enum(['failed','conflict'])})]);

/** Inbox port: the receipt is the database's answer after its transaction committed. */
export function inboxPort(rpc:TelegramServiceRpc):TelegramInboxPort{
 return async event=>{
  const parsed=commitResult.parse(await rpc('channel_inbox_commit',{p_event:inboxEventFrom(event)}));
  return parsed.status==='committed'||parsed.status==='committed-duplicate'?parsed:{status:parsed.status==='conflict'?'conflict':'failed'};
 };
}
/** Media port: identifiers only; the database answers after its transaction committed. */
export function mediaPort(rpc:TelegramServiceRpc):TelegramMediaPort{
 return async event=>{
  const parsed=commitResult.parse(await rpc('channel_inbox_commit',{p_event:{adapter:'telegram',eventId:event.eventId,fingerprint:event.fingerprint,principalRef:event.principalRef,kind:'media',payload:{chatId:event.chatId,messageId:event.messageId}}}));
  return parsed.status==='committed'||parsed.status==='committed-duplicate'?parsed:{status:parsed.status==='conflict'?'conflict':'failed'};
 };
}
/** An edited or forwarded text: identifiers only, never its words (QA a9-05). */
export function redoPort(rpc:TelegramServiceRpc):TelegramRedoPort{
 return async event=>{
  const parsed=commitResult.parse(await rpc('channel_inbox_commit',{p_event:{adapter:'telegram',eventId:event.eventId,fingerprint:event.fingerprint,principalRef:event.principalRef,kind:'redo',payload:{chatId:event.chatId,messageId:event.messageId}}}));
  return parsed.status==='committed'||parsed.status==='committed-duplicate'?parsed:{status:parsed.status==='conflict'?'conflict':'failed'};
 };
}
/** Contact port: the normalised phone and Telegram's send time only; scrubbed once processed. */
export function contactPort(rpc:TelegramServiceRpc):TelegramContactPort{
 return async event=>{
  const parsed=commitResult.parse(await rpc('channel_inbox_commit',{p_event:{adapter:'telegram',eventId:event.eventId,fingerprint:event.fingerprint,principalRef:event.principalRef,kind:'contact',payload:{chatId:event.chatId,messageId:event.messageId,sentAt:event.sentAt,...(event.phone===null?{foreign:true}:{phone:event.phone})}}}));
  return parsed.status==='committed'||parsed.status==='committed-duplicate'?parsed:{status:parsed.status==='conflict'?'conflict':'failed'};
 };
}
export function deadLetterPort(rpc:TelegramServiceRpc):TelegramDeadLetterPort{
 return async(eventId,reason)=>(await rpc('channel_inbox_reject',{p_event_id:eventId,p_reason:reason}) as {status?:string}|null)?.status==='committed';
}

/** Zoe's chat cards in the sweep. A press the database verified runs its command; a refused one is answered and ends there. */
export const telegramCards:TelegramCardHandlers={
 press:async(rpc,adapter,processed)=>{
  if(await handleDoctorTelegram(rpc,adapter,processed))return true;
  const r=processedSchema.safeParse(processed);
  if(!r.success||!adapter||(!r.data.press&&!r.data.refused&&!r.data.menu&&!r.data.redo))return false;
  if(r.data.press)await handleCardPress(rpc,adapter,r.data.press);
  else if(r.data.menu)await openMenu(rpc,r.data.menu);
  else if(r.data.redo)await handleRedo(rpc,r.data.redo);
  else if(r.data.refused)await answerRefusedPress(adapter,r.data.refused);
  return true;
 },
 offers:offerTelegramCards,
 keyboard:cardKeyboard,
 noticeKeyboard,
};

/** The mounted webhook. With the flag off every request is a 503 before the body is read. */
export function telegramWebhook(){
 const rpc=telegramEnabled()?serviceRpc():null;
 return createTelegramWebhook({config:rpc?webhookConfig():undefined,...(rpc?{inbox:inboxPort(rpc),deadLetter:deadLetterPort(rpc),redo:redoPort(rpc),media:mediaPort(rpc),contact:contactPort(rpc)}:{})});
}

/**
 * Zoe runs per webhook sweep. The webhook function has 60 s from its request; a Zoe run is bounded by RUN_WORST_MS
 * (44 s: its time budget, a health answer's included, plus the database writes), so a run starts only when it still ends WEBHOOK_DISPATCH_RESERVE_MS
 * before the function's own limit, counted from the request (startedAt), so the inbox and the first dispatch count.
 * Usually that is the newest message and, after a quick run, a second. Anything else waits for the zoe/run cron (at
 * most five minutes) instead of being cut off mid-run.
 */
const WEBHOOK_ZOE_LIMIT=2,WEBHOOK_LIMIT_MS=60_000,WEBHOOK_DISPATCH_RESERVE_MS=12_000;

/**
 * One sweep when fully configured; otherwise null and nothing is read or sent. The webhook runs Zoe in it
 * (the reply follows the update at once); the cron and the zoe/run job pass withZoe false, because Zoe has
 * its own cron and a model call must not eat the dispatch budget (quality review item 25).
 */
export async function runConfiguredTelegramSweep(options:{withZoe?:boolean;zoeLimit?:number;
 /** When the caller's request started (Date.now()); Zoe's deadline counts from it. Default: now. */startedAt?:number;
 /** Cron passes its existing job deadline, after cleanup/checkpoint time. */deadlineAt?:number}={}){
 const startedAt=options.startedAt??Date.now();
 const bot=telegramBot(),config=outboundConfig();
 if(!telegramEnabled()||!bot||!config)return null;
 const deadlineAt=options.deadlineAt??startedAt+WEBHOOK_LIMIT_MS-2_000;
 const rpc=serviceRpc(deadlineAt);if(!rpc)return null;
 await rpc('doctor_telegram_sweep',{});
 // An invalid or missing bot token yields an adapter with no capability; the sweep
 // then processes the inbox but sends nothing.
 return runTelegramSweep({rpc,adapter:createTelegramAdapter({config,http:telegramHttpsPort}),accountRef:telegramAccountRef(bot),deadlineAt,
  ...(nurseTelegramEnabled()?{nurseEnabled:true}:{}),
  // Care alerts also run on their own cron, independently of Telegram; these RPCs are idempotent.
  ...(careAlertsEnabled()?{screenMessages:(r:TelegramServiceRpc)=>runCareAlertSweep(r)}:{}),
  ...(options.withZoe!==false&&zoePipelineEnabled()?{zoe:async(r:TelegramServiceRpc)=>{
   const pass=await runZoePasses(()=>runZoeSweep(r,{limit:1}),{limit:options.zoeLimit??WEBHOOK_ZOE_LIMIT,deadlineAt:startedAt+WEBHOOK_LIMIT_MS-WEBHOOK_DISPATCH_RESERVE_MS});
   // The fixed 103 text for members Zoe skipped; counted as finished so the sweep sends it right away.
   const unread=await runUnreadUrgentPass(r);
   return {...pass,finished:{...pass.finished,...(unread.sent?{urgent_unread:unread.sent}:{})},failed:pass.failed+unread.failed};}}:{}),
  ...(signinLinkOrigin()?{signinLinkOrigin:signinLinkOrigin()!}:{}),cards:telegramCards});
}

/** Session cleanup after revocations; independent of the Telegram flag so a switched-off channel never strands a job. */
export async function runConfiguredAuthCleanup(){
 const rpc=serviceRpc();
 if(!rpc)return null;
 await rpc('doctor_telegram_sweep',{});
 return runAuthCleanup(rpc);
}

/** Programme checkpoints (week 4, month 3, month 6) open on their dates. Independent of the Telegram
 * flag: the doctor's review task must not depend on the channel. Runs before the sweep so an
 * opening notice is sent in the same pass. Dark: the database switch decides. */
/** LDL re-test and response loop (lib/ldl/response-runtime.ts); like the programme run, independent of the Telegram flag. Dark: the database switch decides. */
export async function runConfiguredLdlResponseSweep():Promise<string|null>{
 const rpc=serviceRpc();if(!rpc)return null;
 const r=await runLdlResponseSweep(rpc as LdlServiceRpc).catch(()=>null);
 return r?r.state==='ran'?`recorded ${r.recorded}, skipped ${r.skipped}, failed ${r.failed}, run ${r.run}`:r.state:'failed';
}
export async function runConfiguredProgrammeRun():Promise<string|null>{
 const rpc=serviceRpc();if(!rpc)return null;
 const r=await rpc('programme_run',{}).catch(()=>null) as {state?:string;opened?:number}|null;
 return r?.state==='ran'?`opened ${r.opened??0}`:r?.state??'failed';
}
