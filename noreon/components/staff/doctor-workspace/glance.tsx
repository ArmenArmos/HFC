import type {L,ToolResult} from '@/lib/staff-zoe/contracts';
import {st} from '@/lib/staff/staff-locale-copy';
import {RecordCard,FactChip} from '@/components/staff/zoe/cards';

/** Each value is the shared reader's own dated fact. No new thresholds, clinical conclusions or missing-as-zero. */
export function WorkspaceGlance({records,locale,reference}:{records:ToolResult[];locale:L;reference:string}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const metrics=records.filter(r=>['bp','ldl','adherence','plan'].includes(r.tool)).flatMap(r=>r.state==='ok'?r.facts.slice(0,1).map(f=>({...f,tool:r.tool})):[]);
 return <details className="dw-glance" open>
  <summary>{t('At a glance','Մի հայացքով','Краткий обзор')}</summary>
  <div className="space-y-4 p-4">
   <div className="grid grid-cols-2 gap-2">{metrics.map(f=><div key={f.id} className="dw-metric" data-tool={f.tool}>
    <p className="text-caption text-muted-foreground">{f.label}</p><p className="break-words text-body2 font-bold">{f.value}</p><FactChip fact={f} locale={locale}/>
   </div>)}</div>
   {records.map(r=><RecordCard key={r.tool} card={r} locale={locale} memberRef={reference}/>)}
  </div>
 </details>;
}
