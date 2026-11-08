import {hasSameDayWarning,SIGN_103,FORWARD_LINE} from './task-warning';
export {hasSameDayWarning,hasOpenTaskWarning} from './task-warning';
import {bpReadings} from './bp-parse';
import {FREE_MODE_CONFIG} from './free-mode-config';
import {normaliseText} from './normalise';
import {TIER_RULES} from './routing';
import {sameDayFloor} from './health-answer';
import {asserted,symptomAsserted,textRedFlags} from './symptoms/red-flags';
import {symptomMeanings} from './symptom-words';

/**
 * Zoe's memory of the conversation (lead decision 30 Oct 23:16: "conversation state held in code"). Read each turn from the same
 * window the run already has (the last 20 messages and Zoe's answers, no new table), so it survives a topic break, which takes the
 * earlier turns out of the model's input. It holds what she already warned about, what she promised, what the member objected to or
 * corrected, and what the member already said.
 *
 * It is told to her as <conversation_memory> and, as a two-way check, a reply that repeats a warning already given is held like one
 * that understates urgency: one regenerate with the reason. The second text goes out whatever it says, so a repeat never cuts a word of
 * safety advice, never lowers a level and never reaches the careful line. The conversation suite counts what still repeats.
 *
 * Text only: what is said is read from the words, in English, Armenian (both scripts) and Russian. These are engineering patterns,
 * not clinical content. The urgency level is never read or set here.
 */
export const MEMORY_VERSION='zoe-memory-3';
/** A warning older than this is history: it is still told, but repeating it is no longer a failure. */
export const MEMORY_WARNING_HOURS=12;

const DOCTOR_SOON=/(?:coming|next few) days|առաջիկա օրերին|մոտակա օրերին|հաջորդ օրերին|в ближайшие дни|в ближайшие несколько дней/iu;
/** The app's own line after an automatic forward (health-answer.ts autoLine). */
const PROMISE=/won'?t (?:repeat|mention|bring|say|remind|keep)|i'?ll (?:leave it|stop|not (?:repeat|mention)|keep it (?:short|to)|focus on|only bring)|i will (?:leave it|stop|not (?:repeat|mention)|keep it (?:short|to))|չեմ կրկնի|այլևս չեմ|էլ չեմ (?:կրկն|հիշեցն|նշ|ասի)|կթողնեմ|կասեմ կարճ|не буду (?:повторять|напоминать|упоминать)|больше не (?:буду|стану)/iu;
// Parts of the same-day block, beyond "today".
const BLOCK_PARTS=[/2 to 4 hours|2-4 ժամ|2–4 ժամ|2-4 час|2–4 час/iu,/\bbring\b|take (?:your|the|along)|Վերցրեք|վերցրեք|վերցնել|возьмите/u,/\balone\b|միայնակ|одн(?:и|ому|ой)\b/iu,/\bdrive\b|մեքենա|за руль/iu,/polyclinic|urgent care|պոլիկլինիկ|հերթապահ|поликлиник|неотложн/iu];
const ASKS_WHAT_TO_DO=/(?<![\p{L}])(?:what should i|what do i|where (?:do|should) i|who should|should i go|can i go|ինչ անեմ|ինչ վերցն\p{L}*|ուր գնամ|որտեղ գնամ|գնա՞մ|что делать|что взять|куда (?:идти|ехать|мне)|к кому)(?![\p{L}])/iu;
const SENTENCE=/(?<=[.!?։՞？])\s+|\n+/u;

