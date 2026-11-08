import 'server-only';
import {z} from 'zod';
import {doctorChatHomeEnabled,doctorDecisionsEnabled} from './workspace-config';
import {conversationReadSchema} from './contracts';
import {markZoeAnswered} from '@/lib/doctor-inbox/zoe-answered';
import {closeResolutions,careAlertsEnabled,careAlertCommandSchema} from '@/lib/care-alerts/contracts';
import {nativeCareCommandSchema} from '@/lib/staff/care-command-schema';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import type {DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {zoePipelineEnabled} from '@/lib/zoe/policy';

export type EverydayContext={client:DocumentRpc;role:string;doctorId:string;expectedDoctorId:unknown};
export type EverydayResult={kind:'saved';notice:string}|{kind:'already_resolved';resolvedBy:string|null;resolvedAt:string|null}|{kind:'invalid'|'refused'|'off'|'changed'|'unavailable'|'zoe_inactive'};
const conversationInput=z.object({conversationId:z.uuid()});
const markInput=conversationInput.extend({action:z.enum(['reviewed','reopen']),version:z.number().int().positive()}).strict();
const handInput=conversationInput.extend({version:z.number().int().nonnegative(),modeRevision:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
// The doctor chat knows the member, not Doctor Zoe's own conversation with them: the database proves the assignment itself.
const handMemberInput=z.object({memberId:z.uuid(),version:z.number().int().nonnegative(),modeRevision:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
const alertInput=z.object({alertId:z.uuid(),seq:z.number().int().nonnegative(),resolution:z.enum(closeResolutions),note:z.string().trim().min(1).max(1000)}).strict();
async function allowed(c:EverydayContext,env:Record<string,string|undefined>){
 if(!doctorChatHomeEnabled(env)||c.role!=='doctor'||c.doctorId!==c.expectedDoctorId)return false;
 const r=await c.client.rpc('staff_zoe_status');return !r.error&&r.data===true;
}
async function member(c:EverydayContext,conversationId:string){
 const r=await c.client.rpc('staff_zoe_read',{p_conversation:conversationId});
 const p=conversationReadSchema.safeParse(r.data);return !r.error&&p.success&&p.data.enabled?p.data.member.id:null;
}
const failure=(code:string|undefined):EverydayResult=>({kind:code==='42501'?'refused':'unavailable'});
export async function runEverydayMark(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayResult>{
 const p=markInput.safeParse(raw);if(!p.success)return {kind:'invalid'};
 if(!await allowed(c,env))return {kind:'refused'};
 if(!doctorDecisionsEnabled(env)||!zoePipelineEnabled(env))return {kind:'off'};
 const id=await member(c,p.data.conversationId);if(!id)return {kind:'refused'};
 let denied=false;
 const notice=await markZoeAnswered({mark:async(memberId,action,version)=>{
  const r=await c.client.rpc('doctor_zoe_answered_mark',{p_member:memberId,p_action:action,p_version:version});
  denied=r.error?.code==='42501';return r.error?null:r.data;
 }},{memberId:id,action:p.data.action,version:p.data.version});
 if(denied)return {kind:'refused'};
 return notice==='zoe_changed'?{kind:'changed'}:notice==='zoe_invalid'?{kind:'invalid'}:notice==='unavailable'?{kind:'unavailable'}:{kind:'saved',notice};
}
async function handBackMember(c:EverydayContext,id:string,version:number,modeRevision:string):Promise<EverydayResult>{
 const r=await c.client.rpc('doctor_chat_hand_back',{p_member:id,p_version:version,p_mode_revision:modeRevision});
 if(r.error)return failure(r.error.code);
 const parsed=z.union([z.object({ok:z.literal(true),replayed:z.boolean()}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(r.data);
 if(!parsed.success)return {kind:'unavailable'};
 if(!parsed.data.ok)return {kind:parsed.data.code==='zoe_inactive'?'zoe_inactive':parsed.data.code==='stale_context'?'changed':parsed.data.code==='invalid'?'invalid':'unavailable'};
 return {kind:'saved',notice:parsed.data.replayed?'already_zoe':'handed_back'};
}
export async function runEverydayHandBack(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayResult>{
 const p=handInput.safeParse(raw);if(!p.success)return {kind:'invalid'};
 if(!await allowed(c,env))return {kind:'refused'};
 if(!doctorDecisionsEnabled(env)||!zoePipelineEnabled(env))return {kind:'off'};
 const id=await member(c,p.data.conversationId);if(!id)return {kind:'refused'};
 return handBackMember(c,id,p.data.version,p.data.modeRevision);
}
export async function runEverydayHandBackForMember(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayResult>{
 const p=handMemberInput.safeParse(raw);if(!p.success)return {kind:'invalid'};
 if(!await allowed(c,env))return {kind:'refused'};
 if(!doctorDecisionsEnabled(env)||!zoePipelineEnabled(env))return {kind:'off'};
 return handBackMember(c,p.data.memberId,p.data.version,p.data.modeRevision);
}
export async function runEverydayResolve(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayResult>{
 const p=alertInput.safeParse(raw);if(!p.success)return {kind:'invalid'};
 if(!await allowed(c,env))return {kind:'refused'};
 if(!careAlertsEnabled(env))return {kind:'off'};
 const r=await c.client.rpc('care_alert_resolve',{p_alert:p.data.alertId,p_expected_seq:p.data.seq,p_resolution:p.data.resolution,p_note:p.data.note});
 if(r.error)return failure(r.error.code);
 const parsed=careAlertCommandSchema.safeParse(r.data);if(!parsed.success)return {kind:'unavailable'};
 if(parsed.data.ok&&!parsed.data.changed)return {kind:'already_resolved',resolvedBy:parsed.data.alert.resolvedBy,resolvedAt:parsed.data.alert.resolvedAt};
 return parsed.data.ok?{kind:'saved',notice:'resolved'}:{kind:parsed.data.code==='changed'?'changed':parsed.data.code==='invalid'?'invalid':parsed.data.code==='not_found'?'refused':'unavailable'};
}
export type EverydayCareResult={ok:boolean;error?:string;revision?:number};
export async function runEverydayAcknowledge(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayResult>{
 const p=z.strictObject({alertId:z.uuid(),seq:z.number().int().nonnegative()}).safeParse(raw);if(!p.success)return {kind:'invalid'};
 if(!await allowed(c,env))return {kind:'refused'};
 if(!careAlertsEnabled(env))return {kind:'off'};
 const r=await c.client.rpc('care_alert_acknowledge',{p_alert:p.data.alertId,p_expected_seq:p.data.seq});
 if(r.error)return failure(r.error.code);
 const parsed=careAlertCommandSchema.safeParse(r.data);if(!parsed.success)return {kind:'unavailable'};
 if(parsed.data.ok&&parsed.data.alert.state==='resolved')return {kind:'already_resolved',resolvedBy:parsed.data.alert.resolvedBy,resolvedAt:parsed.data.alert.resolvedAt};
 return parsed.data.ok?{kind:'saved',notice:'acknowledged'}:{kind:parsed.data.code==='changed'?'changed':parsed.data.code==='invalid'?'invalid':parsed.data.code==='not_found'?'refused':'unavailable'};
}
export async function runEverydayCare(c:EverydayContext,raw:unknown,env:Record<string,string|undefined>=process.env):Promise<EverydayCareResult>{
 const failed={ok:false,error:'This case or assignment changed. Refresh and check your access before trying again.'};
 const p=nativeCareCommandSchema.safeParse(raw);if(!p.success)return {ok:false,error:'Check the measurement or note details.'};
 if(p.data.op==='measurement'&&(isFutureMeasurement(p.data.measuredAt)||p.data.diastolic>=p.data.systolic))return {ok:false,error:'Check the recorded time and blood pressure values.'};
 if(!await allowed(c,env))return failed;
 const {id,revision,op,...payload}=p.data;
 const r=await c.client.rpc('patient_staff_care_command',{p_id:id,p_revision:revision,p_operation:op,p_input:payload});
 const saved=z.number().int().nonnegative().safeParse(r.data);
 return !r.error&&saved.success?{ok:true,revision:saved.data}:failed;
}
