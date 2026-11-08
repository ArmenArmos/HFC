import 'server-only';
import {z} from 'zod';
import {readMemberSuggestedTests} from './fresh-tests-read';
import {ALGORITHM_VERSION} from '@/lib/clinical/rules/engine';
import {createClient} from '@/lib/supabase/server';
import {requirePatient} from '@/lib/patient/auth';
import {snapshotSchema,type RealStaff} from '@/lib/patient-care/clinical-case-repository';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
import {clinicalReviewEngine} from '@/lib/patient-care/clinical-review-engine';
import {realBookingEnabled} from './config';
import {bookingChannelConfigured,homeRequestsOnly} from './legacy-mode';
import {bookingRequestSchema,type MemberBookingData} from './schema';
import {isLdlRetestRequest,ldlRetestHold,ldlRetestRequestStale} from '@/lib/ldl/retest';
import {clinicalBookingFailure} from './form-error';
import {fencesHomeRequest} from './visit-gate';
import {getMemberAppointmentData,getMemberAppointmentSummary} from './appointment-repository';
import {unstable_rethrow} from 'next/navigation';
/** Starts a read now; a failure stays with the promise until it is awaited (no unhandled rejection). */
function started<T>(promise:Promise<T>):Promise<T>{promise.catch(()=>{});return promise;}
export async function memberBookingContext(){
 const identity=await requirePatient();const client=await createClient();
 const response=await client.rpc('patient_test_booking_context');
 if(response.error)throw Error('Test requests are unavailable. Please try again.');
 const context=z.object({token:z.string(),requirementsToken:z.string(),data:snapshotSchema.shape.evidence}).parse(response.data);
 const engine=clinicalReviewEngine({id:identity.userId,revision:0,evidenceToken:context.token,evidence:context.data,draft:null,draftSavedAt:null,draftStale:false},'booking');
 const tests=await readMemberSuggestedTests(engine.tests);
 // A changed saved-result set invalidates a previously rendered preference form too.
 const suggestionToken=JSON.stringify(tests.map(t=>t.id));
 return {identity,client,contextToken:`${context.requirementsToken}:${suggestionToken}`,sourceToken:context.token,engine:{...engine,tests}};
}
/** Accepting an LDL re-test request: the LDL eligibility contract, not the screening engine (lib/ldl/retest.ts). */
export async function memberLdlRequestContext(){
 await requirePatient();const client=await createClient();
 const response=await client.rpc('patient_test_booking_context');
 if(response.error)throw Error('Test requests are unavailable. Please try again.');
 const context=z.object({token:z.string(),data:snapshotSchema.shape.evidence}).parse(response.data);
 ldlRetestHold(context.data);
 return {sourceToken:context.token};
}
export async function getMemberBookingData(options:{summaryOnly?:boolean}={}):Promise<MemberBookingData>{
 let pilot:MemberBookingData['pilot'];
 const empty={available:false,requirements:[],homeTasks:[],requests:[]};
 if(!realBookingEnabled(process.env))return {...empty,message:'Test requests are not available yet.'};
 await requirePatient();
 // The three member-scoped reads are independent, so they start together; each is still
 // awaited in the original order with the original error handling.
 const pilotRead=started(options.summaryOnly?getMemberAppointmentSummary():getMemberAppointmentData());
 const requestsRead=started(createClient().then(client=>client.rpc('patient_test_booking_requests')));
 const contextRead=started(memberBookingContext());
 try{pilot=await pilotRead;}catch(error){
  // An unreadable pilot (including PGRST202, a missing RPC) is an outage. It never proves
  // "no pilot history", so it never re-opens legacy creation (Astra, PR168 follow-up).
  unstable_rethrow(error);
 }
 // Preserve recorded provider arrangements even if current questionnaire/clinical guidance changes.
 let requests:MemberBookingData['requests']=[];
 try{
  const response=await requestsRead;
  if(response.error)throw Error('Test requests are unavailable. Please try again.');
  requests=z.array(bookingRequestSchema).parse(response.data).map(r=>({...r,contextStale:r.contextStale||(isLdlRetestRequest(r)?ldlRetestRequestStale(r):r.algorithmVersion!==ALGORITHM_VERSION)}));
  const {contextToken,engine}=await contextRead;
  requests=requests.map(r=>({...r,contextStale:r.contextStale||(!isLdlRetestRequest(r)&&!r.requirements.every(requirement=>engine.tests.some(t=>t.id===requirement.id&&t.title===requirement.title&&t.method===requirement.method)))}));
  const legacyCreationAvailable=!bookingChannelConfigured()&&!!pilot&&pilot.appointments.length===0;
  // A home visit request needs no live slot booking and no open request (the SQL fences agree).
  const homeRequestAvailable=homeRequestsOnly()&&!!pilot&&!pilot.appointments.some(fencesHomeRequest)&&requests.every(r=>r.status==='cancelled'||r.status==='completed');
  return {pilot,legacyCreationAvailable,homeRequestAvailable,available:true,contextToken,requirements:engine.tests.filter(t=>t.method!=='home-log').map(t=>({id:t.id,title:t.title,method:t.method as 'lab'|'clinic'})),homeTasks:engine.tests.filter(t=>t.method==='home-log').map(t=>({id:t.id,title:t.title})),requests};
 }catch(error){const hold=clinicalBookingFailure(error);return {...empty,pilot,requests,clinicalHold:hold!==undefined,message:hold??'Test requests are unavailable. Please try again.',
  ...(requests.some(isLdlRetestRequest)?{ldlAvailable:await ldlRequestsAvailable()}:{})};}
}
/** An LDL re-test request is accepted under the LDL eligibility contract, not the screening engine (Astra LDLR-02). */
async function ldlRequestsAvailable(){try{await memberLdlRequestContext();return true;}catch(error){unstable_rethrow(error);return false;}}
export async function getStaffBookingRequests(memberId:string,staff?:RealStaff){
 if(!realBookingEnabled(process.env))return [];
 const {client,identity}=staff??await requireRealStaffForRender();
 const response=await client.rpc('patient_test_booking_requests',{p_user_id:z.uuid().parse(memberId)});
 if(response.error)throw Error('Test requests could not be loaded. Please try again.');
 // An LDL re-test request (lib/ldl/retest.ts) is checked against its own fixed requirement, not the screening engine.
 const requests=z.array(bookingRequestSchema).parse(response.data).map(r=>({...r,contextStale:r.contextStale||(isLdlRetestRequest(r)?ldlRetestRequestStale(r):r.algorithmVersion!==ALGORITHM_VERSION)}));
 if(!requests.length)return requests;
 // Source data stays on the trusted server; administrators receive only operational freshness.
 const source=await clinicalWriteClient().rpc('patient_test_staff_context',{p_id:requests[0].id,p_actor:identity.id});
 if(source.error)throw Error('Test request context could not be checked. Please try again.');
 try{
  const context=z.object({userId:z.uuid(),contextToken:z.string(),evidence:snapshotSchema.shape.evidence}).parse(source.data);
  const engine=clinicalReviewEngine({id:context.userId,revision:0,evidenceToken:context.contextToken,evidence:context.evidence,draft:null,draftSavedAt:null,draftStale:false},'booking');
  return requests.map(r=>({...r,contextStale:r.contextStale||(!isLdlRetestRequest(r)&&!r.requirements.every(requirement=>engine.tests.some(t=>t.id===requirement.id&&t.title===requirement.title&&t.method===requirement.method)))}));
 }catch{return requests.map(r=>({...r,contextStale:r.contextStale||!isLdlRetestRequest(r)}));}
}
