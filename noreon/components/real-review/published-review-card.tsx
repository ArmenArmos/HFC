import {memberInstruction} from "@/lib/text-language";
import {extractionSchema} from '@/lib/reports/schema';
import type {PublishedReview} from '@/lib/patient-care/published-review';
import {isClinicLabReceipt} from '@/lib/patient-care/clinical-review-schema';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {formatMemberDate} from '@/lib/patient/date-format';
import {ChevronDown, ShieldCheck} from 'lucide-react';
import {IconTile} from '@/components/patient-care/common';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import type {RegimenVersion} from '@/lib/patient-care/regimen';
export function PublishedReviewCard({publication,current,locale,version,regimen}:{publication:PublishedReview;current:boolean;locale:PatientLocale;version?:{version:number;changeSummary:string|null}|null;regimen?:RegimenVersion|null}){
 const text=(hy:string,en:string,ru:string)=>tx(locale,hy,en,ru);
 const names=[publication.draft.medicationName,...(publication.draft.medicines??[]).map(m=>m.name),...(regimen?.medicines??[]).map(m=>m.name)];
 return <section className="journey-card min-w-0">
  <header className="flex items-start gap-3"><IconTile icon={ShieldCheck}/><div className="min-w-0"><h2 className="text-h2">{current?text('Հրապարակված վերանայում','Published review','Опубликованная проверка'):text('Նախորդ վերանայում','Previous review','Предыдущая проверка')}{version?` · ${text(`Տարբերակ ${version.version}`,`Version ${version.version}`,`Версия ${version.version}`)}`:''}</h2><p className="mt-1 text-caption text-muted-foreground">{formatMemberDate(publication.publishedAt,locale,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p></div></header>
  {version?.changeSummary&&<section className="mt-4 space-y-2 rounded-xl border border-border/70 bg-muted/40 p-4"><h3 className="text-body2 font-semibold">{text('Ինչ է փոխվել','What changed','Что изменилось')}</h3><p className="whitespace-pre-wrap break-words text-body2">{memberInstruction(version.changeSummary,locale,names)}</p></section>}
  {regimen&&regimen.medicines.length>0&&<section className="mt-4 space-y-2"><h3 className="text-body1 font-semibold">{text('Այս տարբերակի դեղերը','Medicines in this version','Лекарства в этой версии')}</h3><RegimenList medicines={regimen.medicines.map(m=>({...m,instructions:memberInstruction(m.instructions,locale,[m.name])}))}/></section>}
  {regimen&&regimen.changes.length>0&&<section className="mt-4 space-y-2"><h3 className="text-body1 font-semibold">{text('Դեղերի փոփոխությունները','Changes to your medicines','Изменения в лекарствах')}</h3><RegimenChanges changes={regimen.changes} locale={locale}/></section>}
  <div className="divide-y">
   {([
    [text('Ձեր բժշկի բացատրությունը','Your doctor’s explanation','Пояснение вашего врача'),publication.draft.explanation],
    [text('Խնամքի ցուցումներ','Care instructions','Рекомендации по уходу'),publication.draft.instructions],
    [text('Ձեր հետագա քայլերը','Your follow-up','Ваши дальнейшие шаги'),publication.draft.followUp],
    [text('Ֆիզիկական ակտիվություն','Activity','Физическая активность'),publication.draft.activityLimits??''],
   ] as const).filter(([,content])=>content.trim()).map(([title,content])=>current?<section key={title} className="space-y-3 py-5"><h3 className="text-h3">{title}</h3><p className="max-w-2xl whitespace-pre-wrap break-words border-l-2 border-brand-teal pl-4 text-body2 leading-relaxed">{memberInstruction(content,locale,names)}</p></section>:<details key={title} className="group border-b last:border-b-0"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-body2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><span>{title}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden/></summary><p className="mb-4 mt-3 max-w-2xl whitespace-pre-wrap break-words text-body2">{memberInstruction(content,locale,names)}</p></details>)}
  </div>
  {Object.keys(publication.receipts).length>0&&<div className="border-t pt-3"><h3 className="text-body1 font-semibold">{text('Վերանայված աղբյուրներ','Reviewed sources','Проверенные источники')}</h3><div className="divide-y">{Object.entries(publication.receipts).map(([id,receipt])=>{
   if(isClinicLabReceipt(receipt))return <div key={id} className="min-w-0 space-y-2 py-3">
    <p className="whitespace-pre-wrap break-words text-body2">{memberInstruction(receipt.note,locale)}</p>
    <p className="break-words text-caption text-muted-foreground">{receipt.values.find(v=>v.laboratory)?.laboratory??text('Կլինիկայի լաբորատորիա','Clinic laboratory','Лаборатория клиники')} · {receipt.values[0].collectedOn}</p>
    <ul className="divide-y">{receipt.values.map(value=><li key={value.id} className="min-w-0 py-2"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body2"><span className="min-w-0 max-w-full break-words font-medium">{value.name}</span><span className="min-w-0 max-w-full break-words tabular-nums">{value.valueText} {value.unit??''}</span></div><p className="mt-1 break-words text-caption text-muted-foreground">{text('Տպված լաբորատոր հղում','Printed laboratory reference','Референсные значения лаборатории в документе')}: {value.reference?.trim()||text('Տրամադրված չէ','Not supplied','Не предоставлено')}</p></li>)}</ul>
   </div>;
   const report=extractionSchema.safeParse(publication.reports.find(r=>r.id===receipt.reportId)?.reviewed);
   return <div key={id} className="min-w-0 space-y-2 py-3">
    <p className="whitespace-pre-wrap break-words text-body2">{memberInstruction(receipt.note,locale)}</p>
    {report.success&&<><p className="break-words text-caption text-muted-foreground">{report.data.laboratory??text('Աղբյուրը նշված չէ','Source not recorded','Источник не указан')}{report.data.reportDate?` · ${report.data.reportDate}`:''}</p><ul className="divide-y">{receipt.rows.map(row=>{const source=report.data.rows[row];return source?<li key={row} className="min-w-0 py-2"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body2"><span className="min-w-0 max-w-full break-words font-medium">{source.name}</span><span className="min-w-0 max-w-full break-words tabular-nums">{source.literal} {source.unit??''}</span></div><p className="mt-1 break-words text-caption text-muted-foreground">{text('Տպված լաբորատոր հղում','Printed laboratory reference','Референсные значения лаборатории в документе')}: {source.reference?.trim()||text('Տրամադրված չէ','Not supplied','Не предоставлено')}</p></li>:null;})}</ul></>}
   </div>;
  })}</div></div>}
 </section>;
}
