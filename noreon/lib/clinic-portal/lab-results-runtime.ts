import 'server-only';
import{z}from'zod';
import type{ClinicRpc}from'./runtime';
import{readClinicMemberMasked}from'./member-masked';
import{clinicLabLinkCommandSchema,clinicLabLinkResultSchema,clinicLabMembersSchema,clinicLabResultsSchema,type ClinicLabLinkResult,type ClinicLabResults}from'./lab-results-schema';
export async function readClinicLabResults(rpc:ClinicRpc,clinicId:string,batchId:string):Promise<{status:'loaded';data:ClinicLabResults}|{status:'unavailable'}>{
 if(!z.uuid().safeParse(clinicId).success||!z.uuid().safeParse(batchId).success)return{status:'unavailable'};
 try{const r=await rpc.rpc('clinic_portal_lab_results',{p_clinic:clinicId,p_batch:batchId});if(r.error)return{status:'unavailable'};
  const p=clinicLabResultsSchema.safeParse(r.data);if(!p.success)return{status:'unavailable'};
  // WP-11 item 46: the longer member list replaces the 300-member one when it is available.
  const members=await readClinicLabMembers(rpc,clinicId);
  const data:ClinicLabResults=members?{...p.data,members:members.members,membersCapped:members.capped}:p.data;
  const ids=[...data.members.map(member=>member.memberId),...data.files.flatMap(file=>file.suggestion?[file.suggestion.memberId]:[])];
  const masked=await readClinicMemberMasked(rpc,clinicId,ids);
  return{status:'loaded',data:{...data,maskedMembers:masked.status==='loaded'?masked.members:[]}};}catch{return{status:'unavailable'};}
}
async function readClinicLabMembers(rpc:ClinicRpc,clinicId:string){
 try{const r=await rpc.rpc('clinic_portal_lab_members',{p_clinic:clinicId});if(r.error)return null;
  const p=clinicLabMembersSchema.safeParse(r.data);return p.success&&p.data.enabled?p.data:null;}catch{return null;}
}
/** Resending the same submission replays its saved outcome. */
export async function runClinicLabLink(rpc:ClinicRpc,clinicId:string,input:unknown):Promise<ClinicLabLinkResult>{
 const command=clinicLabLinkCommandSchema.safeParse(input);if(!command.success)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_portal_lab_link',{p_clinic:clinicId,p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=clinicLabLinkResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
