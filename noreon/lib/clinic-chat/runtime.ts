import 'server-only';
import type {ClinicIdentity} from '@/lib/clinic-portal/schema';
import {readClinicBatches,readClinicBatch,type ClinicRpc} from '@/lib/clinic-portal/runtime';
import {readClinicBookings} from '@/lib/clinic-scheduling/runtime';
import {searchClinicMembers,readClinicMemberFile} from '@/lib/clinic-scheduling/member-file';
import {readClinicPatients,readClinicPatientRecord} from '@/lib/clinic-admin/record';
import {readClinicMemberMasked} from '@/lib/clinic-portal/member-masked';
import type {ClinicMemberMasked} from '@/lib/clinic-portal/member-masked-schema';
import type {ClinicBooking} from '@/lib/clinic-scheduling/schema';
import type {ChatQuery} from './schema';
const privateBooking=(booking:ClinicBooking)=>({...booking,memberPhone:null});
function privateBookings(result:Awaited<ReturnType<typeof readClinicBookings>>){
 return result.status==='loaded'&&result.data.enabled?{...result,data:{...result.data,bookings:result.data.bookings.map(privateBooking)}}:result;
}
const bookingIds=(result:Awaited<ReturnType<typeof readClinicBookings>>)=>result.status==='loaded'?result.data.bookings.flatMap(booking=>booking.memberId?[booking.memberId]:[]):[];
/** Existing scoped/audited reads. The assistant receives only partial contact values,
 * including booking rows, which carry no full phone number. */
export async function readClinicChat(rpc:ClinicRpc,identity:ClinicIdentity,query:ChatQuery){
 const clinic=identity.clinicId;
 const maskedFor=async(ids:string[])=>{const masked=await readClinicMemberMasked(rpc,clinic,ids);return masked.status==='loaded'?masked.members:[];};
 switch(query.kind){
  case 'home':{
   const [bookings,today,batches]=await Promise.all([
    readClinicBookings(rpc,clinic,{scope:'upcoming',day:null,status:null}),
    readClinicBookings(rpc,clinic,{scope:'upcoming',day:yerevanToday(),status:null}),
    readClinicBatches(rpc,identity),
   ]);
   return {kind:'home' as const,bookings:privateBookings(bookings),today:privateBookings(today),batches,asOf:new Date().toISOString(),maskedMembers:await maskedFor([...bookingIds(bookings),...bookingIds(today)])};
  }
  case 'bookings':{
   const result=await readClinicBookings(rpc,clinic,{scope:query.scope,day:query.day,status:null});
   return{kind:'bookings' as const,result:privateBookings(result),maskedMembers:await maskedFor(bookingIds(result))};
  }
  case 'batches':return {kind:'batches' as const,result:await readClinicBatches(rpc,identity,query.cursor),maskedMembers:[]};
  case 'batch':return {kind:'batch' as const,result:await readClinicBatch(rpc,identity,query.batchId,query.cursor),maskedMembers:[]};
  case 'records':{
   if(identity.capability!=='clinic_admin'||!identity.fullAccess)return{kind:'access' as const,maskedMembers:[]};
   const result=await readClinicPatients(rpc,clinic);
   return{kind:'records' as const,result:result.status==='loaded'?{...result,patients:result.patients.map(member=>({...member,phone:null,birthDate:null}))}:result,maskedMembers:result.status==='loaded'?result.maskedMembers:[]};
  }
  case 'members':{
   const result=await searchClinicMembers(rpc,clinic,query.query,query.page);
   return{kind:'members' as const,result:result.status==='loaded'?{...result,data:{...result.data,members:result.data.members.map(member=>({...member,phone:null,birthDate:null}))}}:result,maskedMembers:result.status==='loaded'?result.data.maskedMembers:[]};
  }
  case 'member':{
   if(identity.capability!=='clinic_admin'||!identity.fullAccess){
    const result=await readClinicMemberFile(rpc,clinic,query.memberId);
    return{kind:'member' as const,result:result.status==='loaded'?{...result,data:{...result.data,member:{...result.data.member,phone:null,birthDate:null},bookings:result.data.bookings.map(privateBooking)}}:result,maskedMembers:result.status==='loaded'?await maskedFor([query.memberId]):[]};
   }
   const result=await readClinicPatientRecord(rpc,clinic,query.memberId);
   if(result.status!=='loaded')return {kind:'member' as const,result,maskedMembers:[]};
   const {member,bookings,files}=result.data;
   return {kind:'member' as const,result:{status:'loaded' as const,data:{member:{memberId:member.memberId,name:member.name,phone:null,birthDate:null},bookings:bookings.map(privateBooking),files}},maskedMembers:await maskedFor([member.memberId])};
  }
 }
}
function yerevanToday(){return new Date(Date.now()+4*3600000).toISOString().slice(0,10);}
export type ClinicChatReply=(Awaited<ReturnType<typeof readClinicChat>>|{kind:'access'|'invalid'|'unavailable'})&{maskedMembers?:ClinicMemberMasked[]};
