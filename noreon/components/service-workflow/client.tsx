"use client";
import { testTitle } from "@/lib/patient/catalogue-label";
import { bookingApplies, bookingHasReceipt, bookingResultsReceived } from "@/lib/service-workflow/reconciliation";
import { BookingPreparation } from "./booking-preparation";
import { demoPreparation } from "@/lib/service-workflow/model";
import { useState, useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { clinicalLocale, type Locale } from "@/lib/locale";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import {
  earliestAppointmentDay,
  reviewWindow,
} from "@/lib/service-workflow/model";
import { armeniaDate } from "@/lib/patient-care/model";
import {
  CareSection,
  CareLink,
  RowLink,
  copy,
  stamp,
} from "@/components/patient-care/common";
import {
  ActionError,
  buttonClass,
  quietClass,
  inputClass,
  SlotFields,
  formTime,
  useWorkflowCommand,
} from "./shared";
export function HistoricalReminder({ locale: l, uploadAvailable = false }: { locale: Locale; uploadAvailable?: boolean }) {
  const demo = process.env.NEXT_PUBLIC_PATIENT_DEMO === "true";
  const canAdd = demo || uploadAvailable;
  // Gohar Q3: with report import off, earlier results are still added under Progress
  // (/patient/progress/earlier, always on), so this row leads there instead of saying upload is unavailable.
  return <section className="rounded-2xl border border-border/70 bg-card p-2">
    <RowLink href={canAdd ? "/patient/reports" : "/patient/progress/earlier"} icon={FileText} detail={copy(l,
      "Add your history for review. Earlier reports do not replace newly ordered tests.",
      "Ավելացրեք պատմությունը վերանայման համար։ Նախորդ արդյունքները չեն փոխարինում նոր նշանակված թեստերին։", "Добавьте вашу историю для рассмотрения. Прежние результаты не заменяют новые назначенные исследования."
    )}>
      {copy(l,canAdd ? "Add earlier reports" : "Add earlier results",canAdd ? "Ավելացնել նախորդ արդյունքները" : "Ավելացնել նախկին արդյունքներ", canAdd ? "Добавить прежние документы" : "Добавить прежние результаты")}
    </RowLink>
  </section>;
}

export function ServiceProgress({
  workflow: w,
  locale: l,
}: {
  workflow: ServiceWorkflow;
  locale: Locale;
}) {
  const scheduled = w.tests.every(
    (t) =>
      w.receivedTestIds.includes(t.id) ||
      w.bookings.some(
        (b) => bookingApplies(w,b,t.id),
      ),
  );
  const window = reviewWindow(w);
  const doctor = w.doctors.find((d) => d.id === w.assignedDoctorId);
  return (
    <section className="service-progress space-y-6 rounded-2xl border bg-card p-5 sm:p-7">
      <h2 className="text-h2">
        {copy(l, "Your next steps, together", "Ձեր հաջորդ քայլերը՝ միասին", "Ваши следующие шаги вместе с нами")}
      </h2>
      {w.recommendationsPending ? <p className="rounded-md bg-muted p-4 text-body2">{copy(l,"Complete your updated questions. Existing bookings and your published plan remain available.","Ավարտեք թարմացված հարցերը։ Ձեր պլանավորումները և հրապարակված պլանը հասանելի են։", "Завершите обновлённые вопросы. Существующие записи и опубликованный план лечения остаются доступны.")}</p> : w.tests.length === 0 ? (
        <p className="rounded-md bg-muted p-4 text-body2">
          {copy(
            l,
            w.publication
              ? "Your care plan has been published."
              : "No additional tests are listed. Your next step is GP review.",
            w.publication
              ? "Ձեր խնամքի պլանը հրապարակվել է։"
              : "Լրացուցիչ թեստեր չկան։ Հաջորդ քայլը բժշկի վերանայումն է։", w.publication ? 'Ваш план лечения опубликован.' : 'Дополнительные исследования не назначены. Следующий шаг: рассмотрение врачом.'
          )}
        </p>
      ) : (
        <ol className="service-progress-steps grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            copy(l, "Tests needed", "Անհրաժեշտ թեստեր", "Нужные исследования"),
            copy(l, "Tests scheduled", "Պլանավորված թեստեր", "Запланированные исследования"),
            copy(l, "Treatment published", "Հրապարակված բուժում", "Лечение опубликовано"),
          ].map((label, i) => (
            <li
              key={label}
              className={`border-t-4 pt-3 ${i === 0 || (i === 1 && scheduled) || (i === 2 && w.publication) ? "border-brand-teal" : "border-border text-muted-foreground"}`}
            >
              <span className="text-caption">{i + 1}</span>
              <p className="mt-1 text-caption font-medium sm:text-body2">
                {label}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap justify-between gap-5">
        <div className="space-y-2">
          <p className="text-body1 font-medium">
            {w.publication
              ? copy(
                  l,
                  "Your reviewed plan is ready.",
                  "Ձեր վերանայված պլանը պատրաստ է։", "Ваш проверенный план лечения готов."
                )
              : window && w.tests.length > 0
                ? copy(
                    l,
                    "Received — awaiting GP review.",
                    "Ստացված է․ սպասում է բժշկի վերանայմանը։", "Результаты получены, ожидается рассмотрение врачом."
                  )
                : w.tests.length === 0
                  ? copy(
                      l,
                      "Your GP can review your case without additional tests.",
                      "Բժիշկը կարող է վերանայել տվյալներն առանց լրացուցիչ թեստերի։", "Ваш врач может рассмотреть ваше дело без дополнительных исследований."
                    )
                  : scheduled
                    ? copy(
                        l,
                        "Your test requests are saved. Results are still pending.",
                        "Հետազոտությունների ձեր հայտերը պահպանված են։ Սպասում ենք արդյունքներին։", "Ваши заявки на исследования сохранены. Ожидаются результаты."
                      )
                    : copy(
                        l,
                        "Arrange your remaining tests.",
                        "Պլանավորեք մնացած թեստերը։", "Запланируйте оставшиеся исследования."
                      )}
          </p>
          <p className="text-body2 text-muted-foreground">
            {copy(l, "Assigned GP", "Ձեր բժիշկը", "Назначенный врач")}:{" "}
            {doctor?.name ?? copy(l, "Assignment pending", "Նշանակման սպասում", "Ожидается назначение")}
          </p>
          {window && !w.publication && (
            <p className="text-body2">
              {copy(
                l,
                "Review expected in 1–2 working days",
                "Վերանայում՝ 1–2 աշխատանքային օրվա ընթացքում", "Рассмотрение ожидается в течение 1-2 рабочих дней"
              )}
              : {stamp(window.from, l, false)}{l === "ru" ? " - " : " – "}{stamp(window.to, l, false)}
            </p>
          )}
          {w.appointment && (
            <p className="text-body2">
              {copy(l, "GP appointment", "Բժշկի այց", "Приём врача")}:{" "}
              {stamp(w.appointment.at, l)} ({w.appointment.status})
            </p>
          )}
        </div>
        <CareLink href={w.publication ? "/patient/care" : "/patient/service"}>
          {w.publication
            ? copy(l, "Read your treatment plan", "Կարդալ բուժման պլանը", "Прочитать ваш план лечения")
            : copy(
                l,
                "Manage tests and appointment",
                "Կառավարել թեստերն ու այցը", "Управлять исследованиями и приёмом"
              )}
        </CareLink>
      </div>
    </section>
  );
}
export function ServiceBooking({
  workflow: w,
  locale: l,
}: {
  workflow: ServiceWorkflow;
  locale: Locale;
}) {
  const { run, pending, error } = useWorkflowCommand(w);
  const unbooked = w.tests.filter(t => !w.receivedTestIds.includes(t.id) && !w.bookings.some(b => bookingApplies(w,b,t.id)));
  const [selected, setSelected] = useState<string[]>(() => {
    const first = unbooked[0];
    return first?.method === "lab" ? unbooked.filter(t => t.method === "lab").map(t => t.id) : first ? [first.id] : [];
  });
  const [selectionSwitch, setSelectionSwitch] = useState<{ next: string[]; excluded: string[]; mode?: "home" | "clinic" } | null>(null);
  const switchHeading = useRef<HTMLHeadingElement>(null);
  const switchTrigger = useRef<HTMLInputElement>(null);
  const switchWasOpen = useRef(false);
  useEffect(() => {
    if (selectionSwitch) switchHeading.current?.focus();
    else if (switchWasOpen.current) switchTrigger.current?.focus();
    switchWasOpen.current = !!selectionSwitch;
  }, [selectionSwitch]);
  const [confirmation, setConfirmation] = useState("");
  const [replacing, setReplacing] = useState<string | undefined>();
  const [mode, setMode] = useState<"home" | "clinic">(unbooked[0]?.method === "home-log" ? "home" : "clinic");
  const bookingHeading = useRef<HTMLHeadingElement>(null);
  const rescheduleTrigger = useRef<HTMLButtonElement>(null);
  const previousReplacing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (replacing) {
      bookingHeading.current?.focus({ preventScroll: true });
      bookingHeading.current?.scrollIntoView({ block: "start" });
    } else if (previousReplacing.current) {
      rescheduleTrigger.current?.focus();
    }
    previousReplacing.current = replacing;
  }, [replacing]);
  const earliest = earliestAppointmentDay(w);
  const today = armeniaDate(new Date());
  const replacingBooking = w.bookings.find(booking => booking.id === replacing);
  const bookingDay = replacingBooking ? armeniaDate(new Date(replacingBooking.at)) : today;
  const bookingTime = replacingBooking ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(replacingBooking.at)) : "09:00";
  const doctor = w.doctors.find((d) => d.id === w.assignedDoctorId);
  const homeLog = selected.some(
    (id) => w.tests.find((t) => t.id === id)?.method === "home-log",
  );
  const outstanding = w.tests.filter((t) => !w.receivedTestIds.includes(t.id));
  const stillToSchedule = outstanding.filter(test => !w.bookings.some(booking => booking.id !== replacing && bookingApplies(w, booking, test.id)));
  const showArrange = !!replacing || unbooked.length > 0 || w.tests.length === 0 || !!w.recommendationsPending;
  const gpSection = (<CareSection
            title={copy(l, "Your assigned GP", "Ձեր նշանակված բժիշկը", "Ваш назначенный врач")}
            detail={w.consultation === "required" ? copy(
              l,
              "Appointments start at least 3 calendar days after your last test date. Changing test dates may mean choosing a new GP appointment.",
              "Բժշկի այցը կարող եք պլանավորել վերջին հետազոտության օրվանից առնվազն 3 օր հետո։ Հետազոտության օրը փոխելու դեպքում կարող է պետք լինել փոխել նաև բժշկի այցը։", "Приём можно назначить не ранее чем через 3 календарных дня после последнего исследования. При изменении даты исследований может потребоваться новая запись к врачу."
            ) : undefined}
          >
            <p className="text-body1 font-medium">
              {doctor?.name ?? copy(l, "Assignment pending", "Բժշկի նշանակումը սպասվում է", "Ожидается назначение")}
            </p>
            {w.appointment && (
              <p className="text-body2">
                {stamp(w.appointment.at, l)} · {w.appointment.mode} ·{" "}
                {w.appointment.status}
              </p>
            )}
            {w.consultation !== "required" ? (
              <>
                <p className="rounded-md bg-muted p-4 text-body2">
                  {w.consultation === "not-required"
                    ? copy(l, "Your GP has confirmed that a consultation is not needed for this review.", "Բժիշկը հաստատել է, որ այս վերանայման համար խորհրդատվություն պետք չէ։", "Ваш врач подтвердил, что консультация для этого рассмотрения не требуется.")
                    : copy(l, "Your GP will decide whether a consultation is needed after reviewing your case.", "Բժիշկը կորոշի՝ խորհրդատվություն պե՞տք է, երբ վերանայի ձեր տվյալները։", "Ваш врач решит, нужна ли консультация, после рассмотрения вашего дела.")}
                </p>
                {w.consultation === "undecided" && w.allResultsAt && !w.publication && (
                  <p className="mt-3 rounded-md border p-4 text-body2">
                    {copy(
                      l,
                      "Your GP is reviewing your case. We expect a review within 1–2 working days after all results arrive. If you have not heard back, contact info@noreon.health.",
                      "Բժիշկը վերանայում է ձեր տվյալները։ Սպասվող ժամկետը բոլոր արդյունքների ստացումից հետո 1–2 աշխատանքային օր է։ Եթե այդ ընթացքում պատասխան չստանաք, կապվեք info@noreon.health հասցեով։", "Ваш врач рассматривает ваше дело. Ожидаемый срок: 1-2 рабочих дня после получения всех результатов. Если ответа нет, напишите на info@noreon.health."
                    )}
                  </p>
                )}
              </>
            ) : earliest ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  run({
                    type: "appointment",
                    at: formTime(data),
                    mode: data.get("mode") as "video" | "clinic",
                  });
                }}
              >
                <fieldset className="space-y-4" disabled={pending}>
                  <SlotFields
                    min={earliest < today ? today : earliest}
                    prefix="gp"
                    locale={l}
                  />
                  <label className="block space-y-2 text-body2">
                    <span>{copy(l, "Appointment format", "Այցի ձևաչափը", "Формат приёма")}</span>
                    <select name="mode" className={inputClass}>
                      <option value="video">{copy(l, "Video consultation", "Տեսախորհրդատվություն", "Видеоконсультация")}</option>
                      <option value="clinic">{copy(l, "At the clinic", "Կլինիկայում", "В клинике")}</option>
                    </select>
                  </label>
                  <button className={buttonClass}>
                    {w.appointment
                      ? copy(l, "Change GP appointment", "Փոխել բժշկի այցը", "Изменить запись к врачу")
                      : copy(l, "Book GP appointment", "Պլանավորել բժշկի այցը", "Записаться к врачу")}
                  </button>
                </fieldset>
              </form>
            ) : (
              <p className="rounded-md bg-muted p-4 text-body2">
                {copy(l, "Arrange every outstanding test first. If a scheduled test is overdue and its result has not arrived, reschedule it or receive the result before booking your GP.", "Նախ պլանավորեք բոլոր դեռ չկատարված հետազոտությունները։ Եթե հետազոտության պլանավորված օրը անցել է, բայց արդյունքը դեռ չկա, փոխեք օրը կամ սպասեք արդյունքին՝ բժշկի այցը պլանավորելուց առաջ։", "Сначала запланируйте все оставшиеся исследования. Если дата исследования прошла, а результата ещё нет, перенесите исследование или дождитесь результата перед записью к врачу.")}
              </p>
            )}
          </CareSection>);
  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <h1 className="text-h1 booking-page-heading break-words">
          {copy(
            l,
            w.bookings.some(b => b.status === "scheduled") ? "Your tests" : "Book your tests",
            w.bookings.some(b => b.status === "scheduled") ? "Ձեր հետազոտությունները" : "Պլանավորեք ձեր հետազոտությունները", w.bookings.some(b => b.status === 'scheduled') ? 'Ваши исследования' : 'Записаться на исследования'
          )}
        </h1>
        <p className="max-w-2xl text-body2 text-muted-foreground">
          {copy(
            l,
            "Arrange your tests and follow your GP’s next steps.",
            "Պլանավորեք հետազոտությունները և հետևեք բժշկի հաջորդ քայլերին։", "Запланируйте исследования и следуйте дальнейшим указаниям вашего врача."
          )}
        </p>
      </header>
      <ActionError error={error} />
      {confirmation && !error && <p role="status" className="rounded-md bg-muted p-4 text-body2">{confirmation}</p>}
      {stillToSchedule.length > 0 && <section data-still-to-schedule className="space-y-2 rounded-md border p-4">
        <h2 className="text-body2 font-semibold">{replacing ? copy(l, "Recommendations for this change", "Այս փոփոխության համար առաջարկվող հետազոտությունները", "Рекомендации для этого изменения") : copy(l, "Still to schedule", "Դեռ պետք է պլանավորել", "Осталось запланировать")}</h2>
        {replacing && <p className="text-body2 text-muted-foreground">{copy(l, "Your existing request stays recorded until you save. Switching tests does not change it.", "Ձեր առկա հայտը պահպանվում է մինչև փոփոխությունը պահպանելը։ Հետազոտություններն ընտրելիս այն չի փոխվում։", "Ваша существующая заявка сохранится до сохранения изменений. Смена исследований её не меняет.")}</p>}
        <ul className="space-y-1 text-body2">{stillToSchedule.map(test => <li key={test.id}>{testTitle(test, l)}</li>)}</ul>
      </section>}
      <div className={showArrange ? "grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]" : "space-y-6"}>
        {showArrange && <section className="journey-card scroll-mt-6 space-y-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <header>
            <h2 ref={bookingHeading} tabIndex={-1} className="scroll-mt-6 text-h2 focus-visible:outline-2 focus-visible:outline-ring">{replacing ? copy(l,"Reschedule your tests","Փոխել հետազոտությունների ժամը", "Перенести ваши исследования") : copy(l,"Arrange your tests","Պլանավորեք ձեր թեստերը", "Запланировать ваши исследования")}</h2>
            <p className="mt-2 max-w-2xl text-body2 text-muted-foreground">{copy(l,"Group laboratory tests into one visit. Choose clinic collection or a home visit.","Լաբորատոր հետազոտությունները կարող եք խմբավորել մեկ այցի համար։ Ընտրեք կլինիկայում կամ տանը նմուշառումը։", "Объедините лабораторные исследования в один визит. Выберите забор в клинике или выезд на дом.")}</p>
          </header>
          {w.recommendationsPending ? <div className="space-y-3"><p className="text-body2">{copy(l,"Complete your questions before arranging new tests. Your existing reservations are shown alongside.","Ավարտեք հարցերը՝ նոր հետազոտություններ պլանավորելուց առաջ։ Ձեր առկա պլանավորումները ցուցադրված են կողքին։", "Завершите вопросы перед планированием новых исследований. Существующие записи показаны рядом.")}</p><CareLink href="/patient/questions">{copy(l,"Continue your questionnaire","Շարունակել հարցաշարը", "Продолжить анкету")}</CareLink></div> : w.tests.length === 0 ? (
            <p className="text-body2">
              {copy(
                l,
                "No additional tests are listed. Your GP can review the completed questionnaire and decide what happens next.",
                "Լրացուցիչ հետազոտություններ չկան։ Բժիշկը կարող է վերանայել լրացված հարցաշարը և որոշել հաջորդ քայլերը։", "Дополнительные исследования не назначены. Ваш врач может рассмотреть заполненную анкету и определить следующие шаги."
              )}
            </p>
          ) : outstanding.length === 0 ? (
            <p className="rounded-md bg-muted p-4 text-body2">
              {copy(
                l,
                w.publication ? "All ordered results are included in your published review." : "All ordered results have been received. Your GP will review them.",
                w.publication ? "Բոլոր նշանակված հետազոտությունների արդյունքները ներառված են հրապարակված վերանայման մեջ։" : "Բոլոր նշանակված հետազոտությունների արդյունքներն ստացվել են։ Բժիշկը կվերանայի դրանք։", w.publication ? 'Все назначенные результаты включены в опубликованное рассмотрение.' : 'Все назначенные результаты получены. Ваш врач рассмотрит их.'
              )}
            </p>
          ) : !replacing && unbooked.length === 0 ? (
            <p className="text-body2">{copy(l, "Your test requests are saved. See the date and details under Your test requests.", "Հետազոտությունների ձեր հայտերը պահպանված են։ Օրը և մանրամասները տեսեք հետազոտությունների ձեր հայտերի բաժնում։", "Ваши заявки на исследования сохранены. Дата и подробности доступны в разделе «Ваши заявки на исследования».")}</p>
          ) : (
          <form
            key={replacing ?? "new-test-request"}
            onSubmit={(e) => {
              e.preventDefault();
              if (selectionSwitch) return;
              const data = new FormData(e.currentTarget);
              run(
                {
                  type: "book",
                  testIds: selected,
                  at: formTime(data),
                  mode,
                  address: String(data.get("address") ?? ""),
                  replacingId: replacing,
                },
                () => {
                  setSelected([]);
                  setSelectionSwitch(null);
                  setReplacing(undefined);
                  setConfirmation(copy(l, "Your test request is saved. See the details under Your test requests.", "Հետազոտության ձեր հայտը պահպանված է։ Մանրամասները տեսեք հետազոտությունների ձեր հայտերի բաժնում։", "Ваша заявка на исследование сохранена. Подробности доступны в разделе «Ваши заявки на исследования»."));
                },
              );
            }}
            className="space-y-5"
          >
            <fieldset disabled={pending || !!selectionSwitch} className="space-y-5">
              {(["lab", "clinic", "home-log"] as const).map((method) => {
                const tests = outstanding.filter((t) => t.method === method);
                return (
                  tests.length > 0 && (
                    <fieldset key={method} className="space-y-2">
                      <legend className="mb-2 text-body2 font-semibold">
                        {method === "lab"
                        ? copy(l, "Laboratory tests", "Լաբորատոր հետազոտություններ", "Лабораторные исследования")
                          : method === "clinic"
                            ? copy(l, "Clinic measurements", "Կլինիկայում կատարվող չափումներ", "Измерения в клинике")
                            : copy(l, "Home records", "Տնային գրառումներ", "Домашние записи")}
                      </legend>
                      {tests.map((t) => {
                        const booked = w.bookings.some(
                          (b) =>
                            b.status === "scheduled" &&
                            b.id !== replacing &&
                            b.testIds.includes(t.id),
                        );
                        return (
                          <label
                            key={t.id}
                            className="flex min-h-12 items-start gap-3 rounded-md border p-3"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-primary"
                              checked={selected.includes(t.id)}
                              disabled={booked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? t.method === "lab"
                                    ? [...selected.filter(id => w.tests.find(test => test.id === id)?.method === "lab"), t.id]
                                    : [t.id]
                                  : selected.filter(id => id !== t.id);
                                const excluded = selected.filter(id => !next.includes(id));
                                const nextMode = t.method === "home-log" ? "home" : t.method === "clinic" ? "clinic" : undefined;
                                if (e.target.checked && excluded.length > 0) {
                                  switchTrigger.current = e.currentTarget;
                                  setSelectionSwitch({ next, excluded, mode: nextMode });
                                } else {
                                  setSelected(next);
                                  if (nextMode) setMode(nextMode);
                                }
                              }}
                            />
                            <span>
                              <span className="text-body2 font-medium">
                                {testTitle(t, l)}
                              </span>
                              <span className="block text-caption text-muted-foreground">
                              {booked
                                ? copy(l, "Already scheduled", "Արդեն պլանավորված է", "Уже запланировано")
                                : copy(l, "Suggested from your answers", "Առաջարկված է ձեր պատասխանների հիման վրա", "Предложено на основе ваших ответов")}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )
                );
              })}
              <label className="block space-y-2 text-body2">
                <span>
                  {homeLog
                    ? copy(l, "Record location", "Գրառման վայրը", "Место ведения записей")
                    : copy(l, "Collection location", "Նմուշառման վայրը", "Место забора")}
                </span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "home" | "clinic")}
                  className={inputClass}
                >
                  <option value="clinic" disabled={homeLog}>
                    {copy(l, "At a clinic", "Կլինիկայում", "В клинике")}
                  </option>
                  <option
                    value="home"
                    disabled={selected.some(
                      (id) =>
                        w.tests.find((t) => t.id === id)?.method === "clinic",
                    )}
                  >
                    {copy(l, "At home", "Տանը", "Дома")}
                  </option>
                </select>
              </label>
              {mode === "home" && !homeLog && (
                <label className="block space-y-2 text-body2">
                  <span>{copy(l, "Home address", "Տան հասցե", "Домашний адрес")}</span>
                  <input
                    name="address"
                    defaultValue={replacingBooking?.address ?? ""}
                    className={inputClass}
                    required
                    maxLength={160}
                    placeholder={copy(l, "Enter an address", "Մուտքագրեք հասցեն", "Введите адрес")}
                  />
                </label>
              )}
              {homeLog && (
                <p className="text-body2">
                  {copy(
                    l,
                    "Choose when you expect to finish your home record. This plans a task, not a home visit. Follow your clinician’s measurement instructions.",
                    "Նշեք, թե երբ եք նախատեսում ավարտել տնային գրառումը։ Սա առաջադրանքի պլանավորում է, ոչ թե տնային այց։ Հետևեք բժշկի չափման ցուցումներին։", "Выберите, когда вы планируете завершить домашние записи. Это планирование задания, а не выезда на дом. Следуйте указаниям вашего врача по измерениям."
                  )}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-body2" htmlFor="tests-day">
                  <span>{copy(l,"Date","Ամսաթիվ", "Дата")}</span>
                  <input className={inputClass} id="tests-day" name="day" type="date" min={today} defaultValue={bookingDay} required/>
                </label>
                <label className="space-y-2 text-body2" htmlFor="tests-time">
                  <span>{copy(l,"Time in Armenia (UTC+4)","Ժամը Հայաստանում (UTC+4)", "Время в Армении (UTC+4)")}</span>
                  <select className={inputClass} id="tests-time" name="time" defaultValue={bookingTime}>
                    <option>09:00</option><option>11:00</option><option>14:00</option>
                  </select>
                </label>
              </div>
              <div className="rounded-md bg-muted p-4 text-body2">
                <p className="font-medium">
                  {copy(l, "Preparation needs provider confirmation", "Նախապատրաստումը ճշտեք բուժծառայություն մատուցողի հետ", "Уточните подготовку у поставщика медицинских услуг")}
                </p>
                <p className="mt-1">
                  {demoPreparation[clinicalLocale(l)]}
                </p>
              </div>
              <button
                disabled={pending || selected.length === 0}
                className={buttonClass}
              >
                {pending
                  ? copy(l, "Saving…", "Պահվում է…", "Сохранение…")
                  : replacing
                    ? copy(l, "Save new test time", "Պահպանել նոր ժամը", "Сохранить новое время исследования")
                    : homeLog
                      ? copy(l, "Plan home record completion", "Պլանավորել տնային գրառումը", "Запланировать завершение домашних записей")
                      : copy(l, "Plan tests", "Պլանավորել հետազոտությունները", "Запланировать исследования")}
              </button>
              {replacing && (
                <button
                  type="button"
                  className={`${quietClass} ml-2`}
                  onClick={() => {
                    setReplacing(undefined);
                    setSelectionSwitch(null);
                    setSelected([]);
                  }}
                >
                  {copy(l, "Stop rescheduling", "Չեղարկել ժամի փոփոխությունը", "Отменить перенос")}
                </button>
              )}
            </fieldset>
            {selectionSwitch && <section role="alertdialog" aria-label={copy(l, "Switch selected tests?", "Փոխե՞լ ընտրված հետազոտությունները", "Сменить выбранные исследования?")} className="space-y-3 rounded-md border bg-muted p-4">
              <h3 ref={switchHeading} tabIndex={-1} className="text-body2 font-semibold outline-none">{copy(l, "Switch selected tests?", "Փոխե՞լ ընտրված հետազոտությունները", "Сменить выбранные исследования?")}</h3>
              <p className="text-body2">{copy(l, "These tests will be removed from this request. They will remain available to arrange separately.", "Այս հետազոտությունները կհեռացվեն այս հայտից։ Դուք կարող եք դրանք առանձին պլանավորել։", "Эти исследования будут удалены из этой заявки. Их можно будет запланировать отдельно.")}</p>
              <ul className="space-y-1 text-body2">{selectionSwitch.excluded.map(id => <li key={id}>{testTitle(w.tests.find(test => test.id === id) ?? { id, title: id }, l)}</li>)}</ul>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={quietClass} onClick={() => setSelectionSwitch(null)}>{copy(l, "Keep current selection", "Պահպանել ընթացիկ ընտրությունը", "Сохранить текущий выбор")}</button>
                <button type="button" className={buttonClass} onClick={() => { setSelected(selectionSwitch.next); if (selectionSwitch.mode) setMode(selectionSwitch.mode); setSelectionSwitch(null); }}>{copy(l, "Switch tests", "Փոխել հետազոտությունների ընտրությունը", "Сменить исследования")}</button>
              </div>
            </section>}
          </form>
          )}
        </section>}
        <div className="space-y-6">
          <CareSection title={copy(l, "Your test requests", "Հետազոտությունների ձեր հայտերը", "Ваши заявки на исследования")}>
            {w.bookings.filter((b) => b.status === "scheduled").length === 0 ? (
              <p className="text-body2 text-muted-foreground">
                {copy(l, "Your test bookings will appear here.", "Ձեր հետազոտությունների պլանավորումները կհայտնվեն այստեղ։", "Здесь появятся ваши записи на исследования.")}
              </p>
            ) : (
              w.bookings
                .filter((b) => b.status === "scheduled")
                .map((b) => {
                  const hasReceivedResult = bookingHasReceipt(w,b);
                  const remaining = b.testIds.filter(id=>w.requirements?.some(r=>r.test.id===id && r.retiredAtRevision===null && b.requirementIds?.includes(r.requirementId)));
                  return (
                  <article
                    key={b.id}
                    className="space-y-3 border-b pb-5 last:border-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{stamp(b.at, l)}</p><span className="rounded-md bg-muted px-2 py-1 text-caption">{b.review || w.recommendationsPending ? copy(l,'Review needed','Վերանայման կարիք ունի', "Требуется рассмотрение") : bookingResultsReceived(w,b) ? copy(l,'Results received','Արդյունքները ստացված են', "Результаты получены") : hasReceivedResult ? copy(l,'Results arriving','Արդյունքները ստացվում են', "Результаты поступают") : copy(l,'Requested','Հայտն ուղարկված է', "Заявка отправлена")}</span></div>
                    {w.recommendationsPending && <p className="text-body2">{copy(l,"Your reservation is retained. Complete your questions to check it against the updated recommendations.","Ձեր պլանավորումը պահպանված է։ Ավարտեք հարցերը՝ այն նոր առաջարկությունների հետ համեմատելու համար։", "Ваша запись сохранена. Завершите вопросы, чтобы проверить её соответствие обновлённым рекомендациям.")}</p>}
                    {b.review && <div className="space-y-2 rounded-md bg-muted p-3">
                      <p className="text-body2">{copy(l,"Your recommendations changed. Review this reservation before using it for your current plan.","Ձեր առաջարկությունները փոխվել են։ Վերանայեք այս պլանավորումը՝ ընթացիկ պլանում օգտագործելուց առաջ։", "Ваши рекомендации изменились. Проверьте эту запись перед использованием в текущем плане лечения.")}</p>
                      <p className="text-caption">{copy(l,"Affected tests: ","Փոփոխված հետազոտություններ՝ ", "Затронутые исследования: ")}{b.review.changedTestIds.map(id=>b.testSnapshots?.find(t=>t.id===id)?.title ?? id).join(", ")}</p>
                      {!!remaining.length && <button className={quietClass} disabled={pending || w.recommendationsPending} onClick={()=>run({type:"confirm-booking",bookingId:b.id,testIds:remaining})}>
                        {copy(l,"Keep unchanged tests: ","Պահպանել անփոփոխ հետազոտությունները՝ ", "Сохранить неизменённые исследования: ")}{remaining.map(id=>testTitle(w.tests.find(t=>t.id===id) ?? { id, title: id }, l)).join(", ")}
                      </button>}
                    </div>}
                    <p className="text-body2">
                      {b.testIds.length > 0 && b.testIds.every((id) =>
                        (b.testSnapshots?.find(t => t.id === id) ?? w.tests.find(t => t.id === id))?.method === "home-log",
                      )
                      ? copy(l, "Home recording task", "Տնային գրառման առաջադրանք", "Задание для домашних записей")
                        : b.mode === "office" ? `${copy(l, "Office visit", "Այց աշխատավայր", "Визит в клинику")} · ${b.address}` : b.mode === "home"
                          ? `${copy(l, "Home visit", "Տնային այց", "Выезд на дом")}: ${b.address}`
                          : copy(l, "Demo clinic · address not confirmed", "Ցուցադրական կլինիկա․ հասցեն հաստատված չէ", "Демонстрационная клиника · адрес не подтверждён")}
                    </p>
                    <details><summary className="min-h-11 cursor-pointer text-body2 text-primary">{copy(l,'Tests','Հետազոտություններ', "Исследования")} ({b.testIds.length})</summary><ul className="space-y-1 pb-2 text-body2 text-muted-foreground">{b.testIds.map(id => <li key={id}>{b.testSnapshots?.find(t=>t.id===id)?.title ?? w.tests.find(t=>t.id===id)?.title ?? id}</li>)}</ul></details>
                    <BookingPreparation workflow={w} booking={b} locale={l}/>
                    {(!hasReceivedResult || b.review) && <div className="flex flex-wrap gap-2">
                      {!hasReceivedResult && <button
                        className={quietClass}
                        disabled={
                          pending ||
                          w.recommendationsPending
                        }
                        onClick={(event) => {
                          rescheduleTrigger.current = event.currentTarget;
                          setSelectionSwitch(null);
                          setReplacing(b.id);
                          setSelected(b.testIds.filter(id=>w.tests.some(t=>t.id===id) && !w.receivedTestIds.includes(id)));
                          if (b.mode !== "office") setMode(b.mode);
                        }}
                      >
                        {copy(l, "Reschedule tests", "Փոխել հետազոտության ժամը", "Перенести исследования")}
                      </button>}
                      <button
                        className={quietClass}
                        disabled={pending}
                        onClick={() => run({ type: "cancel", bookingId: b.id }, () => { setConfirmation(copy(l, "Booking cancelled. You can choose another date.", "Պլանավորումը չեղարկված է։ Կարող եք ընտրել այլ օր։", "Запись отменена. Вы можете выбрать другую дату.")); setSelected(b.testIds); if (b.mode !== "office") setMode(b.mode); })}
                      >
                        {copy(l, "Cancel booking", "Չեղարկել պլանավորումը", "Отменить запись")}
                      </button>
                    </div>}
                    {hasReceivedResult && !b.review && !bookingResultsReceived(w,b) && (
                      <details>
                        <summary className="min-h-11 cursor-pointer text-caption text-muted-foreground">{copy(l,"Why can’t I change this booking?","Ինչո՞ւ չի կարելի փոխել այս պլանավորումը", "Почему я не могу изменить эту запись?")}</summary>
                        <p className="pb-2 text-caption text-muted-foreground">
                        {copy(
                          l,
                          "This booking includes a test with a received result, so it cannot be changed or cancelled.",
                          "Այս պլանավորման հետ կապված հետազոտություններից մեկի արդյունքն արդեն ստացվել է, ուստի այն հնարավոր չէ փոխել կամ չեղարկել։", "В эту запись входит исследование с уже полученным результатом, поэтому её нельзя изменить или отменить."
                        )}
                        </p>
                      </details>
                    )}
                  </article>
                  );
                })
            )}
          </CareSection>
          {w.bookings.some(b=>b.status==='cancelled') && <details className="rounded-xl border p-5"><summary className="cursor-pointer text-body2 font-semibold">{copy(l,"Previous test bookings","Հետազոտությունների նախորդ պլանավորումները", "Предыдущие записи на исследования")}</summary><div className="mt-4 space-y-4">{w.bookings.filter(b=>b.status==='cancelled').map(b=><article key={b.id} className="space-y-1 border-b pb-3"><p className="text-body2">{stamp(b.at,l)} · {b.replacedBy ? copy(l,"Replaced","Փոխարինված", "Заменено") : copy(l,"Cancelled","Չեղարկված", "Отменено")}</p><p className="text-caption">{b.testIds.map(id=>b.testSnapshots?.find(t=>t.id===id)?.title ?? id).join(", ")}</p><p className="text-caption">{b.address || (b.mode==='home' ? copy(l,"Home task","Տնային առաջադրանք", "Домашнее задание") : copy(l,"Clinic","Կլինիկա", "Клиника"))}</p></article>)}</div></details>}
          {w.consultation === "required" && earliest ? gpSection : <details className="rounded-xl border px-5 py-2"><summary className="min-h-11 cursor-pointer py-2 text-body2 font-semibold">{copy(l,"Your assigned GP","Ձեր նշանակված բժիշկը", "Ваш назначенный врач")} · {w.consultation === "not-required" ? copy(l,"Consultation not needed","Խորհրդատվություն պետք չէ", "Консультация не требуется") : w.consultation === "required" ? copy(l,"Arrange tests first","Նախ պլանավորեք հետազոտությունները", "Сначала запланируйте исследования") : w.allResultsAt && !w.publication ? copy(l,"Review pending","Վերանայումը սպասվում է", "Ожидается рассмотрение") : copy(l,"Consultation decision pending","Խորհրդատվության որոշումը սպասվում է", "Ожидается решение о консультации")}</summary><div className="pb-3">{gpSection}</div></details>}
        </div>
      </div>
      <details className="rounded-xl border px-5 py-2"><summary className="min-h-11 cursor-pointer py-2 text-body2 font-semibold">{copy(l,"Previous reports","Նախորդ արդյունքները", "Прежние результаты")}</summary><div className="pb-3"><HistoricalReminder locale={l} /></div></details>

    </div>
  );
}
