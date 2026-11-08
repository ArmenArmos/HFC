"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { runLdlEventAdd, runLdlEventRemove, runLdlGoalSet, runLdlTherapyAdd, runLdlTherapyEnd, type LdlRpc } from "./runtime";
import type { LdlCommandResult } from "./schema";

/** The assigned doctor records the LDL event, therapy and goal; the database checks the assignment and the switch. */
async function asDoctor(input: unknown, run: (c: LdlRpc, input: unknown) => Promise<LdlCommandResult>): Promise<LdlCommandResult> {
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor") return { status: "access" };
  const result = await run(client as unknown as LdlRpc, input);
  const id = (input as { memberId?: unknown } | null)?.memberId;
  if ((result.status === "saved" || result.status === "replayed") && typeof id === "string") revalidatePath(`/staff/real/members/${id}`);
  return result;
}
export const addLdlEvent = loggedAction("addLdlEvent", async function addLdlEvent(input: unknown) { return asDoctor(input, runLdlEventAdd); });
export const removeLdlEvent = loggedAction("removeLdlEvent", async function removeLdlEvent(input: unknown) { return asDoctor(input, runLdlEventRemove); });
export const addLdlTherapy = loggedAction("addLdlTherapy", async function addLdlTherapy(input: unknown) { return asDoctor(input, runLdlTherapyAdd); });
export const endLdlTherapy = loggedAction("endLdlTherapy", async function endLdlTherapy(input: unknown) { return asDoctor(input, runLdlTherapyEnd); });
export const setLdlGoal = loggedAction("setLdlGoal", async function setLdlGoal(input: unknown) { return asDoctor(input, runLdlGoalSet); });
