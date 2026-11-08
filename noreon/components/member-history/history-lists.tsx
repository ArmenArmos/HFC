"use client";
import { FILE_LINK } from "@/lib/patient/file-link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { measures, type MeasureId, type ReportedDocument, type ReportedValue } from "@/lib/member-history/measures";

const measureNamesRu: Record<MeasureId, string> = {
  bp: "Артериальное давление",
  total_cholesterol: "Общий холестерин",
  ldl_c: "Холестерин ЛПНП (LDL)",
  hba1c: "Гликированный гемоглобин (HbA1c)",
  fasting_glucose: "Глюкоза натощак",
  weight: "Вес",
  waist: "Окружность талии",
};

export const fromYouLabel = (l: PatientLocale) => copy(l, "From you, not verified", "Ձեզնից, չստուգված", "Добавлено вами, не проверено");
export const fromYourFileLabel = (l: PatientLocale) => copy(l, "From your file, read by AI, checked by you", "Ձեր ֆայլից, կարդացել է AI-ը, ստուգել եք դուք", "Из вашего файла, распознано ИИ, проверено вами");
const sourceLabel = (source: ReportedValue["source"], l: PatientLocale) =>
  source === "ai_read" ? copy(l, "From your file, read by AI, not confirmed by you", "Ձեր ֆայլից, կարդացել է AI-ը, դուք չեք հաստատել", "Из вашего файла, распознано ИИ, не подтверждено вами")
  : source === "member_corrected" ? copy(l, "From your file, corrected by you", "Ձեր ֆայլից, ուղղել եք դուք", "Из вашего файла, исправлено вами")
  : source === "doctor_approved" ? copy(l, "From your file, checked by your doctor", "Ձեր ֆայլից, ստուգել է ձեր բժիշկը", "Из вашего файла, проверено вашим врачом")
  : source === "ai_confirmed" ? fromYourFileLabel(l) : fromYouLabel(l);
export function FromYouBadge({ locale }: { locale: PatientLocale }) {
  return <span className="inline-flex rounded-md bg-muted px-2 py-1 text-caption text-muted-foreground">{fromYouLabel(locale)}</span>;
}
export const dayLabel = (iso: string, l: PatientLocale) => formatMemberDate(new Date(`${iso.slice(0, 10)}T12:00:00Z`), l, { timeZone: "UTC", dateStyle: "medium" });
export const valueText = (v: Pick<ReportedValue, "measure" | "value" | "value2" | "unit">) => `${v.measure === "bp" ? `${v.value}/${v.value2}` : v.value} ${v.unit}`;

function useRemove(action?: (id: string) => Promise<boolean>) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function remove(id: string) {
    if(!action)return;
    setBusy(id);
    setFailed(false);
    const ok = await action(id).catch(() => false);
    setBusy(null);
    if (ok) router.refresh();
    else setFailed(true);
  }
  return { busy, failed, remove };
}

/** `readFiles`: files whose AI reading was saved, with how many values it kept (dark feature). */
export function DocumentList({ locale: l, documents, remove, readFiles = {} }: { locale: PatientLocale; documents: ReportedDocument[]; remove: (id: string) => Promise<boolean>; readFiles?: Record<string, number> }) {
  const r = useRemove(remove);
  return (
    <section className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby="earlier-files-title">
      <h2 id="earlier-files-title" className="text-h3">{copy(l, "Your files", "Ձեր ֆայլերը", "Ваши файлы")}</h2>
      {r.failed && <p role="alert" className="text-body2">{copy(l, "Couldn’t remove it. Try again.", "Չհաջողվեց հեռացնել։ Փորձեք կրկին։", "Не удалось удалить. Попробуйте ещё раз.")}</p>}
      {documents.length ? (
        <ul className="divide-y">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 space-y-1">
                <a href={`/patient/progress/earlier/files/${d.id}`} {...FILE_LINK} className="inline-flex min-h-11 items-center gap-2 break-all text-body1 font-medium underline">
                  <FileText aria-hidden className="size-4 shrink-0" />
                  {d.fileName}
                </a>
                <p className="text-caption text-muted-foreground">
                  {d.resultDate ? `${copy(l, "Result date", "Արդյունքի ամսաթիվ", "Дата результата")} ${dayLabel(d.resultDate, l)} · ` : ""}
                  {copy(l, "Added", "Ավելացվել է", "Добавлено")} {dayLabel(d.createdAt, l)}
                </p>
                <FromYouBadge locale={l} />
                {d.id in readFiles && (
                  <p className="text-caption text-muted-foreground">
                    {copy(l, `${readFiles[d.id]} ${readFiles[d.id] === 1 ? "value" : "values"} read by AI`, `AI-ը կարդացել է ${readFiles[d.id]} արժեք`, `Распознано ИИ, значений: ${readFiles[d.id]}`)} ·{" "}
                    <a className="inline-flex min-h-11 items-center underline" href={`/patient/progress/earlier?edit=${d.id}#reading-${d.id}`}>{copy(l, "Edit values", "Խմբագրել արժեքները", "Изменить значения")}</a>
                  </p>
                )}
              </div>
              <Button type="button" variant="outline" className="h-auto min-h-11 gap-2" disabled={r.busy === d.id} onClick={() => void r.remove(d.id)}>
                <Trash2 aria-hidden className="size-4" />
                {copy(l, "Remove", "Հեռացնել", "Удалить")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body2 text-muted-foreground">{copy(l, "No files yet.", "Ֆայլեր դեռ չկան։", "Файлов пока нет.")}</p>
      )}
    </section>
  );
}

export function ValueList({ locale: l, values, remove }: { locale: PatientLocale; values: ReportedValue[]; remove?: (id: string) => Promise<boolean> }) {
  const id=useId();
  const r = useRemove(remove);
  return (
    <section className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`${id}-values-title`}>
      <h2 id={`${id}-values-title`} className="text-h3">{copy(l, "Values you added", "Ձեր ավելացրած արժեքները", "Добавленные вами значения")}</h2>
      {r.failed && <p role="alert" className="text-body2">{copy(l, "Couldn’t remove it. Try again.", "Չհաջողվեց հեռացնել։ Փորձեք կրկին։", "Не удалось удалить. Попробуйте ещё раз.")}</p>}
      {values.length ? (
        <ul className="divide-y">
          {values.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-body1"><span className="font-medium">{copy(l, measures[v.measure].en, measures[v.measure].hy, measureNamesRu[v.measure])}</span> <span className="tabular-nums">{valueText(v)}</span></p>
                <p className="text-caption text-muted-foreground">{dayLabel(v.measuredOn, l)} · {sourceLabel(v.source, l)}</p>
              </div>
              {remove&&<Button type="button" variant="outline" className="h-auto min-h-11 gap-2" disabled={r.busy === v.id} onClick={() => void r.remove(v.id)} aria-label={`${copy(l, "Remove", "Հեռացնել", "Удалить")} ${copy(l, measures[v.measure].en, measures[v.measure].hy, measureNamesRu[v.measure])} ${dayLabel(v.measuredOn, l)}`}>
                <Trash2 aria-hidden className="size-4" />
                {copy(l, "Remove", "Հեռացնել", "Удалить")}
              </Button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body2 text-muted-foreground">{copy(l, "No values yet.", "Արժեքներ դեռ չկան։", "Значений пока нет.")}</p>
      )}
    </section>
  );
}
