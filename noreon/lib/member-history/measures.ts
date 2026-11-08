import type { Locale } from "@/lib/locale";
import { z } from "zod";
import { fieldById } from "@/lib/clinical/seed/questions";

/** Member-reported values: display data only. Nothing here feeds a clinical rule or THRESHOLD.
 * Bounds mirror the database check in 20261017155812_member_reported_history.sql; the
 * questionnaire supplies them where it has one (BP, weight, waist, HbA1c). */
export const measureIds = ["bp", "total_cholesterol", "ldl_c", "hba1c", "fasting_glucose", "weight", "waist"] as const;
export type MeasureId = (typeof measureIds)[number];
export type Bounds = { min: number; max: number };
type Unit = { unit: string; bounds: Bounds; decimals: number; toChart: number };
export type Measure = Record<Locale, string> & { id: MeasureId; units: Unit[]; chartUnit: string };

function questionBounds(id: string, fallback: Bounds): Bounds {
  const field = fieldById(id) as { min?: number; max?: number } | undefined;
  return typeof field?.min === "number" && typeof field?.max === "number" ? { min: field.min, max: field.max } : fallback;
}
// mg/dL to mmol/L: cholesterol divides by 38.67, glucose by 18.016.
export const measures: Record<MeasureId, Measure> = {
  bp: { id: "bp", en: "Blood pressure", hy: "Զարկերակային ճնշում", ru: "Артериальное давление", chartUnit: "mmHg", units: [{ unit: "mmHg", bounds: { min: 60, max: 300 }, decimals: 0, toChart: 1 }] },
  total_cholesterol: { id: "total_cholesterol", en: "Total cholesterol", hy: "Ընդհանուր խոլեստերին", ru: "Общий холестерин", chartUnit: "mmol/L", units: [{ unit: "mmol/L", bounds: { min: 1, max: 20 }, decimals: 2, toChart: 1 }, { unit: "mg/dL", bounds: { min: 40, max: 775 }, decimals: 0, toChart: 1 / 38.67 }] },
  ldl_c: { id: "ldl_c", en: "LDL cholesterol", hy: "ՑԽԼ խոլեստերին (LDL)", ru: "Холестерин ЛПНП (LDL)", chartUnit: "mmol/L", units: [{ unit: "mmol/L", bounds: { min: 0.2, max: 15 }, decimals: 2, toChart: 1 }, { unit: "mg/dL", bounds: { min: 8, max: 580 }, decimals: 0, toChart: 1 / 38.67 }] },
  hba1c: { id: "hba1c", en: "HbA1c", hy: "Գլիկացված հեմոգլոբին (HbA1c)", ru: "Гликированный гемоглобин (HbA1c)", chartUnit: "%", units: [{ unit: "%", bounds: questionBounds("q6.hba1c", { min: 3, max: 20 }), decimals: 1, toChart: 1 }] },
  fasting_glucose: { id: "fasting_glucose", en: "Fasting glucose", hy: "Գլյուկոզ քաղցած վիճակում", ru: "Глюкоза натощак", chartUnit: "mmol/L", units: [{ unit: "mmol/L", bounds: { min: 1.5, max: 35 }, decimals: 1, toChart: 1 }, { unit: "mg/dL", bounds: { min: 27, max: 630 }, decimals: 0, toChart: 1 / 18.016 }] },
  weight: { id: "weight", en: "Weight", hy: "Քաշ", ru: "Вес", chartUnit: "kg", units: [{ unit: "kg", bounds: questionBounds("q2.weight", { min: 30, max: 300 }), decimals: 1, toChart: 1 }] },
  waist: { id: "waist", en: "Waist", hy: "Գոտկատեղի շրջագիծ", ru: "Окружность талии", chartUnit: "cm", units: [{ unit: "cm", bounds: questionBounds("q2.waist", { min: 40, max: 200 }), decimals: 1, toChart: 1 }] },
};
export const diastolicBounds: Bounds = { min: 30, max: 200 };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s);
export function yerevanToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const decimalsOf = (n: number) => (String(n).split(".")[1] ?? "").length;

