import { CalendarClock } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { nextDateWhen, type NextDate } from "@/lib/patient-care/next-date";
import { RowLink, copy } from "./common";

/** Home: the next dated thing (visit, BP-week reading, consultation or programme checkpoint). Hidden when nothing has a date. */
export function NextDateCard({ next, locale: l, now }: { next: NextDate | null; locale: PatientLocale; now: Date }) {
  if (!next) return null;
  return (
    <section aria-labelledby="next-date-title" className="rounded-xl border bg-card px-1" data-next-date={next.kind}>
      <h2 id="next-date-title" className="sr-only">{copy(l, "Your next date", "Ձեր հաջորդ ամսաթիվը", "Ваша следующая дата")}</h2>
      <RowLink href={next.href} icon={CalendarClock} detail={next.title[l]}>
        <time dateTime={next.at}>{copy(l, "Next: ", "Հաջորդը՝ ", "Далее: ")}{nextDateWhen(next, l, now)}</time>
      </RowLink>
    </section>
  );
}
