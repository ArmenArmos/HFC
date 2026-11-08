'use client';
import {bpUnit} from '@/lib/bp-unit';
import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from '@/lib/patient/bp-provenance';
import {useRef,useState,useTransition} from 'react';
import type {z} from 'zod';
import type {Locale} from '@/lib/locale';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {nativeCareCommandSchema} from '@/lib/staff/care-command-schema';
import {doctorWorkspaceCareCommand} from '@/lib/staff-zoe/everyday-actions';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import {st} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import {BpHighWarning} from '@/components/staff/bp-high-warning';

type Command=z.infer<typeof nativeCareCommandSchema>;
const field='mt-1 block min-h-11 w-full rounded-md border bg-background p-3 text-body2';
const button='min-h-11 rounded-md border px-4 py-2 text-body2 disabled:opacity-50';
const noteLabels={
 en:{evidence:'Factual note','contact-attempted':'Contact attempted',reached:'Reached',unreachable:'Unreachable','refer-doctor':'Refer to doctor'},
 hy:{evidence:'Փաստական նշում','contact-attempted':'Կապի փորձ',reached:'Կապը հաստատվել է',unreachable:'Կապ չի հաստատվել','refer-doctor':'Ուղղել բժշկին'},
 ru:{evidence:'Фактическая заметка','contact-attempted':'Попытка связаться',reached:'Связь установлена',unreachable:'Связаться не удалось','refer-doctor':'Направить к врачу'},
};
/** One attempt per mounted card. An ambiguous write never becomes a fresh request. */
export function DoctorObservationsCard({snapshot,doctorId,locale,onRefresh}:{snapshot:ClinicalSnapshot;doctorId:string;locale:Locale;onRefresh?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),labels=noteLabels[locale];
 const [reading,setReading]=useState(()=>({measuredAt:new Date(Date.now()+4*60*60*1000).toISOString().slice(0,16),systolic:'',diastolic:'',pulse:''}));
 const [kind,setKind]=useState<keyof typeof labels>('evidence'),[note,setNote]=useState('');
 const [preview,setPreview]=useState<{command:Command;doctorId:string}|null>(null);
 const [error,setError]=useState(false),[status,setStatus]=useState<'saved'|'failed'|'unknown'|'stale'|null>(null);
 const [pending,start]=useTransition(),pressed=useRef(false),requestId=useRef<string|null>(null);
 const frozen=pending||status!==null;
 function edit(){setPreview(null);setError(false);}
 function prepare(op:'measurement'|'note'){
  if(pressed.current||frozen)return;
  let measuredAt='';
  if(op==='measurement'){
   const instant=new Date(`${reading.measuredAt}+04:00`);
   if(Number.isNaN(instant.getTime())){setError(true);setPreview(null);return;}
   measuredAt=instant.toISOString();
  }
  requestId.current??=crypto.randomUUID();
  const parsed=nativeCareCommandSchema.safeParse({id:snapshot.id,revision:snapshot.revision,...(op==='measurement'?{op,submissionId:requestId.current,measuredAt,systolic:Number(reading.systolic),diastolic:Number(reading.diastolic),...(reading.pulse?{pulse:Number(reading.pulse)}:{})}:{op,kind,note})});
  if(!parsed.success||(parsed.data.op==='measurement'&&(isFutureMeasurement(parsed.data.measuredAt)||parsed.data.diastolic>=parsed.data.systolic))){setError(true);setPreview(null);return;}
  setError(false);
  const entry={command:parsed.data,doctorId};
  if(op==='measurement')save(entry);else setPreview(entry);
 }
 function save(entry=preview){
  if(pressed.current||frozen||!entry)return;
  if(entry.command.id!==snapshot.id||entry.command.revision!==snapshot.revision||entry.doctorId!==doctorId){setStatus('stale');return;}
  pressed.current=true;
  start(async()=>{
   try{
    const result=await doctorWorkspaceCareCommand(entry.command,doctorId);
    if(!result.ok){setStatus('failed');return;}
    setStatus('saved');
   }catch{setStatus('unknown');return;}
   // A failed card refresh must not turn a confirmed save into an uncertain write.
   try{onRefresh?.();}catch{/* The saved status and full-record link remain available. */}
  });
 }
 const measurements=[...snapshot.evidence.measurements].sort((a,b)=>Date.parse(b.measured_at)-Date.parse(a.measured_at)).slice(0,5);
 const notes=[...(snapshot.careNotes??[])].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,5);
 return <section className="sz-record space-y-4 rounded-xl border bg-background p-4" lang={locale} aria-busy={pending}>
  <h3 className="text-h3">{t('Observations and contact','Դիտարկումներ և կապ','Наблюдения и контакты')}</h3>
  <p className="text-caption text-muted-foreground">{t('Saved care record','Պահպանված խնամքի գրառում','Сохранённая запись помощи')} · {t('Case revision','Դեպքի տարբերակ','Версия случая')} {snapshot.revision}</p>
  <p className="text-body2">{t('Record measured numbers or a factual account of contact. Check the numbers and time, then save.','Գրանցեք չափված թվերը կամ կապի մասին փաստական տեղեկությունը։ Ստուգեք թվերն ու ժամը, ապա պահպանեք։','Запишите измеренные значения или фактические сведения о контакте. Проверьте значения и время, затем сохраните.')}</p>
  <form className="space-y-3" onInvalid={()=>setError(true)} onSubmit={e=>{e.preventDefault();prepare('measurement');}}>
   <fieldset disabled={frozen} className="grid grid-cols-3 gap-3">
    <legend className="text-body2 font-semibold">{t('Record blood pressure','Գրանցել ճնշումը','Записать давление')}</legend>
    <label className="col-span-3 text-body2">{t('Measured at, Armenia time','Չափման ժամը՝ Հայաստանի ժամով','Время измерения, по времени Армении')}<input name="measuredAt" type="datetime-local" required value={reading.measuredAt} className={field} onChange={e=>{edit();setReading({...reading,measuredAt:e.target.value});}}/></label>
    {(['systolic','diastolic','pulse']as const).map(name=><label key={name} className="text-body2">{name==='systolic'?t('Systolic, mmHg','Սիստոլիկ, մմ ս.ս.','Систолическое, мм рт. ст.'):name==='diastolic'?t('Diastolic, mmHg','Դիաստոլիկ, մմ ս.ս.','Диастолическое, мм рт. ст.'):t('Pulse, beats/min (optional)','Զարկերակ, զարկ/րոպե (ոչ պարտադիր)','Пульс, уд/мин (необязательно)')}<input name={name} type="number" required={name!=='pulse'} min={name==='systolic'?60:name==='diastolic'?30:20} max={name==='systolic'?300:name==='diastolic'?200:250} step={1} value={reading[name]} className={field} onChange={e=>{edit();setReading({...reading,[name]:e.target.value});}}/></label>)}
   </fieldset>
   <BpHighWarning systolic={reading.systolic} diastolic={reading.diastolic} locale={locale}/>
   <button className={button} disabled={frozen}>{t('Save blood pressure','Պահպանել ճնշումը','Сохранить давление')}</button>
  </form>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();prepare('note');}}>
   <fieldset disabled={frozen} className="space-y-3">
    <legend className="text-body2 font-semibold">{t('Record a factual note or contact outcome','Գրանցել փաստական նշում կամ կապի արդյունք','Записать фактическую заметку или результат контакта')}</legend>
    <label className="block text-body2">{t('Outcome','Արդյունք','Результат')}<select name="kind" value={kind} className={field} onChange={e=>{edit();setKind(e.target.value as keyof typeof labels);}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="block text-body2">{t('Factual note','Փաստական նշում','Фактическая заметка')}<textarea name="note" required maxLength={2000} value={note} rows={3} className={field} onChange={e=>{edit();setNote(e.target.value);}}/></label>
   </fieldset>
   <p className="text-caption text-muted-foreground">{t('This records contact only. It does not send a message, confirm delivery or approve a clinical result.','Սա միայն գրանցում է կապը։ Այն հաղորդագրություն չի ուղարկում, չի հաստատում առաքումը կամ կլինիկական արդյունքը։','Это только регистрация контакта. Она не отправляет сообщение, не подтверждает доставку и не утверждает клинический результат.')}</p>
   <button className={button} disabled={frozen}>{t('Review note entry','Վերանայել նշումը','Проверить заметку')}</button>
  </form>
  {error&&<p role="alert" className="text-body2">{t('Enter the measured date and time and check the numbers or note. Nothing was saved.','Մուտքագրեք չափման ամսաթիվն ու ժամը և ստուգեք թվերը կամ նշումը։ Ոչինչ չի պահպանվել։','Укажите дату и время измерения и проверьте значения или заметку. Ничего не сохранено.')}</p>}
  {preview&&<div className="space-y-3 rounded-lg border p-3" data-observation-preview="true">
   <h4 className="text-body2 font-semibold">{t('Exact entry for your approval','Ճշգրիտ գրառումը՝ ձեր հաստատման համար','Точная запись для вашего подтверждения')}</h4>
   {preview.command.op==='measurement'?<><p className="text-body1 font-semibold">{preview.command.systolic}/{preview.command.diastolic} {bpUnit(locale)} {preview.command.pulse!==undefined&&<>· {t('Pulse','Զարկերակ','Пульс')} {preview.command.pulse}</>}</p><p className="text-body2">{stamp(preview.command.measuredAt,locale)} · {t('Armenia time','Հայաստանի ժամով','по времени Армении')}</p></>:<><p className="text-body2 font-semibold">{labels[preview.command.kind]}</p><p className="whitespace-pre-wrap break-words text-body2">{preview.command.note}</p></>}
   <button type="button" className={`${button} bg-primary text-primary-foreground`} disabled={frozen} onClick={()=>save()}>{t('Approve and save this observation','Հաստատել և պահպանել այս դիտարկումը','Подтвердить и сохранить наблюдение')}</button>
  </div>}
  {status&&<p role={status==='saved'?'status':'alert'} className="text-body2">{status==='saved'?t('Saved to the care record.','Պահպանված է խնամքի գրառման մեջ։','Сохранено в записи помощи.'):status==='unknown'?t('The outcome is unknown. Check the current record before entering this again. Your entry is retained here.','Արդյունքն անհայտ է։ Կրկին մուտքագրելուց առաջ ստուգեք ընթացիկ գրառումը։ Մուտքագրվածը պահպանված է այստեղ։','Результат неизвестен. Проверьте текущую запись перед повторным вводом. Введённые данные сохранены здесь.'):t('The entry could not be confirmed. Your entry is retained. Load the current record and check your access before trying again.','Գրառումը չհաստատվեց։ Մուտքագրվածը պահպանված է։ Կրկին փորձելուց առաջ բեռնեք ընթացիկ գրառումը և ստուգեք ձեր հասանելիությունը։','Не удалось подтвердить запись. Введённые данные сохранены. Загрузите текущую запись и проверьте доступ перед повтором.')}</p>}
  <details><summary className="min-h-11 cursor-pointer text-body2">{t('Recent saved observations','Վերջին պահպանված դիտարկումները','Недавние сохранённые наблюдения')}</summary>
   <p className="text-caption text-muted-foreground">{bpObservationCounts(snapshot.evidence.measurements,locale)}</p>
   {!measurements.length&&!notes.length&&<p className="text-body2">{t('No measurements or care notes recorded.','Չափումներ կամ խնամքի նշումներ գրանցված չեն։','Измерений и заметок пока нет.')}</p>}
   <ul className="divide-y">{measurements.map(m=><li key={m.id} className="py-3 text-body2">{m.systolic}/{m.diastolic} {bpUnit(locale)} {m.pulse!==null&&<>· {t('Pulse','Զարկերակ','Пульс')} {m.pulse}</>} · {stamp(m.measured_at,locale)}{isUnverifiedBp(m)&&<> · {unverifiedBpLabel(locale)}</>}</li>)}{notes.map(n=><li key={n.id} className="space-y-1 py-3"><p className="text-body2 font-semibold">{labels[n.kind as keyof typeof labels]??t('Recorded observation','Գրանցված դիտարկում','Записанное наблюдение')}</p><p className="whitespace-pre-wrap break-words text-body2">{n.note}</p><p className="text-caption text-muted-foreground">{n.actor_name} · {stamp(n.created_at,locale)}</p></li>)}</ul>
  </details>
  <a href={`/staff/real/members/${snapshot.id}`} className="inline-flex min-h-11 items-center text-body2 underline">{t('Check the full current record','Ստուգել ամբողջ ընթացիկ գրառումը','Проверить полную текущую запись')}</a>
 </section>;
}
