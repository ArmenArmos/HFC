import {z} from 'zod';
import {bmi} from '@/lib/clinical/rules/derived';
import {fieldById} from '@/lib/clinical/seed/questions';
import {UNKNOWN,type Answers} from '@/lib/clinical/types';
import {conversationMemory} from './conversation-memory';
import {normaliseText} from './normalise';
import type {ReplyLanguage} from './provider';
import {textRedFlags} from './symptoms/red-flags';

/**
 * What the chat adds to the member's record (Armen 542, 543, 544; Monika 558; Tasks 14 and 20). Pure: the pipeline runs it and the database stores it.
 *  - Medicines named in chat: a short question, and on a yes they go on the member's own list as their statement, for the doctor to check. The name and
 *    the dose are the member's words: a dose they did not write stays unknown.
 *  - A summary the member asks for: everything said or recorded, and no negative that nobody stated.
 *  - Nothing about the member's condition is held back from the doctor at the member's request.
 *  - A questionnaire correction is the member's statement. It shapes the tone only; every urgency rule stays until a doctor confirms.
 * New member-facing wording is a staging draft.
 */
export const CHAT_RECORD_VERSION='zoe-chat-record-1';

// ---- Medicines ---------------------------------------------------------------------------------------------------------------
export type ChatMedicine={name:string;dose:string|null};
const MEDICINE_ASK:Record<ReplyLanguage,{lead:string;ask:string}>={
 en:{lead:'You take ',ask:'. Shall I add this to your list for your doctor to check?'},
 hy:{lead:'Դուք ընդունում եք ',ask:'։ Ավելացնե՞մ սա ձեր ցանկում, որպեսզի բժիշկը ստուգի։'},
 ru:{lead:'Вы принимаете ',ask:'. Добавить это в ваш список, чтобы врач проверил?'},
};
/** The member's yes: added, as their statement. */
export const MEDICINE_ADDED:Record<ReplyLanguage,string>={
 en:'Added to your list as you told me. Your doctor will check it. Any change to a dose is for your doctor to decide.',
 hy:'Ավելացրի ձեր ցանկում, ինչպես ասացիք։ Բժիշկը կստուգի։ Դեղաչափի ցանկացած փոփոխություն որոշում է բժիշկը։',
 ru:'Добавила в ваш список, как вы сказали. Врач проверит. Любое изменение дозы решает врач.',
};
export const MEDICINE_NOT_ADDED:Record<ReplyLanguage,string>={en:'All right, I have not added it.',hy:'Լավ, չավելացրի։',ru:'Хорошо, не добавляю.'};
/** The list is switched off or full: the truth, and where the member can do it. */
export const MEDICINE_NOT_SAVED:Record<ReplyLanguage,string>={
 en:'I could not add it just now. You can add it on your medicines page, and tell your doctor at your next contact.',
 hy:'Հիմա չկարողացա ավելացնել։ Կարող եք ավելացնել ձեր դեղերի էջում և ասել բժշկին հաջորդ կապի ժամանակ։',
 ru:'Сейчас не удалось добавить. Вы можете добавить это на странице лекарств и сказать врачу при следующем контакте.',
};
const DOSE=/^\d[\d.,]*\s*(?:mg|mcg|µg|g|ml|iu|units?|мг|мкг|г|мл|ед|մգ|մկգ|գ|մլ)(?![\p{L}])/iu;
const item=(m:ChatMedicine)=>m.dose?`${m.name} ${m.dose}`:m.name;
/** The question on the last line of Zoe's reply. The line is the only state: a yes reads the medicines back from it. */
export function medicineAskLine(l:ReplyLanguage,medicines:readonly ChatMedicine[]){const a=MEDICINE_ASK[l];return `${a.lead}${medicines.map(item).join(', ')}${a.ask}`;}
/** The medicines Zoe's text asks about, when its last line is that question. */
export function pendingMedicines(zoe:string|null|undefined):ChatMedicine[]|null{
 const last=zoe?.trim().split(/\n+/u).at(-1)?.trim()??'';
 for(const a of Object.values(MEDICINE_ASK))if(last.startsWith(a.lead)&&last.endsWith(a.ask)){
  return last.slice(a.lead.length,-a.ask.length).split(', ').map(x=>{
   // The last number that reads as a dose: "omega 3 1000 mg" is omega 3.
   const at=[...x.matchAll(/\s(?=\d)/gu)].map(m=>m.index).reverse().find(i=>DOSE.test(x.slice(i+1)));
   return at===undefined?{name:x,dose:null}:{name:x.slice(0,at),dose:x.slice(at+1)};});
 }
 return null;
}
const ADD_YES=/^(?:yes,? add(?: it| them)?|add(?: it| them)?|добавь(?:те)?|ավելացրու?(?:եք)?|avelacrek?)[\s.!]*$/iu;
/** "Add it", beside the plain yes of replyToAsk. */
export const saysAdd=(raw:string)=>ADD_YES.test(normaliseText(raw).trim());
const key=(t:string)=>normaliseText(t).replace(/\s+/gu,'');
const namedByModel=z.array(z.object({name:z.string(),dose:z.string().nullish()}));
/**
 * What may be offered from the model's medicines_named. Each name and dose must stand in the member's own messages (the model never adds a word), a dose
 * must be a number with a unit or it stays unknown, and what is on the list or the plan, or was asked about before, is not offered again.
 */
