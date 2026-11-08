"use client";
import type { Route } from "next";
import { MeasurementEntryDialog } from "@/components/patient/measurement-entry-dialog";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy } from "@/components/patient-care/common";
import { weekSave } from "./week-controls";

/** The shared reading dialog, saving into one slot of the member's week. */
export function WeekEntryDialog({ locale: l, weekId, slot, saved, prototype = false }: { locale: PatientLocale; weekId: string; slot: "morning" | "evening"; saved: number; prototype?: boolean }) {
  const which = saved === 0 ? copy(l, "first", "առաջին", "первое") : copy(l, "second", "երկրորդ", "второе");
  return (
    <MeasurementEntryDialog
      prototype={prototype}
      classicHref={`/patient/bp-week/record?slot=${slot}&view=classic` as Route}
      locale={l}
      title={slot === "morning" ? copy(l, `Morning, ${which} reading`, `Առավոտ, ${which} չափում`, `Утро, ${which} измерение`) : copy(l, `Evening, ${which} reading`, `Երեկո, ${which} չափում`, `Вечер, ${which} измерение`)}
      detail={copy(l, "Sit quietly for a few minutes first. Enter the reading shown on your monitor.", "Նախ մի քանի րոպե հանգիստ նստեք։ Մուտքագրեք ձեր սարքի ցույց տված արդյունքը։", "Сначала спокойно посидите несколько минут. Введите измерение, которое показывает ваш тонометр.")}
      closeHref="/patient/bp-week"
      doneHref="/patient/bp-week"
      save={weekSave(l, weekId, slot)}
    />
  );
}
