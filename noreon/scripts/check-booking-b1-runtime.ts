import assert from 'node:assert/strict';
import {cancelAppointment,createAppointmentPorts,type BookingRpc} from '@/lib/real-booking/appointment-runtime';
import {schedulingEnvelopeHash} from '@/lib/real-booking/scheduling-notice';
import {schedulingRuntime,renderSchedulingNotice,hasSchedulingWording,type SchedulingRuntime} from '@/lib/real-booking/scheduling-template';
import {notifyFounders,registerFounderNoticeSender,type FounderBookingNotice} from '@/lib/real-booking/founder-notice';
import {slotOffer,slotFormSchema,slotTests} from '@/lib/staff/booking-slots';
import {appointmentWorkspaceSchema} from '@/lib/real-booking/appointment-schema';

// 1. Approved wording per purpose; no fallback text for change or cancellation.
const base={version:'b1-v1',approvalReference:'fictional-approval',subject:'Booking {{reference}}',textContent:'{{memberName}} {{memberPhone}} {{visitMode}} {{startsAt}} {{location}}\n{{coveredTests}}'};
const env={NOREON_SCHEDULING_EMAIL_ENABLED:'true',NOREON_BREVO_API_KEY:'fictional-key-not-a-real-credential',NOREON_BREVO_EMAIL_SENDER:'noreon@example.invalid'};
const only=schedulingRuntime({...env,NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON:JSON.stringify(base)})!;
assert.ok(only);assert.equal(hasSchedulingWording(only,'booking'),true);assert.equal(hasSchedulingWording(only,'change'),false);assert.equal(hasSchedulingWording(only,'cancellation'),false);
const full=schedulingRuntime({...env,NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON:JSON.stringify({...base,change:{subject:'Change {{reference}}',textContent:'Was {{previousStartsAt}} at {{previousLocation}}; now {{startsAt}}'},cancellation:{subject:'Cancel {{reference}}',textContent:'Cancel {{previousStartsAt}} {{memberPhone}}'}})})!;
assert.ok(full&&hasSchedulingWording(full,'change')&&hasSchedulingWording(full,'cancellation'));
assert.equal(schedulingRuntime({...env,NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON:JSON.stringify({...base,cancellation:{subject:'x',textContent:'{{healthAnswers}}'}})}),null,'Unknown fields in sub-wording are refused');
assert.equal(schedulingRuntime({...env,NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON:JSON.stringify({...base,change:{subject:'a\nb',textContent:'x'}})}),null,'Header injection in sub-wording is refused');
const id='b3000000-0000-4000-8000-000000000001';
const program={memberId:id,sourceToken:'s',requirementsToken:'r',engineVersion:'e',items:[{id:'lab-a',title:'Fictional lab A',method:'lab' as const,preparation:'',source:'PRIVATE_RULE'}]};
const offer={id,version:'v1',source:'fixture',clinicId:id,mode:'home' as const,startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan' as const,clinicAddress:null,preparation:'Fictional prep',preparationVersion:'p1',coveredTestIds:['lab-a'],followUps:[],reservationContract:{version:'v',reference:'r'}};
const input={reference:'ref-1',memberName:'Fictional Member',memberPhone:'37499000001',clinicName:'Fictional clinic',program,offer,homeAddress:'2 Fictional Home Street'};
const booked=renderSchedulingNotice(full,input);
assert.equal(booked.subject,'Booking ref-1');assert.ok(booked.textContent.includes('+37499000001'));assert.ok(booked.textContent.includes('home'));assert.ok(!booked.textContent.includes('PRIVATE_RULE'));
const changed=renderSchedulingNotice(full,{...input,purpose:'change',previous:{startsAt:'2029-12-31T09:00:00+04:00',location:'1 Fictional Street'}});
assert.equal(changed.subject,'Change ref-1');assert.ok(changed.textContent.includes('31/12/2029 09:00')&&changed.textContent.includes('1 Fictional Street'));
assert.throws(()=>renderSchedulingNotice(only,{...input,purpose:'cancellation',previous:{startsAt:offer.startsAt,location:'x'}}),/wording/i,'No invented cancellation text');
assert.throws(()=>renderSchedulingNotice(full,{...input,purpose:'change'}),/previous/i);

// 2. Cancel command: guards, one RPC, then the generation-1 send path; replay never re-renders a different visit.
const details={offerId:id,offerVersion:'v1',clinicId:id,mode:'clinic' as const,startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan' as const,location:'1 Fictional Street',preparation:'Prep',preparationVersion:'p1',coveredTestIds:['lab-a'],followUps:[]};
const command='b3000000-0000-4000-8000-000000000070';
let appointment:Record<string,unknown>={version:'email-pilot-v1',id,memberId:id,revision:1,status:'confirmed',noticePurpose:'change',program:[{id:'lab-a',title:'Fictional lab A',method:'lab',preparation:''}],current:details,proposed:details,noticeId:id,createdAt:'2026-10-16T00:00:00Z'};
// The released workspace shape is unchanged; B1 details come from a separate RPC.
const workspace=()=>({member:{id,name:'Fictional Member'},appointments:[appointment]});
let detailsError:{code:string}|null=null;
const detailsRow=()=>({memberId:id,phone:'37499000001',purposes:{[`${id}:${appointment.revision}`]:appointment.noticePurpose},clinics:{[id]:'Fictional clinic'}});
assert.ok(appointmentWorkspaceSchema.safeParse(workspace()).success);
const calls:string[]=[];let cancelArgs:Record<string,unknown>={};let cancelError:{code:string}|null=null;let cancelResult:Record<string,unknown>={};let alreadyClaimed=false;
const content={senderEmail:'noreon@example.invalid',clinicEmail:'clinic@example.invalid',copyEmail:'copy@example.invalid',templateVersion:'b1-v1',subject:'Cancel x',textContent:'x'};
const envelope={...content,noticeId:command,attemptId:'',generation:1,envelopeHash:schedulingEnvelopeHash(content)};
const write:BookingRpc={rpc:async(name,args)=>{calls.push(name);
 if(name==='cancel_booking_appointment'){cancelArgs=args!;return {data:cancelError?null:cancelResult,error:cancelError};}
 // As in SQL, a notice already claimed returns no envelope, so a replay can never send again.
 if(name==='claim_booking_notice')return {data:alreadyClaimed?null:{...envelope,attemptId:args!.p_attempt},error:null};
 if(name==='record_booking_notice_receipt')return {data:true,error:null};
 if(name==='apply_booking_notice_receipt'){appointment={...appointment,status:'cancelled',current:null,noticeId:command,revision:2};return {data:appointment,error:null};}
 return {data:null,error:{code:'XX000'}};}};
const read:BookingRpc={rpc:async name=>name==='booking_pilot_workspace_details'?{data:detailsError?null:detailsRow(),error:detailsError}:{data:workspace(),error:null}};
const context={memberId:id,actorId:id,read,write,runtime:full,invalidate:()=>{},http:async()=>{calls.push('HTTP');return new Response(JSON.stringify({messageId:'fictional-receipt'}),{status:201});}};
const raw={commandId:command,appointmentId:id,revision:1,agreementSource:null};
assert.deepEqual(await cancelAppointment({...context,runtime:only},raw),{ok:false,code:'unavailable'},'No cancellation wording, no cancel');
assert.deepEqual(await cancelAppointment({...context,runtime:null},raw),{ok:false,code:'unavailable'});
assert.deepEqual(await cancelAppointment({...context,actorId:'b3000000-0000-4000-8000-000000000004'},raw),{ok:false,code:'invalid'},'Staff cancel needs agreement');
assert.deepEqual(await cancelAppointment(context,{...raw,revision:0}),{ok:false,code:'conflict'},'Stale revision never reaches SQL');
detailsError={code:'PGRST202'};assert.deepEqual(await cancelAppointment(context,raw),{ok:false,code:'unavailable'},'No phone and clinic details, no clinic email');detailsError=null;
assert.deepEqual(calls,[]);
cancelResult={...appointment,revision:2,status:'notification-pending',noticePurpose:'cancellation',noticeId:command};
assert.deepEqual(await cancelAppointment(context,raw),{ok:true,code:'saved',commandRecorded:true});
assert.deepEqual(calls,['cancel_booking_appointment','claim_booking_notice','HTTP','record_booking_notice_receipt','apply_booking_notice_receipt']);
assert.equal(cancelArgs.p_subject,'Cancel '+command);assert.ok(String(cancelArgs.p_text_content).includes('+37499000001'));assert.ok(String(cancelArgs.p_text_content).includes('01/01/2030 09:00'));
// Replay of a recorded cancellation: the visit is now the proposed arrangement and is re-rendered from it.
calls.length=0;alreadyClaimed=true;appointment={...appointment,status:'notification-pending',noticePurpose:'cancellation',current:details,noticeId:command,revision:2};cancelResult={...appointment};
assert.equal((await cancelAppointment(context,{...raw,revision:1})).code!=='conflict',true,'Replay of the same command is not treated as stale');
assert.equal(calls[0],'cancel_booking_appointment');assert.ok(!(calls as string[]).includes('HTTP'),'A replayed cancellation never sends a second email');alreadyClaimed=false;assert.equal(cancelArgs.p_revision,1);assert.ok(String(cancelArgs.p_text_content).includes('01/01/2030 09:00'));
calls.length=0;cancelError={code:'40001'};appointment={...appointment,status:'confirmed',current:details,revision:1,noticeId:id};
assert.deepEqual(await cancelAppointment(context,raw),{ok:false,code:'conflict'});assert.deepEqual(calls,['cancel_booking_appointment'],'Refused cancel never sends');
calls.length=0;cancelError=null;cancelResult={...cancelResult,noticeId:id};
assert.equal((await cancelAppointment(context,raw)).code,'unknown','A result for another notice is never trusted');assert.deepEqual(calls,['cancel_booking_appointment']);

// 3. Founders' hook: off by default, no sender registered, never throws into booking.
const sent:FounderBookingNotice[]=[];const notice:FounderBookingNotice={appointmentId:id,revision:2,purpose:'cancellation',status:'cancelled'};
assert.equal(await notifyFounders(notice,{}),'skipped');assert.equal(await notifyFounders(notice,{NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED:'true'}),'skipped','No sender registered in this batch');
registerFounderNoticeSender(async n=>{sent.push(n);});assert.equal(await notifyFounders(notice,{}),'skipped','Flag off ignores a sender');
assert.equal(await notifyFounders(notice,{NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED:'true'}),'sent');assert.deepEqual(Object.keys(sent[0]).sort(),['appointmentId','purpose','revision','status']);
registerFounderNoticeSender(async()=>{throw Error('down');});assert.equal(await notifyFounders(notice,{NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED:'true'}),'failed');registerFounderNoticeSender(null);
assert.equal(typeof createAppointmentPorts,'function');

// 4. Admin slot: Yerevan time, idempotent identity, follow-ups only for tests not done, no home address.
const form={requestId:'b3000000-0000-4000-8000-0000000000f1',clinicId:id,mode:'home',date:'2030-01-02',start:'09:00',end:'09:30',capacity:'4',tests:[slotTests[0].id],preparation:'Fictional prep',reference:'Clinic email 16 Oct',followUpOwner:'',followUpAction:''};
const parsed=slotFormSchema.parse(form);const slot=slotOffer(parsed,'1 Fictional Street');
assert.equal(slot.startsAt,'2030-01-02T09:00:00+04:00');assert.equal(slot.clinicAddress,null);assert.deepEqual(slot.followUps,[]);assert.equal(slot.id,form.requestId);
assert.deepEqual(slotOffer(parsed,'1 Fictional Street'),slot,'Resubmission builds the same offer');
assert.equal(slotOffer({...parsed,mode:'clinic'},'1 Fictional Street').clinicAddress,'1 Fictional Street');
const withFollow=slotOffer(slotFormSchema.parse({...form,followUpOwner:'Fictional operations',followUpAction:'Books a clinic visit'}),null);
assert.equal(withFollow.followUps.length,slotTests.length-1);assert.ok(!withFollow.followUps.some(f=>f.testId===slotTests[0].id));
assert.equal(slotFormSchema.safeParse({...form,end:'08:00'}).success,false);assert.equal(slotFormSchema.safeParse({...form,tests:[]}).success,false);
assert.equal(slotFormSchema.safeParse({...form,tests:['bp-home-log']}).success,false,'Home tracking is never a slot test');
assert.equal(slotFormSchema.safeParse({...form,followUpOwner:'Only owner'}).success,false);
console.log('B1 runtime: purpose wording without fallback, phone/mode/previous fields, cancel guards and single send path, founders hook off, admin slot builder passed. Injected IO only.');
