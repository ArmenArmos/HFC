import type { PatientLocale } from "@/lib/patient/copy";
import { CareSection, copy } from "./common";
export function ComingSoon({ locale: l }: { locale: PatientLocale }) {
  return (
    <span className="journey-soon">{copy(l, "Coming soon", "Շուտով", "Скоро")}</span>
  );
}
export function FutureFeature({
  locale: l,
  title,
  detail,
  action,
}: {
  locale: PatientLocale;
  title: string;
  detail: string;
  action?: string;
}) {
  return (
    <CareSection title={title}>
      <ComingSoon locale={l} />
      <p className="text-body2 text-muted-foreground">{detail}</p>
      {action && (
        <button disabled className="journey-disabled">
          {action}
        </button>
      )}
    </CareSection>
  );
}
export function ZoeCard({ locale: l }: { locale: PatientLocale }) {
  return (
    <section className="journey-card journey-zoe">
      <div className="flex items-center gap-3">
        <span className="journey-orb" aria-hidden />
        <div className="flex-1">
          <h2>
            {copy(l, "Zoe, your care assistant", "Zoe՝ ձեր խնամքի օգնականը", "Zoe, ваш помощник по вопросам лечения")}
          </h2>
          <ComingSoon locale={l} />
        </div>
      </div>
      <p className="text-body2">
        {copy(
          l,
          "A place for everyday questions, reminders and simple explanations of your approved plan. Zoe is not available yet.",
          "Առօրյա հարցերի, հիշեցումների և հաստատված պլանի պարզ բացատրությունների համար։ Zoe-ն դեռ հասանելի չէ։", "Место для повседневных вопросов, напоминаний и простых объяснений вашего утверждённого плана. Zoe пока недоступна.",
        )}
      </p>
      <button disabled className="journey-disabled">
        {copy(l, "Ask Zoe", "Հարցնել Zoe-ին", "Спросить Zoe")}
      </button>
    </section>
  );
}

export function PilotTimeline({ locale: l }: { locale: PatientLocale }) {
  return (
    <CareSection title={copy(l, "Your 6 months", "Ձեր 6 ամիսը", "Ваши 6 месяцев")}>
      <ComingSoon locale={l} />
      <div className="relative flex justify-between gap-1 py-3">
        <span aria-hidden className="absolute inset-x-4 top-7 border-t-2" />
        {[
          copy(l, "Start", "Սկիզբ", "Начало"),
          copy(l, "Plan", "Պլան", "План"),
          copy(l, "Week 4", "Շաբաթ 4", "Неделя 4"),
          copy(l, "Month 3", "Ամիս 3", "Месяц 3"),
          copy(l, "Month 6", "Ամիս 6", "Месяц 6"),
        ].map((t) => (
          <div
            key={t}
            className="relative flex flex-1 flex-col items-center gap-2 text-center text-caption"
          >
            <span
              aria-hidden
              className="size-8 rounded-full border-2 bg-card"
            />
            {t}
          </div>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">
        {copy(
          l,
          "Programme milestones will appear here when scheduled. No dates are confirmed yet.",
          "Ծրագրի փուլերը կհայտնվեն նշանակվելուց հետո։ Ամսաթվերը դեռ հաստատված չեն։", "Этапы программы появятся здесь, когда будут запланированы. Даты ещё не подтверждены.",
        )}
      </p>
    </CareSection>
  );
}
