'use client';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {useRef,useState} from 'react';
import {saveResultEntry} from '@/lib/gp-report/actions';
import type {ResultEntryField} from '@/lib/gp-report/result-entry';
import type {ResultsAssessmentInput} from '@/lib/clinical/rules/results-assessment';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanInputNow,calendarDate} from '@/lib/staff/yerevan-time';

const fields=[
 ['score2_percent','score2Percent','SCORE2 (%)','SCORE2 (%)','SCORE2 (%)',false],
 ['potassium','potassium','Potassium (mmol/L)','Կալիում (մմոլ/լ)','Калий (ммоль/л)',false],
 ['ecg_lvh','ecgLvh','ECG: left ventricular hypertrophy','ԷՍԳ՝ ձախ փորոքի հիպերտրոֆիա','ЭКГ: гипертрофия левого желудочка',true],
 ['ecg_ischaemia','ecgIschaemia','ECG: ischaemia','ԷՍԳ՝ իշեմիա','ЭКГ: ишемия',true],
 ['echo_done','echoDone','Echocardiography completed','Էխոկարդիոգրաֆիան կատարված է','Эхокардиография выполнена',true],
 ['ahi','ahi','Apnoea-hypopnoea index (events/hour)','Ապնոէ-հիպոպնոէի ինդեքս (դեպք/ժամ)','Индекс апноэ-гипопноэ (событий/час)',false],
] as const;
type Props={disabled?:boolean;memberId:string;locale:StaffLocale;entries:ResultsAssessmentInput['entries'];score2Applicable:boolean;score2Missing?:boolean;onSaved:(text:string)=>void|Promise<void>;onBusy?:(busy:boolean)=>void};

