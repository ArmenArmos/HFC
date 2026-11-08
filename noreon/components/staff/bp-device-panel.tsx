'use client';
import type{Locale}from'@/lib/locale';
import{useState,type FormEvent}from'react';
import{Clock,HeartPulse}from'lucide-react';
import{fieldClass,buttonClass}from'./shell';
import{useBpCommand,type BpLocale}from'./bp-device-command';
import{BpAssignmentHistory}from'./bp-assignment-history';
import{bpDeviceVersion,type BpDeviceCommandPort,type BpMemberDevices}from'@/lib/bp-device/schema';
import{yerevanStamp,yerevanInputNow,yerevanInputToInstant}from'@/lib/staff/yerevan-time';
import {SelectField} from '@/components/ui/select-field';

const copy={
 en:{title:'BP monitor',intro:'Which monitor this member holds. Readings from a monitor are accepted only for the member holding it at the time of the reading.',
  none:'No monitor is assigned.',holds:'Holds',since:'since',by:'recorded by',handOver:'Record hand-over',device:'Monitor',choose:'Choose a monitor',
  noneAvailable:'No monitors are in stock. An admin registers new monitors on the BP monitors page.',when:'Handed over at (Yerevan time, leave empty for now)',now:'Use current time',
  note:'Note (optional)',reassignReason:'Reason for moving it from the current holder (required)',held:(name:string)=>`held by ${name}`,save:'Save',saving:'Saving…',
  giveBack:'Record return',endedAt:'Returned at (Yerevan time, leave empty for now). An earlier time sends readings after it back to review.',outcome:'What happened',returned:'Returned',lost:'Lost',faulty:'Faulty',why:'Reason (required)',checkAgain:'Check again',history:'Holding history',awaiting:'Automatic sync from monitors is not available yet, so readings are entered by hand.'},
 hy:{title:'Ճնշման սարք',intro:'Որ սարքն է այս անդամի մոտ։ Սարքի չափումներն ընդունվում են միայն այն անդամի համար, ում մոտ էր սարքը չափման պահին։',
  none:'Սարք կցված չէ։',holds:'Մոտն է',since:'սկսած',by:'գրանցել է',handOver:'Գրանցել հանձնումը',device:'Սարք',choose:'Ընտրեք սարքը',
  noneAvailable:'Պահեստում սարքեր չկան։ Նոր սարքերը գրանցում է ադմինիստրատորը։',when:'Հանձնման ժամը (Երևանի ժամով, դատարկ՝ հիմա)',now:'Օգտագործել ընթացիկ ժամը',
  note:'Նշում (ըստ ցանկության)',reassignReason:'Ներկա տիրոջից տեղափոխելու պատճառը (պարտադիր)',held:(name:string)=>`${name}-ի մոտ`,save:'Պահպանել',saving:'Պահպանվում է…',
  giveBack:'Գրանցել վերադարձը',endedAt:'Վերադարձի ժամը (Երևանի ժամով, դատարկ՝ հիմա)։',outcome:'Ինչ է տեղի ունեցել',returned:'Վերադարձվել է',lost:'Կորել է',faulty:'Անսարք է',why:'Պատճառը (պարտադիր)',checkAgain:'Կրկին ստուգել',history:'Պատմություն',awaiting:'Սարքերից ավտոմատ համաժամեցումը դեռ հասանելի չէ, ուստի ցուցմունքները մուտքագրվում են ձեռքով։'},
 ru:{title:'Тонометр',intro:'Какой тонометр находится у этого участника. Измерения с тонометра принимаются только для того участника, у которого он находился в момент измерения.',
  none:'Тонометр не назначен.',holds:'Находится у участника',since:'с',by:'записал(а)',handOver:'Записать передачу',device:'Тонометр',choose:'Выберите тонометр',
  noneAvailable:'На складе нет тонометров. Администратор регистрирует новые тонометры на странице тонометров.',when:'Время передачи (по времени Еревана; оставьте пустым для текущего времени)',now:'Использовать текущее время',
  note:'Заметка (необязательно)',reassignReason:'Причина передачи от текущего владельца (обязательно)',held:(name:string)=>`у ${name}`,save:'Сохранить',saving:'Сохраняется…',
  giveBack:'Записать возврат',endedAt:'Время возврата (по времени Еревана; оставьте пустым для текущего времени). Более раннее время отправляет последующие измерения на повторное рассмотрение.',outcome:'Что произошло',returned:'Возвращен',lost:'Потерян',faulty:'Неисправен',why:'Причина (обязательно)',checkAgain:'Проверить еще раз',history:'История пользования',awaiting:'Автоматическая синхронизация с тонометрами пока недоступна, поэтому измерения вводятся вручную.'},
} satisfies Record<Locale,{title:string;intro:string;none:string;holds:string;since:string;by:string;handOver:string;device:string;choose:string;noneAvailable:string;when:string;now:string;note:string;reassignReason:string;held:(name:string)=>string;save:string;saving:string;giveBack:string;endedAt:string;outcome:string;returned:string;lost:string;faulty:string;why:string;checkAgain:string;history:string;awaiting:string}>;
type Props={data:BpMemberDevices;locale:BpLocale;role:'admin'|'nurse'|'doctor';submissionIds:{assign:string;end:string};command:BpDeviceCommandPort};

