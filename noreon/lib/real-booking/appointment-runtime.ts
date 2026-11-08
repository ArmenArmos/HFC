import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {dispatchNow} from '@/lib/telegram-runtime/dispatch-trigger';
import {ALGORITHM_VERSION} from '@/lib/clinical/rules/engine';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {deriveBookingProgram} from './program-authority';
import {appointmentSchema,appointmentCancelSchema,portalDetailsSchema,programmeVisitSchema,proposalAnswerSchema,appointmentRetrySchema,appointmentWorkspaceSchema,noticePurposeSchema,trustedOfferSchema,type Appointment,type AppointmentWorkspace,type BookingProgram,type PilotBookingData,type PilotActionState,type SchedulingOutcome,type TrustedOffer} from './appointment-schema';
import type {AppointmentPorts} from './appointment-commands';
import {hasSchedulingWording,renderSchedulingNotice,type SchedulingRuntime} from './scheduling-template';
import {founderNoticeEnabled,notifyFounders} from './founder-notice';
import {sendSchedulingEmail} from './scheduling-notice';
import {bookingRequestSchema} from './schema';
import {bookingLoadLogFields,clinicalBookingFailure,profileContextMismatch} from './form-error';
import {log,errorFields} from '@/lib/observability/logger';

type RpcResponse={data:unknown;error:{code?:string}|null;status?:number};
/** Narrow IO boundary; every database JSON result is parsed before use. */
export type BookingRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<RpcResponse>};
/** portal: clinic-portal scheduling is on, so clinic-hours slots are booked without email. */
export type BookingRuntimeContext={memberId:string;actorId:string;read:BookingRpc;write:BookingRpc;runtime:SchedulingRuntime|null;portal?:boolean;allowRecovery?:boolean;suggestTests?:(items:BookingProgram['items'])=>Promise<BookingProgram['items']>;invalidate:()=>void;http?:typeof fetch};
type Context=BookingRuntimeContext;
const sourceSchema=z.object({token:z.string().min(1),requirementsToken:z.string().min(1),data:snapshotSchema.shape.evidence});
const offersSchema=z.array(z.strictObject({offer:trustedOfferSchema,clinicName:z.string().min(1)}));
function sealIdentity(parts:string[]){
 const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
const detailsSchema=z.strictObject({memberId:z.uuid(),phone:z.string().nullable(),purposes:z.record(z.string(),noticePurposeSchema),clinics:z.record(z.uuid(),z.string())});
const portalSchema=z.strictObject({memberId:z.uuid(),enabled:z.boolean(),appointments:z.record(z.uuid(),portalDetailsSchema)});
/** Clinic-portal state (decline reason, proposal, check-in). Absent before the migration or on error. */
async function readPortalDetails(context:Pick<Context,'memberId'|'read'>){
 try{
  const response=await context.read.rpc('booking_portal_details',{p_member:context.memberId});
  if(response.error)return null;
  const parsed=portalSchema.safeParse(response.data);
  return parsed.success&&parsed.data.memberId===context.memberId?parsed.data.appointments:null;
 }catch{return null;}
}
const programmeStateSchema=z.strictObject({memberId:z.uuid(),appointments:z.record(z.uuid(),programmeVisitSchema)});
/** Which visits belong to the current programme and which are still open (WP-5). Absent before the
 * migration or on error; the app then treats every visit as blocking a new booking, as before. */
async function readProgrammeState(context:Pick<Context,'memberId'|'read'>){
 try{
  const response=await context.read.rpc('booking_pilot_programme_state',{p_member:context.memberId});
  if(response.error)return null;
  const parsed=programmeStateSchema.safeParse(response.data);
  return parsed.success&&parsed.data.memberId===context.memberId?parsed.data.appointments:null;
 }catch{return null;}
}
/** booking_pilot_workspace keeps its released shape (an older app may still parse it).
 * B1 details (phone for the clinic email, clinic names, notice purposes) come from
 * booking_pilot_workspace_details under the same actor check. 'optional' tolerates its
 * absence (new app before the migration); 'required' is used before rendering an email.
 * requirePortal prevents operational readers from guessing ownership on a portal outage. */
export async function readAppointmentWorkspace(context:Pick<Context,'memberId'|'read'|'portal'>,options:{details?:'optional'|'required';requirePortal?:boolean}={}):Promise<AppointmentWorkspace>{
 // The reads take only the member id and each runs the same actor check in the
 // database, so they start together; workspace identity is checked before using details.
 const workspaceRead=Promise.resolve(context.read.rpc('booking_pilot_workspace',{p_member:context.memberId}));
 const extraRead=options.details?Promise.resolve(context.read.rpc('booking_pilot_workspace_details',{p_member:context.memberId})):null;
 // Clinic-portal state is read only while clinic scheduling is on.
 const portalRead=options.details&&context.portal?readPortalDetails(context):null;
 const programmeRead=options.details?readProgrammeState(context):null;
 extraRead?.catch(()=>{});
 const response=await workspaceRead;
 if(response.error)throw Object.assign(Error('Booking workspace unavailable'),{code:response.error.code});
 const workspace=appointmentWorkspaceSchema.parse(response.data);
 if(workspace.member.id!==context.memberId)throw Error('Wrong booking workspace');
 if(!extraRead)return workspace;
 const portal=portalRead?await portalRead:null;
 if(context.portal&&options.requirePortal&&portal===null)throw Error('Booking portal details unavailable');
 const extra=await extraRead;
 if(extra.error){if(options.details==='required')throw Object.assign(Error('Booking details unavailable'),{code:extra.error.code});return workspace;}
 const details=detailsSchema.parse(extra.data);
 if(details.memberId!==context.memberId)throw Error('Wrong booking details');
 const programme=programmeRead?await programmeRead:null;
 const purpose=(id:string,revision:number)=>details.purposes[`${id}:${revision}`];
 return {...workspace,member:{...workspace.member,phone:details.phone},clinics:details.clinics,
  appointments:workspace.appointments.map(a=>({...a,noticePurpose:purpose(a.id,a.revision)??a.noticePurpose,history:a.history?.map(h=>({...h,purpose:purpose(a.id,h.revision)??h.purpose})),...(portal?.[a.id]?{portal:portal[a.id]}:{}),...(programme?.[a.id]?{programme:programme[a.id]}:{})}))};
}
/** Saved-state projection without service writes, clinical derivation or offers. */
export async function readAppointmentSummary(context:Pick<Context,'memberId'|'read'|'portal'>,options:{requirePortal?:boolean}={}):Promise<PilotBookingData>{
 const workspace=await readAppointmentWorkspace(context,{details:'optional',requirePortal:options.requirePortal});
 return {available:false,unavailableReason:null,program:[],offers:[],appointments:workspace.appointments,clinics:workspace.clinics??{}};
}
async function prepare(context:Context,suggestedSetFingerprint?:string){
 const response=await context.write.rpc('booking_program_source',{p_member:context.memberId,p_actor:context.actorId});
 if(response.error)throw Object.assign(Error('Booking source unavailable'),{code:response.error.code});
 const source=sourceSchema.parse(response.data);
 const program=deriveBookingProgram({id:context.memberId,revision:0,evidenceToken:source.token,evidence:source.data,draft:null,draftSavedAt:null,draftStale:false},source.requirementsToken);
 if(context.suggestTests)program.items=await context.suggestTests(program.items);
 // Compare before registering anything. JSON joins ordered IDs without collisions
 // or a Node dependency; this is a freshness check, not an authorization token.
 if(suggestedSetFingerprint!==undefined&&suggestedSetFingerprint!==JSON.stringify(program.items.map(t=>t.id)))throw Object.assign(Error('Suggested tests changed'),{code:'tests-changed'});
 // An empty suggested visit needs no seal or offers. Member writes refuse it below.
 if(context.suggestTests&&!program.items.some(t=>t.method!=='home-log'))return {sealId:'',program};
 const sealId=sealIdentity([context.memberId,context.actorId,JSON.stringify(program)]);
 const sealed=await context.write.rpc('register_booking_program',{p_id:sealId,p_member:context.memberId,p_actor:context.actorId,p_program:program});
 if(sealed.error)throw Object.assign(Error('Booking source changed'),{code:sealed.error.code});
 const identity=z.object({id:z.uuid(),memberId:z.uuid()}).parse(sealed.data);
 if(identity.id!==sealId||identity.memberId!==context.memberId)throw Error('Wrong booking program seal');
 return {sealId,program};
}
async function offers(context:Context,sealId:string){
 const response=await context.write.rpc('booking_pilot_offers',{p_member:context.memberId,p_actor:context.actorId,p_program_id:sealId});
 if(response.error)throw Error('Booking choices unavailable');
 return offersSchema.parse(response.data);
}
async function hasUnconvertedArrangement(context:Context){
 const historical=await context.read.rpc('patient_test_booking_requests',{p_user_id:context.memberId});
 if(historical.error)throw Error('Recorded arrangements unavailable');
 return z.array(bookingRequestSchema).parse(historical.data).some(request=>request.status!=='cancelled'&&request.status!=='completed'&&!request.pilotAppointmentId);
}
function projectedOutcome(appointment:{status:string}|undefined):'confirmed'|'failed'|'unknown'|'pending'{
 // An accepted cancellation email is as final as an accepted booking email.
 if(appointment?.status==='confirmed'||appointment?.status==='cancelled')return 'confirmed';
 if(appointment?.status==='failed')return 'failed';
 if(appointment?.status==='unknown'||appointment?.status==='reconciliation')return 'unknown';
 return 'pending';
}
/** Service-page program preparation. This path may seal the derived program,
 * but never claims, dispatches or retries mail. Home/Tests use readAppointmentSummary. */
export async function readAppointmentData(context:Context):Promise<{workspace:AppointmentWorkspace;data:PilotBookingData}>{
 const workspace=await readAppointmentWorkspace(context,{details:'optional'});
 const portal=context.portal===true;
 const base:PilotBookingData={available:false,canRecoverScheduling:context.runtime!==null,canRetryScheduling:false,unavailableReason:'configuration-unavailable',program:[],offers:[],appointments:workspace.appointments,clinics:workspace.clinics??{},
  canChange:portal||context.runtime!==null&&hasSchedulingWording(context.runtime,'change'),canCancel:context.runtime!==null&&hasSchedulingWording(context.runtime,'cancellation')};
 if(context.allowRecovery===false)return {workspace,data:base};
 try{
  const prepared=await prepare(context);
  base.program=prepared.program.items.map(item=>({id:item.id,title:item.title,method:item.method,preparation:item.preparation}));
  if(!prepared.sealId)return {workspace,data:{...base,available:true,unavailableReason:null}};
  if(await hasUnconvertedArrangement(context))return {workspace,data:{...base,unavailableReason:'legacy-reconciliation'}};
  if(!context.runtime&&!portal)return {workspace,data:base};
  base.canRetryScheduling=context.runtime!==null;
  // Clinic opening hours become slots day by day; the top-up is idempotent and cheap once done.
  if(portal)await context.write.rpc('clinic_schedule_top_up',{}).then(()=>undefined,()=>undefined);
  // Without the email channel only clinic-hours slots can be booked.
  // Clinic-hours slots only while the portal channel is on; other slots only with email (review F-02).
  const available=(await offers(context,prepared.sealId)).filter(({offer})=>offer.source==='clinic-hours'?portal:context.runtime!==null);
  return {workspace,data:{...base,available:available.length>0,unavailableReason:available.length?null:'source-unavailable',offers:available.map(({offer,clinicName})=>({id:offer.id,source:offer.source,version:offer.version,clinicId:offer.clinicId,mode:offer.mode,startsAt:offer.startsAt,endsAt:offer.endsAt,timezone:offer.timezone,clinicAddress:offer.clinicAddress,preparation:offer.preparation,preparationVersion:offer.preparationVersion,coveredTestIds:offer.coveredTestIds,followUps:offer.followUps,clinicName}))}};
 }catch(error){
  const sourceChanged=typeof error==='object'&&error!==null&&'code'in error&&error.code==='40001';
  const unavailableReason=clinicalBookingFailure(error)?'clinical-hold':profileContextMismatch(error)?'profile-mismatch':sourceChanged?'source-unavailable':'unavailable';
  log.error('booking.load_failed',{place:'runtime',unavailable_reason:unavailableReason,member_id:context.memberId,...bookingLoadLogFields(error,errorFields(error))});
  return {workspace,data:{...base,unavailableReason}};
 }
}
export function createAppointmentPorts(context:Context):AppointmentPorts{
 let chosenClinicName:string|undefined;
 let workspace:AppointmentWorkspace|undefined;
 let chosenPortal=false;
 return {
  available:context.runtime!==null||context.portal===true,
  recover:async input=>{
   if(context.allowRecovery===false)return {data:null,error:{code:'42501'}};
   const {commandId,suggestedSetFingerprint,...selection}=input;
   void suggestedSetFingerprint; // The released recovery RPC accepts only the original selection fields.
   return await context.write.rpc('recover_booking_command',{p_command:commandId,p_member:context.memberId,p_actor:context.actorId,p_selection:selection});
  },
  prepare:async suggestedSetFingerprint=>{
   if(await hasUnconvertedArrangement(context))throw Error('Existing provider arrangement requires reconciliation');
   const prepared=await prepare(context,suggestedSetFingerprint);
   if(!prepared.sealId)throw Error('No new tests to arrange');
   return prepared;
  },
  offer:async(input,prepared)=>{
   const selected=(await offers(context,prepared.sealId)).find(row=>row.offer.id===input.offerId&&row.offer.version===input.offerVersion);
   chosenClinicName=selected?.clinicName;
   chosenPortal=selected?.offer.source==='clinic-hours';
   if(selected&&chosenPortal&&context.portal!==true)return null;
   if(selected&&!chosenPortal)workspace=await readAppointmentWorkspace(context,{details:'required'});
   return selected?.offer??null;
  },
  render:(input,offer,program)=>{
   // A clinic-hours booking is announced in the clinic portal: no email content.
   if(chosenPortal)return {senderEmail:null,templateVersion:null,subject:null,textContent:null};
   if(!context.runtime||!chosenClinicName||!workspace)throw Error('Scheduling unavailable');
   // The operational name and phone are loaded through the actor-scoped workspace, not a form.
   const current='appointmentId'in input?workspace.appointments.find(a=>a.id===input.appointmentId)?.current??null:null;
   return renderSchedulingNotice(context.runtime,{reference:input.commandId,memberName:workspace.member.name,memberPhone:workspace.member.phone,clinicName:chosenClinicName,program,offer,homeAddress:input.homeAddress,
    purpose:current?'change':'booking',previous:current?{startsAt:current.startsAt,location:current.location}:null});
  },
  select:async input=>await context.write.rpc('select_booking_appointment',{
   p_command_id:input.commandId,p_member:context.memberId,p_actor:context.actorId,p_program_id:input.programId,p_offer_id:input.offerId,p_offer_version:input.offerVersion,
   p_home_address:input.homeAddress,p_appointment_id:'appointmentId'in input?input.appointmentId:null,p_revision:'revision'in input?input.revision:null,
   p_agreement_source:'agreementSource'in input?input.agreementSource:null,p_sender_email:input.senderEmail,p_template_version:input.templateVersion,p_subject:input.subject,p_text_content:input.textContent,
  }),
  dispatch:async noticeId=>{
   const runtime=context.runtime;
   if(!runtime||chosenPortal)return 'pending';
   try{
    const attempt=randomUUID();
    // Only initial dispatch. Explicit operator retries require a separate audited
    // command; duplicate browser posts and read/refresh cannot advance generation.
    const claimed=await context.write.rpc('claim_booking_notice',{p_notice:noticeId,p_attempt:attempt,p_generation:1,p_lease_until:new Date(Date.now()+5*60000).toISOString(),p_engine:ALGORITHM_VERSION,p_sender:runtime.sender,p_template:runtime.template.version});
    if(claimed.error)return 'unknown';
    if(claimed.data===null){
     const workspace=await readAppointmentWorkspace(context);
     return projectedOutcome(workspace.appointments.find(a=>a.noticeId===noticeId));
    }
    return await announce(context,noticeId,await submitClaimedNotice(context,noticeId,attempt,1,claimed.data));
   }catch{return 'unknown';}
  },
  invalidate:context.invalidate,
 };
}
async function applyRecordedNotice(context:Context,noticeId:string,attempt:string){
 const runtime=context.runtime;if(!runtime)return 'pending' as const;
 const applied=await context.write.rpc('apply_booking_notice_receipt',{p_notice:noticeId,p_attempt:attempt,p_engine:ALGORITHM_VERSION,p_sender:runtime.sender,p_template:runtime.template.version});
 if(applied.error)return 'unknown' as const;
 const appointment=appointmentSchema.parse(applied.data);
 if(appointment.memberId!==context.memberId||appointment.noticeId!==noticeId)return 'unknown' as const;
 if(appointment.status==='reconciliation')return 'arrangement-review' as const;
 return projectedOutcome(appointment);
}
async function submitClaimedNotice(context:Context,noticeId:string,attempt:string,generation:number,envelope:unknown){
 const runtime=context.runtime;if(!runtime)return 'pending' as const;
 const identity=z.object({noticeId:z.literal(noticeId),attemptId:z.literal(attempt),generation:z.literal(generation),templateVersion:z.literal(runtime.template.version)}).safeParse(envelope);
 if(!identity.success)return 'unknown' as const;
 const receipt=await sendSchedulingEmail({enabled:true,apiKey:runtime.apiKey,sender:runtime.sender},envelope,context.http);
 if(receipt.outcome==='disabled')return 'unknown' as const;
 const recorded=await context.write.rpc('record_booking_notice_receipt',{p_notice:noticeId,p_attempt:attempt,p_generation:receipt.generation,p_hash:receipt.envelopeHash,p_outcome:receipt.outcome,p_reference:receipt.outcome==='accepted'?receipt.reference:null,p_accepted_roles:receipt.outcome==='accepted'?receipt.acceptedRoles:null});
 if(recorded.error||recorded.data!==true)return 'unknown' as const;
 return applyRecordedNotice(context,noticeId,attempt);
}
const retryReceiptSchema=z.strictObject({noticeId:z.uuid(),attemptId:z.uuid().nullable(),generation:z.number().int().min(1).safe().nullable(),envelope:z.unknown(),receiptRecorded:z.boolean()});
/** Only called after the public staff guard and exact-member workspace check. */
export async function retrySchedulingNotice(context:Context,raw:unknown):Promise<PilotActionState>{return operateSchedulingNotice(context,raw,'retry');}
export async function startSchedulingNotice(context:Context,raw:unknown):Promise<PilotActionState>{return operateSchedulingNotice(context,raw,'first');}
async function operateSchedulingNotice(context:Context,raw:unknown,operation:'retry'|'first'):Promise<PilotActionState>{
 const runtime=context.runtime;if(!runtime)return {ok:false,code:'unavailable'};
 const parsed=appointmentRetrySchema.safeParse(raw);if(!parsed.success)return {ok:false,code:'invalid'};
 let attempted=false;
 const unknown=():PilotActionState=>({ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true});
 try{
  const input=parsed.data;attempted=true;
  const response=await context.write.rpc(operation==='first'?'start_booking_notice':'retry_booking_notice',{p_member:context.memberId,p_actor:context.actorId,p_appointment:input.appointmentId,p_revision:input.revision,p_notice:input.noticeId,p_command:input.commandId,p_engine:ALGORITHM_VERSION,p_sender:runtime.sender,p_template:runtime.template.version});
  if(response.error){
   if(response.status&&response.status>=500&&response.status!==500)return unknown();
   if(['40001','55P03'].includes(response.error.code??''))return {ok:false,code:'conflict'};
   if(response.error.code==='42501')return {ok:false,code:'unavailable'};
   if(['22023','22P02'].includes(response.error.code??''))return {ok:false,code:'invalid'};
   return unknown();
  }
  const saved=retryReceiptSchema.parse(response.data);
  if(saved.noticeId!==input.noticeId||saved.attemptId!==null&&saved.attemptId!==input.commandId||saved.generation!==null&&(operation==='first'?saved.generation!==1:saved.generation<2))return unknown();
  let outcome:SchedulingOutcome;
  if(saved.envelope!==null){
   if(saved.attemptId===null||saved.generation===null||saved.receiptRecorded)return unknown();
   outcome=await submitClaimedNotice(context,saved.noticeId,saved.attemptId,saved.generation,saved.envelope);
  }else if(saved.receiptRecorded){
   if(saved.attemptId===null)return unknown();
   outcome=await applyRecordedNotice(context,saved.noticeId,saved.attemptId);
  }else{
   const workspace=await readAppointmentWorkspace(context);
   outcome=projectedOutcome(workspace.appointments.find(a=>a.noticeId===saved.noticeId));
  }
  await announce(context,saved.noticeId,outcome);
  context.invalidate();
  if(outcome==='arrangement-review')return {ok:false,code:'arrangement-review',commandRecorded:true};
  if(outcome==='unknown')return unknown();
  if(outcome==='failed')return {ok:false,code:'failed',commandRecorded:true};
  return {ok:true,code:outcome==='confirmed'?'saved':'pending',commandRecorded:true};
 }catch{return attempted?unknown():{ok:false,code:'unavailable'};}
}
/** Explicit receipt-only operation. The SQL function audits the operator and
 * applies an existing receipt atomically; there is no provider port on this path. */
export async function reconcileSchedulingNotice(context:Context,raw:unknown):Promise<PilotActionState>{
 const runtime=context.runtime;if(!runtime)return {ok:false,code:'unavailable'};
 const parsed=appointmentRetrySchema.safeParse(raw);if(!parsed.success)return {ok:false,code:'invalid'};
 const unknown=():PilotActionState=>({ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true});
 try{
  const input=parsed.data;
  const response=await context.write.rpc('reconcile_booking_notice',{p_member:context.memberId,p_actor:context.actorId,p_appointment:input.appointmentId,p_revision:input.revision,p_notice:input.noticeId,p_command:input.commandId,p_engine:ALGORITHM_VERSION,p_sender:runtime.sender,p_template:runtime.template.version});
  if(response.error){
   if(response.status&&response.status>=500&&response.status!==500)return unknown();
   if(['40001','55P03'].includes(response.error.code??''))return {ok:false,code:'conflict'};
   if(response.error.code==='42501')return {ok:false,code:'unavailable'};
   if(['22023','22P02'].includes(response.error.code??''))return {ok:false,code:'invalid'};
   return unknown();
  }
  const saved=z.strictObject({appointment:appointmentSchema,receiptRecorded:z.boolean()}).parse(response.data);
  if(saved.appointment.memberId!==context.memberId||saved.appointment.id!==input.appointmentId||saved.appointment.noticeId!==input.noticeId||saved.appointment.revision!==input.revision)return unknown();
  context.invalidate();
  const outcome=projectedOutcome(saved.appointment);
  if(saved.receiptRecorded)await announce(context,input.noticeId,outcome);
  if(saved.receiptRecorded&&saved.appointment.status==='reconciliation')return {ok:false,code:'arrangement-review',commandRecorded:true};
  if(outcome==='unknown'||outcome==='confirmed'&&!saved.receiptRecorded)return unknown();
  if(outcome==='failed')return {ok:false,code:'failed',commandRecorded:true};
  return {ok:true,code:outcome==='confirmed'?'saved':'pending',commandRecorded:true};
 }catch{return unknown();}
}

/** Founders' notice after a confirmed clinic email. Never changes the outcome. */
async function announce(context:Context,noticeId:string,outcome:SchedulingOutcome):Promise<SchedulingOutcome>{
 if(outcome!=='confirmed'||!founderNoticeEnabled())return outcome;
 try{
  const appointment=(await readAppointmentWorkspace(context,{details:'optional'})).appointments.find(a=>a.noticeId===noticeId);
  if(appointment&&(appointment.status==='confirmed'||appointment.status==='cancelled'))await notifyFounders({appointmentId:appointment.id,revision:appointment.revision,purpose:appointment.noticePurpose??'booking',status:appointment.status});
 }catch{}
 return outcome;
}
/** The arrangement being cancelled, in the shape the approved wording renders. */
function cancellationNotice(runtime:SchedulingRuntime,commandId:string,workspace:AppointmentWorkspace,appointment:Appointment){
 const visit=appointment.proposed;
 const offer:TrustedOffer={id:visit.offerId,version:visit.offerVersion,source:'current-arrangement',clinicId:visit.clinicId,mode:visit.mode,startsAt:visit.startsAt,endsAt:visit.endsAt,timezone:visit.timezone,
  clinicAddress:visit.mode==='clinic'?visit.location:null,preparation:visit.preparation,preparationVersion:visit.preparationVersion,coveredTestIds:visit.coveredTestIds,followUps:visit.followUps,
  reservationContract:{version:'current-arrangement',reference:appointment.id}};
 const items=(appointment.currentProgram?.length?appointment.currentProgram:appointment.program).map(item=>({...item,source:''}));
 const program:BookingProgram={memberId:appointment.memberId,sourceToken:'current-arrangement',requirementsToken:'current-arrangement',engineVersion:'current-arrangement',items};
 return renderSchedulingNotice(runtime,{reference:commandId,memberName:workspace.member.name,memberPhone:workspace.member.phone,clinicName:workspace.clinics?.[visit.clinicId]??'',program,offer,
  homeAddress:visit.mode==='home'?visit.location:null,purpose:'cancellation',previous:{startsAt:visit.startsAt,location:visit.location}});
}
/** Member or staff cancellation. Context comes from the public Auth guards, never a form.
 * The visit stays booked until the clinic email is accepted; a replay of the same
 * command returns the recorded result without a second email. */
export async function cancelAppointment(context:Context,raw:unknown):Promise<PilotActionState>{
 const runtime=context.runtime;
 const parsed=appointmentCancelSchema.safeParse(raw);
 if(!runtime&&!context.portal)return {ok:false,code:'unavailable'};
 if(!parsed.success||context.actorId!==context.memberId&&!parsed.data.agreementSource)return {ok:false,code:'invalid'};
 const input=parsed.data;let attempted=false;
 const unknown=():PilotActionState=>({ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true});
 try{
  const workspace=await readAppointmentWorkspace(context,{details:'required'});
  const appointment=workspace.appointments.find(a=>a.id===input.appointmentId);
  if(!appointment)return {ok:false,code:'unavailable'};
  if(appointment.portal?.channel==='portal'||appointment.noticeId===input.commandId&&appointment.portal?.portalRevisions.includes(appointment.revision)){
   if(!context.portal)return {ok:false,code:'unavailable'};
   attempted=true;
   return await portalCancel(context,input);
  }
  if(!runtime||!hasSchedulingWording(runtime,'cancellation'))return {ok:false,code:'unavailable'};
  // A recorded cancellation keeps the visit as its proposed arrangement, so a replay renders the same visit.
  const replay=appointment.noticeId===input.commandId;
  if(!replay&&(appointment.revision!==input.revision||!appointment.current))return {ok:false,code:'conflict'};
  const content=cancellationNotice(runtime,input.commandId,workspace,replay?appointment:{...appointment,proposed:appointment.current!});
  attempted=true;
  const response=await context.write.rpc('cancel_booking_appointment',{p_command_id:input.commandId,p_member:context.memberId,p_actor:context.actorId,p_appointment_id:input.appointmentId,p_revision:input.revision,
   p_agreement_source:input.agreementSource,p_sender_email:content.senderEmail,p_template_version:content.templateVersion,p_subject:content.subject,p_text_content:content.textContent});
  if(response.error){
   if(response.status&&response.status>=500&&response.status!==500)return unknown();
   if(['40001','55P03'].includes(response.error.code??''))return {ok:false,code:'conflict'};
   if(response.error.code==='42501')return {ok:false,code:'unavailable'};
   if(['22023','22P02'].includes(response.error.code??''))return {ok:false,code:'invalid'};
   return unknown();
  }
  const saved=appointmentSchema.safeParse(response.data);
  if(!saved.success||saved.data.memberId!==context.memberId||saved.data.id!==input.appointmentId||saved.data.noticeId!==input.commandId)return unknown();
  const outcome=await createAppointmentPorts(context).dispatch(saved.data.noticeId);
  context.invalidate();
  if(outcome==='arrangement-review')return {ok:false,code:'arrangement-review',commandRecorded:true};
  if(outcome==='unknown')return unknown();
  if(outcome==='failed')return {ok:false,code:'failed',commandRecorded:true};
  return {ok:true,code:outcome==='confirmed'?'saved':'pending',commandRecorded:true};
 }catch{return attempted?unknown():{ok:false,code:'unavailable'};}
}

const codeFor=(response:{error:{code?:string}|null;status?:number}):PilotActionState|null=>{
 if(!response.error)return null;
 if(response.status&&response.status>=500&&response.status!==500)return {ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true};
 if(['40001','55P03'].includes(response.error.code??''))return {ok:false,code:'conflict'};
 if(response.error.code==='42501')return {ok:false,code:'unavailable'};
 if(['22023','22P02'].includes(response.error.code??''))return {ok:false,code:'invalid'};
 return {ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true};
};
/** Cancel a clinic-hours visit, or withdraw a request the clinic has not answered. The clinic sees it in the portal. */
async function portalCancel(context:Context,input:{commandId:string;appointmentId:string;revision:number;agreementSource:string|null}):Promise<PilotActionState>{
 const response=await context.write.rpc('booking_portal_cancel',{p_command:input.commandId,p_member:context.memberId,p_actor:context.actorId,p_appointment:input.appointmentId,p_revision:input.revision,p_agreement_source:input.agreementSource});
 const refused=codeFor(response);if(refused)return refused;
 const saved=appointmentSchema.safeParse(response.data);
 if(!saved.success||saved.data.memberId!==context.memberId||saved.data.id!==input.appointmentId||saved.data.noticeId!==input.commandId)return {ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true};
 context.invalidate();
 return {ok:true,code:'saved',commandRecorded:true};
}
/** The member accepts or declines a clinic's proposed time. Only the member answers (checked in SQL too). */
export async function answerClinicProposal(context:Pick<Context,'portal'|'actorId'|'memberId'|'write'|'invalidate'>,raw:unknown):Promise<PilotActionState>{
 const parsed=proposalAnswerSchema.safeParse(raw);
 if(!context.portal||context.actorId!==context.memberId)return {ok:false,code:'unavailable'};
 if(!parsed.success)return {ok:false,code:'invalid'};
 try{
  const response=await context.write.rpc('booking_portal_proposal_answer',{p_command:parsed.data.commandId,p_member:context.memberId,p_actor:context.actorId,p_proposal:parsed.data.proposalId,p_accept:parsed.data.accept});
  const refused=codeFor(response);if(refused)return refused;
  const saved=appointmentSchema.safeParse(response.data);
  if(!saved.success||saved.data.memberId!==context.memberId)return {ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true};
  if(parsed.data.accept)dispatchNow();
  context.invalidate();
  return {ok:true,code:parsed.data.accept?'saved':'declined',commandRecorded:true};
 }catch{return {ok:false,code:'unknown',commandRecorded:true,outcomeUnknown:true};}
}
