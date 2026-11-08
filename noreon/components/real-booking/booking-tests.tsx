"use client";

import { memberInstruction } from "@/lib/text-language";
import { useId } from "react";
import { Check, ChevronDown, Droplet, House, Stethoscope } from "lucide-react";
import type { Appointment, PublicProgramItem } from "@/lib/real-booking/appointment-schema";
import { bookingCopy as t, visitAttended, type BookingLocale } from "./appointment-status";

/**
 * Member booking in the prototype's style (pairs 08, 09), on our booking model: one visit covers
 * all the tests, so each test is a card with its own state and preparation, and the single
 * "Book this visit" form stays below. A test's state comes only from saved appointments: booked
 * when a confirmed visit covers it, requested while the clinic has not answered. A cancelled or
 * failed visit covers nothing. Staff views keep BookingProgram.
 */
type TestState = "done" | "booked" | "requested" | "to-book" | "home";
const PENDING: Appointment["status"][] = ["notification-pending", "unknown", "reconciliation"];
/** A visit still exists while it has a clinic-accepted arrangement and is not cancelled. A failed
 *  cancellation or time change leaves that visit booked (#256 review F1). */
const holdsVisit = (a: Appointment) => a.status !== "cancelled" && !!a.current;
const active = (a: Appointment) => holdsVisit(a) || (PENDING.includes(a.status) && a.noticePurpose !== "cancellation");
/** Done (QA 176): the visit that covers the test took place, a clinic visit the clinic recorded as
 *  attended or a home visit the nurse completed (`doneTestIds`, from the completed requests). */
export function testStates(program: PublicProgramItem[], appointments: Appointment[], doneTestIds: readonly string[] = []) {
  const done = new Set([...doneTestIds, ...appointments.filter((a) => holdsVisit(a) && visitAttended(a)).flatMap((a) => a.current!.coveredTestIds)]);
  // Booked: on an accepted visit that is not cancelled, whatever email or change is in flight.
  const booked = new Set(appointments.filter(holdsVisit).flatMap((a) => a.current!.coveredTestIds));
  // Requested: a new booking or a change still waiting on the clinic; a cancellation never adds tests.
  const requested = new Set(appointments.filter((a) => PENDING.includes(a.status) && a.noticePurpose !== "cancellation").flatMap((a) => a.proposed.coveredTestIds).filter((id) => !booked.has(id)));
  return new Map<string, TestState>(program.map((item) => [item.id, item.method === "home-log" ? "home" : done.has(item.id) ? "done" : booked.has(item.id) ? "booked" : requested.has(item.id) ? "requested" : "to-book"]));
}

const STATE_LABEL: Record<TestState, [string, string, string]> = {
  done: ["Done", "Կատարված է", "Выполнено"],
  booked: ["Booked", "Գրանցված է", "Записано"],
  requested: ["Requested", "Հարցված է", "Запрошено"],
  "to-book": ["To book", "Գրանցելու", "Нужно записаться"],
  home: ["At home", "Տանը", "Дома"],
};

