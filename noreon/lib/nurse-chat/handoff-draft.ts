import {isUnverifiedBp,unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import {quotesTypedBp} from '@/lib/staff-zoe/chat-reported';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';

/** A summary of the record for the nurse to hand over to the doctor, written by code from facts with dates. The model writes nothing: no advice, no
 * diagnosis, no dose, no threshold, no number the record does not hold. A source that could not be read is said so, never left as an empty claim.
 * The member's words are quoted verbatim (shortened with a visible mark), never rephrased. The nurse edits it and sends it through the hand-over
 * flow; her send is the only way it leaves. */
export type HandoffFacts={
 asOf:string;identity:string;
 bp:{entrySource?:string|null;systolic:number;diastolic:number;pulse:number|null;measuredAt:string;source:'manual'|'visit'|'device'}[]|null;
 tasks:{title:string;dueAt:string|null}[]|null;
 medicines:{name:string;dose:string|null;source:'plan'|'self';expected:number;taken:number;skipped:number;noReport:number}[]|null;
 medicinesFrom:string;medicinesTo:string;
 memberMessage:{text:string;at:string}|null;
};
/** The hand-over observation is capped at 2000 characters; the draft leaves the nurse at least 500 of them. */
export const HANDOFF_DRAFT_MAX=1500;
const QUOTE_MAX=200;
const BP_MAX=5,TASK_MAX=3,MED_MAX=3;

const quote=(text:string,l:StaffLocale)=>{
 const flat=text.replace(/\s+/gu,' ').trim();
 if([...flat].length<=QUOTE_MAX)return `“${flat}”`;
 const cut=[...flat].slice(0,QUOTE_MAX).join('').replace(/\s+\S*$/u,'');
 return `“${cut}…” (${st(l,'shortened','կրճատված է','сокращено')})`;
};

export function buildHandoffDraft(facts:HandoffFacts,l:StaffLocale):string{
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const sourceLabel={manual:t('member','անդամ','участник'),visit:t('visit','այց','визит'),device:t('device','սարք','устройство')};
 const sections:{key:string;lines:string[];omitted?:()=>string}[]=[];
 sections.push({key:'head',lines:[`${facts.identity}`,t(`Summary as of ${yerevanStamp(facts.asOf,l)}.`,`Ամփոփում ${yerevanStamp(facts.asOf,l)}-ի դրությամբ։`,`Сводка на ${yerevanStamp(facts.asOf,l)}.`)]});
 // Blood pressure, newest first.
 if(facts.bp===null)sections.push({key:'bp',lines:[t('Blood pressure: could not be read.','Արյան ճնշում՝ չհաջողվեց կարդալ։','Давление: не удалось прочитать.')]});
 else if(facts.bp.length){
  const rows=[...facts.bp].sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt));
  const shown=rows.slice(0,BP_MAX);
  sections.push({key:'bp',lines:[t('Blood pressure, last 7 days (newest first):','Արյան ճնշում, վերջին 7 օրը (նորերը առաջ)՝','Давление за 7 дней (сначала новые):'),...shown.map(r=>`- ${r.systolic}/${r.diastolic}${r.pulse!=null?` · ${t('pulse','զարկերակ','пульс')} ${r.pulse}`:''} · ${yerevanStamp(r.measuredAt,l)} · ${isUnverifiedBp(r)?unverifiedBpLabel(l):sourceLabel[r.source]}`)],omitted:rows.length>shown.length?()=>t(`- ${rows.length-shown.length} older readings not shown.`,`- ${rows.length-shown.length} ավելի հին չափում ցուցադրված չէ։`,`- ещё ${rows.length-shown.length} старых измерений не показано.`):undefined});
 }else sections.push({key:'bp',lines:[t('Blood pressure: no readings in the last 7 days.','Արյան ճնշում՝ վերջին 7 օրում չափում չկա։','Давление: за 7 дней измерений нет.')]});
 // Open nurse tasks.
 if(facts.tasks===null)sections.push({key:'tasks',lines:[t('Tasks: could not be read.','Առաջադրանքներ՝ չհաջողվեց կարդալ։','Задачи: не удалось прочитать.')]});
 else if(facts.tasks.length){
  const shown=facts.tasks.slice(0,TASK_MAX);
  sections.push({key:'tasks',lines:[t('Open tasks:','Բաց առաջադրանքներ՝','Открытые задачи:'),...shown.map(x=>`- ${x.title.replace(/\s+/gu,' ').slice(0,80)}${x.dueAt?` · ${t('due','ժամկետ','срок')} ${yerevanStamp(x.dueAt,l)}`:''}`)],omitted:facts.tasks.length>shown.length?()=>t(`- ${facts.tasks!.length-shown.length} more tasks not shown.`,`- ևս ${facts.tasks!.length-shown.length} առաջադրանք ցուցադրված չէ։`,`- ещё ${facts.tasks!.length-shown.length} задач не показано.`):undefined});
 }
 // Medicine reports, counts apart.
 if(facts.medicines===null)sections.push({key:'meds',lines:[t('Medicine reports: could not be read.','Դեղերի հաղորդումներ՝ չհաջողվեց կարդալ։','Отметки о лекарствах: не удалось прочитать.')]});
 else if(facts.medicines.length){
  const shown=facts.medicines.slice(0,MED_MAX);
  sections.push({key:'meds',lines:[t(`Medicine doses reported by the member, ${facts.medicinesFrom} to ${facts.medicinesTo}:`,`Անդամի հաղորդած դեղաչափեր, ${facts.medicinesFrom} – ${facts.medicinesTo}՝`,`Дозы лекарств, отмеченные участником, ${facts.medicinesFrom} – ${facts.medicinesTo}:`),...shown.map(m=>`- ${m.name}${m.dose?` ${m.dose}`:''}: ${t(`taken ${m.taken}, skipped ${m.skipped}, no report ${m.noReport} of ${m.expected}`,`ընդունված ${m.taken}, բաց թողնված ${m.skipped}, չի հաղորդվել ${m.noReport} (${m.expected}-ից)`,`принято ${m.taken}, пропущено ${m.skipped}, нет отметки ${m.noReport} из ${m.expected}`)}`)],omitted:facts.medicines.length>shown.length?()=>t(`- ${facts.medicines!.length-shown.length} more medicines not shown.`,`- ևս ${facts.medicines!.length-shown.length} դեղ ցուցադրված չէ։`,`- ещё ${facts.medicines!.length-shown.length} лекарств не показано.`):undefined});
 }
 // The member's latest words, verbatim, attributed.
 if(facts.memberMessage)sections.push({key:'msg',lines:[t(`The member wrote on ${yerevanStamp(facts.memberMessage.at,l)}:`,`Անդամը գրել է ${yerevanStamp(facts.memberMessage.at,l)}՝`,`Участник написал ${yerevanStamp(facts.memberMessage.at,l)}:`),`${quote(facts.memberMessage.text,l)}${quotesTypedBp(facts.memberMessage.text)?` · ${unverifiedBpLabel(l)}`:''}`]});
 const tail=`\n\n${t('Nurse observation:','Բուժքրոջ դիտարկում՝','Наблюдение медсестры:')} `;
 const render=()=>sections.map(section=>[...section.lines,...(section.omitted?[section.omitted()]:[])].join('\n')).join('\n\n')+tail;
 let text=render();
 // Over budget: shorten the less important sections first, always with a visible omission line, never by cutting a line in half.
 for(const key of ['meds','tasks','bp'] as const){
  while([...text].length>HANDOFF_DRAFT_MAX){
   const section=sections.find(s=>s.key===key);
   if(!section||section.lines.length<=2)break;
   section.lines.pop();
   const dropped=(section as {dropped?:number}).dropped=((section as {dropped?:number}).dropped??0)+1;
   section.omitted=()=>t(`- ${dropped} more not shown to keep the summary short.`,`- ևս ${dropped}-ը ցուցադրված չէ՝ ամփոփումը կարճ պահելու համար։`,`- ещё ${dropped} не показано, чтобы сводка осталась короткой.`);
   text=render();
  }
 }
 return text;
}
