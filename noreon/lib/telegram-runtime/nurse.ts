import 'server-only';
import {z} from 'zod';
import {completionNoteLabel,taskUncertainText} from '@/lib/staff/real-coordination/task-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import type {SystemTextPayload,TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';
import type {TelegramServiceRpc} from './dispatch';
import {NURSE_VISIT_RENDERER_VERSION,NURSE_VISIT_COPY_VERSION,visitWorkSchema,planNurseVisitInput,nurseVisitChoices,telegramVisitQuestion,renderNurseVisitTurn,type TelegramVisitWork} from './nurse-visit';
import {questionKey} from '@/lib/nurse-visit/chat-order';

// This version identifies the complete renderer, its data slots and reused copy,
// rather than an approved shell into which arbitrary instructions can be inserted.
export const NURSE_RENDERER_VERSION='nurse-tasks-v1';
export const NURSE_COPY_VERSION='nurse-task-copy-v1';
const locale=z.enum(['en','hy','ru']);
const plain=(max:number)=>z.string().min(1).max(max).refine(s=>s.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const line=(max:number)=>plain(max).refine(s=>!/[\r\n]/u.test(s));
const title=line(160),name=line(160),ref=z.string().regex(/^[A-Za-z0-9_-]{16,60}$/);
const task=z.strictObject({id:z.uuid(),title,memberName:name.nullable(),dueAt:z.string().nullable(),intentRef:ref.nullable()});
const turnSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('today'),tasks:z.array(task).max(8),hasMore:z.boolean()}),
 z.strictObject({kind:z.literal('action'),nurseName:name,title}),
 z.strictObject({kind:z.literal('task-note'),title,instructions:plain(2000),memberName:name.nullable()}),
 z.strictObject({kind:z.literal('task-saved'),next:z.strictObject({title,memberName:name.nullable()}).nullable()}),
 z.strictObject({kind:z.literal('clear-controls'),messageId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}),
 ...(['pending','refused','help','cancelled','followup-unavailable','task-recovered'] as const).map(kind=>z.strictObject({kind:z.literal(kind)})),
]);
type RenderedTurn=Omit<SystemTextPayload,'address'>|{messageId:number};

/** Plain data only: Telegram formatting and previews are disabled by the adapter. */
export function renderNurseTurn(l:StaffLocale,raw:unknown):RenderedTurn|null{
 const visit=renderNurseVisitTurn(l,raw);if(visit)return visit;
 const parsed=turnSchema.safeParse(raw);if(!parsed.success)return null;
 const turn=parsed.data,t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const member=(value:string|null)=>value??t('Member','Անդամ','Участник');
 const noDue=t('No due tasks in the available list.','Հասանելի ցանկում ժամկետով առաջադրանքներ չկան։','В доступном списке нет задач к сроку.');
 const dueLine=(row:{memberName:string|null;title:string})=>`${member(row.memberName)} · ${row.title}`;
 const protectedText=(text:string,keyboard?:SystemTextPayload['keyboard']):RenderedTurn=>({text,protectContent:true,...(keyboard?{keyboard}:{})});
 switch(turn.kind){
  case 'clear-controls':return {messageId:turn.messageId};
  case 'today':{
   const rows=turn.tasks.flatMap((row,i)=>row.intentRef===null?[]:[[{label:`${i+1}. ${t('Mark done','Նշել ավարտված','Отметить выполненной')}`,ref:row.intentRef}]]);
   const text=turn.tasks.length?turn.tasks.map((row,i)=>`${i+1}. ${dueLine(row)}`).join('\n'):noDue;
   const more=turn.hasMore?'\n'+t('Only loaded tasks are shown. More tasks may be due.','Ցուցադրված են միայն բեռնված առաջադրանքները։ Կարող են լինել այլ ժամկետով առաջադրանքներ։','Показаны только загруженные задачи. Могут быть и другие задачи к сроку.') : '';
   return protectedText(text+more,rows.length?{kind:'callback',rows}:undefined);
  }
  case 'action':return protectedText(`${turn.nurseName}: ${t('Done:','Ավարտված՝','Готово:')} ${turn.title}`);
  case 'task-note':return protectedText(`${dueLine(turn)}\n${turn.instructions}\n\n${completionNoteLabel(l)}\n${t('Reply to this message with your note. To cancel, reply /cancel.','Պատասխանեք այս հաղորդագրությանը ձեր նշումով։ Չեղարկելու համար պատասխանեք /cancel։','Ответьте на это сообщение заметкой. Для отмены ответьте /cancel.')}`,{kind:'force_reply'});
  case 'task-saved':return protectedText(turn.next?`${t('Next:','Հաջորդը՝','Далее:')} ${dueLine(turn.next)}`:noDue);
  case 'pending':return protectedText(`${taskUncertainText(l)}\n${t('Send /resume to check this task.','Ուղարկեք /resume՝ այս առաջադրանքը ստուգելու համար։','Отправьте /resume, чтобы проверить эту задачу.')}`);
  case 'refused':return protectedText(staffServerText(l,'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'));
  case 'cancelled':return protectedText(t('Cancelled. The task is unchanged.','Չեղարկված է։ Առաջադրանքը չի փոխվել։','Отменено. Задача не изменена.'));
  case 'help':return protectedText(t('Reply to the completion note prompt, or send /menu for today’s tasks.','Պատասխանեք ավարտի նշման հարցմանը կամ ուղարկեք /menu՝ այսօրվա առաջադրանքների համար։','Ответьте на запрос заметки о завершении или отправьте /menu для задач на сегодня.'));
  case 'followup-unavailable':return protectedText(t('Your task is complete. Send /menu to load today’s tasks.','Ձեր առաջադրանքն ավարտված է։ Ուղարկեք /menu՝ այսօրվա առաջադրանքները բեռնելու համար։','Ваша задача завершена. Отправьте /menu, чтобы загрузить задачи на сегодня.'));
  case 'task-recovered':return protectedText(t('Your completion note is recorded.','Ձեր ավարտի նշումը գրանցված է։','Ваша заметка о завершении записана.'));
 }
}

