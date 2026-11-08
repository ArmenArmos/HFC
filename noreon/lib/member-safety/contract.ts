import type { Locale } from "@/lib/locale";
import { z } from "zod";

/**
 * Member safety holds (decision tree v1.1 P342, P371, P389). The database decides who has a
 * hold and when it ends (supabase/migrations/*_member_safety_ui.sql); screens only render it.
 */

export const memberSafetyStatusSchema = z.object({
  enabled: z.boolean(),
  chestPainCard: z
    .object({
      id: z.uuid(),
      startedAt: z.string(),
      expiresAt: z.string(),
      hiddenToday: z.boolean(),
    })
    .nullable(),
  exercisePaused: z.boolean(),
});
export type MemberSafetyStatus = z.infer<typeof memberSafetyStatusSchema>;

/**
 * What the member's screens may show. `unknown` means the status could not be read while
 * the feature may be on: no card can be confirmed, and exercise suggestions are withheld
 * (shown neither as a suggestion nor as the doctor message) rather than risk one reaching a
 * member whose exercise is paused.
 */
export type MemberSafetyView =
  | { state: "off" }
  | { state: "unknown" }
  | { state: "on"; card: MemberSafetyStatus["chestPainCard"]; exercisePaused: boolean };

export function memberSafetyView(status: MemberSafetyStatus | null | undefined): MemberSafetyView {
  if (status === null) return { state: "unknown" };
  if (!status || !status.enabled) return { state: "off" };
  return { state: "on", card: status.chestPainCard, exercisePaused: status.exercisePaused };
}

/** The card to render on Home, or null (none, or hidden for today). */
export function visibleChestPainCard(view: MemberSafetyView) {
  return view.state === "on" && view.card && !view.card.hiddenToday ? view.card : null;
}

/**
 * Every exercise reminder or suggestion must ask this first (DT P389: the two modules have
 * to "see" each other). `suggest`: show the usual suggestion. `paused`: show the doctor
 * message instead. `withheld`: show neither.
 */
export function exerciseGuidance(view: MemberSafetyView): "suggest" | "paused" | "withheld" {
  if (view.state === "off") return "suggest";
  if (view.state === "unknown") return "withheld";
  return view.exercisePaused ? "paused" : "suggest";
}

export const holdKind = z.enum(["chest_pain_card", "exercise_pause"]);
export type HoldKind = z.infer<typeof holdKind>;

export const staffSafetySchema = z.object({
  enabled: z.boolean(),
  role: z.enum(["doctor", "admin"]),
  holds: z.array(
    z.object({
      id: z.uuid(),
      kind: holdKind,
      sourceField: z.enum(["q9.present", "q10.syncope"]),
      sourceValue: z.enum(["yes", "unsure", "exertion", "rest"]),
      startedAt: z.string(),
      expiresAt: z.string().nullable(),
      active: z.boolean(),
      reviewedAt: z.string().nullable(),
      clearedAt: z.string().nullable(),
      clearedByRole: z.enum(["doctor", "admin"]).nullable(),
      clearNote: z.string().nullable(),
      audit: z.array(
        z.object({
          action: z.enum(["opened", "backfilled", "hidden_today", "kept", "cleared"]),
          actorRole: z.enum(["system", "member", "doctor", "admin"]),
          actorName: z.string().nullable(),
          note: z.string().nullable(),
          at: z.string(),
        }),
      ),
    }),
  ),
});
export type StaffSafety = z.infer<typeof staffSafetySchema>;

export const decisionInput = z.object({
  memberId: z.uuid(),
  holdId: z.uuid(),
  action: z.enum(["clear", "keep"]),
  note: z.string().trim().max(500).optional(),
});
export type DecisionResult =
  | { ok: true; result: "cleared" | "kept" }
  | { ok: false; reason: "invalid" | "note_required" | "not_open" | "off" | "access" | "unavailable" };

export type Pair = Record<Locale, string>;
const pair = (en: string, hy: string, ru: string): Pair => ({ en, hy, ru });

/**
 * UNAPPROVED PLACEHOLDER COPY, for Armen/Tatevik (output/member-safety-ui-2026-10-18/QUESTIONS.md).
 * The switch stays off for real members until this wording is signed off. `call103Now`
 * and `call103` reuse the existing urgent-screen wording (RF-01 nextStep, #229 button).
 */
