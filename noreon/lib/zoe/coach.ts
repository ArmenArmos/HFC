import {z} from 'zod';
import type {Tier} from './routing';
import type {ZoeEvent} from './pipeline';

/**
 * Zoe coach C0 (COACH_SPEC §8.8; migration 20261020103406): the proactive job contract and the worker's calls. A coach
 * job never carries a member message and never enters runZoeJob (zoeJobSchema requires one): it has its own run kind,
 * its own claim, reserve and finish, and publication is refused in the database when anything changed since the claim.
 * Nothing calls these yet: C4 adds the scheduler and the generation, behind zoe_settings.coach_enabled (default off).
 */

/** Why coaching may not run now (_zoe_coach_block_reason). Unknown codes read as blocked. */
export const COACH_BLOCK_REASONS=['coach_off','no_zoe_consent','no_coach_consent','no_memory_consent','free_mode_off','no_assigned_doctor','doctor_takeover',
 'intake_active','care_alert_open','urgent_window','urgent_pause','same_day_pause','safety_hold','no_plan','spend_cap','no_member'] as const;
export type CoachBlockReason=typeof COACH_BLOCK_REASONS[number];

/**
 * The week facts packet (§4.3), computed in SQL by C4; the only source of numbers in a check-in. The model only puts it
 * into words, and a number in the reply that is not in the packet holds the reply.
 */
const mean=z.strictObject({systolic:z.number().int(),diastolic:z.number().int()});
export const weekPacketSchema=z.strictObject({
 bp:z.strictObject({readings:z.number().int().min(0),days:z.number().int().min(0).max(7),mean:mean.nullable(),bpWeekMean:mean.nullable(),previousMean:mean.nullable(),
  direction:z.enum(['lower','about_the_same','higher']).nullable()}),
 glucose:z.array(z.strictObject({context:z.enum(['fasting','after_meal','unknown']),readings:z.number().int().min(0),meanMmol:z.number().nullable()})),
 fastingTrend:z.enum(['lower','about_the_same','higher']).nullable(),
 medicines:z.array(z.strictObject({taken:z.number().int().min(0),skipped:z.number().int().min(0),noReport:z.number().int().min(0)})),
 goals:z.array(z.strictObject({templateId:z.string().max(80),targetDays:z.number().int().min(0).max(7),daysDone:z.number().int().min(0).max(7)})),
 planFocus:z.array(z.string().max(40)).max(9),
 planPublishedDaysAgo:z.number().int().min(0).nullable(),
 /** Sent to the doctor this week (§4.5): the check-in then says only that it was sent. */
 patternSentToDoctor:z.boolean(),
 lastAnswer:z.string().max(700).nullable(),
});
export type WeekPacket=z.infer<typeof weekPacketSchema>;

/** One claimed coach run (zoe_coach_claim's jobs). C4 adds the packet before generation. */
export const zoeCoachJobSchema=z.strictObject({
 runId:z.uuid(),eventId:z.uuid(),memberId:z.uuid(),kind:z.enum(['checkin','nudge']),isoWeek:z.string().regex(/^\d{4}-W\d{2}$/),
 displayName:z.string().nullable(),locale:z.enum(['en','hy']).nullable(),
 packet:weekPacketSchema.nullable().default(null),
});
export type ZoeCoachJob=z.infer<typeof zoeCoachJobSchema>;

const claimResult=z.object({jobs:z.array(z.unknown()),redeliver:z.array(z.object({eventId:z.uuid(),memberId:z.uuid(),kind:z.enum(['checkin','nudge'])}))});
const reserveResult=z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string(),reason:z.string().optional()})]);
const finishResult=z.object({ok:z.boolean(),outcome:z.string().optional(),reason:z.string().optional(),code:z.string().optional(),messageId:z.uuid().nullable().optional()});
const teaserResult=z.object({ok:z.boolean(),channel:z.enum(['telegram','app']).optional(),code:z.string().optional(),reason:z.string().nullable().optional()});

export type CoachFinishInput=
 |{outcome:'publish';body:string;language:'en'|'hy'|'ru';provider:string;model:string;configVersion:string;costUsd:number;usage:{inputTokens:number;outputTokens:number}|null;latencyMs:number|null;sealedIo:string|null;events:ZoeEvent[]}
 |{outcome:'discarded'|'no_output';reason:string;provider:string;model:string;configVersion:string;costUsd:number;usage:{inputTokens:number;outputTokens:number}|null;latencyMs:number|null;sealedIo:string|null;events:ZoeEvent[]};

export type CoachRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;

/** The worker's coach calls (service role). A job that does not parse is skipped; its row is retried by the claim's reaper. */
export function coachPorts(rpc:CoachRpc){
 return {
  schedule:async(memberId:string,kind:'checkin'|'nudge',dueAt:Date)=>rpc('zoe_coach_schedule',{p_member:memberId,p_kind:kind,p_due_at:dueAt.toISOString()}),
  claim:async(limit=10)=>{const r=claimResult.parse(await rpc('zoe_coach_claim',{p_limit:limit}));
   const jobs:ZoeCoachJob[]=[];for(const j of r.jobs){const p=zoeCoachJobSchema.safeParse(j);if(p.success)jobs.push(p.data);}
   return {jobs,redeliver:r.redeliver};},
  reserve:async(runId:string,estimateUsd:number,local:boolean,events:ZoeEvent[],route:{tier:Tier;model:string;judgeModel?:string|null})=>
   reserveResult.parse(await rpc('zoe_coach_reserve',{p_run:runId,p_estimate_usd:estimateUsd,p_local:local,p_events:events,p_tier:route.tier,p_model:route.model,p_judge_model:route.judgeModel??null})),
  // A refused finish is reported as such, never as the outcome the worker hoped for.
  finish:async(runId:string,input:CoachFinishInput)=>{const r=finishResult.parse(await rpc('zoe_coach_finish',{p_run:runId,p_result:input}));return r.ok?r:{ok:false,outcome:'finish_refused'};},
  queueTeaser:async(eventId:string)=>teaserResult.parse(await rpc('zoe_coach_queue_teaser',{p_event:eventId})),
 };
}
