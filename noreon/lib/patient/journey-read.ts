import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {requireRegistered} from '@/lib/patient/repository';
import {patientPresentation} from '@/lib/patient/presentation';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {buildSnapshot} from '@/lib/zoe-chat-actions/server';
import {readPlanState} from '@/lib/zoe-chat-actions/plan-read';
import {stableRequestId} from '@/lib/zoe-chat-actions/next-step-id';
import type {Snapshot} from '@/lib/zoe-chat-actions/registry';
import {memberNextStepEnabled} from '@/lib/patient/member-next-step';
import {getCareData} from '@/lib/patient-care/repository';
import {getMemberBookingData} from '@/lib/real-booking/repository';
import {realBookingEnabled} from '@/lib/real-booking/config';
import {getMemberLabStages} from '@/lib/patient-care/lab-stage-repository';
import {memberLabSummary} from '@/lib/staff/lab-stage-schema';
import {readRealMemberStatus} from '@/lib/patient-care/clinical-case-repository';
import {readMemberNurseVisit,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import {readMemberDocuments,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import type {JourneyInput} from '@/lib/patient-care/journey-step';
import {journeyStage,type JourneyStage,type JourneyOptions} from '@/lib/patient/journey-stage';

export type JourneyRead={memberId:string;stage:JourneyStage;input:JourneyInput;options:JourneyOptions};
type RegisteredMember=Awaited<ReturnType<typeof requireRegistered>>;

/** Shared saved journey facts. Chat callers retain their consent and emergency guards.
 * Off, incomplete, urgent or failed reads never invent an earlier stage.
 */
export async function readJourneyStage(member?:RegisteredMember):Promise<JourneyRead|null>{
 const v3=zoeAppV3Enabled();
 if(!v3&&!memberNextStepEnabled())return null;
 try{
  const {profile,assessment}=member??await requireRegistered();
  if(!assessment.completedAt||patientPresentation(assessment).urgent)return null;
  const client=await createClient();
  const [care,bookings,lab,status,nurse,released,preparing,results,chosen,planState]=await Promise.all([
   getCareData(),getMemberBookingData({summaryOnly:true}),getMemberLabStages(),readRealMemberStatus(),
   readMemberNurseVisit(client as unknown as NurseVisitRpc),
   doctorCompletionEnabled()?readMemberDocuments(client as unknown as DocumentRpc):Promise.resolve([]),
   client.rpc('patient_plan_preparing').then(r=>{if(r.error||typeof r.data!=='boolean')throw Error('Plan status unavailable');return r.data;}),
   v3?buildSnapshot('results') as Promise<Snapshot<'results'>>:Promise.resolve(null),
   v3?client.from('zoe_chat_cards').select('id').eq('kind','tests_needed').eq('state','done').gte('created_at',assessment.completedAt).not('outcome->tests_needed','is',null).limit(1):Promise.resolve({data:[],error:null}),
   v3?readPlanState():Promise.resolve(null),
  ]);
  // A missing pilot can hide a failed appointment read even when requests are available.
  // With real booking switched off getMemberBookingData answers "not available yet" and no pilot: that is the configuration, not a failed read.
  // Without this the next step read failed for every member ("Not available right now") wherever booking is not configured.
  const bookingOff=!realBookingEnabled(process.env);
  const pilot=bookings.pilot??(bookingOff?{appointments:[],clinics:{}}:undefined);
  if(chosen.error||(results&&!results.available)||!pilot||nurse===undefined||lab===null||released===null||(!bookingOff&&!bookings.available&&bookings.message&&!bookings.clinicalHold))return null;
  // Release events within the current review establish release, never upload or collection dates.
  const currentReleased=released.filter(r=>!status.status||Date.parse(r.releasedAt)>=Date.parse(status.status.createdAt));
  const publication=results?.publishedAt&&(!status.status||Date.parse(results.publishedAt)>=Date.parse(status.status.createdAt))?results.publishedAt:null;
  const input:JourneyInput={questionnaireComplete:true,review:!status.enabled?null:status.status??'none',
   appointments:pilot.appointments,clinics:pilot.clinics??{},canBook:bookings.available||!!bookings.homeRequestAvailable||!!bookings.legacyCreationAvailable,
   hasOpenRequest:bookings.requests.some(r=>r.status!=='cancelled'&&r.status!=='completed'),lab:memberLabSummary(lab),nurseVisit:nurse,released:currentReleased,
   planPublished:!!care.plan,planPreparing:preparing,now:new Date()};
  const revision=v3?stableRequestId(JSON.stringify({review:input.review,appointments:pilot.appointments.map(a=>[a.id,a.revision]),requests:bookings.requests.map(r=>[r.id,r.revision]),lab:input.lab,nurse:nurse?.steps,released:currentReleased.map(r=>[r.fileId,r.releasedAt]),publication})):undefined;
  const options:JourneyOptions={episode:`${assessment.id}:${assessment.completedAt}`,testsChosen:!!chosen.data?.length,...(v3?{resultsPublishedAt:publication}:{}),...(revision?{revision}:{}),planId:care.plan?.id,
   teachBackConfirmed:!!(care.plan&&planState?.planId===care.plan.id&&planState.teachBackConfirmedAt),resultsReleased:!!publication||currentReleased.length>0};
  return {memberId:profile.userId,stage:journeyStage(input,options),input,options};
 }catch{return null;}
}
