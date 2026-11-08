'use client';
import{useState,type FormEvent}from'react';
import{fieldClass,buttonClass}from'@/components/staff/shell';
import{usePilotCommand}from'./command';
import{PilotOutcome,SourceBadge,secondaryButtonClass}from'./catalog-admin';
import{amd}from'@/lib/pilot-commerce/format';
import{yerevanStamp}from'@/lib/staff/yerevan-time';
import type{AdminPayment,AdminPayments,PaymentLine,PaymentStatus,PilotResult}from'@/lib/pilot-commerce/schema';
import {clinicalLocale,pick,type Locale} from '@/lib/locale';
import {SelectField} from '@/components/ui/select-field';

type Port=(input:Record<string,unknown>)=>Promise<PilotResult>;
type LinkPort=(input:{paymentId:string;revision:number;submissionId:string})=>Promise<PilotResult>;
export const paymentStatusLabel:Record<PaymentStatus,string>={pending:'Awaiting payment',paid:'Paid',failed:'Payment failed',refunded:'Refunded',waived:'Waived'};
const next:Record<PaymentStatus,{status:PaymentStatus;label:string}[]>={
 pending:[{status:'paid',label:'Mark paid'},{status:'failed',label:'Mark failed'},{status:'waived',label:'Waive'}],
 failed:[{status:'pending',label:'Reopen'},{status:'paid',label:'Mark paid'},{status:'waived',label:'Waive'}],
 paid:[{status:'refunded',label:'Mark refunded'}],refunded:[],waived:[],
};
const tone:Record<PaymentStatus,string>={pending:'bg-muted',paid:'bg-surface-subtle-teal text-brand-teal',failed:'bg-destructive/10 text-destructive',refunded:'bg-muted',waived:'bg-muted'};
export function PaymentStatusChip({status,text=paymentStatusLabel[status]}:{status:PaymentStatus;text?:string}){
 return <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-caption font-semibold ${tone[status]}`}>{text}</span>;
}

/** Admin payment records: one per booking, created from the catalogue at today's prices. Fake provider only. */
export function PaymentsAdmin({data,command,issueLink}:{data:AdminPayments;command:Port;issueLink:LinkPort}){
 const [filter,setFilter]=useState<'all'|'none'|PaymentStatus>('all');
 const rows=data.bookings.filter(b=>filter==='all'||(filter==='none'?!b.payment:b.payment?.status===filter));
 return <div className="space-y-6">
  <p role="note" className="rounded-xl border p-4 text-body2">No real payment provider is connected. Davidyants has not said how it collects and confirms payment. Links come from a fake provider and never move money. No card details are stored, ever.</p>
  <label className="block max-w-xs space-y-1 text-body2"><span className="font-medium">Show</span>
   <SelectField value={filter} onValueChange={v=>setFilter(v as typeof filter)} options={[{value:'all',label:`All bookings (${data.bookings.length})`},{value:'none',label:'No payment record'},...(Object.keys(paymentStatusLabel)as PaymentStatus[]).map(s=>({value:s,label:paymentStatusLabel[s]}))]}/></label>
  {rows.length?<ul className="space-y-4">{rows.map(b=><li key={b.bookingId} className="space-y-3 rounded-xl border bg-background p-4 sm:p-6">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 space-y-1"><p className="break-words font-medium">{b.memberName}</p>
     <p className="text-caption text-muted-foreground">{b.bookingKind==='appointment'?'Unified booking':'Test request'} · booked {yerevanStamp(b.bookedAt,'en')} · booking {b.bookingStatus}</p></div>
    {b.payment?<PaymentStatusChip status={b.payment.status}/>:<span className="rounded-md border px-2 py-1 text-caption font-semibold">No payment record</span>}
   </div>
   {b.payment?<PaymentDetail payment={b.payment} cancelled={b.bookingStatus==='cancelled'} command={command} issueLink={issueLink}/>
    :b.preview&&<Preview bookingKind={b.bookingKind} bookingId={b.bookingId} preview={b.preview} command={command}/>}
  </li>)}</ul>:<p className="text-body2">No bookings match.</p>}
 </div>;
}

export function Lines({lines,locale='en'}:{lines:PaymentLine[];locale?:Locale}){
 return <ul className="divide-y text-body2">{lines.map(line=><li key={line.testKey} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
  <span className="min-w-0 break-words">{clinicalLocale(locale)==='hy'?line.nameHy:line.nameEn}</span>
  <span className="shrink-0 font-medium">{line.includedInPackage?pick(locale,{en:'Included in your package',hy:'Ներառված է փաթեթում',ru:'Включено в ваш пакет'}):amd(line.chargedAmd,locale)}</span></li>)}</ul>;
}

function Preview({bookingKind,bookingId,preview,command}:{bookingKind:string;bookingId:string;preview:NonNullable<AdminPayments['bookings'][number]['preview']>;command:Port}){
 const c=usePilotCommand(command);
 return <div className="space-y-3">
  <Lines lines={preview.lines}/>
  {preview.unpriced.length>0&&<div role="alert" className="rounded-lg border border-destructive p-3 text-body2"><p className="font-medium">Not priced, so no record can be created yet:</p>
   <ul className="list-disc pl-5">{preview.unpriced.map((u,i)=><li key={`${u.testKey}-${i}`}>{u.title??u.testKey??'Unknown test'}{u.testKey?` (${u.testKey})`:''}</li>)}</ul></div>}
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-body2 font-semibold">Total at today’s prices {amd(preview.totalAmd)}</p>{preview.lines.length>0&&<SourceBadge source={preview.priceBasis}/>}</div>
  <button type="button" className={buttonClass} disabled={c.pending||preview.unpriced.length>0||preview.lines.length===0} onClick={()=>void c.send({action:'create-payment',bookingKind,bookingId})}>{c.pending?'Creating…':'Create payment record'}</button>
  <PilotOutcome c={c}/>
 </div>;
}

function PaymentDetail({payment,cancelled,command,issueLink}:{payment:AdminPayment;cancelled:boolean;command:Port;issueLink:LinkPort}){
 const link=usePilotCommand(input=>issueLink(input as Parameters<LinkPort>[0]));
 return <div className="space-y-3">
  {cancelled&&payment.status==='paid'&&<p role="alert" className="text-body2 font-medium">This booking is cancelled but its payment is marked paid. Decide whether to refund it.</p>}
  <Lines lines={payment.lines}/>
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-body2 font-semibold">Total {amd(payment.amountAmd)}</p><SourceBadge source={payment.priceBasis}/></div>
  <p className="text-caption text-muted-foreground">Provider {payment.provider}{payment.providerReference?` · reference ${payment.providerReference}`:' · no link issued'}</p>
  {(payment.status==='pending'||payment.status==='failed')&&!payment.providerReference&&<div className="space-y-2">
   <button type="button" className={secondaryButtonClass} disabled={link.pending} onClick={()=>void link.send({paymentId:payment.id,revision:payment.revision})}>{link.pending?'Issuing…':'Issue payment link (fake provider)'}</button>
   <PilotOutcome c={link}/></div>}
  {next[payment.status].length>0&&<StatusForm key={payment.revision} payment={payment} command={command}/>}
  <details className="rounded-lg border px-3"><summary className="min-h-11 cursor-pointer py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">History ({payment.events.length})</summary>
   <ul className="divide-y pb-3 text-body2">{payment.events.map((e,i)=><li key={i} className="space-y-1 py-2">
    <p>{e.kind==='created'?'Record created':e.kind==='reference'?`Link reference ${e.providerReference}`:`${e.fromStatus?paymentStatusLabel[e.fromStatus]:''} to ${e.toStatus?paymentStatusLabel[e.toStatus]:''}`}</p>
    <p className="text-caption text-muted-foreground">{yerevanStamp(e.at,'en')} · {e.actorKind==='provider'?`provider ${e.actorName}`:e.actorName}{e.reason?` · ${e.reason}`:''}{e.kind==='status'&&e.providerReference?` · reference ${e.providerReference}`:''}</p></li>)}</ul>
  </details>
 </div>;
}

function StatusForm({payment,command}:{payment:AdminPayment;command:Port}){
 const c=usePilotCommand(command);
 const options=next[payment.status];
 const [status,setStatus]=useState<PaymentStatus>(options[0].status),[reason,setReason]=useState(''),[reference,setReference]=useState('');
 function submit(event:FormEvent){event.preventDefault();void c.send({action:'set-status',paymentId:payment.id,revision:payment.revision,status,reason:reason.trim(),reference:reference.trim()||null});}
 return <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" aria-label="Record a payment change">
  <p className="text-body2 font-medium">Record a change</p>
  <div className="grid gap-3 sm:grid-cols-3">
   <label className="block space-y-1 text-body2"><span>Change</span><SelectField value={status} onValueChange={v=>setStatus(v as PaymentStatus)} options={options.map(o=>({value:o.status,label:o.label}))}/></label>
   <label className="block space-y-1 text-body2"><span>{status==='paid'?'Receipt or bank reference':'Reference (optional)'}</span><input required={status==='paid'} maxLength={200} value={reference} onChange={e=>setReference(e.target.value)} className={fieldClass}/></label>
   <label className="block space-y-1 text-body2"><span>Reason</span><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className={fieldClass}/></label>
  </div>
  <button className={buttonClass} disabled={c.pending}>{c.pending?'Saving…':'Save change'}</button>
  <PilotOutcome c={c}/>
 </form>;
}
