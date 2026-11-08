"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A filled bar with a value behind it.
 *
 * `size` and `tone` exist because the product had four hand-rolled versions of
 * this and every one of them was a bare `div` with `style={{ width }}`. A
 * `div` that is 60% wide looks finished and tells a screen reader nothing:
 * there is no role, no value, no maximum, so the bar simply does not exist for
 * anyone not looking at it. Going through the primitive is what supplies
 * `role="progressbar"` and `aria-valuenow`.
 *
 * The track and indicator are composed by `Progress` itself rather than passed
 * in, so the colours have to be variants. Handing the call site a
 * `trackClassName` would be the same mistake in a new shape.
 */
const trackVariants = cva(
  "relative flex w-full items-center overflow-hidden rounded-pill bg-[var(--chart-track)]",
  {
    variants: {
      size: { sm: "h-1", default: "h-1.5", lg: "h-2.5" },
    },
    defaultVariants: { size: "default" },
  }
)

const indicatorVariants = cva("h-full rounded-pill transition-all duration-500", {
  variants: {
    tone: {
      default: "bg-primary",
      teal: "bg-brand-teal",
      /** Below the line a clinician cares about. */
      attention: "bg-[var(--chart-3)]",
      /* The management dashboard's two, which resolve only inside
         `[data-viz="dashboard"]`. They are variants rather than a className on
         the call site for the reason in this file's header: handing the caller a
         `trackClassName` would be the same mistake in a new shape. */
      viz: "bg-[var(--viz-series)]",
      "viz-attention": "bg-[var(--viz-attention)]",
    },
  },
  defaultVariants: { tone: "default" },
})

function Progress({
  className,
  children,
  value,
  size,
  tone,
  ...props
}: ProgressPrimitive.Root.Props &
  VariantProps<typeof trackVariants> &
  VariantProps<typeof indicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex w-full flex-wrap items-center gap-x-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack className={trackVariants({ size })}>
        <ProgressIndicator className={indicatorVariants({ tone })} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(trackVariants(), className)}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(indicatorVariants(), className)}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-caption font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn("ml-auto text-caption text-muted-foreground tabular-nums", className)}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
  trackVariants,
  indicatorVariants,
}
