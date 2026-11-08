import {TriangleAlert, Check, Minus} from 'lucide-react';
import {simpleRange} from '@/lib/reports/history';
import {labRange} from '@/lib/patient-care/journey-evidence';
import type {ReportExtraction} from '@/lib/reports/schema';
import type {PatientLocale} from '@/lib/patient/copy';
import {copy} from './common';
export type ReferenceStatus = ReturnType<typeof labRange>['status'];
/** Compare only an exact numeric literal with a single printed numeric interval.
 * Context-specific, bounded, qualitative and uncertain source text stays literal. */
export function sourceReferenceStatus(row:ReportExtraction['rows'][number]):ReferenceStatus {
 const bounds=simpleRange(row.reference);
 if(row.uncertain || !bounds || !/^-?\d+(?:[.,]\d+)?$/.test(row.literal.trim())) return 'unknown';
 return labRange({value:Number(row.literal.trim().replace(',','.')),referenceLow:bounds[0],referenceHigh:bounds[1]}).status;
}
export function ReferenceFlag({status,locale:l}:{status:ReferenceStatus;locale:PatientLocale}){
 const outside=status==='above'||status==='below';
 const Icon=outside?TriangleAlert:status==='within'?Check:Minus;
 return <p className={`inline-flex max-w-full items-start gap-2 rounded-md px-2 py-1 text-caption font-semibold ${outside?'bg-muted text-foreground':'text-muted-foreground'}`}><Icon aria-hidden className="mt-0.5 size-4 shrink-0"/><span>{outside?copy(l,'Outside the lab’s reference range','Լաբորատոր միջակայքից դուրս', 'За пределами референсного диапазона лаборатории'):status==='within'?copy(l,'Within the lab’s reference range','Լաբորատոր միջակայքում', 'В пределах референсного диапазона лаборатории'):copy(l,'Reference comparison unavailable','Միջակայքի համեմատությունը հասանելի չէ', 'Сравнение с референсным диапазоном недоступно')}</span></p>;
}
export function ResultRow({name,value,unit,reference,status='unknown',locale:l}:{name:string;value:string;unit?:string|null;reference?:string|null;status?:ReferenceStatus;locale:PatientLocale}){
 return <div data-result-row="true" className="min-w-0 space-y-2 py-4">
  <h3 className="w-full break-words text-body1 font-semibold">{name}</h3>
  <p className="w-full break-words font-display text-2xl font-extrabold tabular-nums">{value||copy(l,'Value not reported','Արժեքը նշված չէ', 'Значение не указано')}{unit&&<span className="ml-2 text-body2 font-normal">{unit}</span>}</p>
  <p className="w-full break-words text-caption text-muted-foreground">{copy(l,'Printed reference','Տպված միջակայք', 'Напечатанный референсный диапазон')}: {reference?.trim()||copy(l,'Not reported','Նշված չէ', 'Не указано')}</p>
  <ReferenceFlag status={status} locale={l}/>
 </div>;
}
export function SourceResultRow({row,locale}:{row:ReportExtraction['rows'][number];locale:PatientLocale}){
 return <ResultRow name={row.name} value={row.literal} unit={row.unit} reference={row.reference} status={sourceReferenceStatus(row)} locale={locale}/>;
}
