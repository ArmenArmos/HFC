import 'server-only';
import {z} from 'zod';
import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import {clinicMemberRevealInputSchema,clinicMemberRevealSchema,type ClinicMemberRevealResult} from './member-reveal-schema';

/** The database authorizes, limits and audits atomically before returning full values. */
export async function revealClinicMember(rpc:ClinicRpc,clinicId:string,memberId:string,input:unknown):Promise<ClinicMemberRevealResult>{
 const parsed=clinicMemberRevealInputSchema.safeParse(input);
 if(!parsed.success)return{ok:false,code:'reason_required'};
 if(!z.uuid().safeParse(clinicId).success||!z.uuid().safeParse(memberId).success)return{ok:false,code:'refused'};
 try{
  const r=await rpc.rpc('clinic_admin_member_reveal',{p_clinic:clinicId,p_member:memberId,p_reason:parsed.data.reason});
  if(r.error)return{ok:false,code:r.error.code==='42501'?'refused':'unavailable'};
  const result=clinicMemberRevealSchema.safeParse(r.data);
  return result.success?result.data:{ok:false,code:'unavailable'};
 }catch{return{ok:false,code:'unavailable'};}
}
