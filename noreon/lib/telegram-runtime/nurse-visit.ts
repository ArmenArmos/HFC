import {z} from 'zod';
import {nextQuestion,questionKey,type VisitQuestion} from '@/lib/nurse-visit/chat-order';
import {parseVisitMeasurement} from '@/lib/nurse-visit/chat-parser';
import {itemDetail,itemTitle,measurementRangeError,visitCopy} from '@/lib/nurse-visit/copy';
import {nurseCommentMax,nurseVisitDetailSchema,nurseVisitRowSchema,nurseVisitItemSchema,type NurseVisitReady} from '@/lib/nurse-visit/schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {SystemTextPayload} from '@/lib/telegram-channel/outbound';

export const NURSE_VISIT_RENDERER_VERSION='nurse-visits-v1';
export const NURSE_VISIT_COPY_VERSION='nurse-visit-copy-v1';
const plain=(max:number)=>z.string().max(max).refine(s=>s.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const key=z.string().min(1).max(160),ref=z.string().regex(/^[A-Za-z0-9_-]{16,60}$/);
export const visitFlowSchema=z.strictObject({skipped:z.array(key).max(160),editing:key.nullable(),view:z.enum(['question','change','complete','comment']),comment:plain(nurseCommentMax)});
export type TelegramVisitFlow=z.infer<typeof visitFlowSchema>;
const ready=nurseVisitDetailSchema.refine((data):data is NurseVisitReady=>'enabled' in data&&data.enabled);
export const visitWorkSchema=z.strictObject({phase:z.enum(['input','render']),snapshot:ready,flow:visitFlowSchema,input:z.object({action:z.string().min(1).max(180),words:plain(2000).optional()}),token:z.string().min(1).max(128),locale:z.enum(['en','hy','ru'])});
export type TelegramVisitWork=Omit<z.infer<typeof visitWorkSchema>,'snapshot'>&{snapshot:NurseVisitReady};
export type TelegramVisitPlan={token:string;flow:TelegramVisitFlow;operation:null|'mark'|'step'|'complete';questionKey:string|null;values?:ReturnType<typeof parseVisitMeasurement>['values'];done?:boolean;error?:'measurement'|'reason'|null};
const stepNames=['confirmed','started','samples-collected','samples-at-lab'] as const;
function chosen(data:NurseVisitReady,key:string|null):VisitQuestion|null{
 if(!key)return null;
 if(key==='finish')return {kind:'finish'};
 if(key.startsWith('step:')){const step=stepNames.find(step=>`step:${step}`===key);return step?{kind:'step',step}:null;}
 const item=data.items.find(item=>item.key===key);return item?{kind:'item',item}:null;
}
export function telegramVisitQuestion(data:NurseVisitReady,flow:TelegramVisitFlow):VisitQuestion|null{
 // A completed visit exposes only its remaining lab handover, even when an old
 // editing choice was present at completion on another device.
 if(data.completion)return nextQuestion(data);
 return flow.editing?chosen(data,flow.editing):nextQuestion(data,flow.skipped);
}

/** Pure web-flow adapter. It never allocates command IDs or decides authorization. */
export function planNurseVisitInput(work:TelegramVisitWork):TelegramVisitPlan|null{
 const {snapshot:data,input,locale}=work,flow={...work.flow,skipped:[...work.flow.skipped]},q=telegramVisitQuestion(data,flow),asked=q?questionKey(q):null;
 const plan:TelegramVisitPlan={token:work.token,flow,operation:null,questionKey:asked,error:null};
 const clear=()=>{flow.editing=null;flow.view='question';flow.comment='';};
 const act=input.action,words=input.words??'';
 if(act==='open'||act==='refresh')return plan;
 if(act==='cancel'){clear();return plan;}
 if(act==='skip'&&q&&q.kind!=='finish'&&flow.view==='question'){flow.skipped.push(questionKey(q));clear();return plan;}
 if(act==='comment'&&q?.kind==='item'&&flow.view==='question'){flow.view='comment';return plan;}
 if((act==='comment-back'||act==='comment-clear')&&flow.view==='comment'){flow.view='question';if(act==='comment-clear')flow.comment='';return plan;}
 if(act==='comment-save'&&flow.view==='comment'&&q?.kind==='item'){
  if(!plain(nurseCommentMax).safeParse(words).success)return null;
  flow.comment=words.trim();flow.view='question';return plan;
 }
 if(act.startsWith('choose:')&&flow.view!=='comment'){
  const select=chosen(data,act.slice(7));if(!select||select.kind==='finish')return null;
  flow.editing=questionKey(select);flow.view='question';flow.comment=select.kind==='item'?select.item.mark?.note??'':'';return plan;
 }
 if(act==='change'&&q?.kind==='finish'){flow.view='change';flow.editing=null;return plan;}
 if(act==='finish'&&q?.kind==='finish'){flow.view='complete';flow.editing=null;return plan;}
 if(act==='back'){clear();return plan;}
 if((act==='complete'||act==='reason')&&flow.view==='complete'){
  if(act==='reason'&&!data.items.some(item=>!item.mark?.done))return null;
  if(data.items.some(item=>!item.mark?.done)&&words.trim().length<3){plan.error='reason';return plan;}
  if(!plain(nurseCommentMax).safeParse(words).success)return null;
  plan.operation='complete';flow.skipped=[];clear();return plan;
 }
 if(flow.view!=='question'||!q)return null;
 if(act==='answer-done'&&q.kind==='step'){plan.operation='step';clear();return plan;}
 if(q.kind!=='item'||!['answer-done','answer-not-done','reading'].includes(act))return null;
 if(act==='reading'&&q.item.kind!=='measurement')return null;
 const done=act!=='answer-not-done';
 const parsed=done?parseVisitMeasurement(q.item,words,locale):{values:null,error:null};
 if(parsed.error){plan.error='measurement';return plan;}
 plan.operation='mark';plan.done=done;plan.values=parsed.values;clear();return plan;
}

/** These are the web's choices. Opaque callback references are created in SQL. */
export function nurseVisitChoices(data:NurseVisitReady,flow:TelegramVisitFlow):string[]{
 const q=telegramVisitQuestion(data,flow);if(!q)return [];
 if(flow.view==='comment')return ['comment-back','comment-clear'];
 if(flow.view==='change')return [...data.items.map(item=>`choose:${item.key}`),'back'];
 if(flow.view==='complete')return [...(data.items.some(item=>!item.mark?.done)?[]:['complete']),'back'];
 if(q.kind==='finish')return [
  ...data.items.filter(item=>!item.mark?.done||flow.skipped.includes(item.key)).map(item=>`choose:${item.key}`),
  ...flow.skipped.filter(key=>key.startsWith('step:')&&!data.steps.some(step=>`step:${step.step}`===key)).map(key=>`choose:${key}`),
  'change','finish',
 ];
 return q.kind==='step'?['answer-done','skip']:[...(q.item.kind==='measurement'?[]:['answer-done']),'answer-not-done','comment','skip'];
}

const safeData=ready.refine(data=>{
 if(!('enabled'in data)||!data.enabled)return false;
 const slots=[data.visit.memberName,data.visit.location??'',data.visit.clinic??'',...(data.items.flatMap(item=>item.kind==='check'?[item.label.en,item.label.hy,item.source]:item.kind==='sample'?[item.title]:item.kind==='device'?[item.serial,item.model]:[]))];
 return data.items.length<=120&&slots.every(slot=>plain(2000).safeParse(slot).success)&&data.items.every(item=>item.mark===null||item.mark.note===null&&item.mark.values===null)&&(!data.completion||data.completion.reason===null);
});
const error=z.union([z.enum(['measurement','reason','changed']),z.strictObject({operation:z.enum(['mark','step','complete']),status:z.string().min(1).max(40)})]).nullable();
const control=z.strictObject({action:z.string().min(1).max(180),ref});
const turnSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('visit-opening'),visit:nurseVisitRowSchema,early:z.boolean()}),
 z.strictObject({kind:z.literal('visit-list'),visits:z.array(z.object({source:z.enum(['home-request','appointment']),id:z.uuid(),memberId:z.uuid(),memberName:plain(160),startsAt:z.iso.datetime({offset:true}),intentRef:ref})).max(8)}),
 z.strictObject({kind:z.literal('visit-question'),data:safeData,flow:visitFlowSchema.refine(flow=>flow.comment===''),controls:z.array(control).max(160),error:error.optional()}),
 z.strictObject({kind:z.literal('visit-action'),nurseName:plain(160),action:z.string().max(180),questionKey:key.nullable(),item:nurseVisitItemSchema.optional(),step:z.enum(stepNames).optional()}),
 z.strictObject({kind:z.literal('visit-refused')}),
 z.strictObject({kind:z.literal('visit-pending'),operation:z.enum(['mark','step','complete']).nullable()}),
]);
function actionLabel(action:string,data:NurseVisitReady,flow:TelegramVisitFlow,l:StaffLocale):string|null{
 const copy=visitCopy(l),q=telegramVisitQuestion(data,flow),t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 if(action.startsWith('choose:')){const target=chosen(data,action.slice(7));return target?.kind==='item'?itemTitle(target.item,l):target?.kind==='step'?copy.stepButtons[target.step]:null;}
 switch(action){
  case 'answer-done':return q?.kind==='step'?copy.stepButtons[q.step]:q?.kind==='item'?q.item.kind==='sample'?copy.sampleTaken:q.item.kind==='device'?copy.deviceDone:copy.done:null;
  case 'answer-not-done':return q?.kind==='item'?q.item.kind==='measurement'?copy.measurementNotTaken:q.item.kind==='sample'?copy.notTaken:copy.notDone:null;
  case 'skip':return t('Skip for now','Առայժմ բաց թողնել','Пропустить пока');
  case 'comment':return copy.addComment;
  case 'comment-back':case 'back':return copy.goBack;
  case 'comment-clear':return t('Continue without a comment','Շարունակել առանց մեկնաբանության','Продолжить без комментария');
  case 'change':return t('Change an answer','Փոխել պատասխանը','Изменить ответ');
  case 'finish':case 'complete':return copy.completeLabel;
  default:return null;
 }
}

