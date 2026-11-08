'use client';
import {lazy,Suspense,useRef,useState,useTransition,type ReactNode} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {resolutionLabel,type CareAlert} from '@/lib/care-alerts/contracts';
import {changeCareAlert} from '@/lib/care-alerts/actions';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {AlertCardLines} from './alert-card';
import {CareAlertResolve} from './care-alert-resolve';
import type {NurseAlert,NurseAlertRead} from '@/lib/care-alerts/nurse';
/** WP V: loaded only where voice acknowledgement is switched on. */
const VoiceAck=lazy(()=>import('./voice-ack').then(m=>({default:m.VoiceAck})));

export function NurseAlertReadFailure({read,locale:l}:{read:NurseAlertRead|undefined;locale:StaffLocale}){
 if(read?.kind!=='unavailable')return null;
 return <p role="alert" data-urgent-alerts="unavailable">{st(l,'Urgent alerts could not be read. The list is incomplete. Reload to check.','Շտապ ահազանգերը չհաջողվեց կարդալ։ Ցանկը թերի է։ Թարմացրեք՝ ստուգելու համար։','Не удалось прочитать срочные оповещения. Список неполный. Обновите для проверки.')}</p>;
}

/** The existing alert commands, inline in every nurse queue. Only confirmed responses change the row. */
export function NurseUrgentAlertRow({alert,locale:l,nurseName,member,onChanged,onPendingChange,voice=false}:{alert:NurseAlert;locale:StaffLocale;nurseName?:string;member?:(alert:NurseAlert)=>ReactNode;onChanged?:(alert:CareAlert)=>void;onPendingChange?:(key:string,pending:boolean)=>void;
 /** WP V: acknowledge by a spoken yes, bound to this alert and its sequence. */voice?:boolean}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [source,setSource]=useState(alert),[current,setCurrent]=useState(alert),[notice,setNotice]=useState(''),[stale,setStale]=useState(false);
 if(source!==alert){setSource(alert);setCurrent(alert);setNotice('');setStale(false);}
 const [busy,start]=useTransition(),locked=useRef(false),savedDue=useRef('');
 const a=current;
 const pending=(kind:string,value:boolean)=>onPendingChange?.(`${a.id}:${kind}`,value);
 function save(kind:'acknowledge'|'next_action'|'resolve',form?:FormData){
  if(locked.current||stale)return;locked.current=true;
  if(kind!=='acknowledge')pending(kind,true);
  start(async()=>{
   try{
    const due=String(form?.get('dueAt')??'');
    const result=await changeCareAlert({kind,alertId:a.id,seq:a.stateSeq,text:form?.get('text'),dueAt:due?new Date(due).toISOString():null,resolution:form?.get('resolution'),note:form?.get('note')});
    if(result.ok){if(kind==='next_action')savedDue.current=String(form?.get('dueAt')??'');if(kind!=='acknowledge')pending(kind,false);if(result.alert.state==='resolved')pending('next_action',false);setCurrent(result.alert);setNotice(t('Alert updated.','Ահազանգը թարմացված է։','Оповещение обновлено.'));onChanged?.(result.alert);}
    else{setStale(result.code!=='invalid');setNotice(result.code==='invalid'?t('Check the required text and outcome.','Ստուգեք պարտադիր տեքստն ու արդյունքը։','Проверьте обязательный текст и исход.'):result.code==='changed'?t('This alert changed. Your text is kept here. Reload alerts and review the latest signal.','Ահազանգը փոխվել է։ Ձեր տեքստն այստեղ պահպանված է։ Թարմացրեք ահազանգերը և ստուգեք վերջին ազդակը։','Оповещение изменилось. Ваш текст сохранён здесь. Обновите оповещения и проверьте последний сигнал.'):t('The change could not be confirmed. Your text is kept here. Reload alerts before trying again.','Փոփոխությունը չհաջողվեց հաստատել։ Ձեր տեքստն այստեղ պահպանված է։ Կրկին փորձելուց առաջ թարմացրեք ահազանգերը։','Не удалось подтвердить изменение. Ваш текст сохранён здесь. Перед повторной попыткой обновите оповещения.'));}
   }catch{setStale(true);setNotice(t('The change could not be confirmed. Reload alerts before trying again.','Փոփոխությունը չհաջողվեց հաստատել։ Կրկին փորձելուց առաջ թարմացրեք ահազանգերը։','Не удалось подтвердить изменение. Перед повторной попыткой обновите оповещения.'));}
   finally{locked.current=false;}
  });
 }
 return <div data-urgent-alert={a.id} className="space-y-2" aria-busy={busy}>
  <p><strong>{member?member(a):<a href={`/staff/real/nurse-chat?member=${a.memberId}`} className="underline underline-offset-4">{a.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</a>}</strong> · {a.state==='resolved'?t('Resolved','Լուծված','Закрыто'):a.state==='acknowledged'?t('Acknowledged','Հաստատված','Подтверждено'):t('Open','Բաց','Открыто')}</p>
  <AlertCardLines alert={a} locale={l}/>
  {a.state==='resolved'&&<p>{a.resolution&&resolutionLabel(a.resolution,l)} · {a.resolvedBy} · {a.resolvedAt&&yerevanStamp(a.resolvedAt,l)}{a.resolutionNote?`: ${a.resolutionNote}`:''}</p>}
  {a.state!=='resolved'&&<fieldset disabled={busy||stale} className="min-w-0 space-y-2">
   {a.state==='open'&&<button type="button" className="dw-pill" onClick={()=>save('acknowledge')}>{t('Acknowledge','Հաստատել','Подтвердить')}</button>}
   {voice&&a.state==='open'&&<Suspense fallback={null}><VoiceAck alert={a} locale={l} disabled={busy||stale} onDone={next=>{if(next){setCurrent(next as typeof a);onChanged?.(next);}else setStale(true);}}/></Suspense>}
   <details><summary className="min-h-11 cursor-pointer content-center">{t('Next action','Հաջորդ գործողություն','Следующее действие')}</summary>
    <form onChange={event=>{const form=new FormData(event.currentTarget);pending('next_action',String(form.get('text')??'')!==(a.nextAction??'')||String(form.get('dueAt')??'')!==savedDue.current);}} onSubmit={event=>{event.preventDefault();save('next_action',new FormData(event.currentTarget));}} className="space-y-2">
     <label className="block">{t('Next action (required)','Հաջորդ գործողություն (պարտադիր)','Следующее действие (обязательно)')}<textarea name="text" required minLength={1} maxLength={300} defaultValue={a.nextAction??''} rows={3} className="block w-full rounded-md border bg-background p-2"/></label>
     <label className="block">{t('Due time (your local time, optional)','Ժամկետ (ձեր տեղական ժամով, ոչ պարտադիր)','Срок (по вашему местному времени, необязательно)')}<input type="datetime-local" name="dueAt" className="block min-h-11 w-full rounded-md border bg-background p-2"/></label>
     <button className="dw-pill">{t('Save next action','Պահպանել հաջորդ գործողությունը','Сохранить следующее действие')}</button>
    </form>
   </details>
   <CareAlertResolve key={`${a.id}:${a.stateSeq}`} alert={a} locale={l} closer={nurseName} disabled={busy||stale} onDirty={dirty=>pending('resolve',dirty)} onConfirm={form=>save('resolve',form)}/>
  </fieldset>}
  {notice&&<p role="status">{notice}</p>}
  {stale&&<a className="inline-flex min-h-11 items-center underline" href="/staff/real/alerts">{t('Reload alerts','Թարմացնել ահազանգերը','Обновить оповещения')}</a>}
 </div>;
}

/** One reader and the same row controls across Alerts, Tasks and the nurse queues. */
export function NurseUrgentAlerts({read,locale:l,member,voice=false}:{read:NurseAlertRead|undefined;locale:StaffLocale;member?:(alert:NurseAlert)=>ReactNode;voice?:boolean}){
 const [source,setSource]=useState(read),[updates,setUpdates]=useState<Record<string,CareAlert>>({});
 if(source!==read){setSource(read);setUpdates({});}
 if(!read||read.kind==='off')return null;
 if(read.kind==='unavailable')return <NurseAlertReadFailure read={read} locale={l}/>;
 const alerts=read.alerts.map(a=>updates[a.id]??a).filter(a=>a.state!=='resolved');
 if(!alerts.length)return null;
 return <section data-urgent-alerts="ready" aria-label={st(l,'Urgent alerts','Շտապ ահազանգեր','Срочные оповещения')} className="space-y-2 rounded-lg border-2 border-destructive p-3">
  <p><strong>{read.total-Object.values(updates).filter(a=>a.state==='resolved').length} {st(l,'urgent','շտապ','срочно')}</strong></p>
  <ul className="space-y-3">{alerts.map(alert=><li key={alert.id}><NurseUrgentAlertRow alert={alert} locale={l} member={member} voice={voice} onChanged={a=>setUpdates(prev=>({...prev,[a.id]:a}))}/></li>)}</ul>
  {read.total>read.alerts.length&&<p>{st(l,'More urgent alerts exist. Reload after reviewing this list to read the rest.','Կան այլ շտապ ահազանգեր։ Այս ցանկը դիտելուց հետո թարմացրեք՝ մնացածը կարդալու համար։','Есть другие срочные оповещения. После проверки этого списка обновите его, чтобы прочитать остальные.')}</p>}
 </section>;
}
