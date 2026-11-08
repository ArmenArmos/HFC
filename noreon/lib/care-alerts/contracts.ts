import {pick,type Locale} from '@/lib/locale';
import {z} from 'zod';
import {BP_SOON} from '@/lib/clinical/rules/bp-words';
import {THRESHOLD} from '@/lib/clinical/rules/thresholds';

type Env=Record<string,string|undefined>;
/**
 * Dark by default: the staff Alerts inbox and the member-message screening step exist only
 * when this is exactly "true". Raising in the database is a separate switch
 * (care_alert_settings.enabled), and Telegram notices to staff a third
 * (care_alert_settings.telegram_delivery) whose wording is an unapproved placeholder.
 */
export const careAlertsEnabled=(env:Env=process.env)=>env.NOREON_CARE_ALERTS_ENABLED==='true';

export const alertSources=['questionnaire','message','lab','zoe','reading']as const;
export const alertResolutions=['member_contacted','emergency_care_advised','no_action_needed','duplicate','other']as const;
/** What staff may pick when they close an alert. 'duplicate' is history only: a repeat is linked to the open alert and both stay visible, never closed as a duplicate (Armen's audit, 4 Nov, S0-2). */
export const closeResolutions=['member_contacted','emergency_care_advised','no_action_needed','other']as const;
export type AlertSource=typeof alertSources[number];
export type AlertResolution=typeof alertResolutions[number];
const redFlag=z.string().regex(/^RF-(0[1-9]|1[0-2])$/);

export const careAlertSchema=z.object({
 id:z.uuid(),memberId:z.uuid(),memberName:z.string(),source:z.enum(alertSources),priority:z.literal('urgent'),reason:z.string(),redFlags:z.array(redFlag),
 state:z.enum(['open','acknowledged','resolved']),stateSeq:z.number().int(),occurrences:z.number().int().positive(),createdAt:z.string(),lastSeenAt:z.string(),lastReason:z.string().nullable().optional(),
 doctorName:z.string().nullable(),acknowledgedAt:z.string().nullable(),acknowledgedBy:z.string().nullable(),resolvedAt:z.string().nullable(),resolvedBy:z.string().nullable(),
 resolution:z.enum(alertResolutions).nullable(),resolutionNote:z.string().nullable(),
 primaryOwnerName:z.string().nullable().optional(),primaryOwnerRole:z.enum(['nurse','doctor']).nullable().optional(),
 ownerName:z.string().nullable().optional(),ownerRole:z.enum(['nurse','doctor']).nullable().optional(),
 escalatedDoctorName:z.string().nullable().optional(),
 nextAction:z.string().nullable().optional(),nextActionDueAt:z.string().nullable().optional(),nextActionBy:z.string().nullable().optional(),nextActionAt:z.string().nullable().optional(),
 telegram:z.array(z.object({recipient:z.string(),state:z.string(),reason:z.string().nullable()})),
 /** Set when the alert stayed open past its route's wait and went to the backup role (null: not escalated). */
 escalatedAt:z.string().nullable().optional(),escalatedTo:z.enum(['doctor','nurse']).nullable().optional(),
 bpEpisodes:z.array(z.object({id:z.uuid(),measurementIds:z.array(z.uuid()),taskIds:z.array(z.uuid()),noteIds:z.array(z.uuid())})).optional(),
});
export type CareAlert=z.infer<typeof careAlertSchema>;
export const careAlertInboxSchema=z.object({ok:z.literal(true),asOf:z.string(),role:z.enum(['admin','doctor']),alerts:z.array(careAlertSchema)});
export const careAlertCommandSchema=z.union([z.object({ok:z.literal(true),changed:z.boolean(),alert:careAlertSchema}),z.object({ok:z.literal(false),code:z.string(),alert:careAlertSchema.optional()})]);

export const alertReasons=['bp_doctor_today','bp_doctor_48h','questionnaire_red_flag','questionnaire_red_flag_cleared','questionnaire_unknown_rule','urgent_words_matched','zoe_urgent_route','zoe_refused_103','zoe_self_harm','lab_result_critical','no_assigned_doctor_admins_alerted'] as const;

