"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full touch-none select-none", className)}
      {...props}
    />
  )
}

/**
 * The hit area, which is deliberately taller than the track it draws.
 *
 * A 8px track is the right weight to look at and the wrong one to aim at, so
 * the control keeps a 44px target around it and the track sits centred inside.
 */
function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
  return (
    <SliderPrimitive.Control
      data-slot="slider-control"
      className={cn("flex h-11 w-full cursor-pointer items-center", className)}
      {...props}
    />
  )
}

function SliderTrack({ className, ...props }: SliderPrimitive.Track.Props) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn(
        "relative h-2 w-full rounded-pill bg-[var(--chart-track)]",
        className
      )}
      {...props}
    />
  )
}

function SliderIndicator({
  className,
  ...props
}: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      data-slot="slider-indicator"
      className={cn("bg-brand-teal rounded-pill", className)}
      {...props}
    />
  )
}

function SliderThumb({ className, ...props }: SliderPrimitive.Thumb.Props) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        "bg-card border-brand-teal size-6 cursor-grab rounded-full border-2 shadow-[var(--shadow-md)] transition-[box-shadow,transform] outline-none",
        // The thumb holds a visually hidden range input at its full size, so
        // the input is what the pointer is actually over. Without this it wins
        // the cursor and the handle looks unpickable.
        "data-[dragging]:cursor-grabbing [&_input]:cursor-[inherit]",
        "focus-visible:ring-ring/50 focus-visible:ring-4",
        "data-[dragging]:scale-110",
        className
      )}
      {...props}
    />
  )
}

function SliderValue({ className, ...props }: SliderPrimitive.Value.Props) {
  return (
    <SliderPrimitive.Value
      data-slot="slider-value"
      className={cn("text-body2 tabular-nums", className)}
      {...props}
    />
  )
}

export {
  Slider,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
  SliderValue,
}