export function offerableMedicines(named:unknown,o:{memberTexts:readonly string[];listed:readonly string[];earlierAnswers:readonly string[]}):ChatMedicine[]{
 const read=namedByModel.safeParse(named);if(!read.success)return [];
 const said=key(o.memberTexts.join(' '));
 const asked=o.earlierAnswers.flatMap(a=>pendingMedicines(a)??[]).map(m=>key(m.name));
 const known=[...o.listed.map(key),...asked];
 const out:ChatMedicine[]=[];
 for(const m of read.data){
  const name=m.name.trim(),dose=m.dose?.trim()??'';
  if(name.length<3||name.length>60||!/^\p{L}{2}/u.test(name)||/\p{N}{4}/u.test(name)||/[,;.()\n]/u.test(name)||!said.includes(key(name)))continue;
  if(known.some(k=>k.includes(key(name))||key(name).includes(k))||out.some(x=>key(x.name)===key(name)))continue;
  if(textRedFlags([name],{intakeActive:true,latestReading:null}).length)continue;
  out.push({name,dose:DOSE.test(dose)&&dose.length<=40&&said.includes(key(dose))?dose:null});
 }
 return out.slice(0,3);
}
const NO_MEDICINES=[
 /(?<![\p{L}])(?:no|not any|without)\s+(?:current\s+)?(?:medicines?|medications?)\s+(?:(?:is|are)\s+)?(?:on|in)\s+(?:your\s+|the\s+)?(?:record|list|file|profile)|(?:medicines?|medications?)?\s*list\s+is\s+empty|(?:don'?t|do not)\s+(?:see|have)\s+any\s+(?:medicines?|medications?)|(?:haven'?t|have not)\s+(?:listed|entered|added)\s+any/iu,
 /(?:список|перечень)[^.?!]{0,40}пуст|нет\s+(?:\p{L}+\s+)?(?:лекарств|препаратов)/iu,
 /դեղ\p{L}*\s+(?:չկա|չկան|չեն)|ցանկ\p{L}*\s+(?:\p{L}+\s+)?դատարկ/iu,
];
/** A reply that says the member's list or record holds no medicine. */
export const saysNoMedicines=(reply:string)=>NO_MEDICINES.some(re=>re.test(reply.normalize('NFC')));

