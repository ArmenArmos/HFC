import "server-only";
import { createClient } from "@/lib/supabase/server";
import { memberSafetyStatusSchema, memberSafetyView, type MemberSafetyView } from "./contract";

/**
 * The signed-in member's safety holds. The demo has none. A failed or malformed read is
 * `unknown`: no card is claimed and exercise suggestions are withheld (see exerciseGuidance).
 */
export async function readMemberSafety(): Promise<MemberSafetyView> {
  try {
    const { data, error } = await (await createClient()).rpc("member_safety_status");
    if (error) return memberSafetyView(null);
    const parsed = memberSafetyStatusSchema.safeParse(data);
    return memberSafetyView(parsed.success ? parsed.data : null);
  } catch {
    return memberSafetyView(null);
  }
}
