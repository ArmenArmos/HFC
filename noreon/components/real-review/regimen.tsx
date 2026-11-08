'use client';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import type {DoctorRegimenReview,RegimenRow} from '@/lib/patient-care/regimen';
import {MAX_REGIMEN_MEDICINES} from '@/lib/service-workflow/publication';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {MEDICINE_LIST_ID,MedicineDatalist} from './medicine-checks';
const inputClass='mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2';
/** Every row starts empty. The name field offers the fixed list (Task 20); nothing is filled or chosen by code: the doctor enters each medicine and dose. */
const emptyRow:RegimenRow={name:'',dose:'',instructions:'',times:''};
function rows(value:string):RegimenRow[]{try{return JSON.parse(value) as RegimenRow[];}catch{return [];}}
export function RegimenEditor({value,onChange,locale}:{value:string;onChange:(next:string)=>void;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const list=rows(value);
 const set=(next:RegimenRow[])=>onChange(JSON.stringify(next));
 const change=(i:number,key:keyof RegimenRow,text:string)=>set(list.map((row,n)=>n===i?{...row,[key]:text}:row));
 return <div className="space-y-4">
  <MedicineDatalist/>
  <input type="hidden" name="medicines" value={value}/>
  <p className="text-caption text-muted-foreground">{t('You enter and approve every medicine and dose. Noreon does not suggest any. A medicine you remove here is stopped in the new version.','Յուրաքանչյուր դեղ և դեղաչափ մուտքագրում և հաստատում եք Դուք։ Նորեոն Հելթը ոչինչ չի առաջարկում։ Այստեղից հեռացված դեղը նոր տարբերակում դադարեցվում է։','Каждое лекарство и дозу вводите и утверждаете вы. Нореон Хелс ничего не предлагает. Лекарство, удалённое здесь, отменяется в новой версии.')}</p>
  {list.map((row,i)=><fieldset key={i} className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-body2 font-medium">{t(`Medicine ${i+1}`,`Դեղ ${i+1}`,`Лекарство ${i+1}`)}</legend>
   <label className="block text-body2">{t('Medicine name','Դեղի անվանում','Название лекарства')}<input className={inputClass} list={MEDICINE_LIST_ID} maxLength={120} autoComplete="off" value={row.name} onChange={e=>change(i,'name',e.target.value)}/></label>
   <label className="block text-body2">{t('Dose','Դեղաչափ','Доза')}<input className={inputClass} maxLength={120} autoComplete="off" value={row.dose} onChange={e=>change(i,'dose',e.target.value)}/></label>
   <label className="block text-body2">{t('Times, separated by commas','Ժամերը՝ ստորակետերով բաժանված','Время приёма через запятую')}<input className={inputClass} placeholder="09:00, 18:00" autoComplete="off" value={row.times} onChange={e=>change(i,'times',e.target.value)}/></label>
   <label className="block text-body2">{t('Medicine instructions','Դեղի ընդունման ցուցումներ','Указания по приёму лекарства')}<textarea className={inputClass} rows={2} maxLength={500} value={row.instructions} onChange={e=>change(i,'instructions',e.target.value)}/></label>
   <button type="button" className="min-h-11 rounded-md border px-4 text-body2" onClick={()=>set(list.filter((_,n)=>n!==i))}>{t('Remove this medicine','Հեռացնել այս դեղը','Удалить это лекарство')}</button>
  </fieldset>)}
  <button type="button" className="min-h-11 rounded-md border px-4 text-body2" disabled={list.length>=MAX_REGIMEN_MEDICINES} onClick={()=>set([...list,emptyRow])}>{t('Add a medicine','Ավելացնել դեղ','Добавить лекарство')}</button>
 </div>;
}
/** What the publish button will publish: the saved regimen and what it changes. The approval hash binds the tick to this content. */
export function RegimenApproval({review,locale}:{review:DoctorRegimenReview|null;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(!review?.draft)return <p role="status" className="text-body2">{review?t('Save a draft first. Its medicines are shown here for your approval.','Նախ պահպանեք սևագիրը։ Դրա դեղերն այստեղ կցուցադրվեն Ձեր հաստատման համար։','Сначала сохраните черновик. Его лекарства появятся здесь для вашего утверждения.'):t('The medicines could not be read. Reload the case before publishing.','Դեղերը չհաջողվեց կարդալ։ Հրապարակելուց առաջ վերբեռնեք դեպքը։','Не удалось прочитать лекарства. Перезагрузите карточку перед публикацией.')}</p>;
 const {medicines,changes,approvalHash}=review.draft,first=!review.versions.length;
 return <section className="space-y-3 rounded-lg border p-3" aria-label={t('Medicines to approve','Հաստատման ենթակա դեղեր','Лекарства для утверждения')}>
  <input type="hidden" name="regimenHash" value={approvalHash}/>
  <h3 className="text-body1 font-semibold">{t('Medicines in the saved draft','Պահպանված սևագրի դեղերը','Лекарства в сохранённом черновике')}</h3>
  {medicines.length?<RegimenList medicines={medicines}/>:<p className="text-body2">{t('This version has no medicines.','Այս տարբերակում դեղեր չկան։','В этой версии нет лекарств.')}</p>}
  {!first&&<><h3 className="text-body1 font-semibold">{t('What changes from the published plan','Ինչ է փոխվում հրապարակված պլանի համեմատ','Что меняется по сравнению с опубликованным планом')}</h3>
  {changes.length?<RegimenChanges changes={changes} locale={locale}/>:<p className="text-body2">{t('No medicine changes.','Դեղերի փոփոխություն չկա։','Изменений в лекарствах нет.')}</p>}</>}
  <label className="flex min-h-11 items-start gap-3 text-body2"><input type="checkbox" name="regimenApproved" required/>{t('I reviewed every medicine and dose above and approve them for this member.','Վերանայել եմ վերևում նշված յուրաքանչյուր դեղն ու դեղաչափը և հաստատում եմ դրանք այս անդամի համար։','Я проверил(а) каждое лекарство и дозу выше и утверждаю их для этого участника.')}</label>
 </section>;
}
