import type {Tier} from './routing';

/**
 * Model classes per Zoe tier (catalog strength: 1 Small, 2 Mid, 3 Strongest). The RECOMMENDED class is the tier's risk
 * rank; the FLOOR is the lowest class the tier may use. The high tier may use a Mid model (lead decision 19 Oct, AI eval
 * output/ai-eval-zoe-2026-10-19: Sonnet 5.5 as safe as Opus 5.5 on symptom intake); the admin page then warns that it is
 * below the recommended class, and a change still needs a passing eval of the candidate.
 * Mirrors the database: _zoe_tier_rank (recommended) and _zoe_tier_floor (floor), migration 20261019074213.
 */
export const TIER_RECOMMENDED:Record<Tier,number>={low:1,medium:2,high:3};
export const TIER_FLOOR:Record<Tier,number>={low:1,medium:2,high:2};
export type TierClassFit='recommended'|'below_recommended'|'not_allowed';
export const tierClassFit=(tier:Tier,strength:number):TierClassFit=>
 strength<TIER_FLOOR[tier]?'not_allowed':strength<TIER_RECOMMENDED[tier]?'below_recommended':'recommended';
export const BELOW_RECOMMENDED_TEXT='Below the recommended class for this tier; eval required';
