import 'server-only';
import{z}from'zod';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{clinicBookingSchema}from'./schema';
import{readClinicMemberMasked}from'@/lib/clinic-portal/member-masked';
/** Clinic member search and file. Who may be found and what the file holds is decided in SQL
 * (clinic_member_search / clinic_member_file); this module only parses and forwards. */
const id=z.uuid(),stamp=z.iso.datetime({offset:true}),date=z.null();
const memberSchema=z.strictObject({memberId:id,name:z.string().max(200),phone:z.null(),birthDate:date});
export type ClinicMember=z.infer<typeof memberSchema>;
const searchSchema=z.union([
 z.strictObject({version:z.literal('clinic-member-search-v2'),enabled:z.literal(false),members:z.array(z.never()).max(0)}),
 z.strictObject({version:z.literal('clinic-member-search-v2'),enabled:z.literal(true),members:z.array(memberSchema).max(25),
  total:z.number().int().nonnegative(),page:z.number().int().min(1),pageSize:z.literal(25)}),
]);
export const memberFileSchema=z.union([
 z.strictObject({version:z.literal('clinic-member-file-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('clinic-member-file-v1'),enabled:z.literal(true),status:z.literal('refused')}),
 z.strictObject({version:z.literal('clinic-member-file-v1'),enabled:z.literal(true),status:z.literal('ok'),member:memberSchema,bookings:z.array(clinicBookingSchema).max(500),
  checkins:z.array(z.strictObject({outcome:z.enum(['arrived','no-show','completed']),recordedAt:stamp,visitStartsAt:stamp,appointmentId:id})).max(500),
  visits:z.array(z.strictObject({visitId:id,visitedAt:stamp,samples:z.number().int().nonnegative(),atLab:z.number().int().nonnegative(),resultsReceived:z.number().int().nonnegative()})).max(500),
  files:z.array(z.strictObject({fileId:id,name:z.string(),uploadedAt:stamp,batchName:z.string(),linkedAt:stamp,visitedAt:stamp.nullable()})).max(500)}),
]);
export type ClinicMemberFile=Extract<z.infer<typeof memberFileSchema>,{status:'ok'}>;
/** An empty query lists every member the clinic can find (Khikar, 18 Oct 2026). */
export const searchQuerySchema=z.string().trim().max(100);
export const searchPageSchema=z.number().int().min(1).max(10000);
export async function searchClinicMembers(rpc:ClinicRpc,clinicId:string,query:string,page=1){
 if(!searchQuerySchema.safeParse(query).success||!searchPageSchema.safeParse(page).success)return{status:'invalid' as const};
 try{const r=await rpc.rpc('clinic_member_search',{p_clinic:clinicId,p_query:query.trim(),p_page:page});if(r.error)return{status:'unavailable' as const};
  const p=searchSchema.safeParse(r.data);if(!p.success)return{status:'unavailable' as const};
  const masked=await readClinicMemberMasked(rpc,clinicId,p.data.members.map(member=>member.memberId));
  return{status:'loaded' as const,data:{...p.data,maskedMembers:masked.status==='loaded'?masked.members:[]}};}catch{return{status:'unavailable' as const};}
}
/** 'missing' covers an unknown member and another clinic's member alike (the database refuses both the same way). */
export async function readClinicMemberFile(rpc:ClinicRpc,clinicId:string,memberId:string){
 if(!id.safeParse(memberId).success)return{status:'missing' as const};
 try{const r=await rpc.rpc('clinic_member_file',{p_clinic:clinicId,p_member:memberId});
  if(r.error)return{status:r.error.code==='42501'?'missing' as const:'unavailable' as const};
  const p=memberFileSchema.safeParse(r.data);
  if(!p.success)return{status:'unavailable' as const};
  if(!p.data.enabled)return{status:'disabled' as const};
  if(p.data.status==='refused')return{status:'missing' as const};
  return p.data.member.memberId===memberId?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};
 }catch{return{status:'unavailable' as const};}
}
/** Keep the existing guarded RPC for its refusal audit. Never redeem an access ticket,
 * including a ticket returned by an older database during a schema-first deployment. */
export async function openClinicMemberPdf(rpc:ClinicRpc,clinicId:string,memberId:string,fileId:string):Promise<null>{
 if(!id.safeParse(memberId).success||!id.safeParse(fileId).success)return null;
 try{await rpc.rpc('clinic_member_file_download',{p_clinic:clinicId,p_member:memberId,p_file:fileId});}catch{/* fail closed */}
 return null;
}
