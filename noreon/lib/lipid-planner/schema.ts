import { z } from "zod";
import { planMedicineSchema, selfMedicineSchema } from "@/lib/member-medicines/model";
import { doctorLdlSchema, ldlObservationSchema } from "@/lib/ldl/schema";

/** Shape of doctor_lipid_planner_read (supabase/migrations/*_lipid_planner.sql). */
export const LIPID_PLANNER_READ_VERSION = "lipid-planner-v1";
const day = z.iso.date(), instant = z.iso.datetime({ offset: true });
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);

export const lipidPlannerReadSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal(LIPID_PLANNER_READ_VERSION), enabled: z.literal(false) }),
  z.object({
    version: z.literal(LIPID_PLANNER_READ_VERSION), enabled: z.literal(true), today: day,
    /** Events, therapy, goals and re-tests, as doctor_ldl_read returns them. Its observations are not used: `reviewedLdl` is. */
    record: doctorLdlSchema,
    /** LDL values a doctor reviewed or released. */
    reviewedLdl: z.array(ldlObservationSchema),
    /** ALT, CK and Lp(a) results a doctor reviewed or released. */
    reviewedLabs: z.array(z.object({ id: z.string(), test: z.enum(["alt", "ck", "lpa"]), value: num, unit: z.string(), on: day, name: z.string().nullable() })),
    /** 28 days of ticks: the member's own report, not proof. */
    medicines: z.object({ today: day, days: z.number().int(), now: instant, self: z.array(selfMedicineSchema), plan: z.array(planMedicineSchema) }),
    /** Open reports the member gave Zoe. */
    concerns: z.array(z.object({ kind: z.enum(["side_effect", "decided_to_stop"]), on: day, medicine: z.string() })),
  }),
]);
export type LipidPlannerRead = z.infer<typeof lipidPlannerReadSchema>;
export type LipidPlannerOn = Extract<LipidPlannerRead, { enabled: true }>;
