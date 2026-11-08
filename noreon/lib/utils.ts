import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The design system's type scale, as `text-*` utilities.
 *
 * `app/globals.css` declares these in the `@theme` block, so Tailwind generates
 * `text-h1`, `text-body2` and friends as font sizes. tailwind-merge does not
 * read the theme: it ships with Tailwind's default scale, does not recognise
 * these names as sizes, and therefore classifies them as text *colours*. Any
 * `cn("text-overline", "text-muted-foreground")` then resolved to the colour
 * alone and the size was silently dropped, which is how an eleven pixel
 * overline came out at sixteen.
 *
 * Teaching the merger the scale is the fix. Sizes and colours conflict with
 * their own kind again, and both survive together.
 */
const NOREON_TEXT_SIZES = [
  "display1",
  "display2",
  "display3",
  "h1",
  "h2",
  "h3",
  "body1",
  "body2",
  "caption",
  "overline",
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...NOREON_TEXT_SIZES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