type L=Locale;
const t=(l:L,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
/** The closer is recorded with the resolution; the doctor sees whose name that is before choosing. */
export const closingAsLabel=(name:string,l:L,outcome?:string)=>t(l,`Closing as ${name}`,`Փակվում է ${name}-ի անունով`,`Закрывается от имени: ${name}`)+(outcome?` · ${outcome}`:'');
export const sourceLabel=(s:AlertSource,l:L)=>({
 questionnaire:t(l,'Questionnaire answer','Հարցաշարի պատասխան','Ответ в анкете'),message:t(l,'Member message','Անդամի հաղորդագրություն','Сообщение участника'),
 lab:t(l,'Lab result','Լաբորատոր արդյունք','Результат анализа'),zoe:t(l,'Zoe conversation','Զրույց Զոյայի հետ','Разговор с Зоей'),
 reading:t(l,'Saved blood pressure reading','Պահված ճնշման չափում','Сохранённое измерение давления'),
}[s]);
/** Why it was raised, in words. Red flag ids stay as the clinical team's identifiers (staff only). */
export function alertReason(a:Pick<CareAlert,'reason'|'redFlags'>,l:L){
 const flags=a.redFlags.join(', ');
 switch(a.reason){
  // STAGING wording. The one BP check (lib/clinical/rules/bp-check.ts): a repeat, or a reading a nurse or doctor entered.
  case 'bp_doctor_today':{const bp=`${THRESHOLD.bpDoctorTodaySystolic}/${THRESHOLD.bpDoctorTodayDiastolic}`;return t(l,`Blood pressure ${bp} or more: a doctor today`,`Ճնշում ${bp} կամ ավելի. բժիշկ այսօր`,`Давление ${bp} или выше: врач сегодня`);}
  case 'bp_doctor_48h':{const bp=`${THRESHOLD.crisisSystolic}/${THRESHOLD.crisisDiastolic}`;return t(l,`Blood pressure ${bp} or more: a doctor ${BP_SOON.en}`,`Ճնշում ${bp} կամ ավելի. բժիշկ ${BP_SOON.hy}`,`Давление ${bp} или выше: врач ${BP_SOON.ru}`);}
  case 'questionnaire_red_flag':return t(l,`Red flag ${flags} in the questionnaire`,`Կարմիր դրոշ ${flags} հարցաշարում`,`Красный флаг ${flags} в анкете`);
  case 'questionnaire_red_flag_cleared':return t(l,`Member changed a red flag answer (${flags}); the red flag cleared`,`Անդամը փոխել է կարմիր դրոշի պատասխանը (${flags}), կարմիր դրոշը հանվել է`,`Участник изменил ответ с красным флагом (${flags}); красный флаг снят`);
  case 'questionnaire_unknown_rule':return t(l,'An urgent questionnaire rule the inbox does not recognise','Հարցաշարի անհայտ շտապ կանոն','Срочное правило анкеты, которое не распознано во входящих');
  // Some urgent words carry no red flag id (self-harm, poisoning, severe bleeding): the plain sentence, no empty brackets.
  case 'urgent_words_matched':return t(l,`Message matched the urgent word list${flags?` (${flags})`:''}`,`Հաղորդագրությունը համընկավ շտապ բառացանկի հետ${flags?` (${flags})`:''}`,`Сообщение совпало со списком срочных слов${flags?` (${flags})`:''}`);
  // FB-01: every urgent route in Zoe raises an alert; a refusal of 103 or self-harm keeps its own reason.
  case 'zoe_urgent_route':return t(l,`Zoe told the member to call 103 (${flags || 'urgent words'})`,`Զոյան անդամին ասել է զանգահարել 103 (${flags || 'շտապ բառեր'})`,`Зоя рекомендовала участнику позвонить 103 (${flags || 'срочные слова'})`);
  case 'zoe_refused_103':return t(l,'Member refused to call 103 after Zoe\'s urgent advice','Անդամը հրաժարվել է զանգահարել 103 Զոյայի շտապ խորհրդից հետո','Участник отказался звонить 103 после срочной рекомендации Зои');
  case 'zoe_self_harm':return t(l,'Member wrote about self-harm or suicide. Zoe gave the crisis text and 103','Անդամը գրել է ինքնավնասման կամ ինքնասպանության մասին։ Զոյան տվել է ճգնաժամային տեքստը և 103','Участник написал о самоповреждении или суициде. Зоя отправила кризисный текст и номер 103');
  case 'lab_result_critical':return t(l,'Lab result flagged critical','Լաբորատոր արդյունքը նշված է որպես կրիտիկական','Результат анализа отмечен как критический');
  case 'no_assigned_doctor_admins_alerted':return t(l,'No assigned doctor; admins alerted','Նշանակված բժիշկ չկա, ծանուցվել են ադմինները','Врач не назначен; администраторы уведомлены');
  default:return a.reason.replaceAll(/[_.:-]+/g,' ');
 }
}
export const resolutionLabel=(r:AlertResolution,l:L)=>({
 member_contacted:t(l,'Member contacted','Կապ է հաստատվել անդամի հետ','С участником связались'),emergency_care_advised:t(l,'Emergency care advised','Խորհուրդ է տրվել շտապ օգնություն','Рекомендована экстренная помощь'),
 no_action_needed:t(l,'No action needed','Գործողություն չի պահանջվում','Действия не требуются'),duplicate:t(l,'Duplicate','Կրկնօրինակ','Дубликат'),other:t(l,'Other (see note)','Այլ (տե՛ս նշումը)','Другое (см. примечание)'),
}[r]);
/** Telegram notice states as staff should read them: never "read", at most "delivered to Telegram". */
export const noticeLabel=(state:string,l:L)=>({
 queued:t(l,'Queued','Հերթում է','В очереди'),held:t(l,'Held, not sent','Պահված է, չի ուղարկվել','Приостановлено, не отправлено'),sending:t(l,'Sending','Ուղարկվում է','Отправляется'),
 accepted_by_provider:t(l,'Delivered to Telegram','Հանձնվել է Telegram-ին','Доставлено в Telegram'),definitely_failed:t(l,'Not delivered','Չի հանձնվել','Не доставлено'),unknown:t(l,'Delivery unknown','Հանձնումն անհայտ է','Статус доставки неизвестен'),
}[state]??state);
