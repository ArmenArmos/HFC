import {bpUnit} from '@/lib/bp-unit';
import {unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import {pick,type Locale} from '@/lib/locale';
import {queueForTask,slaDeadline,type ZoneResult} from '@/lib/clinical/zones/evaluate';
import {z} from 'zod';

export const careQueues=['nurse','physician','admin']as const;
export const careQueueZones=['yellow','orange','red']as const;
export const careQueueStatuses=['sent','seen','answered','closed']as const;
export const redFlagsStatuses=['cleared','unknown','positive']as const;
/** The only words an admin task may use. Same list as the care_queue_tasks table checks. */
export const logisticsReasons=['lab_booking_needed','lab_reschedule','fasting_failed','lab_no_show','missing_baseline_labs','followup_labs_due','medicine_access_help']as const;
export const logisticsActions=['rebook','book']as const;
export type CareQueue=typeof careQueues[number];
export type CareQueueZone=typeof careQueueZones[number];
export type CareQueueStatus=typeof careQueueStatuses[number];
export type RedFlagsStatus=typeof redFlagsStatuses[number];
export type LogisticsReason=typeof logisticsReasons[number];
export type LogisticsAction=typeof logisticsActions[number];

const code=z.string().regex(/^[a-z0-9_.:-]{1,80}$/);
const queue=z.enum(careQueues),zone=z.enum(careQueueZones),status=z.enum(careQueueStatuses),redFlagsStatus=z.enum(redFlagsStatuses);

/** One care_queue_raise call. The database enforces the same rules and answers {ok:false,code}. */
export const careQueueRaiseSchema=z.object({
 memberId:z.uuid(),queue,zone:zone.nullable(),reason:code,ruleVersion:z.string().min(1).max(80),redFlagsStatus:redFlagsStatus.nullable(),
 suggestedAction:code.nullable(),summary:z.record(z.string(),z.unknown()),slaDeadline:z.string().nullable(),sourceRef:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
}).refine(r=>(r.queue==='admin')===(r.zone===null)&&(r.queue==='admin'||r.slaDeadline!==null)&&(r.queue!=='admin'||(Object.keys(r.summary).length===0&&r.redFlagsStatus===null
  &&(logisticsReasons as readonly string[]).includes(r.reason)&&(r.suggestedAction===null||(logisticsActions as readonly string[]).includes(r.suggestedAction)))));
export type CareQueueRaise=z.infer<typeof careQueueRaiseSchema>;

export const careQueueTaskSchema=z.object({
 id:z.uuid(),memberId:z.uuid(),memberName:z.string(),queue,zone:zone.nullable(),reason:z.string(),ruleVersion:z.string(),redFlagsStatus:redFlagsStatus.nullable(),
 suggestedAction:z.string().nullable(),summary:z.record(z.string(),z.unknown()),slaDeadline:z.string().nullable(),status,stateSeq:z.number().int(),sandbox:z.boolean(),createdAt:z.string(),
 seenAt:z.string().nullable(),answeredAt:z.string().nullable(),
});
export type CareQueueTask=z.infer<typeof careQueueTaskSchema>;
export const careQueueInboxSchema=z.object({ok:z.literal(true),asOf:z.string(),role:z.enum(['nurse','doctor','admin']),tasks:z.array(careQueueTaskSchema)});
export const careQueueRaiseResultSchema=z.union([z.object({ok:z.literal(true),replayed:z.boolean(),task:careQueueTaskSchema}),z.object({ok:z.literal(false),code:z.string()})]);
/** A mark never returns a snapshot, so these stay strict. No task at all (invalid, not_found) leaves only ok and code. */
const markedTask={id:z.uuid(),status,stateSeq:z.number().int()};
export const careQueueMarkResultSchema=z.union([z.strictObject({ok:z.literal(true),code:z.enum(['moved','unchanged']),...markedTask}),z.strictObject({ok:z.literal(false),code:z.string(),...z.object(markedTask).partial().shape})]);
/** The member's chip: nothing about why, only where the task is. strictObject so a new field fails loudly. */
export const careQueueMemberTaskSchema=z.strictObject({id:z.uuid(),queue:z.enum(['nurse','physician']),status,slaDeadline:z.string().nullable(),createdAt:z.string(),mergedIntoAlertId:z.uuid().optional()});
export const careQueueMemberTasksSchema=z.object({ok:z.literal(true),tasks:z.array(careQueueMemberTaskSchema)});

export type TaskInput={
 memberId:string;sourceRef:string;
 /** When the zone was decided, as an ISO instant. The deadline counts from here. */
 at:string;
 redFlagsStatus?:RedFlagsStatus|null;suggestedAction?:string|null;
 /** Structured snapshot for clinical queues. It never reaches the admin. */
 summary?:Record<string,unknown>;
 /** Logistics work for the admin. Replaces the clinical task: the reason here is the only reason the admin gets. */
 logistics?:{reason:LogisticsReason;suggestedAction?:LogisticsAction|null};
};

/** Zone rules name some reasons in camelCase (bp_symptom_chestPain); reason_code is lower case. */
export const reasonCode=(reason:string)=>reason.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`);

/**
 * Turns a zone decision into raise calls, one per queue. No zone, or green, raises nothing. Logistics
 * go to the admin alone, with no zone, deadline or snapshot, so nothing clinical can reach that queue.
 * Whether a provisional zone should raise yet is the caller's decision.
 */
export function taskFromZone(result:ZoneResult,input:TaskInput):CareQueueRaise[]{
 const base={memberId:input.memberId,ruleVersion:result.ruleVersion,sourceRef:input.sourceRef};
 if(input.logistics){
  const {reason,suggestedAction=null}=input.logistics;
  return queueForTask('logistics').map(queue=>({...base,queue,zone:null,reason,redFlagsStatus:null,suggestedAction,summary:{},slaDeadline:null}));
 }
 if(result.zone===null||result.zone==='green')return [];
 const {zone}=result,reasons=result.reasons.map(reasonCode);
 return result.queues.filter(queue=>queue!=='admin').map(queue=>({...base,queue,zone,reason:reasons[0],redFlagsStatus:input.redFlagsStatus??null,suggestedAction:input.suggestedAction??null,
  summary:{...input.summary,reasons},slaDeadline:slaDeadline(result,input.at)}));
}

export const queueForRole=(role:string):CareQueue|null=>role==='nurse'?'nurse':role==='doctor'?'physician':role==='admin'?'admin':null;
export const isOverdue=(task:Pick<CareQueueTask,'slaDeadline'>,asOf:string)=>task.slaDeadline!==null&&new Date(task.slaDeadline).getTime()<new Date(asOf).getTime();

const t=(l:Locale,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
export const zoneLabel=(z:CareQueueZone,l:Locale)=>({
 yellow:t(l,'Yellow','Դեղին','Жёлтая'),orange:t(l,'Orange','Նարնջագույն','Оранжевая'),red:t(l,'Red','Կարմիր','Красная'),
}[z]);
export const statusLabel=(s:CareQueueStatus,l:Locale)=>({
 sent:t(l,'New','Նոր','Новая'),seen:t(l,'Seen','Տեսած','Просмотрена'),answered:t(l,'Answered','Պատասխանված','Отвечена'),closed:t(l,'Closed','Փակված','Закрыта'),
}[s]);
export const redFlagsLabel=(s:RedFlagsStatus,l:Locale)=>({
 cleared:t(l,'Red flags excluded','Կարմիր դրոշները բացառված են','Красные флаги исключены'),
 unknown:t(l,'Red flags not yet asked','Կարմիր դրոշները դեռ չեն ճշտվել','Красные флаги ещё не уточнены'),
 positive:t(l,'Red flags present','Կան կարմիր դրոշներ','Есть красные флаги'),
}[s]);
const words=(value:string)=>value.replaceAll(/[_.:-]+/g,' ');
/** What the zone rule found, in words. An unknown code still reads as words. */
export function reasonLabel(reason:string,l:Locale){
 switch(reason){
  case 'bp_symptom_chest_pain':return t(l,'Chest pain','Կրծքավանդակի ցավ','Боль в груди');
  case 'bp_symptom_dyspnea':return t(l,'Shortness of breath','Շնչահեղձություն','Одышка');
  case 'bp_symptom_neuro':return t(l,'Neurological symptoms','Նյարդաբանական ախտանիշներ','Неврологические симптомы');
  case 'bp_symptom_syncope':return t(l,'Fainting','Ուշագնացություն','Обморок');
  case 'af_fast_pulse_dizzy':return t(l,'Known AF with a fast pulse and dizziness','Հայտնի ՆՖ՝ արագ զարկերակով և գլխապտույտով','Известная ФП с частым пульсом и головокружением');
  case 'bp_same_day':return t(l,'High blood pressure, same-day review','Բարձր ճնշում, նույն օրվա դիտարկում','Высокое давление, разбор в тот же день');
  case 'bp_low':return t(l,'Low blood pressure','Ցածր ճնշում','Низкое давление');
  case 'bp_doctor_48h':return t(l,'Raised blood pressure, doctor review within 48 hours','Բարձր ճնշում, բժշկի դիտարկում 48 ժամվա ընթացքում','Повышенное давление, разбор врачом в течение 48 часов');
  case 'bp_yellow':return t(l,'Raised blood pressure','Բարձր ճնշում','Повышенное давление');
  case 'bp_reading_incomplete':return t(l,'Reading was only partly entered','Չափումը մասամբ է մուտքագրվել','Показатель введён частично');
  case 'suspected_fh':return t(l,'LDL suggests familial hypercholesterolaemia','LDL-ն ենթադրում է ընտանեկան հիպերխոլեստերինեմիա','LDL указывает на семейную гиперхолестеринемию');
  case 'tg_red':case 'tg_orange':return t(l,'High triglycerides','Բարձր տրիգլիցերիդներ','Высокие триглицериды');
  case 'alt_same_day':case 'alt_doctor_48h':case 'alt_elevated':return t(l,'High ALT','Բարձր ALT','Высокий АЛТ');
  case 'ck_same_day':return t(l,'High CK with muscle symptoms','Բարձր CK՝ մկանային ախտանիշներով','Высокая КФК с мышечными симптомами');
  case 'ck_raised_no_muscle_symptoms':return t(l,'High CK, muscle symptoms to ask about','Բարձր CK, պետք է ճշտել մկանային ախտանիշները','Высокая КФК, нужно уточнить мышечные симптомы');
  case 'hba1c_high':return t(l,'High HbA1c','Բարձր HbA1c','Высокий HbA1c');
  case 'hba1c_high_symptoms':return t(l,'High HbA1c with symptoms','Բարձր HbA1c՝ ախտանիշներով','Высокий HbA1c с симптомами');
  case 'sams_red':return t(l,'Muscle symptoms with warning signs','Մկանային ախտանիշներ՝ նախազգուշական նշաններով','Мышечные симптомы с тревожными признаками');
  case 'sams_orange':return t(l,'Muscle symptoms','Մկանային ախտանիշներ','Мышечные симптомы');
  case 'missed_measurements':return t(l,'Missed measurements','Բաց թողնված չափումներ','Пропущенные измерения');
  case 'missed_doses':return t(l,'Missed doses','Բաց թողնված դեղաչափեր','Пропущенные дозы');
  case 'wants_to_stop_statin':return t(l,'Wants to stop the statin','Ուզում է դադարեցնել ստատինը','Хочет прекратить приём статина');
  case 'ldl_retest_review':return t(l,'LDL above target at retest','Կրկնակի հետազոտության ժամանակ LDL-ն թիրախից բարձր է','LDL выше цели при повторном анализе');
  case 'lab_booking_needed':return t(l,'Lab visit to book','Պետք է ամրագրել լաբորատոր այց','Нужно записать на анализы');
  case 'lab_reschedule':return t(l,'Lab visit to reschedule','Պետք է տեղափոխել լաբորատոր այցը','Нужно перенести визит на анализы');
  case 'fasting_failed':return t(l,'Fasting not kept for the lab visit','Լաբորատոր այցի համար քաղցած չի եղել','Не соблюдено голодание перед анализами');
  case 'lab_no_show':return t(l,'Missed lab visit','Բաց թողնված լաբորատոր այց','Пропущен визит на анализы');
  case 'missing_baseline_labs':return t(l,'First lab results missing','Առաջին լաբորատոր արդյունքները բացակայում են','Нет исходных анализов');
  case 'followup_labs_due':return t(l,'Follow-up labs due','Հաջորդ անալիզների ժամկետն է','Пора сдать контрольные анализы');
  case 'medicine_access_help':return t(l,'Needs help getting the medicine','Օգնություն է պետք դեղը ձեռք բերելու համար','Нужна помощь с получением лекарства');
  default:return words(reason);
 }
}
/** Every reason the zone rule gave, falling back to the task's own reason code. */
export function taskReasons(task:Pick<CareQueueTask,'reason'|'summary'>,l:Locale){
 if(task.reason==='bp_member_reported_high'&&task.summary.entrySource==='patient_text_entry'&&typeof task.summary.systolic==='number'&&typeof task.summary.diastolic==='number')
  return `${task.summary.systolic}/${task.summary.diastolic} ${bpUnit(l)} · ${unverifiedBpLabel(l)}`;
 const parsed=z.array(z.string()).safeParse(task.summary.reasons);
 const reasons=parsed.success&&parsed.data.length?parsed.data:[task.reason];
 return [...new Set(reasons.map(r=>reasonLabel(r,l)))].join(', ');
}
export function actionLabel(action:string,l:Locale){
 if(action==='verify_bp')return t(l,'Check reported blood pressure','Ստուգել հաղորդած ճնշումը','Проверить сообщённое давление');
 if(action==='book')return t(l,'Book','Ամրագրել','Записать');
 if(action==='rebook')return t(l,'Book again','Կրկին ամրագրել','Записать повторно');
 return words(action);
}
