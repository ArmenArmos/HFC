import "server-only";
import { worklistSchema, type WorklistRead } from "./schema";

export type WorklistRpc = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** The calling staff member's prioritised worklist. The database scopes it by role and audits each listed member. */
export async function readWorklist(c: WorklistRpc, limit: number): Promise<WorklistRead> {
  try {
    const r = await c.rpc("care_team_worklist", { p_limit: Math.max(1, Math.min(200, Math.trunc(limit))) });
    if (r.error) return { kind: r.error.code === "42501" ? "access" : "unavailable" };
    const p = worklistSchema.safeParse(r.data);
    return p.success ? { kind: "ready", list: p.data } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}

/** The latest tier of one member for the staff header. Null when none, refused or unreadable. */
export async function readMemberRiskTier(c: WorklistRpc, memberId: string): Promise<{ tier: string; reasons: string[]; computedAt: string } | null> {
  try {
    const r = await c.rpc("staff_member_risk_tier", { p_member: memberId });
    if (r.error) return null;
    const t = (r.data as { tier?: { tier?: unknown; reasons?: unknown; computedAt?: unknown } | null } | null)?.tier;
    if (!t || typeof t.tier !== "string" || !Array.isArray(t.reasons) || typeof t.computedAt !== "string") return null;
    return { tier: t.tier, reasons: t.reasons.filter((x): x is string => typeof x === "string"), computedAt: t.computedAt };
  } catch { return null; }
}
