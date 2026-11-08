'use client';
import {useState} from 'react';
import {MEDICINE_LIST,medicineWarningText,planMedicineChecks} from '@/lib/medicines/plan-checks';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
const inputClass='mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2';
export const MEDICINE_LIST_ID='plan-medicine-list';
/** The fixed list for the name fields. The doctor still types or picks each name; a name off the list stays allowed and is flagged. */
export const MedicineDatalist=()=><datalist id={MEDICINE_LIST_ID}>{MEDICINE_LIST.map(m=><option key={m.name} value={m.name}/>)}</datalist>;
export type MedicineCheckContext={others:string[];egfr:number|null};
/** Warnings under the medicines (lib/medicines/plan-checks.ts). Proposed rules: they never block saving. Allergies are typed here because no record holds them yet; nothing here is saved. */
export function MedicineChecks({names,context,locale}:{names:string[];context:MedicineCheckContext;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [allergies,setAllergies]=useState('');
 const [egfr,setEgfr]=useState(context.egfr===null?'':String(context.egfr));
 const typedEgfr=egfr.trim()===''?null:Number(egfr.replace(',','.'));
 const warnings=planMedicineChecks({plan:names,others:context.others,allergies,egfr:typedEgfr});
 if(!names.some(n=>n.trim())&&!context.others.length)return null;
 return <section className="space-y-3 rounded-lg border p-3" aria-label={t('Medicine checks','Դեղերի ստուգում','Проверка лекарств')} data-medicine-checks>
  <h3 className="text-body2 font-medium">{t('Medicine checks','Դեղերի ստուգում','Проверка лекарств')}</h3>
  <p className="text-caption text-muted-foreground">{t('Automatic checks, proposed and not yet signed by the clinical team. They warn; you decide. Medicines the member reported are included.','Ավտոմատ ստուգումներ, առաջարկված, դեռ չհաստատված կլինիկական թիմի կողմից։ Նախազգուշացնում են, որոշում եք դուք։ Անդամի նշած դեղերը ներառված են։','Автоматические проверки, предложены и пока не подписаны клинической командой. Они предупреждают, решаете вы. Лекарства, указанные участником, включены.')}</p>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="block text-body2">{t('Known allergies or intolerances (checked here, not saved)','Հայտնի ալերգիաներ կամ անտանելիություն (ստուգվում է այստեղ, չի պահվում)','Известные аллергии или непереносимость (проверяется здесь, не сохраняется)')}<input className={inputClass} autoComplete="off" value={allergies} onChange={e=>setAllergies(e.target.value)}/></label>
   <label className="block text-body2">{t('Latest eGFR (checked here, not saved)','Վերջին eGFR (ստուգվում է այստեղ, չի պահվում)','Последняя рСКФ (проверяется здесь, не сохраняется)')}<input className={inputClass} inputMode="decimal" autoComplete="off" value={egfr} onChange={e=>setEgfr(e.target.value)}/></label>
  </div>
  {warnings.length?<ul role="status" className="list-disc space-y-1 ps-5 text-body2">{warnings.map((w,i)=><li key={`${w.rule}:${i}`} data-medicine-warning={w.rule}>{medicineWarningText(w,t)}</li>)}</ul>:<p role="status" className="text-body2">{t('No check fired.','Ոչ մի ստուգում չի գործարկվել։','Ни одна проверка не сработала.')}</p>}
 </section>;
}
