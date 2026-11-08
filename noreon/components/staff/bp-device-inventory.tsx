'use client';
import{useState,type FormEvent}from'react';
import Link from'next/link';
import{fieldClass,buttonClass}from'./shell';
import{useBpCommand}from'./bp-device-command';
import{Outcome}from'./bp-device-panel';
import{BpAssignmentHistory}from'./bp-assignment-history';
import{bpDeviceVersion,type BpDevice,type BpDeviceCommandPort,type BpHeldReading,type BpInventory}from'@/lib/bp-device/schema';
import{yerevanStamp}from'@/lib/staff/yerevan-time';
import {SelectField} from '@/components/ui/select-field';

type Ids={register:string;status:Record<string,string>;recheck:Record<string,string>;dismiss:Record<string,string>};
const statusLabel={'in-stock':'In stock',assigned:'Assigned',returned:'Returned, to check',lost:'Lost',faulty:'Faulty'} as const;
const holdLabel={'unknown-device':'Serial not registered','no-assignment':'No member held this monitor at that time','member-mismatch':'Synced from a different member than the holder'} as const;

/** Admin inventory. Operational only: held readings show no values. */
export function BpDeviceInventory({data,ids,command}:{data:BpInventory;ids:Ids;command:BpDeviceCommandPort}){
 return <div className="space-y-6">
  <RegisterForm submissionId={ids.register} command={command}/>
  <section aria-labelledby="bp-devices-title" className="space-y-3 rounded-xl border bg-background p-4 sm:p-6">
   <h2 id="bp-devices-title" className="text-h3">Monitors ({data.devices.length})</h2>
   {data.devices.length?<ul className="divide-y">{data.devices.map(device=><DeviceRow key={device.id} device={device} submissionId={ids.status[device.id]} command={command}/>)}</ul>:<p className="text-body2">No monitors registered yet.</p>}
  </section>
  <section aria-labelledby="bp-held-title" className="space-y-3 rounded-xl border bg-background p-4 sm:p-6">
   <header className="space-y-1"><h2 id="bp-held-title" className="text-h3">Readings held for review ({data.held.length})</h2>
    <p className="text-body2 text-muted-foreground">A reading is held when its monitor was not with a member at the time, or it came from a different member than the holder. Fix the holding history if it was wrong, then check again. Otherwise dismiss it with a reason.</p></header>
   {data.held.length?<ul className="divide-y">{data.held.map(reading=><HeldRow key={reading.id} reading={reading} ids={ids} command={command}/>)}</ul>:<p className="text-body2">Nothing is held.</p>}
  </section>
 </div>;
}

function RegisterForm({submissionId,command}:{submissionId:string;command:BpDeviceCommandPort}){
 const [model,setModel]=useState(''),[serial,setSerial]=useState('');
 const c=useBpCommand(command,'en');
 function submit(event:FormEvent){event.preventDefault();if(c.pending)return;void c.send({version:bpDeviceVersion,submissionId,action:'register',model:model.trim(),serial:serial.trim()});}
 return <form onSubmit={submit} className="space-y-3 rounded-xl border bg-background p-4 sm:p-6" aria-labelledby="bp-register-title">
  <h2 id="bp-register-title" className="text-h3">Register a monitor</h2>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="block space-y-1 text-body2"><span className="font-medium">Model</span><input required maxLength={120} value={model} onChange={event=>setModel(event.target.value)} className={`${fieldClass} w-full`}/></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">Serial number</span><input required pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,63}" title="3 to 64 letters, digits or hyphens" value={serial} onChange={event=>setSerial(event.target.value)} className={`${fieldClass} w-full uppercase`} autoCapitalize="characters" spellCheck={false}/></label>
  </div>
  <Outcome c={c} locale="en"/>
  <button className={buttonClass} disabled={c.pending||!!c.frozen}>{c.pending?'Saving…':'Register monitor'}</button>
 </form>;
}

