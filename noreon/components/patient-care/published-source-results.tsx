import {SourceResultRow} from './result-row';
import { FileText } from 'lucide-react';
import { RowLink, copy } from './common';
import type {PublishedSourceRow} from '@/lib/patient-care/published-review';
import type {Locale} from '@/lib/locale';
/** Current released literals take precedence over older numeric projections. */
export function PublishedSourceResults({rows,locale}:{rows:PublishedSourceRow[];locale:Locale}){
 const reports=new Map<string,PublishedSourceRow[]>();
 for(const row of rows){const key=`${row.planId}:${row.reportId}`;const report=reports.get(key)??[];report.push(row);reports.set(key,report);}
 return <section aria-label={copy(locale,'Current reviewed source results','Ընթացիկ վերանայված արդյունքները','Текущие проверенные результаты из источников')} className="space-y-3">
  <p className="text-caption text-muted-foreground">{copy(locale,`${rows.length} doctor-approved ${rows.length===1?'result':'results'}`,`Հրապարակված է ${rows.length} արդյունք`,`Утверждено врачом результатов: ${rows.length}`)}</p>
  <p className="text-caption text-muted-foreground">{copy(locale,'Reference flags compare supplied laboratory ranges, not a diagnosis.','Համեմատությունը տրամադրված լաբորատոր միջակայքի հետ է, ոչ թե ախտորոշում։','Отметки показывают сравнение с предоставленными лабораторными диапазонами, а не диагноз.')}</p>
  {[...reports.entries()].map(([id,report])=>{
   const first=report[0];const notes=[...new Set(report.flatMap(row=>row.notes))];
   return <div key={id} className="min-w-0 space-y-2">
    <p className="break-words text-caption text-muted-foreground">{first.laboratory||(copy(locale,'Laboratory not reported','Լաբորատորիան նշված չէ','Лаборатория не указана'))} · {first.reportDate||(copy(locale,'Date not reported','Ամսաթիվը նշված չէ','Дата не указана'))}</p>
    <div className="divide-y">{report.map(row=><SourceResultRow key={row.id} row={row.source} locale={locale}/>)}</div>
    {notes.length>0&&<section className="space-y-2 rounded-lg bg-muted p-4"><h3 className="text-body2 font-semibold">{copy(locale,'Doctor’s source notes','Բժշկի աղբյուրային նշումները','Заметки врача из источника')}</h3><div className="space-y-2">{notes.map(note=><p key={note} className="whitespace-pre-wrap break-words text-body2">{note}</p>)}</div></section>}
   </div>;
  })}
  <RowLink icon={FileText} href="/patient/review">{copy(locale,'Previous plans and sources','Նախորդ պլաններն ու աղբյուրները','Предыдущие планы и источники')}</RowLink>
 </section>;
}
