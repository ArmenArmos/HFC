'use client';
import type {Locale} from '@/lib/locale';
import {useState,type FormEvent} from 'react';
import {FlaskConical,Check,Clock} from 'lucide-react';
import {fieldClass,buttonClass} from './shell';
import {testTitle} from '@/lib/patient/catalogue-label';
import {currentStage,labStageVersion,type LabStage,type LabStageCommandPort,type LabStageResult,type StaffLabRead,type StaffLabSample} from '@/lib/staff/lab-stage-schema';
import {yerevanStamp,yerevanInputNow,yerevanInputToInstant} from '@/lib/staff/yerevan-time';

const enCopy={title:'Sample stages',intro:'Where each collected sample is. This shows the sample’s progress only, not results.',empty:'No samples are recorded as collected.',collected:'Collected',atLab:'At the lab',received:'Results received',
  markLab:'Mark as handed to the lab',markResults:'Mark results as received',when:'When it happened (Yerevan time)',now:'Use current time',save:'Save stage',saving:'Saving…',cancel:'Cancel',
  saved:'Stage recorded.',invalid:'Check the time. A stage must come after the previous one and cannot be in the future.',stale:'This stage is already recorded, or the case changed. Reload to see the current stages.',
  access:'You can’t record this stage for this member.',unavailable:'Couldn’t save right now. Your time is kept. Try again.',unknown:'Save outcome unknown. Check again: the stage is never recorded twice.',checkAgain:'Check again',
  missing:'Enter when it happened.',nurse:'nurse',doctor:'doctor',system:'recorded from the clinic’s lab upload',by:(name:string,role:string)=>`${name}, ${role}`,stagesOf:(title:string)=>`Stages for ${title}`};
const copy:Record<Locale,typeof enCopy>={
 en:enCopy,
 hy:{title:'Նմուշների ընթացքը',intro:'Յուրաքանչյուր վերցված նմուշի գտնվելու վայրը։ Այստեղ երևում է միայն նմուշի ընթացքը, ոչ թե արդյունքները։',empty:'Վերցված նմուշներ դեռ գրանցված չեն։',collected:'Վերցված է',atLab:'Լաբորատորիայում է',received:'Արդյունքները ստացված են',
  markLab:'Նշել՝ հանձնված է լաբորատորիա',markResults:'Նշել՝ արդյունքները ստացված են',when:'Երբ է դա տեղի ունեցել (Երևանի ժամով)',now:'Օգտագործել ընթացիկ ժամը',save:'Պահպանել փուլը',saving:'Պահպանվում է…',cancel:'Չեղարկել',
  saved:'Փուլը գրանցված է։',invalid:'Ստուգեք ժամը։ Փուլը պետք է լինի նախորդից հետո և չի կարող լինել ապագայում։',stale:'Այս փուլն արդեն գրանցված է, կամ գործը փոխվել է։ Թարմացրեք էջը՝ ընթացիկ փուլերը տեսնելու համար։',
  access:'Դուք չեք կարող գրանցել այս փուլը այս անդամի համար։',unavailable:'Այս պահին չհաջողվեց պահպանել։ Ձեր նշած ժամը պահպանված է։ Փորձեք կրկին։',unknown:'Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք․ փուլը երբեք երկու անգամ չի գրանցվում։',checkAgain:'Կրկին ստուգել',
  missing:'Նշեք, թե երբ է դա տեղի ունեցել։',nurse:'բուժքույր',doctor:'բժիշկ',system:'գրանցվել է կլինիկայի վերբեռնած լաբորատոր ֆայլից',by:(name:string,role:string)=>`${name}, ${role}`,stagesOf:(title:string)=>`${title}՝ փուլեր`},
 ru:{
  title:"Этапы обработки образцов",intro:"Где сейчас находится каждый взятый образец. Здесь показаны только этапы обработки, а не результаты.",empty:"Нет записей о взятых образцах.",
  collected:"Взят",atLab:"В лаборатории",received:"Результаты получены",markLab:"Отметить передачу в лабораторию",markResults:"Отметить получение результатов",
  when:"Когда это произошло (по времени Еревана)",now:"Указать текущее время",save:"Сохранить этап",saving:"Сохраняется…",cancel:"Отмена",saved:"Этап записан.",
  invalid:"Проверьте время. Этап должен следовать за предыдущим и не может быть в будущем.",
  stale:"Этот этап уже записан или данные случая изменились. Обновите страницу, чтобы увидеть текущие этапы.",access:"Вы не можете записать этот этап для данного участника.",
  unavailable:"Сейчас не удалось сохранить. Указанное время сохранено в форме. Попробуйте снова.",
  unknown:"Результат сохранения неизвестен. Проверьте ещё раз: этап никогда не записывается дважды.",checkAgain:"Проверить ещё раз",missing:"Укажите, когда это произошло.",nurse:"медсестра",
  doctor:"врач",system:"записано по лабораторному файлу, загруженному клиникой",by:(name:string,role:string)=>`${name}, ${role}`,stagesOf:(title:string)=>`Этапы для ${title}`,
 },
};
type Props={data:StaffLabRead;locale:Locale;role:'nurse'|'doctor';submissionIds:Record<string,string>;command:LabStageCommandPort};