export const SAFETY_COPY = {
  status: "unapproved" as const,
  card: {
    label: pair("Chest pain safety card", "Կրծքավանդակի ցավի անվտանգության քարտ", "Карточка безопасности при боли в груди"),
    title: pair("If your chest pain comes back", "Եթե կրծքավանդակի ցավը վերադառնա", "Если боль в груди вернётся"),
    intro: pair(
      "You told us about chest pain or pressure during effort or stress. Keep this card in mind for the next 30 days.",
      "Դուք նշել եք կրծքավանդակի ցավ կամ ճնշվածություն ֆիզիկական ծանրաբեռնվածության կամ սթրեսի ժամանակ։ Հաջորդ 30 օրվա ընթացքում հիշեք այս քարտը։",
      "Вы сообщили о боли или давлении в груди при нагрузке или стрессе. Помните об этой карточке в течение следующих 30 дней.",
    ),
    callIf: pair("Call 103 straight away if:", "Անմիջապես զանգահարեք 103, եթե՝", "Немедленно вызовите скорую помощь (103), если:"),
    signs: [
      pair(
        "the pain or pressure does not ease within 5 minutes of rest, or comes on while you are resting",
        "ցավը կամ ճնշվածությունը չի անցնում հանգստից 5 րոպեի ընթացքում կամ սկսվում է հանգստի ժամանակ",
        "боль или давление не проходят в течение 5 минут отдыха или возникают в покое",
      ),
      pair(
        "the pain spreads to your arm, neck, jaw or back",
        "ցավը տարածվում է ձեռքին, պարանոցին, ծնոտին կամ մեջքին",
        "боль распространяется на руку, шею, челюсть или спину",
      ),
      pair(
        "you also sweat, feel sick, feel short of breath or feel faint",
        "միաժամանակ քրտնում եք, սրտխառնոց ունեք, շնչահեղձ եք լինում կամ թուլություն եք զգում",
        "вы также потеете, чувствуете тошноту, одышку или предобморочное состояние",
      ),
    ],
    call103Now: pair(
      "Call 103 now. Do not drive, and do not stay on your own.",
      "Զանգահարեք 103 հիմա։ Մի վարեք մեքենա և մի մնացեք մենակ։",
      "Вызовите скорую помощь (103) сейчас. Не садитесь за руль и не оставайтесь в одиночестве.",
    ),
    otherwise: pair(
      "If the pain comes back but none of these apply, stop what you are doing, rest, and message your care team.",
      "Եթե ցավը վերադառնում է, բայց սրանցից ոչ մեկը չկա, դադարեցրեք ձեր գործը, հանգստացեք և գրեք ձեր բուժթիմին։",
      "Если боль вернётся, но ни один из этих признаков не появится, прекратите то, что делаете, отдохните и напишите вашей медицинской команде.",
    ),
    until: pair("This card stays until {date}, unless your doctor says it can go.", "Այս քարտը կմնա մինչև {date}, եթե ձեր բժիշկն այլ բան չասի։", "Эта карточка останется до {date}, если врач не разрешит убрать её раньше."),
    call103: pair("Call 103", "Զանգահարել 103", "Вызвать скорую помощь (103)"),
    hide: pair("Hide for today", "Թաքցնել այսօրվա համար", "Скрыть на сегодня"),
    hiding: pair("Hiding…", "Թաքցվում է…", "Скрывается…"),
    hideFailed: pair("We could not hide the card. Try again.", "Չհաջողվեց թաքցնել քարտը։ Փորձեք կրկին։", "Не удалось скрыть карточку. Попробуйте снова."),
  },
  exercise: {
    title: pair("Check with your doctor before exercising", "Մարզվելուց առաջ խորհրդակցեք ձեր բժշկի հետ", "Посоветуйтесь с врачом перед физическими упражнениями"),
    body: pair(
      "You told us you have fainted. Exercise reminders and suggestions are paused until your doctor says it is safe to start again.",
      "Դուք նշել եք, որ ուշաթափվել եք։ Ֆիզիկական վարժությունների հիշեցումներն ու առաջարկները դադարեցված են, մինչև ձեր բժիշկը ասի, որ կարելի է վերսկսել։",
      "Вы сообщили об обмороке. Напоминания и рекомендации о физических упражнениях приостановлены, пока врач не скажет, что возобновить их безопасно.",
    ),
    short: pair("Paused until your doctor says it is safe to exercise.", "Դադարեցված է, մինչև բժիշկը թույլ տա մարզվել։", "Приостановлено, пока врач не скажет, что заниматься физическими упражнениями безопасно."),
  },
  staff: {
    title: pair("Safety holds", "Անվտանգության սահմանափակումներ", "Ограничения для безопасности"),
    intro: pair(
      "Decision tree v1.1: the chest-pain card (P342) and the exercise pause after fainting (P371, P389). Clearing a hold changes what the member sees straight away. Every change is recorded.",
      "Որոշումների ծառ v1.1՝ կրծքավանդակի ցավի քարտ (P342) և վարժությունների դադար ուշաթափությունից հետո (P371, P389)։ Սահմանափակումը հանելը անմիջապես փոխում է այն, ինչ տեսնում է անդամը։ Յուրաքանչյուր փոփոխություն գրանցվում է։",
      "Дерево решений v1.1: карточка при боли в груди (P342) и приостановка физических упражнений после обморока (P371, P389). Снятие ограничения сразу меняет то, что видит участник. Каждое изменение записывается.",
    ),
    none: pair("No safety holds for this member.", "Այս անդամի համար անվտանգության սահմանափակումներ չկան։", "У этого участника нет ограничений для безопасности."),
    kind: {
      chest_pain_card: pair("Chest-pain safety card, 30 days", "Կրծքավանդակի ցավի քարտ, 30 օր", "Карточка безопасности при боли в груди, 30 дней"),
      exercise_pause: pair("Exercise paused after fainting", "Վարժությունները դադարեցված են ուշաթափությունից հետո", "Физические упражнения приостановлены после обморока"),
    },
    source: {
      yes: pair("Chest pain on exertion or stress: yes, not present now", "Կրծքավանդակի ցավ ծանրաբեռնվածության կամ սթրեսի ժամանակ՝ այո, հիմա չկա", "Боль в груди при нагрузке или стрессе: да, сейчас отсутствует"),
      unsure: pair("Chest pain on exertion or stress: not sure, not present now", "Կրծքավանդակի ցավ ծանրաբեռնվածության կամ սթրեսի ժամանակ՝ համոզված չէ, հիմա չկա", "Боль в груди при нагрузке или стрессе: нет уверенности, сейчас отсутствует"),
      exertion: pair("Fainted during physical exertion", "Ուշաթափվել է ֆիզիկական ծանրաբեռնվածության ժամանակ", "Обморок во время физической нагрузки"),
      rest: pair("Fainted at rest or with no warning signs", "Ուշաթափվել է հանգստի ժամանակ կամ առանց նախանշանների", "Обморок в покое или без предвестников"),
    },
    active: pair("Active", "Գործում է", "Действует"),
    ended: pair("Ended", "Ավարտված է", "Завершено"),
    started: pair("Started", "Սկսվել է", "Начало"),
    ends: pair("Ends", "Ավարտվում է", "Окончание"),
    untilCleared: pair("Until a doctor clears it", "Մինչև բժիշկը հանի", "Пока врач не снимет ограничение"),
    reviewed: pair("Last kept", "Վերջին անգամ թողնվել է", "Последнее решение оставить"),
    clearedBy: { doctor: pair("Cleared by the doctor", "Հանվել է բժշկի կողմից", "Снято врачом"), admin: pair("Cleared by an administrator", "Հանվել է ադմինիստրատորի կողմից", "Снято администратором") },
    note: pair("Note", "Նշում", "Примечание"),
    noteHelpDoctor: pair("Optional. Saved with the decision.", "Ըստ ցանկության։ Պահվում է որոշման հետ։", "Необязательно. Сохраняется вместе с решением."),
    noteHelpAdmin: pair(
      "Required. Administrators clear a hold only when the doctor cannot, and say why.",
      "Պարտադիր է։ Ադմինիստրատորը հանում է սահմանափակումը միայն, երբ բժիշկը չի կարող, և նշում է պատճառը։",
      "Обязательно. Администраторы снимают ограничение только тогда, когда врач не может этого сделать, и указывают причину.",
    ),
    clear: pair("Clear this hold", "Հանել սահմանափակումը", "Снять это ограничение"),
    keep: pair("Keep this hold", "Թողնել սահմանափակումը", "Оставить это ограничение"),
    saving: pair("Saving…", "Պահպանվում է…", "Сохраняется…"),
    history: pair("History", "Պատմություն", "История"),
    action: {
      opened: pair("Opened by the questionnaire answer", "Բացվել է հարցաշարի պատասխանով", "Установлено по ответу в анкете"),
      backfilled: pair("Opened from an earlier answer when the feature was switched on", "Բացվել է ավելի վաղ պատասխանից՝ գործառույթը միացնելիս", "Установлено по более раннему ответу при включении функции"),
      hidden_today: pair("Member hid the card for the day", "Անդամը թաքցրել է քարտը այդ օրվա համար", "Участник скрыл карточку на день"),
      kept: pair("Kept", "Թողնվել է", "Оставлено"),
      cleared: pair("Cleared", "Հանվել է", "Снято"),
    },
    result: {
      cleared: pair("Cleared. The member no longer sees this hold.", "Հանված է։ Անդամն այլևս չի տեսնում այս սահմանափակումը։", "Снято. Участник больше не видит это ограничение."),
      kept: pair("Kept. The hold stays and your review is recorded.", "Թողնված է։ Սահմանափակումը մնում է, և ձեր վերանայումը գրանցված է։", "Оставлено. Ограничение сохраняется, ваша проверка записана."),
      invalid: pair("This decision could not be saved. Reload and try again.", "Որոշումը չհաջողվեց պահպանել։ Թարմացրեք էջը և փորձեք կրկին։", "Не удалось сохранить решение. Обновите страницу и попробуйте снова."),
      note_required: pair("Add a reason before clearing.", "Հանելուց առաջ նշեք պատճառը։", "Укажите причину перед снятием ограничения."),
      not_open: pair("This hold has already ended. Reload to see the current state.", "Այս սահմանափակումն արդեն ավարտված է։ Թարմացրեք էջը՝ ընթացիկ վիճակը տեսնելու համար։", "Это ограничение уже завершено. Обновите страницу, чтобы увидеть текущее состояние."),
      off: pair("Safety holds are switched off.", "Անվտանգության սահմանափակումներն անջատված են։", "Ограничения для безопасности отключены."),
      access: pair("Only the assigned doctor or an administrator can change this hold.", "Միայն կցված բժիշկը կամ ադմինիստրատորը կարող է փոխել այս սահմանափակումը։", "Только назначенный врач или администратор может изменить это ограничение."),
      unavailable: pair("We could not confirm the change. Reload to check before trying again.", "Չհաջողվեց հաստատել փոփոխությունը։ Թարմացրեք էջը՝ ստուգելու համար, նախքան կրկին փորձելը։", "Не удалось подтвердить изменение. Обновите страницу и проверьте состояние перед повторной попыткой."),
    },
    unavailable: pair("Safety holds are unavailable. Reload to check them.", "Անվտանգության սահմանափակումներն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։", "Ограничения для безопасности недоступны. Обновите страницу, чтобы проверить их."),
  },
};