export function BpDevicePanel({data,locale,role,submissionIds,command}:Props){
 const t=copy[locale];
 const canChange=role==='admin'||role==='nurse';
 const current=data.current;
 return <section className="max-w-3xl space-y-4 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="bp-device-title" lang={locale}>
  <header className="space-y-1"><h2 id="bp-device-title" className="flex items-center gap-2 text-h3"><HeartPulse className="size-5" aria-hidden/>{t.title}</h2><p className="text-body2 text-muted-foreground">{t.intro}</p></header>
  {current?<p className="break-words text-body2"><span className="font-medium">{t.holds}: {current.serial}</span> · {current.model} · {t.since} <time dateTime={current.assignedAt}>{yerevanStamp(current.assignedAt,locale)}</time><span className="text-muted-foreground"> · {t.by} {current.assignedBy.name}</span></p>
   :<p className="text-body2">{t.none}</p>}
  {canChange&&!current&&<AssignForm data={data} locale={locale} role={role} submissionId={submissionIds.assign} command={command}/>}
  {canChange&&current&&<EndForm deviceId={current.deviceId} admin={role==='admin'} locale={locale} submissionId={submissionIds.end} command={command}/>}
  <p className="text-caption text-muted-foreground">{t.awaiting}</p>
  {data.history.length>0&&<details><summary className="min-h-11 cursor-pointer text-body2">{t.history} ({data.history.length})</summary><BpAssignmentHistory history={data.history} locale={locale}/></details>}
 </section>;
}

