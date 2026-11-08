import 'server-only';
import {createHash} from 'node:crypto';
import {staffInvitationConfig} from './real-admin';
import {invitationWriteClient} from './real-invitations';
import {recoveryStep,type RecoveryContext} from './real-recovery-session';
import {sendStaffPasswordRecovery} from '@/lib/messaging/brevo-email';
export const recoveryTokenDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function dispatchStaffRecovery(operation:RecoveryContext){
 const config=staffInvitationConfig();if(!config)return {ok:false,message:'Password recovery is unavailable until email setup is complete.'};
 const claimed=await recoveryStep(operation,'claim-dispatch');if(!claimed.claimed)return {ok:false,operationCreated:true,message:'Recovery was already requested. Check its current delivery status before sending another link.'};
 try{
  const generated=await invitationWriteClient().auth.admin.generateLink({type:'recovery',email:claimed.identity.email});
  if(generated.error||generated.data.user?.id!==claimed.staffId||!generated.data.properties?.hashed_token)throw Error('Recovery token unavailable');
  const token=generated.data.properties.hashed_token;
  await recoveryStep(claimed,'token',{p_digest:recoveryTokenDigest(token)});
  const url=new URL('/staff/real/recover',config.email.origin);url.hash=new URLSearchParams({token,operation:claimed.id,generation:String(claimed.generation),type:'recovery'}).toString();
  const sent=await sendStaffPasswordRecovery(config.email,{...claimed.identity,url:url.href});
  await recoveryStep(claimed,sent.status,{...(sent.status==='accepted'?{p_reference:sent.reference}:{})});
  return {ok:sent.status==='accepted',operationCreated:true,message:sent.status==='accepted'?'Recovery email queued. Ask your team member to open it and choose a new password.':sent.status==='failed'?'Recovery email was rejected. Check the address and request a new link after the cooldown.':'Delivery is unconfirmed. Check with your team member before requesting a new link.'};
 }catch{
  try{await recoveryStep(claimed,'unknown');}catch{}
  return {ok:false,operationCreated:true,outcomeUnknown:true,message:'Recovery delivery is unconfirmed. Check the directory before requesting a new link.'};
 }
}
