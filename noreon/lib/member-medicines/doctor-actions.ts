"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";

/** The assigned doctor marks a medicine concern handled after answering the member. The database checks the assignment. */
export const handleMedicineConcern = loggedAction("handleMedicineConcern", async function handleMedicineConcern(form: FormData): Promise<void> {
  const id = form.get("concernId");
  if (!z.uuid().safeParse(id).success) return;
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor") return;
  await client.rpc("doctor_medicine_concern_handle", { p_id: id as string });
  revalidatePath("/staff/real/today");
});
