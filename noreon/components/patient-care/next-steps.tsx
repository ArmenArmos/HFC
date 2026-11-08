import Link from "next/link";
import type { Route } from "next";
import {
  ArrowUpRight,
  Pill,
  CalendarDays,
  FlaskConical,
  ClipboardList,
  HeartPulse,
  Clock3,
  TriangleAlert,
  MapPin,
} from "lucide-react";
import type { CareAction } from "@/lib/patient-care/types";
import type { JourneyAction } from "@/lib/patient-care/journey-step";
import type { PatientLocale } from "@/lib/patient/copy";
import { DoseButtons } from "./controls";
import { CareLink, copy, stamp } from "./common";
const icons = {
  consultation: ClipboardList,
  urgent: TriangleAlert,
  appointment: CalendarDays,
  medication: Pill,
  tests: FlaskConical,
  results: FlaskConical,
  plan: ClipboardList,
  questions: ClipboardList,
  measurement: HeartPulse,
  waiting: Clock3,
};
export function NextSteps({
  actions,
  locale: l,
  mode = "all",
}: {
  actions: (CareAction | JourneyAction)[];
  locale: PatientLocale;
  mode?: "all" | "primary" | "secondary";
}) {
  const [main, ...rest] = actions;
  if (!main) return null;
  const Icon = icons[main.kind];
  return (
    <div className="space-y-4">
      {mode !== "secondary" && (
        <section
          aria-labelledby="next-step-title"
          className={`overflow-hidden rounded-2xl border ${main.kind === "urgent" ? "border-destructive bg-card" : "border-primary bg-brand-navy text-on-inverse"}`}
        >
          <div className="space-y-2 p-4 sm:p-5">
            <div
              className={`flex items-center gap-3 ${main.kind === "urgent" ? "text-destructive" : "text-primary-foreground"}`}
            >
              <Icon className="size-6" aria-hidden />
              <p className="text-body2 font-semibold">
                {copy(l, "Your next step", "Ձեր հաջորդ քայլը", "Ваш следующий шаг")}
              </p>
            </div>
            <h2 id="next-step-title" className="max-w-2xl text-h2">
              {main.title[l]}
            </h2>
            <p className="max-w-2xl whitespace-pre-line text-caption">
              {main.detail[l]}
            </p>
            {main.dueAt && (
              <p className="text-body2 font-medium">
                {stamp(main.dueAt, l)} ·{" "}
                {copy(l, "Armenia time", "Հայաստանի ժամանակ", "Время Армении")}
              </p>
            )}
            {main.dose && (
              <>
                <p className="text-caption">
                  {copy(
                    l,
                    "Record what happened. If you missed a dose, follow your prescribed instructions; this reminder does not tell you to take an extra dose.",
                    "Գրանցեք կատարվածը։ Բաց թողնված ընդունման դեպքում հետևեք ձեր նշանակման ցուցումներին։ Այս հիշեցումը լրացուցիչ դեղաչափ ընդունելու ցուցում չէ։",
                    "Отметьте, что произошло. Если вы пропустили дозу, следуйте назначенным указаниям; это напоминание не предписывает принимать дополнительную дозу.",
                  )}
                </p>
                <div className="rounded-lg bg-card p-4 text-card-foreground">
                  <DoseButtons dose={main.dose} locale={l} />
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Link
                href={main.href as Route}
                className={`inline-flex min-h-11 items-center justify-center gap-3 rounded-md px-4 py-2 text-center text-body2 font-medium ${main.kind === "urgent" ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground"}`}
              >
                {main.button[l]}
                <ArrowUpRight className="size-4 shrink-0" aria-hidden />
              </Link>
              {"secondary" in main && main.secondary && (
                <a
                  href={main.secondary.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-primary-foreground/60 px-4 py-2 text-center text-body2 font-medium text-primary-foreground hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  {main.secondary.label[l]}
                </a>
              )}
            </div>
          </div>
        </section>
      )}
      {mode !== "primary" && rest.length > 0 && (
        <section aria-labelledby="also-today-title">
          <h2 id="also-today-title" className="mb-2 text-h3">
            {copy(l, "Also on your care list", "Նաև ձեր խնամքի ցանկում", "Также в вашем списке заботы о здоровье")}
          </h2>
          <div className="divide-y rounded-xl border bg-card px-4">
            {rest.map((a) => {
              const ItemIcon = icons[a.kind];
              return (
                <article key={a.id} className="flex gap-3 py-3">
                  <ItemIcon
                    className="mt-1 size-5 shrink-0 text-brand-teal"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="text-body1 font-semibold">{a.title[l]}</h3>
                    <p className="text-body2 text-muted-foreground">
                      {a.detail[l]}
                    </p>
                    {a.dueAt && (
                      <p className="text-caption">{stamp(a.dueAt, l)}</p>
                    )}
                    {a.dose ? (
                      <DoseButtons dose={a.dose} locale={l} />
                    ) : (
                      <CareLink href={a.href} icon={ItemIcon}>
                        {a.button[l]}
                      </CareLink>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
