'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {readAppointmentSummary,type BookingRpc} from '@/lib/real-booking/appointment-runtime';
import {summarizeMemberBooking,type MemberBookingSummary} from './member-booking-summary';

/** Admin-only, read-only. Each member is read through the same booking RPCs and
 * actor check as the member page; a member that cannot be read is left out. */
export const readMemberBookingSummaries=loggedAction("readMemberBookingSummaries",async function readMemberBookingSummaries(raw:unknown):Promise<Record<string,MemberBookingSummary|null>>{
 const ids=z.array(z.uuid()).max(50).safeParse(raw);
 if(!ids.success)return {};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin')return {};
 const entries=await Promise.all([...new Set(ids.data)].map(async memberId=>{
  try{return [memberId,summarizeMemberBooking(await readAppointmentSummary({memberId,read:client as unknown as BookingRpc}))] as const;}
  catch{return null;}
 }));
 return Object.fromEntries(entries.filter(entry=>entry!==null));
});
