import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A notice about the state of something on the screen.
 *
 * The padding, the radius and the type sizes here are the whole point of the
 * component. Before it was used, every notice in the product was a hand-rolled
 * div, so a "demo data" caveat came out as a 999px pill wrapping to three lines
 * while the notice above it was a tidy padded box. Same job, two shapes.
 *
 * `p-4` is the design system's card padding, `--space-4`. `rounded-lg` is 12px
 * here, one step inside the 16px `rounded-xl` of the Card these usually sit in:
 * a nested corner has to be tighter than the corner containing it or the two
 * radii fight. The stock base-nova values were `px-2.5 py-2`, which is 10px and
 * off the 8px grid.
 *
 * The status variants take the reserved status tokens rather than the brand
 * ramps. That matters beyond naming: `--status-warning-bg` and the brand's
 * `--surface-subtle-gold` are the same hex today, so this is not a visual
 * change, but a caveat is a status and should move with the status palette
 * rather than with Warm Gold.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-1 rounded-lg border p-4 text-left text-body2 has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground [&>svg]:text-muted-foreground",
        success:
          "border-[var(--status-success-fg)]/25 bg-[var(--status-success-bg)] text-foreground [&>svg]:text-[var(--status-success-fg)]",
        warning:
          "border-[var(--status-warning-fg)]/25 bg-[var(--status-warning-bg)] text-foreground [&>svg]:text-[var(--status-warning-fg)]",
        info: "border-[var(--status-info-fg)]/25 bg-[var(--status-info-bg)] text-foreground [&>svg]:text-[var(--status-info-fg)]",
        destructive:
          "border-[var(--status-danger-fg)]/25 bg-[var(--status-danger-bg)] text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * `as` exists so a notice that is a landmark on the page stays one. Most alert
 * titles are labels and a div is right; the "when to stop" notice on the
 * activity screen is a section heading that happens to be urgent, and demoting
 * it to a div would drop it out of the document outline.
 */
function AlertTitle({
  className,
  as: Tag = "div",
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "h2" | "h3" | "h4" }) {
  return (
    <Tag
      data-slot="alert-title"
      className={cn(
        "text-body2 font-medium text-pretty group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-caption text-muted-foreground text-pretty group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-4 right-4", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants }
