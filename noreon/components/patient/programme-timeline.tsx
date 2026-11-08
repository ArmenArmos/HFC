import { Check, CalendarClock, Route as RouteIcon } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { Stage } from "@/lib/programme/stages";
import { currentStage } from "@/lib/programme/stages";
import type { CheckinResult } from "@/lib/programme/schema";
import { CareLink } from "@/components/patient-care/common";
import { ProgrammeCheckin } from "./programme-checkin";
import { zoeName } from "@/lib/brand";

// Stage data remains bilingual; keep its Russian UI transcription at this boundary.
const STAGE_RU: Record<string, string> = {
  "Week-4 review": "Пересмотр на 4-й неделе",
  "Your doctor looks at your home readings and how the plan is going, then keeps it or updates it.": "Ваш врач изучает домашние измерения и ход выполнения плана, затем сохраняет или обновляет его.",
  "Month-3 check-in": "Контрольный опрос на 3-м месяце",
  "A check of your progress. Your doctor decides whether any tests should be repeated.": "Проверка вашего прогресса. Ваш врач решает, нужно ли повторить какие-либо анализы.",
  "Month-6 check-in": "Контрольный опрос на 6-м месяце",
  "A final check of your six months. Your doctor can prepare a summary for your usual doctor.": "Итоговая проверка за шесть месяцев. Ваш врач может подготовить заключение для вашего лечащего врача.",
  "Health questionnaire": "Анкета о здоровье",
  "Your answers show which tests you need.": "Ваши ответы показывают, какие анализы вам нужны.",
  "Tests": "Анализы",
  "Your tests are arranged. The nurse or clinic takes your samples.": "Ваши анализы назначены. Медсестра или сотрудник клиники возьмёт образцы.",
  "You book the tests your doctor needs, at home or at a clinic.": "Вы записываетесь на необходимые врачу анализы, дома или в клинике.",
  "Results": "Результаты",
  "Your results go to your doctor, who reviews them with your answers.": "Ваши результаты поступают врачу, который рассматривает их вместе с вашими ответами.",
  "Your care plan": "Ваш план лечения",
  "Your doctor publishes your plan. Your six months start here.": "Ваш врач публикует план лечения. С этого момента начинаются ваши шесть месяцев.",
  "Your doctor updated your plan.": "Ваш врач обновил план лечения.",
  "Your doctor reviewed your progress. Your plan stays the same.": "Ваш врач рассмотрел ваш прогресс. План лечения остаётся прежним.",
};
const MONTH_RU: Record<string, string> = {
  January: "января", February: "февраля", March: "марта", April: "апреля",
  May: "мая", June: "июня", July: "июля", August: "августа",
  September: "сентября", October: "октября", November: "ноября", December: "декабря",
};
// programmeDay emits an en-GB day and long month without a year.
const russianStageDate = (date: string) => date.replace(/[A-Za-z]+/g, month => MONTH_RU[month] ?? month);
const tr = (l: PatientLocale) => (p: { en: string; hy: string; ru?: string }) =>
  tx(l, p.hy, p.en, p.ru ?? STAGE_RU[p.en] ?? p.hy);

type Actor = "you" | "nurse" | "doctor";
/** Who does each step (prototype "who does what"). Descriptive only: it changes no state. */
const ACTORS: Record<Stage["id"], Actor[]> = {
  questionnaire: ["you"],
  tests: ["you", "nurse"],
  results: ["doctor"],
  plan: ["doctor"],
  week4_review: ["you", "doctor"],
  month3: ["you", "doctor"],
  month6: ["you", "doctor"],
};
const ACTOR_LABEL: Record<Actor, { en: string; hy: string; ru: string }> = {
  you: { en: "You", hy: "Դուք", ru: "вы" },
  nurse: { en: "Nurse", hy: "Բուժքույր", ru: "Медсестра" },
  doctor: { en: "Your doctor", hy: "Ձեր բժիշկը", ru: "Ваш врач" },
};
/** The prototype's groups, from our stages: getting started, the doctor's decision, check-ins. */
const GROUPS: { id: string; title: { en: string; hy: string; ru: string }; stages: Stage["id"][] }[] = [
  { id: "start", title: { en: "Get started", hy: "Սկիզբ", ru: "Начало" }, stages: ["questionnaire", "tests", "results"] },
  { id: "decide", title: { en: "Doctor decides", hy: "Բժիշկը որոշում է", ru: "Врач принимает решение" }, stages: ["plan"] },
  { id: "checkins", title: { en: "Check-ins", hy: "Ստուգումներ", ru: "Контрольные опросы" }, stages: ["week4_review", "month3", "month6"] },
];

