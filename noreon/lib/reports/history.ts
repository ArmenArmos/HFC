import type { Locale } from "@/lib/locale";
import { extractionSchema, validateReview } from "@/lib/reports/schema";
import type { ReportRecord } from "@/lib/reports/demo";
export type HistoryPoint = {
  id: string;
  marker: string;
  unit: string;
  value: number;
  date: string;
  reference: string | null;
  range: [number, number] | null;
  sources: Array<{
    id: string;
    file: string;
    laboratory: string | null;
    row: number;
  }>;
};
const aliases: Record<string, string> = {
  glucose: "Glucose",
  գլյուկոզա: "Glucose",
  hba1c: "HbA1c",
  "glycated hemoglobin": "HbA1c",
  "գլիկացված հեմոգլոբին": "HbA1c",
  cholesterol: "Total cholesterol",
  "total cholesterol": "Total cholesterol",
  խոլեստերին: "Total cholesterol",
  "ընդհանուր խոլեստերին": "Total cholesterol",
  ldl: "LDL cholesterol",
  "ldl-c": "LDL cholesterol",
  "ldl cholesterol": "LDL cholesterol",
  "low-density lipoprotein": "LDL cholesterol",
  hdl: "HDL cholesterol",
  "hdl-c": "HDL cholesterol",
  "hdl cholesterol": "HDL cholesterol",
  "high-density lipoprotein": "HDL cholesterol",
  triglycerides: "Triglycerides",
  տրիգլիցերիդներ: "Triglycerides",
  creatinine: "Creatinine",
  կրեատինին: "Creatinine",
  hemoglobin: "Hemoglobin",
  haemoglobin: "Hemoglobin",
  հեմոգլոբին: "Hemoglobin",
  magnesium: "Magnesium",
  մագնեզիում: "Magnesium",
};
const units: Record<string, string[]> = {
  Glucose: ["mmol/l", "mg/dl"],
  HbA1c: ["%", "mmol/mol"],
  "Total cholesterol": ["mmol/l", "mg/dl"],
  "LDL cholesterol": ["mmol/l", "mg/dl"],
  "HDL cholesterol": ["mmol/l", "mg/dl"],
  Triglycerides: ["mmol/l", "mg/dl"],
  Creatinine: ["µmol/l", "mg/dl"],
  Hemoglobin: ["g/l", "g/dl"],
  Magnesium: ["mmol/l", "mg/dl"],
};
export function canonicalMarker(name: string) {
  if (/urine|urinary|մեզի|մեզում/i.test(name)) return null;
  const matches = [
    ...new Set(
      name
        .split("/")
        .map((s) => aliases[s.trim().toLowerCase()])
        .filter(Boolean),
    ),
  ];
  return matches.length === 1 ? matches[0] : null;
}
export function simpleRange(reference: string | null): [number, number] | null {
  const m = reference
    ?.trim()
    .match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const low = Number(m[1].replace(",", ".")),
    high = Number(m[2].replace(",", "."));
  return low < high ? [low, high] : null;
}
/** No conversions, inferred dates, inferred risk targets or model-generated aliases. */
export function historicalPoints(reports: ReportRecord[], locale: Locale = "en") {
  const t = (en: string, hy: string, ru: string) => locale === "ru" ? ru : locale === "hy" ? hy : en;
  const points = new Map<string, HistoryPoint>();
  const unplotted: { file: string; row?: number; test?: string; reason: string }[] = [];
  let skipped = 0,
    duplicates = 0;
  for (const report of reports) {
    const parsed = extractionSchema.safeParse(report.reviewed);
    if (!parsed.success) {
      unplotted.push({ file: report.file_name, reason: t("Report needs source checking", "Փաստաթուղթը պետք է ստուգել բնօրինակի հետ", "Документ нужно сверить с оригиналом") });
      skipped++;
      continue;
    }
    let extraction;
    try {
      extraction = validateReview(parsed.data);
    } catch {
      for (const [index, row] of parsed.data.rows.entries()) unplotted.push({ file: report.file_name, row: index + 1, test: row.name, reason: t("Report data needs checking", "Փաստաթղթի տվյալները պետք է ստուգել", "Данные документа требуют проверки") });
      skipped += parsed.data.rows.length;
      continue;
    }
    if (
      !extraction.reportDate ||
      /urine|urinalysis|մեզի|մեզում/i.test(
        `${report.file_name} ${extraction.summary}`,
      )
    ) {
      for (const [index, row] of extraction.rows.entries()) unplotted.push({ file: report.file_name, row: index + 1, test: row.name, reason: !extraction.reportDate ? t("Report date is missing", "Փաստաթղթի ամսաթիվը բացակայում է", "Дата документа отсутствует") : t("Sample context not supported in charts", "Նմուշի տեսակը չի աջակցվում գծապատկերներում", "Этот тип образца не поддерживается на графиках") });
      skipped += extraction.rows.length;
      continue;
    }
    extraction.rows.forEach((row, index) => {
      const marker = canonicalMarker(row.name),
        unit = row.unit?.trim().replace(/μ/g, "µ").toLowerCase();
      if (
        !marker ||
        !unit ||
        !units[marker]?.includes(unit) ||
        row.uncertain ||
        !/^\d+(?:[.,]\d+)?$/.test(row.literal.trim())
      ) {
        const reason = row.uncertain ? t("Value needs source checking", "Արժեքը պետք է ստուգել բնօրինակի հետ", "Значение нужно сверить с оригиналом") : !marker ? t("Test not supported in charts", "Հետազոտությունը չի աջակցվում գծապատկերներում", "Анализ не поддерживается на графиках") : !unit ? t("Unit is missing", "Միավորը բացակայում է", "Единица измерения отсутствует") : !units[marker]?.includes(unit) ? t("Unit not supported in charts", "Միավորը չի աջակցվում գծապատկերներում", "Единица измерения не поддерживается на графиках") : t("Result is not a numerical value", "Արդյունքը թվային արժեք չէ", "Результат не является числовым значением");
        unplotted.push({ file: report.file_name, row: index + 1, test: row.name, reason });
        skipped++;
        return;
      }
      const value = Number(row.literal.trim().replace(",", "."));
      if (!Number.isFinite(value)) {
        unplotted.push({ file: report.file_name, row: index + 1, test: row.name, reason: t("Result is not a numerical value", "Արդյունքը թվային արժեք չէ", "Результат не является числовым значением") });
        skipped++;
        return;
      }
      // Coincident identical results render once, preserving every source for inspection.
      const key = JSON.stringify([
        marker,
        unit,
        extraction.reportDate,
        value,
        row.reference?.trim() ?? null,
      ]);
      const source = {
        id: report.id,
        file: report.file_name,
        laboratory: extraction.laboratory,
        row: index + 1,
      };
      const prior = points.get(key);
      if (prior) {
        prior.sources.push(source);
        duplicates++;
        return;
      }
      points.set(key, {
        id: key,
        marker,
        unit: unit.replace("/l", "/L").replace("/dl", "/dL"),
        value,
        date: extraction.reportDate!,
        reference: row.reference,
        range: simpleRange(row.reference),
        sources: [source],
      });
    });
  }
  return {
    points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)),
    skipped,
    unplotted,
    duplicates,
  };
}
