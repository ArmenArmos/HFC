'use client';
import {bpUnit} from '@/lib/bp-unit';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {GraphId,PatientGraphs as Graphs} from '@/lib/staff-zoe/patient-graphs';
import {TrendChart,Sparkline} from '@/components/charts/trend-chart';
import type {TrendData} from '@/components/charts/types';
export function graphCopy(id:GraphId,l:StaffLocale){
 const titles:Record<GraphId,[string,string,string]>={bp:['Blood pressure','Զարկերակային ճնշում','Артериальное давление'],ldl:['LDL-C','ՑԽԼ խոլեստերին (LDL-C)','Холестерин ЛПНП (LDL-C)'],hba1c:['HbA1c','Գլիկացված հեմոգլոբին (HbA1c)','Гликированный гемоглобин (HbA1c)'],egfr:['eGFR','Կծիկային ֆիլտրացիա (eGFR)','Скорость клубочковой фильтрации (eGFR)'],pulse:['Pulse','Զարկերակ','Пульс'],weight:['Weight','Քաշ','Вес'],streak:['Days measured per week','Շաբաթվա չափման օրերը','Дни измерений за неделю']};
 const units:Record<GraphId,string>={bp:bpUnit(l),ldl:'mmol/L',hba1c:'%',egfr:'mL/min/1.73m²',pulse:st(l,'beats/min','զարկ/րոպե','уд/мин'),weight:st(l,'kg','կգ','кг'),streak:st(l,'days','օր','дней')};
 return {title:st(l,...titles[id]),unit:units[id],labels:id==='bp'?[st(l,'Systolic','Սիստոլիկ','Систолическое'),st(l,'Diastolic','Դիաստոլիկ','Диастолическое')]:[st(l,...titles[id])],entity:id==='bp'?'bp' as const:id==='ldl'?'ldl' as const:id==='streak'?'adherence' as const:'other' as const,
 emptyText:id==='bp'||id==='pulse'?st(l,'Needs 2 readings in the last 2 weeks','Պետք է 2 չափում վերջին 2 շաբաթվա ընթացքում','Нужно 2 измерения за последние 2 недели'):id==='streak'?st(l,'Record a verified reading to see days measured per week','Գրանցեք ստուգված չափում՝ շաբաթվա չափման օրերը տեսնելու համար','Запишите проверенное измерение, чтобы увидеть дни измерений за неделю'):st(l,'Needs 2 dated values with units to show a trend','Փոփոխությունը ցույց տալու համար պետք է 2 թվագրված արժեք՝ միավորներով','Для динамики нужны 2 значения с датами и единицами')};
}
export function PatientGraphs({data,memberId,locale}:{data:Graphs;memberId:string;locale:StaffLocale}){
 if(data.memberId!==memberId)return null;
 return <section className="space-y-6" data-patient-graphs={memberId}>
  <h2 className="text-h3">{st(locale,'At a glance','Մի հայացքով','Кратко')}</h2>
  {(['bp','ldl','hba1c','egfr','pulse','weight','streak'] as const).filter(id=>id!=='weight'||data.series.weight.points.length).map(id=><div key={id}>
   <TrendChart {...data.series[id]} {...graphCopy(id,locale)} locale={locale}/>
   {id==='streak'&&<p className="text-caption">{st(locale,'Verified readings only. Each point starts a 7-day period.','Միայն ստուգված չափումներ։ Յուրաքանչյուր կետը սկսում է 7-օրյա շրջան։','Только проверенные измерения. Каждая точка начинает период в 7 дней.')}</p>}
   {data.unavailable.includes(id)&&<p role="status" className="text-caption">{st(locale,'Some sources are unavailable. Try At a glance again.','Որոշ աղբյուրներ չհաջողվեց կարդալ։ Կրկին բացեք «Մի հայացքով»։','Не удалось прочитать часть источников. Откройте «Кратко» снова.')}</p>}
  </div>)}
  <p className="text-caption text-muted-foreground">{st(locale,'As shown at','Ցուցադրված է','По состоянию на')}: {yerevanStamp(data.asOf,locale)}</p>
 </section>;
}
export function PlanSparklines({data,locale}:{data:{bp:TrendData;ldl:TrendData};locale:StaffLocale}){
 return <div className="grid min-w-0 gap-4 sm:grid-cols-2" data-plan-sparklines>{(['bp','ldl'] as const).map(id=><Sparkline key={id} {...data[id]} {...graphCopy(id,locale)} emptyText={st(locale,'Needs 2 dated values from this draft’s evidence to show a trend','Փոփոխությունը ցույց տալու համար պետք է 2 թվագրված արժեք այս սևագրի տվյալներից','Для динамики нужны 2 значения с датами из данных этого черновика')} locale={locale}/>)}</div>;
}
