"use client";
import {useActionState,useState} from 'react';
import {CalendarPlus,CalendarX2} from 'lucide-react';
import {createBookingSlot,closeBookingSlot,type SlotActionState} from '@/lib/staff/booking-slot-actions';
import {SelectField} from '@/components/ui/select-field';

const control='min-h-12 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';
const label='block space-y-2 text-body2';

export function BookingSlotForm({clinics,tests,requestId}:{clinics:{id:string;name:string;hasAddress:boolean}[];tests:{id:string;title:string}[];requestId:string}){
 const [state,submit,pending]=useActionState(createBookingSlot,{ok:false} as SlotActionState);
 const [mode,setMode]=useState<'home'|'clinic'>('clinic');
 const locked=pending||state.ok;
 return <form action={submit} className="space-y-5 rounded-xl border bg-background p-5" aria-busy={pending}>
  <input type="hidden" name="requestId" value={requestId}/>
  <fieldset disabled={locked} className="space-y-5">
   <legend className="text-h3 font-semibold">Add a visit slot</legend>
   <p className="text-body2 text-muted-foreground">Enter the times the clinic sent you. A slot is offered to a member only when it does at least one of their tests and every other test has a follow-up below.</p>
   <div className="grid gap-4 sm:grid-cols-2">
    <label className={label}><span className="font-medium">Clinic</span><SelectField name="clinicId" required placeholder="Choose a clinic" options={clinics.map(clinic=>({value:clinic.id,label:clinic.name,description:clinic.hasAddress?undefined:'No address'}))}/></label>
    <fieldset><legend className="mb-2 text-body2 font-medium">Visit type</legend><div className="grid grid-cols-2 gap-2">{(['clinic','home'] as const).map(value=><label key={value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="radio" name="mode" value={value} checked={mode===value} onChange={()=>setMode(value)} className="size-4 accent-primary"/>{value==='clinic'?'At the clinic':'Home visit'}</label>)}</div></fieldset>
    <label className={label}><span className="font-medium">Date</span><input type="date" name="date" required className={control}/></label>
    <div className="grid grid-cols-2 gap-3"><label className={label}><span className="font-medium">Start (UTC+4)</span><input type="time" name="start" required className={control}/></label><label className={label}><span className="font-medium">End (UTC+4)</span><input type="time" name="end" required className={control}/></label></div>
    <label className={label}><span className="font-medium">Number of visits</span><input type="number" name="capacity" min={1} max={50} defaultValue={1} required className={control}/></label>
    <label className={label}><span className="font-medium">Source reference</span><span className="block text-caption text-muted-foreground">Where these times came from, for example the clinic email and date.</span><input name="reference" required minLength={3} maxLength={200} className={control}/></label>
   </div>
   <fieldset><legend className="mb-2 text-body2 font-medium">Tests done in this slot</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tests.map(test=><label key={test.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="checkbox" name="tests" value={test.id} className="size-4 shrink-0 accent-primary"/><span className="break-words">{test.title}</span></label>)}</div></fieldset>
   <label className={label}><span className="font-medium">Preparation instructions</span><span className="block text-caption text-muted-foreground">Shown to the member and included in the clinic email. Use approved text only.</span><textarea name="preparation" required maxLength={8000} rows={3} className={control}/></label>
   <details className="rounded-lg border border-border px-3"><summary className="min-h-12 cursor-pointer py-3 text-body2 font-medium">Follow-up for tests not done in this slot (optional)</summary><div className="grid gap-4 pb-4 sm:grid-cols-2">
    <label className={label}><span className="font-medium">Who arranges them</span><input name="followUpOwner" maxLength={300} className={control}/></label>
    <label className={label}><span className="font-medium">What happens</span><input name="followUpAction" maxLength={2000} className={control}/></label>
    <p className="text-caption text-muted-foreground sm:col-span-2">Without a follow-up, members who need a test this slot does not do will not see it.</p>
   </div></details>
   {mode==='home'&&<p className="text-caption text-muted-foreground">For a home visit, the member enters their address when booking.</p>}
  </fieldset>
  {state.message&&<p role={state.ok?'status':'alert'} className="text-body2">{state.message}</p>}
  {state.ok?<a href="/staff/real/booking-slots" className="inline-flex min-h-12 items-center gap-2 rounded-lg border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Add another slot</a>
  :<button type="submit" disabled={pending} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"><CalendarPlus className="size-4" aria-hidden/>{pending?'Saving…':'Add slot'}</button>}
 </form>;
}

export function CloseSlotButton({slotKey}:{slotKey:string}){
 const [state,submit,pending]=useActionState(closeBookingSlot,{ok:false} as SlotActionState);
 if(state.ok)return <p role="status" className="text-caption">{state.message}</p>;
 return <form action={submit} className="space-y-1"><input type="hidden" name="key" value={slotKey}/><button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-body2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"><CalendarX2 className="size-4" aria-hidden/>{pending?'Closing…':'Stop offering'}</button>{state.message&&<p role="alert" className="text-caption">{state.message}</p>}</form>;
}
