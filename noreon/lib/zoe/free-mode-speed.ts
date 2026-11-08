import {z} from 'zod';
import type {Effort} from './provider';

/**
 * Free-mode speed settings (Armen and Khikar, 20 Oct: replies in 3 to 5 s, no loss of quality; output/zoe-speed/).
 * Each one changes only how fast the same checks run, never which checks run: the urgent words, red flags, floors, the
 * 103 window, the judge, the careful line and the spend caps are untouched.
 *
 *  - split: the reply call returns only what the member and the safety checks need (reply, urgency, forward, language);
 *    the doctor's summary is a second, short call on the final reply, and is written in the same
 *    finish as the answer, so the doctor never sees a run without it. When it fails or is late, the run carries a
 *    "summary unavailable" marker and the conversation as always.
 *  - replyEffort / judgeEffort / summaryEffort: the reasoning effort of each call. Opus 5.5 always thinks (medium by
 *    default); thinking was about half of the reply call's output (TIMINGS.md).
 *  - judgeTier: which tier's model checks the reply ("medium", Sonnet 5.5, as before; "low", Haiku 5.5). It is never the
 *    speaker's own model (pickJudge).
 *  - summaryTier: the model that writes the doctor's summary ("speaker" = the reply's own model, or a tier's model).
 *  - fast: the reply calls go to the same model's fast endpoint where one exists (Opus 5.5, gateway.ts FAST_MODELS),
 *    costed at its 2x price against the caps; after a fast-endpoint error the retry uses the standard endpoint.
 *
 * The reply model itself is the tier model in AI settings (zoe_route_config), switched there with its eval gate.
 * Environment overrides (Vercel), each optional: NOREON_ZOE_FREE_SPLIT=true|false, NOREON_ZOE_FREE_FAST=true|false, NOREON_ZOE_FREE_REPLY_EFFORT,
 * NOREON_ZOE_JUDGE_EFFORT, NOREON_ZOE_SUMMARY_EFFORT (none|low|medium|high|default; "none" turns thinking off
 * where the model allows it, Haiku 5.5, and the Gateway lowers it to the model's lowest level elsewhere), NOREON_ZOE_JUDGE_TIER (medium|low),
 * NOREON_ZOE_SUMMARY_TIER (speaker|low|medium). An unreadable value falls back to the shipped default.
 */
export const FREE_SPEED_VERSION='free-speed-2';
const effort=z.enum(['none','low','medium','high','default']).transform(v=>v==='default'?null:v as Effort);
const level=z.enum(['none','low','medium','high']).nullable();
export const freeSpeedSchema=z.object({split:z.boolean(),fast:z.boolean(),replyEffort:level,judgeEffort:level,
 summaryEffort:level,judgeTier:z.enum(['medium','low']),summaryTier:z.enum(['speaker','low','medium'])});
export type FreeSpeed=z.infer<typeof freeSpeedSchema>;

/** Behaviour before this change: one call with the summary, every model at its own default effort, Sonnet judge. */
export const FREE_SPEED_BEFORE:FreeSpeed={split:false,fast:false,replyEffort:null,judgeEffort:null,summaryEffort:null,judgeTier:'medium',summaryTier:'speaker'};
/**
 * The cost configuration keeps G4's model and effort, using the standard endpoint at half the fast price.
 * The earlier speed configuration (output/zoe-speed/RESULTS.md, gate G4 + bench 2) used the fast endpoint:
 * low effort, the judge as before (Sonnet 5.5 at its own effort: at low effort it held correct answers, gate G2), and the
 * summary on Haiku 5.5 without thinking. Gateway p50 7.8 s, p90 9.8 s on the model path, from 24.9 s / 28.4 s.
 */
export const FREE_SPEED_DEFAULT:FreeSpeed={split:true,fast:false,replyEffort:'low',judgeEffort:null,summaryEffort:'none',judgeTier:'medium',summaryTier:'low'};

type Env=Record<string,string|undefined>;
const bool=z.enum(['true','false']).transform(v=>v==='true');
export function freeSpeed(env:Env=process.env,base:FreeSpeed=FREE_SPEED_DEFAULT):FreeSpeed{
 const read=<T>(raw:string|undefined,schema:z.ZodType<T>,fallback:T):T=>{if(raw===undefined)return fallback;const p=schema.safeParse(raw.trim().toLowerCase());return p.success?p.data:fallback;};
 return {
  split:read(env.NOREON_ZOE_FREE_SPLIT,bool,base.split),
  fast:read(env.NOREON_ZOE_FREE_FAST,bool,base.fast),
  replyEffort:read(env.NOREON_ZOE_FREE_REPLY_EFFORT,effort,base.replyEffort),
  judgeEffort:read(env.NOREON_ZOE_JUDGE_EFFORT,effort,base.judgeEffort),
  summaryEffort:read(env.NOREON_ZOE_SUMMARY_EFFORT,effort,base.summaryEffort),
  judgeTier:read(env.NOREON_ZOE_JUDGE_TIER,z.enum(['medium','low']),base.judgeTier),
  summaryTier:read(env.NOREON_ZOE_SUMMARY_TIER,z.enum(['speaker','low','medium']),base.summaryTier),
 };
}
