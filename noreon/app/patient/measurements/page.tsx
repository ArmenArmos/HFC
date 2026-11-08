import { formatMemberDate } from "@/lib/patient/date-format";
import { requireRegistered, getMeasurements } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink, IconTile } from "@/components/patient-care/common";
import { ArrowLeft, HeartPulse, History, Plus } from "lucide-react";
import { tx } from "@/lib/patient/copy";
import { MeasurementTrend } from "@/components/patient/measurement-trend";
export default async function Measurements() {
  const { profile } = await requireRegistered(),
    rows = await getMeasurements(),
    l = profile.locale;
  return (
    <PatientShell locale={l}>
      <div className="space-y-5">
        <CareLink href="/patient/health" icon={ArrowLeft}>
          {tx(l, "Վերադառնալ «Ճնշում»", "Back to Pressure", "Вернуться к давлению")}
        </CareLink>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <IconTile icon={History} />
            <h1 className="text-h1">{tx(l, "Ձեր չափումները", "Your measurements", "Ваши измерения")}</h1>
          </div>
          <CareLink href="/patient/measurements/new" icon={Plus} variant="primary">
            {tx(l, "Գրանցել ճնշումը", "Record blood pressure", "Записать давление")}
          </CareLink>
        </header>
        {rows.length >= 2 && (
          <div className="journey-card rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
            <MeasurementTrend measurements={rows} locale={l} />
          </div>
        )}
        <section className="journey-card overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-3 border-b p-5 sm:px-6">
            <IconTile icon={HeartPulse} />
            <h2 className="text-h3">{tx(l, "Չափումների պատմություն", "Measurement history", "История измерений")}</h2>
          </header>
          {rows.length ? (
            <div className="divide-y px-5 sm:px-6">
              {rows.map((row) => (
                <article key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-5">
                  <div className="min-w-0">
                    <p className="text-h2 tabular-nums">
                      {row.systolic}/{row.diastolic}{" "}
                      <span className="text-body2 font-normal text-muted-foreground">mmHg</span>
                    </p>
                    <p className="mt-2 text-caption text-muted-foreground">
                      {formatMemberDate(new Date(row.measuredAt), l, {
                        timeZone: "Asia/Yerevan",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {tx(l, "Հայաստանի ժամանակ (UTC+4)", "Armenia time (UTC+4)", "Время Армении (UTC+4)")}
                    </p>
                    <span className="mt-2 inline-flex rounded-md bg-muted px-2 py-1 text-caption text-muted-foreground">
                      {tx(l, "Ձեռքով", "Manual", "Вручную")}
                    </span>
                  </div>
                  {row.pulse && (
                    <div className="text-right">
                      <p className="text-body2 font-semibold tabular-nums">{row.pulse} bpm</p>
                      <p className="mt-1 text-caption text-muted-foreground">{tx(l, "Զարկերակ", "Pulse", "Пульс")}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="p-5 text-body2 text-muted-foreground sm:p-6">
              {tx(l, "Դեռ չափումներ չկան։", "No measurements yet.", "Измерений пока нет.")}
            </p>
          )}
        </section>
      </div>
    </PatientShell>
  );
}