const received=z.union([
 z.object({handled:z.literal(false)}),
 z.object({handled:z.literal(true),status:z.enum(['ready','done','refused','pending','not_leased']),inboxId:z.uuid().optional(),leaseAttempt:z.number().int().nonnegative().optional(),callbackId:z.string().nullable().optional(),visit:z.unknown().optional()}),
]);
const applied=z.object({ok:z.boolean(),status:z.string().optional(),visit:z.unknown().optional()});
export type NurseInboxResult={handled:false}|{handled:true;ok:boolean};
// Claim/receive (2 s), transport (10 s), and up to three outcome writes (6 s).
// The configured sweep bounds each RPC to 2 s as well as its absolute deadline.
export const NURSE_ATTEMPT_BUDGET_MS=20_000;

/** Only an explicit non-nurse/off answer can reach member handling. No actor comes from TS. */
export async function handleNurseInbox(rpc:TelegramServiceRpc,adapter:Pick<TelegramChannelAdapter,'acknowledgeCallback'>|null,inboxId:string,enabled:boolean,deadlineAt=Infinity):Promise<NurseInboxResult>{
 if(!enabled)return {handled:false};
 if(deadlineAt-Date.now()<NURSE_ATTEMPT_BUDGET_MS)return {handled:true,ok:false};
 const receive=received.safeParse(await rpc('telegram_nurse_receive',{p_id:inboxId,p_enabled:true}).catch(()=>null));
 if(!receive.success)return {handled:true,ok:false};
 const r=receive.data;if(!r.handled)return {handled:false};
 if(r.status==='not_leased'||(r.inboxId!==undefined&&r.inboxId!==inboxId))return {handled:true,ok:false};
 let ok=r.status==='done'||r.status==='refused';
 if(!ok){
  if(!r.leaseAttempt)return {handled:true,ok:false};
  const args={p_id:inboxId,p_enabled:true,p_attempt:r.leaseAttempt};
  let result;
  if(r.visit!=null){
   result=await advanceNurseVisit(rpc,args,r.visit,deadlineAt);
  }else result=applied.safeParse(await rpc(r.status==='pending'?'telegram_nurse_resume':'telegram_nurse_apply',args).catch(()=>null));
  // The durable command was committed before executing. Resume checks/replays that
  // identity under current authority, including a save whose response was lost.
  if(!result.success)result=applied.safeParse(await rpc('telegram_nurse_resume',args).catch(()=>null));
  if(result.success&&result.data.visit!=null)result=await advanceNurseVisit(rpc,args,result.data.visit,deadlineAt);
  ok=result.success&&(result.data.ok||result.data.status==='refused')&&result.data.visit==null;
 }
 if(r.callbackId&&adapter&&deadlineAt-Date.now()>=10_000)await adapter.acknowledgeCallback(r.callbackId).catch(()=>null);
 return {handled:true,ok};
}

/** One durable visit input, then one render of the authoritative result. A
 * transient read or interrupted render keeps the existing pending inbox frozen.
 * Every RPC uses the sweep's bounded port; no local loop can outlive its budget. */
async function advanceNurseVisit(rpc:TelegramServiceRpc,args:{p_id:string;p_enabled:boolean;p_attempt:number},raw:unknown,deadlineAt:number){
 let result:ReturnType<typeof applied.safeParse>={success:false,error:new z.ZodError([]) as z.ZodError<z.infer<typeof applied>>};
 for(let round=0;round<3&&deadlineAt-Date.now()>=8_000;round++){
  const parsed=visitWorkSchema.safeParse(raw);if(!parsed.success)return result;
  const work=parsed.data as TelegramVisitWork;
  if(work.phase==='input'){
   const plan=planNurseVisitInput(work);if(!plan)return result;
   const pinned=applied.safeParse(await rpc('telegram_nurse_visit_prepare',{...args,p_plan:plan}).catch(()=>null));
   if(!pinned.success||!pinned.data.ok)return pinned;
   result=applied.safeParse(await rpc('telegram_nurse_apply',args).catch(()=>null));
  }else{
   const q=telegramVisitQuestion(work.snapshot,work.flow);
   result=applied.safeParse(await rpc('telegram_nurse_visit_render',{...args,p_plan:{token:work.token,questionKey:q?questionKey(q):null,choices:nurseVisitChoices(work.snapshot,work.flow)}}).catch(()=>null));
  }
  if(!result.success||result.data.visit==null)return result;
  raw=result.data.visit;
 }
 return result.success&&result.data.visit==null?result:applied.safeParse(null);
}

