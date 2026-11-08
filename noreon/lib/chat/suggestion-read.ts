import "server-only";
import type { ZoeThread } from "@/lib/zoe/app-chat-contracts";
import { getPatientState, getMeasurements } from "@/lib/patient/repository";
import { patientPresentation } from "@/lib/patient/presentation";
import { readZoeConsents } from "@/lib/zoe/member";
import { readIntakeState } from "@/lib/zoe/app-chat";
import { hasOpenTaskWarning } from "@/lib/zoe/task-warning";
import { readMemberSafety } from "@/lib/member-safety/member";
import { getCareData } from "@/lib/patient-care/repository";
import { dosesForDay } from "@/lib/patient-care/model";
import { getReminderPreferences } from "@/lib/patient-care/reminder-repository";
import { dailyReminders } from "@/lib/patient-care/reminders";
import { loadMemberMedicines } from "@/lib/member-medicines/server";
import { todaysDoses } from "@/lib/member-medicines/model";
import { readMemberBpWeek } from "@/lib/bp-week/server";
import { currentWeek, nextSlot } from "@/lib/bp-week/model";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import { canBookNewVisit, completedRequestTestIds } from "@/lib/real-booking/visit-gate";
import type { SuggestionState } from "./suggestions";

/** Presentation facts only, from the existing authenticated member reads. No stored card or action is created. */
export async function readMemberSuggestionState(thread: ZoeThread): Promise<SuggestionState | null> {
  if (thread.suggestionSafety !== true) return null;
  try {
    const [member, consent, safety, intake] = await Promise.all([
      getPatientState({ coherentProfile: true }),
      readZoeConsents(),
      readMemberSafety(),
      readIntakeState(),
    ]);
    // Unknown safety or consent never becomes permission to offer routine actions.
    if (!member.profile || !member.assessment || !consent || safety.state === "unknown" || !intake) return null;
    const now = new Date();
    const minutesAgo = (at:string) => (now.getTime()-Date.parse(at))/60_000;
    const contextHold = hasOpenTaskWarning({
      answers:thread.answers.map(a=>({body:a.text,minutesAgo:minutesAgo(a.at)})),
      replies:thread.replies.map(r=>({body:r.text,minutesAgo:minutesAgo(r.at)})),
    });
    const emergency = patientPresentation(member.assessment).urgent;
    const state: SuggestionState = {
      locale: member.profile.locale,
      consent: member.consentAccepted && consent.readsMessages,
      emergency,
      safetyHold: contextHold || (safety.state === "on" && (!!safety.card || safety.exercisePaused)) || intake.active,
      medicineDue: false, bpDue: false, visitProposal: false, visitToBook: false,
      planToRead: false, resultsToRead: false, doctorReply: false,
    };
    if (!state.consent || state.emergency || state.safetyHold || !member.assessment.completedAt) return state;

    // Fail each optional fact closed independently; an unavailable list never implies work is due.
    const [care, medicines, bpWeek, readings, reminders, booking] = await Promise.all([
      getCareData().catch(() => null),
      loadMemberMedicines().catch(() => null),
      readMemberBpWeek().catch(() => null),
      getMeasurements().catch(() => null),
      getReminderPreferences().catch(() => null),
      // The default booking read can prepare a programme. summaryOnly is its existing read-only projection.
      getMemberBookingData({ summaryOnly: true }).catch(() => null),
    ]);
    if (booking?.clinicalHold) return {...state, safetyHold:true};
    state.medicineDue = !!care && !!medicines && (
      dosesForDay(care, now).some(d => d.status === "due") ||
      (medicines.enabled && medicines.medicines.filter(m => !m.stoppedAt).some(m =>
        todaysDoses(m, now, medicines.medicines).some(d => d.status === "due" && Date.parse(d.dueAt) <= now.getTime())))
    );
    const week = bpWeek && currentWeek(bpWeek, now);
    const slot = week && nextSlot(week, now);
    state.bpDue = !!slot && (slot.state === "due" || slot.state === "partial");
    if (care && readings && reminders) state.bpDue ||= dailyReminders(care, readings, reminders.preferences, now)
      .some(r => r.kind === "blood-pressure" && r.status === "due");
    state.planToRead = !!care?.plan && !care.plan.acknowledged && !care.plan.acknowledgedAt;
    // There is no separate results-read receipt. The current, unacknowledged publication is the only supported pending signal.
    state.resultsToRead = state.planToRead && !!care?.plan?.publishedReview?.explanation.trim();
    if (booking?.available && !booking.clinicalHold && booking.pilot) {
      state.visitProposal = booking.pilot.appointments.some(a => a.status !== "cancelled" && !!a.portal?.proposal);
      const completed = new Set(completedRequestTestIds(booking.requests));
      const openRequest = booking.requests.some(r => r.status !== "cancelled" && r.status !== "completed");
      state.visitToBook = !state.visitProposal && !openRequest && canBookNewVisit(booking.pilot.appointments) &&
        booking.requirements.some(r => !completed.has(r.id));
    }
    const latestDoctorReply = Math.max(...thread.replies.map(r => Date.parse(r.at)));
    const latestMemberMessage = Math.max(...thread.messages.map(m => Date.parse(m.at)));
    state.doctorReply = Number.isFinite(latestDoctorReply) && latestDoctorReply > latestMemberMessage;
    return state;
  } catch {
    return null;
  }
}
