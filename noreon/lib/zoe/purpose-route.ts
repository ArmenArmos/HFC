import type {RouteConfig,RouteModel} from './pipeline';
import {TIERS,type Tier} from './routing';

type Env=Record<string,string|undefined>;
/**
 * Which AI settings tier each non-Zoe purpose runs on. Lab reading and the care plan summary read
 * well on the medium tier (eval 19 Oct, output/ai-eval-labs-2026-10-19/REPORT.md), so they no longer
 * share the high tier that Zoe intake needs. An env value of low, medium or high overrides the default;
 * anything else is ignored. The route is that tier's configured model and fallback, and the spend is
 * reserved against that tier's cap.
 */
export const AI_PURPOSE_TIER={lab_reading:'medium',plan_summary:'medium'}as const satisfies Record<string,Tier>;
export type AiPurpose=keyof typeof AI_PURPOSE_TIER;
const ENV_KEY:Record<AiPurpose,string>={lab_reading:'NOREON_AI_TIER_LAB_READING',plan_summary:'NOREON_AI_TIER_PLAN_SUMMARY'};

export function purposeTier(purpose:AiPurpose,env:Env=process.env):Tier{
 const v=env[ENV_KEY[purpose]]?.trim();
 return (TIERS as readonly string[]).includes(v??'')?v as Tier:AI_PURPOSE_TIER[purpose];
}
export type PurposeRoute={tier:Tier;primary:RouteModel;fallback:RouteModel|null};
/** The purpose's tier model and fallback; null when that tier is not configured (nothing is called). */
export function purposeRoute(config:RouteConfig,purpose:AiPurpose,env:Env=process.env):PurposeRoute|null{
 const tier=purposeTier(purpose,env),t=config.tiers[tier];
 return t?{tier,primary:t.model,fallback:t.fallback}:null;
}
