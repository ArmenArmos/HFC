import { formatMemberDate } from "@/lib/patient/date-format";
import type { Locale } from "@/lib/locale";
import type { CheckpointKind, MemberCheckpoint, MemberTimeline } from "./schema";
import { journeyStripIndex } from "@/lib/patient-care/journey-strip";

/**
 * The member's journey as one ordered list (prototype J1): questionnaire, tests, results, plan,
 * then the programme checkpoints with their dates. Pure: every input is saved state. Exactly one
 * step is "now" (the first one not done); a step whose state could not be read is never shown as
 * done.
 */
export type StageInput = {
  questionnaireComplete: boolean;
  /** Most advanced sample stage; undefined when the read failed. */
  lab: "collected" | "partial" | "at-lab" | "results-received" | null | undefined;
  /** A visit or test request exists (booked, requested or done). */
  testsArranged: boolean;
  planPublishedAt: string | null;
  /** From journeyStripInput, so this list agrees with Home's strip (QA 177). */
  nurseSamplesTaken?: boolean;
  visitDone?: boolean;
  programme: Extract<MemberTimeline, { enabled: true }>;
};
export type StageState = "done" | "now" | "next";
export type Stage = {
  id: "questionnaire" | "tests" | "results" | "plan" | CheckpointKind;
  state: StageState;
  title: Record<Locale, string>;
  meaning: Record<Locale, string>;
  /** A date to show: when it happened, or when it is planned. */
  date: Record<Locale, string> | null;
  /** For checkpoints: the member's own part. */
  checkpoint?: MemberCheckpoint;
  checkinDue?: boolean;
  outcome?: Record<Locale, string>;
};

const pair = (en: string, hy: string, ru: string) => ({ en, hy, ru });
/** A Yerevan calendar date (YYYY-MM-DD) as "8 February". */
export function programmeDay(day: string, locale: Locale) {
  return formatMemberDate(`${day}T12:00:00+04:00`, locale, { timeZone: "Asia/Yerevan", day: "numeric", month: "long" });
}
const both = (day: string) => pair(programmeDay(day, "en"), programmeDay(day, "hy"), programmeDay(day, "ru"));
const instantDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const CHECKPOINT_COPY: Record<CheckpointKind, { title: Record<Locale, string>; meaning: Record<Locale, string> }> = {
  week4_review: {
    title: pair("Week-4 review", "4-րդ շաբաթվա վերանայում", "Обзор на 4-й неделе"),
    meaning: pair(
      "Your doctor looks at your home readings and how the plan is going, then keeps it or updates it.",
      "Ձեր բժիշկը դիտում է ձեր տնային չափումները և թե ինչպես է ընթանում ծրագիրը, ապա պահպանում կամ թարմացնում է այն։",
      "Ваш врач оценивает ваши домашние измерения и выполнение плана лечения, затем оставляет его или обновляет.",
    ),
  },
  month3: {
    title: pair("Month-3 check-in", "3-րդ ամսվա ստուգում", "Проверка на 3-м месяце"),
    meaning: pair(
      "A check of your progress. Your doctor decides whether any tests should be repeated.",
      "Ձեր առաջընթացի ստուգում։ Ձեր բժիշկը որոշում է, թե արդյոք որևէ հետազոտություն պետք է կրկնել։",
      "Проверка вашего прогресса. Ваш врач решает, нужно ли повторить какие-либо анализы.",
    ),
  },
  month6: {
    title: pair("Month-6 check-in", "6-րդ ամսվա ստուգում", "Проверка на 6-м месяце"),
    meaning: pair(
      "A final check of your six months. Your doctor can prepare a summary for your usual doctor.",
      "Ձեր վեց ամիսների վերջնական ստուգում։ Ձեր բժիշկը կարող է ամփոփում պատրաստել ձեր տեղամասային բժշկի համար։",
      "Итоговая проверка за шесть месяцев. Ваш врач может подготовить сводку для вашего лечащего врача.",
    ),
  },
};

