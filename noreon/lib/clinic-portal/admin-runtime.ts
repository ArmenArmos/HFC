import 'server-only';
import{z}from'zod';import type{ClinicRpc}from'./runtime';import{clinicAdminPageSchema,clinicAdminLookupSchema,clinicAdminCommandSchema,clinicAdminResultSchema,clinicAdminRefreshSchema}from'./admin-schema';
/** Authenticated Noreon-admin RPC only. No generic service writer or clinic
 * original access is created by this management adapter. */
export async function readClinicAdminPage(rpc:ClinicRpc,clinicId:string,cursor:string|null=null){
 if(!z.uuid().safeParse(clinicId).success||!z.string().min(1).max(1024).nullable().safeParse(cursor).success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_admin_memberships_page',{p_clinic_id:clinicId,p_cursor:cursor,p_limit:50});if(r.error)return{status:'unavailable' as const};const p=clinicAdminPageSchema.safeParse(r.data);return p.success&&p.data.clinic.id===clinicId?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};}catch{return{status:'unavailable' as const};}
}
export async function lookupClinicAccount(rpc:ClinicRpc,input:string){
 const email=z.email().max(320).safeParse(input.trim().toLowerCase());if(!email.success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_admin_account_lookup',{p_email:email.data});if(r.error)return{status:'unavailable' as const};const p=clinicAdminLookupSchema.safeParse(r.data);if(!p.success||(p.data.status==='eligible'&&p.data.account.email!==email.data))return{status:'unavailable' as const};return p.data;}catch{return{status:'unavailable' as const};}
}
export async function runClinicAdminCommand(rpc:ClinicRpc,input:unknown){
 const command=clinicAdminCommandSchema.safeParse(input);if(!command.success)return{status:'invalid' as const};
 try{const r=await rpc.rpc('clinic_admin_membership_command',{p_command:command.data});if(r.error)return{status:'unknown' as const};const p=clinicAdminResultSchema.safeParse(r.data);if(!p.success||('submissionId'in p.data&&p.data.submissionId!==command.data.submissionId)||(p.data.status==='committed'&&p.data.membershipId!==command.data.membershipId))return{status:'unknown' as const};return p.data;}catch{return{status:'unknown' as const};}
}
export async function refreshClinicAdminCommand(rpc:ClinicRpc,input:unknown){
 const command=clinicAdminCommandSchema.safeParse(input);if(!command.success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_admin_membership_refresh',{p_command:command.data});if(r.error)return{status:'unavailable' as const};const p=clinicAdminRefreshSchema.safeParse(r.data);if(!p.success||p.data.receipt.submissionId!==command.data.submissionId||(p.data.receipt.status==='committed'&&p.data.receipt.membershipId!==command.data.membershipId)||(p.data.membership!==null&&p.data.membership.id!==command.data.membershipId))return{status:'unavailable' as const};return p.data;}catch{return{status:'unavailable' as const};}
}
