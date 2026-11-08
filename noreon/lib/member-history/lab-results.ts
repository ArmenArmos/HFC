import {memberStaffName} from "@/lib/member-staff-name.mjs";
import { z } from "zod";
import { matchAnalyte, normaliseUnit } from "@/lib/lab-ai/catalogue";

/**
 * A member's own results from their uploaded files (member_upload_results, 20261021070050). While the doctor's
 * approval is required (Armen, 20 Oct 2026), only approved values come back, with the doctor's interpretation;
 * a file still waiting says so and carries no values. With approval switched off, saved values come back
 * marked as not checked by a doctor.
 *
 * Display only: the range status uses the range printed on the member's own sheet, never a clinical threshold,
 * and feeds no rule.
 */
const uuid = z.uuid(), instant = z.iso.datetime({ offset: true }), day = z.iso.date();
const documentSchema = z.object({
  documentId: uuid, fileName: z.string(), resultDate: day.nullable(), state: z.enum(["approved", "waiting", "not_checked"]), approvedAt: instant.nullable(),
  doctorName: z.string().nullable().transform(memberStaffName), interpretation: z.object({ hy: z.string(), en: z.string() }).nullable(),
});
const valueSchema = z.object({
  valueId: uuid, documentId: uuid, testName: z.string(), catalogueRef: z.string().nullable(), valueText: z.string(), value: z.number().nullable(), unit: z.string().nullable(),
  refLow: z.number().nullable(), refHigh: z.number().nullable(), refText: z.string().nullable(), date: day.nullable(), checked: z.boolean(), doctorEdited: z.boolean(),
});
export const memberResultsSchema = z.union([
  z.object({ version: z.literal("member-upload-results-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("member-upload-results-v1"), enabled: z.literal(true), approvalRequired: z.boolean(), documents: z.array(documentSchema), values: z.array(valueSchema) }),
]);
export type MemberResults = Extract<z.infer<typeof memberResultsSchema>, { enabled: true }>;
export type MemberResultDocument = z.infer<typeof documentSchema>;
export type MemberResultValue = z.infer<typeof valueSchema>;

/**
 * Range status against the lab's printed range. "Borderline" is inside the range but within BORDERLINE_SHARE of
 * the range's width from a bound (for a one-sided range, of the bound itself). A conservative display default,
 * PENDING ARMEN (LEAD_DECISIONS 20 Oct): it is not a clinical cut and decides nothing.
 */
export const BORDERLINE_SHARE = 0.1;
export type RangeStatus = "in" | "borderline" | "out" | "none";
export function rangeStatus(v: { value: number | null; refLow: number | null; refHigh: number | null }): RangeStatus {
  const { value: x, refLow: lo, refHigh: hi } = v;
  if (x === null || (lo === null && hi === null) || (lo !== null && hi !== null && hi <= lo)) return "none";
  if ((lo !== null && x < lo) || (hi !== null && x > hi)) return "out";
  if (lo !== null && hi !== null) {
    const m = (hi - lo) * BORDERLINE_SHARE;
    return x < lo + m || x > hi - m ? "borderline" : "in";
  }
  if (hi !== null) return hi > 0 && x > hi * (1 - BORDERLINE_SHARE) ? "borderline" : "in";
  return lo! > 0 && x < lo! * (1 + BORDERLINE_SHARE) ? "borderline" : "in";
}

export type AnalytePoint = MemberResultValue & { status: RangeStatus; at: number | null };
export type Change = { direction: "up" | "down" | "same"; absolute: number; percent: number | null; from: AnalytePoint };
export type Analyte = {
  key: string; testName: string; catalogueRef: string | null; unit: string | null;
  /** Every point of this analyte, oldest first; `series` are those in the latest point's unit with a number and a date (the chart). */
  points: AnalytePoint[]; series: AnalytePoint[]; latest: AnalytePoint; change: Change | null;
};

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** Drops floating-point noise (0.004 - 0.001 = 0.0030000000000000005) without losing a lab's own precision (Astra R-02). */
const clean = (n: number) => Number(n.toPrecision(12));
/** A lab number as printed: every meaningful decimal (TSH 0.004 stays 0.004), one format for every locale (ICU data for
 * hy differs between Node and browsers). */
export const formatResult = (x: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 }).format(clean(x));

/**
 * Groups values by analyte (catalogue key, else the printed name), newest last. The change compares the latest
 * point with the one before it, only in the same unit and only when both have a number and a date.
 */
export function analytes(values: MemberResultValue[]): Analyte[] {
  const groups = new Map<string, AnalytePoint[]>();
  for (const v of values) {
    const key = v.catalogueRef ?? matchAnalyte(v.testName) ?? `printed:${fold(v.testName)}`;
    const p: AnalytePoint = { ...v, status: rangeStatus(v), at: v.date ? Date.parse(`${v.date}T00:00:00Z`) : null };
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: Analyte[] = [];
  for (const [key, ps] of groups) {
    ps.sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
    const latest = ps.at(-1)!;
    const unit = normaliseUnit(latest.unit);
    const series = ps.filter((p) => p.value !== null && p.at !== null && normaliseUnit(p.unit) === unit);
    const last = series.at(-1), prev = series.at(-2);
    let change: Change | null = null;
    if (last === latest && prev && prev.at !== last.at) {
      // Direction and percent from the unrounded difference; only the display is rounded (Astra R-02).
      const absolute = clean(last.value! - prev.value!);
      change = { direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "same", absolute, percent: prev.value !== 0 ? Math.round((absolute / Math.abs(prev.value!)) * 100) : null, from: prev };
    }
    out.push({ key, testName: latest.testName, catalogueRef: latest.catalogueRef, unit: latest.unit, points: ps, series, latest, change });
  }
  // Out of range first, then borderline, then the rest; newest first within each.
  const rank: Record<RangeStatus, number> = { out: 0, borderline: 1, in: 2, none: 3 };
  return out.sort((a, b) => rank[a.latest.status] - rank[b.latest.status] || (b.latest.at ?? 0) - (a.latest.at ?? 0) || a.testName.localeCompare(b.testName));
}

/** "+0.4 (+8%)" with a real minus sign. */
export function changeText(c: Change): string {
  const n = (x: number, d: number) => (d ? formatResult(Math.abs(x)) : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.abs(x)));
  const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "");
  return `${sign(c.absolute)}${n(c.absolute, 2)}${c.percent === null ? "" : ` (${sign(c.percent)}${n(c.percent, 0)}%)`}`;
}
