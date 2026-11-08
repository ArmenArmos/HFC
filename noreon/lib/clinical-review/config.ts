/**
 * WP T feature switches, each dark unless exactly 'true'. Framework-free so components and checks can read them.
 * - NOREON_BP_TARGETS: the physician targets card, the member's target on charts and BP replies, and the personal
 *   comparison in the BP flow (with no target on file the THRESHOLD defaults apply).
 * - NOREON_RISK_TIERS: the risk-tier job, the care-team worklist card and the tier in staff member headers.
 * - NOREON_CLINICAL_ANOMALIES: the BP and LDL trend sweep that raises care-queue tasks.
 * Care-queue raises also need NOREON_ZOE_APP_V3 (lib/care-queue/server.ts).
 */
type Env = Record<string, string | undefined>;
export const bpTargetsEnabled = (env: Env = process.env) => env.NOREON_BP_TARGETS === "true";
export const riskTiersEnabled = (env: Env = process.env) => env.NOREON_RISK_TIERS === "true";
export const clinicalAnomaliesEnabled = (env: Env = process.env) => env.NOREON_CLINICAL_ANOMALIES === "true";
