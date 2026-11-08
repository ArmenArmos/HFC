import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {log} from '@/lib/observability/logger';
import {requirePatient} from '@/lib/patient/auth';
import {readRealMemberStatus} from '@/lib/patient-care/clinical-case-repository';
import {readZoeThreadState} from '@/lib/zoe/app-chat';
import type {ZoeThread} from '@/lib/zoe/app-chat-contracts';

/** Why a signed-in member sees no chat. Each has one line and one action on the Zoe screen. */
export type ZoeChatBlock='chat_off'|'staff_account'|'not_eligible'|'read_failed';
export type ZoeAccess={kind:'chat';thread:ZoeThread}|{kind:'blocked';reason:ZoeChatBlock};

/** No conversation yet: the thread the database returns for a member who has not written. */
export const EMPTY_THREAD:ZoeThread={ok:true,version:0,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[]};

/**
 * Lead, 18 Oct 23:15 ("where is Zoe"): the chat for every signed-in member who can write to the care
 * team. conversation_member_thread refuses with
 *  - unavailable: the app chat switch (conversation_policy.app_chat_enabled) is off;
 *  - not_eligible: a staff account, an unconfirmed or banned phone, or no clinical case yet.
 * A missing conversation is not a refusal (conversation_receive creates it on the first message). A
 * member with no clinical case gets the chat anyway: the first message enrols them (chat-actions).
 * Every refusal is logged with ids only.
 */
export async function readZoeAccess():Promise<ZoeAccess>{
 const memberId=(await requirePatient()).userId;
 const state=await readZoeThreadState().catch(()=>'failed' as const);
 if(typeof state!=='string')return {kind:'chat',thread:state};
 const blocked=(reason:ZoeChatBlock):ZoeAccess=>{
  log.info('zoe_chat_unavailable',{action:`zoe_chat_${reason}`,member_id:memberId});
  return {kind:'blocked',reason};
 };
 if(state==='unavailable')return blocked('chat_off');
 if(state==='failed')return blocked('read_failed');
 // A staff account (members cannot read workspace_staff): the staff identity RPC, keyed to auth.uid().
 // Best effort: a staff sign-in it does not recognise falls through to the not-eligible line below.
 const staff=await (await createClient()).rpc('real_clinical_staff_identity').then((r)=>!r.error&&!!r.data,()=>false);
 if(staff)return blocked('staff_account');
 const review=await readRealMemberStatus().catch(()=>'failed' as const);
 if(review==='failed')return blocked('read_failed');
 if(review.enabled&&review.status===null){
  log.info('zoe_chat_enrol_on_send',{action:'zoe_chat_enrol_on_send',member_id:memberId});
  return {kind:'chat',thread:EMPTY_THREAD};
 }
 return blocked('not_eligible');
}
