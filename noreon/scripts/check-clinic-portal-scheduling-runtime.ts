import assert from 'node:assert/strict';
import {answerClinicProposal,cancelAppointment,createAppointmentPorts,readAppointmentWorkspace,type BookingRpc,type BookingRuntimeContext} from '@/lib/real-booking/appointment-runtime';
import {readCancelForm,readProposalForm} from '@/lib/real-booking/appointment-commands';
import {clinicSchedulingEnabled,followUpTestIds,clinicTests,settingsInputSchema,yerevanDay} from '@/lib/clinic-scheduling/schema';
import {readBookingQuery,runScheduleCommand,saveScheduleSettings} from '@/lib/clinic-scheduling/runtime';

// Fictional identities only; every RPC is a recorded fake.
const member='c5c00000-0000-4000-8000-000000000001',staff='c5c00000-0000-4000-8000-000000000006',clinic='c5c00000-0000-4000-8000-00000000000a';
const appointment='c5c00000-0000-4000-8000-000000000031',command='c5c00000-0000-4000-8000-000000000041',proposal='c5c00000-0000-4000-8000-000000000077';
type Call={name:string;args?:Record<string,unknown>};
function rpc(answers:Record<string,unknown>,calls:Call[]):BookingRpc{return {rpc:async(name,args)=>{calls.push({name,args});return name in answers?{data:answers[name],error:null}:{data:null,error:{code:'PGRST202'}};}};}
const arrangement={offerId:'c5c00000-0000-4000-8000-0000000000a1',offerVersion:'clinic-hours-1-x',clinicId:clinic,mode:'clinic',startsAt:'2030-01-02T05:00:00+00:00',endsAt:'2030-01-02T05:30:00+00:00',timezone:'Asia/Yerevan',location:'1 Fictional Street',preparation:'Fictional',preparationVersion:'p',coveredTestIds:['lab-a'],followUps:[]};
const dto=(status:string,revision=0,noticeId=appointment)=>({version:'email-pilot-v1',id:appointment,memberId:member,revision,canStartScheduling:false,status,program:[{id:'lab-a',title:'Fictional lab A',method:'lab',preparation:''}],currentProgram:[],history:[],legacyCurrent:null,
 current:status==='confirmed'?arrangement:null,proposed:arrangement,noticeId,createdAt:'2030-01-01T00:00:00+00:00'});
const portal=(channel:'portal'|'email')=>({memberId:member,enabled:true,appointments:{[appointment]:{channel,noticeState:'accepted',portalRevisions:channel==='portal'?[0]:[],decline:null,
 proposal:{id:proposal,startsAt:'2030-01-03T05:00:00+00:00',endsAt:'2030-01-03T05:30:00+00:00',note:null,clinicId:clinic,clinicName:'Fictional clinic',clinicAddress:'1 Fictional Street',createdAt:'2030-01-01T00:00:00+00:00'},checkin:null}}});
const workspace={member:{id:member,name:'Fictional member'},appointments:[dto('confirmed')]};
const details={memberId:member,phone:'37499000155',purposes:{},clinics:{[clinic]:'Fictional clinic'}};
const context=(over:Partial<BookingRuntimeContext>,answers:Record<string,unknown>,calls:Call[]):BookingRuntimeContext=>({memberId:member,actorId:member,read:rpc(answers,calls),write:rpc(answers,calls),runtime:null,portal:true,invalidate:()=>{},...over});

// 1. Switches: both the scheduling flag and the clinic portal must be on.
assert.equal(clinicSchedulingEnabled({NOREON_CLINIC_SCHEDULING_ENABLED:'true'}),false);
assert.equal(clinicSchedulingEnabled({NOREON_CLINIC_SCHEDULING_ENABLED:'true',NOREON_CLINIC_PORTAL_ENABLED:'true'}),true);
assert.equal(clinicSchedulingEnabled({NOREON_CLINIC_PORTAL_ENABLED:'true'}),false);

