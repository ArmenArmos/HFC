"use client";
import { formatMemberDate } from "@/lib/patient/date-format";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ageOn, maskBirthInput, parseBirthDate } from "@/lib/patient/validation";
import { tx, type PatientLocale } from "@/lib/patient/copy";
const russianAgeUnit = (age: number) => {
  const form = new Intl.PluralRules("ru").select(age);
  return form === "one" ? "год" : form === "few" ? "года" : "лет";
};
const display = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export function BirthDatePicker({
  value,
  onChange,
  assessmentDate,
  locale,
  error: fieldError,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  assessmentDate: string;
  locale: PatientLocale;
  /** The form's own message for this field (Gohar D-002: no browser tooltip). */
  error?: string;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [view, setView] = useState<"year" | "month" | "day">("year"),
    [year, setYear] = useState<number | null>(null),
    [month, setMonth] = useState<number | null>(null),
    [day, setDay] = useState<number | null>(null),
    [range, setRange] = useState(1968),
    [typedYear, setTypedYear] = useState(""),
    [error, setError] = useState("");
  const monthNames = Array.from({ length: 12 }, (_, m) =>
    formatMemberDate(new Date(Date.UTC(2020, m, 1)), locale, {
      month: "short",
      timeZone: "UTC",
    }),
  );
  const maxYear = Number(assessmentDate.slice(0, 4)) - 18,
    minYear = Number(assessmentDate.slice(0, 4)) - 111;
  const allowed = (date: string) =>
    Boolean(parseBirthDate(date)) &&
    ageOn(date, assessmentDate) >= 18 &&
    ageOn(date, assessmentDate) <= 110;
  const selected = year && month && day ? iso(year, month, day) : "";
  const begin = () => {
    const date = parseBirthDate(value),
      parts = date ? date.split("-").map(Number) : [];
    setYear(parts[0] ?? null);
    setMonth(parts[1] ?? null);
    setDay(parts[2] ?? null);
    setTypedYear(parts[0] ? String(parts[0]) : "");
    setRange(Math.floor((parts[0] ?? 1974) / 12) * 12);
    setView("year");
    setError("");
    setOpen(true);
  };
  const chooseYear = (n: number) => {
    if (!Number.isInteger(n) || n < minYear || n > maxYear) {
      setError(
        tx(locale, "Ստուգեք ծննդյան տարեթիվը։", "Check the birth year.", "Проверьте год рождения."),
      );
      return;
    }
    setYear(n);
    setTypedYear(String(n));
    setDay(null);
    setView("month");
    setError("");
  };
  const parsed = parseBirthDate(value);
  return (
    <div className="space-y-2">
      <Label htmlFor="birth-date">
        {tx(locale, "Ծննդյան ամսաթիվ", "Date of birth", "Дата рождения")}
      </Label>
      <div className="flex gap-2">
        <Input
          id="birth-date"
          placeholder={tx(locale, "ՕՕ/ԱԱ/ՏՏՏՏ", "DD/MM/YYYY", "ДД/ММ/ГГГГ")}
          type="text"
          inputMode="numeric"
          pattern="[0-9/]*"
          autoComplete="bday"
          aria-required="true"
          maxLength={10}
          value={value}
          className="h-12 min-w-0 text-base"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "birth-error birth-help" : "birth-help"}
          onBlur={onBlur}
          onChange={(e) => {
            // Gohar D-009: the slash appears as the member types; a paste is tidied to DD/MM/YYYY.
            const text = e.target.value;
            const deleting = text.length < value.length;
            onChange(maskBirthInput(text, deleting));
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!text) return;
            e.preventDefault();
            onChange(maskBirthInput(text));
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-12 shrink-0"
          aria-haspopup="dialog"
          onClick={begin}
        >
          {tx(locale, "Ընտրել", "Choose date", "Выбрать дату")}
        </Button>
      </div>
      {fieldError && (
        <p id="birth-error" className="text-sm text-destructive">
          {fieldError}
        </p>
      )}
      <p id="birth-help" className="text-caption text-muted-foreground">
        {parsed && allowed(parsed)
          ? `${ageOn(parsed, assessmentDate)} ${tx(locale, "տարեկան", "years old", russianAgeUnit(ageOn(parsed, assessmentDate)))}`
          : tx(locale, "Օր / ամիս / տարի, օրինակ՝ 20/09/1960", "Day / month / year, for example 20/09/1960", "День / месяц / год, например 20/09/1960")}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          lang={locale}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5"
          showCloseButton={false}
        >
          <DialogTitle className="text-h3">
            {tx(locale, "Ձեր ծննդյան ամսաթիվը", "Your date of birth", "Ваша дата рождения")}
          </DialogTitle>
          <DialogDescription>
            {selected && allowed(selected)
              ? display(selected)
              : tx(
                  locale,
                  "Ընտրեք տարին, ապա ամիսը և օրը։",
                  "Choose a year, then a month and day.", "Выберите год, затем месяц и день.",
                )}
          </DialogDescription>
          <div className="grid grid-cols-3 gap-2">
            {(["year", "month", "day"] as const).map((stage, i) => (
              <Button
                key={stage}
                type="button"
                variant={view === stage ? "default" : "secondary"}
                disabled={
                  (stage === "month" && !year) ||
                  (stage === "day" && (!year || !month))
                }
                className="h-14 flex-col gap-1"
                onClick={() => setView(stage)}
              >
                <span className="text-caption">
                  {
                    [
                      tx(locale, "Տարի", "Year", "Год"),
                      tx(locale, "Ամիս", "Month", "Месяц"),
                      tx(locale, "Օր", "Day", "День"),
                    ][i]
                  }
                </span>
                <span>
                  {stage === "year"
                    ? (year ?? "—")
                    : stage === "month"
                      ? month
                        ? monthNames[month - 1]
                        : "—"
                      : (day ?? "—")}
                </span>
              </Button>
            ))}
          </div>
          <div aria-live="polite">
            {view === "year" && (
              <>
                <Label htmlFor="birth-year">
                  {tx(locale, "Ծննդյան տարի", "Birth year", "Год рождения")}
                </Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id="birth-year"
                    type="number"
                    inputMode="numeric"
                    value={typedYear}
                    placeholder="1974"
                    min={minYear}
                    max={maxYear}
                    className="h-12 min-w-0 text-base"
                    onChange={(e) => setTypedYear(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        chooseYear(Number(typedYear));
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12"
                    onClick={() => chooseYear(Number(typedYear))}
                  >
                    {tx(locale, "Ընտրել", "Choose", "Выбрать")}
                  </Button>
                </div>
                <div className="my-3 flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={range <= minYear}
                    onClick={() => setRange(range - 12)}
                  >
                    {tx(locale, "Ավելի վաղ", "Earlier", "Раньше")}
                  </Button>
                  <span className="text-caption">
                    {range}–{range + 11}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={range + 11 >= maxYear}
                    onClick={() => setRange(range + 12)}
                  >
                    {tx(locale, "Ավելի ուշ", "Later", "Позже")}
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 12 }, (_, i) => range + i).map((n) => (
                    <Button
                      key={n}
                      type="button"
                      className="h-11"
                      variant={year === n ? "default" : "secondary"}
                      aria-pressed={year === n}
                      disabled={n < minYear || n > maxYear}
                      onClick={() => chooseYear(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {view === "month" && (
              <div className="grid grid-cols-3 gap-2">
                {monthNames.map((name, i) => (
                  <Button
                    key={i}
                    type="button"
                    className="h-12"
                    variant={month === i + 1 ? "default" : "secondary"}
                    aria-pressed={month === i + 1}
                    disabled={Boolean(
                      year &&
                      !allowed(iso(year, i + 1, 1)) &&
                      !allowed(
                        iso(
                          year,
                          i + 1,
                          new Date(Date.UTC(year, i + 1, 0)).getUTCDate(),
                        ),
                      ),
                    )}
                    onClick={() => {
                      setMonth(i + 1);
                      setDay(null);
                      setView("day");
                    }}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}
            {view === "day" && year && month && (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, i) =>
                  formatMemberDate(new Date(Date.UTC(2020, 5, 1 + i)), locale, {
                    weekday: "short",
                    timeZone: "UTC",
                  }),
                ).map((name, i) => (
                  <span
                    className="py-1 text-center text-caption text-muted-foreground"
                    key={i}
                  >
                    {name}
                  </span>
                ))}
                {Array.from(
                  {
                    length:
                      (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) %
                      7,
                  },
                  (_, i) => (
                    <span key={`empty${i}`} />
                  ),
                )}
                {Array.from(
                  { length: new Date(Date.UTC(year, month, 0)).getUTCDate() },
                  (_, i) => i + 1,
                ).map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={day === n ? "default" : "secondary"}
                    aria-label={`${n} ${monthNames[month - 1]} ${year}`}
                    aria-pressed={day === n}
                    disabled={!allowed(iso(year, month, n))}
                    className="h-11 min-w-0 px-0"
                    onClick={() => setDay(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-12"
              onClick={() => setOpen(false)}
            >
              {tx(locale, "Չեղարկել", "Cancel", "Отменить")}
            </Button>
            <Button
              type="button"
              className="h-12"
              disabled={!selected || !allowed(selected)}
              onClick={() => {
                onChange(display(selected));
                setOpen(false);
              }}
            >
              {tx(locale, "Հաստատել", "Use this date", "Выбрать эту дату")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
