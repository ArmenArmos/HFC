"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The spot illustrations.
 *
 * Deliberately not unDraw or Open Peeps. Both are good libraries and both are
 * on a hundred thousand other sites, which is the whole problem: their flat
 * blob-people style would sit next to this brand's photography, its navy and
 * its dot wave and read as a third visual system bolted on. A screening product
 * that shows someone their own arteries cannot afford to look like a template.
 *
 * So these are drawn from the vocabulary the rest of the app already speaks.
 * Every scene is built from the same five things:
 *
 *   1. Navy line work, 2.5 units, round caps, no fill of its own.
 *   2. White objects, so they read as paper on any ground.
 *   3. One accent per scene: teal for a measurement, gold for an achievement,
 *      the danger token when a value is out of range.
 *   4. A patch of the dot matrix, fading out. This is the piece that ties a
 *      spot illustration to the wave in the hero: same grid, same pitch.
 *   5. A soft tinted stage behind, so the drawing works on card or on page.
 *
 * They are diagrammatic rather than figurative on purpose. The product's own
 * best pictures are its range lines and its trajectories, and these are drawn
 * in that register. People come from the brand photography, which is real.
 *
 * Decorative in every use, so `aria-hidden` throughout.
 */

const NAVY = "var(--noreon-navy-700)";
const NAVY_SOFT = "var(--noreon-navy-200)";
const TEAL = "var(--noreon-teal-600)";
const TEAL_MID = "var(--noreon-teal-400)";
const TEAL_SOFT = "var(--noreon-teal-100)";
const GOLD = "var(--noreon-gold-600)";
const DANGER = "var(--noreon-danger-600)";
const PAPER = "var(--noreon-white)";
const TRACK = "var(--noreon-gray-200)";

