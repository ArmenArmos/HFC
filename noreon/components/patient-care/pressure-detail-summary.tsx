import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from '@/lib/patient/bp-provenance';
import { HeartPulse, Plus } from "lucide-react";
import type { Measurement } from "@/lib/patient/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { armeniaDate } from "@/lib/patient-care/model";
import { measurementOverview } from "@/lib/patient-care/overview";
import { CareLink, IconTile, copy, stamp } from "./common";

const past = (measurements: Measurement[], now: Date) =>
  measurements.filter(r => Date.parse(r.measuredAt) <= now.getTime())
    .toSorted((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));

/** Prototype pair 12 summary tiles. Recorded values only: no target, no status colour, since a
 *  target exists only in a doctor-approved plan. */
export function PressureDetailSummary({ measurements, locale: l, now }: {
  measurements: Measurement[]; locale: PatientLocale; now: Date;
}) {
  const summary = measurementOverview(measurements, now);
  const latest = past(measurements, now).find(m => !isUnverifiedBp(m));
  return <section className="journey-card space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><IconTile icon={HeartPulse}/><h2 className="text-h2">{copy(l, "Your blood pressure", "Ձեր արյան ճնշումը", "Ваше артериальное давление")}</h2></div>
      <CareLink href="/patient/measurements/new" icon={Plus} variant="primary">{copy(l, "Record blood pressure", "Գրանցել ճնշումը", "Записать давление")}</CareLink>
    </header>
    <div className="journey-values">
      <div><strong className="tabular-nums">{latest ? `${latest.systolic}/${latest.diastolic}` : "–"}</strong><small>{copy(l, "Latest, mmHg", "Վերջինը, mmHg", "Последнее, mmHg")}</small></div>
      <div><strong className="tabular-nums">{summary.average ? `${summary.average.systolic}/${summary.average.diastolic}` : "–"}</strong><small>{copy(l, "7-day average", "7 օրվա միջինը", "Среднее за 7 дней")}</small></div>
      <div><strong className="tabular-nums">{summary.count}</strong><small>{copy(l, "Verified readings, 7 days", "Ստուգված չափում, 7 օր", "Проверенные измерения за 7 дней")}</small></div>
    </div>
    <p className="text-caption text-muted-foreground">{bpObservationCounts(past(measurements, now).filter(m => Date.parse(m.measuredAt) >= Date.parse(`${armeniaDate(now)}T00:00:00+04:00`) - 6 * 86400000), l)}</p>
    {latest && <p className="text-caption text-muted-foreground">{copy(l, "Latest reading", "Վերջին չափումը", "Последнее измерение")}: {stamp(latest.measuredAt, l)}</p>}
    <p className="text-caption text-muted-foreground">{copy(l, "Your doctor sets your treatment goals. These are your recorded values, not an assessment.", "Բուժման նպատակները սահմանում է ձեր բժիշկը։ Սրանք ձեր գրանցված արժեքներն են, ոչ թե գնահատական։", "Цели лечения определяет ваш врач. Здесь показаны записанные значения, а не оценка.")}</p>
  </section>;
}

/** Prototype "Recent readings": the last five, newest first, with pulse when recorded. */
export function RecentReadings({ measurements, locale: l, now }: { measurements: Measurement[]; locale: PatientLocale; now: Date }) {
  const rows = past(measurements, now).slice(0, 5);
  if (!rows.length) return null;
  return <section className="journey-card" aria-labelledby="recent-readings-title">
    <h2 id="recent-readings-title">{copy(l, "Recent readings", "Վերջին չափումները", "Последние измерения")}</h2>
    <ul className="divide-y">
      {rows.map(r => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-3 first:pt-0 last:pb-0">
          <span className="font-display text-body1 font-bold tabular-nums">{r.systolic}/{r.diastolic} <span className="text-caption font-normal text-muted-foreground">mmHg</span></span>
          <span className="text-caption text-muted-foreground tabular-nums">
            {isUnverifiedBp(r) && <>{unverifiedBpLabel(l)} · </>}{stamp(r.measuredAt, l)}{typeof r.pulse === "number" ? ` · ${copy(l, `pulse ${r.pulse}`, `զարկ ${r.pulse}`, `пульс ${r.pulse}`)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  </section>;
}
