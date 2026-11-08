"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealAdmin} from './real-admin';
import {saveSchedulingSetting} from './clinic-scheduling-command';
import type {SchedulingActionState} from './clinic-scheduling-schema';

export const updateClinicSchedulingEmail=loggedAction("updateClinicSchedulingEmail",async function updateClinicSchedulingEmail(_previous:SchedulingActionState,form:FormData):Promise<SchedulingActionState>{
 const {client}=await requireRealAdmin();
 return saveSchedulingSetting('clinic',form,{
  write:async input=>await client.rpc('real_admin_update_clinic_scheduling_email',{
   p_clinic_id:input.clinicId!,p_expected_revision:input.expectedRevision,p_request_id:input.requestId,
   ...(input.email===null?{}:{p_email:input.email}),
  }),
  invalidate:()=>revalidatePath('/staff/real/clinics'),
 });
});
export const updateSchedulingCopyEmail=loggedAction("updateSchedulingCopyEmail",async function updateSchedulingCopyEmail(_previous:SchedulingActionState,form:FormData):Promise<SchedulingActionState>{
 const {client}=await requireRealAdmin();
 return saveSchedulingSetting('copy',form,{
  write:async input=>await client.rpc('real_admin_update_scheduling_copy_email',{
   p_expected_revision:input.expectedRevision,p_request_id:input.requestId,...(input.email===null?{}:{p_email:input.email}),
  }),
  invalidate:()=>revalidatePath('/staff/real/clinics'),
 });
});
