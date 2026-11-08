"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown, Phone, Target } from "lucide-react";
import type { MemberLdl } from "@/lib/ldl/schema";
import { assessLdl, formatMmol, formatPercent, ldlOnePartMet, ldlReductionShown } from "@/lib/ldl/status";
import { KIT, t, type KitLocale, type Line } from "./copy";
import { Primary } from "./answers";

/**
 * Cards Zoe posts (DESIGN.md §4). A card is a snapshot: it shows what was true at `asOf` and is never redrawn
 * with today's data. A stale card keeps its content, loses its controls and links to the current record.
 */
export type Tone = "plain" | "action" | "ok" | "watch" | "alert";
export type CardState = "ready" | "loading" | "stale";
export function Card({ locale: l, icon: Icon, title, tag, tone = "plain", state = "ready", asOf, current, foot, focus = false, children }: {
  locale: KitLocale; icon?: LucideIcon; title: string; tag?: ReactNode; tone?: Tone; state?: CardState;
  asOf?: string; current?: { href: string; onClick?: () => void }; foot?: ReactNode; focus?: boolean; children?: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);
  return (
    <article className="zk-card" data-tone={tone === "plain" ? undefined : tone} data-state={state} aria-labelledby={id} aria-busy={state === "loading" || undefined}>
      {state === "stale" && (
        <p className="zk-stale">{t(l, KIT.stale)}{current && <a className="zk-link" href={current.href} onClick={current.onClick}>{t(l, KIT.seeCurrent)}</a>}</p>
      )}
      <div className="zk-card-head">
        {Icon && <Icon className="size-5" aria-hidden />}
        <h3 id={id} ref={heading} tabIndex={-1}>{title}</h3>
        {tag}
      </div>
      {state === "loading" ? <div className="zk-skel" aria-hidden><i /><i /></div> : children}
      {(asOf || foot) && <p className="zk-card-foot">{foot && <span>{foot}</span>}{asOf && <span>{t(l, KIT.asOf(asOf))}</span>}</p>}
    </article>
  );
}

/** A status word. The tint helps; the word carries the meaning. */
export function Tag({ tone, children }: { tone?: "ok" | "watch" | "doctor" | "ldl"; children: ReactNode }) {
  return <span className="zk-tag" data-tone={tone}>{children}</span>;
}

export function Fold({ summary, children, open = false }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="zk-fold" open={open}>
      <summary><ChevronDown className="size-4" aria-hidden />{summary}</summary>
      <div className="zk-fold-body">{children}</div>
    </details>
  );
}

