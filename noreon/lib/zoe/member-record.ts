import {z} from 'zod';
import {ldlObservations,type RawLdlObservation} from '@/lib/ldl/status';
import {ldlObservationSchema} from '@/lib/ldl/schema';
import {adherence,planMedicineSchema,selfMedicineSchema} from '@/lib/member-medicines/model';
import {CORE_QUESTIONS,visibleFields,fieldById} from '@/lib/clinical/seed/questions';
import {UNKNOWN,type Answers} from '@/lib/clinical/types';
import {assessmentProgress,fieldComplete,pruneAnswers} from '@/lib/patient/questionnaire';
import {normaliseText} from './normalise';
import {classifyScope} from './scope';
import type {HealthData} from './health-answer';
import {QUESTIONNAIRE_FIELDS,type QuestionnaireFacts} from './chat-record';

/**
 * What the member's record already holds, for a Zoe health answer (zoe_run_member_record): age, doses in the last 7 days, and the
 * LDL record as the doctor left it. Read-only: nothing here writes, and a missing field stays unknown, never a normal value.
 *
 * The doctor's goal number stays out of the model's input unless NOREON_ZOE_LDL_TARGET=on: a goal row exists only after the doctor
 * confirmed it, but whether Zoe may state a personal target is with the clinicians (the prompt's rule 3 forbids it today).
 */
export const MEMBER_RECORD_VERSION='zoe-member-record-2';
export const zoeLdlTargetOn=(env:Record<string,string|undefined>)=>(env.NOREON_ZOE_LDL_TARGET??'').trim().toLowerCase()==='on';

