import 'server-only';
import {clinicalReviewEngine} from '@/lib/patient-care/clinical-review-engine';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {PilotBookingData} from './appointment-schema';
import type {MemberBookingData} from './schema';
import {clinicalBookingFailure} from './form-error';
import {schedulingRuntime} from './scheduling-template';
import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
/** A booking channel exists: clinic emails, or clinic-portal scheduling. Either one replaces legacy requests. */
export function bookingChannelConfigured(){return schedulingRuntime()!==null||clinicSchedulingEnabled();}
/** Clinic scheduling on and email off: clinic visits are booked by slot; a home visit stays a request
 * in the admin booking queue (lead decision D2). */
export function homeRequestsOnly(){return schedulingRuntime()===null&&clinicSchedulingEnabled();}
/** The member page offers a home visit request next to the clinic slots only when the read allows one. */
export function homeVisitRequestAvailable(data:Pick<MemberBookingData,'homeRequestAvailable'|'available'|'requirements'>){return !!data.homeRequestAvailable&&data.available&&data.requirements.length>0;}
// readAppointmentData sets these only after the clinical program was derived, so they prove no hold.
const derived=new Set<PilotBookingData['unavailableReason']>(['legacy-reconciliation','configuration-unavailable']);
/** With the email pilot switched off and no pilot history, the member uses the legacy request flow
 * (see `legacyCreationAvailable` in ./repository), so no audience sees the pilot panel. Anything that
 * did not prove the clinical state (an outage, an unknown pilot, a clinical hold) stays visible. */
export function legacyBookingMode(pilot:Pick<PilotBookingData,'appointments'|'unavailableReason'>|null|undefined,runtimeConfigured=bookingChannelConfigured()):boolean{
 return !runtimeConfigured&&!!pilot&&pilot.appointments.length===0&&derived.has(pilot.unavailableReason);
}
/** A clinical hold found by another read wins over a non-clinical pilot outage, and closes booking. */
export function withClinicalHold(pilot:PilotBookingData,hold:boolean):PilotBookingData{
 return hold&&pilot.unavailableReason!=='clinical-hold'?{...pilot,available:false,unavailableReason:'clinical-hold',offers:[]}:pilot;
}
/** Whether stored evidence puts routine booking on clinical hold, with the same engine the booking reader uses. */
export function evidenceClinicalHold(snapshot:ClinicalSnapshot):boolean{
 try{clinicalReviewEngine(snapshot,'booking');return false;}catch(error){return clinicalBookingFailure(error)!==undefined;}
}
