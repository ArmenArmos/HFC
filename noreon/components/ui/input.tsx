import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The two grounds this product has, as a variant rather than a patch.
 *
 * Everything colour-bearing lives in the variants and nothing colour-bearing
 * lives in the base, so a ground cannot be half-applied. The call sites used to
 * write `text-on-inverse border-white/25 bg-white/10` and stop there, which
 * leaves `placeholder:text-muted-foreground` and `focus-visible:border-ring`
 * still pointing at the light page. `cn()` cannot catch that: a modifier is its
 * own bucket, so the light-page value survives the merge and simply waits for
 * the state that reveals it. That is the bug that produced a black label on a
 * navy button, and a field is the same shape of mistake waiting to happen.
 */
const inputVariants = cva(
  "h-8 w-full min-w-0 rounded-lg border bg-clip-padding px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
  {
    variants: {
      variant: {
        default:
          "border-input bg-transparent text-foreground file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        inverse:
          "border-on-inverse/25 bg-on-inverse/10 text-on-inverse file:text-on-inverse placeholder:text-on-inverse-muted focus-visible:border-brand-mint focus-visible:ring-brand-mint/40 disabled:bg-on-inverse/5 aria-invalid:border-red-300 aria-invalid:ring-red-300/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * `onValueChange` is in the type because it is the prop that actually fires.
 *
 * This renders Base UI's Input, which is a Field control: it supplies its own
 * `onChange` internally and reports edits through `onValueChange(value, details)`.
 * Typing `props` as `ComponentProps<"input">` alone advertises an `onChange`
 * whose behaviour depends on Base UI's prop merging, and hides the prop the
 * library documents. Both are listed, so the working one is discoverable.
 */
function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> &
  Pick<InputPrimitive.Props, "onValueChange"> &
  VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
