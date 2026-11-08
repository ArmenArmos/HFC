import {bpUnit} from '@/lib/bp-unit';
import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from '@/lib/patient/bp-provenance';
import type{Locale}from'@/lib/locale';
import type{BpReading}from'@/lib/bp-device/schema';
import{yerevanStamp}from'@/lib/staff/yerevan-time';

const copy={
 en:{title:'Blood pressure history',intro:'Recorded readings and readings from the member’s monitor, newest first. Monitor readings are shown here only; they are not yet part of the evidence for review.',
  empty:'No readings yet.',when:'Measured',bp:'Blood pressure',pulse:'Pulse',source:'Source',manual:'Recorded manually',visit:'Recorded at a visit',device:(serial:string)=>`Monitor ${serial}`,none:'Not recorded',
  trend:'Trend',systolic:'Systolic',diastolic:'Diastolic',summary:(n:number,from:string,to:string)=>`Trend of the last ${n} readings, ${from} to ${to}. The table below lists every value.`,caption:'Blood pressure readings'},
 hy:{title:'Ճնշման պատմություն',intro:'Գրանցված և սարքից ստացված չափումները, նորերը վերևում։ Սարքի չափումները ցուցադրվում են միայն այստեղ և դեռ վերանայման տվյալների մաս չեն։',
  empty:'Չափումներ դեռ չկան։',when:'Չափվել է',bp:'Ճնշում',pulse:'Զարկերակ',source:'Աղբյուր',manual:'Գրանցված ձեռքով',visit:'Գրանցված այցի ժամանակ',device:(serial:string)=>`Սարք ${serial}`,none:'Չի գրանցվել',
  trend:'Դինամիկա',systolic:'Սիստոլիկ',diastolic:'Դիաստոլիկ',summary:(n:number,from:string,to:string)=>`Վերջին ${n} չափումների դինամիկան՝ ${from}-ից ${to}։ Բոլոր արժեքները ներքևի աղյուսակում են։`,caption:'Ճնշման չափումներ'},
 ru:{title:'История артериального давления',intro:'Записанные измерения и измерения с тонометра участника, сначала новые. Измерения с тонометра показаны только здесь; они пока не входят в данные для рассмотрения.',
  empty:'Измерений пока нет.',when:'Время измерения',bp:'Артериальное давление',pulse:'Пульс',source:'Источник',manual:'Записано вручную',visit:'Записано на приеме',device:(serial:string)=>`Тонометр ${serial}`,none:'Не записано',
  trend:'Динамика',systolic:'Систолическое',diastolic:'Диастолическое',summary:(n:number,from:string,to:string)=>`Динамика последних ${n} измерений, с ${from} до ${to}. Все значения приведены в таблице ниже.`,caption:'Измерения артериального давления'},
} satisfies Record<Locale,{title:string;intro:string;empty:string;when:string;bp:string;pulse:string;source:string;manual:string;visit:string;device:(serial:string)=>string;none:string;trend:string;systolic:string;diastolic:string;summary:(n:number,from:string,to:string)=>string;caption:string}>;
const W=360,H=230,PAD=36;

/** Staff-only readings table with a simple trend. Values are shown as
 * recorded; no thresholds or interpretation are applied here. */
export function BpReadingsHistory({readings,locale}:{readings:BpReading[];locale:Locale}){
 const t=copy[locale];
 const recent=readings.filter(r=>!isUnverifiedBp(r)).slice(0,30).reverse();
 // The axis widens to fit every value, so an extreme reading is never drawn as a milder one.
 const LOW=Math.min(40,...recent.map(r=>r.diastolic-10)),HIGH=Math.max(220,...recent.map(r=>r.systolic+10));
 const x=(i:number)=>recent.length<2?W/2:PAD+i*(W-2*PAD)/(recent.length-1);
 const y=(v:number)=>H-PAD-(v-LOW)*(H-2*PAD)/(HIGH-LOW);
 const line=(pick:(r:BpReading)=>number)=>recent.map((r,i)=>`${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(' ');
 return <section className="max-w-3xl space-y-4 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="bp-history-title" lang={locale}>
  <header className="space-y-1"><h2 id="bp-history-title" className="text-h3">{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p></header>
  <p className="text-caption text-muted-foreground">{bpObservationCounts(readings,locale)}</p>
  {!readings.length?<p className="text-body2">{t.empty}</p>:<>
   {recent.length>1&&<figure className="space-y-2">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t.summary(recent.length,yerevanStamp(recent[0].measuredAt,locale),yerevanStamp(recent[recent.length-1].measuredAt,locale))}>
     {[80,120,160,200].map(v=><g key={v}><line x1={PAD} x2={W-PAD} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1}/><text x={4} y={y(v)+4} fontSize={13} fill="var(--muted-foreground)">{v}</text></g>)}
     <polyline points={line(r=>r.systolic)} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round"/>
     <polyline points={line(r=>r.diastolic)} fill="none" stroke="var(--chart-2)" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="6 4"/>
     {recent.map((r,i)=><g key={r.id}><circle cx={x(i)} cy={y(r.systolic)} r={3.5} fill="var(--chart-1)"/><rect x={x(i)-3} y={y(r.diastolic)-3} width={6} height={6} fill="var(--chart-2)"/></g>)}
     {[0,recent.length-1].map(i=><text key={`date-${i}`} x={x(i)} y={H-5} textAnchor={i===0?'start':'end'} fontSize={12} fill="var(--muted-foreground)">{yerevanStamp(recent[i].measuredAt,locale).split(',')[0]}</text>)}
    </svg>
    <figcaption className="flex flex-wrap gap-4 text-caption text-muted-foreground"><span className="inline-flex items-center gap-2"><svg width="18" height="8" aria-hidden><line x1="0" x2="18" y1="4" y2="4" stroke="var(--chart-1)" strokeWidth="2.5"/></svg>{t.systolic}</span>
     <span className="inline-flex items-center gap-2"><svg width="18" height="8" aria-hidden><line x1="0" x2="18" y1="4" y2="4" stroke="var(--chart-2)" strokeWidth="2.5" strokeDasharray="6 4"/></svg>{t.diastolic}</span><span>{bpUnit(locale)}</span></figcaption>
   </figure>}
   <div className="overflow-x-auto"><table className="w-full text-left text-body2"><caption className="sr-only">{t.caption}</caption>
    <thead><tr className="border-b text-caption text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">{t.when}</th><th scope="col" className="py-2 pr-3 font-medium">{t.bp}</th><th scope="col" className="py-2 pr-3 font-medium">{t.pulse}</th><th scope="col" className="py-2 font-medium">{t.source}</th></tr></thead>
    <tbody className="divide-y">{readings.map(r=><tr key={r.id}><td className="py-2 pr-2 break-words"><time dateTime={r.measuredAt}>{yerevanStamp(r.measuredAt,locale)}</time></td><td className="py-2 pr-3 tabular-nums">{r.systolic}/{r.diastolic} {bpUnit(locale)}</td><td className="py-2 pr-3 tabular-nums">{r.pulse??t.none}</td><td className="py-2">{isUnverifiedBp(r)?unverifiedBpLabel(locale):r.source==='device'&&r.serial?t.device(r.serial):r.source==='visit'?t.visit:t.manual}</td></tr>)}</tbody>
   </table></div>
  </>}
 </section>;
}
