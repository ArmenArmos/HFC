import {ALARM_REASONS as REASONS} from './alarm-reasons';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {normaliseText} from './normalise';
import {memberAsks} from './symptoms/intake';
import {SHEETS,sheetFor} from './symptoms/sheets';
import {asserted,symptomAsserted} from './symptoms/red-flags';
import type {ReplyLanguage} from './provider';

export const ALARM_CONVERSATION_VERSION='zoe-alarm-conversation-1';
/** Structured member-safe facts, stored separately from the staff rationale. Never model text. */
export const alarmTriggerSchema=z.object({
 kind:z.enum(['saved_reading','symptom_words','urgency_check']).optional(),
 rules:z.array(z.string().max(80)).max(40),messageHash:z.string().max(64),
 symptom:z.string().max(40).nullable(),symptoms:z.array(z.string().max(40)).max(40).optional(),
 reading:z.object({systolic:z.number().int(),diastolic:z.number().int(),id:z.string().nullable(),version:z.string().nullable(),measuredAt:z.iso.datetime({offset:true}).nullable().optional()}).nullable(),
});
export type AlarmTrigger=z.infer<typeof alarmTriggerSchema>;
export const alarmMessageHash=(text:string)=>createHash('sha256').update(normaliseText(text)).digest('hex');
// Latin-letter wording is used only to choose the clarification/explanation, never to add an urgent-list hit.
export const alarmSymptom=(text:string)=>sheetFor(normaliseText(text))?.id??(/\b(?:hognac|hoghnac|tulutyun)\b/u.test(normaliseText(text))?'fatigue':null);
/** Use the same symptom aliases for the now-question, with the existing denial/history checks. */
export const assertedAlarmSymptom=(text:string)=>!generalSymptomQuestion(text)&&(symptomAsserted(text)||asserted(normaliseText(text),/\b(?:hognac|hoghnac|tulutyun)\b/u));

/** All asserted families, using the unchanged sheet triggers and denial/history checks. */
export function alarmSymptoms(text:string):string[]{
 if(generalSymptomQuestion(text))return [];
 const found=SHEETS.filter(s=>symptomAsserted(text,[s])).map(s=>s.id);
 if(assertedAlarmSymptom(text)&&alarmSymptom(text)==='fatigue'&&!found.includes('fatigue'))found.push('fatigue');
 return found;
}