function DeviceRow({device,submissionId,command}:{device:BpDevice;submissionId:string;command:BpDeviceCommandPort}){
 const [status,setStatus]=useState<'in-stock'|'returned'|'lost'|'faulty'>(device.status==='assigned'?'returned':device.status),[why,setWhy]=useState('');
 const c=useBpCommand(command,'en');
 function submit(event:FormEvent){event.preventDefault();if(c.pending)return;void c.send({version:bpDeviceVersion,submissionId,action:'set-status',deviceId:device.id,status,reason:why.trim()||null});}
 return <li className="space-y-2 py-4">
  <p className="break-words text-body1"><span className="font-medium">{device.serial}</span> · {device.model} · <span className="rounded-md bg-muted px-2 py-0.5 text-caption">{statusLabel[device.status]}</span></p>
  {device.holder&&<p className="break-words text-body2">Held by <Link className="underline" href={`/staff/real/members/${device.holder.memberId}`}>{device.holder.memberName}</Link> since <time dateTime={device.holder.since}>{yerevanStamp(device.holder.since,'en')}</time>. Reassign or return it from the member page.</p>}
  <details><summary className="min-h-11 cursor-pointer text-body2">Change status{device.history.length?` and history (${device.history.length})`:''}</summary>
   <form onSubmit={submit} className="mt-2 space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
     <label className="block space-y-1 text-body2"><span className="font-medium">New status</span><SelectField value={status} onValueChange={v=>setStatus(v as typeof status)} options={(['in-stock','returned','lost','faulty'] as const).map(value=>({value,label:statusLabel[value]}))}/></label>
     <label className="block space-y-1 text-body2"><span className="font-medium">Reason{device.holder||status==='lost'||status==='faulty'?' (required)':' (optional)'}</span><input maxLength={500} required={!!device.holder||status==='lost'||status==='faulty'} value={why} onChange={event=>setWhy(event.target.value)} className={`${fieldClass} w-full`}/></label>
    </div>
    {device.holder&&<p className="text-caption text-muted-foreground">This ends the current holding period.</p>}
    <Outcome c={c} locale="en"/>
    <button className={buttonClass} disabled={c.pending||!!c.frozen}>{c.pending?'Saving…':'Save status'}</button>
   </form>
   {device.history.length>0&&<BpAssignmentHistory history={device.history} locale="en" showMember/>}
  </details>
 </li>;
}

function HeldRow({reading,ids,command}:{reading:BpHeldReading;ids:Ids;command:BpDeviceCommandPort}){
 const [why,setWhy]=useState('');
 const recheck=useBpCommand(command,'en'),dismiss=useBpCommand(command,'en');
 function submit(event:FormEvent){event.preventDefault();if(dismiss.pending||!why.trim())return;void dismiss.send({version:bpDeviceVersion,submissionId:ids.dismiss[reading.id],action:'dismiss-held',readingId:reading.id,reason:why.trim()});}
 return <li className="space-y-2 py-4">
  <p className="break-words text-body1"><span className="font-medium">{reading.serial}</span> · measured <time dateTime={reading.measuredAt}>{yerevanStamp(reading.measuredAt,'en')}</time></p>
  <p className="text-body2">{holdLabel[reading.reason]}{reading.claimedMember&&<> · synced from <Link className="underline" href={`/staff/real/members/${reading.claimedMember.id}`}>{reading.claimedMember.name}</Link></>}</p>
  <div className="flex flex-wrap items-start gap-3">
   <button type="button" className={buttonClass} disabled={recheck.pending||!!recheck.frozen} onClick={()=>void recheck.send({version:bpDeviceVersion,submissionId:ids.recheck[reading.id],action:'recheck-held',readingId:reading.id})}>{recheck.pending?'Checking…':'Check against history again'}</button>
  </div>
  <Outcome c={recheck} locale="en"/>
  <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
   <label className="block min-w-0 flex-1 space-y-1 text-body2"><span className="font-medium">Reason to dismiss</span><input required maxLength={500} value={why} onChange={event=>setWhy(event.target.value)} className={`${fieldClass} w-full`}/></label>
   <button className={buttonClass} disabled={dismiss.pending||!!dismiss.frozen}>{dismiss.pending?'Saving…':'Dismiss reading'}</button>
  </form>
  <Outcome c={dismiss} locale="en"/>
 </li>;
}
