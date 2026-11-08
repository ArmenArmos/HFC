/**
 * The production AI posture, independent of the pre-launch staging marker (NOREON_PRELAUNCH_STAGING).
 * Khikar, 19 Oct 2026 01:28: "don't remove AI in non-staging mode. Keep all on." Each switch is an
 * explicit deployment setting: "true" or "false", or unset for its default (below). Any other value
 * fails the build (lib/deployment.ts) and reads as off here, so a typo never turns a path on.
 *
 * These only stop the app from trying. Real calls still need the Gateway provider and
 * NOREON_ZOE_MODEL_CALLS_ENABLED=true in the deployment, and in the database
 * zoe_settings.model_calls_allowed (with staging_ai_mode or a signed data agreement), a passing
 * 7-day eval per tier, each feature's own switch and the daily spend caps.
 *
 * Runbook and register: docs/operations/staging-ai-mode.md, output/GO_LIVE_GATES.md.
 */
type Env=Record<string,string|undefined>;

/**
 * Real AI calls without an app-side data-agreement confirmation (NOREON_ZOE_DPA_CONFIRMED). This
 * is the legal gate the staging marker used to stand in for: the data agreements (DPA) and the
 * Armenian legal check are Khikar's call (PENDING_QUESTIONS P14, P16). Default on per his decision;
 * "false" brings back the requirement for NOREON_ZOE_DPA_CONFIRMED=true.
 */
export const AI_WITHOUT_DPA='NOREON_AI_WITHOUT_DPA_CONFIRMATION';
/**
 * The STAGING placeholder urgent-word list (lib/zoe/urgent-staging.ts) instead of the empty S1
 * list. With the S1 list Zoe drafts nothing and calls no model, so this is what keeps Zoe on until
 * Tatevik signs the S1 list. The placeholder over-matches by design and is not clinical coverage.
 * "true" turns it on with or without the staging marker; "false" turns it off even on staging.
 * Unset keeps the eval's safety default (no signed list, Zoe dark; eval rows U24, U29, C28) except
 * on prod-as-staging, where it stays on as before. Khikar's decision (keep AI on) is applied by
 * setting it to "true" in production before the staging marker is removed (RUNBOOK, GO_LIVE_GATES).
 */
export const ZOE_URGENT_PLACEHOLDER='NOREON_ZOE_URGENT_PLACEHOLDER';

export const AI_POSTURE_SETTINGS=[AI_WITHOUT_DPA,ZOE_URGENT_PLACEHOLDER] as const;

const on=(env:Env,name:string)=>{const v=env[name];return v===undefined||v===''||v==='true';};
const invalid=(env:Env,name:string)=>{const v=env[name];return v!==undefined&&v!==''&&v!=='true'&&v!=='false';};

export const aiWithoutDpaAllowed=(env:Env=process.env)=>on(env,AI_WITHOUT_DPA);
export const zoeUrgentPlaceholderOn=(env:Env=process.env)=>{
 const v=env[ZOE_URGENT_PLACEHOLDER];
 return v==='true'||((v===undefined||v==='')&&env.NOREON_PRELAUNCH_STAGING==='true');
};

/** Build errors for values other than unset, "", "true" or "false". */
export function aiSwitchErrors(env:Env):string[]{
 return AI_POSTURE_SETTINGS.filter(name=>invalid(env,name)).map(name=>`${name} must be "true" or "false"`);
}