const LINE = {
  stroke: NAVY,
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

export type IllustrationName =
  | "questions"
  | "sample"
  | "results"
  | "trend"
  | "secure"
  | "booked"
  | "waiting"
  | "locked";

export function Illustration({
  name,
  className,
}: {
  name: IllustrationName;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const dots = `${uid}-dots`;
  const fade = `${uid}-fade`;
  const veil = `${uid}-veil`;
  const wash = `${uid}-wash`;

  /** Gold for the two scenes that mark an achievement, teal for the rest. */
  const warm = name === "booked" || name === "trend";
  const stage = warm ? "var(--surface-subtle-gold)" : "var(--surface-subtle-teal)";

  return (
    <svg
      viewBox="0 0 240 180"
      className={cn("h-auto w-full", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern
          id={dots}
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="6" cy="6" r="1.7" fill={warm ? "var(--noreon-gold-400)" : TEAL_MID} />
        </pattern>
        <linearGradient id={fade} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.85" />
          <stop offset="0.7" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={veil}>
          <rect width="240" height="180" fill={`url(#${fade})`} />
        </mask>
        <linearGradient id={wash} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TEAL} stopOpacity="0.22" />
          <stop offset="1" stopColor={TEAL} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The stage, then the dot matrix fading out of the top right corner. */}
      <rect x="8" y="14" width="224" height="152" rx="26" fill={stage} />
      <rect
        x="8"
        y="14"
        width="224"
        height="152"
        rx="26"
        fill={`url(#${dots})`}
        mask={`url(#${veil})`}
      />

      {name === "questions" && <Questions />}
      {name === "sample" && <Sample />}
      {name === "results" && <Results />}
      {name === "trend" && <Trend wash={wash} />}
      {name === "secure" && <Secure />}
      {name === "booked" && <Booked />}
      {name === "waiting" && <Waiting />}
      {name === "locked" && <Locked />}
    </svg>
  );
}

/** A tick, at whatever size and colour the scene needs. */
function Check({ x, y, s = 1, color = PAPER }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <path
      d={`M${x - 7 * s} ${y} l${5 * s} ${5 * s} l${9 * s} ${-10 * s}`}
      stroke={color}
      strokeWidth={3 * s}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

/**
 * Nine questions that branch.
 *
 * One card, and two ways out of it. The solid path is the one the answer took;
 * the dashed one is the branch it did not. This is the single most important
 * thing to say about the assessment and it is hard to say in words.
 */
function Questions() {
  return (
    <>
      <rect x="26" y="64" width="66" height="52" rx="12" {...LINE} fill={PAPER} />
      <rect x="39" y="80" width="40" height="5" rx="2.5" fill={NAVY_SOFT} />
      <rect x="39" y="93" width="26" height="5" rx="2.5" fill={NAVY_SOFT} />

      <path d="M92 90 C 122 90 122 56 148 56" {...LINE} />
      <path d="M92 90 C 122 90 122 124 148 124" {...LINE} strokeDasharray="5 7" />
      <circle cx="92" cy="90" r="5" fill={NAVY} />

      <circle cx="166" cy="56" r="17" fill={TEAL} />
      <Check x={166} y={57} s={1.15} />

      <circle cx="166" cy="124" r="17" fill={PAPER} stroke={NAVY_SOFT} strokeWidth="2.5" />
      <circle cx="166" cy="124" r="5" fill={NAVY_SOFT} />
    </>
  );
}

/** The tests your answers call for. A tube, filled to where it is filled. */
function Sample() {
  return (
    <>
      <path d="M104 48 V104 a16 16 0 0 0 32 0 V48" {...LINE} fill={PAPER} />
      <path d="M104 84 V104 a16 16 0 0 0 32 0 V84 Z" fill={TEAL} />
      <rect x="97" y="32" width="46" height="16" rx="6" {...LINE} fill={PAPER} />
      {/* Graduations, because a sample is a measurement before it is a fluid. */}
      <path d="M104 62 h8 M104 72 h8" stroke={NAVY_SOFT} strokeWidth="2.5" strokeLinecap="round" />

      <circle cx="158" cy="66" r="6" fill={TEAL_MID} />
      <circle cx="172" cy="50" r="4" fill={TEAL_SOFT} />
      <circle cx="164" cy="86" r="3" fill={GOLD} />
      <circle cx="74" cy="72" r="4.5" fill={TEAL_SOFT} />
      <circle cx="66" cy="96" r="3" fill={TEAL_MID} />
    </>
  );
}

/**
 * What came back.
 *
 * Three range lines, and one value outside its own. The product's real artifact,
 * drawn at illustration scale.
 */
function Results() {
  const rows = [
    { y: 78, healthy: 78, at: 96, tone: TEAL },
    { y: 104, healthy: 92, at: 172, tone: DANGER },
    { y: 130, healthy: 70, at: 138, tone: GOLD },
  ];
  return (
    <>
      <rect x="34" y="28" width="172" height="124" rx="16" {...LINE} fill={PAPER} />
      <rect x="50" y="46" width="52" height="7" rx="3.5" fill={NAVY} />
      <rect x="110" y="46" width="22" height="7" rx="3.5" fill={NAVY_SOFT} />
      {rows.map((row) => (
        <g key={row.y}>
          <rect x="50" y={row.y} width="140" height="7" rx="3.5" fill={TRACK} />
          <rect x="50" y={row.y} width={row.healthy} height="7" rx="3.5" fill={TEAL_SOFT} />
          <circle
            cx={50 + row.at * 0.78}
            cy={row.y + 3.5}
            r="8"
            fill={row.tone}
            stroke={PAPER}
            strokeWidth="3"
          />
        </g>
      ))}
    </>
  );
}

/** Where you started, where you are, and where the plan expects you to be. */
function Trend({ wash }: { wash: string }) {
  const points = "58,124 102,114 146,92 190,62";
  return (
    <>
      <path d={`M58 140 L ${points} L 190 140 Z`} fill={`url(#${wash})`} />
      <path d="M44 142 H 200" stroke={NAVY_SOFT} strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M56 62 H 196"
        stroke={TEAL}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="5 7"
        opacity="0.55"
      />
      <polyline
        points={points}
        stroke={TEAL}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {[
        [58, 124],
        [102, 114],
        [146, 92],
      ].map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="5" fill={TEAL} />
      ))}
      <circle cx="190" cy="62" r="10" fill={GOLD} stroke={PAPER} strokeWidth="3.5" />
    </>
  );
}

/** What happens to what you told us. */
function Secure() {
  return (
    <>
      <path
        d="M120 26 L176 48 V96 C176 124 150 146 120 154 C90 146 64 124 64 96 V48 Z"
        {...LINE}
        fill={PAPER}
      />
      <path
        d="M99 92 l15 15 l28 -32"
        stroke={TEAL}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  );
}

/** A visit, on a day. */
function Booked() {
  const cols = [78, 108, 138, 168];
  const rows = [104, 132];
  return (
    <>
      <rect x="48" y="46" width="144" height="106" rx="16" {...LINE} fill={PAPER} />
      <path d="M48 78 H 192" stroke={NAVY} strokeWidth="2.5" />
      <path d="M84 34 V 54 M156 34 V 54" {...LINE} />
      {rows.map((y) =>
        cols.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill={NAVY_SOFT} />),
      )}
      <circle cx="138" cy="104" r="15" fill={GOLD} />
      <Check x={138} y={105} s={1} />
    </>
  );
}

/** Samples are with the laboratory. Nothing to do but say so. */
function Waiting() {
  const ring = [
    { a: -90, r: 4, o: 0.35 },
    { a: -30, r: 5.5, o: 0.6 },
    { a: 30, r: 7, o: 1 },
  ];
  return (
    <>
      <circle
        cx="120"
        cy="90"
        r="50"
        stroke={NAVY_SOFT}
        strokeWidth="2.5"
        strokeDasharray="3 9"
        strokeLinecap="round"
        fill="none"
      />
      {ring.map(({ a, r, o }) => {
        const rad = (a * Math.PI) / 180;
        return (
          <circle
            key={a}
            cx={120 + 50 * Math.cos(rad)}
            cy={90 + 50 * Math.sin(rad)}
            r={r}
            fill={TEAL}
            opacity={o}
          />
        );
      })}
      <circle cx="120" cy="90" r="26" {...LINE} fill={PAPER} />
      <path d="M120 74 V 90 l 11 8" {...LINE} />
    </>
  );
}

/** A route the journey has not reached yet. */
function Locked() {
  return (
    <>
      <path d="M102 96 V 78 a18 18 0 0 1 36 0 V 96" {...LINE} />
      <rect x="84" y="96" width="72" height="54" rx="14" {...LINE} fill={PAPER} />
      <circle cx="120" cy="116" r="6" fill={NAVY} />
      <path d="M120 121 V 132" stroke={NAVY} strokeWidth="6" strokeLinecap="round" />
    </>
  );
}
