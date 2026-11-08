import 'server-only';
import {bpWeeklyTrendsEnabled} from '@/lib/clinical/rules/bp-trend';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {doctorNoticeUrl} from '@/lib/staff-zoe/notice-link';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {claimSchema,observeResultSchema,outcomeResultSchema} from '@/lib/conversation-persistence/contracts';
import {dispatchConversation,observationFrom,recordObservation,type DispatchResult} from '@/lib/conversation-persistence/worker';
import type {AttemptOutcome} from '@/lib/conversation-core/contracts';
import {isMemberSigninLink,type SystemTextPayload,type TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';
import {dispatchNurseQueue,handleNurseInbox,NURSE_ATTEMPT_BUDGET_MS} from './nurse';

/** Every database call the sweep makes, all as the service role. */
export type TelegramServiceRpc=(name:string,args:Record<string,unknown>,timeoutMs?:number)=>Promise<unknown>;
// Leasing must leave the handler its full budget, even after the database call.
const TELEGRAM_RPC_BUDGET_MS=2_000;
// Member system/reply sends: claim (2 s), buttons/link (4 s), transport (10 s),
// three observation + three outcome calls (12 s), and their backoffs (2.4 s).
const MEMBER_ATTEMPT_BUDGET_MS=32_000;

const ids=z.array(z.uuid());
const queueSchema=z.strictObject({system:ids,replies:ids});
const systemClaimSchema=z.union([z.object({ok:z.literal(false),code:z.string()}),z.object({ok:z.literal(true),fresh:z.literal(true),adapter:z.string(),accountRef:z.string(),
 envelope:z.strictObject({messageId:z.uuid(),attemptId:z.uuid(),address:z.string(),text:z.string(),bodyHash:z.string()})})]);

export type SweepReport={inbox:{processed:number;retry:number};cards?:{pressed:number;offered:number};reminders?:string;bpWeek?:string;bpWeekly?:string;medicines?:string;medicineAsks?:string;screening?:{screened:number;escalated:number;failed:number};zoe?:{claimed:number;finished:Record<string,number>;failed:number};
 /** System messages Zoe queued in this sweep (her answers, the urgent template), sent right away. */
 afterZoe?:Record<string,number>;nurse?:Record<string,number>;reconciled:number;sending:'on'|'off';system:Record<string,number>;auth:Record<string,number>;replies:Record<string,number>};
const tally=(into:Record<string,number>,key:string)=>{into[key]=(into[key]??0)+1;};

/** Zoe's chat cards (lib/telegram-runtime/cards.ts; the database switch decides). The sweep stays free of card knowledge. */
export type TelegramCardHandlers={
 /** One processed inbox row, when it was a card button: runs its command and answers it. True when it was one. */
 press(rpc:TelegramServiceRpc,adapter:TelegramChannelAdapter|null,processed:unknown):Promise<boolean>;
 /** Cards asked for by messages Zoe's pipeline just cleared. Returns how many were queued. */
 offers(rpc:TelegramServiceRpc):Promise<number>;
 /** The buttons of a claimed message that carries a card; 'failed' sends nothing. */
 keyboard(rpc:TelegramServiceRpc,messageId:string):Promise<Extract<SystemTextPayload['keyboard'],{kind:'callback'}>|'failed'|null>;
 /** The button of a claimed member notice whose task has a card; null keeps its link button. */
 noticeKeyboard(rpc:TelegramServiceRpc,messageId:string,line:string):Promise<Extract<SystemTextPayload['keyboard'],{kind:'callback'}>|null>;
};

type SigninButton={kind:'open_url';label:string;url:string};
/**
 * The one-tap "Open Noreon" button for a claimed Zoe text ('system') or doctor reply ('delivery'), lead
 * decision 19 Oct. The token is made here and only its hash stored; the database decides whether this
 * reply may carry one (binding on this chat, proof, 5 per hour, approved label). Any no or error: no button,
 * the reply itself always goes.
 */
export async function replySigninButton(rpc:TelegramServiceRpc,origin:string|undefined,kind:'system'|'delivery',ref:string):Promise<SigninButton|undefined>{
 if(!origin)return undefined;
 const token=randomBytes(24).toString('base64url'),url=`${origin}/patient/telegram-link#t=${token}`;
 if(!isMemberSigninLink(url))return undefined;
 const armed=await rpc('telegram_signin_link_arm_reply',{p_kind:kind,p_ref:ref,p_token_hash:createHash('sha256').update(token,'utf8').digest('hex')}).catch(()=>null) as {ok?:boolean;label?:unknown}|null;
 // A label Telegram would refuse must never cost the reply itself: drop the button instead (review R1 of #325).
 const label=armed?.ok===true&&typeof armed.label==='string'?armed.label:'';
 return label.length>=1&&label.length<=64&&label.isWellFormed()&&label.trim()===label?{kind:'open_url',label,url}:undefined;
}

/** One claimed system message, at most one send, then its observation recorded (CR2). */
export async function dispatchSystemMessage(rpc:TelegramServiceRpc,adapter:Pick<TelegramChannelAdapter,'id'|'deliverText'>,accountRef:string,messageId:string,attemptId:string,options:{tries?:number;backoffMs?:number;signinLinkOrigin?:string;cards?:TelegramCardHandlers}={}):Promise<DispatchResult>{
 const record={observe:async(a:string,o:unknown)=>observeResultSchema.parse(await rpc('delivery_observe',{p_channel:'system',p_attempt:a,p_outcome:o})),outcome:async(a:string,o:unknown)=>outcomeResultSchema.parse(await rpc('system_message_outcome',{p_attempt:a,p_outcome:o}))};
 let claim;try{claim=systemClaimSchema.parse(await rpc('system_message_claim',{p_message:messageId,p_attempt:attemptId}));}catch{return {state:'claim_unconfirmed',attemptId};}
 if(!claim.ok)return {state:'not_invoked',reason:claim.code};
 if(claim.adapter!==adapter.id||claim.accountRef!==accountRef){
  const recorded=await recordObservation(record,attemptId,Object.freeze({kind:'definitely_failed',evidence:'Adapter unavailable before invocation'}),options.tries,options.backoffMs);
  return recorded.state==='outcome_recorded'?{state:'not_invoked',reason:'adapter_mismatch'}:recorded;
 }
 const card=options.cards?await options.cards.keyboard(rpc,messageId):null;
 if(card==='failed'){
  const recorded=await recordObservation(record,attemptId,Object.freeze({kind:'definitely_failed',evidence:'Card buttons unavailable before invocation'}),options.tries,options.backoffMs);
  return recorded.state==='outcome_recorded'?{state:'not_invoked',reason:'card_buttons'}:recorded;
 }
 const keyboard=card??await replySigninButton(rpc,options.signinLinkOrigin,'system',messageId);
 let result:AttemptOutcome|{kind:'unknown';reason:string};
 try{result=await adapter.deliverText(Object.freeze({address:claim.envelope.address,text:claim.envelope.text,...(keyboard?{keyboard}:{})}));}
 catch{result={kind:'unknown',reason:'Transport invocation returned no conclusive acknowledgement'};}
 return recordObservation(record,attemptId,observationFrom(result),options.tries,options.backoffMs);
}

const authClaimSchema=z.union([z.object({ok:z.literal(false),code:z.string()}),z.object({ok:z.literal(true),fresh:z.literal(true),
 envelope:z.strictObject({messageId:z.uuid(),attemptId:z.uuid(),address:z.string(),text:z.string(),keyboard:z.union([z.strictObject({kind:z.literal('request_contact'),label:z.string()}),z.strictObject({kind:z.literal('remove')}),z.strictObject({kind:z.literal('open_url'),label:z.string(),url:z.string()})]).optional()})})]);
const authOutcomeSchema=z.object({ok:z.boolean(),result:z.string().optional(),code:z.string().optional(),retryable:z.boolean().optional()});

/** A sign-in prompt or notice (share-contact button, confirmations): claim, one send, outcome. */
export async function dispatchAuthMessage(rpc:TelegramServiceRpc,adapter:Pick<TelegramChannelAdapter,'deliverText'>,messageId:string,attemptId:string,options:{tries?:number;backoffMs?:number;signinLinkOrigin?:string;cards?:TelegramCardHandlers;noticeCardMs?:number}={}):Promise<{state:string}>{
 let claim;try{claim=authClaimSchema.parse(await rpc('telegram_auth_message_claim',{p_message:messageId,p_attempt:attemptId}));}catch{return {state:'claim_unconfirmed'};}
 if(!claim.ok)return {state:'not_invoked'};
 const {address,text}=claim.envelope;let {keyboard}=claim.envelope as {keyboard?:typeof claim.envelope.keyboard|Extract<SystemTextPayload['keyboard'],{kind:'callback'}>};
 if(keyboard?.kind==='open_url')keyboard={...keyboard,url:doctorNoticeUrl(keyboard.url)};
 // A notice whose task has a card opens it in the chat; any doubt, and it goes as it always did.
 // Bounded: this runs after the claim, and a slow card must not eat the send's window, so the link goes instead (Astra EV-07).
 const inChat=options.cards&&(!keyboard||keyboard.kind==='open_url')?await Promise.race([options.cards.noticeKeyboard(rpc,messageId,text).catch(()=>null),new Promise<null>(resolve=>{setTimeout(()=>resolve(null),options.noticeCardMs??3000);})]):null;
 if(inChat)keyboard=inChat;
 // A next-step reply or member notice may carry a one-tap sign-in link: the token is made here, only its
 // hash is stored, and it rides on the inline button, never in the text. The message's own button keeps
 // its label; a message without one gets the approved label the arm returns.
 const token=randomBytes(24).toString('base64url'),url=`${options.signinLinkOrigin}/patient/telegram-link#t=${token}`;
 // Only a link the adapter will put on a button is armed (the member app host, https).
 if(!inChat&&options.signinLinkOrigin&&(!keyboard||keyboard.kind==='open_url')&&isMemberSigninLink(url)){
  const armed=await rpc('telegram_signin_link_arm',{p_message:messageId,p_token_hash:createHash('sha256').update(token,'utf8').digest('hex')}).catch(()=>null) as {ok?:boolean;label?:unknown}|null;
  const label=keyboard?.kind==='open_url'?keyboard.label:typeof armed?.label==='string'?armed.label:null;
  if(armed?.ok&&label)keyboard={kind:'open_url',label,url};
 }
 let result:AttemptOutcome|{kind:'unknown';reason:string};
 try{result=await adapter.deliverText(Object.freeze({address,text,...(keyboard?{keyboard}:{})}));}
 catch{result={kind:'unknown',reason:'Transport invocation returned no conclusive acknowledgement'};}
 const outcome=observationFrom(result);
 for(let i=0,tries=options.tries??3;i<tries;i++){
  try{const r=authOutcomeSchema.parse(await rpc('telegram_auth_message_outcome',{p_attempt:attemptId,p_outcome:outcome}));if(r.ok)return {state:'outcome_recorded'};if(!r.retryable)return {state:'outcome_rejected'};}catch{/* retried */}
  await new Promise(resolve=>setTimeout(resolve,options.backoffMs??200));
 }
 return {state:'outcome_unrecorded'};
}

/** Durable session cleanup after revocations (T-auth §4). Runs whether or not Telegram sending is on. */
export async function runAuthCleanup(rpc:TelegramServiceRpc):Promise<number|null>{
 const r=await rpc('auth_cleanup_run',{}).catch(()=>null) as {deleted?:number}|null;
 return typeof r?.deleted==='number'?r.deleted:null;
}

/**
 * One bounded pass: process committed inbox rows, reconcile stale sends, then claim
 * and send queued system messages and approved replies. Concurrent sweeps are safe:
 * inbox leases skip locked rows and every claim allows a single attempt, so two
 * sweeps can never send one message twice.
 */
export async function runTelegramSweep(deps:{rpc:TelegramServiceRpc;adapter:TelegramChannelAdapter|null;accountRef:string;limit?:number;newId?:()=>string;
 /** Passed only for the exact nurse environment switch; the DB independently gates every entry point. */
 nurseEnabled?:boolean;
 /** Absolute request deadline, shared by inbox processing and all sending. */
 deadlineAt?:number;
 /** Origin for one-tap sign-in links (dark; passed only when NOREON_TELEGRAM_SIGNIN_LINKS_ENABLED). */
 signinLinkOrigin?:string;
 /** Care-team alert screening of new member messages (dark; passed only when NOREON_CARE_ALERTS_ENABLED). Never blocks the sweep. */
 screenMessages?:(rpc:TelegramServiceRpc)=>Promise<{screened:number;escalated:number;failed:number}>;
 /** Zoe pipeline (dark; passed only when NOREON_ZOE_PIPELINE_ENABLED). Runs after every send, so a model call never delays an acknowledgement or a reply. */
 zoe?:(rpc:TelegramServiceRpc)=>Promise<{claimed:number;finished:Record<string,number>;failed:number}>;
 cards?:TelegramCardHandlers}):Promise<SweepReport>{
 // Bound only leased/send work. Screening, reconciliation and reminders keep
 // their existing behaviour; a slow one simply leaves later sends unclaimed.
 const sendRpc:TelegramServiceRpc=deps.deadlineAt===undefined?deps.rpc:(name,args)=>deps.rpc(name,args,TELEGRAM_RPC_BUDGET_MS);
 const report=await sweepAndDispatch(deps,sendRpc);
 const options=()=>({...(deps.signinLinkOrigin?{signinLinkOrigin:deps.signinLinkOrigin}:{}),...(deps.cards?{cards:deps.cards}:{})});
 if(deps.zoe){
  report.zoe=await deps.zoe(deps.rpc).catch(()=>({claimed:0,finished:{},failed:1}));
  // Zoe's text, the urgent template or a released acknowledgement was queued after this sweep's sends:
  // send it now rather than on the next sweep (up to five minutes later). Same claim rules, so nothing
  // is sent twice. Any finished run may have queued one (answer, intake, chat, receipt, release).
  const queued=Object.entries(report.zoe.finished).filter(([o])=>o!=='stale'&&o!=='finish_refused').reduce((n,[,x])=>n+x,0);
  // A card the member's message asked for goes right after Zoe's reply to it.
  if(queued&&report.sending==='on'&&deps.cards&&report.cards)report.cards.offered+=await deps.cards.offers(deps.rpc).catch(()=>0);
  if(queued&&report.sending==='on'&&deps.adapter){
   report.afterZoe={};
   const queue=queueSchema.parse(await deps.rpc('telegram_dispatch_queue',{p_limit:deps.limit??20}));
   for(const id of queue.system){
    if((deps.deadlineAt??Infinity)-Date.now()<MEMBER_ATTEMPT_BUDGET_MS)break;
    tally(report.afterZoe,(await dispatchSystemMessage(sendRpc,deps.adapter,deps.accountRef,id,(deps.newId??randomUUID)(),options())).state);
   }
  }
 }
 // Existing delivery, including Zoe's new answer, gets the first share.
 if(deps.nurseEnabled&&report.sending==='on'&&deps.adapter)report.nurse=await dispatchNurseQueue(deps.rpc,deps.adapter,deps.limit??20,deps.deadlineAt??Infinity);
 return report;
}

/** A lease consumes an attempt: with a deadline, take only the next row we can start. */
async function* leaseInbox(rpc:TelegramServiceRpc,limit:number,processingDeadline?:number){
 if(processingDeadline===undefined){yield* ids.parse(await rpc('channel_inbox_next',{p_limit:limit}));return;}
 for(let i=0;i<Math.max(1,Math.min(limit,50));i++){
  if(processingDeadline-Date.now()<TELEGRAM_RPC_BUDGET_MS+NURSE_ATTEMPT_BUDGET_MS)return;
  const [id]=ids.parse(await rpc('channel_inbox_next',{p_limit:1},TELEGRAM_RPC_BUDGET_MS));
  if(!id)return;
  yield id;
 }
}

async function sweepAndDispatch(deps:Parameters<typeof runTelegramSweep>[0],sendRpc:TelegramServiceRpc):Promise<SweepReport>{
 const {rpc,adapter,accountRef}=deps,limit=deps.limit??20,newId=deps.newId??randomUUID;
 const deadlineAt=deps.deadlineAt??Infinity;
 // Keep the existing nurse delivery reserve after processing.
 const processingDeadline=deadlineAt-NURSE_ATTEMPT_BUDGET_MS;
 // Without a usable outbound configuration nothing is claimed: messages stay queued, never failed.
 const sending=adapter!==null&&adapter.capabilities().plainText!==null;
 const report:SweepReport={inbox:{processed:0,retry:0},reconciled:0,sending:sending?'on':'off',system:{},auth:{},replies:{},...(deps.cards?{cards:{pressed:0,offered:0}}:{})};
 for await(const id of leaseInbox(rpc,limit,deps.deadlineAt===undefined?undefined:processingDeadline)){
  if(deps.nurseEnabled){
   const nurse=await handleNurseInbox(rpc,adapter,id,true,processingDeadline);
   if(nurse.handled){if(nurse.ok)report.inbox.processed++;else report.inbox.retry++;continue;}
  }
  const r=await rpc('channel_inbox_process',{p_id:id}).catch(()=>null) as {ok?:boolean}|null;
  if(r?.ok)report.inbox.processed++;else report.inbox.retry++;
  // A press runs its command here, not after the sends: the answer to the button must not wait on them.
  if(r?.ok&&deps.cards&&report.cards&&await deps.cards.press(rpc,adapter,r).catch(()=>false))report.cards.pressed++;
 }
 if(deps.screenMessages)report.screening=await deps.screenMessages(rpc).catch(()=>({screened:0,escalated:0,failed:1}));
 const reconciled=await rpc('delivery_reconcile_stale',{p_lease_seconds:120}).catch(()=>null) as {reconciled?:number}|null;
 report.reconciled=reconciled?.reconciled??0;
 if(deps.nurseEnabled)await rpc('telegram_nurse_outbox_reconcile',{p_enabled:true}).catch(()=>null);
 if(!sending||!adapter)return report;
 // Acknowledgements held for Zoe that she never answered within 3 minutes go out now (20261018121002 §6).
 await rpc('zoe_held_ack_release',{}).catch(()=>null);
 // Member visit reminders due now are queued just before sending (dark: the database switch decides; never blocks the sweep).
 const reminders=await rpc('member_notice_reminders_run',{}).catch(()=>null) as {state?:string;queued?:number}|null;
 report.reminders=reminders?.state==='ran'?`queued ${reminders.queued??0}`:reminders?.state??'failed';
 // BP week slots, medicine times and Zoe's missed-dose asks (dark: each feature's database switch decides; never blocks the sweep).
 for(const [key,name] of [['bpWeekly','bp_weekly_summary_run'],['bpWeek','bp_week_reminders_run'],['medicines','member_medicine_reminders_run'],['medicineAsks','member_medicine_asks_run']] as const){
  if(key==='bpWeekly'&&!bpWeeklyTrendsEnabled()){report[key]='off';continue;}
  // V3 medicine reminders are chat cards only. Keep legacy outbound sweeps held while that scheduler is absent.
  if(zoeAppV3Enabled()&&(key==='medicines'||key==='medicineAsks')){report[key]='v3_chat_only';continue;}
  const run=await rpc(name,{}).catch(()=>null) as {state?:string;queued?:number}|null;
  report[key]=run?.state==='ran'?`queued ${run.queued??0}`:run?.state??'failed';
 }
 if(deps.cards&&report.cards)report.cards.offered+=await deps.cards.offers(rpc).catch(()=>0);
 const queue=queueSchema.parse(await rpc('telegram_dispatch_queue',{p_limit:limit}));
 const options={...(deps.signinLinkOrigin?{signinLinkOrigin:deps.signinLinkOrigin}:{}),...(deps.cards?{cards:deps.cards}:{})};
 for(const id of queue.system){
  if(deadlineAt-Date.now()<MEMBER_ATTEMPT_BUDGET_MS)break;
  tally(report.system,(await dispatchSystemMessage(sendRpc,adapter,accountRef,id,newId(),options)).state);
 }
 for(const id of ids.parse(await rpc('telegram_auth_message_queue',{p_limit:limit}))){
  if(deadlineAt-Date.now()<MEMBER_ATTEMPT_BUDGET_MS)break;
  tally(report.auth,(await dispatchAuthMessage(sendRpc,adapter,id,newId(),options)).state);
 }
 const repo={
  claim:async(deliveryId:string,attemptId:string)=>claimSchema.parse(await sendRpc('conversation_claim',{p_delivery:deliveryId,p_attempt:attemptId})),
  observe:async(attemptId:string,o:unknown)=>observeResultSchema.parse(await sendRpc('delivery_observe',{p_channel:'conversation',p_attempt:attemptId,p_outcome:o})),
  outcome:async(attemptId:string,o:unknown)=>outcomeResultSchema.parse(await sendRpc('conversation_outcome',{p_attempt:attemptId,p_outcome:o})),
 };
 for(const id of queue.replies){
  if(deadlineAt-Date.now()<MEMBER_ATTEMPT_BUDGET_MS)break;
  tally(report.replies,(await dispatchConversation(repo,{id:adapter.id,accountRef,deliver:async payload=>{
  // Called only after a fresh claim: the doctor's reply may carry the one-tap button.
  const keyboard=await replySigninButton(sendRpc,deps.signinLinkOrigin,'delivery',(payload as {deliveryId:string}).deliveryId);
  return adapter.deliver(payload as never,keyboard?{keyboard}:undefined);
 }},id,newId())).state);
 }
 return report;
}