const claim=z.union([z.object({ok:z.literal(false),code:z.string().optional()}),z.object({ok:z.literal(true),envelope:z.strictObject({outboxId:z.uuid(),attemptId:z.uuid(),address:z.string(),locale,turn:z.unknown(),rendererVersion:z.enum([NURSE_RENDERER_VERSION,NURSE_VISIT_RENDERER_VERSION]),clinicalCopyVersion:z.enum([NURSE_COPY_VERSION,NURSE_VISIT_COPY_VERSION])})})]);
type NurseTransport=Pick<TelegramChannelAdapter,'deliverText'|'clearKeyboard'>;
type NurseOutcome={kind:'accepted';providerRef:string}|{kind:'failed'|'unknown'};

/** One fresh claim, one provider invocation. Recording retries never repeat the send or command. */
export async function dispatchNurseMessage(rpc:TelegramServiceRpc,adapter:NurseTransport,outboxId:string,enabled:boolean,deadlineAt=Infinity):Promise<{state:string}>{
 if(!enabled)return {state:'off'};
 if(deadlineAt-Date.now()<NURSE_ATTEMPT_BUDGET_MS)return {state:'deferred'};
 const parsed=claim.safeParse(await rpc('telegram_nurse_outbox_claim',{p_id:outboxId,p_enabled:true}).catch(()=>null));
 if(!parsed.success)return {state:'claim_unconfirmed'};
 if(!parsed.data.ok)return {state:'not_invoked'};
 const e=parsed.data.envelope;
 const isVisit=typeof e.turn==='object'&&e.turn!==null&&'kind'in e.turn&&typeof e.turn.kind==='string'&&e.turn.kind.startsWith('visit-');
 const approved=isVisit?e.rendererVersion===NURSE_VISIT_RENDERER_VERSION&&e.clinicalCopyVersion===NURSE_VISIT_COPY_VERSION:e.rendererVersion===NURSE_RENDERER_VERSION&&e.clinicalCopyVersion===NURSE_COPY_VERSION;
 const rendered=approved?renderNurseTurn(e.locale,e.turn):null;
 let outcome:NurseOutcome={kind:'failed'};
 if(rendered){
  try{
   if('messageId' in rendered){
    const result=await adapter.clearKeyboard({address:e.address,messageId:rendered.messageId});
    outcome=result==='edited'?{kind:'accepted',providerRef:String(rendered.messageId)}:{kind:result==='unsupported'?'failed':'unknown'};
   }else{
    const result=await adapter.deliverText({...rendered,address:e.address});
    if(result.kind==='accepted'){
     // The adapter verified the bot, chat and exact text. Keep the provider's ID
     // to correlate future replies; reject malformed transport evidence.
     const value:unknown=JSON.parse(result.providerRef);
     outcome=Array.isArray(value)&&value[0]==='telegram'&&String(value[3])===e.address&&Number.isSafeInteger(value[4])&&value[4]>0?{kind:'accepted',providerRef:String(value[4])}:{kind:'unknown'};
    }else outcome={kind:result.kind==='unsupported'?'failed':'unknown'};
   }
  }catch{outcome={kind:'unknown'};}
 }
 for(let i=0;i<3;i++){
  const recorded=applied.safeParse(await rpc('telegram_nurse_outbox_outcome',{p_id:outboxId,p_attempt:e.attemptId,p_enabled:true,p_result:outcome}).catch(()=>null));
  if(recorded.success)return {state:recorded.data.ok?'outcome_recorded':'outcome_rejected'};
 }
 return {state:'outcome_unrecorded'};
}

/** Re-query only to release a dependent turn after an accepted predecessor. Bounded per sweep. */
export async function dispatchNurseQueue(rpc:TelegramServiceRpc,adapter:NurseTransport,limit:number,deadlineAt:number):Promise<Record<string,number>>{
 const counts:Record<string,number>={},seen=new Set<string>(),budget=Math.max(1,Math.min(limit,50));
 while(seen.size<budget&&deadlineAt-Date.now()>=NURSE_ATTEMPT_BUDGET_MS){
  const queue=z.object({ids:z.array(z.uuid())}).safeParse(await rpc('telegram_nurse_outbox_queue',{p_enabled:true,p_limit:budget-seen.size}).catch(()=>null));
  if(!queue.success)break;
  const fresh=queue.data.ids.filter(id=>!seen.has(id));if(!fresh.length)break;
  for(const id of fresh.slice(0,budget-seen.size)){
   if(deadlineAt-Date.now()<NURSE_ATTEMPT_BUDGET_MS)return counts;
   seen.add(id);const {state}=await dispatchNurseMessage(rpc,adapter,id,true,deadlineAt);counts[state]=(counts[state]??0)+1;
  }
 }
 return counts;
}