const OBJECTION=/(?<![\p{L}])(?:(?:stop|quit) (?:telling|reminding|saying|mentioning|repeating|asking|nagging|sending|it|that)|that'?s enough|enough (?:already|now)|leave it|leave me|annoying|annoyed|nagg\p{L}*|you keep|keep (?:saying|telling|repeating|asking)|same thing|repeating yourself|i can read|i get it|i heard you|do you have to|you already (?:said|told)|already told me|don'?t (?:tell|remind) me|no more (?:reminders|warnings)|կրկն\p{L}*|նույն բան\p{L}*|հերիք|բավական է|ձանձր\p{L}*|հոգնեցր\p{L}*|զզվ\p{L}*|զզվեցր\p{L}*|մի ասեք|էլ մի\p{L}*|nuyn ban\p{L}*|krkn\p{L}*|heriq|herik|bavakan|zzv\p{L}*|haskacanq|хватит|надоел\p{L}*|перестань\p{L}*|перестаньте|повторя\p{L}*|одно и то же|сколько можно|отстань\p{L}*|не напоминай\p{L}*|уже (?:сказал\p{L}*|говорил\p{L}*))(?![\p{L}])/iu;
const REFUSES_DOCTOR=/(?<![\p{L}])(?:(?:don'?t|do not) want to (?:go|see)|won'?t go|not going|(?:i'?m|i am) not (?:going|seeing)|chem uzum gnam|չեմ ուզում (?:գնալ|գնամ)|չեմ գնա|не хочу (?:идти|к врачу|ехать)|не пойду|не поеду)(?![\p{L}])/iu;
const CONDITION_WORDS:Record<string,RegExp>={stroke:/stroke|(?<![\p{L}])tia(?![\p{L}])|insult|инсульт|ինսուլտ/iu,diabetes:/diabet|диабет|դիաբետ|շաքարախտ|shaqarax/iu,prediabetes:/prediabet|преддиабет|նախադիաբետ/iu,kidney:/kidney|почк|երիկամ|erikam/iu,
 ascvd:/heart attack|stent|infarct|инфаркт|стент|ինֆարկտ|ստենտ/iu,heart_failure:/heart failure|сердечн\p{L}* недостаточн|սրտի անբավարար/iu,af:/atrial|arrhythm|аритм|фибрилляц|առիթմ/iu,dyslipidaemia:/cholesterol|холестерин|խոլեստերին|xolesterin/iu};
const CONDITION_LABEL:Record<string,string>={stroke:'a stroke or TIA',diabetes:'diabetes',prediabetes:'prediabetes',kidney:'chronic kidney disease',ascvd:'a heart attack or stent',heart_failure:'heart failure',af:'an arrhythmia',dyslipidaemia:'high cholesterol'};
// The condition itself denied, by the member: right next to the words ("never had a stroke", "ինսուլտ չեմ տարել", "у меня не было инсульта").
const DENIED_BEFORE=String.raw`(?<![\p{L}])(?:never had|didn'?t have|did not have|don'?t have|do not have|haven'?t had|have not had|hadn'?t had|no history of|չեմ ունեցել|չունեմ|չեմ տարել|не было|нет|не переносил\p{L}*|не болел\p{L}*)\s+(?:(?:a|an|any)\s+)?`;
const DENIED_AFTER=String.raw`\s+(?:չեմ տարել|չեմ ունեցել|չունեմ|chem tarel|chem unecel|chunem|не было|нет|не переносил\p{L}*|is wrong|is a mistake|is not right|is not true|սխալ է|sxal e)(?![\p{L}])`;
const SOMEONE_ELSE=/(?<![\p{L}])(?:my |his |her |our )(?:mother|mom|mum|father|dad|husband|wife|son|daughter|brother|sister|grand\p{L}+|friend|neighbou?r)|(?:мама|маме|маму|папа|папе|отец|отца|отцу|муж|мужа|жена|жены|брат|брата|сестра|сестры|бабушк\p{L}*|дедушк\p{L}*)(?![\p{L}])|մայրս|մամաս|հայրս|պապաս|ամուսինս|կինս|տղաս|աղջիկս|եղբայրս|քույրս|(?<![\p{L}])(?:mams|paps|hors|mors|amusins|kins)(?![\p{L}])/iu;
// Require a complete condition phrase, not an arbitrary gap or a list of related things to exclude (MEM-04).
const deniedByMember=(t:string,word:RegExp)=>{
 const condition=String.raw`(?<![\p{L}])(?:${word.source})\p{L}*(?:\s+disease)?`;
 return !SOMEONE_ELSE.test(t)&&(new RegExp(`${DENIED_BEFORE}${condition}(?=\\s*(?:$|[.,;:!]|(?:and|but)(?![\\p{L}])))`,'iu').test(t)||new RegExp(`${condition}${DENIED_AFTER}`,'iu').test(t));
};
const WRONG_FACT=/(?<![\p{L}])(?:that'?s (?:wrong|not (?:true|right|correct))|not true|i never said|i didn'?t say|սխալ է|ճիշտ չէ|sxal e|chisht chi|неправда|это не так|я такого не говорил\p{L}*)(?![\p{L}])/iu;
const healthWords=TIER_RULES.filter(r=>r.tier==='high');

export type MemoryWindow={messages:readonly {seq:number;text:string;minutesAgo:number}[];answers:readonly {body:string;minutesAgo:number}[];replies:readonly {body:string;minutesAgo:number}[]};
export type ConversationMemory={
 /** New evidence is checked before any repetition heuristic; it never changes triage. */
 newWarningInformation:boolean;
 /** Warnings in Zoe's own answers since the doctor's newest reply: how many, and the newest in minutes. */
 said:{sameDay:number;doctorSoon:number;signs103:number;forwarded:number;sameDayAgo:number|null;doctorSoonAgo:number|null;signs103Ago:number|null};
 /** Her quoted numbers, her questions and her promises, in her words. */
 numbers:string[];questions:string[];promises:string[];
 /** The member's words, each once, oldest first. */
 objections:string[];corrections:{condition:string|null;words:string}[];refusedDoctor:boolean;
 /** Earlier member messages the model no longer sees in this topic. */
 earlier:string[];
 endedOnQuestion:boolean;
};
const cut=(t:string,n:number)=>{const x=t.replace(/\s+/gu,' ').trim();return x.length>n?`${x.slice(0,n)}…`:x;};
const sentences=(t:string)=>t.split(SENTENCE).map(s=>s.trim()).filter(Boolean);
const endsOnQuestion=(t:string)=>{const line=t.replace(FORWARD_LINE,'').trim().split(/\n+/u).at(-1)??'';return /[?՞？]/u.test(sentences(line).at(-1)??'');};
const uniq=<T>(xs:readonly T[])=>[...new Set(xs)];

/**
 * What the window remembers for the newest message. `dropped`: the earlier member messages the topic step took out (or none).
 * `conditions`: the questionnaire's codes (a correction is matched against them).
 */
export function conversationMemory(w:MemoryWindow,latestSeq:number,o:{dropped?:readonly string[];conditions?:readonly string[]}={}):ConversationMemory{
 const lastDoctor=Math.min(Infinity,...w.replies.map(r=>r.minutesAgo));
 const answers=w.answers.filter(a=>a.minutesAgo<lastDoctor||lastDoctor===Infinity);
 const count=(re:RegExp)=>answers.filter(a=>re.test(a.body)).length;
 const newest=(re:RegExp)=>answers.filter(a=>re.test(a.body)).at(-1)?.minutesAgo??null;
 const sameDay=answers.filter(a=>hasSameDayWarning(a.body));
 const said={sameDay:sameDay.length,doctorSoon:count(DOCTOR_SOON),signs103:count(SIGN_103),forwarded:count(FORWARD_LINE),sameDayAgo:sameDay.at(-1)?.minutesAgo??null,doctorSoonAgo:newest(DOCTOR_SOON),signs103Ago:newest(SIGN_103)};
 const mine=w.answers.flatMap(a=>sentences(a.body.replace(FORWARD_LINE,'')));
 const member=w.messages.filter(m=>m.seq!==latestSeq);
 const all=w.messages;
 const conditions=o.conditions??[];
 const corrections:ConversationMemory['corrections']=[];
 for(const m of all)for(const s of sentences(m.text)){
  if(/[?՞？]/u.test(s))continue;
  const t=normaliseText(s);
  const hit=conditions.find(c=>CONDITION_WORDS[c]&&deniedByMember(t,CONDITION_WORDS[c]!));
  if(hit)corrections.push({condition:hit,words:cut(s,140)});
  else if(WRONG_FACT.test(t))corrections.push({condition:null,words:cut(s,140)});
 }
 return {said,newWarningInformation:hasNewWarningInformation(w.messages.find(m=>m.seq===latestSeq)?.text??'',member.map(m=>m.text),w.answers.map(a=>a.body)),
  numbers:uniq(w.answers.flatMap(a=>a.body.match(/(?<![\d/.])\d{2,3}\/\d{2,3}(?![\d/.])/gu)??[])).slice(-6),
  questions:uniq(mine.filter(s=>/[?՞？]/u.test(s)).map(s=>cut(s,110))).slice(-4),
  promises:uniq(mine.filter(s=>PROMISE.test(s)).map(s=>cut(s,140))).slice(-3),
  objections:uniq(all.filter(m=>OBJECTION.test(normaliseText(m.text))).map(m=>cut(m.text,120))).slice(-3),
  corrections:corrections.filter((c,i)=>corrections.findIndex(x=>x.words===c.words)===i).slice(-3),
  refusedDoctor:all.some(m=>REFUSES_DOCTOR.test(normaliseText(m.text))),
  earlier:uniq((o.dropped??[]).filter(t=>member.some(m=>m.text===t)).map(t=>cut(t,120))).slice(-4),
  endedOnQuestion:endsOnQuestion(w.answers.at(-1)?.body??'')};
}

const fresh=(ago:number|null)=>ago!==null&&ago<=MEMORY_WARNING_HOURS*60;
const times=(n:number)=>n===1?'once':`${n} times`;
const ago=(m:number|null)=>m===null?'':m<60?`, last ${m} minutes ago`:`, last about ${Math.round(m/60)} hours ago`;
/** The newest message is about health, so what the member said earlier today may bear on it. A remark about the weather is not. */
export const healthMessage=(text:string)=>{const t=normaliseText(text);return !!bpReadings(t).length||healthWords.some(r=>r.re.test(t));};
/** The block for the model. Empty when there is nothing to remember, so a first message's input does not change. `clean` redacts, `esc` escapes. */
export function memoryBlock(m:ConversationMemory,o:{clean:(t:string)=>string;esc:(t:string)=>string;latest:string}){
 const q=(t:string)=>`"${o.esc(o.clean(t))}"`;
 const lines:string[]=[];
 const s=m.said;
 // A warning older than MEMORY_WARNING_HOURS is history: telling it would carry an old level into a new matter.
 if(fresh(s.sameDayAgo))lines.push(`You already gave the same-day advice ${times(s.sameDay)}${ago(s.sameDayAgo)}.`);
 if(fresh(s.doctorSoonAgo))lines.push(`You already said the doctor should see this in the coming days ${times(s.doctorSoon)}${ago(s.doctorSoonAgo)}.`);
 if(fresh(s.signs103Ago))lines.push(`You already gave the 103 warning ${times(s.signs103)}. Do not repeat it unless there is new urgent information or the member asks what to do.`);
 if(s.forwarded)lines.push('The member already knows this went to the doctor.');
 if(m.numbers.length)lines.push(`Numbers you already quoted: ${m.numbers.join(', ')}.`);
 if(m.questions.length)lines.push(`Questions you already asked: ${m.questions.map(q).join(' ')}`);
 if(m.endedOnQuestion)lines.push('Your last reply ended on a question: end this one on a statement.');
 if(m.promises.length)lines.push(`What you promised, in your words, which still binds you: ${m.promises.map(q).join(' ')}`);
 if(m.objections.length)lines.push(`<member_asked_to_stop>The member objected, in their words: ${m.objections.map(q).join(' ')} Do not do again what they objected to. Do not apologise at length.</member_asked_to_stop>`);
 for(const c of m.corrections)lines.push(c.condition
  ?`The member disputes the questionnaire, in their words: ${q(c.words)}. It lists ${CONDITION_LABEL[c.condition]??'this condition'}. Say once, plainly, "you told me this, your record says that", point to Me to correct it, and stop stating it as a fact.${FREE_MODE_CONFIG.pendingClinical.disputedConditionCounts?' It still counts for the urgency level until a doctor confirms.':''}`
  :`The member corrected you, in their words: ${q(c.words)}. Take the correction; if your record says otherwise, say so once, plainly.`);
 if(m.refusedDoctor)lines.push('The member said they do not want to go to the doctor. Do not argue, and do not say you will stop or that the decision is theirs: keep the level without repeating the referral unless something new requires it.');
 if(m.earlier.length&&healthMessage(o.latest))lines.push(`What the member said earlier in this chat, so you need not ask again (background, never a topic to bring up): ${m.earlier.map(q).join(' ')}`);
 return lines.length?`<conversation_memory>\n${lines.join('\n')}\n</conversation_memory>`:'';
}
/** One line for the reply check: what was already said, so a short follow-up is not read as a lower level. */
export function memoryContext(m:ConversationMemory){
 const said=[...(m.said.sameDay?[`the same-day advice ${times(m.said.sameDay)}`]:[]),...(m.said.doctorSoon?[`"the doctor in the coming days" ${times(m.said.doctorSoon)}`]:[])];
 return said.length?`Already said to the member in this chat: ${said.join(', ')}. This is what she said, not the level now: it never makes the newest message more urgent. Omitting the already-given warning on an ordinary follow-up does not lower the level; new urgent information still requires its full advice.`:'';
}

// ---- The other direction of the check ----------------------------------------------------------------------------------------
const tokens=(s:string)=>new Set(s.toLowerCase().match(/[\p{L}\d/]+/gu)??[]);
const overlap=(a:Set<string>,b:Set<string>)=>{let i=0;for(const x of a)if(b.has(x))i++;return i/(a.size+b.size-i);};
const repeatsEarlier=(s:string,earlier:readonly Set<string>[])=>{const t=tokens(s);return t.size>=5&&earlier.some(e=>e.size>=5&&overlap(t,e)>=.55);};
// Wider than the same-day wording above, because it only keeps the stronger model (Astra ZCD-04): 103, or "today" beside a doctor or care word in one sentence.
const MAYBE_OPEN=/(?<![\d/.])103(?![\d/]|\.\d)|same day|emergency|շտապ|скорую|неотложн/iu,OPEN_TODAY=/\btoday\b|\btonight\b|այսօր|сегодня/iu,CARE=/doctor|clinic|urgent care|checked|seen|բժիշկ|բժշկ|պոլիկլինիկ|врач|поликлиник|осмотр/iu;
const leavesOpen=(t:string)=>MAYBE_OPEN.test(t)||FORWARD_LINE.test(t)||sentences(t).some(x=>OPEN_TODAY.test(x)&&CARE.test(x));
/** A same-day matter may be open: a warning or the app's forward line in Zoe's answers of the last hours, with no doctor's reply since. */
export const mayBeOpen=(w:MemoryWindow)=>{const lastDoctor=Math.min(Infinity,...w.replies.map(r=>r.minutesAgo));
 return w.answers.some(a=>a.minutesAgo<lastDoctor&&a.minutesAgo<=MEMORY_WARNING_HOURS*60&&leavesOpen(a.body));};
const blockParts=(t:string)=>BLOCK_PARTS.filter(re=>re.test(t)).length;
const WORSENING=/getting worse|worsening|worse now|ուժեղանում|ուժեղացել|վատանում|ավելի վատ|ujexanum|ujexacel|vatacel|aveli vat|стало хуже|становится хуже|усилива\p{L}*/u;
/** Reuse the existing evidence parsers, without creating another urgency policy. */
function hasNewWarningInformation(latest:string,earlier:readonly string[],answers:readonly string[]):boolean{
 const t=normaliseText(latest);
 if(textRedFlags([latest],{intakeActive:false,symptomContextTexts:[...earlier,latest]}).length)return true;
 if(asserted(t,WORSENING)&&(healthMessage(latest)||earlier.some(healthMessage)))return true;
 if(symptomAsserted(latest)){
  const known=new Set(earlier.filter(s=>symptomAsserted(s)).flatMap(s=>[...symptomMeanings(s)]));
  if([...symptomMeanings(latest)].some(s=>!known.has(s)))return true;
 }
 if(!sameDayFloor([latest],null))return false;
 const readings=bpReadings(t);
 if(readings.length){
  const previous=earlier.flatMap(s=>bpReadings(normaliseText(s))).at(-1)??answers.flatMap(s=>bpReadings(normaliseText(s))).at(-1);
  return !previous||readings.some(r=>r.systolic!==previous.systolic||r.diastolic!==previous.diastolic);
 }
 return !earlier.some(s=>normaliseText(s)===t);
}
export const warningRepeatAllowed=(m:ConversationMemory,latest:string)=>m.newWarningInformation||ASKS_WHAT_TO_DO.test(normaliseText(latest).replaceAll('՞',''))||/[?՞？]/u.test(latest)&&blockParts(latest)>0;
export type RepeatFinding='repeat.same_day_block'|'repeat.same_day_warning'|'repeat.signs103'|'repeat.doctor_soon'|'repeat.sentences';
/**
 * What a reply repeats of what was already said. Same-day: two or more parts of the block again. Doctor soon: the same sentence's
 * point again at the same level. Any level: two or more sentences of an earlier answer. A new warning, or the first at a level, is never a repeat.
 */
export function repeatFindings(reply:string,m:ConversationMemory,earlierAnswers:readonly string[],urgency:string,latest=''):RepeatFinding[]{
 const out:RepeatFinding[]=[];
 // Asked again: a repeat is the answer (Astra MEM-02).
 if(warningRepeatAllowed(m,latest))return out;
 if(fresh(m.said.sameDayAgo)&&hasSameDayWarning(reply))out.push('repeat.same_day_warning');
 if(fresh(m.said.signs103Ago)&&SIGN_103.test(reply))out.push('repeat.signs103');
 if(fresh(m.said.sameDayAgo)&&blockParts(reply)>=2)out.push('repeat.same_day_block');
 if(fresh(m.said.doctorSoonAgo)&&urgency==='doctor_soon'&&DOCTOR_SOON.test(reply))out.push('repeat.doctor_soon');
 const earlier=earlierAnswers.flatMap(a=>sentences(a.replace(FORWARD_LINE,''))).map(tokens);
 if(sentences(reply).filter(s=>repeatsEarlier(s,earlier)).length>=2)out.push('repeat.sentences');
 return out;
}
