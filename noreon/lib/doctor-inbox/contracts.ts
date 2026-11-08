import {isUnverifiedBp,unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import {pick,type Locale} from '@/lib/locale';
import {z} from 'zod';
import {careAlertSchema} from '@/lib/care-alerts/contracts';
import {zoeAnsweredItemSchema} from './zoe-answered';
import {nurseReplyViewSchema} from '@/lib/nurse-chat/contracts';

/**
 * The doctor's four-lane inbox (doctor_ai_inbox; output/doctor-ai-inbox/DESIGN.md). The database decides who sees
 * what and when an item closes; this file only parses, orders and words it. Nothing here removes an item.
 */
export const lanes=['P0','P1','P2','P3']as const;
export type Lane=typeof lanes[number];
export const itemKinds=['lab_attention','lab_sheet','checkin_worse','checkpoint_due','plan_draft','intake','reply_overdue','reply_not_delivered','reply_draft','bp_repeat_pending']as const;
export type ItemKind=typeof itemKinds[number];
/** rule: code decided it and no model was involved; H: facts from code, the model at most words them; M: the model reasons over facts; L: no usable AI help. */
export const confidences=['rule','H','M','L']as const;
export type Confidence=typeof confidences[number];

const source=z.object({type:z.string(),ref:z.string(),rule:z.string().nullable().optional(),seq:z.number().nullable().optional(),page:z.number().nullable().optional()});
const base={id:z.string(),memberId:z.uuid(),memberName:z.string(),at:z.string(),rank:z.number().int(),confidence:z.enum(confidences),
 ai:z.enum(['none','values','summary','draft','protocol']),sources:z.array(source)};
export const alertItemSchema=z.object({...base,lane:z.literal('P0'),kind:z.literal('care_alert'),alert:careAlertSchema});
/**
 * The pending reply draft on a reply item (#323 structured drafts carry their sources). approvable is the database's
 * word that the inbox may offer one-tap Approve: structured, current, quoting the still-published plan, no doctor
 * judgement needed, and no unresolved care alert for the member. The approval itself is re-checked by
 * conversation_actions and conversation_command and is bound to revision and contentHash.
 */
export const inboxDraftSchema=z.object({draftId:z.uuid(),revision:z.number().int(),body:z.string(),contentHash:z.string(),author:z.enum(['staff','ai_assistant']),
 structured:z.boolean(),stale:z.boolean(),planCurrent:z.boolean(),openAlert:z.boolean(),asked:z.string().nullable(),acknowledgementId:z.string().nullable(),
 needsJudgement:z.boolean(),outsidePlan:z.boolean(),judgementReasons:z.array(z.string()),doctorDecides:z.array(z.string()),approvable:z.boolean()});
export type InboxDraft=z.infer<typeof inboxDraftSchema>;
export const inboxItemSchema=z.object({...base,lane:z.enum(['P1','P2','P3']),kind:z.enum(itemKinds),
 fileId:z.uuid().optional(),toReview:z.number().int().optional(),flagged:z.number().int().optional(),critical:z.number().int().optional(),
 checkpointId:z.uuid().optional(),checkpointKind:z.string().optional(),dueOn:z.string().optional(),overdue:z.boolean().optional(),medicines:z.string().nullable().optional(),
 generationId:z.uuid().optional(),stale:z.boolean().optional(),
 intakeId:z.uuid().optional(),sheetId:z.string().optional(),ending:z.string().nullable().optional(),redFlags:z.number().int().optional(),
 entrySource:z.string().nullable().optional(),systolic:z.number().int().optional(),diastolic:z.number().int().optional(),
 unanswered:z.number().int().optional(),channel:z.string().nullable().optional(),delivery:z.string().nullable().optional(),draft:inboxDraftSchema.optional()});
export const doctorInboxSchema=z.object({version:z.literal('doctor-inbox-v1'),ok:z.literal(true),asOf:z.string(),
 p0:z.array(alertItemSchema),p0Total:z.number().int(),items:z.array(inboxItemSchema),laneCap:z.number().int(),unavailable:z.array(z.string()),
 // Part 2 (20261020060842): threads Zoe fully answered, not reviewed yet. Absent from an older database: empty.
 zoeAnswered:z.array(zoeAnsweredItemSchema).default([]),zoeAnsweredTotal:z.number().int().default(0),
 // Activity only: nurse sends never close or replace clinical inbox work.
 nurseActivity:z.array(nurseReplyViewSchema.extend({memberId:z.uuid(),memberName:z.string()})).default([])});
export type AlertItem=z.infer<typeof alertItemSchema>;
export type InboxItem=z.infer<typeof inboxItemSchema>;
export type DoctorInbox=z.infer<typeof doctorInboxSchema>;

type Orderable={lane:Lane;rank:number;at:string;id:string};
/** Lane, then risk rank, then age (oldest first), then id. The same order as doctor_ai_inbox; P0 can never sort after another lane. */
export function compareItems(a:Orderable,b:Orderable){
 return lanes.indexOf(a.lane)-lanes.indexOf(b.lane)||a.rank-b.rank||Date.parse(a.at)-Date.parse(b.at)||(a.id<b.id?-1:a.id>b.id?1:0);
}
/** Open urgent alerts for the chat and the alert views (Armen's QA, 4 Nov: with many open alerts the newest one sat far down the oldest-first list).
 * Open before acknowledged; then what the member wrote or Zoe saw before questionnaire and lab alerts; then the most recent activity first. Nothing is removed. */
const ALERT_SOURCE_ORDER:Record<string,number>={zoe:0,message:0};
export function orderAlerts<T extends {lane:Lane;rank:number;id:string;alert:{source:string;lastSeenAt:string;createdAt:string}}>(items:readonly T[]):T[]{
 const seen=(i:T)=>Date.parse(i.alert.lastSeenAt)||Date.parse(i.alert.createdAt)||0;
 return [...items].sort((a,b)=>a.rank-b.rank||(ALERT_SOURCE_ORDER[a.alert.source]??1)-(ALERT_SOURCE_ORDER[b.alert.source]??1)||seen(b)-seen(a)||(a.id<b.id?-1:a.id>b.id?1:0));
}
export function orderInbox<T extends Orderable>(items:readonly T[]):T[]{return [...items].sort(compareItems);}

/** Items grouped by lane in order. P0 is always the first group, present even when empty, so the doctor sees it was checked. */
export function laneGroups(inbox:Pick<DoctorInbox,'p0'|'items'>){
 const rest=orderInbox(inbox.items);
 return {P0:orderInbox(inbox.p0),P1:rest.filter(i=>i.lane==='P1'),P2:rest.filter(i=>i.lane==='P2'),P3:rest.filter(i=>i.lane==='P3')};
}

export type L=Locale;
const t=(l:L,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
export const laneTitle=(lane:Lane,l:L)=>({P0:t(l,'Now','Հիմա','Сейчас'),P1:t(l,'Today','Այսօր','Сегодня'),P2:t(l,'This week','Այս շաբաթ','На этой неделе'),P3:t(l,'Routine','Ընթացիկ','Плановые')}[lane]);
export const laneEmpty=(lane:Lane,l:L)=>({P0:t(l,'No open alerts.','Բաց ահազանգեր չկան։','Открытых оповещений нет.'),P1:t(l,'Nothing for today.','Այսօրվա համար ոչինչ չկա։','На сегодня ничего нет.'),
 P2:t(l,'Nothing for this week.','Այս շաբաթվա համար ոչինչ չկա։','На эту неделю ничего нет.'),P3:t(l,'No routine items.','Ընթացիկ գործեր չկան։','Плановых задач нет.')}[lane]);
export const confidenceLabel=(c:Confidence,l:L)=>({rule:t(l,'Rule, no AI','Կանոն, առանց AI','Правило, без ИИ'),H:t(l,'AI confidence high','AI վստահություն՝ բարձր','Высокая уверенность ИИ'),
 M:t(l,'AI confidence medium: read it','AI վստահություն՝ միջին, կարդացեք','Средняя уверенность ИИ: прочитайте'),L:t(l,'Reply needs your wording','Պատասխանը ձեր ձևակերպման կարիքն ունի','Ответ нужно написать вам')}[c]);
export const aiLabel=(a:InboxItem['ai'],l:L)=>({none:t(l,'No AI','Առանց AI','Без ИИ'),values:t(l,'Values read by AI, checked in code','Արժեքները կարդացել է AI, ստուգվել են կոդով','Значения прочитаны ИИ и проверены программно'),
 summary:t(l,'Summary built by code from the answers','Ամփոփումը կազմվել է կոդով՝ պատասխաններից','Сводка составлена программно по ответам'),draft:t(l,'Draft prepared by AI','Նախագիծը պատրաստել է AI','Черновик подготовлен ИИ'),
 protocol:t(l,'Protocol draft, no model','Արձանագրային նախագիծ, առանց մոդելի','Черновик по протоколу, без модели')}[a]);

const checkpointName=(k:string|undefined,l:L)=>k==='week4_review'?t(l,'Week 4 review','4-րդ շաբաթի վերանայում','Обзор на 4-й неделе'):k==='month3'?t(l,'Month 3 review','3-րդ ամսվա վերանայում','Обзор на 3-м месяце'):k==='month6'?t(l,'Month 6 review','6-րդ ամսվա վերանայում','Обзор на 6-м месяце'):t(l,'Programme review','Ծրագրի վերանայում','Обзор программы');
const judgementLine=(l:L,overdue:boolean)=>overdue
 ?t(l,'Question that needs your judgement, waiting more than 24 hours','Հարց, որը պահանջում է ձեր որոշումը, սպասում է ավելի քան 24 ժամ','Вопрос требует вашего решения и ожидает более 24 часов')
 :t(l,'Question that needs your judgement: Zoe drafted a reply that defers to you','Հարց, որը պահանջում է ձեր որոշումը։ Զոյան պատրաստել է պատասխան, որը թողնում է որոշումը ձեզ','Вопрос требует вашего решения: Зоя подготовила ответ, оставляющий решение за вами');
/** One line saying what happened, from codes and counts only. */
export function itemSummary(i:InboxItem,l:L):string{
 switch(i.kind){
  case 'lab_attention':return i.critical
   ?t(l,`Lab marked ${i.critical} value${i.critical===1?'':'s'} critical; ${i.toReview} to confirm`,`Լաբորատորիան ${i.critical} արժեք նշել է կրիտիկական, ${i.toReview}-ը՝ հաստատելու`,`Лаборатория отметила критические значения: ${i.critical}; на подтверждение: ${i.toReview}`)
   :t(l,`${i.flagged} value${i.flagged===1?'':'s'} need${i.flagged===1?'s':''} your attention; ${i.toReview} to confirm`,`${i.flagged} արժեք պահանջում է ձեր ուշադրությունը, ${i.toReview}-ը՝ հաստատելու`,`Требуют вашего внимания: ${i.flagged}; на подтверждение: ${i.toReview}`);
  case 'lab_sheet':return t(l,`Lab sheet: ${i.toReview} value${i.toReview===1?'':'s'} to confirm, none flagged`,`Լաբորատոր թերթիկ՝ ${i.toReview} արժեք հաստատելու, նշված չկա`,`Лабораторный бланк: на подтверждение ${i.toReview}, отмеченных значений нет`);
  case 'checkin_worse':return t(l,`${checkpointName(i.checkpointKind,l)}: member says they feel worse`,`${checkpointName(i.checkpointKind,l)}․ անդամն ասում է, որ իրեն ավելի վատ է զգում`,`${checkpointName(i.checkpointKind,l)}: участник сообщает об ухудшении самочувствия`);
  case 'checkpoint_due':return i.overdue?t(l,`${checkpointName(i.checkpointKind,l)} overdue since ${i.dueOn}`,`${checkpointName(i.checkpointKind,l)}՝ ժամկետանց ${i.dueOn}-ից`,`${checkpointName(i.checkpointKind,l)}: срок истёк ${i.dueOn}`)
   :t(l,`${checkpointName(i.checkpointKind,l)} due ${i.dueOn}`,`${checkpointName(i.checkpointKind,l)}՝ մինչև ${i.dueOn}`,`${checkpointName(i.checkpointKind,l)}: срок ${i.dueOn}`);
  case 'plan_draft':return i.stale?t(l,'Care plan draft ready, but the evidence changed since: prepare it again','Բուժման պլանի նախագիծը պատրաստ է, բայց տվյալները փոխվել են, պատրաստեք նորից','Черновик плана лечения готов, но данные изменились: подготовьте его заново')
   :t(l,'Care plan draft ready for your review','Բուժման պլանի նախագիծը պատրաստ է ձեր վերանայման համար','Черновик плана лечения готов к вашему рассмотрению');
  case 'intake':return i.redFlags?t(l,`Symptom questions finished with ${i.redFlags} red flag${i.redFlags===1?'':'s'}`,`Ախտանիշների հարցերն ավարտվել են ${i.redFlags} կարմիր դրոշով`,`Вопросы о симптомах завершены. Красных флагов: ${i.redFlags}`)
   :t(l,'Symptom questions finished: summary ready','Ախտանիշների հարցերն ավարտվել են, ամփոփումը պատրաստ է','Вопросы о симптомах завершены: сводка готова');
  case 'reply_overdue':if(i.draft?.needsJudgement||i.draft?.outsidePlan)return judgementLine(l,true);return t(l,'Waiting for your reply for more than 24 hours','Ձեր պատասխանին սպասում է ավելի քան 24 ժամ','Ожидает вашего ответа более 24 часов');
  case 'bp_repeat_pending':return t(l,`Very high reading ${i.systolic}/${i.diastolic}, repeat pending`,`Շատ բարձր չափում ${i.systolic}/${i.diastolic}, սպասվում է կրկնակի չափում`,`Очень высокое измерение ${i.systolic}/${i.diastolic}, ожидается повторное`)+(isUnverifiedBp(i)?` · ${unverifiedBpLabel(l)}`:'');
  case 'reply_not_delivered':return t(l,'Your last reply did not reach the member','Ձեր վերջին պատասխանը չի հասել անդամին','Ваш последний ответ не дошёл до участника');
  case 'reply_draft':if(i.draft?.needsJudgement||i.draft?.outsidePlan)return judgementLine(l,false);return t(l,'Waiting for your reply','Սպասում է ձեր պատասխանին','Ожидает вашего ответа');
 }
}

export type InboxAction={label:string;href:string};
/** The first button. A low confidence or a stale draft never offers Approve: it opens the editor instead. */
export function primaryAction(i:InboxItem,l:L):InboxAction{
 const member=`/staff/real/members/${i.memberId}`,conversation=`/staff/real/conversations/${i.memberId}`;
 switch(i.kind){
  case 'lab_attention':case 'lab_sheet':return {label:t(l,'Review values','Վերանայել արժեքները','Проверить значения'),href:`${member}/documents/${i.fileId}/check`};
  case 'checkin_worse':case 'checkpoint_due':return {label:t(l,'Open review','Բացել վերանայումը','Открыть обзор'),href:member};
  case 'plan_draft':return {label:i.stale?t(l,'Prepare again','Պատրաստել նորից','Подготовить заново'):t(l,'Review plan draft','Վերանայել պլանի նախագիծը','Рассмотреть черновик плана лечения'),href:member};
  case 'intake':return {label:t(l,'Read summary and reply','Կարդալ ամփոփումը և պատասխանել','Прочитать сводку и ответить'),href:conversation};
  case 'bp_repeat_pending':return {label:t(l,'Open member','Բացել անդամին','Открыть участника'),href:member};
  case 'reply_not_delivered':return {label:t(l,'Open conversation','Բացել զրույցը','Открыть разговор'),href:conversation};
  case 'reply_overdue':case 'reply_draft':return i.ai==='draft'&&(i.confidence==='H'||i.confidence==='M')
   ?{label:t(l,'Approve, edit or reject draft','Հաստատել, խմբագրել կամ մերժել նախագիծը','Утвердить, изменить или отклонить черновик'),href:conversation}
   :{label:t(l,'Write reply','Գրել պատասխան','Написать ответ'),href:conversation};
 }
}

/**
 * The draft buttons on a reply item. Approve appears only when the database says the draft is approvable; Edit always
 * opens the existing reply editor (prefilled with the pending draft); Reject is offered for any pending AI draft.
 * A draft that needs judgement, is stale or quotes a replaced plan leads with Edit.
 */
export function draftActions(i:Pick<InboxItem,'draft'|'confidence'>){
 const d=i.draft;
 if(!d)return {approve:false,edit:false,reject:false,lead:'none'as const};
 const approve=d.approvable&&i.confidence!=='L';
 return {approve,edit:true,reject:d.author==='ai_assistant'||d.structured,lead:approve?'approve'as const:'edit'as const};
}

/** Why the inbox does not offer one-tap Approve for this draft, in one line; null when it does. */
export function notApprovableReason(d:InboxDraft,l:L):string|null{
 if(d.approvable)return null;
 if(d.openAlert)return t(l,'This member has an open alert. Deal with it under Now first; approve the reply from the conversation.','Այս անդամն ունի բաց ահազանգ։ Նախ զբաղվեք դրանով «Հիմա» բաժնում, պատասխանը հաստատեք զրույցից։','У этого участника есть открытое оповещение. Сначала разберитесь с ним в разделе «Сейчас»; утвердите ответ в разговоре.');
 if(d.stale)return t(l,'New messages or evidence arrived after this draft. Open it to review the current version.','Նախագծից հետո նոր հաղորդագրություններ կամ տվյալներ են ստացվել։ Բացեք այն՝ ընթացիկ տարբերակը վերանայելու համար։','После подготовки черновика поступили новые сообщения или данные. Откройте его, чтобы проверить текущую версию.');
 if(d.structured&&!d.planCurrent)return t(l,'The care plan this draft quotes has been replaced. Edit it before sending.','Նախագծում մեջբերված բուժման պլանը փոխարինվել է։ Խմբագրեք այն ուղարկելուց առաջ։','План лечения, на который ссылается черновик, заменён. Измените ответ перед отправкой.');
 if(d.needsJudgement||d.outsidePlan)return t(l,'Only you can decide this. Edit the reply to give your answer.','Սա կարող եք որոշել միայն դուք։ Խմբագրեք պատասխանը՝ ձեր որոշումը գրելու համար։','Только вы можете это решить. Измените ответ, чтобы изложить своё решение.');
 if(!d.structured)return t(l,'This draft was not built from the care plan. Review it in the conversation.','Այս նախագիծը կազմված չէ բուժման պլանից։ Վերանայեք այն զրույցում։','Этот черновик составлен без опоры на план лечения. Рассмотрите его в разговоре.');
 return t(l,'Review this draft in the conversation.','Վերանայեք այս նախագիծը զրույցում։','Рассмотрите этот черновик в разговоре.');
}

/** Fixed reasons for rejecting a reply draft (conversation_draft_reject_reason). "other" needs a note. */
export const rejectReasons=['incorrect','unsafe','not_answered','tone_or_language','prefer_own_words','plan_changed','other']as const;
export type RejectReason=typeof rejectReasons[number];
export const rejectReasonLabel=(r:RejectReason,l:L)=>({incorrect:t(l,'Clinically wrong or inaccurate','Կլինիկապես սխալ է կամ ոչ ճշգրիտ','Клинически неверно или неточно'),unsafe:t(l,'Unsafe to send','Ուղարկելը վտանգավոր է','Отправлять небезопасно'),
 not_answered:t(l,'Does not answer the question','Չի պատասխանում հարցին','Не отвечает на вопрос'),tone_or_language:t(l,'Tone or language is wrong','Ոճը կամ լեզուն սխալ է','Неподходящий тон или язык'),
 prefer_own_words:t(l,'I will write my own reply','Կգրեմ իմ սեփական պատասխանը','Напишу собственный ответ'),plan_changed:t(l,'The plan or situation changed','Պլանը կամ իրավիճակը փոխվել է','План лечения или ситуация изменились'),
 other:t(l,'Other (add a note)','Այլ (ավելացրեք նշում)','Другое (добавьте примечание)')}[r]);
