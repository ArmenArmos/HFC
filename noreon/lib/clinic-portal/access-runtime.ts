import 'server-only';
import{z}from'zod';
import{staffSessionMethodAllowed}from'@/lib/staff/staff-session-method';
import{clinicIdentityResultSchema}from'./schema';
import type{ClinicRpc}from'./runtime';
export type ClinicVerifiedSession={userId:string;sessionId:string;amr:unknown};
/** Only a session returned by validatedStaffSession may reach this boundary.
 * Membership is fetched afresh, never inferred from a workspace_staff role. */
export async function readClinicAccess(rpc:ClinicRpc,session:ClinicVerifiedSession|null,clinicId:string|null){
 if(!session||!staffSessionMethodAllowed(session.amr))return{status:'denied' as const};
 if(clinicId!==null&&!z.uuid().safeParse(clinicId).success)return{status:'denied' as const};
 try{const r=await rpc.rpc('clinic_portal_identity',{p_clinic_id:clinicId});if(r.error){if(r.error.code==='42501')return{status:'denied' as const};return{status:'unavailable' as const};}const p=clinicIdentityResultSchema.safeParse(r.data);if(!p.success)return{status:'unavailable' as const};if(p.data.status==='ready'&&(p.data.identity.userId!==session.userId||(clinicId!==null&&p.data.identity.clinicId!==clinicId)))return{status:'unavailable' as const};return p.data;}catch{return{status:'unavailable' as const};}
}