// 2. Booking a clinic-hours slot without email: no email content, no send attempt.
{
 const calls:Call[]=[];
 const hours={id:'c5c00000-0000-4000-8000-0000000000a1',version:'clinic-hours-1-x',source:'clinic-hours',clinicId:clinic,mode:'clinic',startsAt:arrangement.startsAt,endsAt:arrangement.endsAt,timezone:'Asia/Yerevan',clinicAddress:'1 Fictional Street',preparation:'Fictional',preparationVersion:'p',coveredTestIds:['lab-a'],followUps:[],reservationContract:{version:'clinic-hours-v1',reference:'r'}};
 const ports=createAppointmentPorts(context({},{booking_pilot_offers:[{offer:hours,clinicName:'Fictional clinic'}]},calls));
 assert.equal(ports.available,true,'Portal channel makes booking available without email');
 const input={commandId:command,offerId:hours.id,offerVersion:hours.version,homeAddress:null};
 const offer=await ports.offer(input,{sealId:command,program:{memberId:member,sourceToken:'s',requirementsToken:'r',engineVersion:'e',items:[{id:'lab-a',title:'Fictional lab A',method:'lab',preparation:'',source:''}]}});
 assert.equal(offer?.source,'clinic-hours');
 assert.deepEqual(ports.render(input,offer!,{memberId:member,sourceToken:'s',requirementsToken:'r',engineVersion:'e',items:[]}),{senderEmail:null,templateVersion:null,subject:null,textContent:null});
 assert.equal(await ports.dispatch(command),'pending','No email claim for a portal notice');
 assert.ok(!calls.some(c=>c.name==='claim_booking_notice'),'Never claims an email');
 const off=createAppointmentPorts(context({portal:false},{booking_pilot_offers:[{offer:hours,clinicName:'Fictional clinic'}]},[]));
 assert.equal(off.available,false);
 assert.equal(await off.offer(input,{sealId:command,program:{memberId:member,sourceToken:'s',requirementsToken:'r',engineVersion:'e',items:[]}}),null,'With the portal off a clinic-hours slot is not admitted');
}

// 3. Workspace carries the portal details; cancel of a portal visit goes to the portal RPC.
{
 const calls:Call[]=[];
 const answers={booking_pilot_workspace:workspace,booking_pilot_workspace_details:details,booking_portal_details:portal('portal'),booking_portal_cancel:dto('cancelled',1,command)};
 const read=await readAppointmentWorkspace(context({},answers,calls),{details:'optional'});
 assert.equal(read.appointments[0].portal?.proposal?.id,proposal);
 const result=await cancelAppointment(context({},answers,calls),{commandId:command,appointmentId:appointment,revision:0,agreementSource:null});
 assert.deepEqual(result,{ok:true,code:'saved',commandRecorded:true});
 assert.deepEqual(calls.find(c=>c.name==='booking_portal_cancel')?.args,{p_command:command,p_member:member,p_actor:member,p_appointment:appointment,p_revision:0,p_agreement_source:null});
 // An email visit with no email runtime stays unavailable; nothing is written.
 const emailCalls:Call[]=[];
 assert.deepEqual(await cancelAppointment(context({},{...answers,booking_portal_details:portal('email')},emailCalls),{commandId:command,appointmentId:appointment,revision:0,agreementSource:null}),{ok:false,code:'unavailable'});
 assert.ok(!emailCalls.some(c=>c.name.includes('cancel')));
 // Staff need the member's recorded agreement.
 assert.deepEqual(await cancelAppointment(context({actorId:staff},answers,[]),{commandId:command,appointmentId:appointment,revision:0,agreementSource:null}),{ok:false,code:'invalid'});
}

