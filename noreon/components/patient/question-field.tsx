"use client";
import { localized } from "@/lib/clinical/types";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { NumericAnswer } from "./numeric-answer";
import { numericStartingValue } from "./numeric-starting-values";
import {
  NONE,
  UNKNOWN,
  type AssessmentField,
  type FieldValue,
} from "@/lib/clinical/types";
import { skipWording } from "@/lib/patient/questionnaire";
import { tx, type PatientLocale } from "@/lib/patient/copy";
export type Entry = { fieldId: string; value: FieldValue | null };

export function QuestionField({
  field,
  entries,
  onChange,
  onSave,
  locale,
  disabled,
  compact = false,
}: {
  field: AssessmentField;
  entries: Entry[];
  onChange: (entries: Entry[]) => void;
  onSave: (entries: Entry[], advance?: boolean) => Promise<unknown>;
  locale: PatientLocale;
  disabled: boolean;
  /** Fits the controls inside a chat bubble. */
  compact?: boolean;
}) {
  const t = (v: { hy: string; en?: string; ru?: string }) => localized(v, locale);
  const exclusiveAction = field.id === "q6.conditions" || field.id === "q7.relatives";
  const value = entries.find((e) => e.fieldId === field.id)?.value;
  const unknownSelected = field.kind === "blood-pressure"
    ? entries.length === 2 && entries.every(entry => entry.value === UNKNOWN)
    : value === UNKNOWN;
  const saveAndFocus = (entries: Entry[], target: HTMLButtonElement) => {
    void onSave(entries).then(() =>
      requestAnimationFrame(() => {
        if (target.isConnected) target.focus(compact ? { preventScroll: true } : undefined);
      }),
    );
  };
  const pick = (next: FieldValue) => {
    const entries = [{ fieldId: field.id, value: next }];
    onChange(entries);
    void onSave(entries, true);
  };
  const number = (id: string, label: string, min?: number, max?: number, unit?: string, openMax?: boolean) => (
    <NumericAnswer
      openMax={openMax}
      compact={compact}
      id={id}
      label={label}
      unit={unit}
      min={min}
      max={max}
      step={field.step ?? 1}
      locale={locale}
      disabled={disabled}
      notProvided={entries.find(entry => entry.fieldId === id)?.value === UNKNOWN}
      slider={field.kind !== "blood-pressure"}
      startingValue={numericStartingValue(id, min, max, field.step ?? 1)}
      value={
        typeof entries.find((e) => e.fieldId === id)?.value === "number"
          ? (entries.find((e) => e.fieldId === id)!.value as number)
          : null
      }
      onChange={(value) =>
        onChange([
          ...entries.filter((e) => e.fieldId !== id),
          { fieldId: id, value },
        ])
      }
    />
  );
  return (
    <div className="space-y-3">
      {(field.kind === "single" || field.kind === "multi") &&
        field.options?.filter(option => !(exclusiveAction && option.value === NONE)).map((option) => {
          const chosen =
            field.kind === "multi"
              ? Array.isArray(value) && value.includes(option.value)
              : value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant={chosen ? "default" : "outline"}
              className="h-auto min-h-12 w-full justify-start gap-3 whitespace-normal py-3 text-left"
              aria-pressed={chosen}
              disabled={disabled}
              onClick={(event) => {
                if (event.detail > 1) return;
                if (field.kind === "single") pick(option.value);
                else {
                  const prev = Array.isArray(value) ? value : [],
                    exclusive = field.exclusiveValue ?? NONE;
                  const next =
                    option.value === exclusive
                      ? prev.includes(exclusive)
                        ? []
                        : [exclusive]
                      : prev.includes(option.value)
                        ? prev.filter((v) => v !== option.value)
                        : [
                            ...prev.filter((v) => v !== exclusive),
                            option.value,
                          ];
                  const updated = [
                    { fieldId: field.id, value: next.length ? next : null },
                  ];
                  onChange(updated);
                  saveAndFocus(updated, event.currentTarget);
                }
              }}
            >
              <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center border-2 border-current ${field.kind === "multi" ? "rounded-sm" : "rounded-full"}`}>
                {chosen && (field.kind === "multi" ? <Check className="size-3" strokeWidth={3} /> : <span className="size-2 rounded-full bg-current" />)}
              </span>
              <span className="min-w-0">{t(option.label)}</span>
            </Button>
          );
        })}
      {(field.kind === "number" || field.kind === "scale") &&
        number(
          field.id,
          field.unit
            ? t(field.unit)
            : field.kind === "scale"
            ? tx(locale, "Ձեր գնահատականը", "Your score", "Ваша оценка")
            : tx(locale, "Ձեր պատասխանը", "Your answer", "Ваш ответ"),
          field.min,
          field.max,
          field.unit ? t(field.unit) : undefined,
          field.openMax,
        )}
      {field.scaleLabels && (
        <p className="text-caption text-muted-foreground">
          {field.min}: {t(field.scaleLabels.low)} · {field.max}:{" "}
          {t(field.scaleLabels.high)}
        </p>
      )}
      {field.kind === "blood-pressure" && (
        <div className={compact ? "grid gap-4" : "grid gap-3 sm:grid-cols-2"}>
          {number(
            field.id + ".systolic",
            tx(locale, "Սիստոլիկ · mmHg", "Systolic · mmHg", "Систолическое · mmHg"),
            field.parts?.systolic.min,
            field.parts?.systolic.max,
          )}
          {number(
            field.id + ".diastolic",
            tx(locale, "Դիաստոլիկ · mmHg", "Diastolic · mmHg", "Диастолическое · mmHg"),
            field.parts?.diastolic.min,
            field.parts?.diastolic.max,
          )}
        </div>
      )}
      {(field.skippable || field.kind === "blood-pressure" || exclusiveAction) && (
        <div className={exclusiveAction ? "space-y-3 border-t pt-4" : undefined}>
        {exclusiveAction && <Button
          type="button"
          variant={Array.isArray(value) && value.includes(NONE) ? "default" : "outline"}
          aria-pressed={Array.isArray(value) && value.includes(NONE)}
          disabled={disabled}
          className="min-h-12 w-full"
          onClick={event => { if (event.detail > 1) return; pick([NONE]); }}
        >
          {tx(locale, "Ոչ մեկը", "None of these", "Ничего из перечисленного")}
        </Button>}
        <Button
          type="button"
          variant={unknownSelected ? "default" : "outline"}
          disabled={disabled}
          aria-pressed={unknownSelected}
          className="min-h-12 w-full"
          onClick={(event) => {
            if (event.detail > 1) return;
            const next =
              field.kind === "blood-pressure"
                ? [
                    { fieldId: field.id + ".systolic", value: UNKNOWN },
                    { fieldId: field.id + ".diastolic", value: UNKNOWN },
                  ]
                : [{ fieldId: field.id, value: UNKNOWN }];
            onChange(next);
            void onSave(next, true);
          }}
        >
          {skipWording(field, locale)}
        </Button>
        </div>
      )}
    </div>
  );
}
