import 'server-only';
import {z} from 'zod';
import type {ClinicRpc} from './runtime';
import {clinicMemberMaskedSchema,type ClinicMemberMasked} from './member-masked-schema';

/** One lookup for the displayed page, never a call from each row. Legacy lab/booking
 * lists can exceed 200 members, so those use bounded batches without losing rows. */
export async function readClinicMemberMasked(rpc:ClinicRpc,clinicId:string,memberIds:string[]):Promise<{status:'loaded';members:ClinicMemberMasked[]}|{status:'unavailable'}>{
 const ids=[...new Set(memberIds)];
 if(!z.uuid().safeParse(clinicId).success||ids.some(id=>!z.uuid().safeParse(id).success))return{status:'unavailable'};
 if(!ids.length)return{status:'loaded',members:[]};
 try{
  const members:ClinicMemberMasked[]=[];
  for(let offset=0;offset<ids.length;offset+=200){
   const batch=ids.slice(offset,offset+200);
   const r=await rpc.rpc('clinic_member_masked',{p_clinic:clinicId,p_members:batch});
   if(r.error)return{status:'unavailable'};
   const parsed=clinicMemberMaskedSchema.safeParse(r.data);
   if(!parsed.success||!parsed.data.ok)return{status:'unavailable'};
   const rows=parsed.data.members;
   if(rows.some(member=>!batch.includes(member.memberId))||new Set(rows.map(member=>member.memberId)).size!==rows.length)return{status:'unavailable'};
   members.push(...rows);
  }
  return{status:'loaded',members};
 }catch{return{status:'unavailable'};}
}
