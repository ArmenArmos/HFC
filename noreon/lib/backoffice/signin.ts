import 'server-only';
import {clinicChatEnabled} from '@/lib/clinic-chat/config';
import {doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {headers} from 'next/headers';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {staffHostAllowed} from '@/lib/staff/hosts';
import {clinicHostAllowed,clinicPortalEnabled} from '@/lib/clinic-portal/config';
import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {clinicAccess} from '@/lib/clinic-portal/identity';

/**
 * One sign-in page for staff and clinic users (Khikar, 17 Oct): the role is detected after
 * the password. Each portal keeps its own session cookie and every existing check.
 */
export async function backofficePortals(){
 const host=(await headers()).get('host')??'';
 return {staff:realReviewEnabled(process.env)&&staffHostAllowed(host),clinic:clinicPortalEnabled()&&clinicHostAllowed(host)};
}
export const clinicHomePath=(clinicId:string,hy:boolean)=>`/clinic/real/${clinicChatEnabled()?'chat':clinicSchedulingEnabled()?'bookings':'batches'}?clinic=${clinicId}&locale=${hy?'hy':'en'}`;

/** Where an already signed-in visitor of the sign-in page belongs, or null to show the form. */
export async function signedInDestination(hy:boolean):Promise<string|null>{
 const portals=await backofficePortals();
 try{
  if(portals.staff){
   const client=await realStaffClient();
   if(await validatedStaffSession(client.auth)){const r=await client.rpc('real_clinical_staff_identity');if(!r.error&&r.data)return doctorHomePath(typeof r.data==='object'&&'role'in r.data?String(r.data.role):'');}
  }
  if(portals.clinic){
   const {access}=await clinicAccess();
   if(access.status==='ready')return clinicHomePath(access.identity.clinicId,hy);
   if(access.status==='selection-required')return '/clinic/real/select';
  }
 }catch{/* Show the form; the destination page re-checks everything. */}
 return null;
}
