import 'server-only';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {doctorInvitationAvailable} from './real-invitation-session';
import {staffInvitationConfig} from './real-admin';
import {invitationWriteClient} from './real-invitations';
import {validatedStaffSession} from './real-session-binding';
import {issueRecoveryProof,verifyRecoveryProof,type RecoveryProof} from './recovery-proof';
export const recoveryContextSchema=z.object({id:z.uuid(),requestId:z.uuid(),adminId:z.uuid(),staffId:z.uuid(),generation:z.number().int().positive().safe(),identity:z.object({id:z.uuid(),email:z.email(),name:z.string(),role:z.enum(['doctor','nurse']),clinicId:z.uuid()}),tokenDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),expiresAt:z.string(),status:z.enum(['pending','verified','changing','completed','cancelled']),dispatchState:z.enum(['pending','accepted','failed','unknown']),verifiedSessionId:z.uuid().nullable(),claimed:z.boolean().optional()});
export type RecoveryContext=z.infer<typeof recoveryContextSchema>;
// This narrow interface remains typed while the combined migration type generation runs.
type RecoveryRpc={rpc(name:'real_staff_recovery_context'|'real_staff_recovery_step',args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>};
export class RecoveryAccessChanged extends Error {}
function recoveryError(error:{code?:string}){return ['42501','40001','22023'].includes(error.code??'')?new RecoveryAccessChanged('Recovery changed or is unavailable'):new Error('Recovery temporarily unavailable');}
export const recoveryWriteClient=()=>invitationWriteClient() as unknown as RecoveryRpc;
export async function recoveryStep(context:Pick<RecoveryContext,'id'|'generation'>,step:string,fields:Record<string,unknown>={}){
 const result=await recoveryWriteClient().rpc('real_staff_recovery_step',{p_id:context.id,p_generation:context.generation,p_step:step,...fields});
 if(result.error)throw recoveryError(result.error);return recoveryContextSchema.parse(result.data);
}
export async function recoveryContext(id:string,generation:number,sessionId?:string){
 const result=await recoveryWriteClient().rpc('real_staff_recovery_context',{p_id:id,p_generation:generation,...(sessionId?{p_session:sessionId}:{})});
 if(result.error)throw recoveryError(result.error);return recoveryContextSchema.parse(result.data);
}
export const recoveryCookie=()=>process.env.NODE_ENV==='production'?'__Host-noreon-staff-recovery':'noreon-staff-recovery';
export async function clearRecoveryProof(){(await cookies()).delete(recoveryCookie());}
export async function writeRecoveryProof(context:RecoveryContext,userId:string,sessionId:string,stage:RecoveryProof['stage']){
 const config=staffInvitationConfig();if(!config||userId!==context.staffId||!context.tokenDigest)throw Error('Recovery unavailable');
 const value=issueRecoveryProof({operationId:context.id,generation:context.generation,userId,sessionId,tokenDigest:context.tokenDigest,stage,operationExpiresAt:Date.parse(context.expiresAt)},config.secret);
 (await cookies()).set(recoveryCookie(),value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:Math.max(1,Math.floor((Math.min(Date.now()+600000,Date.parse(context.expiresAt))-Date.now())/1000))});
}
export async function recoverySetup(){
 if(!await doctorInvitationAvailable())return null;const config=staffInvitationConfig()!;const proof=verifyRecoveryProof((await cookies()).get(recoveryCookie())?.value??'',config.secret);if(!proof)return null;
 const client=await realStaffClient(),session=await validatedStaffSession(client.auth);if(!session||session.user.id!==proof.userId||session.sessionId!==proof.sessionId)return null;
 const context=await recoveryContext(proof.operationId,proof.generation,session.sessionId);
 if((context.status==='completed'&&proof.stage!=='password_saved')||context.staffId!==proof.userId||context.tokenDigest!==proof.tokenDigest||context.identity.email!==session.user.email!.toLowerCase()||(context.verifiedSessionId&&context.verifiedSessionId!==session.sessionId))return null;
 return {client,session,context,proof};
}
export async function readRecoverySetup(){try{const setup=await recoverySetup();return setup?{name:setup.context.identity.name,stage:setup.proof.stage}:null;}catch{return {name:'',stage:'unavailable' as const};}}
