import 'server-only';
import {z} from 'zod';
import {AWAITING_S1_LEXICON,createUrgentMatcher,type UrgentMatcher} from '@/lib/zoe/urgent';
import {configuredUrgentMatcher} from '@/lib/zoe/urgent-test';
import {messageScreeningReadsText,screenFromZoe,screenLabValue,screenMessage,type CriticalLabRules,type LabValueForScreening,type ScreenDecision} from './screen';
import type {ZoeDecision} from '@/lib/zoe/policy';

/** Service-role database calls, injected so checks need no database. */
export type CareAlertRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
const screenResult=z.union([z.object({ok:z.literal(true),replayed:z.boolean(),outcome:z.string().optional(),alertId:z.uuid().nullable().optional()}),z.object({ok:z.literal(false),code:z.string()})]);
const pending=z.array(z.object({messageId:z.uuid(),memberId:z.uuid(),text:z.string().nullable()}));

type Source={source:'message'|'lab'|'zoe';sourceRef:string;memberId:string|null};
/** Journals one screening decision and, when it escalates, raises or repeats the alert. */
export async function recordScreen(rpc:CareAlertRpc,src:Source,d:ScreenDecision){
 return screenResult.parse(await rpc('care_alert_screen',{p_member:src.memberId,p_source:src.source,p_source_ref:src.sourceRef,p_outcome:d.outcome,p_reason:d.reason,p_red_flags:d.redFlags,p_rule:d.rule,p_rule_version:d.ruleVersion}));
}

export type MessageScreenReport={screened:number;escalated:number;failed:number};
/**
 * Screens member messages that have not been screened yet. With the word list unsigned
 * (today) the text is never fetched: each message is journaled as skipped. A failed call
 * leaves the message unscreened, so the next sweep retries it.
 */
export async function screenPendingMessages(rpc:CareAlertRpc,matcher:UrgentMatcher=configuredUrgentMatcher(),limit=20):Promise<MessageScreenReport>{
 const report={screened:0,escalated:0,failed:0};
 const readsText=messageScreeningReadsText(matcher);
 let rows:z.infer<typeof pending>;
 try{rows=pending.parse(await rpc('care_alert_messages_pending',{p_limit:limit,p_with_text:readsText}));}catch{report.failed++;return report;}
 for(const row of rows){
  const d=readsText&&row.text!==null?screenMessage(row.text,matcher):screenMessage('',createUrgentMatcher(AWAITING_S1_LEXICON));
  try{
   const r=await recordScreen(rpc,{source:'message',sourceRef:row.messageId,memberId:row.memberId},d);
   if(r.ok){report.screened++;if(d.outcome==='escalate')report.escalated++;}else report.failed++;
  }catch{report.failed++;}
 }
 return report;
}

const retryResult=z.object({ok:z.literal(true),raised:z.number().int(),failed:z.number().int()});
/**
 * One care-alert pass for the sweep: re-raise questionnaire red flags, Zoe urgent runs and very high readings whose
 * raise failed at the time (nothing else would retry them), then screen new member messages.
 * The deadline-bound cron escalates first; callers without a deadline keep the Telegram retry order.
 * Its RPC client must also bound in-flight calls to that deadline, leaving the job contract's finish margin.
 */
export async function runCareAlertSweep(rpc:CareAlertRpc,matcher?:UrgentMatcher,deadlineAt?:number):Promise<MessageScreenReport>{
 const call:CareAlertRpc=async(name,args)=>{
  // Refuse each unstarted step (including individual messages) as a failure, never an idle success.
  if(deadlineAt!==undefined&&deadlineAt-Date.now()<1000)throw Error('care_alert_sweep_deadline');
  return rpc(name,args);
 };
 const escalate=async()=>{try{return retryResult.parse(await call('care_alert_escalate_due',{}));}catch{return {raised:0,failed:1};}};
 const firstEsc=deadlineAt===undefined?null:await escalate();
 const retry=async(name:string)=>{try{return retryResult.parse(await call(name,{p_limit:20}));}catch{return {raised:0,failed:1};}};
  const q=await retry('care_alert_assessments_retry'),z=await retry('care_alert_zoe_urgent_retry'),b=await retry('bp_check_retry');
  const bp=await retry('care_alert_bp_flags_retry');
  const merge=await retry('zoe_bp_merge_retry');
  // An open alert past its route's wait goes to the backup role (care_alert_escalate_due); a failed call is counted, never silent.
  const esc=firstEsc??await escalate();
  const m=await screenPendingMessages(call,matcher);
  return {screened:m.screened+q.raised+z.raised+b.raised+bp.raised,escalated:m.escalated+q.raised+z.raised+b.raised+bp.raised,failed:m.failed+q.failed+z.failed+b.failed+bp.failed+merge.failed+esc.failed};
}

/** Zoe hook: call with the zoe.urgent_match decision for one member turn. */
export const screenZoeTurn=(rpc:CareAlertRpc,memberId:string,turnId:string,d:ZoeDecision)=>recordScreen(rpc,{source:'zoe',sourceRef:turnId,memberId},screenFromZoe(d));
/** Lab hook (interface only until Q3): call when a verified lab value is stored. */
export const screenLabResult=(rpc:CareAlertRpc,v:LabValueForScreening,rules?:CriticalLabRules)=>recordScreen(rpc,{source:'lab',sourceRef:v.resultId,memberId:v.memberId},screenLabValue(v,rules));
