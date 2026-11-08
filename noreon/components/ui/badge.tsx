import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A one-word status. If the text can wrap, it is an `Alert`, not a badge.
 *
 * The shape here is the house pill, not the stock base-nova one. Stock was
 * `h-5 px-2 py-0.5 text-xs rounded-4xl`, while every hand-rolled pill in this
 * product had independently converged on `text-overline px-2.5 py-1
 * rounded-pill`. Twenty of them agreed with each other and disagreed with the
 * primitive, so the primitive is what moved.
 *
 * The tones are the ones the product actually has. Stock shipped `default`,
 * `secondary`, `destructive`, `outline`, `ghost` and `link`, which are the
 * shadcn defaults and describe a generic app: none of them could express "this
 * measurement is out of range" or "a doctor approved this", so every call site
 * wrote the pair by hand and no two agreed on the ring opacity. A tone that the
 * product needs belongs in the variant list.
 */
const badgeVariants = cva(
  "group/badge text-overline inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-pill px-2.5 py-1 whitespace-nowrap ring-1 ring-inset transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ring-transparent",
        secondary: "bg-secondary text-secondary-foreground ring-transparent",
        /** The quiet one: a fact about timing, not a verdict. */
        muted: "bg-muted text-muted-foreground ring-[var(--border-subtle)]",
        outline: "bg-card text-foreground ring-[var(--border-subtle)]",
        /** A hairline chip whose label is an aside, not a status. */
        "outline-muted":
          "bg-transparent text-muted-foreground ring-[var(--border-subtle)]",
        /** The brand accent. The most common chip in the product. */
        teal: "bg-[var(--surface-subtle-teal)] text-brand-teal ring-[var(--noreon-teal-100)]",
        success:
          "bg-[var(--status-success-bg)] text-[var(--status-success-fg)] ring-[var(--status-success-fg)]/20",
        warning:
          "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-[var(--status-warning-fg)]/30",
        /** The biomarker verdict tones, which are not the status tones. */
        attention:
          "bg-[var(--marker-attention-bg)] text-[var(--marker-attention-fg)] ring-[var(--marker-attention-fg)]/20",
        danger:
          "bg-[var(--marker-out-bg)] text-[var(--marker-out-fg)] ring-[var(--marker-out-fg)]/25",
        /**
         * Grandfathered. Gold is closed to new work per DESIGN.md; this exists
         * so `ApprovalBadge` can keep its tone without hand-writing the pair.
         */
        gold: "bg-[var(--surface-subtle-gold)] text-brand-gold-deep ring-[var(--noreon-gold-200)]",
        /** Inside a navy `Panel`, where every tinted chip above disappears. */
        inverse: "bg-on-inverse/10 text-on-inverse-muted ring-transparent",
        "inverse-strong": "bg-on-inverse text-brand-navy ring-transparent",
        /** Approval on the navy ground, where teal reads as grey. */
        "inverse-success": "bg-brand-mint/15 text-brand-mint ring-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {},
  })
}

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export { Badge, badgeVariants }
export type { BadgeVariant }