// 4. Only the member answers a clinic proposal.
{
 const calls:Call[]=[];
 const answers={booking_portal_proposal_answer:dto('confirmed',1,command)};
 assert.deepEqual(await answerClinicProposal(context({actorId:staff},answers,calls),{commandId:command,proposalId:proposal,accept:true}),{ok:false,code:'unavailable'});
 assert.equal(calls.length,0,'Staff cannot accept for the member');
 assert.deepEqual(await answerClinicProposal(context({},answers,calls),{commandId:command,proposalId:proposal,accept:true}),{ok:true,code:'saved',commandRecorded:true});
 assert.deepEqual(await answerClinicProposal(context({},answers,calls),{commandId:command,proposalId:proposal,accept:false}),{ok:true,code:'declined',commandRecorded:true});
 assert.deepEqual(await answerClinicProposal(context({portal:false},answers,calls),{commandId:command,proposalId:proposal,accept:true}),{ok:false,code:'unavailable'});
 const form=new FormData();form.set('commandId',command);form.set('proposalId',proposal);form.set('accept','true');
 assert.deepEqual(readProposalForm(form),{commandId:command,proposalId:proposal,accept:true});
 form.set('memberId',member);assert.equal(readProposalForm(form),null,'No extra form fields');
 const cancel=new FormData();cancel.set('commandId',command);cancel.set('appointmentId',appointment);cancel.set('revision','0');cancel.set('agreementSource','');
 assert.deepEqual(readCancelForm(cancel),{commandId:command,appointmentId:appointment,revision:0,agreementSource:null});
}

// 5. Clinic runtime: filters, command validation and settings.
{
 assert.deepEqual(readBookingQuery({scope:'past',day:'2030-01-02',status:'arrived'}),{scope:'past',day:'2030-01-02',status:'arrived'});
 assert.deepEqual(readBookingQuery({scope:'x',day:'02/01/2030',status:'change-requested'}),{scope:'upcoming',day:null,status:null});
 assert.equal(yerevanDay('2030-01-01T20:30:00Z'),'2030-01-02','Yerevan day is UTC+4');
 const calls:Call[]=[];
 const clinicRpc=rpc({clinic_schedule_command:{status:'stale'},clinic_schedule_settings_save:{status:'address-required'}},calls);
 assert.deepEqual(await runScheduleCommand(clinicRpc,clinic,{version:'clinic-schedule-command-v1',op:'decline',submissionId:command,appointmentId:appointment,revision:0,reason:'x'}),{status:'invalid'},'Short reason refused before the RPC');
 assert.equal(calls.length,0);
 assert.deepEqual(await runScheduleCommand(clinicRpc,clinic,{version:'clinic-schedule-command-v1',op:'propose',submissionId:command,appointmentId:appointment,revision:0,slotKey:'a'.repeat(64),note:'  '}),{status:'stale'});
 assert.equal((calls[0].args?.p_command as {note:unknown}).note,null,'A blank note is sent as none');
 const wrong=rpc({clinic_schedule_command:{status:'saved',booking:{appointmentId:command,revision:0,reference:command,kind:'current',status:'confirmed',channel:'portal',memberName:'x',memberPhone:null,startsAt:arrangement.startsAt,endsAt:arrangement.endsAt,previousStartsAt:null,previousEndsAt:null,tests:[],proposal:null,decline:null}}},[]);
 assert.deepEqual(await runScheduleCommand(wrong,clinic,{version:'clinic-schedule-command-v1',op:'confirm',submissionId:command,appointmentId:appointment,revision:0}),{status:'unknown'},'A result for another booking is not trusted');
 const settings={expectedRevision:0,active:true,slotMinutes:30,capacity:2,coveredTestIds:['lipid-panel','hba1c'],preparation:'Fictional',hours:[{weekday:1,opens:'09:00',closes:'13:00'}]};
 assert.equal(settingsInputSchema.safeParse({...settings,coveredTestIds:['bp-home-log']}).success,false,'Home tracking is not a clinic test');
 assert.equal(settingsInputSchema.safeParse({...settings,hours:[{weekday:1,opens:'13:00',closes:'09:00'}]}).success,false);
 assert.equal(await saveScheduleSettings(clinicRpc,clinic,settings).then(r=>r.status),'address-required');
 const sent=calls.at(-1)?.args?.p_settings as {followUpTestIds:string[]};
 assert.deepEqual(sent.followUpTestIds,followUpTestIds(['lipid-panel','hba1c']));
 assert.ok(!sent.followUpTestIds.includes('lipid-panel')&&sent.followUpTestIds.length===clinicTests.length-2,'Every other clinic test is followed up by Noreon');
}
console.log('Clinic-portal scheduling runtime: portal booking without email, portal cancel, member-only proposal answers, clinic command and settings validation PASS (fake RPCs).');
