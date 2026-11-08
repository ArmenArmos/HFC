'use client';
import{useState}from'react';
import{useRouter}from'next/navigation';
import type{PilotResult}from'@/lib/pilot-commerce/schema';

const text:Record<string,string>={
 saved:'Saved.',invalid:'Check the details. A price cannot start in the past, and every change needs a reason.',stale:'This changed since you opened the page. Reload to see the current state.',
 access:'Only an administrator can make this change.',unavailable:'Couldn’t save right now. Try again.',conflict:'That test key or partner code is already in the catalogue.',
 exists:'This booking already has a payment record.',unchanged:'Already in that state. Nothing was recorded twice.',
 unpriced:'Some booked tests have no active price. Set their prices in the catalogue first.','not-found':'That booking no longer exists.',
 'booking-cancelled':'This booking is cancelled, so no payment record was created.',converted:'This request moved to the unified booking. Use its appointment.',
 'nothing-to-pay':'This booking has no billable tests.',disabled:'This feature is switched off.',
};
export function pilotResultText(result:PilotResult){return text[result.status]??'Save outcome unknown. Check again: the change is never recorded twice.';}

/** One command form. An unknown outcome keeps the exact command so "Check again"
 * resends the same submission, which the database replays. */
export function usePilotCommand(port:(input:Record<string,unknown>)=>Promise<PilotResult>){
 const router=useRouter();
 const [pending,setPending]=useState(false),[result,setResult]=useState<PilotResult|null>(null),[frozen,setFrozen]=useState<Record<string,unknown>|null>(null);
 async function send(input:Record<string,unknown>){
  if(pending)return null;
  const command={...input,submissionId:(input.submissionId as string|undefined)??crypto.randomUUID()};
  setPending(true);setResult(null);setFrozen(command);
  const outcome=await port(command).catch(():PilotResult=>({status:'outcome-unknown'}));
  setPending(false);setResult(outcome);
  if(outcome.status!=='outcome-unknown')setFrozen(null);
  if(outcome.status==='saved')router.refresh();
  return outcome;
 }
 return{pending,result,frozen,send,message:result?pilotResultText(result):'',failed:!!result&&!['saved','unchanged'].includes(result.status)};
}
