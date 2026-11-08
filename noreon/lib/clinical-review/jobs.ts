import "server-only";
import { raiseCareQueueTasks } from "@/lib/care-queue/server";
import type { CareQueueRaise } from "@/lib/care-queue/contracts";
import { ZONE_RULES_V1 } from "@/lib/clinical/zones/config-v1";
import { slaDeadline } from "@/lib/clinical/zones/evaluate";
import { BP_ANOMALY_VERSION, type BpAnomaly } from "@/lib/clinical/rules/bp-anomaly";
import { LAB_TREND_VERSION, type LabTrendFinding } from "@/lib/clinical/rules/lab-trend";
import { clinicalReviewMemberSchema, clinicalReviewPageSchema, memberAnomalies, memberRisk, type ClinicalReviewMember } from "./inputs";

/** Service-role calls, injected so checks need no database. */
export type ReviewRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export const REVIEW_PAGE = 25;
/** Stop claiming a new page with less than this left before the job's deadline. */
const PAGE_BUDGET_MS = 8_000;

/** Every member in care, page by page, until the end or the deadline. A page that cannot be read ends the run as failed. */
async function eachMember(rpc: ReviewRpc, days: number, deadline: number, now: () => number, visit: (m: ClinicalReviewMember) => Promise<void>) {
  const out = { members: 0, invalid: 0, pages: 0, stoppedForTime: false, pageFailed: false };
  let after: string | null = null;
  for (;;) {
    if (deadline - now() < PAGE_BUDGET_MS) { out.stoppedForTime = true; break; }
    let page;
    try { page = clinicalReviewPageSchema.parse(await rpc("clinical_review_inputs", { p_after: after, p_limit: REVIEW_PAGE, p_days: days })); }
    catch { out.pageFailed = true; break; }
    out.pages++;
    for (const raw of page.members) {
      const m = clinicalReviewMemberSchema.safeParse(raw);
      if (!m.success) { out.invalid++; continue; }
      out.members++;
      await visit(m.data);
    }
    if (!page.next || page.members.length < REVIEW_PAGE) break;
    after = page.next;
  }
  return out;
}

export type RiskTierJobReport = { members: number; recorded: number; unchanged: number; failed: number; invalid: number; pages: number; stoppedForTime: boolean };
/** Recomputes every member's tier (lib/clinical/rules/risk-tier.ts) and records it; the database appends only a change. */
export async function runRiskTierJob(rpc: ReviewRpc, o: { deadline: number; now?: () => number }): Promise<RiskTierJobReport> {
  const now = o.now ?? (() => Date.now());
  let recorded = 0, unchanged = 0, failed = 0;
  const walk = await eachMember(rpc, 14, o.deadline, now, async m => {
    const r = memberRisk(m, new Date(now()));
    try {
      const res = await rpc("member_risk_tier_record", { p_member: m.memberId, p_tier: r.tier, p_score: r.score, p_reasons: r.reasons, p_version: r.version, p_facts: r.facts }) as { ok?: boolean; changed?: boolean } | null;
      if (res?.ok !== true) failed++;
      else if (res.changed) recorded++;
      else unchanged++;
    } catch { failed++; }
  });
  return { members: walk.members, recorded, unchanged, failed: failed + (walk.pageFailed ? 1 : 0), invalid: walk.invalid, pages: walk.pages, stoppedForTime: walk.stoppedForTime };
}

/** One finding as a care-queue raise: one task per member, rule and window (the source ref), so repeated sweeps replay it. */
export function anomalyRaise(memberId: string, f: BpAnomaly | LabTrendFinding, at: string): CareQueueRaise {
  const lab = f.ruleId.startsWith("lab_trend.");
  return {
    memberId, queue: f.queue, zone: f.zone, reason: f.ruleId, ruleVersion: lab ? LAB_TREND_VERSION : BP_ANOMALY_VERSION,
    redFlagsStatus: f.ruleId === "bp_anomaly.low_symptoms_unknown" ? "unknown" : f.ruleId === "bp_anomaly.low_with_symptoms" ? "positive" : null,
    suggestedAction: null, summary: { rule: f.ruleId, facts: f.facts }, slaDeadline: slaDeadline({ slaHours: ZONE_RULES_V1.slaHours[f.zone] }, at),
    sourceRef: `anomaly:${f.ruleId}:${f.window}`.slice(0, 128),
  };
}

export type AnomalyJobReport = { members: number; findings: number; raised: number; replayed: number; failed: number; invalid: number; pages: number; stoppedForTime: boolean };
/** Reads recent data with the service role and raises care-queue tasks through care_queue_raise; never a care alert. */
export async function runClinicalAnomalySweep(rpc: ReviewRpc, o: { deadline: number; now?: () => number; env?: Record<string, string | undefined> }): Promise<AnomalyJobReport> {
  const now = o.now ?? (() => Date.now());
  const r = { findings: 0, raised: 0, replayed: 0, failed: 0 };
  const walk = await eachMember(rpc, 30, o.deadline, now, async m => {
    const at = new Date(now());
    const findings = memberAnomalies(m, at);
    if (!findings.length) return;
    r.findings += findings.length;
    const report = await raiseCareQueueTasks(rpc, findings.map(f => anomalyRaise(m.memberId, f, at.toISOString())), o.env);
    r.raised += report.raised; r.replayed += report.replayed; r.failed += report.failed;
  });
  return { members: walk.members, ...r, failed: r.failed + (walk.pageFailed ? 1 : 0), invalid: walk.invalid, pages: walk.pages, stoppedForTime: walk.stoppedForTime };
}
