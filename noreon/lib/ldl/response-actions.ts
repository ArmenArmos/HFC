"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { runLoopCommand, type LdlUserRpc } from "./response-runtime";
import type { LdlLoopResult } from "./response-schema";

/** Today: the assigned doctor marks an LDL result reviewed (the next step is decided and told). The database checks the assignment. */
export const closeLdlResponse = loggedAction("closeLdlResponse", async function closeLdlResponse(form: FormData): Promise<void> {
  const id = z.uuid().safeParse(form.get("responseId")), note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!id.success) return;
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor") return;
  const r = await runLoopCommand(client as unknown as LdlUserRpc, "doctor_ldl_response_close", { p_response: id.data, p_note: note || null });
  revalidatePath("/staff/real/today");
  redirect(`/staff/real/today?notice=${r.status === "saved" || r.status === "replayed" ? "ldl_reviewed" : "unavailable"}`);
});

/** Operations: an admin acknowledges an overdue or fenced LDL re-test after arranging it with the member. */
export const ackLdlRetest = loggedAction("ackLdlRetest", async function ackLdlRetest(form: FormData): Promise<void> {
  const id = z.uuid().safeParse(form.get("retestId")), note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!id.success) return;
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "admin") return;
  await runLoopCommand(client as unknown as LdlUserRpc, "admin_ldl_retest_ack", { p_retest: id.data, p_note: note || null });
  revalidatePath("/staff/real/operations");
});

const cancelSchema = z.strictObject({ memberId: z.uuid(), retestId: z.uuid() });
/** Member page: the assigned doctor decides no re-test is needed. */
export const cancelLdlRetest = loggedAction("cancelLdlRetest", async function cancelLdlRetest(input: unknown): Promise<LdlLoopResult> {
  const p = cancelSchema.safeParse(input);
  if (!p.success) return { status: "invalid" };
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor") return { status: "access" };
  const r = await runLoopCommand(client as unknown as LdlUserRpc, "doctor_ldl_retest_cancel", { p_member: p.data.memberId, p_retest: p.data.retestId });
  if (r.status === "saved") revalidatePath(`/staff/real/members/${p.data.memberId}`);
  return r;
});
