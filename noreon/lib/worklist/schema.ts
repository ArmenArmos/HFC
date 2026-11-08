import { z } from "zod";
import { RISK_TIERS, RISK_TIER_RULES } from "@/lib/clinical/rules/risk-tier";

/** care_team_worklist (20261108080830_risk_tiers_worklist.sql). Coordinator and admin items carry no clinical counts or values. */
const tier = z.enum(RISK_TIERS).nullable();
const reason = z.string().regex(/^[a-z0-9_.]{1,60}$/);
const base = { memberId: z.uuid(), name: z.string().nullable(), rank: z.number().int().min(1), tier, reasons: z.array(reason), taskKinds: z.array(z.string()) };
export const clinicalItemSchema = z.object({
  ...base, score: z.union([z.number(), z.string().transform(Number)]).nullable(),
  urgent: z.number().int(), overdue: z.number().int(), aboveTargetStreak: z.number().int(), daysSinceContact: z.number().int().nullable(),
});
export const logisticsItemSchema = z.object(base);
export const worklistSchema = z.discriminatedUnion("role", [
  z.object({ ok: z.literal(true), version: z.literal("care-team-worklist-v1"), role: z.enum(["coordinator", "admin"]), asOf: z.string(), items: z.array(logisticsItemSchema) }),
  z.object({ ok: z.literal(true), version: z.literal("care-team-worklist-v1"), role: z.enum(["nurse", "doctor"]), asOf: z.string(), items: z.array(clinicalItemSchema) }),
]);
export type Worklist = z.infer<typeof worklistSchema>;
export type WorklistItem = z.infer<typeof clinicalItemSchema> | z.infer<typeof logisticsItemSchema>;
export type WorklistRead = { kind: "ready"; list: Worklist } | { kind: "off" } | { kind: "access" } | { kind: "unavailable" };
export const isRiskReason = (r: string): r is (typeof RISK_TIER_RULES)[number] => (RISK_TIER_RULES as readonly string[]).includes(r);
/** How many rows the chat card shows; the read asks for this many. */
export const WORKLIST_CARD_LIMIT = 8;