// ---- A summary the member asks for -------------------------------------------------------------------------------------------
const ASKS_SUMMARY=/(?<![\p{L}])(?:(?:summar(?:y|i[sz]e)|recap|overview)(?![\p{L}])[^.?!]{0,30}(?:my\s+(?:health|history|condition|record|data)|about me|of me|i(?:'ve)?\s+(?:told|said)|we\s+(?:talked|discussed)|so far)|my\s+(?:health\s+)?summary|health\s+summary|what do you know about me|(?:резюме|сводк\p{L}*|обобщи\p{L}*|подытож\p{L}*)[^.?!]{0,30}(?:здоровь|обо мне|что я)|что (?:ты|вы) знае\p{L}* обо мне|ամփոփ\p{L}*[^.։?]{0,30}(?:առողջ|իմ մասին|ասածս)|ինչ գիտեք իմ մասին)/iu;
/** The member asks Zoe to sum up what she knows. Decided here so that a topic break cannot take the earlier turns away from it. */
export const asksForSummary=(raw:string)=>ASKS_SUMMARY.test(normaliseText(raw));
export const SUMMARY_NOTE='<member_summary_request>The member asks for a summary of their health. It is the one reply that uses all of the chat: every reading with its numbers, medicines, smoking, alcohol, snoring and sleep, family history, BMI, HbA1c and other results, from <member_messages>, <member_data>, <health_summary> and <member_questionnaire>, saying where each comes from. Up to about 200 words. Only what was said or recorded. What is not there is left out, or listed as not mentioned: never write that a symptom, a reading or a habit is absent unless the member said so or the record shows it. No new advice. The summary reports the past: the urgency is that of the newest message.</member_summary_request>';
const NEGATIVE=[/(?<![\p{L}])(?:no|denies|without|never had)\s+((?:[\p{L}\d-]+\s*){1,3})/giu,/(?<![\p{L}])(?:нет|без|отрицает)\s+(\p{L}+)/giu,/(\p{L}+)\s+(?:չկա|չկան|չունեք|չեք ունեցել)/giu];
// Only a word that states a clinical fact can invent one: symptoms, readings, habits, results. "no need to change", "without food" and «Нет данных» say nothing about the member.
const CLINICAL=/^(?:pain|chest|breath|shortness|dizz|headache|nausea|vomit|faint|palpit|swell|numb|weak|bleed|fever|cough|sweat|vision|symptom|readings?$|pressure|bp$|pulse|smok|alcohol|snor|results?$|hba1c|ldl|cholesterol|glucose|sugar|allerg|diabet|stroke|бол|одышк|головокруж|тошнот|рвот|обморок|от[её]к|слабост|кров|температур|кашл|зрени|симптом|показани|давлени|пульс|курени|алкогол|храп|анализ|холестерин|сахар|глюкоз|аллерг|ցավ|շնչ|գլխապտույտ|սրտխառն|փսխ|ուշագն|այտուց|թուլ|արյուն|ջերմ|հազ|տեսողութ|ախտանիշ|ճնշ|զարկերակ|ծխ|ալկոհոլ|խռմփ|արդյունք|խոլեստերին|շաքար|ալերգ)/iu;
const NO_READINGS=/(?<![\p{L}])no\s+(?:\p{L}+\s+){0,3}readings?(?![\p{L}])|нет\s+(?:\p{L}+\s+){0,2}(?:показани|измерени)\p{L}*|ընթերցում\p{L}*\s+չկա/iu;
const A_READING=/(?<![\d/.])\d{2,3}\/\d{2,3}(?![\d/.])/u;
/** Negatives in a summary that nobody stated: the words of each stand nowhere in the sources (Roo: "no shortness of breath", "no BP readings"). */
export function inventedNegatives(reply:string,sources:readonly string[]):string[]{
 const src=sources.join(' ').toLowerCase().normalize('NFC');
 const out=NO_READINGS.test(reply)&&A_READING.test(src)?['readings']:[];
 for(const re of NEGATIVE)for(const m of reply.normalize('NFC').matchAll(re)){
  const stems=m[1]!.trim().split(/\s+/u).filter(w=>CLINICAL.test(w)).map(w=>w.toLowerCase().slice(0,5));
  if(stems.length&&!stems.every(s=>src.includes(s)))out.push(m[0]!.trim());
 }
 return out;
}
/** A promise of secrecy in a reply: never true of this chat. */
export const promisesSecrecy=(reply:string)=>/(?<![\p{L}])(?:i won'?t (?:tell|mention|pass|share)|i will not (?:tell|mention|pass|share)|stays? between us|keep (?:it|this) (?:from|secret|private)|не (?:скажу|передам|сообщу)|останется между нами|չեմ (?:ասի|փոխանցի|հայտնի))(?![\p{L}])/iu.test(reply.normalize('NFC'));

// ---- Nothing is withheld from the doctor -----------------------------------------------------------------------------------
const WITHHOLD=[
 /(?<![\p{L}])(?:don'?t|do not|never|please don'?t)\s+(?:(?:tell|inform|show|send|mention|say|pass)(?![\p{L}])(?!\s+me(?![\p{L}]))|let\s+(?:my\s+|the\s+)?(?:doctor|care team|nurse))[^.?!]{0,40}(?:doctor|dr|care team|nurse|know)|(?:keep|hide)(?![\p{L}])[^.?!]{0,40}from\s+(?:my\s+|the\s+)?(?:doctor|care team|nurse)|(?:doctor|care team)\s+(?:must not|mustn'?t|should not|shouldn'?t|can'?t|cannot|need not)\s+(?:know|see|find out)|(?:keep|stay|stays|remain)\p{L}*[^.?!]{0,30}between (?:us|you and me)/iu,
 /не\s+(?:говор\p{L}*|сообща\p{L}*|рассказыва\p{L}*|показыва\p{L}*|переда\p{L}*|отправля\p{L}*|пересыла\p{L}*)(?!\s+мне(?![\p{L}]))[^.?!]{0,40}(?:врач\p{L}*|доктор\p{L}*)|скр(?:ой|ойте|ыть)[^.?!]{0,40}от\s+(?:врач\p{L}*|доктор\p{L}*)|(?:врач|доктор)\p{L}*\s+не\s+(?:должен|должна|надо)\s+(?:знать|видеть)|(?:останется|оставим|пусть)[^.?!]{0,20}между нами/iu,
 /(?:բժշկ|բժիշկ)\p{L}*[^.։?]{0,40}(?:մի ասեք|մի ասա|մի ուղարկեք|մի փոխանցեք|չիմանա|չտեսնի)|մի (?:ասեք|ասա|ուղարկեք|փոխանցեք)[^.։?]{0,40}(?:բժշկ|բժիշկ)/iu,
];
/** The member asks that something stay away from the doctor (Monika 558): it never does. */
export const asksToWithhold=(raw:string)=>{const t=normaliseText(raw);return WITHHOLD.some(re=>re.test(t));};
export const WITHHOLD_LINE:Record<ReplyLanguage,string>={
 en:'I understand. Your care team can see this chat, and nothing about your health is kept from your doctor, so they get this too.',
 hy:'Հասկանում եմ։ Ձեր խնամքի թիմը տեսնում է այս զրույցը, և ձեր առողջության մասին ոչինչ չի թաքցվում բժշկից, ուստի նա սա էլ կստանա։',
 ru:'Понимаю. Ваша медицинская команда видит этот чат, и ничего о вашем здоровье от врача не скрывается, поэтому это тоже попадёт к нему.',
};

// ---- A questionnaire correction ----------------------------------------------------------------------------------------------
export type MemberStatement={subject:string;words:string};
/** The conditions the member's newest message disputes on their questionnaire ("I never had a stroke"). The read is conversation-memory's. */
export function questionnaireCorrections(latest:{seq:number;text:string},conditions:readonly string[]):MemberStatement[]{
 return conversationMemory({messages:[{...latest,minutesAgo:0}],answers:[],replies:[]},latest.seq,{conditions}).corrections.flatMap(c=>c.condition?[{subject:c.condition,words:c.words}]:[]);
}

// ---- The questionnaire, for a summary ------------------------------------------------------------------------------------------
/** Only what a summary needs. Never the red-flag questions: their answers are not background. */
export const QUESTIONNAIRE_FIELDS=['q2.height','q2.weight','q2.waist','q3.status','q3.years','q3.per_day','q3.quit_years_ago','q4.frequency','q4.drinks_per_day','q5.diagnosed','q6.hba1c','q7.relatives','q7.relative_age','q8.sleep_hours','q8.breathing','q8.daytime_sleepiness','q8.neck']as const;
const escTag=(t:string)=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export type QuestionnaireFacts=Readonly<Record<string,string|number|string[]>>;
/** An answer in the questionnaire's English words; an unanswered or "I don't know" field is not a fact. */
function shown(id:string,v:string|number|string[]|undefined){
 const options=(fieldById(id) as {options?:{value:string;label:{en:string}}[]}|undefined)?.options;
 const one=(x:string|number)=>options?.find(o=>o.value===x)?.label.en??String(x);
 return v===undefined||v===UNKNOWN||!fieldById(id)?null:Array.isArray(v)?v.map(one).join(', '):one(v);
}
/** The answers alone, without the questions' words, as sources for inventedNegatives. */
export const questionnaireAnswers=(answers:QuestionnaireFacts|null|undefined)=>QUESTIONNAIRE_FIELDS.flatMap(id=>{const v=answers?shown(id,answers[id]):null;return v?[v]:[];});
/** <member_questionnaire>: the member's own answers in the questionnaire's words. Unanswered stays out. Empty when there is nothing. */
export function questionnaireBlock(answers:QuestionnaireFacts|null|undefined){
 if(!answers)return '';
 const lines=QUESTIONNAIRE_FIELDS.flatMap(id=>{const v=shown(id,answers[id]);return v?[`${fieldById(id)!.label.en} ${v}`]:[];});
 const b=bmi(Object.fromEntries(Object.entries(answers).map(([k,value])=>[k,{value}])) as Answers);if(b!==null)lines.push(`BMI from these: ${b}.`);
 return lines.length?`<member_questionnaire>\nThe member's own answers on their questionnaire:\n${lines.map(escTag).join('\n')}\n</member_questionnaire>`:'';
}