const day=z.iso.date();
const questionnaireFacts=z.record(z.string().max(40),z.union([z.string().max(80),z.number(),z.array(z.string().max(80)).max(12)]));
const num=z.union([z.number(),z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
/** One row of zoe_run_member_record. */
export const memberRecordRowSchema=z.object({runId:z.uuid(),enabled:z.boolean(),today:day,ageYears:z.number().int().nullable(),chatCards:z.boolean().default(false),viaTelegram:z.boolean().default(false),
 /** 20261102182738. Absent on a row from before it: the list stays off for chat, no questionnaire facts, nothing disputed. */
 medicineList:z.boolean().default(false),questionnaireFacts:questionnaireFacts.nullable().default(null),disputed:z.array(z.string().max(40)).max(20).default([]),
 /** The questionnaire's state (status), or a flat row of facts from a function that had only those. */
 questionnaire:z.union([z.object({completed:z.boolean(),answers:z.record(z.string(),z.unknown())}),questionnaireFacts]).nullable().default(null),nextVisit:z.object({at:z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)}).nullable().default(null),
 medicines:z.object({now:z.iso.datetime({offset:true}),self:z.array(selfMedicineSchema),plan:z.array(planMedicineSchema)}).nullable(),
 ldl:z.object({goal:z.object({thresholdMmol:num,setOn:day}).nullable(),observations:z.array(ldlObservationSchema),event:z.object({type:z.string(),other:z.string().nullable(),on:day.nullable()}).nullable(),
  therapies:z.array(z.object({drug:z.string(),other:z.string().nullable(),dose:z.string(),startedOn:day.nullable()})),nextTestOn:day.nullable()}).nullable()});

const ago=z.number().int();
/** What the job carries: days relative to today, no ids. */
export const memberRecordSchema=z.strictObject({/** zoe_chat_actions_enabled: a card can do the logging. */chatCards:z.boolean().default(false),
 /** member_medicine_settings.enabled: a medicine named in chat can go on the member's list. */medicineList:z.boolean().optional(),
 /** Saved basics can answer an ordinary question; the remaining allowlisted facts are used only for a requested summary. */questionnaire:questionnaireFacts.nullable().optional(),
 /** Questionnaire conditions the member disputes (member_statements). */disputed:z.array(z.string().max(40)).max(20).optional(),ageYears:z.number().int().nullable(),doses:z.strictObject({days:z.number().int(),expected:z.number().int(),taken:z.number().int(),skipped:z.number().int()}).nullable(),
 /** Where the member stands: the questionnaire (null: it could not be read) and the next booked time in Yerevan. Absent from an older function's row. */
 status:z.strictObject({questionnaire:z.strictObject({started:z.boolean().default(true),complete:z.boolean(),sectionsDone:z.number().int(),sections:z.number().int(),missing:z.string().max(120).nullable()}).nullable(),nextVisit:z.string().nullable()}).nullable().optional(),
 ldl:z.strictObject({goal:z.strictObject({thresholdMmol:z.number(),setDaysAgo:ago}).nullable(),latest:z.strictObject({mmol:z.number(),daysAgo:ago}).nullable(),
  event:z.strictObject({type:z.string().max(40),other:z.string().max(120).nullable(),daysAgo:ago.nullable()}).nullable(),
  therapies:z.array(z.strictObject({name:z.string().max(120),dose:z.string().max(60),startedDaysAgo:ago.nullable()})).max(6),nextTestInDays:ago.nullable()}).nullable()});
export type MemberRecord=z.infer<typeof memberRecordSchema>;

const DOSE_DAYS=7;
/** Counts and a section's name, with the app's own questionnaire rules. A set that cannot be read says nothing. */
function questionnaireStatus(q:{completed:boolean;answers:Record<string,unknown>}){
 try{
  const answers=pruneAnswers(q.answers as Answers),{completedTopics,totalTopics,complete}=assessmentProgress(answers);
  const open=CORE_QUESTIONS.find(c=>visibleFields(c,answers).some(f=>!fieldComplete(f,answers)));
  return {started:Object.keys(answers).some(id=>!id.startsWith('q1.')),complete:q.completed&&complete,sectionsDone:completedTopics,sections:totalTopics,missing:open?.title.en??null};
 }catch{return null;}
}
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
/** In words: an ISO date reads as a phone number to the reply check's contact pattern. */
const visitWords=(at:string)=>{const [y,m,d,time]=at.split(/[- ]/u);return `${Number(d)} ${MONTHS[Number(m)-1]} ${y} at ${time}`;};
const daysBetween=(from:string,to:string)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000);
/** The existing consent-gated row already holds these answers, including a partly completed questionnaire. */
function savedFacts(q:{answers:Record<string,unknown>}):QuestionnaireFacts|null{
 try{
  const answers=pruneAnswers(q.answers as Answers);
  // Facts are text, numbers and lists only (QuestionnaireFacts); any other stored value kind is left out rather than guessed.
  return Object.fromEntries(['q1.age',...QUESTIONNAIRE_FIELDS].flatMap(id=>{
   const f=fieldById(id),v=answers[id]?.value;
   return f&&fieldComplete(f,answers)&&v!==UNKNOWN&&(typeof v==='string'||typeof v==='number'||(Array.isArray(v)&&v.every(x=>typeof x==='string')))?[[id,v as string|number|string[]]]:[];
  }));
 }catch{return null;}
}
/** The row as the job carries it. The newest counted LDL comes from the one place that reads LDL values (lib/ldl/status.ts). */
export function memberRecordFrom(row:z.infer<typeof memberRecordRowSchema>):MemberRecord{
 const meds=row.medicines,now=meds?new Date(meds.now):null;
 const doses=meds&&now?[...meds.plan,...meds.self].map(m=>adherence(m,DOSE_DAYS,now)).reduce((a,b)=>({expected:a.expected+b.expected,taken:a.taken+b.taken,skipped:a.skipped+b.skipped}),{expected:0,taken:0,skipped:0}):null;
 const l=row.ldl,latest=l?ldlObservations(l.observations as RawLdlObservation[]).filter(o=>o.counts).at(-1)??null:null;
 const onRecord=!!l&&(l.goal||latest||l.event||l.therapies.length>0);
 const questionnaireState=row.questionnaire&&typeof row.questionnaire.completed==='boolean'?row.questionnaire as {completed:boolean;answers:Record<string,unknown>}:null;
 const facts=questionnaireState?savedFacts(questionnaireState):row.questionnaireFacts??row.questionnaire as QuestionnaireFacts|null;
 return {chatCards:row.chatCards,medicineList:row.medicineList,questionnaire:facts,disputed:row.disputed,ageYears:row.ageYears??(typeof facts?.['q1.age']==='number'?facts['q1.age']:null),status:questionnaireState?{questionnaire:questionnaireStatus(questionnaireState),nextVisit:row.nextVisit?visitWords(row.nextVisit.at):null}:null,doses:doses&&doses.expected>0?{days:DOSE_DAYS,...doses}:null,
  ldl:onRecord?{goal:l.goal?{thresholdMmol:l.goal.thresholdMmol,setDaysAgo:daysBetween(l.goal.setOn,row.today)}:null,latest:latest?{mmol:latest.mmol,daysAgo:daysBetween(latest.on,row.today)}:null,
   event:l.event?{type:l.event.type,other:l.event.other,daysAgo:l.event.on?daysBetween(l.event.on,row.today):null}:null,
   therapies:l.therapies.slice(0,6).map(t=>({name:(t.drug==='other'?t.other??'':t.drug.replaceAll('_',' ')).slice(0,120),dose:t.dose,startedDaysAgo:t.startedOn?daysBetween(t.startedOn,row.today):null})),
   nextTestInDays:l.nextTestOn?daysBetween(row.today,l.nextTestOn):null}:null};
}

