import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bpWeekReadSchema, type BpWeekRead } from "./model";

export type BpWeekRpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
const OFF: BpWeekRead = { version: "bp-week-v1", enabled: false };

/** Real members only. Keep a failed load distinct from the database switch being off. */
export async function readMemberBpWeekOrThrow(): Promise<BpWeekRead> {
  try {
    const client = await createClient();
    const { data, error } = await (client as unknown as BpWeekRpc).rpc("bp_week_member_read");
    if (!error) {
      const parsed = bpWeekReadSchema.safeParse(data);
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Provider errors may echo input; expose only fixed text.
  }
  throw new Error("The BP week could not be loaded.");
}

/** Home quietly omits the optional week panel during an outage. */
export async function readMemberBpWeek(): Promise<BpWeekRead> {
  return readMemberBpWeekOrThrow().catch(() => OFF);
}

/** Assigned nurse and doctor; the database decides scope and throws for anyone else. */
export async function readStaffBpWeek(client: BpWeekRpc, memberId: string): Promise<BpWeekRead> {
  const { data, error } = await client.rpc("bp_week_staff_read", { p_member: memberId });
  if (error) throw Object.assign(Error("The BP week is unavailable."), { code: error.code });
  const parsed = bpWeekReadSchema.safeParse(data);
  if (!parsed.success) throw Error("The BP week is unavailable.");
  return parsed.data;
}
