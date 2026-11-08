'use client';
import {useEffect,useRef,useState,useTransition} from 'react';
import {readCareAlertResolutionRecord} from '@/lib/care-alerts/actions';
import {closeResolutions,closingAsLabel,resolutionLabel,type AlertResolution,type CareAlert} from '@/lib/care-alerts/contracts';
import {suggestResolution,suggestedFromRecord,noContactRecorded,type ResolutionRecord} from '@/lib/care-alerts/resolution-suggestion';
import {Button} from '@/components/ui/button';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

type Props={alert:CareAlert;locale:StaffLocale;closer?:string;disabled?:boolean;from?:'today';action?:(form:FormData)=>void|Promise<void>;onConfirm?:(form:FormData)=>void;onDirty?:(dirty:boolean)=>void};
/** Each surface opens the same editable form. Reading the record never invokes a command. */
export function CareAlertResolve(props:Props){
 const [open,setOpen]=useState(false);
 return <details className="min-w-0 basis-full" onToggle={event=>setOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer content-center rounded-md border px-3 text-body2">{st(props.locale,'Resolve','Լուծել','Закрыть')}</summary>
  <CareAlertResolutionForm key={`${props.alert.id}:${props.alert.stateSeq}:${props.locale}`} {...props} readRecord={open}/>
 </details>;
}
export function CareAlertResolutionForm({alert:a,locale:l,closer,disabled,from,action,onConfirm,onDirty,readRecord=false,initialRecord}:Props&{readRecord?:boolean;initialRecord?:ResolutionRecord}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [record,setRecord]=useState(initialRecord),[status,setStatus]=useState<'idle'|'ready'|'unavailable'|'changed'>(initialRecord?'ready':'idle');
 const initial=suggestResolution(initialRecord??{alert:a,cycleStartedAt:a.createdAt,contacts:[]},l);
 const [outcome,setOutcome]=useState<AlertResolution|''>(initial.outcome),[reason,setReason]=useState(initial.reason);
 const [outcomeEdited,setOutcomeEdited]=useState(false),[reasonEdited,setReasonEdited]=useState(false),[saving,start]=useTransition();
 const requested=useRef(!!initialRecord);
 useEffect(()=>{
  if(!readRecord||requested.current)return;
  requested.current=true;
  void readCareAlertResolutionRecord(a.id).then(value=>{
   if(!value){setStatus('unavailable');return;}
   if(value.alert.id!==a.id||value.alert.memberId!==a.memberId||value.alert.stateSeq!==a.stateSeq){setStatus('changed');return;}
   setRecord(value);const proposal=suggestResolution(value,l);setOutcome(proposal.outcome);setReason(proposal.reason);setStatus('ready');
  }).catch(()=>setStatus('unavailable'));
 // The component is keyed by alert sequence and language; a record is read once per opening session.
 },[readRecord,a.id,a.memberId,a.stateSeq,l]);
 const submitted=useRef(false);
 const held=disabled||saving||status==='idle'||status==='changed';
 const name=closer??record?.closer;
 return <form action={action} onChange={()=>onDirty?.(true)} onSubmit={event=>{
  if(held||submitted.current){event.preventDefault();return;}
  if(onConfirm){event.preventDefault();onConfirm(new FormData(event.currentTarget));}
  else if(action){event.preventDefault();submitted.current=true;const form=new FormData(event.currentTarget);start(async()=>{try{await action(form);}finally{submitted.current=false;}});}
 }} className="mt-3 max-w-md space-y-3 text-foreground" data-resolve-form={a.id}>
  <input type="hidden" name="alertId" value={a.id}/><input type="hidden" name="seq" value={a.stateSeq}/>{from&&<input type="hidden" name="from" value={from}/>}
  {readRecord&&status==='idle'&&<p role="status">{t('Reading the record…','Գրանցված տվյալները բեռնվում են…','Загружаем записи…')}</p>}
  {status==='unavailable'&&<p role="status">{t('The contact record could not be read. Choose an outcome and check the reason.','Կապի գրառումները չհաջողվեց կարդալ։ Ընտրեք արդյունքը և ստուգեք պատճառը։','Не удалось прочитать записи о контакте. Выберите исход и проверьте причину.')}</p>}
  {status==='changed'&&<p role="alert">{t('This alert changed. Reload alerts before resolving.','Ահազանգը փոխվել է։ Լուծելուց առաջ թարմացրեք ահազանգերը։','Оповещение изменилось. Обновите оповещения перед закрытием.')}</p>}
  {status==='ready'&&!initialRecord&&record&&!suggestResolution(record,l).outcome&&<p>{noContactRecorded(l)}</p>}
  {initialRecord&&!initial.outcome&&<p>{noContactRecorded(l)}</p>}
  <fieldset disabled={held} className="min-w-0 space-y-3">
   <label className="block space-y-1 text-body2">{t('Outcome','Արդյունք','Исход')}
    {status==='ready'&&!!outcome&&!outcomeEdited&&<span className="block text-caption text-muted-foreground" data-suggested="outcome">{suggestedFromRecord(l)}</span>}
    <select name="resolution" required value={outcome} onChange={event=>{setOutcome(event.target.value as AlertResolution);setOutcomeEdited(true);onDirty?.(true);}} className="block min-h-11 w-full rounded-md border bg-background p-2 text-base"><option value="" disabled>{t('Choose an outcome','Ընտրեք արդյունքը','Выберите исход')}</option>{closeResolutions.map(r=><option key={r} value={r}>{resolutionLabel(r,l)}</option>)}</select>
   </label>
   <label className="block space-y-1 text-body2">{t('Reason (required, staff only)','Պատճառ (պարտադիր, միայն աշխատակազմի համար)','Причина (обязательно, только для сотрудников)')}
    {!reasonEdited&&reason&&<span className="block text-caption text-muted-foreground" data-suggested="reason">{suggestedFromRecord(l)}</span>}
    <textarea name="note" required maxLength={1000} rows={4} value={reason} onChange={event=>{setReason(event.target.value);setReasonEdited(true);onDirty?.(true);}} className="block w-full rounded-md border bg-background p-2 text-base"/>
   </label>
   {name&&<p className="break-words text-body2" data-closing-as="resolve" aria-live="polite">{closingAsLabel(name,l,outcome?resolutionLabel(outcome,l):undefined)}</p>}
   <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!outcome||!reason.trim()}>{t('Save resolution','Պահպանել լուծումը','Сохранить решение')}</Button>
  </fieldset>
 </form>;
}