const esc=(t:string)=>t.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/gu,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const days=(n:number)=>`${n} day${n===1?'':'s'}`;
const EVENT:Record<string,string>={acs_mi:'heart attack or acute coronary syndrome',ischaemic_stroke:'ischaemic stroke',tia:'transient ischaemic attack',haemorrhagic_stroke:'haemorrhagic stroke'};
/** The record as a labelled data block for the model. Empty when there is nothing to say, so such a member's input does not change. */
export function memberRecordBlock(r:MemberRecord|null|undefined,o:{target:boolean;clean:(t:string)=>string}){
 if(!r)return '';
 const lines:string[]=[];
 if(r.ageYears!==null)lines.push(`Age: ${r.ageYears}.`);
 for(const [key,id,label,unit] of BASICS){
  if(key==='age')continue;
  const value=r.questionnaire?.[id];
  if(typeof value==='number')lines.push(`${label}: ${value} ${unit}, saved from the health questionnaire.`);
 }
 if(lines.length)lines.push('Use a saved fact when it answers the message. It resolves an earlier clarification about that fact; do not ask for it again. Questionnaire answers are saved data, not open chat questions.');
 if(r.doses)lines.push(`Medicine doses in the last ${r.doses.days} days: ${r.doses.taken} of ${r.doses.expected} marked taken, ${r.doses.skipped} marked skipped, as the member ticked them. An unticked dose is unknown, not missed.`);
 const s=r.status,q=s?.questionnaire;
 if(s){
  lines.push('Where the member stands, to use when they ask or when it is the direct next step:');
  if(q)lines.push(`Health questionnaire: ${q.complete?'finished':!q.started?'not started':`not finished, ${q.sectionsDone} of ${q.sections} sections done${q.missing?`, next open section: ${esc(q.missing)}`:''}`}.`);
  lines.push(`Next booked appointment: ${s.nextVisit?`${s.nextVisit}, Yerevan time`:'none booked yet'}.`);
  lines.push('When asked what is next: if the questionnaire is unfinished, continue it. If finished, say so, then use the published care plan and next booked appointment. With no published plan or booked visit, say that plainly; never invent a booking or test order. If a status could not be read, say you do not know it.');
 }
 const l=r.ldl;
 if(l){
  const none='not on record, so unknown; do not guess it and do not say it is normal';
  lines.push('LDL record, as the doctor left it:',
   `Latest LDL reviewed or released by the doctor: ${l.latest?`${l.latest.mmol} mmol/L, ${days(l.latest.daysAgo)} ago`:none}.`,
   `Heart event: ${l.event?`${esc(l.event.other?o.clean(l.event.other):EVENT[l.event.type]??'recorded')}, ${l.event.daysAgo!==null?`${days(l.event.daysAgo)} ago`:'date not known'}`:none}.`,
   `Lipid therapy: ${l.therapies.length?l.therapies.map(t=>`${esc(o.clean(t.name))} ${esc(o.clean(t.dose))}${t.startedDaysAgo!==null?`, started ${days(t.startedDaysAgo)} ago`:', start date not known'}`).join('; '):none}.`,
   `LDL goal: ${!l.goal?'the doctor has not set one yet: say "your doctor is setting your goal", with no number':o.target?`set by the doctor at below ${l.goal.thresholdMmol} mmol/L, ${days(l.goal.setDaysAgo)} ago`:'set by the doctor; the member sees it on their goal card, and you do not have the number'}.`,
   `Next LDL test: ${l.nextTestInDays===null?none:l.nextTestInDays>=0?`in ${days(l.nextTestInDays)}`:`was due ${days(-l.nextTestInDays)} ago`}.`);
 }
 return lines.length?`<member_record>\n${lines.join('\n')}\n</member_record>`:'';
}

// -------------------------------------------------------------------------------------------------
// A reply that asks for what the record already holds