/** Fixed copy with bounded plain data. Never echoes a typed reading or comment. */
export function renderNurseVisitTurn(l:StaffLocale,raw:unknown):Omit<SystemTextPayload,'address'>|null{
 const parsed=turnSchema.safeParse(raw);if(!parsed.success)return null;
 const turn=parsed.data,copy=visitCopy(l),t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const text=(text:string,keyboard?:SystemTextPayload['keyboard']):Omit<SystemTextPayload,'address'>|null=>text.length>4096?null:{text,protectContent:true,...(keyboard?{keyboard}:{})};
 if(turn.kind==='visit-refused')return text(copy.changedElsewhere);
 if(turn.kind==='visit-pending')return text(`${turn.operation==='complete'?copy.notConfirmedComplete:copy.notConfirmed}\n${t('Send /resume to check this visit.','Ուղարկեք /resume՝ այս այցը ստուգելու համար։','Отправьте /resume, чтобы проверить этот визит.')}`);
 if(turn.kind==='visit-opening'){
  const v=turn.visit;
  if(![v.memberName,v.location??'',v.clinic??''].every(value=>plain(1000).safeParse(value).success))return null;
  return text([`${v.memberName} · ${v.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):v.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}`,yerevanStamp(v.startsAt,l),v.location,copy.careTeamHeading,copy.careTeamBody,turn.early&&!v.completion?copy.onDay:null].filter(Boolean).join('\n'));
 }
 if(turn.kind==='visit-list')return text(turn.visits.map((v,i)=>`${i+1}. ${v.memberName} · ${yerevanStamp(v.startsAt,l)}`).join('\n'),{kind:'callback',rows:turn.visits.map((v,i)=>[{label:String(i+1),ref:v.intentRef}])});
 if(turn.kind==='visit-action'){
  // Attribution is deliberately free of readings, comments and provider text.
  const navigation=turn.action==='change'?t('Change an answer','Փոխել պատասխանը','Изменить ответ'):['back','comment-back'].includes(turn.action)?copy.goBack:turn.action==='comment-clear'?t('Continue without a comment','Շարունակել առանց մեկնաբանության','Продолжить без комментария'):turn.action.startsWith('choose:')?turn.item?itemTitle(turn.item,l):turn.step?copy.stepButtons[turn.step]:null:null;
  const label=navigation??(turn.action==='open'?t('Open visit','Բացել այցը','Открыть визит'):turn.action==='skip'?t('Skip for now','Առայժմ բաց թողնել','Пропустить пока'):turn.action==='comment'?copy.addComment:turn.action==='finish'||turn.action==='complete'?copy.completeLabel:turn.step?copy.stepButtons[turn.step]:turn.action==='answer-not-done'?turn.item?.kind==='measurement'?copy.measurementNotTaken:turn.item?.kind==='sample'?copy.notTaken:copy.notDone:turn.item?.kind==='sample'?copy.sampleTaken:turn.item?.kind==='device'?copy.deviceDone:copy.done);
  if(turn.item?.mark&&(turn.item.mark.note!==null||turn.item.mark.values!==null))return null;
  return text(`${turn.nurseName}: ${label}${turn.item&&!turn.action.startsWith('choose:')?` · ${itemTitle(turn.item,l)}`:''}`);
 }
 const data=turn.data as NurseVisitReady,flow=turn.flow,q=telegramVisitQuestion(data,flow),open=data.items.filter(item=>!item.mark?.done),lines:string[]=[];
 if(flow.view==='comment'){
  if(q?.kind==='item')lines.push(itemTitle(q.item,l),itemDetail(q.item,l));
  lines.push(copy.commentLabel);
  if(q?.kind==='item'&&q.item.kind==='measurement')lines.push(copy.commentHelp);
  lines.push(t('Reply to this message with your comment.','Պատասխանեք այս հաղորդագրությանը ձեր մեկնաբանությամբ։','Ответьте на это сообщение комментарием.'));
 }else if(flow.view==='change')lines.push(t('Change an answer','Փոխել պատասխանը','Изменить ответ'));
 else if(flow.view==='complete'){
  lines.push(copy.completeQuestion,copy.completeExplanation);
  if(open.length)lines.push(copy.incompleteCount(open.length),...open.map(item=>itemTitle(item,l)),copy.reasonLabel,t('Reply to this message with your reason.','Պատասխանեք այս հաղորդագրությանը՝ նշելով պատճառը։','Ответьте на это сообщение, указав причину.'));
  else lines.push(copy.allDone);
 }else if(!q)lines.push(data.completion?copy.completed:copy.onDay);
 else if(q.kind==='finish')lines.push(open.length?copy.counts(open.length):copy.allItemsDone);
 else{
  lines.push(q.kind==='step'?copy.stepButtons[q.step]+(q.step==='started'?` ${copy.optional}`:''):itemTitle(q.item,l));
  if(q.kind==='item'){
   lines.push(itemDetail(q.item,l));
   if(q.item.kind==='measurement')lines.push(t('Reply to this message with your reading.','Պատասխանեք այս հաղորդագրությանը ձեր չափումով։','Ответьте на это сообщение результатом измерения.'));
  }
 }
 if(turn.error==='changed')lines.push(copy.changedElsewhere);
 else if(turn.error==='reason')lines.push(copy.reasonError);
 else if(turn.error==='measurement'&&q?.kind==='item'&&q.item.kind==='measurement')lines.push(measurementRangeError(q.item.field,l));
 else if(turn.error&&typeof turn.error==='object')lines.push(turn.error.operation==='complete'?copy.completeError(turn.error.status):turn.error.operation==='step'?copy.stepError(turn.error.status):copy.markError(turn.error.status));
 const allowed=nurseVisitChoices(data,flow),buttons:{label:string;ref:string}[]=[],numbered:string[]=[];
 for(const control of turn.controls){
  if(!allowed.includes(control.action))return null;
  let label=actionLabel(control.action,data,flow,l);if(!label)return null;
  // The source's long safety wording belongs to the list, not a truncated chip.
  if(control.action.startsWith('choose:')){numbered.push(`${numbered.length+1}. ${label}`);label=String(numbered.length);}
  if(label.length>64)return null;
  buttons.push({label,ref:control.ref});
 }
 lines.push(...numbered);
 const rows:typeof buttons[]=[];
 const width=Math.max(1,Math.ceil(buttons.length/8));
 for(let i=0;i<buttons.length;i+=width)rows.push(buttons.slice(i,i+width));
 const takesWords=flow.view==='comment'||flow.view==='complete'&&open.length>0||flow.view==='question'&&q?.kind==='item'&&q.item.kind==='measurement';
 return text(lines.join('\n'),rows.length?{kind:'callback',rows,...(takesWords?{forceReply:true}:{})}:takesWords?{kind:'force_reply'}:undefined);
}
