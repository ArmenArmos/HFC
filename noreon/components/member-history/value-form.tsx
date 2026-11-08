"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { diastolicBounds, measureIds, measures, yerevanToday, type MeasureId } from "@/lib/member-history/measures";
import type { AddValueResult } from "@/lib/member-history/server";
import type { ReportedValue } from "@/lib/member-history/measures";
import { duplicateValue } from "@/lib/member-history/duplicate";

const measureNamesRu: Record<MeasureId, string> = {
  bp: "Артериальное давление",
  total_cholesterol: "Общий холестерин",
  ldl_c: "Холестерин ЛПНП (LDL)",
  hba1c: "Гликированный гемоглобин (HbA1c)",
  fasting_glucose: "Глюкоза натощак",
  weight: "Вес",
  waist: "Окружность талии",
};

// Chosen: the journey choice-row look (globals.css paints a checked radio label teal), so the text stays dark;
// navy-on-white text here was overridden to white on pale teal (night QA F-10).
const chip = (on: boolean) =>
  `inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 py-2 text-body2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${on ? "border-brand-teal bg-surface-subtle-teal font-semibold text-foreground" : "border-border bg-background hover:bg-muted"}`;

export function ValueForm({ locale: l, save, existing = [] }: { locale: PatientLocale; save: (input: unknown) => Promise<AddValueResult>; existing?: readonly ReportedValue[] }) {
  const router = useRouter();
  const id = useId();
  const [measure, setMeasure] = useState<MeasureId>("bp");
  const [unit, setUnit] = useState("mmHg");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const sending=useRef(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Set when the member has seen the duplicate warning for exactly these entries.
  const [duplicateFor, setDuplicateFor] = useState<string | null>(null);
  const m = measures[measure];
  const u = m.units.find((x) => x.unit === unit) ?? m.units[0];
  const step = u.decimals ? String(10 ** -u.decimals) : "1";
  const number = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  const entry = () => ({ measure, unit: u.unit, value: number(value), value2: measure === "bp" ? number(value2) : null, measuredOn: date });
  const warned = duplicateFor !== null && duplicateFor === JSON.stringify(entry());
  function pick(next: MeasureId) {
    setMeasure(next);
    setUnit(measures[next].units[0].unit);
    setValue("");
    setValue2("");
    setMessage(null);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const input = entry();
    const key = JSON.stringify(input);
    if (duplicateFor !== key && duplicateValue(existing, input)) {
      setDuplicateFor(key);
      setMessage(null);
      return;
    }
    setBusy(true);
    sending.current=true;
    setMessage(null);
    setDuplicateFor(null);
    const result = await save(input).catch((): AddValueResult => ({ status: "unavailable" }));
    setBusy(false);
    sending.current=false;
    if (result.status === "saved") {
      setValue("");
      setValue2("");
      setMessage({ ok: true, text: copy(l, "Saved. It now shows on your chart.", "Պահպանված է։ Այն արդեն երևում է ձեր գրաֆիկում։", "Сохранено. Значение уже появилось на вашем графике.") });
      router.refresh();
      return;
    }
    const text =
      result.status === "invalid"
        ? measure === "bp"
          ? copy(l, `Check the numbers: upper ${u.bounds.min} to ${u.bounds.max}, lower ${diastolicBounds.min} to ${diastolicBounds.max} and below the upper. Use the real date it was measured, before today. Save today's reading on the blood pressure page.`, `Ստուգեք թվերը՝ վերին ${u.bounds.min}-ից ${u.bounds.max}, ստորին ${diastolicBounds.min}-ից ${diastolicBounds.max} և վերինից փոքր։ Նշեք չափման իրական ամսաթիվը՝ այսօրվանից առաջ։ Այսօրվա չափումը պահեք ճնշման էջում։`, `Проверьте числа: верхнее от ${u.bounds.min} до ${u.bounds.max}, нижнее от ${diastolicBounds.min} до ${diastolicBounds.max} и меньше верхнего. Укажите настоящую дату измерения, раньше сегодняшней. Сегодняшнее измерение сохраните на странице давления.`)
          : copy(l, `Check the value (${u.bounds.min} to ${u.bounds.max} ${u.unit}) and a date that is not in the future.`, `Ստուգեք արժեքը (${u.bounds.min}-ից ${u.bounds.max} ${u.unit}) և ամսաթիվը, որը ապագայում չէ։`, `Проверьте значение (от ${u.bounds.min} до ${u.bounds.max} ${u.unit}). Дата не должна быть в будущем.`)
        : result.status === "access"
          ? copy(l, "Sign in again to save values.", "Մուտք գործեք կրկին՝ արժեքները պահպանելու համար։", "Войдите снова, чтобы сохранить значения.")
          : copy(l, "Couldn’t save right now. Try again.", "Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։", "Сейчас не удалось сохранить. Попробуйте ещё раз.");
    setMessage({ ok: false, text });
  }
  return (
    <section className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`${id}-title`}>
      <header className="space-y-1">
        <h2 id={`${id}-title`} className="text-h3">{copy(l, "Add a value by hand", "Ավելացրեք արժեք ձեռքով", "Добавить значение вручную")}</h2>
        <p className="text-body2 text-muted-foreground">{copy(l, "Type a number from an earlier result and the date it was measured.", "Մուտքագրեք նախկին արդյունքի թիվը և չափման ամսաթիվը։", "Введите число из прежнего результата и дату измерения.")}</p>
      </header>
      <form className="space-y-4" onSubmit={submit}>
        <fieldset className="space-y-2">
          <legend className="block text-body2 font-medium">{copy(l, "What was measured", "Ինչ է չափվել", "Что измеряли")}</legend>
          <div className="flex flex-wrap gap-2">
            {measureIds.map((mid) => (
              <label key={mid} className={chip(mid === measure)}>
                <input type="radio" name={`${id}-measure`} className="sr-only" checked={mid === measure} onChange={() => pick(mid)} />
                {copy(l, measures[mid].en, measures[mid].hy, measureNamesRu[mid])}
              </label>
            ))}
          </div>
        </fieldset>
        {m.units.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="block text-body2 font-medium">{copy(l, "Unit on your result", "Միավորը ձեր արդյունքում", "Единица измерения в вашем результате")}</legend>
            <div className="flex flex-wrap gap-2">
              {m.units.map((x) => (
                <label key={x.unit} className={chip(x.unit === unit)}>
                  <input type="radio" name={`${id}-unit`} className="sr-only" checked={x.unit === unit} onChange={() => { setUnit(x.unit); setMessage(null); }} />
                  {x.unit}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-value`} className="block text-body2 font-medium">
              {measure === "bp" ? copy(l, "Upper (systolic), mmHg", "Վերին (սիստոլիկ), mmHg", "Верхнее (систолическое), mmHg") : `${copy(l, m.en, m.hy, measureNamesRu[measure])}, ${u.unit}`}
            </label>
            <Input id={`${id}-value`} inputMode="decimal" type="number" required min={u.bounds.min} max={u.bounds.max} step={step} value={value} onChange={(e) => setValue(e.target.value)} className="min-h-11 w-40" />
          </div>
          {measure === "bp" && (
            <div className="space-y-2">
              <label htmlFor={`${id}-value2`} className="block text-body2 font-medium">{copy(l, "Lower (diastolic), mmHg", "Ստորին (դիաստոլիկ), mmHg", "Нижнее (диастолическое), mmHg")}</label>
              <Input id={`${id}-value2`} inputMode="numeric" type="number" required min={diastolicBounds.min} max={diastolicBounds.max} step="1" value={value2} onChange={(e) => setValue2(e.target.value)} className="min-h-11 w-40" />
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor={`${id}-date`} className="block text-body2 font-medium">{copy(l, "Date measured", "Չափման ամսաթիվը", "Дата измерения")}</label>
            <Input id={`${id}-date`} type="date" required min="1950-01-01" max={yerevanToday()} value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 w-44" />
          </div>
        </div>
        {message && <p role={message.ok ? "status" : "alert"} className="text-body2">{message.text}</p>}
        {warned && <p role="alert" className="rounded-lg border border-brand-gold bg-surface-subtle-gold p-3 text-body2">{copy(l, "You already saved this value for this date. Save it again only if it is a second measurement.", "Այս ամսաթվի համար այս արժեքն արդեն պահպանված է։ Կրկին պահպանեք միայն, եթե սա երկրորդ չափում է։", "Вы уже сохранили это значение за эту дату. Сохраните его снова, только если это второе измерение.")}</p>}
        <Button type="submit" className="h-auto min-h-11 gap-2 whitespace-normal" disabled={busy}>
          <Plus aria-hidden className="size-4" />
          {busy ? copy(l, "Saving…", "Պահպանվում է…", "Сохраняется…") : warned ? copy(l, "Save it again", "Պահպանել կրկին", "Сохранить снова") : copy(l, "Save value", "Պահպանել արժեքը", "Сохранить значение")}
        </Button>
      </form>
    </section>
  );
}
