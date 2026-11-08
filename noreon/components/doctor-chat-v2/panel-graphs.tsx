'use client';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {calendarDate} from '@/lib/staff/yerevan-time';
import type {PanelGraph} from '@/lib/staff-zoe/panel';
import {panelLabel} from './panel-copy';
/** Local count bars only. The shared chart module from slice 2c can replace this small component. */
export function PanelGraphs({graphs,locale,onSelect}:{graphs:PanelGraph[];locale:StaffLocale;onSelect:(ids:string[])=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const titles={risk:t('Members by risk category','Անդամներն ըստ ռիսկի խմբի','Участники по категориям риска'),ldl:t('Members at LDL target','ՑԽԼ-ի թիրախում գտնվող անդամներ','Участники с целевым ЛПНП'),alerts:t('Open alerts by day raised','Բաց ահազանգերն ըստ բացման օրվա','Открытые оповещения по дню создания'),readings:t('BP readings per week','Ճնշման չափումներն ըստ շաբաթվա','Измерения АД за неделю')};
 return <section className="dcv2-results" data-panel-graphs><h2>{t('Your panel','Ձեր անդամները','Ваши участники')}</h2>
  {!graphs.length&&<p>{t('Panel graphs are unavailable.','Խմբի գրաֆիկներն անհասանելի են։','Графики недоступны.')}</p>}
  {graphs.map(graph=>{
   const max=Math.max(1,...graph.bars.map(bar=>bar.count)),at=graph.bars.find(bar=>bar.key==='at_goal')?.count??0;
   return <section className="dcv2-panel-graph" data-panel-graph={graph.kind} key={graph.kind}><h3>{titles[graph.kind]}</h3>
    {graph.kind==='ldl'&&<p>{graph.total?new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(at/graph.total):t('No members yet','Անդամներ դեռ չկան','Пока нет участников')} {graph.total>0&&t(`of your ${graph.total} members. Only reviewed results with a recorded goal count.`,`Ձեր ${graph.total} անդամներից։ Հաշվվում են միայն ստուգված արդյունքները՝ գրանցված թիրախով։`,`из ${graph.total} ваших участников. Учитываются только проверенные результаты с записанной целью.`)}</p>}
    {graph.kind==='alerts'&&<p className="text-caption text-muted-foreground">{t('Currently open alerts raised in the last 7 days, not a history of daily totals.','Վերջին 7 օրում բացված և դեռ բաց ահազանգերը։ Սա օրական ընդհանուր թվերի պատմություն չէ։','Оповещения, созданные за последние 7 дней и открытые сейчас. Это не история ежедневных итогов.')}</p>}
    {graph.kind==='readings'&&<p className="text-caption text-muted-foreground">{t('Recorded BP readings, including member-reported readings. Weeks start on Monday, Yerevan time.','Գրանցված ճնշման չափումները՝ ներառյալ անդամի նշածը։ Շաբաթը սկսվում է երկուշաբթի՝ Երևանի ժամով։','Записанные измерения АД, включая данные со слов участника. Неделя начинается в понедельник по времени Еревана.')}</p>}
    {!graph.bars.some(bar=>bar.count)&&<p>{t('No records in this period.','Այս ժամանակահատվածում գրանցումներ չկան։','Нет записей за этот период.')}</p>}
    <div className="dcv2-count-axis text-caption text-muted-foreground"><span>0</span><span>{t('Count','Քանակ','Количество')} · {max}</span></div>
    <ul>{graph.bars.map(bar=>{const label=graph.kind==='readings'||graph.kind==='alerts'?calendarDate(bar.key,locale):panelLabel(bar.key,locale);return <li key={bar.key}><button type="button" onClick={()=>onSelect(bar.memberIds)} aria-label={`${label}: ${bar.count}`}><span>{label}</span><span className="dcv2-count-track" aria-hidden><span style={{width:`${bar.count/max*100}%`}}/></span><strong>{bar.count}</strong></button></li>;})}</ul>
   </section>;
  })}
 </section>;
}
