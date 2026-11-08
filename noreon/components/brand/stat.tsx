"use client";

import { cn } from "@/lib/utils";

/**
 * A measurement, set as the thing the screen is actually about.
 *
 * This product's content is numbers, and a number set at body size beside its
 * label is a table cell. The design system pairs Manrope with the instruction
 * that it carries "headings, numbers, titles", so the value takes the display
 * face at a heading size, tabular so a column of them does not wobble, with the
 * unit dropped to caption weight beside it. The label sits above in the overline
 * step rather than below, because the reader wants to know what they are looking
 * at before they read it.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "default",
  size = "default",
  className,
}: {
  label?: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "inverse" | "accent";
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <p
          className={cn(
            "text-overline truncate",
            tone === "inverse" ? "text-on-inverse-muted" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
      )}
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-heading tabular-nums tracking-tight",
            size === "lg" ? "text-display3" : "text-h1",
            tone === "accent" && "text-brand-teal",
          )}
        >
          {value}
        </span>
        {unit && (
          <span
            className={cn(
              "text-caption",
              tone === "inverse" ? "text-on-inverse-muted" : "text-muted-foreground",
            )}
          >
            {unit}
          </span>
        )}
      </p>
      {hint && (
        <p
          className={cn(
            "mt-1 text-caption text-pretty",
            tone === "inverse" ? "text-on-inverse-muted" : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
