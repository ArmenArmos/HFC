"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

/**
 * The whole card is the control.
 *
 * `RadioGroupItem` is the dot: `aspect-square size-4 rounded-full`, meant to sit
 * beside a label. This product asks a different question, where the option is a
 * wrapping sentence, the target is the whole box, and a red-flag answer has to
 * be able to look like one. That was hand-rolled as a `<button role="radio">`
 * inside a `<div role="radiogroup">`, which paints correctly and behaves
 * wrongly: ARIA roles do not bring behaviour with them, so every option was a
 * tab stop and the arrow keys did nothing. A radio group is meant to be one tab
 * stop that you then arrow through.
 *
 * Wrapping the stock item in a `<label>` does not work either. `Radio.Root`
 * renders a `<button>`, a button is not a labelable element, and a `<label>`
 * only forwards clicks to something labelable. So the card is the root, and the
 * dot becomes presentation driven off `data-checked`.
 */
function RadioGroupCard({
  className,
  children,
  ...props
}: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-card"
      className={cn(
        "group/radio-card press flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-body2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      <span
        className="grid size-4.5 shrink-0 place-items-center rounded-full border border-input group-data-checked/radio-card:border-current group-data-checked/radio-card:bg-current"
        aria-hidden
      >
        <RadioPrimitive.Indicator>
          <span className="bg-card block size-1.5 rounded-full" />
        </RadioPrimitive.Indicator>
      </span>
      {children}
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupCard }
