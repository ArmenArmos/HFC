import type {Appointment} from './appointment-schema';
/**
 * WP-5: which saved visits still matter for booking. The database refuses a second slot booking for
 * the current requirements and a home request while a visit is live (select_booking_appointment,
 * create_patient_test_request). A visit from an earlier programme that was attended, missed in the
 * past or cancelled is history: it no longer blocks a new visit and does not mark today's tests
 * booked. Without the programme state (read failed, or before its migration) every visit counts,
 * which is the earlier behaviour.
 */
export const countsForProgramme=(a:Appointment)=>!a.programme||a.programme.currentProgramme||a.programme.open;
/** Visits that describe the current programme's tests. */
export const programmeVisits=(appointments:Appointment[])=>appointments.filter(countsForProgramme);
/** A new visit can be booked: no visit for the current programme (a cancelled one is booked again
 * from its own card) and no earlier visit still open. */
export const canBookNewVisit=(appointments:Appointment[])=>!appointments.some(countsForProgramme);
/** The database fence on a home-visit request: a cancelled visit never fences it. */
export const fencesHomeRequest=(a:Appointment)=>a.status!=='cancelled'&&countsForProgramme(a);
/** QA 176: tests whose home-visit request the nurse completed for the current programme. Their visit
 * took place, so they are done: not to book again, not priced again. A cancelled request covers
 * nothing, and a request from an earlier programme (its questionnaire context changed, contextStale)
 * is history: a later programme that needs the same test books it again (Astra #404 F1). */
export const currentRequest=(r:{contextStale?:boolean})=>r.contextStale!==true;
export const completedRequestTestIds=(requests:{status:string;contextStale?:boolean;requirements:{id:string}[]}[])=>
 [...new Set(requests.filter(r=>r.status==='completed'&&currentRequest(r)).flatMap(r=>r.requirements.map(t=>t.id)))];
