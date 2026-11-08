import "server-only";
import { createClient } from "@/lib/supabase/server";
import { memberMedicinesReadSchema, staffMedicinesReadSchema, type MemberMedicinesRead, type StaffMedicinesRead } from "./model";
import { doctorConcernsSchema, memberAsksReadSchema, staffReasonsSchema, type DoctorConcern, type MemberAsksRead, type StaffReason } from "./asks";

export type MedicinesRpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
const OFF: MemberMedicinesRead = { version: "member-medicines-v1", enabled: false };

/** Real members only; the database switch decides. Throws on an outage, for a caller that must not take it for "off". */
export async function loadMemberMedicines(): Promise<MemberMedicinesRead> {
  const client = await createClient();
  const { data, error } = await (client as unknown as MedicinesRpc).rpc("member_medicines_read");
  if (error) throw Error("Medicines are unavailable.");
  const parsed = memberMedicinesReadSchema.safeParse(data);
  if (!parsed.success) throw Error("Medicines are unavailable.");
  return parsed.data;
}

/** As loadMemberMedicines, but an outage reads as "off" so Home never breaks. */
export async function readMemberMedicines(): Promise<MemberMedicinesRead> {
  try {
    return await loadMemberMedicines();
  } catch {
    return OFF;
  }
}

/** Assigned nurse and doctor; the database decides scope. */
export async function readStaffMedicines(client: MedicinesRpc, memberId: string, days = 14): Promise<StaffMedicinesRead> {
  const { data, error } = await client.rpc("member_medicines_staff_read", { p_member: memberId, p_days: days });
  if (error) throw Object.assign(Error("Medicines are unavailable."), { code: error.code });
  const parsed = staffMedicinesReadSchema.safeParse(data);
  if (!parsed.success) throw Error("Medicines are unavailable.");
  return parsed.data;
}

const ASKS_OFF: MemberAsksRead = { version: "medicine-asks-v1", enabled: false };
/** Zoe's open medicine asks for the signed-in member. An outage reads as "none" so the page never breaks. */
export async function readMemberMedicineAsks(): Promise<MemberAsksRead> {
  try {
    const client = await createClient();
    const { data, error } = await (client as unknown as MedicinesRpc).rpc("member_medicine_asks_read");
    if (error) return ASKS_OFF;
    const parsed = memberAsksReadSchema.safeParse(data);
    return parsed.success ? parsed.data : ASKS_OFF;
  } catch {
    return ASKS_OFF;
  }
}

/** The assigned doctor's open medicine concerns; null when the list cannot be read (shown as unavailable). */
export async function readDoctorMedicineConcerns(client: MedicinesRpc): Promise<DoctorConcern[] | null> {
  try {
    const { data, error } = await client.rpc("doctor_medicine_concerns");
    if (error) return null;
    const parsed = doctorConcernsSchema.safeParse(data);
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}

/** Reasons the member gave, for the assigned nurse and doctor. Empty when off or unreadable: the counts still show. */
export async function readStaffMedicineReasons(client: MedicinesRpc, memberId: string, days = 14): Promise<StaffReason[]> {
  try {
    const { data, error } = await client.rpc("member_medicine_reasons_staff_read", { p_member: memberId, p_days: days });
    if (error) return [];
    const parsed = staffReasonsSchema.safeParse(data);
    return parsed.success && parsed.data.enabled ? parsed.data.reasons : [];
  } catch {
    return [];
  }
}