const WHY=/^(?:why(?: are you (?:sending|telling) me (?:to (?:emergency|call 103)|to emergency))?|why (?:103|emergency)|(?:the )?reason|what (?:is|was) the reason|ինչու(?: եք ինձ ուղարկում շտապօգնության)?|պատճառը|ինչի համար|inchu(?: eq indz uxarkum shtapognutyan)?|patjary|պատճառ|почему(?: вы отправляете меня в скорую)?|причина|в ч[её]м причина)[\s?.!։՞]*$/u;
export function asksAlarmWhy(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('’',"'").replaceAll('՞','');
 return WHY.test(t)||/^(?:why|ինչու|inchu|почему)(?![\p{L}])/u.test(t)&&/103|emergency|warning|alarm|շտապ|զգուշ|ահազանգ|shtap|ahazang|тревог|скорую|скорой|экстренн/u.test(t);
}
const DISPUTE=/(?:i (?:did not|didn't|never) (?:say|report|answer)|(?:that|the|my) (?:symptom )?answer (?:is|was) wrong|ես (?:չեմ ասել|չեմ նշել)|այդ պատասխանը սխալ է|es (?:chem asel|chem nshel)|ayd patasxany sxal e|я (?:не говорил|не говорила|не сообщал|не сообщала)|(?:этот|тот|мой) ответ неверный)/u;
export const disputesSymptomAnswer=(raw:string)=>DISPUTE.test(normaliseText(raw).replaceAll('’',"'"));
/** Only a general/conditional causal question. A request about a symptom happening now is not deferred. */
export function generalSymptomQuestion(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('՞','');
 return (memberAsks(raw)||/^(?:why|ինչու|inchu|почему)(?![\p{L}])/u.test(t))&&/^(?:if(?![\p{L}])|what causes|what (?:can|could) cause|why(?![\p{L}])|եթե|ինչից|ինչու|ete(?![\p{L}])|yete(?![\p{L}])|inchic|inchits|inchu|если|что вызывает|из-за чего|почему)/u.test(t)
  &&!/(?:\bnow\b|\bright now\b|հիմա|\bhima\b|сейчас)/u.test(t);
}

/** Historical text retained for existing threads and replay scoring. No longer appended. */
export const ALARM_WARNING:Record<ReplyLanguage,string>={
 en:'The warning remains: call 103 for the urgent concern already recorded.',
 hy:'Զգուշացումը մնում է ուժի մեջ. գրանցված շտապ խնդրի համար զանգահարեք 103։',
 ru:'Предупреждение остаётся в силе: звоните 103 по уже записанной срочной причине.',
};
export const SYMPTOM_NOW_QUESTION:Record<ReplyLanguage,string>={
 en:'Do you feel this now?',hy:'Դուք դա հիմա զգո՞ւմ եք։',ru:'Вы чувствуете это сейчас?',
};
export const isSymptomNowQuestion=(text:string|null|undefined)=>!!text&&Object.values(SYMPTOM_NOW_QUESTION).some(q=>text.trim().endsWith(q));
export const DISPUTE_NOTED:Record<ReplyLanguage,string>={
 en:"I've noted that you dispute the symptom answer and sent this to your doctor. Your recorded answer is still there.",
 hy:'Նշել եմ, որ դուք վիճարկում եք ախտանիշի պատասխանը, և դա ուղարկել եմ ձեր բժշկին։ Գրանցված պատասխանը պահպանված է։',
 ru:'Я отметила, что вы оспариваете ответ о симптоме, и передала это вашему врачу. Записанный ответ сохранён.',
};
const UNKNOWN_REASON:Record<ReplyLanguage,string>={
 en:"I don't have the recorded trigger available, so I can't give you its exact reason.",
 hy:'Գրանցված պատճառը հասանելի չէ, ուստի չեմ կարող ասել ճշգրիտ պատճառը։',
 ru:'Записанная причина недоступна, поэтому я не могу назвать точную причину.',
};
const MODEL_REASON:Record<ReplyLanguage,string>={
 en:'The urgency checks on your earlier message set off the warning; no fixed-rule reason was recorded.',
 hy:'Ձեր նախորդ հաղորդագրության շտապության ստուգումները միացրել են զգուշացումը. հաստատուն կանոնի պատճառ չի գրանցվել։',
 ru:'Проверки срочности вашего предыдущего сообщения включили предупреждение; причина по фиксированному правилу не записана.',
};
// These descriptions name only the category actually recorded, without inferring a diagnosis.
export function alarmExplanation(trigger:AlarmTrigger|null|undefined,openedBy:'model'|'rule'|null|undefined,lang:ReplyLanguage):string{
 if(!trigger)return UNKNOWN_REASON[lang];
 if(trigger.rules.includes('bp_crisis_reading')&&trigger.reading){
  const n=`${trigger.reading.systolic}/${trigger.reading.diastolic}`;
  const tired=trigger.symptom==='fatigue';
  return lang==='en'?`Your saved reading of ${n} is very high, and you mentioned ${tired?'feeling tired':'a symptom'}.`
   :lang==='hy'?`Ձեր գրանցված ${n} ճնշումը շատ բարձր է, և դուք նշել եք ${tired?'հոգնածություն':'ախտանիշ'}։`
   :`Ваше записанное давление ${n} очень высокое, и вы упомянули ${tired?'усталость':'симптом'}.`;
 }
 const family:Record<string,string>={CHEST:'RF-01',BREATH:'RF-02',FAINT:'RF-02',STROKE:'RF-04',SEIZ:'RF-05',MEN:'fever_stiff_neck'};
 const category=trigger.rules.flatMap(r=>{const group=r.startsWith('S-')?r.split('-')[1]!:r;return [r,family[group]??group];}).find(r=>REASONS[r]);
 if(category)return REASONS[category]![lang];
 if(openedBy==='model')return MODEL_REASON[lang];
 return lang==='en'?'Your recorded message or symptom answer matched an urgent warning rule.'
  :lang==='hy'?'Ձեր գրանցված հաղորդագրությունը կամ ախտանիշի պատասխանը համապատասխանել է շտապ վտանգի կանոնին։'
  :'Ваше записанное сообщение или ответ о симптоме совпали с правилом срочного предупреждения.';
}
