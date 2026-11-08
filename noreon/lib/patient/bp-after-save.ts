import { z } from "zod";
import { bpCheckReadings, bpVeryHigh, type BpNumbers, type BpStep } from "@/lib/clinical/rules/bp-check";

/** How old a saved reading can be and still count as today's: the window of the stored-reading rules. */
const CURRENT_HOURS = 24;
const recent = z.array(z.object({ systolic: z.number().int(), diastolic: z.number().int(), measuredAt: z.string() }));
export type BpRead = (name: "member_bp_recent", args: { p_member: string | null }) => Promise<unknown>;

/**
 * The one BP check after a reading is saved by the form, the BP week or a card, in the app or on Telegram. A back-dated
 * entry is history, not a reading now. If the earlier readings cannot be read the member is still told to rest and repeat.
 */
export async function bpStepAfterSave(read: BpRead, member: string | null, r: BpNumbers & { measuredAt: string }, now = new Date()): Promise<BpStep> {
  const at = Date.parse(r.measuredAt);
  if (!bpVeryHigh(r) || !Number.isFinite(at) || now.getTime() - at > CURRENT_HOURS * 3600000) return "routine";
  const rows = recent.safeParse(await read("member_bp_recent", { p_member: member }).catch(() => null));
  if (!rows.success) return "remeasure";
  return bpCheckReadings(r, rows.data.map(x => ({ systolic: x.systolic, diastolic: x.diastolic, minutesAgo: (at - Date.parse(x.measuredAt)) / 60000 })));
}
