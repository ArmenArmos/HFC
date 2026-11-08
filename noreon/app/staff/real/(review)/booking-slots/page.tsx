import {randomUUID} from 'node:crypto';
import Link from 'next/link';
import {bookingChannelConfigured,homeRequestsOnly} from '@/lib/real-booking/legacy-mode';
import {CalendarClock,RotateCcw} from 'lucide-react';
import {getRealClinics,requireRealAdmin} from '@/lib/staff/real-admin';
import {getBookingSlots,slotTests,type BookingSlot} from '@/lib/staff/booking-slots';
import {memberRequestedAt} from '@/lib/staff/member-queue-format';
import {BookingSlotForm,CloseSlotButton} from '@/components/real-review/booking-slot-form';

const testTitle=(id:string)=>slotTests.find(test=>test.id===id)?.title??id;
const clock=(value:string)=>memberRequestedAt(value).split(' ')[1];

function SlotList({slots}:{slots:BookingSlot[]}){
 if(!slots.length)return <p role="status" className="rounded-xl border bg-background p-5 text-body2 text-muted-foreground">No upcoming slots. Add the times the clinic sent you.</p>;
 return <ul className="divide-y rounded-xl border bg-background">{slots.map(slot=>{
  const offer=slot.offers[0];
  return <li key={slot.key} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
   <div className="min-w-0 space-y-1">
    <p className="text-body1 font-semibold">{memberRequestedAt(slot.startsAt).split(' ')[0]} · {clock(slot.startsAt)}–{clock(slot.endsAt)} <span className="text-caption font-normal text-muted-foreground">UTC+4</span></p>
    <p className="text-body2">{slot.clinicName} · {offer?.mode==='home'?'Home visit':'At the clinic'}</p>
    <p className="text-body2"><span className="font-medium">{slot.held} of {slot.capacity}</span> booked{slot.open?'':' · not offered'}</p>
    {offer&&<p className="break-words text-caption text-muted-foreground">Tests: {offer.coveredTestIds.map(testTitle).join(', ')}</p>}
    <p className="break-words text-caption text-muted-foreground">Source: {slot.reference.replace(/ · [0-9a-f-]{36}$/,'')}</p>
   </div>
   {slot.open&&<CloseSlotButton slotKey={slot.key}/>}
  </li>;
 })}</ul>;
}

export default async function BookingSlotsPage(){
 await requireRealAdmin();
 // QA F-07: with clinic emails off and clinic scheduling on, members book the hours each clinic publishes; these slots are not offered.
 if(homeRequestsOnly())return <div className="space-y-6"><header className="space-y-2"><h1 className="flex items-center gap-3 text-h1"><CalendarClock className="size-7 shrink-0 text-primary" aria-hidden/>Visit slots</h1></header>
  <section role="status" className="max-w-2xl space-y-3 rounded-xl border bg-background p-5"><h2 className="text-h3">Replaced by clinic hours</h2><p className="text-body2">Members now book the opening hours each clinic sets in the clinic portal, and the clinic confirms each visit there. Slots added here are not offered to members.</p><Link href="/staff/real/clinics" className="inline-flex min-h-12 items-center rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Go to clinics</Link></section></div>;
 // Clinic emails and clinic scheduling both off: members send a test request instead (legacyBookingMode), so slots are not offered.
 if(!bookingChannelConfigured())return <div className="space-y-6"><header className="space-y-2"><h1 className="flex items-center gap-3 text-h1"><CalendarClock className="size-7 shrink-0 text-primary" aria-hidden/>Visit slots</h1></header>
  <section role="status" className="max-w-2xl space-y-3 rounded-xl border bg-background p-5"><h2 className="text-h3">Not in use</h2><p className="text-body2">Clinic emails and clinic scheduling are both off, so members send a test request and the care team arranges the visit. Slots are not offered to members.</p><Link href="/staff/real/members" className="inline-flex min-h-12 items-center rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Go to requests</Link></section></div>;
 let slots:BookingSlot[]|null=null,clinics:Awaited<ReturnType<typeof getRealClinics>>=[];
 try{[slots,clinics]=await Promise.all([getBookingSlots(),getRealClinics()]);}catch{slots=null;}
 return <div className="space-y-6">
  <header className="space-y-2"><h1 className="flex items-center gap-3 text-h1"><CalendarClock className="size-7 shrink-0 text-primary" aria-hidden/>Visit slots</h1>
   <p className="max-w-2xl text-body2 text-muted-foreground">Members book these times. Each booking, change or cancellation emails the clinic scheduling address with the Noreon copy address. A slot stops being offered at its start time or when you stop it. Stopping keeps visits already booked, but a booking whose clinic email has not been sent yet will need review.</p></header>
  {slots===null?<p role="alert" className="rounded-xl border bg-background p-5 text-body2">Visit slots are unavailable. <a href="/staff/real/booking-slots" className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-md border px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><RotateCcw className="size-4" aria-hidden/>Try again</a></p>
  :<><SlotList slots={slots}/><BookingSlotForm clinics={clinics.filter(clinic=>clinic.active).map(clinic=>({id:clinic.id,name:clinic.name,hasAddress:!!clinic.address.trim()}))} tests={slotTests} requestId={randomUUID()}/></>}
 </div>;
}