/** Screening findings whose next step is an exercise suggestion (NRN-RULE-ACT-001: build up to 150 minutes a week). */
export const EXERCISE_SUGGESTION_RULES: ReadonlySet<string> = new Set(["NRN-RULE-ACT-001"]);

/**
 * A screening decision as the member may see it: an exercise suggestion's next step becomes
 * the doctor message (paused) or is dropped (withheld). Nothing else changes.
 */
export function withExerciseGuidance<F extends { ruleId: string; nextStep?: { hy: string; en?: string } }, D extends { findings: F[] }>(
  decision: D,
  exercise: "suggest" | "paused" | "withheld",
): D {
  if (exercise === "suggest") return decision;
  const step = { en: `${SAFETY_COPY.exercise.title.en}. ${SAFETY_COPY.exercise.short.en}`, hy: `${SAFETY_COPY.exercise.title.hy}։ ${SAFETY_COPY.exercise.short.hy}`, ru: `${SAFETY_COPY.exercise.title.ru}. ${SAFETY_COPY.exercise.short.ru}` };
  return {
    ...decision,
    findings: decision.findings.map((f) =>
      EXERCISE_SUGGESTION_RULES.has(f.ruleId) ? { ...f, nextStep: exercise === "paused" ? step : undefined } : f,
    ),
  };
}
