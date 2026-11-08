"use client";
import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tx, type PatientLocale } from "@/lib/patient/copy";

const BOX = "h-16 min-w-0 text-center text-2xl font-medium tabular-nums md:text-2xl";
/** The slider gesture in progress (one finger, one control at a time); a control that goes away ends it. */
let stopPointer: (() => void) | null = null;
function EndGestureOnUnmount() {
  useEffect(() => () => { stopPointer?.(); }, []);
  return null;
}
const readDecimal = (raw: string) => raw === "" ? null : Number(raw.replace(",", "."));

/** Armenian and Russian keypads type a comma. A number input drops it, so 7,5 became 75. */
function DecimalBox({ id, value, disabled, onFocus, onChange }: {
  id: string; value: number | null; disabled: boolean;
  onFocus: (input: HTMLInputElement) => void; onChange: (value: number | null) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return <Input id={id} type="text" inputMode="decimal" autoComplete="off" placeholder="—" disabled={disabled} className={BOX}
    value={typed !== null && Object.is(readDecimal(typed), value) ? typed : value ?? ""}
    onFocus={e => onFocus(e.currentTarget)}
    onChange={e => { setTyped(e.target.value); onChange(readDecimal(e.target.value)); }} />;
}

export function NumericAnswer({
  id,
  label,
  value: saved,
  min,
  max,
  step = 1,
  disabled,
  notProvided = false,
  locale,
  slider = true,
  startingValue,
  unit,
  openMax = false,
  compact = false,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  notProvided?: boolean;
  locale: PatientLocale;
  slider?: boolean;
  startingValue?: number;
  /** Shown after numbers in slider text; omitted when the answer has no unit. */
  unit?: string;
  /** The top means "max or more": shown as "max+", and a saved answer above it displays at the top. */
  openMax?: boolean;
  /** Inside a chat bubble: no card around it, one line of help, the range always in view. */
  compact?: boolean;
  onChange: (value: number | null) => void;
}) {
  const withUnit = (n: number | string) => (unit ? `${n} ${unit}` : `${n}`);
  const bounded = min !== undefined && max !== undefined;
  const open = openMax && max !== undefined;
  const topLabel = open ? `${max}+` : `${max}`;
  // A saved answer above an open top is kept as saved and shown at the top.
  const value = open && saved !== null && saved > max ? max : saved;
  const valueText = (n: number) => withUnit(open && n >= max ? topLabel : n);
  const validRangeValue = value !== null && Number.isFinite(value) &&
    (min === undefined || value >= min) && (max === undefined || value <= max) &&
    Math.abs(value / step - Math.round(value / step)) < 0.000001;
  // In the chat a number on its way to being typed never swaps the slider out: Confirm says what is wrong.
  const sliderValue = validRangeValue ? value! : Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value !== null && Number.isFinite(value) ? value : min ?? 0));
  // Where an unanswered control starts: the caller's typical value, else the
  // midpoint. Only a starting point; nothing is chosen until the member acts.
  const start = bounded
    ? Math.min(max, Math.max(min, startingValue ?? Number((min + Math.round((max - min) / 2 / step) * step).toFixed(6))))
    : startingValue;
  const adjust = (direction: number) => {
    const current = value !== null && Number.isFinite(value) ? value : null;
    const next = Number(
      (
        (current ?? start ?? min ?? 0) +
        (current === null ? 0 : direction * step)
      ).toFixed(6),
    );
    onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
  };
  // The unset slider has no value. The first touch commits where it landed and
  // hands over to the native range.
  const valueAt = (rect: DOMRect, clientX: number) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const snapped = min! + Math.round((ratio * (max! - min!)) / step) * step;
    return Number(Math.min(max!, Math.max(min!, snapped)).toFixed(6));
  };
  const focusSlider = () =>
    requestAnimationFrame(() => {
      if (typeof document !== "undefined") document.getElementById(`${id}-slider`)?.focus({ preventScroll: true });
    });
  const commit = (next: number) => {
    onChange(next);
    focusSlider();
  };
  // In the chat the keyboard covers the thread, so the box moves up once it has opened.
  const keepAboveKeyboard = (input: HTMLInputElement) => {
    const show = () => {
      if (document.activeElement === input) input.scrollIntoView({ block: "center" });
    };
    window.visualViewport?.addEventListener("resize", show);
    input.addEventListener("blur", () => window.visualViewport?.removeEventListener("resize", show), { once: true });
    setTimeout(show, 400);
  };
  const startFromPointer = (rect: DOMRect, clientX: number, pointerType: string) => {
    stopPointer?.();
    // A touch may be the start of a page scroll: commit only on a tap or a
    // sideways drag. The browser cancels the pointer when it takes the scroll.
    let started = pointerType !== "touch";
    if (started) commit(valueAt(rect, clientX));
    // Focus after a finger paints the keyboard ring around the whole slider in the chat.
    const settle = compact && pointerType === "touch" ? () => {} : focusSlider;
    const move = (event: PointerEvent) => {
      if (!started && Math.abs(event.clientX - clientX) < 6) return;
      started = true;
      onChange(valueAt(rect, event.clientX));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopPointer = null;
    };
    const end = (event: PointerEvent) => {
      cleanup();
      if (!started && event.type === "pointerup") onChange(valueAt(rect, event.clientX));
      if (started || event.type === "pointerup") settle();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    // The native control and its gesture belong to this question only.
    stopPointer = cleanup;
  };
  return (
    <div className={compact ? "space-y-3" : "space-y-4 rounded-xl border bg-card p-4 sm:p-5"}>
      <EndGestureOnUnmount />
      <Label htmlFor={id} className="text-body2">
        {label}
      </Label>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="cv2-step size-12 shrink-0"
          aria-label={tx(locale, `Նվազեցնել՝ ${label}`, `Decrease ${label}`, `Уменьшить: ${label}`)}
          disabled={
            disabled ||
            (value === null && start === undefined) ||
            (min !== undefined && value !== null && value <= min)
          }
          onClick={() => adjust(-1)}
        >
          <Minus className="size-5" />
        </Button>
        {compact && step < 1 ? <DecimalBox id={id} value={value} disabled={disabled} onFocus={keepAboveKeyboard} onChange={onChange} /> : <Input
          id={id}
          type="number"
          inputMode={step < 1 ? "decimal" : "numeric"}
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          placeholder="—"
          disabled={disabled}
          onFocus={compact ? (e) => keepAboveKeyboard(e.currentTarget) : undefined}
          className={BOX}
          onChange={(e) => {
            const typed = e.target.value === "" ? null : Number(e.target.value);
            onChange(open && typed !== null && typed > max ? max : typed);
          }}
        />}
        <Button
          type="button"
          variant="outline"
          className="cv2-step size-12 shrink-0"
          aria-label={tx(locale, `Ավելացնել՝ ${label}`, `Increase ${label}`, `Увеличить: ${label}`)}
          disabled={
            disabled || (max !== undefined && value !== null && value >= max)
          }
          onClick={() => adjust(1)}
        >
          <Plus className="size-5" />
        </Button>
      </div>
      {!compact && value === null && start !== undefined && !(slider && bounded) && (
        <p className="text-caption text-muted-foreground">
          {tx(
            locale,
            `Սեղմեք − կամ +՝ ${start}-ից սկսելու համար, կամ մուտքագրեք ձեր չափումը։`,
            `Tap − or + to start at ${start}, or type your reading.`, `Нажмите − или +, чтобы начать с ${start}, или введите своё измерение.`,
          )}
        </p>
      )}
      {compact && !slider && bounded && <p className="text-caption tabular-nums text-muted-foreground">{min}–{max}</p>}
      {slider && bounded && (
        <div className="space-y-2">
          {!compact && value === null && <p className="text-caption text-muted-foreground">{tx(locale, "Մուտքագրեք թիվը վերևում կամ ընտրեք սահիչով։", "Type a number above or choose it on the slider.", "Введите число выше или выберите его ползунком.")}</p>}
          {value === null ? (
            // No aria-valuenow on purpose: an unanswered control has no value,
            // and announcing the lower bound would read as an answer.
            <div
              id={`${id}-slider-unset`}
              // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
              role="slider"
              data-slider-unset
              tabIndex={disabled ? -1 : 0}
              aria-label={tx(locale, `Ընտրել՝ ${label}`, `Choose ${label}`, `Выбрать: ${label}`)}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuetext={
                notProvided
                  ? tx(locale, "Չի տրամադրվել", "Not provided", "Не предоставлено")
                  : tx(locale, "Պատասխան չկա", "No answer", "Нет ответа")
              }
              aria-disabled={disabled || undefined}
              onPointerDown={(e) => {
                if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
                if (e.pointerType !== "touch") e.preventDefault();
                startFromPointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.pointerType);
              }}
              onKeyDown={(e) => {
                if (disabled) return;
                const first = e.key === "End" ? max! : e.key === "Home" ? min! : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key) ? start! : null;
                if (first === null) return;
                e.preventDefault();
                commit(first);
              }}
              className="relative flex h-12 w-full cursor-pointer touch-pan-y items-center rounded-md focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <span className="h-2 w-full rounded-full bg-muted" />
              <span
                aria-hidden="true"
                className="absolute size-5 -translate-x-1/2 rounded-full border-2 border-dashed border-muted-foreground bg-card"
                style={{ left: `${(((start! - min!) / (max! - min!)) * 100).toFixed(2)}%` }}
              />
            </div>
          ) : !validRangeValue && !compact ? (
            <p data-slider-unavailable className="flex min-h-12 items-center text-caption text-muted-foreground">
              {tx(locale, `Սահիչը հասանելի է ${min}–${withUnit(max!)} միջակայքում։`, `Slider available from ${min} to ${withUnit(max!)}.`, `Ползунок доступен от ${min} до ${withUnit(max!)}.`)}
            </p>
          ) : <input
            id={`${id}-slider`}
            type="range"
            aria-label={tx(locale, `Ընտրել՝ ${label}`, `Choose ${label}`, `Выбрать: ${label}`)}
            aria-valuetext={valueText(sliderValue)}
            min={min}
            max={max}
            step={step}
            value={sliderValue}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-12 w-full cursor-pointer touch-pan-y accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed"
          />}
          <div className="flex justify-between text-caption tabular-nums text-muted-foreground">
            <span>{min}</span>
            <span>{topLabel}</span>
          </div>
          {open && (
            <p className="text-caption text-muted-foreground">
              {tx(locale, `${topLabel}՝ ${withUnit(max)} կամ ավելի։`, `${topLabel} means ${withUnit(max)} or more.`, `${topLabel} означает ${withUnit(max)} или больше.`)}
            </p>
          )}
          <p className="text-caption text-muted-foreground">
            {value === null && notProvided
              ? tx(locale, "Չի տրամադրվել։ Ավելացնելու համար մուտքագրեք թիվը։", "Not provided. Enter a number to add it.", "Не предоставлено. Введите число, чтобы добавить его.")
              : value === null
              ? tx(
                  locale,
                  compact ? "Պատասխան դեռ չկա։ Սահեցրեք, սեղմեք −/+ կամ մուտքագրեք թիվը։" : "Պատասխան դեռ չկա։ Սահեցրեք, սեղմեք −/+ կամ մուտքագրեք ձեր չափումը։",
                  compact ? "No answer yet. Drag, tap −/+ or type a number." : "No answer yet. Drag, tap −/+ or type your reading.",
                  compact ? "Ответа пока нет. Переместите ползунок, нажмите −/+ или введите число." : "Ответа пока нет. Переместите ползунок, нажмите −/+ или введите своё измерение.",
                )
              : !validRangeValue && !compact
              ? tx(locale, "Մուտքագրված պատասխանը պահպանվել է դաշտում։ Ստուգեք սահմանները։", "Your typed answer is kept in the field. Check the bounds.", "Ваш ответ остался в поле. Проверьте допустимые границы.")
              : tx(
                  locale,
                  "Սահեցրեք կամ օգտագործեք − և + կոճակները՝ ճշգրտելու համար։",
                  "Drag or use − and + to fine-tune.", "Для точной настройки переместите ползунок или нажимайте − и +.",
                )}
          </p>
        </div>
      )}
    </div>
  );
}
