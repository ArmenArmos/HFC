"use client";

import { useState } from "react";

import { Illustrative, Track } from "@/components/marketing/home/primitives";
import { useMarketingLocale } from "@/components/marketing/locale";
import type { LocalizedHyEn } from "@/lib/clinical/types";
import { cn } from "@/lib/utils";

/**
 * The product, drawn.
 *
 * These are the only screens on the marketing site, and everything they show is
 * invented. That is the reason `Illustrative` is not optional on any of them:
 * the page spends its first three sections establishing that prevention should
 * follow evidence, and a chart that looks like a result the product has
 * produced spends that credit in one glance.
 *
 * They are hand-drawn SVG rather than the charting library the product uses.
 * Two reasons. The shapes here are fixed illustrations with no data behind
 * them, so a library's axis inference, responsive container and tooltip layer
 * are all machinery for a problem that does not exist. And these render on the
 * one page that has to arrive fast for a stranger.
 *
 * Nothing below names a colour. Every stroke and fill is a token reference, so
 * the charts move when the palette does.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Point = { x: number; y: number };

/**
 * A cardinal spline through the points, as one cubic path.
 *
 * Straight segments between weekly averages read as a measurement taken at the
 * vertex and nowhere else, which is the opposite of what a 90-day trend is
 * claiming. The tension is low: the curve smooths the joins without inventing
 * an excursion between two readings.
 */
function spline(points: Point[], tension = 0.35): string {
  if (points.length < 2) return "";
  const k = (tension * 2) / 6;
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * k;
    const c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k;
    const c2y = p2.y - (p3.y - p1.y) * k;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** The same path, closed down to the baseline, for the wash under a line. */
function area(path: string, x0: number, x1: number, baseline: number): string {
  return `${path} L${x1} ${baseline} L${x0} ${baseline} Z`;
}

// ---------------------------------------------------------------------------
// The invented record
// ---------------------------------------------------------------------------

/** Thirteen weekly averages, which is what "90 days" comes to. */
const SYSTOLIC = [148, 145, 143, 141, 138, 137, 134, 133, 131, 130, 129, 128, 127];
const DIASTOLIC = [93, 92, 91, 90, 88, 88, 86, 85, 84, 83, 82, 81, 80];

/** Measurements taken each fortnight, out of fourteen scheduled. */
const CONSISTENCY = [14, 14, 13, 14, 12, 14, 14, 10, 14, 14, 13, 14, 14, 12];

/** Share of hypertensive members at target, over eight half-quarters. */
const CONTROLLED = [38, 44, 51, 57, 61, 66, 69, 72];

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/** The label above a number, in the one style every tile on these screens uses. */
function TileLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-overline text-muted-foreground">{children}</p>;
}

