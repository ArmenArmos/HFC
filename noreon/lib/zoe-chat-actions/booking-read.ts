import 'server-only';
import {requireRegistered} from '@/lib/patient/repository';
import {evaluate} from '@/lib/clinical/rules/engine';
import {inCrisisRange} from '@/lib/clinical/rules/rules';
import {assessmentProgress,pruneAnswers} from '@/lib/patient/questionnaire';
import {getMemberBookingData} from '@/lib/real-booking/repository';
import {getMemberAppointmentData} from '@/lib/real-booking/appointment-repository';
import {homeVisitRequestAvailable,withClinicalHold} from '@/lib/real-booking/legacy-mode';
import {completedRequestTestIds} from '@/lib/real-booking/visit-gate';
import {getMemberPricing} from '@/lib/pilot-commerce/member';
import {bookingToken} from './booking';
import {z} from 'zod';
import {newChatHome} from '@/lib/patient/member-chat-config';
import {serviceRpc} from './server';
import {preferredVisitDays,visitRequestAvailable} from './visit-request-contract';

/** Page orchestration only. The same reads and clinical gates as /patient/service; no new booking policy. */
export async function readVisitBooking(){
 const {assessment,profile}=await requireRegistered();
 const requestEnabled=newChatHome({});
 const decision=evaluate({answers:assessment.answers,observations:[]});
 const answers=pruneAnswers(assessment.answers);
 const hold=assessment.urgentRule||decision.urgency==='red'?'urgent' as const
  :!assessment.completedAt||!assessmentProgress(answers).complete?'questionnaire' as const:null;
 if(hold)return {token:bookingToken({hold,answers}),hold,crisis:inCrisisRange(answers),booking:null,requestDays:null,requestEnabled,requestLocale:profile.locale};
 const [data,pricing]=await Promise.all([getMemberBookingData(),getMemberPricing()]);
 const pilot=withClinicalHold(data.pilot??await getMemberAppointmentData(),data.clinicalHold===true);
 const booking={data,pilot,pricing,decision,homeAvailable:homeVisitRequestAvailable(data),doneTestIds:completedRequestTestIds(data.requests)};
 const read={token:bookingToken(booking),hold:null,crisis:false,booking};
 let requestDays:string[]|null=null;
 if(requestEnabled&&visitRequestAvailable(read)){
  try{
   const rpc=serviceRpc();
   const hours=z.array(z.object({weekday:z.number().int().min(1).max(7)})).safeParse(rpc?await rpc('zoe_member_clinic_hours',{p_member:profile.userId}):null);
   if(hours.success)requestDays=preferredVisitDays(hours.data);
  }catch{ /* Unreadable hours are not the same as no hours; leave the form retryable. */ }
 }
 return {...read,requestDays,requestEnabled,requestLocale:profile.locale};
}
export type VisitBooking=Awaited<ReturnType<typeof readVisitBooking>>;
