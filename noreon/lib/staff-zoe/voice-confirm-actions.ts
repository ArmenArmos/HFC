'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {staffVoiceSessionActor} from './voice-http';
import {staffVoiceAvailable,staffVoiceRoleOf} from './voice';
import {verifyStaffVoiceReceipt} from './voice-receipt';
import {confirmStaffVoice,signStaffVoiceNonce,staffVoiceTargetSchema,type StaffVoiceConfirmResult} from './voice-confirm';

/**
 * Staff spoken confirmation (WP V). The nonce is issued for a card the clinician sees; the spoken yes runs the button's
 * own command (changeCareAlert acknowledge), which re-checks the role, the assignment and the alert's sequence in SQL.
 * Only roles that hold alert.acknowledge (nurse, physicians, Noreon administrator) may confirm an alert.
 */
const ALERT_ROLES=new Set(['nurse','doctor','admin']);

async function admitted(){
 const who=await staffVoiceSessionActor();
 if(!who||!ALERT_ROLES.has(who.role))return null;
 const role=staffVoiceRoleOf(who.role,who.specialty);
 return role&&await staffVoiceAvailable(role)?who:null;
}

export const issueStaffVoiceConfirmation=loggedAction('issueStaffVoiceConfirmation',async function issueStaffVoiceConfirmation(raw:unknown):Promise<{status:'ok';nonce:string}|{status:'invalid'|'access'}>{
 const parsed=z.strictObject({target:staffVoiceTargetSchema}).safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await admitted();
 if(!who)return {status:'access'};
 try{return {status:'ok',nonce:signStaffVoiceNonce(who.id,parsed.data.target)};}catch{return {status:'invalid'};}
});

export const confirmStaffCardByVoice=loggedAction('confirmStaffCardByVoice',async function confirmStaffCardByVoice(raw:unknown):Promise<StaffVoiceConfirmResult>{
 const who=await admitted();
 if(!who)return {status:'access'};
 return confirmStaffVoice(who.id,{
  verifyReceipt:(receipt,staffId,text)=>verifyStaffVoiceReceipt(receipt,staffId,text),
  perform:async target=>{
   const {changeCareAlert}=await import('@/lib/care-alerts/actions');
   const r=await changeCareAlert({kind:'acknowledge',alertId:target.alertId,seq:target.seq});
   return r.ok?{ok:true,alert:r.alert}:{ok:false,code:r.code};
  },
 },raw);
});
