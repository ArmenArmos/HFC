"use client";

import { cn } from "@/lib/utils";

/**
 * The setting an icon sits in.
 *
 * A bare lucide glyph on an ivory page has no weight and no colour, so every
 * icon in the product reads as the same grey suggestion. This gives it a
 * ground: a tinted disc, a hairline ring one step darker, and the icon in the
 * accent itself. Three sizes, and the tone says what kind of moment it is
 * rather than which colour was to hand.
 */
const TONE = {
  /** The ordinary case: something the product is doing or measuring. */
  teal: "bg-[var(--surface-subtle-teal)] text-brand-teal ring-[var(--noreon-teal-100)]",
  /** An achievement, a reminder, a moment worth marking. */
  gold: "bg-[var(--surface-subtle-gold)] text-brand-gold-deep ring-[var(--noreon-gold-100)]",
  /** Structure and authority: numbered steps, ranks, the product itself. */
  navy: "bg-brand-navy text-on-inverse ring-[var(--noreon-navy-600)]",
  /** Inside a navy panel, where the tinted discs disappear. */
  inverse: "bg-on-inverse/10 text-brand-mint ring-on-inverse/15",
  /** Something is wrong and the screen should say so before it is read. */
  danger:
    "bg-[var(--marker-out-bg)] text-[var(--marker-out-fg)] ring-red-400/30",
} as const;

const SIZE = {
  sm: "size-9 [&_svg]:size-4",
  default: "size-11 [&_svg]:size-5",
  lg: "size-14 [&_svg]:size-6",
} as const;

export function Medallion({
  children,
  tone = "teal",
  size = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full ring-1 ring-inset",
        TONE[tone],
        SIZE[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
