"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The Noreon wave.
 *
 * The design system's signature graphic is a matrix of dots that fans out of a
 * point and resolves into a wave. It is the product's own claim drawn as a
 * mark: scattered measurements becoming one legible signal. `public/brand/wave/`
 * ships it as six flat PNGs, which are page crops at fixed sizes in fixed
 * colours, so this redraws the same figure from the tokens instead.
 *
 * The construction is three passes over one fan of arcs. Each pass strokes the
 * arcs with the brand gradient, blurs them, and then masks the result through a
 * grid of dots. Narrow stroke plus large dots gives the saturated crest; wide
 * stroke plus small dots gives the haze that falls away from it. Stacking the
 * three reproduces both the opacity falloff and the change in dot size, which
 * is the part that makes the figure read as a wave rather than as a texture.
 *
 * It is decorative in every use, so it is `aria-hidden` and inert.
 */

/** The fan. Seven arcs leaving one point on the left and opening to the right. */
const BANDS = [-3, -2, -1, 0, 1, 2, 3];

const path = (k: number) =>
  `M 110 258 C 470 ${244 + k * 7} 760 ${206 + k * 27} 1260 ${134 + k * 60}`;

/**
 * The pitch of the matrix, in viewBox units. It is the one number that decides
 * whether the figure reads as a fine screen or as polka dots, so it is a single
 * knob: the dot radii below are quoted against it, not against absolute units.
 */
const PITCH = 10;

/**
 * Crest first, haze last. `dot` is the radius as a fraction of the pitch, `band`
 * the stroke width of the arc, `blur` how softly it falls off. Holding the radii
 * as fractions means the fill stays put when the pitch moves, so a finer grid
 * gives smaller dots without thinning the wave out.
 */
const PASSES = [
  { dot: 0.058, band: 104, blur: 26 },
  { dot: 0.094, band: 48, blur: 14 },
  { dot: 0.142, band: 21, blur: 7 },
];

const TONE = {
  /** On the ivory ground. */
  teal: ["var(--wave-teal-from)", "var(--wave-teal-to)"],
  /** On the navy ground, where the teal ramp goes muddy. */
  mint: ["var(--wave-mint-from)", "var(--wave-mint-to)"],
  /** Achievement rather than measurement. Holds on either ground. */
  gold: ["var(--wave-gold-from)", "var(--wave-gold-to)"],
} as const;

export function DotField({
  tone = "teal",
  className,
  /** Mirrored, for the cases where the fan should open to the left. */
  flip = false,
  /** Skips the one-time draw-in, for a field that is already on screen. */
  still = false,
  sweepDelay,
}: {
  tone?: keyof typeof TONE;
  className?: string;
  flip?: boolean;
  still?: boolean;
  sweepDelay?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const [from, to] = TONE[tone];

  return (
    <svg
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        !still && "sweep",
        flip && "-scale-x-100",
        className,
      )}
      style={
        sweepDelay === undefined
          ? undefined
          : ({ "--sweep-delay": `${sweepDelay}ms` } as React.CSSProperties)
      }
    >
      <defs>
        {/* Along the length rather than across it: the fan is faintest where
            the arcs converge and fullest where they have opened. */}
        <linearGradient id={`${uid}-ramp`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: from }} stopOpacity="0" />
          <stop offset="0.26" style={{ stopColor: from }} stopOpacity="0.5" />
          <stop offset="0.68" style={{ stopColor: to }} stopOpacity="1" />
          <stop offset="1" style={{ stopColor: to }} stopOpacity="0.92" />
        </linearGradient>

        {PASSES.map((pass, i) => (
          <pattern
            key={`p${i}`}
            id={`${uid}-grid-${i}`}
            width={PITCH}
            height={PITCH}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={PITCH / 2}
              cy={PITCH / 2}
              r={pass.dot * PITCH}
              fill="white"
            />
          </pattern>
        ))}

        {PASSES.map((pass, i) => (
          <mask key={`m${i}`} id={`${uid}-dots-${i}`}>
            <rect width="1200" height="420" fill={`url(#${uid}-grid-${i})`} />
          </mask>
        ))}

        {PASSES.map((pass, i) => (
          <filter
            key={`f${i}`}
            id={`${uid}-soft-${i}`}
            x="-15%"
            y="-40%"
            width="130%"
            height="180%"
          >
            <feGaussianBlur stdDeviation={pass.blur} />
          </filter>
        ))}
      </defs>

      {PASSES.map((pass, i) => (
        <g key={i} mask={`url(#${uid}-dots-${i})`}>
          <g filter={`url(#${uid}-soft-${i})`}>
            {BANDS.map((k) => (
              <path
                key={k}
                d={path(k)}
                fill="none"
                stroke={`url(#${uid}-ramp)`}
                strokeWidth={pass.band}
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
