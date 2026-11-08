'use client';
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import type {Route} from 'next';
import {useRouter} from 'next/navigation';
import {fieldClass,buttonClass} from './shell';
import {MemberContactLine} from './member-contact';
import {SelectField} from '@/components/ui/select-field';
import type {MemberContact} from '@/lib/staff/member-contact-schema';
import {yerevanStamp,yerevanInputToInstant} from '@/lib/staff/yerevan-time';
import {consultationArrangeVersion,type ArrangeCommand,type ArrangeCommandPort,type ArrangeResult,type ConsultationQueue} from '@/lib/doctor-completion/consultation-schema';

type Case=ConsultationQueue['cases'][number];
const statusText:Record<Exclude<ArrangeResult['status'],'arranged'>,string>={
 stale:'This consultation changed since you opened the page: the doctor changed or completed it, or someone else arranged it. Reload to see the current list.',
 invalid:'Check the time, the way it happens and the clinic.',
 'invalid-time':'Choose a time in the future, within the next 180 days.',
 disabled:'Consultation arranging is switched off.',
 access:'Only an administrator can arrange consultations.',
 unavailable:'Couldn’t save right now. Your entries are kept. Try again.',
 'outcome-unknown':'Save outcome unknown. Check again: an arrangement is never recorded twice.',
};
const channelLabel=(channel:string,clinic:string|null)=>channel==='clinic'?`At ${clinic??'the clinic'}`:'By phone';

/** The bound server action is the only command port; the database enforces the admin session. */
export function ConsultationQueueView({data,contacts=null,submissionIds,command}:{data:ConsultationQueue;contacts?:Record<string,MemberContact>|null;submissionIds:Record<string,string>;command:ArrangeCommandPort}){
 const open=data.cases.filter(c=>!c.arrangement),arranged=data.cases.filter(c=>c.arrangement);
 return <div className="space-y-8">
  <section aria-labelledby="to-arrange" className="space-y-4"><h2 id="to-arrange" className="text-h2">To arrange ({open.length})</h2>
   {open.length?<ul className="space-y-4">{open.map(c=><CaseRow key={c.memberId} item={c} contact={contacts?contacts[c.memberId]:null} clinics={data.clinics} submissionId={submissionIds[c.memberId]} command={command}/>)}</ul>:<p className="text-body2">No consultation is waiting to be arranged.</p>}</section>
  <section aria-labelledby="arranged" className="space-y-4"><h2 id="arranged" className="text-h2">Arranged ({arranged.length})</h2>
   {arranged.length?<ul className="space-y-4">{arranged.map(c=><CaseRow key={c.memberId} item={c} contact={contacts?contacts[c.memberId]:null} clinics={data.clinics} submissionId={submissionIds[c.memberId]} command={command}/>)}</ul>:<p className="text-body2">No arranged consultation is waiting for the doctor.</p>}</section>
 </div>;
}

function CaseRow({item,contact,clinics,submissionId,command}:{item:Case;contact:MemberContact|null|undefined;clinics:ConsultationQueue['clinics'];submissionId:string|undefined;command:ArrangeCommandPort}){
 const router=useRouter();
 const [editing,setEditing]=useState(!item.arrangement),[when,setWhen]=useState(''),[channel,setChannel]=useState<'phone'|'clinic'>('phone'),[clinicId,setClinicId]=useState(clinics[0]?.id??'');
 const [pending,setPending]=useState(false),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null),[frozen,setFrozen]=useState<ArrangeCommand|null>(null);
 const id=item.memberId;
 async function send(input:ArrangeCommand){
  setPending(true);setMessage(null);
  const result=await command(input).catch(():ArrangeResult=>({status:'outcome-unknown'}));
  setPending(false);
  if(result.status==='arranged'){setFrozen(null);setEditing(false);setWhen('');setMessage({ok:true,text:'Arranged. The member now sees the time.'});router.refresh();return;}
  if(result.status!=='outcome-unknown')setFrozen(null);
  setMessage({ok:false,text:statusText[result.status]});
 }
 function submit(event:FormEvent){
  event.preventDefault();if(pending||!submissionId)return;
  const scheduledAt=yerevanInputToInstant(when);
  if(!scheduledAt){setMessage({ok:false,text:'Enter the date and time (Yerevan time).'});return;}
  if(channel==='clinic'&&!clinicId){setMessage({ok:false,text:'Choose the clinic.'});return;}
  const input:ArrangeCommand={version:consultationArrangeVersion,submissionId,memberId:id,since:item.since,previous:item.arrangement?.arrangedAt??null,scheduledAt,channel,...(channel==='clinic'?{clinicId}:{})};
  setFrozen(input);void send(input);
 }
 return <li className="min-w-0 space-y-3 rounded-xl border bg-background p-4 sm:p-5">
  <div className="space-y-1">
   <Link href={`/staff/real/members/${id}` as Route} className="text-body1 font-semibold underline underline-offset-4">{item.memberName||'Member'}</Link>
   <p className="text-caption text-muted-foreground">Doctor: {item.doctorName??'Not recorded'} · Requested <time dateTime={item.since}>{yerevanStamp(item.since,'en')}</time></p>
   {item.arrangement&&<p className="text-body2">Arranged for <time dateTime={item.arrangement.scheduledAt}>{yerevanStamp(item.arrangement.scheduledAt,'en')}</time> · {channelLabel(item.arrangement.channel,item.arrangement.clinic)}<span className="text-muted-foreground"> · by {item.arrangement.arrangedBy??'an administrator'}, {yerevanStamp(item.arrangement.arrangedAt,'en')}</span></p>}
  </div>
  <MemberContactLine contact={contact}/>
  {message&&<p role={message.ok?'status':'alert'} className="text-body2">{message.text}</p>}
  {frozen&&message&&!message.ok?<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send(frozen)}>{pending?'Saving…':'Check again'}</button>
  :!editing?<button type="button" className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>{setEditing(true);setMessage(null);}}>Change arrangement</button>
  :<form onSubmit={submit} className="space-y-3">
   <label className="block space-y-1 text-body2"><span className="font-medium">Date and time (Yerevan time)</span><input type="datetime-local" required value={when} onChange={e=>setWhen(e.target.value)} className={`${fieldClass} block min-w-0 max-w-64`}/></label>
   <fieldset className="space-y-2 text-body2"><legend className="font-medium">How it happens</legend>
    <label className="flex min-h-11 items-center gap-3"><input type="radio" name={`channel-${id}`} value="phone" checked={channel==='phone'} onChange={()=>setChannel('phone')} className="size-5"/>By phone</label>
    <label className="flex min-h-11 items-center gap-3"><input type="radio" name={`channel-${id}`} value="clinic" checked={channel==='clinic'} onChange={()=>setChannel('clinic')} className="size-5" disabled={!clinics.length}/>At a clinic</label>
    <p className="text-caption text-muted-foreground">Video consultations are not available yet.</p>
   </fieldset>
   {channel==='clinic'&&<label className="block space-y-1 text-body2"><span className="font-medium">Clinic</span><SelectField value={clinicId} onValueChange={setClinicId} className="max-w-sm" options={clinics.map(k=>({value:k.id,label:k.name}))}/></label>}
   <button className={buttonClass} disabled={pending||!submissionId}>{pending?'Saving…':item.arrangement?'Save new arrangement':'Mark arranged'}</button>
  </form>}
 </li>;
}
