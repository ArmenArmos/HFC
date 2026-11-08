import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { tx } from "@/lib/patient/copy";
import { redirect, unstable_rethrow } from "next/navigation";
import { evaluate } from "@/lib/clinical/rules/engine";
import { inCrisisRange } from "@/lib/clinical/rules/rules";
import { assessmentProgress, pruneAnswers } from "@/lib/patient/questionnaire";
import { requireRegistered } from "@/lib/patient/repository";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink } from "@/components/patient-care/common";
import { ConsultationWindowNotice } from "@/components/patient-care/consultation-window-notice";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import { RealMemberBooking, HomeVisitRequest } from "@/components/real-booking/member";
import { PilotMemberBooking } from "@/components/real-booking/pilot-member";
import { getMemberAppointmentData, getMemberAppointmentSummary } from "@/lib/real-booking/appointment-repository";
import { log, errorFields } from "@/lib/observability/logger";
import { withClinicalHold, homeVisitRequestAvailable } from "@/lib/real-booking/legacy-mode";
import { completedRequestTestIds } from "@/lib/real-booking/visit-gate";
import { selectMemberAppointment, changeMemberAppointment, cancelMemberAppointment, answerMemberProposal } from "@/lib/real-booking/appointment-actions";
import type {PilotBookingData} from "@/lib/real-booking/appointment-schema";
import {bookingLoadLogFields,profileContextMismatch} from "@/lib/real-booking/form-error";
import { getMemberPricing } from "@/lib/pilot-commerce/member";
import { getMemberLabStages } from "@/lib/patient-care/lab-stage-repository";
import { getCareData } from "@/lib/patient-care/repository";
import { memberLabSummary } from "@/lib/staff/lab-stage-schema";
import { journeyStripIndex, journeyStripInput } from "@/lib/patient-care/journey-strip";
import { readJourneyExtras } from "@/lib/patient-care/journey-reads";
export default async function ServicePage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string }> } = {}) {
  const prototype = memberScreensPrototypeEnabled() && (await searchParams).view !== "classic";
  const { profile, assessment } = await requireRegistered();
  const decision = evaluate({ answers: assessment.answers, observations: [] });
  if (assessment.urgentRule || decision.urgency === "red") redirect("/patient/urgent");
  // A saved questionnaire with an unanswered question (QA N-03: a crisis-range reading whose
  // symptom question is unanswered) cannot be assessed, so booking is held. Say so plainly
  // instead of a load error. Only approved wording; the Call 103 pattern when the reading is crisis-range.
  const answers = pruneAnswers(assessment.answers);
  if (assessment.completedAt && !assessmentProgress(answers).complete)
    return <PatientShell locale={profile.locale}><MemberScreen enabled={prototype} locale={profile.locale} classicHref="/patient/service?view=classic"><div className={prototype ? "ms-visit ms-visit-hold space-y-4" : "space-y-4"}>
      <h1 className="text-h1">{tx(profile.locale, "Մինչև ամրագրումը", "Before booking", "Перед записью")}</h1>
      {inCrisisRange(answers) && <div className="space-y-3">
        <p className="text-body1 font-semibold">{tx(profile.locale, "Շտապ բժշկական օգնության համար զանգահարեք 103։", "For urgent medical help, call 103.", "Для срочной медицинской помощи звоните 103.")}</p>
        <a href="tel:103" className="emergency-call flex min-h-14 w-full items-center justify-center rounded-md px-5 py-3">{tx(profile.locale, "Զանգահարել 103", "Call 103", "Позвонить 103")}</a>
      </div>}
      <p className="max-w-xl text-body2 text-muted-foreground">{tx(profile.locale, "Ավարտեք առողջության հարցաշարը՝ հետազոտություններն ամրագրելու համար։", "Complete your health questionnaire before arranging tests.", "Заполните анкету о здоровье перед записью на анализы.")}</p>
      <CareLink href="/patient/questions">{tx(profile.locale, "Շարունակել հարցաշարը", "Continue questionnaire", "Продолжить анкету")}</CareLink>
    </div></MemberScreen></PatientShell>;
  // The journey strip uses Home's source (journeyStripIndex over the same lab and plan reads), so
  // the two strips never disagree; a failed read never moves it forward.
  const [data, pricing, labSamples, care, extras] = await Promise.all([getMemberBookingData(), getMemberPricing(), getMemberLabStages().catch(() => null), getCareData().catch(() => null), readJourneyExtras()]);
  // QA 177: the same stage input as Home (completed visits, nurse steps, released results).
  const journeyIndex = journeyStripIndex(journeyStripInput({ questionnaireComplete: !!assessment.completedAt, lab: labSamples ? memberLabSummary(labSamples) : undefined, planPublished: !!care?.plan, requests: data.requests, appointments: data.pilot?.appointments, ...extras }));
  if(data.legacyCreationAvailable)return <PatientShell locale={profile.locale}><MemberScreen enabled={prototype} locale={profile.locale} classicHref="/patient/service?view=classic"><div className={prototype ? "ms-visit ms-visit-booking space-y-6" : "space-y-6"}><ConsultationWindowNotice decision={decision} locale={profile.locale} /><RealMemberBooking data={data} locale={profile.locale} pricing={pricing}/></div></MemberScreen></PatientShell>;
  let pilot:PilotBookingData;
  try{pilot=data.pilot??await getMemberAppointmentData();}
  catch(error){
    unstable_rethrow(error);
    const unavailableReason=data.clinicalHold===true?'clinical-hold':profileContextMismatch(error)?'profile-mismatch':'unavailable';
    log.error('booking.load_failed',{place:'page',unavailable_reason:unavailableReason,member_id:profile.userId,...bookingLoadLogFields(error,errorFields(error))});
    pilot={available:false,unavailableReason,program:[],offers:[],appointments:[]};
    // Saved visits do not depend on preparing a new program or loading offers.
    try{
      const summary=await getMemberAppointmentSummary();
      pilot.appointments=summary.appointments;
      pilot.clinics=summary.clinics;
    }catch(summaryError){unstable_rethrow(summaryError);}
  }
  pilot=withClinicalHold(pilot,data.clinicalHold===true);
  const changeCommandIds=Object.fromEntries(pilot.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]));
  const cancelCommandIds=Object.fromEntries(pilot.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]));
  return <PatientShell locale={profile.locale}><MemberScreen enabled={prototype} locale={profile.locale} classicHref="/patient/service?view=classic"><div className={prototype ? "ms-visit ms-visit-booking space-y-6" : "space-y-6"}><ConsultationWindowNotice decision={decision} locale={profile.locale} /><PilotMemberBooking journeyIndex={journeyIndex} pricing={pricing} data={pilot} locale={profile.locale} commandId={crypto.randomUUID()} changeCommandIds={changeCommandIds} cancelCommandIds={cancelCommandIds} proposalCommandIds={Object.fromEntries(pilot.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} proposalAction={answerMemberProposal} selectAction={selectMemberAppointment} changeAction={changeMemberAppointment} cancelAction={cancelMemberAppointment} refreshHref="/patient/service" doneTestIds={completedRequestTestIds(data.requests)} homeRequestOpen={data.requests.some(request=>request.status!=='cancelled'&&request.status!=='completed')} homeVisit={homeVisitRequestAvailable(data)?<HomeVisitRequest key="home-visit-request" data={data} locale={profile.locale} pricing={pricing} testsShownAbove />:undefined} />{data.requests.length>0&&<RealMemberBooking data={{...data,legacyCreationAvailable:false}} locale={profile.locale} pricing={pricing} />}</div></MemberScreen></PatientShell>;
}
