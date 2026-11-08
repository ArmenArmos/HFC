import "server-only";
import { staffSafetySchema, type StaffSafety } from "./contract";

type Rpc = { rpc: (fn: "staff_member_safety", args: { p_member: string }) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** Null when unreadable; "refused" when the database says this staff member has no access. */
export async function readStaffMemberSafety(client: Rpc, memberId: string): Promise<StaffSafety | "refused" | null> {
  try {
    const { data, error } = await client.rpc("staff_member_safety", { p_member: memberId });
    if (error) return error.code === "42501" ? "refused" : null;
    const parsed = staffSafetySchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