export function BookingTests({ program, appointments, locale, offered = false, homeRequest = false, doneTestIds = [] }: {
  program: PublicProgramItem[]; appointments: Appointment[]; locale: BookingLocale;
  /** Tests whose home visit the nurse completed (QA 176). */
  doneTestIds?: readonly string[];
  /** Visit times are offered below, so "choose where and when below" is true. */
  offered?: boolean;
  /** A home-visit request is open (shown below the booking): its tests are not "to book" (#256 F2). */
  homeRequest?: boolean;
}) {
  const headingId = useId();
  const states = testStates(program, appointments, doneTestIds);
  const bookable = program.filter((item) => item.method !== "home-log");
  const done = bookable.filter((item) => states.get(item.id) === "done").length;
  // A test whose visit took place was booked too, so the ring and count include it.
  const booked = done + bookable.filter((item) => states.get(item.id) === "booked").length;
  const allDone = bookable.length > 0 && done === bookable.length;
  const requested = bookable.filter((item) => states.get(item.id) === "requested").length;
  const left = bookable.length - booked - requested;
  const headerRow = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={headingId} className="min-w-0 text-h2">{t(locale, "Your tests", "Ձեր հետազոտությունները", "Ваши анализы")}</h2>
        {bookable.length > 0 && !homeRequest && (
          <span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0">
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--chart-track)" strokeWidth="5" />
              {booked > 0 && <circle cx="20" cy="20" r="16" pathLength="100" fill="none" stroke="var(--noreon-teal-600)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(booked / bookable.length) * 100} 100`} transform="rotate(-90 20 20)" />}
            </svg>
            <span className="tabular-nums">
              {allDone
                ? t(locale, `${done} of ${bookable.length} done`, `${done}՝ ${bookable.length}-ից կատարված`, `Выполнено: ${done} из ${bookable.length}`)
                : t(locale, `${booked} of ${bookable.length} booked`, `${booked}՝ ${bookable.length}-ից գրանցված`, `Записано: ${booked} из ${bookable.length}`)}
              {requested > 0 && <span className="block">{t(locale, `${requested} requested`, `${requested}՝ հարցված`, `Запрошено: ${requested}`)}</span>}
            </span>
          </span>
        )}
      </div>
  );
  const list = (
      <ul className="flex flex-col gap-3">
        {program.map((item) => {
          const state = states.get(item.id)!;
          const Icon = item.method === "home-log" ? House : item.method === "clinic" ? Stethoscope : Droplet;
          return (
            <li key={item.id} className="journey-card booking-test" data-test-state={state}>
              <div className="flex items-start gap-3">
                <span className="booking-test-icon" aria-hidden><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <h3 className="min-w-0 break-words text-body1 font-semibold">{item.title}</h3>
                    {!(homeRequest && state === "to-book") && <span className="booking-test-state">{t(locale, ...STATE_LABEL[state])}</span>}
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {item.method === "home-log" ? t(locale, "You record this at home", "Սա գրանցում եք տանը", "Вы записываете это дома") : item.method === "clinic" ? t(locale, "Done during the visit", "Կատարվում է այցի ընթացքում", "Выполняется во время визита") : t(locale, "From a sample taken at the visit", "Այցի ընթացքում վերցված նմուշից", "По образцу, взятому во время визита")}
                  </p>
                </div>
              </div>
              {item.preparation && (
                <details className="group/prep border-t border-border">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-body2 font-semibold text-[var(--noreon-teal-800)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    {t(locale, "How to prepare", "Ինչպես պատրաստվել", "Как подготовиться")}
                    <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open/prep:rotate-180" />
                  </summary>
                  <p className="whitespace-pre-wrap break-words pb-2 text-body2">{memberInstruction(item.preparation, locale)}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
  );
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-booking-tests>
      {/* QA decision (check-booking-email-ui): the full program is a compact disclosure, so the page
          never shows a second expanded list next to the visit form or card. */}
      <details data-booking-program className="group/tests journey-card !block">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">{headerRow}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open/tests:rotate-180" />
        </summary>
        <div className="space-y-3 pt-3">
          {appointments.length === 0 && offered && !homeRequest && left > 1 && (
            <p className="text-body2 text-muted-foreground">{t(locale, "One visit covers all of these tests. Choose where and when below.", "Մեկ այցը ներառում է այս բոլոր հետազոտությունները։ Ստորև ընտրեք վայրն ու ժամը։", "Один визит включает все эти анализы. Выберите место и время ниже.")}</p>
          )}
          {homeRequest && <p className="text-body2 text-muted-foreground">{t(locale, "Your home visit request below covers these tests.", "Ստորև նշված տնային այցի հարցումը ներառում է այս հետազոտությունները։", "Ваш запрос на визит на дом ниже включает эти анализы.")}</p>}
          {list}
        </div>
      </details>
    </section>
  );
}

/**
 * Where you are, on the booking page (prototype pair 09): the Home strip itself. The index is
 * Home's journeyStripIndex over the same reads, computed by the page (lead decision on #256), so
 * the two strips never disagree. Shown only while a visit or request exists.
 */
export const BOOKING_STRIP_LABELS: [string, string, string][] = [["Questions", "Հարցաշար", "Анкета"], ["Tests", "Թեստեր", "Анализы"], ["Results", "Արդյունք", "Результаты"], ["Plan", "Պլան", "План"]];
export function BookingJourney({ appointments, current, locale }: { appointments: Appointment[]; current?: number; locale: BookingLocale }) {
  if (current === undefined || !appointments.some(active)) return null;
  return (
    <nav aria-label={t(locale, "Where you are", "Որտեղ եք հիմա", "Где вы сейчас")} className="journey-card journey-strip">
      <ol>
        {BOOKING_STRIP_LABELS.map(([en, hy, ru], i) => {
          const state = i < current ? "done" : i === current ? "current" : "next";
          return (
            <li key={en} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="journey-strip-dot" aria-hidden>{state === "done" && <Check className="size-3.5" strokeWidth={3} />}</span>
              <span className="journey-strip-label">
                {t(locale, en, hy, ru)}
                <span className="sr-only">{state === "done" ? t(locale, ", done", ", արված է", ", выполнено") : state === "current" ? t(locale, ", you are here", ", դուք այստեղ եք", ", вы здесь") : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Who the visit involves (prototype actor chip). Home: the nurse comes to you; clinic: you go. */
export function VisitActor({ appointment, locale }: { appointment: Appointment; locale: BookingLocale }) {
  // Hidden while a cancellation is in flight, the same condition AppointmentStatus uses (#256 F4).
  if (appointment.noticePurpose === "cancellation" && appointment.status !== "cancelled") return null;
  const arrangement = appointment.current ?? appointment.proposed;
  const home = arrangement.mode === "home";
  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
      <span className="journey-actor" data-actor={home ? "nurse" : "you"}>{home ? t(locale, "Nurse", "Բուժքույր", "Медсестра") : t(locale, "You", "Դուք", "вы")}</span>
      {home ? t(locale, "A nurse comes to your address.", "Բուժքույրը կգա ձեր հասցեով։", "Медсестра приедет по вашему адресу.") : t(locale, "You go to the clinic.", "Դուք կայցելեք կլինիկա։", "Вы идёте в клинику.")}
    </p>
  );
}
