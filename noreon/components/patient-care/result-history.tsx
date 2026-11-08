import {memberDoctorLabel,memberStaffName} from "@/lib/member-staff-name.mjs";
import { ResultRow } from "./result-row";
import {labRange} from "@/lib/patient-care/journey-evidence";
import { ChevronDown, FileText, ShieldCheck } from "lucide-react";
import { resultGroups } from "@/lib/patient-care/model";
import type { CareResult } from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy, stamp } from "./common";

export function ResultHistory({
  results,
  locale: l,
}: {
  results: CareResult[];
  locale: PatientLocale;
}) {
  const groups = resultGroups(results);
  const noteKey = (r: CareResult) => JSON.stringify([r.reviewedAt, r.reviewedBy, r.explanation]);
  const notes = new Map<string, { result: CareResult; markers: string[] }>();
  for (const group of groups) {
    const latest = group[group.length - 1];
    if (!latest.reviewedAt || !latest.explanation) continue;
    const key = noteKey(latest), existing = notes.get(key);
    const marker = `${latest.marker}${latest.unit ? ` (${latest.unit})` : ""}`;
    if (existing) existing.markers.push(marker);
    else notes.set(key, { result: latest, markers: [marker] });
  }
  return (
    <div className="space-y-4">
      {[...notes.entries()].filter(([, note]) => note.markers.length > 1).map(([key, {result, markers}]) => <section key={key} className="space-y-2 rounded-lg bg-muted p-4">
        <h3 className="text-body2 font-semibold">{copy(l, "Doctor’s notes", "Բժշկի նշումները", "Заметки врача")}</h3>
        <p className="text-caption text-muted-foreground">{copy(l, "For", "Վերաբերում է", "Относится к")}: {markers.join(" · ")}</p>
        <p className="whitespace-pre-wrap break-words text-body2">{result.explanation}</p>
        <p className="text-caption text-muted-foreground">{copy(l, "Reviewed by", "Վերանայել է", "Проверил(а)")}: {memberStaffName(result.reviewedBy) ?? copy(l,"your doctor","ձեր բժիշկը","ваш врач")} · {stamp(result.reviewedAt!, l)}</p>
      </section>)}
      <div className="divide-y">{groups.map((group) => {
        const rows = [...group].reverse();
        const latest = rows[0];
        return (
          <div
            key={JSON.stringify([latest.marker, latest.unit])}
            className="py-4 first:pt-0"
          >
            <div className="space-y-2">
                <ResultRow name={latest.marker} value={String(latest.value)} unit={latest.unit} reference={latest.referenceText || (latest.referenceLow === null && latest.referenceHigh === null ? null : `${latest.referenceLow ?? "…"} – ${latest.referenceHigh ?? "…"} ${latest.unit}`)} status={labRange(latest).status} locale={l}/>
                <p className="text-caption text-muted-foreground">{stamp(latest.collectedAt,l,false)}</p>
                <div className="flex items-start gap-1.5 text-caption text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <p>{latest.reviewedAt ? <>{copy(l, "Review published", "Վերանայումը հրապարակված է", "Проверка опубликована")} · {stamp(latest.reviewedAt, l, false)} · {latest.reviewedBy ? memberDoctorLabel(latest.reviewedBy,l) : copy(l,"Reviewer not recorded","Վերանայողը գրանցված չէ", "Проверивший специалист не указан")}</> : copy(l, "Review pending", "Սպասում է վերանայման", "Ожидает проверки")}</p>
                </div>
            </div>

            {latest.reviewedAt && latest.explanation && notes.get(noteKey(latest))?.markers.length === 1 && <section className="mt-4 space-y-2 rounded-lg bg-muted p-4">
              <h4 className="text-body2 font-semibold">{copy(l, "Doctor’s notes", "Բժշկի նշումները", "Заметки врача")}</h4>
              <p className="whitespace-pre-wrap break-words text-body2">{latest.explanation}</p>
              <p className="text-caption text-muted-foreground">{copy(l, "Reviewed by", "Վերանայել է", "Проверил(а)")}: {memberStaffName(latest.reviewedBy) ?? copy(l,"your doctor","ձեր բժիշկը","ваш врач")} · {stamp(latest.reviewedAt, l)}</p>
            </section>}
          </div>
        );
      })}</div>
      <details className="group border-t pt-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{copy(l,"Source and history","Աղբյուր և պատմություն", "Источник и история")}{` · ${results.length}`}</span>
                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="mt-5 space-y-5 border-t pt-5">
                {groups.map(group => {
                  const rows = [...group].reverse(), latest = rows[0];
                  return <section key={JSON.stringify([latest.marker,latest.unit])} className="space-y-4">
                    <h3 className="text-body2 font-semibold">{latest.marker}{latest.unit ? ` (${latest.unit})` : ""}</h3>
                    {rows.map((r) => (
                  <article
                    key={r.id}
                    className="space-y-3 border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h4 className="text-body2 font-semibold">
                        {stamp(r.collectedAt, l)}
                      </h4>
                      <p className="text-body1 font-semibold tabular-nums">
                        {r.value} {r.unit}
                      </p>
                    </div>
                    <p className="text-caption">
                      {copy(l, "Source", "Աղբյուր", "Источник")}: {r.sourceLabel}
                    </p>
                    <p className="text-caption">
                      {copy(l, "Lab reference", "Լաբորատոր հղում", "Референсный диапазон лаборатории")}:{" "}
                      {r.referenceText?.trim() || (r.referenceLow === null && r.referenceHigh === null
                        ? copy(l, "Not supplied", "Տրամադրված չէ", "Не предоставлено")
                        : `${r.referenceLow ?? "…"} – ${r.referenceHigh ?? "…"} ${r.unit}`)}
                    </p>
                    {r.reviewedAt ? (
                      <div className="space-y-2 border-t pt-3">
                        {r.id !== latest.id && r.explanation && (
                          <p className="whitespace-pre-wrap text-body2">
                            {r.explanation}
                          </p>
                        )}
                        <p className="text-caption text-muted-foreground">
                          {copy(l, "Reviewed by", "Վերանայել է", "Проверил(а)")}:{" "}
                          {memberStaffName(r.reviewedBy) ?? copy(l,"your doctor","ձեր բժիշկը","ваш врач")} · {stamp(r.reviewedAt, l)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        {copy(
                          l,
                          "No clinician review published for this result yet.",
                          "Այս արդյունքի բժշկական վերանայումը դեռ հրապարակված չէ։",
                          "Проверка этого результата врачом ещё не опубликована.",
                        )}
                      </p>
                    )}
                  </article>
                ))}</section>;
                })}
              </div>
            </details>
    </div>
  );
}
