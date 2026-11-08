import 'server-only';
import {z} from 'zod';
import {validatedStaffSession} from './real-session-binding';
import {staffSessionMethodAllowed} from './staff-session-method';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
export const realStaffSchema=z.object({id:z.uuid(),name:z.string(),role:z.enum(['admin','doctor','nurse']),clinicId:z.uuid().nullable()});
export const staffAdmissionSchema=z.object({required:z.boolean(),admitted:z.boolean(),enrolled:z.boolean().optional(),eligible:z.boolean().optional(),staffEligible:z.boolean().optional()});
export type StaffAccessClient={auth:Parameters<typeof validatedStaffSession>[0];rpc:(name:'real_staff_onboarding_session'|'real_clinical_staff_identity'|'staff_signin_state'|'staff_zoe_status')=>PromiseLike<{data:unknown;error:unknown}>};
/** Browser onboarding is an explicit exception; a broker session can never take it. */
export async function staffAccessSession(client:StaffAccessClient,accessToken?:string,allowOnboarding=false){
 const session=await validatedStaffSession(client.auth,accessToken);
 if(!session)return null;
 if(!staffSessionMethodAllowed(session.claims.amr)){
  if(!allowOnboarding)return null;
  const exception=await client.rpc('real_staff_onboarding_session');
  if(exception.error)throw Error('Staff access is temporarily unavailable. Try again.');
  if(exception.data!==true)return null;
 }
 return session;
}
export async function staffAccessIdentity(client:Pick<StaffAccessClient,'rpc'>){
 const result=await client.rpc('real_clinical_staff_identity');
 if(result.error)throw Error('Staff access is temporarily unavailable. Try again.');
 return {result,parsed:realStaffSchema.safeParse(result.data)};
}
/** Shared with the app chat; no new checks are added to its existing route. */
export function chatDoctorIdentity(identity:z.infer<typeof realStaffSchema>,expectedDoctorId:unknown){
 return identity.role==='doctor'&&identity.id===expectedDoctorId;
}
export function chatDoctorEnabled(env:Record<string,string|undefined>=process.env){return doctorChatV2Enabled(env);}