export function LabStages(props:Props){
 const t=copy[props.locale];
 return <section className="max-w-3xl space-y-4 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="lab-stages-title" lang={props.locale}>
  <header className="space-y-1"><h2 id="lab-stages-title" className="flex items-center gap-2 text-h3"><FlaskConical className="size-5" aria-hidden/>{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p></header>
  {props.data.samples.length?<ul className="space-y-4">{props.data.samples.map(sample=><SampleRow key={sample.entryId} sample={sample} {...props}/>)}</ul>:<p className="text-body2">{t.empty}</p>}
 </section>;
}

function nextStage(sample:StaffLabSample,role:'nurse'|'doctor'):LabStage|null{
 const stage=currentStage(sample);
 if(stage==='collected')return role==='nurse'?'at-lab':null;
 if(stage==='at-lab')return 'results-received';
 return null;
}

function SampleRow({sample,locale,role,submissionIds,command,data}:Props&{sample:StaffLabSample}){
 const t=copy[locale];
 const title=sample.title?testTitle({id:sample.testId,title:sample.title},locale):sample.testId;
 const next=nextStage(sample,role);
 const [open,setOpen]=useState(false),[value,setValue]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState<{kind:LabStageResult['status']|'missing';text:string}|null>(null);
 const [frozen,setFrozen]=useState<Parameters<LabStageCommandPort>[0]|null>(null);
 const inputId=`lab-stage-${sample.entryId}`;
 const steps:[string,string|null,string|null][]=[[t.collected,sample.collectedAt,null],...sample.stages.map(s=>[s.stage==='at-lab'?t.atLab:t.received,s.occurredAt,s.actor.role==='system'?t.system:t.by(s.actor.name,s.actor.role==='nurse'?t.nurse:t.doctor)] as [string,string,string])];
 async function send(input:Parameters<LabStageCommandPort>[0]){
  setPending(true);setMessage(null);
  const result=await command(input).catch(():LabStageResult=>({status:'outcome-unknown'}));
  setPending(false);
  if(result.status==='saved'){setFrozen(null);setOpen(false);setValue('');setMessage({kind:'saved',text:t.saved});return;}
  if(result.status!=='outcome-unknown')setFrozen(null);
  setMessage({kind:result.status,text:result.status==='invalid'?t.invalid:result.status==='stale'?t.stale:result.status==='access'?t.access:result.status==='unavailable'?t.unavailable:t.unknown});
 }
 function submit(event:FormEvent){
  event.preventDefault();if(!next||pending)return;
  const occurredAt=yerevanInputToInstant(value);
  if(!occurredAt){setMessage({kind:'missing',text:t.missing});return;}
  const submissionId=submissionIds[`${sample.entryId}:${next}`];if(!submissionId)return;
  const input={version:labStageVersion,id:data.memberId,submissionId,entryId:sample.entryId,stage:next,occurredAt};
  setFrozen(input);void send(input);
 }
 const alert=message&&message.kind!=='saved';
 return <li className="min-w-0 space-y-3 rounded-lg border p-4">
  <h3 className="break-words text-body1 font-medium">{title}</h3>
  <ol aria-label={t.stagesOf(title)} className="space-y-2">{steps.map(([label,at,by],index)=><li key={index} className="flex min-w-0 items-start gap-2 text-body2"><Check className="mt-0.5 size-4 shrink-0 text-brand-teal" aria-hidden/><span className="min-w-0 break-words"><span className="font-medium">{label}</span>{at&&<> · <time dateTime={at}>{yerevanStamp(at,locale)}</time></>}{by&&<span className="text-muted-foreground"> · {by}</span>}</span></li>)}</ol>
  {message&&<p role={alert?'alert':'status'} className="text-body2">{message.text}</p>}
  {message?.kind==='outcome-unknown'&&frozen&&<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send(frozen)}>{pending?t.saving:t.checkAgain}</button>}
  {next&&!open&&!frozen&&<button type="button" className={buttonClass} onClick={()=>{setOpen(true);setMessage(null);}}>{next==='at-lab'?t.markLab:t.markResults}</button>}
  {next&&open&&!frozen&&<form onSubmit={submit} className="space-y-3">
   <label htmlFor={inputId} className="block text-body2 font-medium">{t.when}</label>
   <div className="flex flex-wrap items-center gap-3"><input id={inputId} type="datetime-local" value={value} onChange={event=>setValue(event.target.value)} className={`${fieldClass} min-w-0 max-w-64`} aria-invalid={message?.kind==='missing'||message?.kind==='invalid'||undefined}/>
    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-body2 underline focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>setValue(yerevanInputNow())}><Clock className="size-4" aria-hidden/>{t.now}</button></div>
   <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={pending}>{pending?t.saving:t.save}</button><button type="button" className="inline-flex min-h-11 items-center rounded-md px-3 text-body2 focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>{setOpen(false);setMessage(null);}}>{t.cancel}</button></div>
  </form>}
 </li>;
}