export function Rows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return <dl className="zk-rows">{rows.map((r, i) => <div key={i} className="zk-row"><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>;
}

/** What Zoe will send or has recorded, with every answer one fold away and "Change an answer". */
export function SummaryCard({ locale: l, icon, title, rows, all, send, sent, closed = false, asOf, onSend, onChange }: {
  locale: KitLocale; icon?: LucideIcon; title: string; rows: { label: string; value: string }[]; all: { label: string; value: string; key: string }[];
  send: string; sent: string | null; closed?: boolean; asOf?: string; onSend: () => Promise<string | null> | void; onChange: (key: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => { setBusy(true); setError(null); try { const p = await onSend(); if (p) setError(p); } finally { setBusy(false); } };
  return (
    <Card locale={l} icon={icon} title={title} tone={sent ? "ok" : "plain"} asOf={sent ? undefined : asOf}>
      <Rows rows={rows} />
      <Fold summary={t(l, KIT.allAnswers(all.length))}><Rows rows={all} /></Fold>
      {error && <p role="alert" className="zk-alertline">{error}</p>}
      {sent ? <p className="zk-done" role="status"><Check className="size-5" aria-hidden />{sent}</p> : closed ? null : changing ? (
        <div className="zk-actions" role="group" aria-label={t(l, KIT.whichAnswer)}>
          <p className="zk-legend">{t(l, KIT.whichAnswer)}</p>
          {all.map(a => <button key={a.key} type="button" className="zk-chip" onClick={() => { setChanging(false); onChange(a.key); }}>{a.label}</button>)}
        </div>
      ) : (
        <div className="zk-actions">
          <Primary busy={busy} onClick={go}>{error ? t(l, KIT.retry) : send}</Primary>
          <button type="button" className="zk-link self-center" disabled={busy} onClick={() => setChanging(true)}>{t(l, KIT.changeAnswer)}</button>
        </div>
      )}
    </Card>
  );
}

/**
 * A value on a scale: the track spans `scale`, the shaded part is the typical range, the dot is the value and
 * the tick is the doctor's goal. Labels under the track carry the numbers, so nothing depends on colour.
 */
export function Band({ scale, range, value, goal, labels }: { scale: [number, number]; range?: [number, number]; value: number; goal?: { at: number; label: string }; labels: number[] }) {
  const pos = (n: number) => `${Math.max(0, Math.min(100, ((n - scale[0]) / (scale[1] - scale[0])) * 100))}%`;
  return (
    <div className="zk-band" aria-hidden>
      {range && <b style={{ left: pos(range[0]), width: `calc(${pos(range[1])} - ${pos(range[0])})` }} />}
      {goal && <u style={{ left: pos(goal.at) }}><span>{goal.label}</span></u>}
      <i style={{ left: pos(value) }} />
      {labels.map(n => <em key={n} style={{ left: pos(n) }}>{n}</em>)}
    </div>
  );
}

/** A small line chart with the goal as a dashed line; the caller passes the same series as text for screen readers. */
export function LineChart({ points, goal, summary, format }: { points: { label: string; value: number }[]; goal?: { value: number; label: string }; summary: string; format: (n: number) => string }) {
  if (points.length < 2) return null;
  const W = 300, H = 140, padX = 18, top = 22, bottom = 22;
  const values = [...points.map(p => p.value), ...(goal ? [goal.value] : [])];
  const lo = Math.min(...values) * 0.85, hi = Math.max(...values) * 1.08;
  const x = (i: number) => padX + (i * (W - padX * 2)) / (points.length - 1);
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  return (
    <figure className="zk-chart m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <line className="grid" x1={0} x2={W} y1={H - bottom} y2={H - bottom} />
        {goal && <><line className="goal" x1={0} x2={W} y1={y(goal.value)} y2={y(goal.value)} /><text className="g" x={W} y={y(goal.value) - 6} textAnchor="end">{goal.label}</text></>}
        <polyline className="line" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {points.map((p, i) => (
          <g key={i}>
            <circle className="dot" cx={x(i)} cy={y(p.value)} r={4.5} />
            <text className="v" x={x(i)} y={y(p.value) - 10} textAnchor="middle">{format(p.value)}</text>
            <text x={x(i)} y={H - 4} textAnchor="middle">{p.label}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** One result: big value, a status word, the band, plain words and the numbers one fold away. */
export function ResultCard({ locale: l, icon, title, value, unit, tag, band, plain, approved, numbers, asOf, children }: {
  locale: KitLocale; icon?: LucideIcon; title: string; value: string; unit: string; tag?: ReactNode; band?: ReactNode; plain?: string; approved?: string;
  numbers?: { label: string; value: string }[]; asOf?: string; children?: ReactNode;
}) {
  return (
    <Card locale={l} icon={icon} title={title} tag={tag} asOf={asOf}>
      <p className="zk-value"><strong>{value}</strong><small>{unit}</small></p>
      {band}
      {plain && <p className="zk-plain">{plain}</p>}
      {approved && <p><Tag tone="doctor">{approved}</Tag></p>}
      {numbers && <Fold summary={t(l, KIT.showNumbers)}><Rows rows={numbers} /></Fold>}
      {children}
    </Card>
  );
}

export type PlanDose = { slot: "morning" | "evening"; badge: string; when: string; what: string };
/** A doctor-approved plan: doses by time of day, the goals as two tinted tiles, and why, one fold away. */
export function PlanCard({ locale: l, icon, title, approved, changed, doses, goals, why, whyLabel, asOf, start, started, superseded }: {
  locale: KitLocale; icon?: LucideIcon; title: string; approved: string; changed?: string; doses: PlanDose[]; goals: { domain: "bp" | "ldl"; label: string; value: string }[];
  why?: ReactNode; whyLabel: string; asOf?: string; start?: { label: string; also?: { label: string; onClick: () => void }; onClick: () => Promise<string | null> | void }; started?: string; superseded?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Card locale={l} icon={icon} title={title} tone={superseded ? "plain" : started ? "ok" : "plain"} asOf={asOf} state={superseded ? "stale" : "ready"}>
      <p><Tag tone="doctor">{approved}</Tag></p>
      {changed && <p className="zk-plain">{changed}</p>}
      <div>
        {doses.map((d, i) => (
          <div key={i} className="zk-pill-row"><span className="zk-pill-badge" data-slot={d.slot} aria-hidden>{d.badge}</span><div><strong>{d.when}</strong><span>{d.what}</span></div></div>
        ))}
      </div>
      <div className="zk-tiles">{goals.map(g => <div key={g.domain} className="zk-tile" data-domain={g.domain}><p>{g.label}</p><p>{g.value}</p></div>)}</div>
      {why && <Fold summary={whyLabel}>{why}</Fold>}
      {superseded ? <p className="zk-plain">{superseded}</p> : started ? <p className="zk-done" role="status"><Check className="size-5" aria-hidden />{started}</p> : start && (
        <div className="zk-actions">
          <Primary busy={busy} onClick={async () => { setBusy(true); try { await start.onClick(); } finally { setBusy(false); } }}>{start.label}</Primary>
          {start.also && <Primary tone="line" disabled={busy} onClick={start.also.onClick}>{start.also.label}</Primary>}
        </div>
      )}
    </Card>
  );
}

const LDL_UNIT: Line = { hy: "մմոլ/լ", en: "mmol/L", ru: "ммоль/л" };
/**
 * The member's LDL goal in the chat. lib/ldl decides the status (assessLdl); this card only words it, with the
 * same lines as components/patient-care/ldl-goal-card.tsx (clinical wording pending Armen/Yesayi and Tatevik).
 * No progress percentage is invented: a reduction shows only when lib/ldl computed one.
 */
export function GoalCard({ locale: l, data, setBy, day, asOf, chart }: { locale: KitLocale; data: MemberLdl; setBy: string; day: (d: string) => string; asOf?: string; chart?: ReactNode }) {
  if (!data.enabled || !data.inPathway) return null;
  const unit = t(l, LDL_UNIT);
  const title = t(l, { hy: "Ձեր ՑԽԼ խոլեստերինի նպատակը", en: "Your LDL cholesterol goal", ru: "Ваша цель по холестерину ЛПНП" });
  const goal = data.goal;
  if (!goal) return (
    <Card locale={l} icon={Target} title={title} asOf={asOf}>
      <p className="zk-plain">{t(l, { hy: "Ձեր բժիշկը սահմանում է ձեր նպատակը", en: "Your doctor is setting your goal", ru: "Ваш врач устанавливает вашу цель" })}</p>
    </Card>
  );
  const a = assessLdl({ goal, observations: data.observations });
  const threshold = formatMmol(goal.thresholdMmol);
  const latest = a.latest;
  const pct = a.reduction.state === "met" || a.reduction.state === "not_met" ? a.reduction : null;
  const onePart = ldlOnePartMet(a);
  const at = a.status === "at_goal" && !onePart;
  const values = a.observations.filter(o => o.counts).map(o => o.mmol);
  const top = Math.ceil(Math.max(goal.thresholdMmol * 2, ...values) + 0.5);
  return (
    <Card locale={l} icon={Target} title={title} tone={at ? "ok" : "plain"} asOf={asOf}
      tag={latest && a.status !== "not_assessable" ? <Tag tone={at ? "ok" : "watch"}>{onePart ? t(l, { hy: "Ձեր նպատակի մի մասը կատարված է", en: "One part of your goal is met", ru: "Одна часть цели выполнена" }) : at ? t(l, { hy: "Ձեր նպատակից ցածր է", en: "Below your goal", ru: "Ниже вашей цели" }) : t(l, { hy: "Ձեր նպատակից բարձր է", en: "Above your goal", ru: "Выше вашей цели" })}</Tag> : undefined}
      foot={setBy}>
      <p className="zk-plain">{t(l, { hy: `Ձեր նպատակը՝ ${threshold} ${unit}-ից ցածր`, en: `Your goal: below ${threshold} ${unit}`, ru: `Ваша цель: ниже ${threshold} ${unit}` })}</p>
      {ldlReductionShown(goal, a) && <p className="zk-card-foot">{t(l, { hy: `և բուժումից առաջվա մակարդակից առնվազն ${goal.reductionPct}%-ով ցածր`, en: `and at least ${goal.reductionPct}% lower than before treatment`, ru: `и как минимум на ${goal.reductionPct}% ниже, чем до лечения` })}</p>}
      {a.status === "not_assessable" || !latest ? (
        <p className="zk-plain">{t(l, { hy: "ՑԽԼ խոլեստերինի արյան անալիզը ցույց կտա, թե որքան մոտ եք ձեր նպատակին։", en: "An LDL blood test will show how close you are to your goal.", ru: "Анализ крови на ЛПНП покажет, насколько вы близки к цели." })}</p>
      ) : (
        <>
          <p className="zk-value"><strong>{formatMmol(latest.mmol, goal.thresholdMmol)}</strong><small>{unit}</small></p>
          <p className="zk-card-foot">{t(l, { hy: `Վերջին արդյունքը, ${day(latest.on)}`, en: `Latest result, ${day(latest.on)}`, ru: `Последний результат, ${day(latest.on)}` })}</p>
          <Band scale={[0, top]} value={latest.mmol} goal={{ at: goal.thresholdMmol, label: threshold }} labels={[0, top]} />
          <p className="zk-plain">{onePart
            ? t(l, { hy: `Ձեր վերջին արդյունքը ${threshold} ${unit}-ից ցածր է։ Բուժումից առաջվա համեմատ նվազումը դեռ բավարար չէ։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։`, en: `Your latest result is below ${threshold} ${unit}. The drop since before treatment is not there yet. Your care team uses it to plan the next step with you.`, ru: `Ваш последний результат ниже ${threshold} ${unit}. Снижения по сравнению с уровнем до лечения пока недостаточно. Ваша команда учтёт это при планировании следующего шага.` })
            : at
            ? t(l, { hy: "Ձեր վերջին արդյունքը նպատակից ցածր է։", en: "Your latest result is below your goal.", ru: "Ваш последний результат ниже цели." })
            : t(l, { hy: "Ձեր վերջին արդյունքը նպատակից բարձր է։ Ձեր բուժթիմը դրա հիման վրա ձեզ հետ կպլանավորի հաջորդ քայլը։", en: "Your latest result is above your goal. Your care team uses it to plan the next step with you.", ru: "Ваш последний результат выше цели. Ваша команда по уходу использует его, чтобы спланировать с вами следующий шаг." })}</p>
          {pct && pct.percent > 0 && <p className="zk-card-foot">{t(l, { hy: `Բուժումից առաջվանից ${formatPercent(pct.percent, pct.requiredPct)}%-ով ցածր`, en: `${formatPercent(pct.percent, pct.requiredPct)}% lower than before treatment`, ru: `На ${formatPercent(pct.percent, pct.requiredPct)}% ниже, чем до лечения` })}</p>}
        </>
      )}
      {chart && <Fold summary={t(l, KIT.showChart)}>{chart}</Fold>}
      {goal.nextTestOn && <p className="zk-plain">{t(l, { hy: `Հաջորդ ՑԽԼ անալիզը՝ ${day(goal.nextTestOn)}`, en: `Next LDL test: ${day(goal.nextTestOn)}`, ru: `Следующий анализ на ЛПНП: ${day(goal.nextTestOn)}` })}</p>}
    </Card>
  );
}

/** "Where you are": done, now, next, each with a word as well as the circle. */
export function WhereCard({ locale: l, icon, title, steps }: { locale: KitLocale; icon?: LucideIcon; title: string; steps: { title: string; detail: string; state: "done" | "now" | "next" }[] }) {
  return (
    <Card locale={l} icon={icon} title={title}>
      <ol className="zk-steps">
        {steps.map((s, i) => (
          <li key={i} className="zk-step" data-state={s.state}>
            <span className="zk-step-dot" aria-hidden>{s.state === "done" ? <Check className="size-4" /> : i + 1}</span>
            <div><em>{t(l, s.state === "done" ? KIT.stepDone : s.state === "now" ? KIT.stepNow : KIT.stepNext)}</em><strong>{s.title}</strong><span>{s.detail}</span></div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * Shown only by the safety route, never decided here. Red, the symptoms in words, a real tel:103 link and one
 * secondary that fits the context. Focus moves to its heading so a screen reader starts there.
 */
export function EmergencyCard({ locale: l, body, secondary, focus = true }: { locale: KitLocale; body: string; secondary?: { label: string; onClick: () => void }; focus?: boolean }) {
  return (
    <Card locale={l} icon={Phone} title={t(l, KIT.emergencyTitle)} tone="alert" focus={focus}>
      <p className="zk-plain">{body}</p>
      <div className="zk-actions">
        <a href="tel:103" className="emergency-call zk-btn">{t(l, KIT.call103)}</a>
        {secondary && <Primary tone="line" onClick={secondary.onClick}>{secondary.label}</Primary>}
      </div>
    </Card>
  );
}