export const valueInputSchema = z
  .strictObject({ measure: z.enum(measureIds), value: z.number().finite(), value2: z.number().finite().nullable(), unit: z.string().max(10), measuredOn: isoDate })
  .superRefine((v, ctx) => {
    const unit = measures[v.measure].units.find((u) => u.unit === v.unit);
    if (!unit) return ctx.addIssue({ code: "custom", path: ["unit"], message: "unit" });
    if (v.value < unit.bounds.min || v.value > unit.bounds.max || decimalsOf(v.value) > unit.decimals) ctx.addIssue({ code: "custom", path: ["value"], message: "value" });
    if (v.measure === "bp") {
      if (v.value2 === null || !Number.isInteger(v.value2) || v.value2 < diastolicBounds.min || v.value2 > diastolicBounds.max || v.value2 >= v.value) ctx.addIssue({ code: "custom", path: ["value2"], message: "value2" });
    } else if (v.value2 !== null) ctx.addIssue({ code: "custom", path: ["value2"], message: "value2" });
    if (v.measuredOn < "1950-01-01" || v.measuredOn > yerevanToday()) ctx.addIssue({ code: "custom", path: ["measuredOn"], message: "measuredOn" });
    // Armen's 2 Nov list, task 5: history is for past values. A reading from today goes through the reading form, where the safety check runs.
    if (v.measure === "bp" && v.measuredOn === yerevanToday()) ctx.addIssue({ code: "custom", path: ["measuredOn"], message: "measuredOn" });
  });
export type ValueInput = z.infer<typeof valueInputSchema>;

/** source: typed by the member; or read from their file by AI (ai_read: not confirmed by them; member_corrected; ai_confirmed: the #278 flow; doctor_approved: checked by the assigned doctor, 20261021070050). Not measured by the clinic. */
export type ReportedValue = { id: string; source?: "member-reported" | "ai_confirmed" | "ai_read" | "member_corrected" | "doctor_approved"; measure: MeasureId; value: number; value2: number | null; unit: string; measuredOn: string };
export type ReportedDocument = { id: string; fileName: string; mime: string; sizeBytes: number; resultDate: string | null; createdAt: string };
export type ClinicMeasurements = { bp: { id: string; systolic: number; diastolic: number; at: string }[]; observations: { field: "weight" | "waist"; value: number; unit: string; at: string }[] };

/** One chart point. `source` decides how it is drawn; values are never merged across sources. `checked`: from the
 * member's file, approved by their doctor (20261021070050). */
export type ChartPoint = { at: number; source: "member" | "clinic" | "checked"; value: number; value2?: number };
export function chartValue(measure: MeasureId, value: number, unit: string) {
  const u = measures[measure].units.find((x) => x.unit === unit);
  return u ? Math.round(value * u.toChart * 100) / 100 : null;
}
const dayStamp = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
export function chartSeries(values: ReportedValue[], clinic: ClinicMeasurements, homeBp: { id: string; systolic: number; diastolic: number; measuredAt: string }[]) {
  const series = Object.fromEntries(measureIds.map((id) => [id, [] as ChartPoint[]])) as Record<MeasureId, ChartPoint[]>;
  for (const v of values) {
    const value = chartValue(v.measure, v.value, v.unit);
    if (value === null) continue;
    series[v.measure].push({ at: dayStamp(v.measuredOn), source: v.source === "doctor_approved" ? "checked" : "member", value, ...(v.measure === "bp" && v.value2 !== null ? { value2: v.value2 } : {}) });
  }
  const clinicIds = new Set(clinic.bp.map((b) => b.id));
  for (const b of homeBp) if (!clinicIds.has(b.id)) series.bp.push({ at: Date.parse(b.measuredAt), source: "member", value: b.systolic, value2: b.diastolic });
  for (const b of clinic.bp) series.bp.push({ at: Date.parse(b.at), source: "clinic", value: b.systolic, value2: b.diastolic });
  for (const o of clinic.observations) if ((o.field === "weight" && o.unit === "kg") || (o.field === "waist" && o.unit === "cm")) series[o.field].push({ at: Date.parse(o.at), source: "clinic", value: o.value });
  for (const id of measureIds) series[id].sort((a, b) => a.at - b.at || (a.source === b.source ? 0 : a.source === "clinic" ? 1 : -1));
  return series;
}

/** Upload limits: the Vercel Function body cap is 4.5 MB, so the product limit is 4 MB, as for clinic PDFs. */
export const MEMBER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const memberUploadMimes = ["application/pdf", "image/jpeg", "image/png"] as const;
export function sniffMime(bytes: Uint8Array): (typeof memberUploadMimes)[number] | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}
export function cleanFileName(name: string, mime: string) {
  const base = name.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 150) || "document";
  const ext = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
  return base.toLowerCase().endsWith(ext) ? base : `${base.replace(/\.[a-z0-9]{1,5}$/i, "")}${ext}`;
}
