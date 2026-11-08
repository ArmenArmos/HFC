import "server-only";
import type { LdlRpc } from "@/lib/ldl/runtime";
import { lipidPlannerReadSchema, type LipidPlannerRead } from "./schema";

/** Assigned doctor only; the database decides and records the read. Null when unreadable: nothing is shown. */
export async function readLipidPlanner(c: LdlRpc, memberId: string): Promise<LipidPlannerRead | null> {
  try {
    const r = await c.rpc("doctor_lipid_planner_read", { p_member: memberId });
    if (r.error) return null;
    const p = lipidPlannerReadSchema.safeParse(r.data);
    return p.success ? p.data : null;
  } catch { return null; }
}