/** Only reviewed, explicitly dated facts are entered here. Clearing records unknown. */
export function ResultEntryForm({disabled=false,memberId,locale,entries,score2Applicable,score2Missing,onSaved,onBusy}:Props){
 const [busy,setBusy]=useState<ResultEntryField|null>(null),locked=useRef(false);
 const [message,setMessage]=useState<string|null>(null);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 async function save(field:ResultEntryField,value:number|'yes'|'no'|null,on:string,submissionId:string){
  if(locked.current||disabled)return;
  locked.current=true;setBusy(field);setMessage(null);onBusy?.(true);
  try{
   const result=await saveResultEntry(memberId,field,value,on,submissionId);
   if(result.status==='saved'){
    const names={score2_percent:'SCORE2',potassium:t('Potassium','Կալիում','Калий'),ecg_lvh:'ECG LVH',ecg_ischaemia:t('ECG ischaemia','ԷՍԳ իշեմիա','Ишемия на ЭКГ'),echo_done:t('Echo completed','Էխոն կատարված է','Эхо выполнено'),ahi:'AHI'};
    const amount=value==='yes'?t('yes','այո','да'):value==='no'?t('no','ոչ','нет'):String(value);
    const unit=field==='score2_percent'?'%':field==='potassium'?' mmol/L':field==='ahi'?t(' events/hour',' դեպք/ժամ',' событий/час'):'';
    const text=value===null?t(`${names[field]} cleared`,`${names[field]} մաքրված է`,`${names[field]}: значение очищено`):`${names[field]}${typeof value==='string'?':':''} ${amount}${unit}, ${calendarDate(on,locale)}`;
    await onSaved(done('result-saved',locale,text));setMessage(done('result-saved',locale,text));return true;}
   setMessage(notDone('action',locale,result.status==='off'?t('Result entry is switched off.','Արդյունքների մուտքագրումն անջատված է։','Ввод результатов отключён.'):
    result.status==='access'?t('Only the assigned doctor can save results.','Միայն կցված բժիշկը կարող է պահպանել արդյունքները։','Только назначенный врач может сохранять результаты.'):
    result.status==='invalid'?t('Check the value and observation date.','Ստուգեք արժեքն ու հետազոտության ամսաթիվը։','Проверьте значение и дату исследования.'):
    t('The save could not be confirmed. Refresh before trying again.','Պահպանումը չհաջողվեց հաստատել։ Թարմացրեք՝ կրկին փորձելուց առաջ։','Не удалось подтвердить сохранение. Обновите перед повторной попыткой.')));
  }catch{setMessage(notDone('action',locale,t('The save could not be confirmed. Refresh before trying again.','Պահպանումը չհաջողվեց հաստատել։ Թարմացրեք՝ կրկին փորձելուց առաջ։','Не удалось подтвердить сохранение. Обновите перед повторной попыткой.')));}
  finally{locked.current=false;setBusy(null);onBusy?.(false);}
  return false;
 }
 function row([field,key,en,hy,ru,binary]:typeof fields[number]){return <EntryRow key={`${field}:${entries[key]?.value??''}:${entries[key]?.on??''}`} field={field} label={t(en,hy,ru)} binary={binary} entry={entries[key]} locale={locale} disabled={busy!==null||disabled} saving={busy===field} save={save}/>;}
 return <section className="space-y-3" aria-label={t('Reviewed results','Վերանայված արդյունքներ','Проверенные результаты')}>
  {(score2Missing===undefined||(score2Missing&&score2Applicable))&&<><h3 className="text-body1 font-semibold">{t('Add a reviewed result','Ավելացնել վերանայված արդյունք','Добавить проверенный результат')}</h3>
  <p className="text-body2 text-muted-foreground">{t('Use the observation date. Clear a value to record it as unknown.','Նշեք հետազոտության ամսաթիվը։ Մաքրեք արժեքը՝ այն անհայտ նշելու համար։','Укажите дату исследования. Очистите значение, чтобы отметить его как неизвестное.')}</p></>}
  {score2Missing===undefined?<div className="grid gap-3 sm:grid-cols-2">{fields.filter(([field])=>field!=='score2_percent'||score2Applicable).map(row)}</div>:<>
   {score2Missing&&score2Applicable&&row(fields[0])}
   <details><summary>{t('Add potassium, ECG, echo or AHI','Ավելացնել կալիում, ԷՍԳ, էխո կամ AHI','Добавить калий, ЭКГ, эхо или ИАГ')}</summary>
    <p className="text-body2 text-muted-foreground">{t('Use the observation date. Clear a value to record it as unknown.','Նշեք հետազոտության ամսաթիվը։ Մաքրեք արժեքը՝ այն անհայտ նշելու համար։','Укажите дату исследования. Очистите значение, чтобы отметить его как неизвестное.')}</p>
    <div className="grid gap-3 sm:grid-cols-2">{fields.filter(([field])=>field!=='score2_percent'||(!score2Missing&&score2Applicable)).map(row)}</div>
   </details>
  </>}
  {message&&<p role="status" className="text-body2">{message}</p>}
 </section>;
}
function EntryRow({field,label,binary,entry,locale,disabled,saving,save}:{field:ResultEntryField;label:string;binary:boolean;entry:ResultsAssessmentInput['entries'][keyof ResultsAssessmentInput['entries']];locale:StaffLocale;disabled:boolean;saving:boolean;save:(field:ResultEntryField,value:number|'yes'|'no'|null,on:string,id:string)=>Promise<boolean|undefined>}){
 const [value,setValue]=useState(entry?String(entry.value):''),[on,setOn]=useState(yerevanInputNow().slice(0,10));
 const submission=useRef<string|null>(null);
 const [invalid,setInvalid]=useState(false);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const control='min-h-11 min-w-0 rounded-md border bg-background px-3 text-base';
 function changed(){submission.current=null;setInvalid(false);}
 async function submit(){
  const clean=value.trim();
  const parsed=clean===''?null:binary?clean as 'yes'|'no':Number(clean.replace(',','.'));
  if(typeof parsed==='number'&&!Number.isFinite(parsed)){setInvalid(true);return;}
  const id=submission.current??=crypto.randomUUID();
  if(await save(field,parsed,on,id))submission.current=null;
 }
 return <form className="space-y-2 rounded-lg border p-3" onSubmit={event=>{event.preventDefault();void submit();}}>
  <label className="block space-y-1 text-body2"><span>{label}</span>{binary?<select className={`${control} w-full`} disabled={disabled} value={value} onChange={e=>{setValue(e.target.value);changed();}}>
   <option value="">{t('Unknown','Անհայտ','Неизвестно')}</option><option value="yes">{t('Yes','Այո','Да')}</option><option value="no">{t('No','Ոչ','Нет')}</option>
  </select>:<input type="text" inputMode="decimal" className={`${control} w-full`} value={value} disabled={disabled} onChange={e=>{setValue(e.target.value);changed();}}/>}</label>
  {invalid&&<p role="alert" className="text-body2">{notDone('invalid-number',locale)}</p>}
  {entry&&<p className="text-caption text-muted-foreground">{t('Saved observation','Պահպանված հետազոտություն','Сохранённое исследование')}: {String(entry.value)} · {calendarDate(entry.on,locale)}</p>}
  <label className="block space-y-1 text-body2"><span className="block">{t('Observation date','Հետազոտության ամսաթիվ','Дата исследования')}</span><input type="date" required className={`${control} block w-full max-w-full appearance-none`} value={on} disabled={disabled} onChange={e=>{setOn(e.target.value);changed();}}/></label>
  <div className="flex flex-wrap justify-end gap-2">
   {(entry||value!=='')&&<button type="button" disabled={disabled||value===''} className={`${control} text-body2`} onClick={()=>{setValue('');changed();}}>{t('Clear value','Մաքրել արժեքը','Очистить значение')}</button>}
   <button type="submit" disabled={disabled} className={`${control} text-body2 font-semibold`}>{saving?t('Saving…','Պահպանվում է…','Сохраняется…'):t('Save result','Պահպանել արդյունքը','Сохранить результат')}</button>
  </div>
 </form>;
}
