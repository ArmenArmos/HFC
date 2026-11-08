import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { realReviewEnabled } from "./real-review-config";

const teamSchema = z
  .object({ doctor: z.object({ name: z.string().min(1).max(160) }).nullable() })
  .nullable();

/**
 * The member's own assigned doctor, by display name only (patient_care_team).
 * null: no case yet or review requests are off. undefined: the read failed, so
 * the Home card is hidden rather than claiming nobody is assigned.
 */
export async function readMemberCareTeam(): Promise<
  { doctor: string | null } | null | undefined
> {
  if (!realReviewEnabled(process.env)) return null;
  try {
    const r = await (await createClient()).rpc("patient_care_team");
    if (r.error) return undefined;
    const parsed = teamSchema.safeParse(r.data);
    if (!parsed.success) return undefined;
    return parsed.data ? { doctor: parsed.data.doctor?.name ?? null } : null;
  } catch {
    return undefined;
  }
}
