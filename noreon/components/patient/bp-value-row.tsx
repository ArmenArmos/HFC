"use client";
import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { BP_FIELDS, bpValueText, clampBp, readBp, stepBp, thumbBp, typedBp, type BpField } from "./bp-entry-values";

/**
 * One reading: a big number you can tap to type, ± for fine-tuning and a slider for the rough value.
 * All three write the same string, so they cannot disagree. An untouched row shows "—", a hollow
 * thumb resting mid-track and "Not set", and saves nothing.
 */
export function BpValueRow({ field, locale, label, unit, value, disabled, invalid, onChange, onEnter, idPrefix = "", compact = false }: {
  field: BpField; locale: PatientLocale; label: string; unit: string; value: string; disabled: boolean;
  invalid: boolean; onChange: (raw: string) => void; onEnter?: () => void;
  /** Several entries on one screen (Zoe chat BP cards): each gets its own ids. */
  idPrefix?: string;
  compact?: boolean;
}) {
  const { min, max, ticks } = BP_FIELDS[field];
  const reading = readBp(field, value);
  const set = reading.state === "set";
  // A number left half-typed ("12") is flagged once the member moves on, not while they type.
  const [left, setLeft] = useState(false);
  const focusedFull = useRef(false);
  const flagged = invalid || (left && reading.state === "partial");
  const inputId = `${idPrefix}${field}`, labelId = `${inputId}-label`;
  const at = (n: number) => `${((n - min) / (max - min)) * 100}%`;
  const step = (delta: number) => onChange(stepBp(field, value, delta));
  /**
   * A finger on a slider is a slide only once it moves sideways. Base UI sets the value at touchstart
   * and on every touchmove by finger X, so a vertical scroll that starts on the slider used to change
   * the reading (Fable F1). Until the direction is known, Base UI's values are held; a vertical start
   * drops them and lets the sheet scroll (touch-pan-y); a still finger is a tap and sets the value.
   */
  const touch = useRef<{ x: number; y: number; mode: "pending" | "slide" | "scroll"; held?: number; onThumb: boolean; down: boolean } | null>(null);
  const take = (next: number) => onChange(String(clampBp(field, next)));
  // Base UI keeps reporting touchmoves after the browser has taken a scroll, and commits on touchend,
  // so the gesture is forgotten only after touchend has been handled.
  const forget = () => { const t = touch.current; setTimeout(() => { if (touch.current === t) touch.current = null; }, 0); };
  const stepButton = "grid size-12 shrink-0 place-items-center rounded-full border border-input bg-card text-foreground transition-colors hover:bg-muted active:bg-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40";
  const numberInput = <input id={inputId} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
        enterKeyHint={field === "pulse" ? "done" : "next"} placeholder="—" value={value} disabled={disabled}
        aria-invalid={flagged || undefined} aria-describedby={`${idPrefix}bp-summary`}
        className={cn("h-12 min-w-20 flex-1 rounded-xl border-2 bg-transparent text-center font-heading text-[2.5rem] leading-none font-bold tabular-nums outline-none transition-colors",
          "border-transparent placeholder:text-muted-foreground/70 [@media(hover:hover)]:hover:border-border focus:border-ring focus:bg-card focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "aria-invalid:border-destructive aria-invalid:border-dashed")}
        onChange={event => { setLeft(false); const first = focusedFull.current; focusedFull.current = false; onChange(typedBp(event.target.value, value, first)); }}
        onBlur={() => setLeft(true)}
        // Tap a filled box and type: the new reading replaces the old (select, and again after iOS places the caret).
        onFocus={event => { const box = event.currentTarget; focusedFull.current = box.value.length === 3; box.select(); setTimeout(() => { if (document.activeElement === box) box.setSelectionRange(0, box.value.length); }, 0); }}
        onKeyDown={event => {
          if (event.key === "ArrowUp") { event.preventDefault(); step(1); }
          else if (event.key === "ArrowDown") { event.preventDefault(); step(-1); }
          else if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); }
        }} />;
  if (compact) return <div className="ms-bp-field" data-bp-row={field} data-bp-state={reading.state}>
    <label id={labelId} htmlFor={inputId}>{label}</label>
    {numberInput}
    <span>{set ? unit : tx(locale, "Նշված չէ", "Not set", "Не указано")}</span>
  </div>;
  return <div role="group" aria-labelledby={labelId} data-bp-row={field} data-bp-state={reading.state} className="min-w-0">
    <div className="flex items-baseline justify-between gap-3">
      <label id={labelId} htmlFor={inputId} className="text-body2 font-semibold">{label}</label>
      <span className="text-caption text-muted-foreground">{set ? unit : tx(locale, "Նշված չէ", "Not set", "Не указано")}</span>
    </div>
    <div className="mt-0.5 flex items-center gap-3">
      <button type="button" className={stepButton} disabled={disabled || (set && reading.value <= min)}
        aria-label={`${tx(locale, "Նվազեցնել", "Decrease", "Уменьшить")} ${label}`} onClick={() => step(-1)}>
        <Minus className="size-6" aria-hidden />
      </button>
      {numberInput}
      <button type="button" className={stepButton} disabled={disabled || (set && reading.value >= max)}
        aria-label={`${tx(locale, "Ավելացնել", "Increase", "Увеличить")} ${label}`} onClick={() => step(1)}>
        <Plus className="size-6" aria-hidden />
      </button>
    </div>
    <Slider className="touch-pan-y px-[22px]" min={min} max={max} step={1} value={thumbBp(field, value)} disabled={disabled}
      // A drag, a tap on the track and a press on the thumb all count as the member choosing a value.
      onValueChange={next => {
        const t = touch.current;
        if (!t) take(next as number);
        else if (t.mode === "slide") take(next as number);
        else if (t.mode === "pending") t.held = next as number;
      }}
      onValueCommitted={next => { if (!touch.current && !set) take(next as number); }}
      // Capture: Base UI's own handler on the inner control would otherwise report a value first.
      onPointerDownCapture={event => {
        if (disabled) return;
        const onThumb = Boolean((event.target as HTMLElement).closest("[data-bp-thumb]"));
        if (event.pointerType === "touch") { touch.current = { x: event.clientX, y: event.clientY, mode: "pending", onThumb, down: true }; return; }
        touch.current = null;
        // Pressing the resting thumb changes no value, so Base UI reports nothing; the press itself sets it.
        if (!set && onThumb) take(thumbBp(field, value));
      }}
      onPointerMoveCapture={event => {
        const t = touch.current;
        if (!t?.down || t.mode !== "pending") return;
        const dx = event.clientX - t.x, dy = event.clientY - t.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        t.mode = Math.abs(dx) > Math.abs(dy) ? "slide" : "scroll";
        if (t.mode === "slide" && t.held !== undefined) take(t.held);
      }}
      onPointerUp={() => {
        const t = touch.current;
        if (t?.down && t.mode === "pending") {
          // A tap on the thumb keeps its value (a small wobble must not nudge it); a tap on the track moves there.
          if (t.onThumb) { if (!set) take(thumbBp(field, value)); }
          else if (t.held !== undefined) take(t.held);
        }
        if (t) t.down = false;
      }}
      onPointerCancel={() => { const t = touch.current; if (t?.down && t.mode === "pending") t.mode = "scroll"; if (t) t.down = false; }}
      onTouchEnd={forget} onTouchCancel={forget}
      onKeyDown={() => { touch.current = null; }}>
      <SliderControl className="h-11">
        <SliderTrack className={cn("h-2", !set && "bg-muted")}>
          {set && <SliderIndicator />}
          <SliderThumb data-bp-thumb={field} aria-label={label} getAriaValueText={() => bpValueText(locale, field, value)}
            className={cn("size-11 border-[3px] has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring", set ? "border-brand-teal bg-card" : "border-dashed border-input bg-muted shadow-none")} />
        </SliderTrack>
      </SliderControl>
      <div aria-hidden className="relative h-4 text-caption leading-none text-muted-foreground tabular-nums">
        {ticks.map(n => <span key={n} className="absolute top-0 -translate-x-1/2" style={{ left: at(n) }}>{n}</span>)}
      </div>
    </Slider>
  </div>;
}