function AssignForm({data,locale,role,submissionId,command}:{data:BpMemberDevices;locale:BpLocale;role:'admin'|'nurse'|'doctor';submissionId:string;command:BpDeviceCommandPort}){
 const t=copy[locale];
 const [device,setDevice]=useState(''),[when,setWhen]=useState(''),[note,setNote]=useState('');
 const c=useBpCommand(command,locale);
 const selected=data.available.find(item=>item.id===device);
 const reassign=selected?.status==='assigned';
 if(!data.available.length)return <p className="text-body2">{t.noneAvailable}</p>;
 function submit(event:FormEvent){
  event.preventDefault();if(!device||c.pending)return;
  const effectiveAt=when?yerevanInputToInstant(when):null;if(when&&!effectiveAt)return;
  void c.send({version:bpDeviceVersion,submissionId,action:'assign',deviceId:device,memberId:data.memberId,effectiveAt,reason:note.trim()||null});
 }
 return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
  <h3 className="text-body1 font-medium">{t.handOver}</h3>
  <label className="block space-y-1 text-body2"><span className="font-medium">{t.device}</span>
   <SelectField required value={device} onValueChange={setDevice} placeholder={t.choose} options={data.available.map(item=>({value:item.id,label:item.serial,description:`${item.model}${item.holderName?` · ${t.held(item.holderName)}`:''}`}))}/></label>
  {role==='admin'||role==='nurse'?<div className="space-y-1"><label htmlFor="bp-handover-when" className="block text-body2 font-medium">{t.when}</label>
   <div className="flex flex-wrap items-center gap-3"><input id="bp-handover-when" type="datetime-local" value={when} onChange={event=>setWhen(event.target.value)} className={`${fieldClass} min-w-0 max-w-64`}/>
    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-body2 underline focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>setWhen(yerevanInputNow())}><Clock className="size-4" aria-hidden/>{t.now}</button></div></div>:null}
  <label className="block space-y-1 text-body2"><span className="font-medium">{reassign?t.reassignReason:t.note}</span>
   <input value={note} required={reassign} maxLength={500} onChange={event=>setNote(event.target.value)} className={`${fieldClass} w-full`}/></label>
  <Outcome c={c} locale={locale}/>
  <button className={buttonClass} disabled={c.pending||!!c.frozen}>{c.pending?t.saving:t.save}</button>
 </form>;
}

function EndForm({deviceId,admin,locale,submissionId,command}:{deviceId:string;admin:boolean;locale:BpLocale;submissionId:string;command:BpDeviceCommandPort}){
 const t=copy[locale];
 const [open,setOpen]=useState(false),[status,setStatus]=useState<'returned'|'lost'|'faulty'>('returned'),[why,setWhy]=useState(''),[when,setWhen]=useState('');
 const c=useBpCommand(command,locale);
 if(!open)return <button type="button" className={buttonClass} onClick={()=>setOpen(true)}>{t.giveBack}</button>;
 function submit(event:FormEvent){
  event.preventDefault();if(c.pending||!why.trim())return;
  const effectiveAt=admin&&when?yerevanInputToInstant(when):null;if(admin&&when&&!effectiveAt)return;
  void c.send({version:bpDeviceVersion,submissionId,action:'end',deviceId,status,reason:why.trim(),effectiveAt});
 }
 return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
  <h3 className="text-body1 font-medium">{t.giveBack}</h3>
  <fieldset className="space-y-2"><legend className="text-body2 font-medium">{t.outcome}</legend>
   <div className="flex flex-wrap gap-4">{(['returned','lost','faulty'] as const).map(value=><label key={value} className="inline-flex min-h-11 items-center gap-2 text-body2"><input type="radio" name="bp-end-status" checked={status===value} onChange={()=>setStatus(value)}/>{t[value]}</label>)}</div></fieldset>
  <label className="block space-y-1 text-body2"><span className="font-medium">{t.why}</span><input required maxLength={500} value={why} onChange={event=>setWhy(event.target.value)} className={`${fieldClass} w-full`}/></label>
  {admin&&<label className="block space-y-1 text-body2"><span className="font-medium">{t.endedAt}</span><input type="datetime-local" value={when} onChange={event=>setWhen(event.target.value)} className={`${fieldClass} min-w-0 max-w-64`}/></label>}
  <Outcome c={c} locale={locale}/>
  <button className={buttonClass} disabled={c.pending||!!c.frozen}>{c.pending?t.saving:t.save}</button>
 </form>;
}

export function Outcome({c,locale}:{c:ReturnType<typeof useBpCommand>;locale:BpLocale}){
 if(!c.message)return null;
 return <div className="space-y-2"><p role={c.failed?'alert':'status'} className="text-body2">{c.message}</p>
  {c.frozen&&<button type="button" className={buttonClass} disabled={c.pending} onClick={()=>c.frozen&&void c.send(c.frozen)}>{copy[locale].checkAgain}</button>}</div>;
}
