'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireRealAdmin,staffInvitationConfig} from './real-admin';
import {doctorInvitationAvailable} from './real-invitation-session';
import {realStaffClient} from '@/lib/patient-care/clinical-case-repository';
import {validatedStaffSession} from './real-session-binding';
import {dispatchStaffRecovery,recoveryTokenDigest} from './real-recovery-dispatch';
import {recoveryContext,recoveryContextSchema,recoverySetup,recoveryStep,writeRecoveryProof,clearRecoveryProof,RecoveryAccessChanged} from './real-recovery-session';
export type RecoveryActionState={ok:boolean;message:string;operationCreated?:boolean;outcomeUnknown?:boolean;passwordSaved?:boolean;restartRequired?:boolean};
const fail=(message:string):RecoveryActionState=>({ok:false,message});
export const requestRealStaffRecovery=loggedAction("requestRealStaffRecovery",async function requestRealStaffRecovery(_previous:RecoveryActionState,form:FormData):Promise<RecoveryActionState>{
 const {client}=await requireRealAdmin();if(!staffInvitationConfig())return fail('Password recovery is unavailable until email setup is complete.');
 const input=z.object({staffId:z.uuid(),expectedVersion:z.string().regex(/^[a-f0-9]{32}$/),requestId:z.uuid()}).safeParse(Object.fromEntries(['staffId','expectedVersion','requestId'].map(key=>[key,form.get(key)])));
 if(!input.success)return fail('Reload the staff directory before requesting recovery.');
 try{
  const result=await client.rpc('real_admin_request_staff_recovery',{p_staff_id:input.data.staffId,p_expected_version:input.data.expectedVersion,p_request_id:input.data.requestId});
  if(result.error)return fail(result.error.code==='40001'?'Wait one minute between recovery requests. If staff details changed, reload the directory.':'Recovery requires an active doctor or nurse in an active clinic.');
  const sent=await dispatchStaffRecovery(recoveryContextSchema.parse(result.data));revalidatePath('/staff/real/doctors');return sent;
 }catch{revalidatePath('/staff/real/doctors');return {ok:false,outcomeUnknown:true,message:'Recovery is unconfirmed. Reload the directory before requesting another link.'};}
});
export const verifyRealStaffRecovery=loggedAction("verifyRealStaffRecovery",async function verifyRealStaffRecovery(_previous:RecoveryActionState,form:FormData):Promise<RecoveryActionState>{
 if(!await doctorInvitationAvailable())return fail('Password recovery is unavailable. Contact your administrator.');
 const input=z.object({operationId:z.uuid(),generation:z.coerce.number().int().positive().max(2147483647),token:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),type:z.literal('recovery')}).safeParse(Object.fromEntries(['operationId','generation','token','type'].map(key=>[key,form.get(key)])));
 if(!input.success)return fail('This recovery link is incomplete. Ask your administrator for a new link.');
 try{
  const context=await recoveryContext(input.data.operationId,input.data.generation),digest=recoveryTokenDigest(input.data.token);
  if(context.status!=='pending'||!context.tokenDigest||!timingSafeEqual(Buffer.from(context.tokenDigest,'hex'),Buffer.from(digest,'hex')))return fail('This recovery link is no longer available. Ask your administrator for a new link.');
  const client=await realStaffClient(),verified=await client.auth.verifyOtp({type:'recovery',token_hash:input.data.token});
  if(verified.error)return fail('This recovery link expired or was already used. Ask your administrator for a new link.');
  const directToken=verified.data.session?.access_token;
  if(!directToken){await client.auth.signOut({scope:'local'});return fail('Recovery could not be verified. Ask your administrator for a new link.');}
  const session=await validatedStaffSession(client.auth,directToken);
  if(!session||session.user.id!==context.staffId||session.user.email!.toLowerCase()!==context.identity.email){await client.auth.signOut({scope:'local'});return fail('Recovery could not be verified.');}
  await writeRecoveryProof(context,session.user.id,session.sessionId,'verified');
  try{await recoveryStep(context,'verify',{p_digest:digest,p_session:session.sessionId});}catch{/* Signed proof resumes guarded binding without reusing OTP. */}
 }catch{return fail('Recovery is temporarily unavailable. Try again or contact your administrator.');}
 redirect('/staff/real/reset-password');
});
// After a password reset the staff member is signed out everywhere on purpose,
// so a session opened with the old password does not survive the reset.
async function finishRecovery(setup:NonNullable<Awaited<ReturnType<typeof recoverySetup>>>):Promise<RecoveryActionState>{
 try{await recoveryStep(setup.context,'complete',{p_session:setup.session.sessionId,p_digest:setup.proof.tokenDigest});}
 catch(error){
  if(error instanceof RecoveryAccessChanged){await clearRecoveryProof();await setup.client.auth.signOut({scope:'global'});return {ok:false,passwordSaved:true,restartRequired:true,message:'Your password was saved, but staff access changed. Contact your administrator before signing in.'};}
  return {ok:false,passwordSaved:true,message:'Your password is saved; confirmation is pending. Retry confirmation.'};
 }
 await clearRecoveryProof();await setup.client.auth.signOut({scope:'global'});redirect('/staff/real/login?password-reset=complete');
}
export const resetRealStaffPassword=loggedAction("resetRealStaffPassword",async function resetRealStaffPassword(_previous:RecoveryActionState,form:FormData):Promise<RecoveryActionState>{
 const input=z.object({password:z.string().min(12).max(128),confirmation:z.string().min(12).max(128)}).safeParse({password:form.get('password'),confirmation:form.get('confirmation')});
 if(!input.success||input.data.password!==input.data.confirmation)return fail('Use at least 12 characters and enter the same password twice.');
 let setup:Awaited<ReturnType<typeof recoverySetup>>;
 try{setup=await recoverySetup();}catch{return fail('Recovery is temporarily unavailable. Try again in a moment.');}
 if(!setup)return fail('Your recovery session expired. Ask your administrator for a new link.');
 if(setup.proof.stage==='password_saved')return finishRecovery(setup);
 try{
  await recoveryStep(setup.context,'verify',{p_session:setup.session.sessionId,p_digest:setup.proof.tokenDigest});
  const claim=await recoveryStep(setup.context,'claim-password',{p_session:setup.session.sessionId,p_digest:setup.proof.tokenDigest});
  if(!claim.claimed)return {ok:false,restartRequired:true,message:'A password change is already in progress or unconfirmed. Ask your administrator for a new recovery link.'};
 }catch{return fail('Recovery changed or is unavailable. Ask your administrator for a new link.');}
 try{
  const saved=await setup.client.auth.updateUser({password:input.data.password});
  if(saved.error){
   const known=!!saved.error.status&&saved.error.status<500;
   await recoveryStep(setup.context,known?'password-failed':'password-unknown',{p_session:setup.session.sessionId});
   return known?fail('Your password could not be saved. Choose another password and try again.'):{ok:false,restartRequired:true,outcomeUnknown:true,message:'The password change is unconfirmed. Ask your administrator for a new recovery link.'};
  }
  if(saved.data.user?.id!==setup.session.user.id)throw Error('Password identity changed');
 }catch{
  try{await recoveryStep(setup.context,'password-unknown',{p_session:setup.session.sessionId});}catch{}
  return {ok:false,restartRequired:true,outcomeUnknown:true,message:'The password change is unconfirmed. Ask your administrator for a new recovery link.'};
 }
 // Auth and the ledger commit separately. A signed success stage prevents a second password update.
 await writeRecoveryProof(setup.context,setup.session.user.id,setup.session.sessionId,'password_saved');
 return finishRecovery({...setup,proof:{...setup.proof,stage:'password_saved'}});
});
export const confirmRealStaffPasswordReset=loggedAction("confirmRealStaffPasswordReset",async function confirmRealStaffPasswordReset(_previous:RecoveryActionState,_form:FormData):Promise<RecoveryActionState>{
 void _previous;void _form;
 let setup:Awaited<ReturnType<typeof recoverySetup>>;
 try{setup=await recoverySetup();}
 catch{return {ok:false,passwordSaved:true,message:'Your password is saved; confirmation is pending. Try again in a moment.'};}
 if(!setup||setup.proof.stage!=='password_saved')return fail('Password confirmation is unavailable. Ask your administrator for a new link.');
 return finishRecovery(setup);
});
