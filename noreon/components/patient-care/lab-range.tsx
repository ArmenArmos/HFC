import type { CareResult } from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { labRange } from "@/lib/patient-care/journey-evidence";
import {ReferenceFlag} from "./result-row";
import { copy } from "./common";
export function LabRange({
  result: r,
  locale: l,
}: {
  result: CareResult;
  locale: PatientLocale;
}) {
  const range = labRange(r);
  const printedReference = r.referenceText?.trim();
  return (
    <div className="space-y-2">
      <p className="text-caption text-muted-foreground">
        {copy(l, "Laboratory range", "Լաբորատոր միջակայք", "Лабораторный диапазон")}:{" "}
        {printedReference || (range.status === "unknown"
          ? copy(l, "Not reported", "Տրամադրված չէ", "Не указано")
          : `${r.referenceLow ?? "…"} – ${r.referenceHigh ?? "…"} ${r.unit}`)}
      </p>
      {printedReference && range.status === "unknown" && <p className="text-caption text-muted-foreground">{copy(l,"Numeric comparison is unavailable for this printed reference.","Այս տպված հղման համար թվային համեմատությունը հասանելի չէ։", "Числовое сравнение с указанным референсным диапазоном недоступно.")}</p>}
      {range.position !== null && (
        <div
          role="img"
          aria-label={copy(
            l,
            "Position within the printed lab interval",
            "Դիրքը լաբորատոր միջակայքում",
            "Положение в указанном лабораторном диапазоне",
          )}
          className="relative h-3 rounded-full bg-muted"
        >
          <span className="absolute inset-y-0 left-1/4 w-1/2 bg-surface-subtle-teal" />
          <span
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brand-navy"
            style={{ left: `${range.position}%` }}
          />
        </div>
      )}
      <ReferenceFlag status={range.status} locale={l}/>
    </div>
  );
}