export function ActorChip({ actor, l }: { actor: Actor; l: PatientLocale }) {
  return <span className="journey-actor" data-actor={actor}>{tr(l)(ACTOR_LABEL[actor])}</span>;
}

function StateMark({ stage, l }: { stage: Stage; l: PatientLocale }) {
  const label = stage.state === "done" ? tx(l, "Ավարտված", "Done", "Завершено") : stage.state === "now" ? tx(l, "Դուք այստեղ եք", "You are here", "вы здесь") : tx(l, "Առջևում", "Coming up", "Впереди");
  return (
    <span className="journey-tl-dot" data-state={stage.state}>
      {stage.state === "done" && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function dateLine(stage: Stage, l: PatientLocale) {
  if (!stage.date) return null;
  if (stage.state === "done") return tx(l, stage.date.hy, stage.date.en, russianStageDate(stage.date.en));
  if (stage.checkpoint?.state === "open") return tx(l, `Վերանայումը՝ ${stage.date.hy}`, `Review on ${stage.date.en}`, `Пересмотр ${russianStageDate(stage.date.en)}`);
  return tx(l, `Նախատեսված է՝ ${stage.date.hy}`, `Planned for ${stage.date.en}`, `Запланировано на ${russianStageDate(stage.date.en)}`);
}

/** Progress overview: where you are, as the prototype's five-stage strip, and the step now. */
export function ProgrammeJourneyCard({ stages, locale: l }: { stages: Stage[]; locale: PatientLocale }) {
  const t = tr(l);
  const now = currentStage(stages);
  const strip = [
    ...stages.filter((s) => GROUPS[0].stages.includes(s.id) || s.id === "plan").map((s) => ({ key: s.id, label: STRIP_LABEL[s.id as keyof typeof STRIP_LABEL], state: s.state })),
    ...(() => {
      const checks = stages.filter((s) => GROUPS[2].stages.includes(s.id));
      if (!checks.length) return [];
      const state: Stage["state"] = checks.every((s) => s.state === "done") ? "done" : checks.some((s) => s.state === "now") ? "now" : "next";
      return [{ key: "checkins", label: STRIP_LABEL.checkins, state }];
    })(),
  ];
  return (
    <section aria-labelledby="journey-card-title" className="journey-card" data-programme-journey>
      <header>
        <h2 id="journey-card-title">{t({ en: "My journey", hy: "Իմ ճանապարհը", ru: "Мой путь" })}</h2>
        <p className="text-body2 text-muted-foreground">{t({ en: "Where you are, and who does each step.", hy: "Որտեղ եք հիմա, և ով է անում յուրաքանչյուր քայլը։", ru: "Где вы сейчас и кто выполняет каждый шаг." })}</p>
      </header>
      <ol className="journey-strip-5" aria-label={t({ en: "Where you are", hy: "Որտեղ եք հիմա", ru: "Где вы сейчас" })}>
        {strip.map((s) => (
          <li key={s.key} data-state={s.state === "now" ? "current" : s.state} aria-current={s.state === "now" ? "step" : undefined}>
            <span className="journey-strip-dot" aria-hidden>{s.state === "done" && <Check className="size-3.5" strokeWidth={3} />}</span>
            <span className="journey-strip-label">
              {t(s.label)}
              <span className="sr-only">{s.state === "done" ? t({ en: ", done", hy: ", արված է", ru: ", завершено" }) : s.state === "now" ? t({ en: ", you are here", hy: ", դուք այստեղ եք", ru: ", вы здесь" }) : ""}</span>
            </span>
          </li>
        ))}
      </ol>
      {now && (
        <div className="journey-now">
          <p className="text-caption font-semibold text-muted-foreground">{t({ en: "You are here", hy: "Դուք այստեղ եք", ru: "вы здесь" })}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-body1 font-bold">{t(now.title)}</h3>
            {ACTORS[now.id].map((a) => <ActorChip key={a} actor={a} l={l} />)}
          </div>
          {dateLine(now, l) && <p className="text-body2 font-medium tabular-nums">{dateLine(now, l)}</p>}
          <p className="text-body2 text-muted-foreground">{t(now.meaning)}</p>
        </div>
      )}
      <CareLink href="#programme-timeline-title">{t({ en: "See every step", hy: "Տեսնել բոլոր քայլերը", ru: "Посмотреть все шаги" })}</CareLink>
    </section>
  );
}
const STRIP_LABEL = {
  questionnaire: { en: "Questions", hy: "Հարցեր", ru: "Вопросы" },
  tests: { en: "Tests", hy: "Թեստեր", ru: "Анализы" },
  results: { en: "Results", hy: "Արդյունք", ru: "Результаты" },
  plan: { en: "Plan", hy: "Պլան", ru: "План" },
  checkins: { en: "Check-ins", hy: "Ստուգում", ru: "Контрольные опросы" },
};

/**
 * The member's whole journey (prototype J1, pair 20): who does what, each step grouped as in
 * the prototype, where you are, and the dates of the steps ahead. Dates come from the database
 * settings, which the clinical owner has not signed off yet, so the page says they may change.
 */
export function ProgrammeTimeline({
  stages,
  schedulePending,
  locale: l,
  submit,
}: {
  stages: Stage[];
  schedulePending: boolean;
  locale: PatientLocale;
  submit: (input: unknown) => Promise<CheckinResult>;
}) {
  const t = tr(l);
  const roles: { actor: Actor | "zoe"; text: { en: string; hy: string; ru: string } }[] = [
    { actor: "you", text: { en: "Answer the questions, book your tests and record your readings.", hy: "Պատասխանում եք հարցերին, գրանցվում հետազոտությունների և գրանցում ձեր չափումները։", ru: "Вы отвечаете на вопросы, записываетесь на анализы и вносите измерения." } },
    { actor: "nurse", text: { en: "Takes your samples and helps with practical things.", hy: "Վերցնում է նմուշները և օգնում գործնական հարցերում։", ru: "Берёт образцы для анализов и помогает с организационными вопросами." } },
    { actor: "doctor", text: { en: "Looks at your results and decides your plan.", hy: "Դիտում է ձեր արդյունքները և որոշում ձեր ծրագիրը։", ru: "Изучает ваши результаты и определяет план лечения." } },
    { actor: "zoe", text: { en: "Explains your next step in plain words. Zoe never decides about treatment.", hy: "Պարզ բառերով բացատրում է ձեր հաջորդ քայլը։ Զոյան երբեք չի որոշում բուժման մասին։", ru: "Объясняет ваш следующий шаг простыми словами. Зоя никогда не принимает решения о лечении." } },
  ];
  return (
    <section aria-labelledby="programme-timeline-title" className="flex scroll-mt-24 flex-col gap-4" data-programme-timeline>
      <div className="journey-card">
        <header>
          <h2 id="programme-timeline-title" className="flex items-center gap-2 text-h2">
            <RouteIcon className="size-5 shrink-0 text-brand-teal" aria-hidden />
            {t({ en: "Your six months", hy: "Ձեր վեց ամիսները", ru: "Ваши шесть месяцев" })}
          </h2>
          <p className="max-w-2xl text-body2 text-muted-foreground">
            {t({ en: "Each step, who does it, and when the next ones are planned.", hy: "Յուրաքանչյուր քայլը, ով է այն անում, և երբ են նախատեսված հաջորդները։", ru: "Каждый шаг, кто его выполняет и когда запланированы следующие." })}
          </p>
        </header>
        <h3 className="text-body1 font-bold">{t({ en: "Who does what", hy: "Ով ինչ է անում", ru: "Кто что делает" })}</h3>
        <dl className="journey-roles">
          {roles.map((r) => (
            <div key={r.actor}>
              <dt>{r.actor === "zoe" ? <span className="journey-actor" data-actor="zoe">{zoeName(l)}</span> : <ActorChip actor={r.actor} l={l} />}</dt>
              <dd className="text-body2 text-muted-foreground">{t(r.text)}</dd>
            </div>
          ))}
        </dl>
      </div>
      {GROUPS.map((g) => {
        const items = stages.filter((s) => g.stages.includes(s.id));
        if (!items.length) return null;
        return (
          <div key={g.id} className="journey-card" data-group={g.id}>
            <h3 className="text-h2">{t(g.title)}</h3>
            <ol className="journey-tl">
              {items.map((s) => (
                <li key={s.id} aria-current={s.state === "now" ? "step" : undefined} data-stage={s.id} data-state={s.state}>
                  <StateMark stage={s} l={l} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className={`text-body1 ${s.state === "now" ? "font-bold" : "font-semibold"}`}>{t(s.title)}</h4>
                      {ACTORS[s.id].map((a) => <ActorChip key={a} actor={a} l={l} />)}
                    </div>
                    {dateLine(s, l) && <p className="text-caption text-muted-foreground tabular-nums">{dateLine(s, l)}</p>}
                    <p className="text-body2 text-muted-foreground">{t(s.meaning)}</p>
                    {s.state === "now" && <p className="text-body2 font-semibold text-[var(--noreon-teal-800)]">{t({ en: "You are here", hy: "Դուք այստեղ եք", ru: "вы здесь" })}</p>}
                    {s.outcome && <p className="text-body2 font-medium">{t(s.outcome)}</p>}
                    {s.checkpoint?.doctorNote && (
                      <blockquote className="rounded-lg bg-muted p-3 text-body2">
                        <span className="block text-caption font-semibold text-muted-foreground">{t({ en: "Note from your doctor", hy: "Ձեր բժշկի նշումը", ru: "Заметка вашего врача" })}</span>
                        <span className="whitespace-pre-wrap break-words">{s.checkpoint.doctorNote}</span>
                      </blockquote>
                    )}
                    {s.checkpoint?.state === "open" && s.checkpoint.checkin && (
                      <p className="text-body2">{t({ en: "Your answers are with your doctor for the review.", hy: "Ձեր պատասխանները ձեր բժշկի մոտ են վերանայման համար։", ru: "Ваши ответы переданы врачу для планового пересмотра." })}</p>
                    )}
                    {s.checkinDue && s.checkpoint?.id && (
                      <div className="mt-3 space-y-3 rounded-xl border p-4">
                        <p className="text-body2 font-semibold">{t({ en: "Three short questions for your doctor", hy: "Երեք կարճ հարց ձեր բժշկի համար", ru: "Три коротких вопроса для вашего врача" })}</p>
                        <ProgrammeCheckin checkpointId={s.checkpoint.id} locale={l} submit={submit} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {schedulePending && (
        <p className="text-caption text-muted-foreground">
          {t({ en: "Dates are planned from the day your care plan was published. Your doctor may change them.", hy: "Ամսաթվերը հաշվարկվում են ձեր խնամքի ծրագրի հրապարակման օրվանից։ Ձեր բժիշկը կարող է դրանք փոխել։", ru: "Даты рассчитываются со дня публикации вашего плана лечения. Ваш врач может их изменить." })}
        </p>
      )}
      <aside className="journey-callout" data-tone="danger" aria-label={t({ en: "Emergency help", hy: "Շտապ օգնություն", ru: "Скорая помощь" })}>
        <p className="min-w-0 flex-1 basis-52 text-body2">
          {t({ en: "Urgent care never waits for a planned step. If you feel very unwell, call 103 now.", hy: "Շտապ օգնությունը երբեք չի սպասում նախատեսված քայլին։ Եթե շատ վատ եք զգում, հիմա զանգահարեք 103։", ru: "Не откладывайте срочную помощь до запланированного шага. Если вам очень плохо, позвоните 103 сейчас." })}
        </p>
      </aside>
    </section>
  );
}

/** Home: the one step that matters now, its date, and a way to the full timeline. */
export function ProgrammeNowCard({ stages, locale: l }: { stages: Stage[]; locale: PatientLocale }) {
  const t = tr(l);
  const now = currentStage(stages);
  const done = stages.filter((s) => s.state === "done").length;
  if (!now) return null;
  const date = dateLine(now, l);
  return (
    <section aria-labelledby="programme-now-title" className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm" data-programme-now>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-caption font-medium text-muted-foreground">
            {tx(l, `Քայլ ${done + 1}՝ ${stages.length}-ից`, `Step ${done + 1} of ${stages.length}`, `Шаг ${done + 1} из ${stages.length}`)}
          </p>
          <h2 id="programme-now-title" className="text-h3">{t(now.title)}</h2>
        </div>
        <CalendarClock className="mt-1 size-5 shrink-0 text-brand-teal" aria-hidden />
      </div>
      <div className="flex gap-1" aria-hidden>
        {stages.map((s) => (
          <span key={s.id} className={`h-1.5 flex-1 rounded-full ${s.state === "done" ? "bg-brand-teal" : s.state === "now" ? "bg-primary" : "bg-border"}`} />
        ))}
      </div>
      {date && <p className="text-body2 font-medium">{date}</p>}
      <p className="text-body2 text-muted-foreground">{t(now.meaning)}</p>
      {now.checkinDue && (
        <p className="text-body2 font-medium">{t({ en: "Your doctor has three short questions for you.", hy: "Ձեր բժիշկն ունի երեք կարճ հարց ձեզ համար։", ru: "У вашего врача есть три коротких вопроса к вам." })}</p>
      )}
      <CareLink href="/patient/progress#programme-timeline-title" variant={now.checkinDue ? "primary" : "secondary"}>
        {now.checkinDue ? t({ en: "Answer the questions", hy: "Պատասխանել հարցերին", ru: "Ответить на вопросы" }) : t({ en: "See my six months", hy: "Տեսնել իմ վեց ամիսները", ru: "Посмотреть мои шесть месяцев" })}
      </CareLink>
    </section>
  );
}