export function journeyStages(input: StageInput): Stage[] {
  const { programme: p } = input;
  // The programme's start is the first published plan, so it also counts as "plan published".
  const planAt = p.startedAt ?? input.planPublishedAt;
  const plan = !!planAt;
  // One source of truth with Home's strip (QA 177): 2 means tests done, 3 results done, 4 plan.
  // The questionnaire flag is kept separately so a reopened questionnaire does not undo later steps.
  const index = journeyStripIndex({ questionnaireComplete: true, lab: input.lab, planPublished: plan, nurseSamplesTaken: input.nurseSamplesTaken, visitDone: input.visitDone });
  const results = index >= 3;
  const tests = index >= 2;
  const base: Omit<Stage, "state">[] = [
    {
      id: "questionnaire",
      title: pair("Health questionnaire", "Առողջության հարցաշար", "Анкета о здоровье"),
      meaning: pair("Your answers show which tests you need.", "Ձեր պատասխանները ցույց են տալիս, թե որ հետազոտություններն են ձեզ պետք։", "Ваши ответы показывают, какие анализы вам нужны."),
      date: null,
    },
    {
      id: "tests",
      title: pair("Tests", "Հետազոտություններ", "Анализы"),
      meaning: input.testsArranged && !tests
        ? pair("Your tests are arranged. The nurse or clinic takes your samples.", "Ձեր հետազոտությունները նշանակված են։ Նմուշները վերցնում է բուժքույրը կամ կլինիկան։", "Ваши анализы организованы. Медсестра или сотрудник клиники возьмёт у вас образцы.")
        : pair("You book the tests your doctor needs, at home or at a clinic.", "Դուք գրանցվում եք ձեր բժշկին անհրաժեշտ հետազոտություններին՝ տանը կամ կլինիկայում։", "Вы записываетесь на нужные вашему врачу анализы дома или в клинике."),
      date: null,
    },
    {
      id: "results",
      title: pair("Results", "Արդյունքներ", "Результаты"),
      meaning: pair("Your results go to your doctor, who reviews them with your answers.", "Ձեր արդյունքներն ուղարկվում են ձեր բժշկին, ով դրանք դիտում է ձեր պատասխանների հետ։", "Ваши результаты поступают вашему врачу, который рассматривает их вместе с вашими ответами."),
      date: null,
    },
    {
      id: "plan",
      title: pair("Your care plan", "Ձեր խնամքի ծրագիրը", "Ваш план лечения"),
      meaning: pair("Your doctor publishes your plan. Your six months start here.", "Ձեր բժիշկը հրապարակում է ձեր ծրագիրը։ Ձեր վեց ամիսները սկսվում են այստեղից։", "Ваш врач публикует ваш план лечения. С этого момента начинаются ваши шесть месяцев."),
      date: planAt ? both(instantDay(planAt)) : null,
    },
  ];
  const done: boolean[] = [input.questionnaireComplete, tests, results, plan];
  const checkpointStages = p.checkpoints.map((c): Omit<Stage, "state"> => {
    const copy = CHECKPOINT_COPY[c.kind];
    const outcome = c.state !== "completed" ? undefined
      : c.outcome === "republished" ? pair("Your doctor updated your plan.", "Ձեր բժիշկը թարմացրել է ձեր ծրագիրը։", "Ваш врач обновил ваш план лечения.")
      : pair("Your doctor reviewed your progress. Your plan stays the same.", "Ձեր բժիշկը վերանայել է ձեր առաջընթացը։ Ձեր ծրագիրը մնում է նույնը։", "Ваш врач оценил ваш прогресс. Ваш план лечения остаётся прежним.");
    return {
      id: c.kind, title: copy.title, meaning: copy.meaning,
      date: c.state === "completed" && c.completedAt ? both(instantDay(c.completedAt)) : both(c.dueOn),
      checkpoint: c, checkinDue: c.state === "open" && !c.checkin && !!c.id, outcome,
    };
  });
  for (const c of p.checkpoints) done.push(c.state === "completed");
  const all = [...base, ...checkpointStages];
  const now = done.findIndex((d) => !d);
  return all.map((s, i) => ({ ...s, state: done[i] ? "done" : i === now ? "now" : "next" }));
}

/** The step that matters now, with its date, for the Home card. */
export function currentStage(stages: Stage[]) {
  return stages.find((s) => s.state === "now") ?? null;
}
