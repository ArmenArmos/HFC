import { buildLdlResponse, unusableObservationKeys } from "./response";
import { adminLdlRetestsSchema, doctorLdlResponsesSchema, ldlCandidatesSchema, ldlLoopResults, type AdminLdlRetest, type DoctorLdlResponse, type LdlLoopResult } from "./response-schema";

/** The service RPC the dispatcher sweep uses (lib/telegram-runtime/server.ts serviceRpc): throws on a database error. */
export type LdlServiceRpc = (name: string, args?: Record<string, unknown>) => Promise<unknown>;
export type LdlSweepReport = { state: string; checked: number; recorded: number; skipped: number; failed: number; run: string };

/**
 * Every 5 minutes (app/api/internal/telegram/dispatch): the response check for members with a new reviewed LDL value,
 * then ldl_response_run (re-test requests, overdue items, member notices). Dark: the database switch decides. One
 * member's failure never stops the others; the next sweep retries, and a record replays.
 */
export async function runLdlResponseSweep(rpc: LdlServiceRpc): Promise<LdlSweepReport> {
  let checked = 0, recorded = 0, skipped = 0, failed = 0;
  const parsed = ldlCandidatesSchema.safeParse(await rpc("ldl_response_candidates", { p_limit: 50 }));
  if (!parsed.success) return { state: "unreadable", checked, recorded, skipped, failed, run: "skipped" };
  if (!parsed.data.enabled) return { state: "off", checked, recorded, skipped, failed, run: "off" };
  for (const c of parsed.data.members) {
    checked++;
    // Values the check cannot use are recorded as skipped, so they never hold the member in the list (Astra LDLR-04).
    const unusable = unusableObservationKeys(c);
    if (unusable.length) {
      try { skipped += Number(await rpc("ldl_response_skip", { p_member: c.memberId, p_keys: unusable })) || 0; } catch { failed++; }
    }
    const record = buildLdlResponse(c);
    if (!record) continue;
    try {
      const r = (await rpc("ldl_response_record", { p_command: record })) as { status?: string } | null;
      if (r?.status === "saved") recorded++;
      // stale: the goal changed after this sweep's read; the next sweep works it out again from the new one.
      else if (r?.status !== "replayed" && r?.status !== "stale") failed++;
    } catch { failed++; }
  }
  const run = (await rpc("ldl_response_run", {}).catch(() => null)) as { state?: string } | null;
  return { state: "ran", checked, recorded, skipped, failed, run: run?.state ?? "failed" };
}

export type LdlUserRpc = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** The doctor's open LDL results for Today. Empty when off; null when unreadable (the section says so). */
export async function readDoctorLdlResponses(c: LdlUserRpc): Promise<DoctorLdlResponse[] | null> {
  try {
    const r = await c.rpc("doctor_ldl_responses");
    if (r.error) return null;
    const p = doctorLdlResponsesSchema.safeParse(r.data);
    return p.success ? (p.data.enabled ? p.data.items : []) : null;
  } catch { return null; }
}
/** The admin's overdue and fenced re-tests for Operations. Empty when off; null when unreadable. */
export async function readAdminLdlRetests(c: LdlUserRpc): Promise<AdminLdlRetest[] | null> {
  try {
    const r = await c.rpc("admin_ldl_retests");
    if (r.error) return null;
    const p = adminLdlRetestsSchema.safeParse(r.data);
    return p.success ? (p.data.enabled ? p.data.items : []) : null;
  } catch { return null; }
}

export async function runLoopCommand(c: LdlUserRpc, name: string, args: Record<string, unknown>): Promise<LdlLoopResult> {
  try {
    const r = await c.rpc(name, args);
    if (r.error) return { status: r.error.code === "42501" ? "access" : r.error.code === "55P03" ? "unavailable" : "outcome-unknown" };
    const s = (r.data as { status?: string } | null)?.status;
    return (ldlLoopResults as readonly string[]).includes(s ?? "") ? { status: s as LdlLoopResult["status"] } : { status: "outcome-unknown" };
  } catch { return { status: "outcome-unknown" }; }
}
