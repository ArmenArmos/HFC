"use client";

import { DotField } from "@/components/brand/dot-field";
import { cn } from "@/lib/utils";

/**
 * A deep panel, for the moments the product wants weight.
 *
 * Deep Navy is the brand's primary colour and carries "trust, science,
 * authority" in the brand book, but as long as it only ever appears on a button
 * it never actually behaves like a primary colour. This is where it becomes a
 * ground: the report verdict, the progress summary, the clinical monitor, the
 * close of the loop. Everything between those stays on the warm ivory, so the
 * journey has a rhythm rather than seventeen identical pages.
 *
 * Flat navy over a large area goes dead, so the ground is a gradient with a
 * light source in one corner, a slow glow behind it, and the wave running
 * through. Three cheap layers, none of which the reader is meant to notice
 * individually.
 */
export function Panel({
  children,
  tone = "navy",
  wave = true,
  className,
  /** So a panel that is a landmark stays one. */
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  /** `warm` is ivory and gold, for an achievement rather than a measurement. */
  tone?: "navy" | "warm";
  wave?: boolean;
  className?: string;
  as?: "div" | "section" | "aside";
} & React.ComponentProps<"div">) {
  const navy = tone === "navy";

  return (
    <Tag
      {...rest}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl",
        navy ? "text-on-inverse" : "text-foreground ring-1 ring-[var(--border-subtle)]",
        className,
      )}
      style={{ backgroundImage: `var(${navy ? "--panel-inverse" : "--panel-warm"})` }}
    >
      <span
        aria-hidden
        className="breathe pointer-events-none absolute -top-1/3 -right-1/4 -z-10 aspect-square w-2/3"
        style={{
          backgroundImage: `var(${navy ? "--panel-glow" : "--panel-glow-gold"})`,
        }}
      />
      {wave && (
        /* The wave is banded across the top rather than stretched over the
           whole panel. `slice` scales to cover, so a tall narrow panel blows
           the dot grid up until it reads as polka dots instead of a matrix:
           on a phone the hero is three times taller than it is wide, and the
           pitch grew by two and a half times. Pinning the box to the figure's own
           aspect ratio keeps the pitch tied to the width alone. */
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 aspect-[60/21] w-full overflow-hidden"
        >
          <DotField
            tone={navy ? "mint" : "gold"}
            className={navy ? "opacity-80" : "opacity-90"}
          />
        </div>
      )}
      {children}
    </Tag>
  );
}

/**
 * The label above a heading, with the rule that anchors it.
 *
 * The design system has an overline step in the type scale and no instruction
 * on what to do with it. This is that instruction: a short teal rule, then the
 * label, so a section head has a shape before it has a word. It repeats often
 * enough to be the thing that makes two consecutive screens look like one
 * product.
 */
export function Eyebrow({
  children,
  tone = "teal",
  className,
}: {
  children: React.ReactNode;
  tone?: "teal" | "gold" | "inverse";
  className?: string;
}) {
  const rule = {
    teal: "bg-brand-teal",
    gold: "bg-brand-gold",
    inverse: "bg-brand-mint",
  }[tone];
  const text = {
    teal: "text-muted-foreground",
    gold: "text-brand-gold-deep",
    inverse: "text-on-inverse-muted",
  }[tone];

  return (
    <p className={cn("text-overline flex items-center gap-2.5", text, className)}>
      <span className={cn("h-px w-6 shrink-0 rounded-pill", rule)} aria-hidden />
      {children}
    </p>
  );
}
