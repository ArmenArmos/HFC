import { z } from "zod";
import { ASK_REASONS, type AskReason } from "./ask-copy";

/** Zoe's missed-dose ask (item 5). The database decides who is asked and when; these are the shapes it returns. */
const reason = z.enum(ASK_REASONS as [AskReason, ...AskReason[]]);
export const medicineAskSchema = z.object({
  id: z.uuid(),
  source: z.enum(["self", "plan"]),
  medicineId: z.uuid(),
  dueAt: z.string(),
  trigger: z.enum(["skipped", "missed"]),
  state: z.enum(["open", "answered", "withdrawn"]),
  reason: reason.nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
  medicine: z.object({ name: z.string(), dose: z.string().nullable() }),
  careTeamAsked: z.boolean(),
});
export const memberAsksReadSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("medicine-asks-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("medicine-asks-v1"), enabled: z.literal(true), asks: z.array(medicineAskSchema) }),
]);
export const doctorConcernSchema = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  memberName: z.string(),
  kind: z.enum(["side_effect", "decided_to_stop", "refill"]),
  createdAt: z.string(),
  ask: medicineAskSchema,
  ticks14: z.object({ taken: z.number().int(), skipped: z.number().int() }),
});
export const doctorConcernsSchema = z.object({ ok: z.literal(true), items: z.array(doctorConcernSchema) });
export const staffReasonSchema = z.object({
  source: z.enum(["self", "plan"]),
  medicineId: z.uuid(),
  dueAt: z.string(),
  trigger: z.enum(["skipped", "missed"]),
  reason,
  answeredAt: z.string(),
  concern: z.enum(["open", "handled"]).nullable(),
});
export const staffReasonsSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("medicine-asks-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("medicine-asks-v1"), enabled: z.literal(true), reasons: z.array(staffReasonSchema) }),
]);
export type MedicineAsk = z.infer<typeof medicineAskSchema>;
export type MemberAsksRead = z.infer<typeof memberAsksReadSchema>;
export type DoctorConcern = z.infer<typeof doctorConcernSchema>;
export type StaffReason = z.infer<typeof staffReasonSchema>;

/** Reasons per medicine for the adherence panel, newest first, keyed `${source}:${medicineId}`. */
export function reasonsByMedicine(reasons: StaffReason[]): Map<string, StaffReason[]> {
  const out = new Map<string, StaffReason[]>();
  for (const r of [...reasons].sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt))) {
    const key = `${r.source}:${r.medicineId}`;
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  return out;
}
