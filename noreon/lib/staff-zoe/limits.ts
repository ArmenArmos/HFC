import {st} from '@/lib/staff/staff-locale-copy';
import {analyteName} from './analyte';
import type {Fact,L,Quote,ToolResult} from './contracts';

/**
 * Doctor Zoe's limits in the pilot, by code, so they hold whatever the model chooses (armen-cases Task 18). Summaries, status
 * against the doctor's target and guideline text only: no causes, tests, medicines, doses or clearance. These read the
 * doctor's question and the record, never a member's words, and they only add fixed lines or keep a fact on screen.
 */
export type RedLine='cause'|'test'|'medicine'|'clearance';
// Decision wording only: "what dose is he on" is a status question, "what dose should I give" is not.
const RED_LINES:readonly [RedLine,RegExp][]=[
 ['cause',/\bwhy (?:does|do|is|are|has|have)\b.{0,40}\b(?:hurt\w*|pain\w*|ach\w*|sore|high|low|raised|dizzy|tired|swollen)\b|\b(?:possible|likely|underlying|probable) causes?\b|\bwhat(?:'s| is| could be)? (?:the )?(?:cause|causing)\b|\bcaused by\b|\bis (?:the |this |that |it )?(?:\w+ )?causing\b|\bis (?:this|that|it) (?:a |an )?(?:\w+ )?(?:side effect|from the|because of|due to)\b|\bdiagnose\b|почему.{0,30}(?:болит|боль|высок|низк)|причин\p{L}*.{0,20}(?:бол|симптом|повыш|сниж)|поставь\p{L}* диагноз|ինչու.{0,30}ցավ|պատճառ.{0,20}(?:ցավ|ախտանիշ)|ախտորոշիր/iu],
 ['test',/\b(?:which|what) (?:\w+ )?tests? (?:should|to|would)\b|\bshould (?:i|we|he|she|they)\b.{0,30}\b(?:order|test|check|repeat|recheck|have|get)\b|^(?:please )?order\b|(?:какой|какие) анализ\p{L}* (?:назначить|сделать|нужн\p{L}*)|назначь\p{L}* анализ|ինչ (?:թեստ|անալիզ)\p{L}* նշանակ/iu],
 ['medicine',/\bshould (?:i|we|he|she|they)\b.{0,40}\b(?:add|start|stop|raise|increase|lower|reduce|change|switch|double|prescribe|take)\b|\b(?:would|do) you (?:add|start|stop|raise|increase|lower|reduce|change|switch|double|prescribe)\b|\b(?:what|which) (?:\w+ )?(?:dose|medicine|drug|statin) (?:should|to|would)\b|\braise (?:him|her|them)\b|^(?:please )?(?:add|start|stop|raise|increase|lower|reduce|double|switch|prescribe)\b|(?:какую дозу|какой препарат) (?:дать|назначить|выбрать)|что назначить|^(?:увеличить|уменьшить|снизить|повысить|отменить|добавить|назначить)(?![\p{L}])|ինչ (?:դեղ|դեղաչափ)\p{L}* նշանակ|նշանակիր/iu],
 ['clearance',/\b(?:safe|ok|okay|fine) (?:to|for)\b.{0,40}\b(?:discharg\w*|gym|sport\w*|exercis\w*|drive|driving|fly|work|train\w*|run\w*|activity)\b|\b(?:can|may) (?:he|she|they)\b.{0,30}\b(?:discharg\w*|gym|sport\w*|exercis\w*|drive|fly|work|train\w*|run)\b|\bcleared (?:for|to)\b|\bapproved?\b.{0,30}\b(?:sport\w*|gym|exercise|activity)\b|можно ли.{0,30}(?:спорт|зал|выпис|бег|работ|водит)|կարո՞?ղ.{0,30}(?:մարզ|աշխատ|վարել)/iu],
];
export const redLineOf=(question:string):RedLine|null=>RED_LINES.find(([,re])=>re.test(question))?.[0]??null;

const GUIDELINE=/\bguidelines?\b|рекомендаци\p{L}*|ուղեցույց/iu;
const APP_ACTION=/\b(?:publish|release|close|resolve|dismiss)\b.{0,40}\b(?:plans?|results?|labs?|alerts?)\b|опубликуй|выпусти.{0,20}результат|закрой.{0,20}оповещ|հրապարակիր|փակիր.{0,20}ահազանգ/iu;
const SEND=/\b(?:draft|send|write)\b(?: \w+){0,4} (?:message|reply)\b|^(?:please )?(?:send|tell) (?:him|her|them)\b|напиши.{0,20}сообщен|отправь|գրիր.{0,20}հաղորդագր|ուղարկիր/iu;
export const asksSend=(question:string)=>SEND.test(question);
const ALLERGY=/allerg\p{L}*|аллерг\p{L}*|ալերգ\p{L}*/iu;
/** Member words that try to steer Zoe. Flagged on the card, and a summary then cannot leave any recent member message out. */
const MEMBER_ORDER=/\b(?:tell|ask|inform) (?:the |my )?doctor (?:to\b|.{0,40}\b(?:at goal|approved|cleared|double|increase|stop)\b)|\b(?:do not|don'?t|never) (?:mention|tell|show|include|report)\b|\bleave\b.{0,30}\bout\b|\bsystem note\b|\bdoctor (?:has )?approved\b|скажи(?:те)? врачу|не говори(?:те)? врачу|не упоминай(?:те)?|врач одобрил|системн\p{L}* заметк|բժշկին մի ասա|ասա բժշկին|մի նշիր/iu;
export const memberOrder=(text:string)=>MEMBER_ORDER.test(text);

export const limitCopy={
 appOnly:(l:L)=>st(l,'Publishing a plan, releasing results and closing clinical alerts are done in the app, by you.','Պլանի հրապարակումը, արդյունքների տրամադրումը և կլինիկական ահազանգերի փակումը դուք եք անում հավելվածում։','Публикацию плана, выдачу результатов и закрытие клинических оповещений вы выполняете в приложении.'),
 send:(l:L)=>st(l,'I send nothing from here. Messages go from the conversation, and a result goes out only after you have reviewed it.','Այստեղից ոչինչ չեմ ուղարկում։ Հաղորդագրությունները գնում են զրույցից, իսկ արդյունքը՝ միայն ձեր վերանայումից հետո։','Отсюда я ничего не отправляю. Сообщения уходят из разговора, а результат только после вашей проверки.'),
 guideline:(l:L)=>st(l,'No approved guideline text is available yet.','Հաստատված ուղեցույցի տեքստ դեռ չկա։','Утверждённого текста рекомендаций пока нет.'),
 allergy:(l:L)=>st(l,'Allergies are not in what I read. That does not mean there are none.','Ալերգիաները իմ կարդացածի մեջ չկան։ Դա չի նշանակում, որ դրանք չկան։','Аллергий нет в прочитанном. Это не значит, что их нет.'),
 planList:(l:L)=>st(l,'This is the plan\'s list. The record does not prove what is taken each day.','Սա պլանի ցանկն է։ Գրառումը չի ապացուցում, թե ինչ է ընդունվում ամեն օր։','Это список из плана. Запись не доказывает, что принимается каждый день.'),
 ticks:(l:L)=>st(l,'A missing tick does not prove a missed dose.','Բաց թողնված նշումը չի ապացուցում բաց թողնված դեղաչափ։','Отсутствие отметки не доказывает пропуск дозы.'),
 noValue:(l:L,name:string)=>st(l,`No ${name} in what I read.`,`${name}՝ իմ կարդացածի մեջ չկա։`,`${name}: нет в прочитанном.`),
};
const PLAN_MEDICINE=['Plan medicine','Պլանի դեղ','Препарат плана'];

/** The fixed lines of a turn. Whatever the question was, these are the app's words, not the model's. */
export function noticeLines(question:string,facts:readonly Fact[],l:L){
 return [...(APP_ACTION.test(question)?[limitCopy.appOnly(l)]:[]),...(SEND.test(question)?[limitCopy.send(l)]:[]),
  ...(facts.some(f=>PLAN_MEDICINE.includes(f.label))?[limitCopy.planList(l)]:[]),...(facts.some(f=>f.id.startsWith('adherence.'))?[limitCopy.ticks(l)]:[])];
}
/** What is missing, named. `unanswered` holds lab values; 'unrecognised' is a name the code does not know. */
export function gapLines(question:string,unanswered:readonly string[],generic:string|null,l:L){
 const named=unanswered.filter(n=>n!=='unrecognised').map(n=>limitCopy.noValue(l,analyteName(n)));
 return [...(GUIDELINE.test(question)?[limitCopy.guideline(l)]:[]),...(ALLERGY.test(question)?[limitCopy.allergy(l)]:[]),...(named.length?named:generic?[generic]:[])];
}

const reviewedOf=(n:string,read:readonly ToolResult[])=>read.flatMap(r=>r.facts).filter(f=>f.analyte===n&&f.mark==='reviewed'&&f.date).sort((a,b)=>b.date!.localeCompare(a.date!))[0];
/** A value asked for that has a reviewed value on file shows it, with its date. What is then still missing stays named, and the turn stops there. */
export function lastReviewed(unanswered:readonly string[],read:readonly ToolResult[]){
 const found=unanswered.flatMap(n=>{const f=reviewedOf(n,read);return f?[{n,f}]:[];});
 return {facts:found.map(x=>x.f),unanswered:unanswered.filter(n=>!found.some(x=>x.n===n))};
}
/** An unreviewed value leads the answer whenever its value is on the table, whether the model chose it or not. The LDL record's line wins over the same result's lab line. */
export function openWithUnreviewed(chosen:readonly Fact[],read:readonly ToolResult[],scope:{summary:boolean;named:readonly string[];ldl:boolean}){
 const topics=new Set([...scope.named,...(scope.ldl?['ldl_c']:[]),...chosen.flatMap(f=>f.analyte?[f.analyte]:[])]);
 const stored=[...read].sort((a,b)=>Number(b.tool==='ldl')-Number(a.tool==='ldl')).flatMap(r=>r.facts).filter(f=>f.mark==='not_reviewed'&&(scope.summary||(f.analyte!==null&&topics.has(f.analyte))));
 const key=(f:Fact)=>f.analyte?`${f.analyte}|${f.date}`:f.id;
 const opening=new Map<string,Fact>();
 for(const f of [...stored,...chosen.filter(x=>x.mark==='not_reviewed')])if(!opening.has(key(f)))opening.set(key(f),f);
 return [...opening.values(),...chosen.filter(f=>f.mark!=='not_reviewed')];
}
/** A member who tried to steer Zoe cannot get anything left out: on a summary or a messages question every member message read is shown. */
export function keptQuotes(chosen:readonly Quote[],read:readonly ToolResult[],wide:boolean){
 const members=read.flatMap(r=>r.tool==='member_messages'?r.quotes.filter(q=>q.nurseName===undefined&&!q.zoe):[]);
 if(!wide||!members.some(q=>q.flagged))return [...chosen];
 return [...chosen,...members.filter(q=>!chosen.includes(q))];
}
