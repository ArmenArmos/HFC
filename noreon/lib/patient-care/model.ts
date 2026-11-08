import {memberDoctorLabel,memberStaffName} from "../member-staff-name.mjs";
import type { CareAction, CareAppointment, CareData, CareResult, DueDose } from "./types";
export function armeniaDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yerevan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dosesForDay(data: Pick<CareData, "plan" | "events">, now: Date): DueDose[] {
  const day = armeniaDate(now);
  if (!data.plan)
    return [];
  return data.plan.medications
    .filter(
      (m) =>
        m.active &&
        m.planId === data.plan!.id &&
        m.startDate <= day &&
        (!m.endDate || m.endDate >= day),
    )
    .flatMap((m) =>
      [...new Set(m.times)].map((time) => {
        const dueAt = new Date(`${day}T${time}:00+04:00`).toISOString();
        const event = data.events.find(
          (e) =>
            e.medicationId === m.id &&
            Date.parse(e.dueAt) === Date.parse(dueAt),
        );
        return {
          medication: m,
          dueAt,
          revision: event?.revision ?? 0,
          status:
            event?.status ??
            (Date.parse(dueAt) <= now.getTime() ? "due" : "upcoming"),
        } as DueDose;
      }),
    )
    .filter((d) => Date.parse(d.dueAt) >= Date.parse(d.medication.effectiveAt ?? data.plan!.publishedAt))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
export function canReportDose(
  data: Pick<CareData, "plan" | "events">,
  medicationId: string,
  dueAt: string,
  now: Date,
  reminderOffsetMinutes: -15 | 0 | 15 = 0,
) {
  if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) > now.getTime())
    return false;
  const dueDay = armeniaDate(new Date(dueAt));
  const currentDay = armeniaDate(now);
  const reminderDay = armeniaDate(new Date(Date.parse(dueAt) + reminderOffsetMinutes * 60000));
  if (dueDay !== currentDay && reminderDay !== currentDay) return false;
  return dosesForDay(data, new Date(dueAt)).some(
    (d) =>
      d.medication.id === medicationId &&
      Date.parse(d.dueAt) === Date.parse(dueAt),
  );
}
export function resultGroups(results: CareResult[]) {
  const groups = new Map<string, CareResult[]>();
  for (const r of results) {
    const key = JSON.stringify([r.marker, r.unit]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((rows) =>
    rows.sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt)),
  );
}
/** Keep recently started confirmed visits visible for the existing Home grace window. */
export function appointmentIsCurrent(appointment: CareAppointment, now: Date) {
  if (appointment.status !== "confirmed" && appointment.status !== "requested") return false;
  if (!appointment.startsAt) return true;
  const threshold = now.getTime() - (appointment.status === "confirmed" ? 3600000 : 0);
  return Date.parse(appointment.startsAt) >= threshold;
}
export function careActions(
  data: CareData,
  context: {
    attention?: { id: string; detail: { en?: string; hy: string; ru?: string } }[];
    complete: boolean;
    showAssessmentNextSteps?: boolean;
    assessmentCompletedAt?: string | null;
    urgent: boolean;
    measuredToday: boolean;
    now: Date;
  },
): CareAction[] {
  const actions: (CareAction & { priority: number })[] = [];
  const add = (priority: number, action: CareAction) =>
    actions.push({ ...action, priority });
  const link = (en: string, hy: string, ru: string) => ({ en, hy, ru });
  if (context.urgent)
    return [
      {
        id: "urgent",
        kind: "urgent",
        title: link("Open your urgent guidance", "Բացեք շտապ ցուցումները", "Откройте срочные рекомендации"),
        detail: link(
          "Your recorded answers need urgent attention. Open the instructions now.",
          "Ձեր գրանցած պատասխանները պահանջում են շտապ ուշադրություն։ Բացեք ցուցումները հիմա։", "Ваши записанные ответы требуют срочного внимания. Откройте рекомендации сейчас.",
        ),
        href: "/patient/urgent",
        button: link("View urgent guidance", "Տեսնել շտապ ցուցումները", "Посмотреть срочные рекомендации"),
      },
    ];
  for (const finding of context.attention ?? [])
    add(6, {
      id: finding.id,
      kind: "consultation",
      title: link(
        "Arrange a clinician review",
        "Կազմակերպեք բժշկի խորհրդատվություն", "Запишитесь на консультацию врача",
      ),
      detail: link(finding.detail.en ?? finding.detail.hy, finding.detail.hy, finding.detail.ru ?? finding.detail.hy),
      href: "/patient/health/profile",
      button: link("Read why and when", "Տեսնել պատճառը և ժամկետը", "Узнать причину и сроки"),
    });
  for (const a of data.appointments
    .filter(
      (a) =>
        a.status === "confirmed" &&
        a.startsAt &&
        appointmentIsCurrent(a, context.now),
    )
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))
    .slice(0, 1)) {
    add(Date.parse(a.startsAt!) - context.now.getTime() <= 7200000 ? 5 : 55, {
      id: a.id,
      kind: "appointment",
      title: Date.parse(a.startsAt!) < context.now.getTime()
        ? link("Your appointment", "Ձեր այցը", "Ваш приём")
        : link("Your next appointment", "Ձեր հաջորդ այցը", "Ваш следующий приём"),
      detail: link(
        [a.clinician ? memberDoctorLabel(a.clinician,"en") : null, a.location].filter(Boolean).join(" · ") || a.specialty,
        [a.clinician ? memberDoctorLabel(a.clinician,"hy") : null, a.location].filter(Boolean).join(" · ") || a.specialty,
        [a.clinician ? memberDoctorLabel(a.clinician,"ru") : null, a.location].filter(Boolean).join(" · ") || a.specialty,
      ),
      dueAt: a.startsAt!,
      href: "/patient/care#appointments",
      button: link("See appointment details", "Տեսնել այցի տվյալները", "Посмотреть подробности приёма"),
    });
  }
  for (const d of dosesForDay(data, context.now).filter(
    (d) => d.status === "due" || d.status === "upcoming",
  ))
    add(d.status === "due" ? 10 : 50, {
      id: `dose-${d.medication.id}-${d.dueAt}`,
      kind: "medication",
      title:
        d.status === "due"
          ? link("Your medication check-in", "Դեղի ընդունման գրառում", "Ваша отметка о приёме лекарства")
          : link(
              "Your next medication check-in",
              "Դեղի հաջորդ ընդունման գրառումը", "Ваша следующая отметка о приёме лекарства",
            ),
      detail: link(
        `${d.medication.name} · ${d.medication.dose}`,
        `${d.medication.name} · ${d.medication.dose}`,
        `${d.medication.name} · ${d.medication.dose}`,
      ),
      dueAt: d.dueAt,
      dose: d,
      href: "/patient/care#medicines",
      button: link("View your schedule", "Տեսնել ժամանակացույցը", "Посмотреть ваше расписание"),
    });
  if (data.tests.some((t) => t.status === "ordered"))
    add(20, {
      id: "tests",
      kind: "tests",
      title: link("Your tests are next", "Հաջորդ քայլը՝ հետազոտություններ", "Ваш следующий шаг: анализы"),
      detail: link(
        data.tests
          .filter((t) => t.status === "ordered")
          .map((t) => t.title)
          .join(", "),
        data.tests
          .filter((t) => t.status === "ordered")
          .map((t) => t.title)
          .join(", "),
        data.tests.filter((t) => t.status === "ordered").map((t) => t.title).join(", "),
      ),
      href: "/patient/results#tests",
      button: link(
        "See tests and preparation",
        "Տեսնել հետազոտություններն ու նախապատրաստումը", "Посмотреть анализы и подготовку",
      ),
    });
  if (data.results.some((r) => !r.reviewedAt))
    add(30, {
      id: "results",
      kind: "results",
      title: link("Your results have arrived", "Ձեր արդյունքները ստացվել են", "Ваши результаты получены"),
      detail: link(
        "A review has not been published yet. You can view the received results.",
        "Վերանայումը դեռ հրապարակված չէ։ Կարող եք տեսնել ստացված արդյունքները։", "Заключение пока не опубликовано. Вы можете посмотреть полученные результаты.",
      ),
      href: "/patient/results",
      button: link("View your results", "Տեսնել արդյունքները", "Посмотреть ваши результаты"),
    });
  if (data.plan && !data.plan.acknowledged && !data.plan.acknowledgedAt)
    add(35, {
      id: "plan",
      kind: "plan",
      title: link("Your care plan is ready", "Ձեր խնամքի պլանը պատրաստ է", "Ваш план лечения готов"),
      detail: link(
        memberStaffName(data.plan.clinician) ? `Published by ${data.plan.clinician}. Read your approved care instructions.` : "Published by your doctor. Read your approved care instructions.",
        memberStaffName(data.plan.clinician) ? `${data.plan.clinician}․ կարդացեք խնամքի հաստատված ցուցումները։` : "Ձեր բժիշկը․ կարդացեք խնամքի հաստատված ցուցումները։",
        memberStaffName(data.plan.clinician) ? `Опубликовал врач ${data.plan.clinician}. Прочитайте утверждённые указания по лечению.` : "Опубликовал ваш врач. Прочитайте утверждённые указания по лечению.",
      ),
      href: "/patient/care#plan",
      button: link("Read your care plan", "Կարդալ խնամքի պլանը", "Прочитать ваш план лечения"),
    });
  if (
    data.tests.some(
      (t) =>
        t.status === "collected" &&
        !data.results.some((r) => r.testId === t.id),
    )
  )
    add(40, {
      id: "waiting",
      kind: "waiting",
      title: link("Waiting for your results", "Սպասում ենք արդյունքներին", "Ожидаем ваши результаты"),
      detail: link(
        "Your sample is recorded as collected. Results are not available yet.",
        "Նմուշի հանձնումը գրանցված է։ Արդյունքները դեռ հասանելի չեն։", "Взятие вашего образца зарегистрировано. Результаты пока недоступны.",
      ),
      href: "/patient/results",
      button: link("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов"),
    });
  if (!context.complete)
    add(45, {
      id: "questions",
      kind: "questions",
      title: link(
        "Complete your health profile",
        "Ավարտեք առողջության պրոֆիլը", "Заполните ваш профиль здоровья",
      ),
      detail: link(
        "Continue where you left off. Your account is already registered.",
        "Շարունակեք այնտեղից, որտեղ կանգ եք առել։ Ձեր հաշիվն արդեն գրանցված է։", "Продолжите с того места, где остановились. Ваш аккаунт уже зарегистрирован.",
      ),
      href: "/patient/questions",
      button: link(
        "Continue health questions",
        "Շարունակել առողջության հարցերը", "Продолжить вопросы о здоровье",
      ),
    });
  if (context.complete && context.showAssessmentNextSteps !== false &&
    (!data.plan || (!!context.assessmentCompletedAt && Date.parse(context.assessmentCompletedAt) > Date.parse(data.plan.publishedAt))))
    add(46, {
      id: "assessment-next-steps",
      kind: "consultation",
      title: link("Your questionnaire next steps", "Հարցաշարից հետո ձեր հաջորդ քայլերը", "Ваши следующие шаги после анкеты"),
      detail: link(
        "Your answers are saved. Review the suggested tests, measurements and topics to discuss with a clinician. These are draft suggestions, not approved orders or a booked review.",
        "Ձեր պատասխանները պահպանված են։ Տեսեք առաջարկվող հետազոտությունները, չափումները և բժշկի հետ քննարկվող հարցերը։ Սրանք նախնական առաջարկներ են, ոչ հաստատված նշանակումներ կամ ամրագրված խորհրդատվություն։", "Ваши ответы сохранены. Посмотрите предложенные анализы, измерения и темы для обсуждения с врачом. Это предварительные предложения, а не утверждённые назначения или запись на консультацию.",
      ),
      href: "/patient/health/profile",
      button: link("See your suggested next steps", "Տեսնել առաջարկվող հաջորդ քայլերը", "Посмотреть предложенные следующие шаги"),
    });
  if (!context.measuredToday)
    add(60, {
      id: "measurement",
      kind: "measurement",
      title: link(
        "Keep your blood pressure history up to date",
        "Թարմացրեք ճնշման պատմությունը", "Обновляйте вашу историю артериального давления",
      ),
      detail: link(
        "If you have taken a measurement, record it here.",
        "Եթե չափել եք ճնշումը, գրանցեք այն այստեղ։", "Если вы измерили давление, запишите его здесь.",
      ),
      href: "/patient/measurements/new",
      button: link("Record blood pressure", "Գրանցել ճնշումը", "Записать давление"),
    });
  if (!actions.length)
    add(99, {
      id: "caught-up",
      kind: "waiting",
      title: link("You are up to date here", "Այստեղ ամեն ինչ թարմ է", "Здесь всё актуально"),
      detail: link(
        "No outstanding actions are recorded. Your care and history are always available below.",
        "Չավարտված գործողություններ գրանցված չեն։ Ձեր խնամքն ու պատմությունը հասանելի են ստորև։", "Незавершённых действий нет. Ваше лечение и история всегда доступны ниже.",
      ),
      href: "/patient/care",
      button: link("See your care", "Տեսնել խնամքը", "Посмотреть ваше лечение"),
    });
  return actions.sort((a, b) => a.priority - b.priority);
}
