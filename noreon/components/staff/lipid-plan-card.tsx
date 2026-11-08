import { CareSection, Status } from "@/components/patient-care/common";
import { LIPID_COPY as W, LIPID_GOAL_GAPS as GAPS, LIPID_TESTS as TESTS } from "@/lib/lipid-planner/copy";
import { LIPID_OPEN_GUIDANCE } from "@/lib/lipid-planner/rules";
import { LIPID_SOURCES } from "@/lib/lipid-planner/sources";
import type { LipidPlan } from "@/lib/lipid-planner/plan";
import type { LipidTest } from "@/lib/lipid-planner/facts";
import type { L3, TimelineItem, Tri } from "@/lib/lipid-planner/engine";
import { formatMmol, formatPercent } from "@/lib/ldl/status";
import type { Locale } from "@/lib/locale";
import { calendarDate } from "@/lib/staff/yerevan-time";

/** The doctor's lipid follow-up card. Read-only: it has no form and no action, and nothing here reaches the member. */
function statusOf(i: TimelineItem<LipidTest>) {
  if (i.state === "undated") return { key: "undated", tone: "attention" } as const;
  if (i.state === "done") return { key: "done", tone: "complete" } as const;
  return { key: i.status, tone: i.status === "overdue" ? "attention" : i.status === "due_now" ? "due" : "neutral" } as const;
}
/** Unknown is never shown as met or as neutral. */
const triTone = (r: Tri) => (r === "TRUE" ? "complete" : "attention") as "complete" | "attention";

export function LipidPlanCard({ plan, locale }: { plan: LipidPlan; locale: Locale }) {
  const pick = (l: L3) => (locale === "hy" ? l[1] : locale === "ru" ? l[2] : l[0]);
  const day = (d: string) => calendarDate(d, locale);
  const range = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
  const g = plan.goalCheck;
  return (
    <CareSection title={pick(W.title)} detail={pick(W.intro)}>
      <p role="note" className="rounded-md border border-border p-3 text-body2 font-medium">{pick(W.proposed)}</p>

      <div className="space-y-2">
        <h3 className="text-body1 font-medium">{pick(W.timeline)}</h3>
        {plan.timeline.length ? (
          <ul className="divide-y">
            {plan.timeline.map((i) => {
              const s = statusOf(i);
              return (
                <li key={`${i.ruleId}:${i.test}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-body2">
                  <span>
                    <span className="font-medium">{pick(TESTS[i.test])}</span>
                    {i.state !== "undated" && <span className="block text-muted-foreground">{range(i.from, i.to)}{i.confirmed ? ` · ${pick(W.confirmed)}` : ""}</span>}
                    {i.state === "done" && <span className="block text-muted-foreground">{pick(W.done)}: {day(i.doneOn)}</span>}
                  </span>
                  <Status tone={s.tone}>{pick(W[s.key])}</Status>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-body2 text-muted-foreground">{pick(W.none)}</p>}
        {plan.doctorNextTestOn && <p className="text-body2 text-muted-foreground">{pick(W.doctorDate)}: {day(plan.doctorNextTestOn)}</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-body1 font-medium">{pick(W.goal)}</h3>
        {g.run ? (
          <dl className="grid gap-2 text-body2 sm:grid-cols-[1fr_auto]">
            <dt>{pick(W.threshold)}: {formatMmol(g.latest.mmol, g.threshold.mmol)} mmol/L · {pick(W.below)} {formatMmol(g.threshold.mmol)} ({day(g.latest.on)})</dt>
            <dd><Status tone={triTone(g.threshold.result)}>{pick(W[g.threshold.result])}</Status></dd>
            {g.reduction.part ? <>
              <dt>{pick(W.reduction)}: {formatPercent(g.reduction.percent, g.reduction.requiredPct)}% · {pick(W.required)} {g.reduction.requiredPct}% ({formatMmol(g.baseline.mmol)} mmol/L, {day(g.baseline.on)})</dt>
              <dd><Status tone={triTone(g.reduction.result)}>{pick(W[g.reduction.result])}</Status></dd>
            </> : <dt className="sm:col-span-2 text-muted-foreground">{pick(W.noReduction)}</dt>}
            <dt className="font-medium">{pick(W.both)}</dt>
            <dd><Status tone={triTone(g.overall)}>{pick(W[g.overall])}</Status></dd>
            {g.baselineBelowThreshold && <dd className="sm:col-span-2 text-muted-foreground">{pick(W.belowAlready)}</dd>}
          </dl>
        ) : <p className="text-body2">{pick(W.notRun)} {g.missing.map((m) => pick(GAPS[m])).join("; ")}</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-body1 font-medium">{pick(W.intake)}</h3>
        <p className="text-body2">{plan.adherence && plan.adherence.percent !== null ? `${pick(W.ticks)}: ${plan.adherence.taken} / ${plan.adherence.expected}` : pick(W.noLog)}</p>
        <p className="text-body2 text-muted-foreground">{pick(W.notProof)}</p>
        {plan.reports.length
          ? <ul className="text-body2">{plan.reports.map((r, n) => <li key={n}>{pick(W[r.kind])}: {r.medicine || "?"}, {day(r.on)}</li>)}</ul>
          : <p className="text-body2 text-muted-foreground">{pick(W.noReport)}</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-body1 font-medium">{pick(W.gaps)}</h3>
        {plan.notes.length
          ? <ul className="list-disc space-y-1 pl-5 text-body2">{plan.notes.map((n) => <li key={n.text[0]}>{pick(n.text)}</li>)}</ul>
          : <p className="text-body2 text-muted-foreground">{pick(W.noGaps)}</p>}
      </div>

      {plan.open.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-body2 font-medium">{pick(W.open)}</summary>
          <div className="space-y-3 pt-2">
            {plan.open.map((id) => {
              const o = LIPID_OPEN_GUIDANCE[id];
              return (
                <div key={id}>
                  <p className="text-body2 font-medium">{pick(o.topic)}</p>
                  <ul className="text-body2">{o.positions.map((p) => <li key={p.source}>{LIPID_SOURCES[p.source].short}: {pick(p.text)}</li>)}</ul>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <details>
        <summary className="min-h-11 cursor-pointer text-body2 font-medium">{pick(W.rules)}</summary>
        <ul className="divide-y">
          {plan.decisions.map((d) => (
            <li key={d.ruleId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body2">
              <span>
                <span className="font-medium">{pick(d.title)}</span>
                <span className="block text-caption text-muted-foreground">{pick(W.status)} · {d.sources.map((s) => LIPID_SOURCES[s].short).join(" · ")}</span>
              </span>
              <span className="text-caption">{pick(d.result === "TRUE" ? W.applies : d.result === "FALSE" ? W.doesNotApply : W.UNKNOWN)}</span>
            </li>
          ))}
        </ul>
      </details>
    </CareSection>
  );
}
