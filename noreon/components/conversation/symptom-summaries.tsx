import {Stethoscope} from 'lucide-react';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {summaryLines} from '@/lib/zoe/symptoms/summary';
import type {SymptomIntakeView} from '@/lib/zoe/symptoms/contracts';
import {clinicalLocale,type Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {staffDisplayText,staffRuleLabel} from '@/lib/staff/display-text';

const STATE:Record<SymptomIntakeView['state'],{label:[string,string,string];tone:'neutral'|'due'|'complete'|'attention'}>={
 active:{label:['Zoe is still asking','Զոյան դեռ հարցեր է տալիս','Зоя ещё задаёт вопросы'],tone:'neutral'},completed:{label:['Summary ready','Ամփոփումը պատրաստ է','Сводка готова'],tone:'due'},stopped:{label:['Member stopped, summary ready','Անդամը դադարեցրել է, ամփոփումը պատրաստ է','Участник остановился, сводка готова'],tone:'due'},
 escalated:{label:['Urgent: 103 path shown','Շտապ. ցուցադրվել է 103 ուղին','Срочно: показана рекомендация звонить 103'],tone:'attention'},expired:{label:['Member stopped replying','Անդամը դադարել է պատասխանել','Участник перестал отвечать'],tone:'due'},
};

/** Staff presentation only. Stored symptom summaries and the shared member formatter are unchanged. */
export function SymptomSummaries({intakes,paused=false,locale='en'}:{intakes:SymptomIntakeView[]|null;paused?:boolean;locale?:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const title=t('Symptom summaries from Zoe','Ախտանիշների ամփոփումներ Զոյայից','Сводки симптомов от Зои');
 if(intakes===null)return <CareSection title={title}><p className="text-body2">{t('Zoe’s symptom summaries could not be loaded. The member’s messages below are unaffected.','Չհաջողվեց բեռնել Զոյայի ախտանիշների ամփոփումները։ Ստորև անդամի հաղորդագրությունները հասանելի են։','Не удалось загрузить сводки симптомов Зои. Сообщения участника ниже доступны.')}</p></CareSection>;
 if(!intakes.length)return null;
 return <CareSection title={title} detail={t('Zoe asked the questions of a symptom sheet and wrote down the member’s answers in their own words. She gave no advice. The member was told their care team will contact them.','Զոյան տվել է ախտանիշների թերթիկի հարցերը և գրանցել անդամի պատասխանները նրա բառերով։ Խորհուրդ չի տվել։ Անդամին ասվել է, որ խնամքի թիմը կապ կհաստատի նրա հետ։','Зоя задала вопросы из листа симптомов и записала ответы словами участника. Она не давала советов. Участнику сообщили, что с ним свяжется команда по уходу.')}>
  <ol className="space-y-5">{intakes.map(i=>{
   const lines=i.summary?summaryLines(i.summary,clinicalLocale(locale)):[];
   const [head,...rest]=lines;
   const draft=i.summary?.sheet.status==='draft'?rest.shift():null;
   // The shared formatter includes registry IDs in this row. Staff reads the saved structured hits instead.
   if(i.summary)rest.shift();
   const hits=i.summary?.redFlags.hits??[];
   const flags=hits.length?[...new Set(hits.map(hit=>staffRuleLabel(hit.id,locale,hit.rf)))].join('\n'):i.summary?t('Red flags: none found by the rules or in the answers.','Կարմիր դրոշներ. կանոններով և պատասխաններում չեն գտնվել։','Тревожные признаки: не найдены правилами или в ответах.'):null;
   return <li key={i.id} className="space-y-2 border-l-2 border-primary/20 pl-4">
    <p className="flex flex-wrap items-center gap-2"><Stethoscope className="size-4 shrink-0" aria-hidden/><span className="text-body2 font-semibold">{head?staffDisplayText(head,locale):t('Symptom summary','Ախտանիշների ամփոփում','Сводка симптомов')}</span><Status tone={STATE[i.state].tone}>{paused&&i.state==='active'?t('Paused while you answer','Դադարեցված է, մինչ պատասխանում եք','Приостановлено, пока вы отвечаете'):st(locale,...STATE[i.state].label)}</Status></p>
    {draft&&<p className="text-caption text-muted-foreground">{staffDisplayText(draft,locale)}</p>}
    {flags&&<p className={`whitespace-pre-line text-body2 ${hits.length?'font-semibold text-destructive':''}`}>{flags}</p>}
    {rest.length>0&&<dl className="grid gap-x-4 gap-y-1 text-body2 sm:grid-cols-[minmax(0,16rem)_1fr]">{rest.map((line,n)=>{const l=staffDisplayText(line,locale,true),at=l.indexOf(': ');return at<0?<dd key={n} className="sm:col-span-2">{l}</dd>:<div key={n} className="contents"><dt className="text-muted-foreground">{l.slice(0,at)}</dt><dd className="[overflow-wrap:anywhere]">{l.slice(at+2)}</dd></div>;})}</dl>}
    <p className="text-caption text-muted-foreground">{t('Started','Սկսվել է','Начато')} {stamp(i.startedAt,locale)}{i.finishedAt?` · ${t('ended','ավարտվել է','завершено')} ${stamp(i.finishedAt,locale)}`:''}</p>
   </li>;})}</ol>
 </CareSection>;
}