/** A figure, at the weight a dashboard gives the thing it is reporting. */
function Figure({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-heading text-[var(--text-strong)] text-h2 tabular-nums tracking-tight",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** One bordered tile inside a screen. */
function Tile({
  children,
  className,
  tone = "card",
}: {
  children: React.ReactNode;
  className?: string;
  /** `warn` is the gold-edged tile a clinical flag sits in. */
  tone?: "card" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 sm:p-5",
        tone === "warn"
          ? "bg-surface-subtle-gold ring-1 ring-[var(--noreon-gold-400)]"
          : "bg-card ring-1 ring-[var(--border-subtle)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A progress ring, for the one figure on each screen that is a proportion. */
function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-14 shrink-0" role="img" aria-label={label}>
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="var(--chart-track)"
        strokeWidth="7"
      />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="var(--status-success-fg)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct / 100)}
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}

/** The head of a screen: what it is, and the label saying none of it is real. */
function ScreenHead({ title }: { title: LocalizedHyEn }) {
  const { t } = useMarketingLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <p className="font-heading text-[var(--text-strong)] text-h3 font-bold tracking-tight break-words">
        {t(title)}
      </p>
      <Illustrative />
    </div>
  );
}

/** The frame every screen sits in. */
function Screen({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card rounded-3xl p-3 shadow-[var(--shadow-lg)] ring-1 ring-[var(--border-subtle)] sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hero's card
// ---------------------------------------------------------------------------

/**
 * The member's day, small enough to sit beside the headline.
 *
 * It is the one screen a visitor sees before they have read anything, so it
 * shows the loop rather than the data: a risk that has moved, a measurement
 * that was taken, a plan with two of four things done, and Zoe reading the
 * trend back. Four claims, one card.
 */
export function HeroDashboard() {
  const { t } = useMarketingLocale();

  const spark = spline(
    [146, 141, 138, 134, 131, 129, 128].map((v, i) => ({
      x: +(i * (160 / 6)).toFixed(1),
      y: +(6 + 28 - ((v - 122) / 28) * 28).toFixed(1),
    })),
  );

  return (
    <div className="bg-card text-foreground rounded-3xl p-4 shadow-[var(--shadow-lg)] ring-1 ring-[var(--border-subtle)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TileLabel>{t({ hy: "Անդամի վահանակ", en: "Member dashboard" })}</TileLabel>
          <p className="font-heading text-[var(--text-strong)] mt-1 text-h3 font-bold tracking-tight">
            {t({ hy: "Այսօր · կանխարգելման ծրագիր", en: "Today · prevention plan" })}
          </p>
        </div>
        <span className="text-caption rounded-pill bg-[var(--status-success-bg)] text-[var(--status-success-fg)] inline-flex items-center gap-2 px-3 py-1.5 font-medium">
          <span
            className="size-1.5 rounded-full bg-[var(--status-success-fg)]"
            aria-hidden
          />
          {t({ hy: "Սարքերը միացված են", en: "Devices connected" })}
        </span>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <Tile className="p-4">
          <TileLabel>{t({ hy: "Սրտանոթային ռիսկ, 10 տարի", en: "10-year cardiovascular risk" })}</TileLabel>
          <div className="mt-2 flex items-end gap-2">
            <Figure className="text-display3">
              12.4<span className="text-h3">%</span>
            </Figure>
            <span className="text-caption text-[var(--status-success-fg)] pb-1 font-semibold">
              ↓ 1.8
            </span>
          </div>
          <Track pct={41} className="mt-3" />
          <p className="text-muted-foreground text-caption mt-2">
            {t({ hy: "14.2%-ից 90 օրում", en: "down from 14.2% in 90 days" })}
          </p>
        </Tile>

        <Tile className="p-4">
          <TileLabel>{t({ hy: "Տնային ՃՃ · 7 օր", en: "Home BP · 7-day" })}</TileLabel>
          <Figure className="text-display3 mt-2">
            128<span className="text-muted-foreground text-h3">/81</span>
          </Figure>
          <svg
            viewBox="0 0 160 40"
            className="mt-1 h-10 w-full"
            role="img"
            aria-label={t({
              hy: "Ճնշման դինամիկան, պատկերավոր",
              en: "Blood-pressure trend, illustrative",
            })}
          >
            <path
              d={area(spark, 0, 160, 40)}
              fill="var(--chart-primary)"
              fillOpacity="0.14"
            />
            <path
              d={spark}
              fill="none"
              stroke="var(--chart-primary)"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-muted-foreground text-caption">
            {t({ hy: "Թիրախ՝ 130/80-ից ցածր", en: "Target below 130/80" })}
          </p>
        </Tile>

        <Tile className="p-4">
          <TileLabel>{t({ hy: "Հետևողականության ազդանշան", en: "Adherence signal" })}</TileLabel>
          <div className="mt-2 flex items-center gap-3">
            <Ring
              pct={84}
              label={t({ hy: "Հետևողականություն 84%", en: "Adherence 84%" })}
            />
            <div>
              <Figure>84%</Figure>
              <p className="text-muted-foreground text-caption">
                {t({
                  hy: "Դեղատուփ և լրացում, վերջին 30 օրը",
                  en: "Pill box and refill, last 30 days",
                })}
              </p>
            </div>
          </div>
        </Tile>
      </div>

      <Tile className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
            {t({ hy: "Այսօրվա քայլերը", en: "Today's actions" })}
          </p>
          <p className="text-muted-foreground text-caption font-medium">
            {t({ hy: "2 / 4 արված", en: "2 / 4 done" })}
          </p>
        </div>
        <ul className="mt-3 grid gap-2.5">
          {[
            { done: true, label: { hy: "Առավոտյան ճնշման չափում", en: "Morning blood-pressure reading" } },
            { done: true, label: { hy: "Դեղորայք, 08:00", en: "Medication, 08:00" } },
            { done: false, label: { hy: "25 րոպե քայլք", en: "A 25-minute walk" } },
            { done: false, label: { hy: "Ամրագրել լիպիդային վահանակի կրկնությունը", en: "Book the lipid panel repeat" } },
          ].map((action) => (
            <li
              key={action.label.en}
              className={cn(
                "text-body2 flex items-center gap-2.5",
                action.done ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-4.5 shrink-0 place-items-center rounded-full",
                  action.done
                    ? "bg-[var(--status-success-fg)] text-on-inverse"
                    : "ring-2 ring-[var(--border-default)] ring-inset",
                )}
              >
                {action.done && (
                  <svg viewBox="0 0 9 7" className="w-2.5">
                    <path
                      d="M1 3.6 3.3 6 8 1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </span>
              {t(action.label)}
            </li>
          ))}
        </ul>
      </Tile>

      <div className="bg-surface-subtle-teal mt-2.5 flex items-start gap-3 rounded-xl p-4 ring-1 ring-[var(--noreon-teal-200)]">
        <span
          className="font-heading bg-brand-teal text-on-inverse text-caption grid size-7 shrink-0 place-items-center rounded-full font-extrabold"
          aria-hidden
        >
          Z
        </span>
        <p className="text-caption text-[var(--noreon-teal-800)] font-medium text-pretty">
          {t({
            hy: "Զոն. ձեր երեկոյան ցուցանիշներն այս շաբաթ 6 մմ ս.ս.-ով ցածր են։ Պահեք նույն ռեժիմը մինչև հաջորդ դիտարկումը։",
            en: "Zoe: your evening readings are 6 mmHg lower this week. Keep the same routine before your next review.",
          })}
        </p>
      </div>

      <p className="text-overline text-muted-foreground mt-3">
        {t({ hy: "Պատկերավոր ինտերֆեյս", en: "Illustrative product interface" })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The member's ninety days
// ---------------------------------------------------------------------------

/** Plot geometry for the blood-pressure chart, in its own viewBox units. */
const BP = { x: 52, w: 604, y: 20, h: 150, min: 70, max: 160 };

const bpY = (v: number) => +(BP.y + BP.h - ((v - BP.min) / (BP.max - BP.min)) * BP.h).toFixed(1);
const bpX = (i: number) => +(BP.x + i * (BP.w / (SYSTOLIC.length - 1))).toFixed(1);

export function MemberDashboard() {
  const { t } = useMarketingLocale();
  const [hover, setHover] = useState<number | null>(null);

  const sysPoints = SYSTOLIC.map((v, i) => ({ x: bpX(i), y: bpY(v) }));
  const diaPoints = DIASTOLIC.map((v, i) => ({ x: bpX(i), y: bpY(v) }));
  const sysPath = spline(sysPoints);
  const band = BP.w / (SYSTOLIC.length - 1);

  return (
    <Screen>
      <ScreenHead
        title={{
          hy: "Անդամի տեսք · 90-օրյա սրտանոթային գրառում",
          en: "Member view · 90-day cardiovascular record",
        }}
      />

      <div className="mt-4 grid gap-3.5 lg:grid-cols-3">
        <Tile className="min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <div>
              <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
                {t({ hy: "Տնային ճնշում, 90 օր", en: "Home blood pressure, 90 days" })}
              </p>
              <p className="text-muted-foreground text-caption mt-1">
                {t({
                  hy: "Սիստոլիկի շաբաթական միջինը, մմ ս.ս.",
                  en: "Systolic average per week, mmHg",
                })}
              </p>
            </div>
            <ul className="text-muted-foreground text-caption flex flex-wrap gap-x-3.5 gap-y-2 font-medium">
              <li className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-sm bg-[var(--chart-primary)]"
                  aria-hidden
                />
                {t({ hy: "Միջին սիստոլիկ", en: "Mean systolic" })}
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-sm bg-[var(--chart-secondary)]"
                  aria-hidden
                />
                {t({ hy: "Դիաստոլիկ", en: "Diastolic" })}
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  className="w-4 border-t-2 border-dashed border-[var(--status-danger-fg)] opacity-60"
                  aria-hidden
                />
                {t({ hy: "Թիրախ 130", en: "Target 130" })}
              </li>
            </ul>
          </div>

          {/* The chart keeps its own scroller. Thirteen weekly points compressed
              into a 320px phone is a line with no shape left in it, so below
              the minimum it scrolls sideways inside this box rather than
              setting the whole document scrolling. */}
          <div className="mt-3 overflow-x-auto">
            <svg
              viewBox="0 0 680 202"
              className="h-53 w-full min-w-120"
              role="img"
              aria-label={t({
                hy: "90-օրյա տնային ճնշման դինամիկան, պատկերավոր",
                en: "90-day home blood pressure trend, illustrative",
              })}
            >
              <defs>
                <linearGradient id="bp-wash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-primary)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--chart-primary)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {[160, 140, 120, 100, 80].map((v) => (
                <g key={v}>
                  <line
                    x1={BP.x}
                    y1={bpY(v)}
                    x2={656}
                    y2={bpY(v)}
                    stroke="var(--chart-grid)"
                    strokeWidth="1"
                  />
                  <text
                    x={42}
                    y={bpY(v)}
                    dy="3.6"
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {v}
                  </text>
                </g>
              ))}

              <line
                x1={BP.x}
                y1={bpY(130)}
                x2={656}
                y2={bpY(130)}
                stroke="var(--status-danger-fg)"
                strokeWidth="1.3"
                strokeDasharray="4 6"
                opacity="0.5"
              />
              <text
                x={656}
                y={bpY(130)}
                dy="-6"
                textAnchor="end"
                fill="var(--status-danger-fg)"
                fontSize="10.5"
                fontWeight="700"
                letterSpacing=".08em"
              >
                {t({ hy: "ԹԻՐԱԽ 130", en: "TARGET 130" })}
              </text>

              <path
                d={area(sysPath, BP.x, BP.x + BP.w, BP.y + BP.h)}
                fill="url(#bp-wash)"
              />
              <path
                d={spline(diaPoints)}
                fill="none"
                stroke="var(--chart-secondary)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={sysPath}
                fill="none"
                stroke="var(--chart-primary)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {hover !== null && (
                <line
                  x1={sysPoints[hover].x}
                  y1={BP.y}
                  x2={sysPoints[hover].x}
                  y2={BP.y + BP.h}
                  stroke="var(--surface-inverse)"
                  strokeWidth="1"
                  opacity="0.16"
                />
              )}

              {sysPoints.map((p, i) => (
                <circle
                  key={p.x}
                  cx={p.x}
                  cy={p.y}
                  r={hover === i ? 5.6 : 3.4}
                  fill={hover === i ? "var(--chart-primary)" : "var(--surface-card)"}
                  stroke="var(--chart-primary)"
                  strokeWidth="2"
                />
              ))}

              {[0, 3, 6, 9, 12].map((i) => (
                <text
                  key={i}
                  x={bpX(i)}
                  y={192}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="11"
                  fontWeight="600"
                >
                  {t({ hy: "Շ", en: "W" })}
                  {i + 1}
                </text>
              ))}

              {/* The hit areas are one band per week rather than the dots,
                  because a 3.4px target is not a target. They are last so they
                  sit above the painted chart. */}
              {sysPoints.map((p, i) => (
                <rect
                  key={`hit-${p.x}`}
                  x={p.x - band / 2}
                  y={BP.y}
                  width={band}
                  height={BP.h}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}

              {hover !== null && (
                <g
                  transform={`translate(${Math.min(Math.max(sysPoints[hover].x, 66), 590)},${sysPoints[hover].y})`}
                  className="pointer-events-none"
                >
                  <rect
                    x="-52"
                    y="-54"
                    width="104"
                    height="42"
                    rx="12"
                    fill="var(--surface-inverse-deep)"
                  />
                  <text
                    x="0"
                    y="-38"
                    textAnchor="middle"
                    fill="var(--noreon-teal-300)"
                    fontSize="10"
                    fontWeight="700"
                    letterSpacing=".08em"
                  >
                    {t({ hy: "ՇԱԲԱԹ", en: "WEEK" })} {hover + 1}
                  </text>
                  <text
                    x="0"
                    y="-21"
                    textAnchor="middle"
                    fill="var(--text-on-inverse)"
                    fontSize="13.5"
                    fontWeight="800"
                  >
                    {SYSTOLIC[hover]}/{DIASTOLIC[hover]}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </Tile>

        <Tile className="flex min-w-0 flex-col gap-5">
          <div>
            <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
              {t({ hy: "Չափումների հետևողականություն", en: "Measurement consistency" })}
            </p>
            <div className="mt-3.5 flex h-20 items-end gap-1.5 border-b pb-px">
              {CONSISTENCY.map((taken, i) => (
                <div
                  key={i}
                  className="bg-surface-sunken flex h-full min-w-0 flex-1 items-end overflow-hidden rounded-sm"
                >
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${Math.round((taken / 14) * 100)}%`,
                      background:
                        taken >= 13
                          ? "var(--status-success-fg)"
                          : taken >= 11
                            ? "var(--chart-primary)"
                            : "var(--status-warning-fg)",
                    }}
                  />
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-caption mt-2.5">
              {t({
                hy: "Նախատեսված չափումների 91%-ը կատարված է",
                en: "91% of scheduled measurements completed",
              })}
            </p>
          </div>

          <div className="border-t pt-4">
            <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
              {t({ hy: "Հիմնական ցուցանիշները", en: "Key markers" })}
            </p>
            <dl className="text-body2 mt-3 grid gap-2.5">
              {[
                { k: { hy: "LDL-C", en: "LDL-C" }, v: "3.4 → 2.6 mmol/L", good: false },
                { k: { hy: "HbA1c", en: "HbA1c" }, v: "5.8%", good: false },
                { k: { hy: "Քաշ", en: "Weight" }, v: "−3.1 kg / 90 d", good: true },
                { k: { hy: "Քուն", en: "Sleep" }, v: "6 h 52 m", good: false },
              ].map((row) => (
                <div key={row.k.en} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground min-w-0 break-words">{t(row.k)}</dt>
                  <dd
                    className={cn(
                      "font-medium tabular-nums",
                      row.good
                        ? "text-[var(--status-success-fg)]"
                        : "text-[var(--text-strong)]",
                    )}
                  >
                    {row.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Tile>
      </div>

      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Tile>
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
            {t({ hy: "Դեղորայքին հետևողականություն", en: "Medication adherence" })}
          </p>
          <div className="mt-3.5 flex items-center gap-3.5">
            <Ring pct={84} label={t({ hy: "84 տոկոս", en: "84 per cent" })} />
            <div>
              <Figure className="text-display3">84%</Figure>
              <p className="text-muted-foreground text-caption">
                {t({ hy: "Դեղատուփի ազդանշան, 30 օր", en: "Pill-box signal, 30 d" })}
              </p>
            </div>
          </div>
        </Tile>

        <Tile>
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
            {t({ hy: "Ֆիզիկական ակտիվություն", en: "Physical activity" })}
          </p>
          <Figure className="text-display3 mt-3.5">
            168{" "}
            <span className="text-muted-foreground text-body2 font-semibold">
              {t({ hy: "րոպե / շաբաթ", en: "min / week" })}
            </span>
          </Figure>
          <Track pct={84} className="mt-3" />
          <p className="text-muted-foreground text-caption mt-2">
            {t({
              hy: "Նպատակը 200 րոպե · 4 շաբաթ աճող",
              en: "Goal 200 min · trending up 4 weeks",
            })}
          </p>
        </Tile>

        <Tile>
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
            {t({ hy: "Հաջորդը ծրագրում", en: "Next in the plan" })}
          </p>
          <ul className="text-body2 mt-3.5 grid gap-2.5">
            {[
              { in: "09 d", what: { hy: "Լիպիդային վահանակ", en: "Lipid panel" } },
              { in: "21 d", what: { hy: "Սրտաբանի հեռախորհրդատվություն", en: "Cardiology teleconsult" } },
              { in: "30 d", what: { hy: "Ռիսկի վերագնահատում", en: "Risk reassessment" } },
            ].map((row) => (
              <li key={row.what.en} className="flex gap-2.5">
                <span className="text-[var(--noreon-teal-800)] w-9 shrink-0 font-semibold tabular-nums">
                  {row.in}
                </span>
                {t(row.what)}
              </li>
            ))}
          </ul>
        </Tile>

        <Tile tone="warn">
          <p className="font-heading text-[var(--noreon-gold-800)] flex items-center gap-2.5 text-body1 font-bold break-words">
            <span className="bg-brand-gold-deep size-2 shrink-0 rounded-full" aria-hidden />
            {t({ hy: "Բաց կլինիկական նշան", en: "Open clinical flag" })}
          </p>
          <p className="text-[var(--noreon-gold-800)] text-body2 mt-3 text-pretty">
            {t({
              hy: "10 օրվա ընթացքում երեք երեկոյան ցուցանիշ 150 մմ ս.ս.-ից բարձր, փոխանցված է խնամքի թիմին դիտարկման։",
              en: "Three evening readings above 150 mmHg in 10 days, escalated to the care team for review.",
            })}
          </p>
        </Tile>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The organisation's population
// ---------------------------------------------------------------------------

const RISK_BANDS: { label: LocalizedHyEn; count: string; pct: number; fill: string }[] = [
  {
    label: { hy: "Ցածր ռիսկ", en: "Low risk" },
    count: "4,120",
    pct: 49,
    fill: "var(--status-success-fg)",
  },
  {
    label: { hy: "Միջին ռիսկ", en: "Moderate risk" },
    count: "2,610",
    pct: 31,
    fill: "var(--chart-primary)",
  },
  {
    label: { hy: "Բարձր ռիսկ", en: "High risk" },
    count: "1,180",
    pct: 14,
    fill: "var(--status-warning-fg)",
  },
  {
    label: { hy: "Շատ բարձր ռիսկ", en: "Very high risk" },
    count: "510",
    pct: 6,
    fill: "var(--status-danger-fg)",
  },
];

const FUNNEL: { label: LocalizedHyEn; value: string; pct: number; note: LocalizedHyEn; end?: boolean }[] = [
  {
    label: { hy: "Սքրինինգ", en: "Screened" },
    value: "8,420",
    pct: 100,
    note: { hy: "Գրանցված անդամ", en: "Enrolled members" },
  },
  {
    label: { hy: "Ռիսկ հայտնաբերված", en: "Risk detected" },
    value: "3,120",
    pct: 37,
    note: { hy: "Մեկ կամ ավելի գործոն", en: "One or more factors" },
  },
  {
    label: { hy: "Մոնիտորինգ", en: "Monitoring" },
    value: "2,480",
    pct: 79,
    note: { hy: "Հայտնաբերվածներից ակտիվ", en: "Of detected, active" },
  },
  {
    label: { hy: "Միջամտություն", en: "Intervention" },
    value: "1,940",
    pct: 78,
    note: { hy: "Ծրագիրն ընթացքի մեջ է", en: "Plan under way" },
  },
  {
    label: { hy: "Վերահսկվող", en: "Controlled" },
    value: "1,390",
    pct: 72,
    note: { hy: "Թիրախային ցուցանիշներով", en: "At target readings" },
    end: true,
  },
];

const KPIS: { label: LocalizedHyEn; value: string; delta: LocalizedHyEn; tone: "good" | "muted" | "warn" }[] = [
  {
    label: { hy: "Հսկողության ավարտվածություն", en: "Follow-up completion" },
    value: "81%",
    delta: { hy: "+9 կետ Q1-ի համեմատ", en: "+9 pts vs Q1" },
    tone: "good",
  },
  {
    label: { hy: "Չափումների հետևողականություն", en: "Measurement consistency" },
    value: "74%",
    delta: { hy: "+6 կետ Q1-ի համեմատ", en: "+6 pts vs Q1" },
    tone: "good",
  },
  {
    label: { hy: "Սարքերի ակտիվացում", en: "Device activation" },
    value: "68%",
    delta: { hy: "5,730 գործող սարք", en: "5,730 devices live" },
    tone: "muted",
  },
  {
    label: { hy: "Բաց կլինիկական ազդանշաններ", en: "Open clinical alerts" },
    value: "46",
    delta: { hy: "12-ը փոխանցված այս շաբաթ", en: "12 escalated this week" },
    tone: "warn",
  },
];

/** Plot geometry for the controlled-hypertension chart. */
const ORG = { x: 46, w: 608, y: 16, h: 116, min: 30, max: 80 };

const orgY = (v: number) => +(ORG.y + ORG.h - ((v - ORG.min) / (ORG.max - ORG.min)) * ORG.h).toFixed(1);

export function PopulationDashboard() {
  const { t } = useMarketingLocale();

  const points = CONTROLLED.map((v, i) => ({
    x: +(ORG.x + i * (ORG.w / (CONTROLLED.length - 1))).toFixed(1),
    y: orgY(v),
  }));
  const path = spline(points);

  return (
    <Screen>
      <ScreenHead
        title={{
          hy: "Կազմակերպության վահանակ · 8,420 գրանցված անդամ",
          en: "Organisation dashboard · 8,420 enrolled members",
        }}
      />

      <div className="mt-4 grid gap-3.5 lg:grid-cols-3">
        <Tile className="min-w-0">
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold break-words">
            {t({ hy: "Ռիսկի բաշխումը մասնակիցների շրջանում", en: "Risk distribution across participants" })}
          </p>
          <div className="mt-4 grid gap-3.5">
            {RISK_BANDS.map((band) => (
              <div key={band.label.en}>
                <div className="text-body2 flex justify-between gap-3">
                  <span className="min-w-0 break-words">{t(band.label)}</span>
                  <span className="font-medium tabular-nums">
                    {band.count} · {band.pct}%
                  </span>
                </div>
                <Track pct={band.pct} fill={band.fill} className="mt-2 h-2.5" />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-body2 mt-5 border-t pt-4 text-pretty">
            {t({
              hy: "Այս եռամսյակում ավելի ցածր ռիսկի խումբ անցած անդամներ՝ ",
              en: "Members moving to a lower risk band this quarter: ",
            })}
            <span className="text-[var(--status-success-fg)] font-semibold">412</span>
          </p>
        </Tile>

        <Tile className="min-w-0 lg:col-span-2">
          <p className="font-heading text-[var(--text-strong)] text-body1 font-bold text-balance break-words">
            {t({
              hy: "Սքրինինգ → Հայտնաբերում → Մոնիտորինգ → Միջամտություն → Վերահսկում",
              en: "Screening → Detection → Monitoring → Intervention → Control",
            })}
          </p>

          <ul className="mt-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1">
            {FUNNEL.map((stage) => (
              <li
                key={stage.label.en}
                className={cn(
                  "shrink-0 basis-33 snap-start rounded-xl p-3.5 ring-1 ring-[var(--border-subtle)] sm:flex-1",
                  stage.end ? "bg-[var(--status-success-bg)]" : "bg-card",
                )}
              >
                <p className="text-overline text-muted-foreground">{t(stage.label)}</p>
                <Figure className="mt-2.5">{stage.value}</Figure>
                <Track pct={stage.pct} className="mt-3 h-1.5" />
                <p className="text-muted-foreground text-caption mt-2">{t(stage.note)}</p>
              </li>
            ))}
          </ul>

          <div className="mt-4 overflow-x-auto">
            <svg
              viewBox="0 0 680 158"
              className="h-41 w-full min-w-115"
              role="img"
              aria-label={t({
                hy: "Վերահսկվող գերճնշման դինամիկան բնակչության մեջ, պատկերավոր",
                en: "Population controlled-hypertension trend, illustrative",
              })}
            >
              <defs>
                <linearGradient id="org-wash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--status-success-fg)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--status-success-fg)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {[80, 60, 40].map((v) => (
                <g key={v}>
                  <line
                    x1={ORG.x}
                    y1={orgY(v)}
                    x2={654}
                    y2={orgY(v)}
                    stroke="var(--chart-grid)"
                    strokeWidth="1"
                  />
                  <text
                    x={38}
                    y={orgY(v)}
                    dy="3.6"
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {v}%
                  </text>
                </g>
              ))}

              <path d={area(path, ORG.x, ORG.x + ORG.w, ORG.y + ORG.h)} fill="url(#org-wash)" />
              <path
                d={path}
                fill="none"
                stroke="var(--status-success-fg)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <circle
                  key={p.x}
                  cx={p.x}
                  cy={p.y}
                  r={i === points.length - 1 ? 5 : 3.2}
                  fill={
                    i === points.length - 1
                      ? "var(--status-success-fg)"
                      : "var(--surface-card)"
                  }
                  stroke="var(--status-success-fg)"
                  strokeWidth="2"
                />
              ))}
              {["Q1", "Q2", "Q3", "Q4"].map((label, i) => (
                <text
                  key={label}
                  x={+((points[i * 2].x + points[i * 2 + 1].x) / 2).toFixed(1)}
                  y={150}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="11"
                  fontWeight="600"
                >
                  {label}
                </text>
              ))}
            </svg>
          </div>
          <p className="text-muted-foreground text-caption mt-2.5 text-pretty">
            {t({
              hy: "Գերճնշում ունեցող անդամների այն մասը, որոնց ցուցանիշները վերահսկվում են, չորս եռամսյակի ընթացքում",
              en: "Share of hypertensive members with controlled readings over four quarters",
            })}
          </p>
        </Tile>
      </div>

      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => (
          <Tile key={kpi.label.en}>
            <p className="text-muted-foreground text-body2 text-pretty break-words">{t(kpi.label)}</p>
            <Figure className="text-display3 mt-2">{kpi.value}</Figure>
            <p
              className={cn(
                "text-caption mt-1.5 font-semibold",
                kpi.tone === "good" && "text-[var(--status-success-fg)]",
                kpi.tone === "warn" && "text-brand-gold-deep",
                kpi.tone === "muted" && "text-muted-foreground",
              )}
            >
              {t(kpi.delta)}
            </p>
          </Tile>
        ))}
      </div>
    </Screen>
  );
}