const BASICS=[['height','q2.height','Height','cm'],['weight','q2.weight','Weight','kg'],['waist','q2.waist','Waist','cm'],['age','q1.age','Age','years']]as const;
type Basic=typeof BASICS[number][0];
export type HeldData='bp'|'ldl'|'lab'|'medicine'|Basic;
const TOPIC:Record<Exclude<HeldData,'lab'>,RegExp>={
 height:/(?<![\p{L}])(?:height|tall|рост\p{L}*|հասակ\p{L}*)/iu,
 weight:/(?<![\p{L}])(?:weight|weigh|вес\p{L}*|քաշ\p{L}*)/iu,
 waist:/(?<![\p{L}])(?:waist|тали\p{L}*|գոտկատեղ\p{L}*)/iu,
 age:/(?<![\p{L}])(?:age|old|возраст\p{L}*|лет|տարիք\p{L}*|տարեկան)/iu,
 ldl:/(?<![\p{L}])(?:ldl|cholesterol|lipid\p{L}*|лпнп|холестерин\p{L}*|липид\p{L}*|խոլեստերին\p{L}*|լիպիդ\p{L}*|ցխլպ)/iu,
 bp:/(?:blood pressure|(?<![\p{L}])bp(?![\p{L}])|home readings?|ճնշում\p{L}*|давлени\p{L}*)/iu,
 medicine:/(?:medicines?|medications?|tablets?|pills?|statins?|лекарств\p{L}*|препарат\p{L}*|таблетк\p{L}*|статин\p{L}*|դեղ\p{L}*|հաբ\p{L}*)/iu,
};
/** Words that ask what the member has or knows, on the reply as written: Armenian's question mark is what tells "ո՞ր" (which) from "որ" (that). */
const ASKS=/(?<![\p{L}])(?:what (?:is|was|are|were|do you take)|what's|how (?:tall|old|much do you weigh)|which|do you (?:have|know|remember|take)|are you (?:taking|on)|can you (?:share|tell)|could you (?:share|tell)|какой|какое|какие|какая|сколько вам лет|знаете|помните|есть ли|у вас есть|принимаете|можете (?:сказать|прислать)|ո՞ր\p{L}*|որքա՞ն|քանի՞|ի՞նչ|ունե՞ք|գիտե՞ք|հիշո՞ւմ|ընդունո՞ւմ|կարո՞ղ եք)/iu;
/** A fresh value is a new question, whatever the record holds. */
const FRESH=/(?<![\p{L}])(?:now|today|tonight|this morning|right now|at the moment|currently|current|since|again|new|сейчас|сегодня|утром|снова|в данный момент|на данный момент|հիմա|այսօր|այս առավոտ|այս պահին|նորից)(?![\p{L}])/iu;
/** Something else than the held fact: what else they take, and how they feel about it. The record answers neither. */
const NOT_HELD=/(?<![\p{L}])(?:other|another|else|additional|besides|supplement|vitamin|herbal|worr|concern|bother|afraid|feel|side effect|reason|why|stop|друг|ещё|еще|кроме|добавк|витамин|беспоко|волну|страш|чувств|почему|побочн|прекрат|այլ|ուրիշ|հավելում|վիտամին|անհանգստ|մտահոգ|վախ|զգում|ինչու|կողմնակի|դադարեց)/iu;
const PAST=/(?<![\p{L}])(?:last|latest|recent|usual|average|home|this week|последн|недавн|обычн|средн|домашн|на этой неделе|վերջին|սովորական|միջին|տնային|այս շաբաթ)/iu;
/** What they swallowed is about this moment, not their list of medicines. */
const TAKEN=/(?<![\p{L}])(?:did you take|have you taken|how many|how much|сколько|приняли|выпили|քանի|ընդունեցիք|խմեցիք)/iu;
// Only a request for the measurement itself, never symptoms or history mentioning weight, age or cholesterol.
const VALUE_QUESTION=/^(?:(?:what (?:is|was)|what's) your (?:height|weight|waist(?: circumference)?|age)(?: in (?:cm|kg|years))?|(?:can|could) you (?:tell me|share) your (?:height|weight|waist(?: circumference)?|age)|do you know your (?:height|weight|waist(?: circumference)?|age)|how (?:tall|old) are you|how much do you weigh|какой (?:у вас|ваш) (?:рост|вес|возраст)|какова (?:у вас )?окружность талии|сколько вам лет|сколько вы весите|որքան է ձեր (?:հասակը|քաշը|գոտկատեղի շրջագիծը|տարիքը)|քանի տարեկան եք)[.?!？\s]*$/u;
const asksBasic=(k:Basic,s:string)=>VALUE_QUESTION.test(s)&&TOPIC[k].test(s);
/** Only the explicit fact: a blood pressure of a moment ago is not on record, and a lab counts only when the question names a test the data holds. */
const ASKED:Record<HeldData,(s:string,labs:readonly string[])=>boolean>={height:s=>asksBasic('height',s),weight:s=>asksBasic('weight',s),waist:s=>asksBasic('waist',s),age:s=>asksBasic('age',s),ldl:s=>TOPIC.ldl.test(s),bp:s=>TOPIC.bp.test(s)&&PAST.test(s),lab:(s,labs)=>s.split(/[^\p{L}\p{N}-]+/u).some(w=>labs.includes(w)),medicine:s=>TOPIC.medicine.test(s)&&!TAKEN.test(s)};
type HeldContext={health?:HealthData|null;record?:MemberRecord|null;medicines?:readonly unknown[];memberTexts?:readonly string[]};
// Only an explicitly labelled, unit-bearing chat answer closes a data question. It never becomes a saved record.
const TYPED:Record<Basic,RegExp>={
 height:/(?:height|рост\p{L}*|հասակ\p{L}*)[^\d.։!?\n]{0,12}\d{2,3}(?:[.,]\d+)?\s*(?:cm|см|սմ)(?![\p{L}])/iu,
 weight:/(?:weight|weigh|вес\p{L}*|քաշ\p{L}*)[^\d.։!?\n]{0,12}\d{2,3}(?:[.,]\d+)?\s*(?:kg|кг|կգ)(?![\p{L}])/iu,
 waist:/(?:waist|тали\p{L}*|գոտկատեղ\p{L}*)[^\d.։!?\n]{0,12}\d{2,3}(?:[.,]\d+)?\s*(?:cm|см|սմ)(?![\p{L}])/iu,
 age:/(?:\bi am\s+\d{1,3}\s+years old\b|мне\s+\d{1,3}\s+лет|\d{1,3}\s+տարեկան)/iu,
};
const basicValue=(k:Basic,d:HeldContext)=>{
 const id=BASICS.find(b=>b[0]===k)![1],saved=k==='age'?d.record?.ageYears:d.record?.questionnaire?.[id];
 if(typeof saved==='number')return saved;
 for(const t of [...d.memberTexts??[]].reverse().flatMap(t=>t.split(/(?<=[.։!?？\n])\s+/u))){
  if(classifyScope(t).thirdPartyPossible||/[?՞？]/u.test(t)||/(?<![\p{L}])(?:not|isn't|не|չէ|չի)(?![\p{L}])/iu.test(t))continue;
  const match=TYPED[k].exec(t)?.[0].match(/\d+(?:[.,]\d+)?/u)?.[0];
  if(match)return Number(match.replace(',','.'));
 }
 return null;
};
const held=(k:HeldData,d:HeldContext)=>BASICS.some(b=>b[0]===k)?basicValue(k as Basic,d)!==null:k==='bp'?!!d.health?.bpWeek
 :k==='ldl'?!!d.record?.ldl?.latest||!!d.health?.labs.some(l=>TOPIC.ldl.test(l.marker))
 :k==='lab'?!!d.health?.labs.length
 :!!d.record?.ldl?.therapies.length||!!d.health?.plan?.medicationName.trim()||!!d.medicines?.length;
/** What the reply's questions ask for that the member's data already holds. Only an explicit question about that held fact counts: anything else stays a good question. */
export function asksForHeldData(reply:string,d:HeldContext):HeldData[]{
 const asks=reply.split(/(?<=[.։!?？\n])\s*/u).filter(s=>/[?？՞]/u.test(s)&&ASKS.test(s.normalize('NFC'))).map(normaliseText).filter(s=>!FRESH.test(s)&&!NOT_HELD.test(s));
 const labs=(d.health?.labs??[]).map(l=>normaliseText(l.marker)).filter(m=>!TOPIC.ldl.test(m));
 return (['ldl','bp','lab','medicine','height','weight','waist','age'] as const).filter(k=>held(k,d)&&asks.some(s=>ASKED[k](s,labs)));
}

/** Remove only resolved data questions from the model's history, leaving the original safety window intact. */
export function dropAnsweredQuestions(body:string,d:HeldContext):string{
 return body.split(/(?<=[.։!?？\n])(\s*)/u).filter(s=>{
  if(BASICS.some(([k])=>basicValue(k,d)!==null&&asksBasic(k,normaliseText(s).trim())))return false;
  // A bare number's meaning, rather than a new clinical question about a number. Match only this closed wording.
  const generic=/^(?:what (?:does|did) (?:the )?(?:number )?(\d+(?:\.\d+)?) (?:mean|refer to)|что (?:значит|означает) (?:число )?(\d+)|(?:իսկ )?(\d+)[-ը\s]*ի՞նչ (?:է|նշանակում))\s*[?։？.]*$/iu.exec(s.trim());
  const number=generic?.slice(1).find(Boolean);
  return !number||!BASICS.some(([k])=>Number(number)===basicValue(k,d));
 }).join('').trim();
}
