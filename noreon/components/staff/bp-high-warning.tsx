import { bpVeryHigh } from "@/lib/clinical/rules/bp-check";
import { BP_STAFF_WARNING } from "@/lib/clinical/rules/bp-words";
import { pick, type Locale } from "@/lib/locale";

/** The one BP check on a staff entry screen: as soon as the numbers are in the very high range. Shows nothing otherwise. */
export function BpHighWarning({ systolic, diastolic, locale }: { systolic: unknown; diastolic: unknown; locale: Locale }) {
  const s = Number(systolic), d = Number(diastolic);
  if (!Number.isInteger(s) || !Number.isInteger(d) || s <= d || !bpVeryHigh({ systolic: s, diastolic: d })) return null;
  return <p role="alert" data-bp-high-warning className="rounded-lg bg-destructive/10 p-3 text-body2 text-destructive">{pick(locale, BP_STAFF_WARNING)}</p>;
}
