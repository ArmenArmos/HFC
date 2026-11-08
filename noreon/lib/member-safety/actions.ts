"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { decisionInput, type DecisionResult } from "./contract";

/** "Hide for today" on the chest-pain card. The database checks the hold is the member's own. */
export const hideChestPainCardToday = loggedAction("hideChestPainCardToday",async function hideChestPainCardToday(holdId: unknown): Promise<{ ok: boolean }> {
  const parsed = z.uuid().safeParse(holdId);
  if (!parsed.success) return { ok: false };
  try {
    const { data, error } = await (await createClient()).rpc("member_safety_hide_today", { p_hold: parsed.data });
    if (error) return { ok: false };
    const ok = (data as { ok?: boolean } | null)?.ok === true;
    if (ok) revalidatePath("/patient", "layout");
    return { ok };
  } catch {
    return { ok: false };
  }
});

/** Clear or keep a hold from the staff member file. Scope (assigned doctor or admin) is the database's. */
export const decideMemberSafetyHold = loggedAction("decideMemberSafetyHold",async function decideMemberSafetyHold(input: unknown): Promise<DecisionResult> {
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { client } = await requireRealStaff();
  try {
    const { data, error } = await client.rpc("staff_member_safety_decide", {
      p_hold: parsed.data.holdId,
      p_action: parsed.data.action,
      p_note: parsed.data.note || undefined,
    });
    if (error) {
      if (error.code === "42501") return { ok: false, reason: "access" };
      if (error.message === "An administrator must give a reason") return { ok: false, reason: "note_required" };
      if (error.code === "23514") return { ok: false, reason: "invalid" };
      return { ok: false, reason: "unavailable" };
    }
    const result = data as { ok?: boolean; result?: string; code?: string } | null;
    revalidatePath(`/staff/real/members/${parsed.data.memberId}`);
    if (result?.ok && (result.result === "cleared" || result.result === "kept")) return { ok: true, result: result.result };
    return { ok: false, reason: result?.code === "unavailable" ? "off" : result?.code === "not_open" ? "not_open" : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
});
