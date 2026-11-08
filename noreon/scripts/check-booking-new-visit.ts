// WP-5 (quality review items 6 and 12): a new visit after an attended one, and the My progress line.
import assert from 'node:assert/strict';
import {readAppointmentWorkspace,type BookingRpc} from '@/lib/real-booking/appointment-runtime';
import type {Appointment} from '@/lib/real-booking/appointment-schema';
import {canBookNewVisit,fencesHomeRequest,programmeVisits} from '@/lib/real-booking/visit-gate';
import {visitSummary} from '@/lib/real-booking/visit-summary';
import {testStates} from '@/components/real-booking/booking-tests';
const member='b5000000-0000-4000-8000-000000000001';
const id=(n:number)=>`b5000000-0000-4000-8000-0000000000${String(n).padStart(2,'0')}`;
const arrangement={offerId:id(90),offerVersion:'v1',clinicId:id(91),mode:'clinic' as const,startsAt:'2026-01-01T09:00:00+04:00',endsAt:'2026-01-01T10:00:00+04:00',timezone:'Asia/Yerevan' as const,location:'Fictional clinic',preparation:'Fictional',preparationVersion:'v1',coveredTestIds:['lab-a'],followUps:[]};
const visit=(n:number,status:Appointment['status'],programme?:Appointment['programme']):Appointment=>({version:'email-pilot-v1',id:id(n),memberId:member,revision:0,status,program:[{id:'lab-a',title:'Fictional lab A',method:'lab',preparation:''}],current:status==='cancelled'?null:arrangement,proposed:arrangement,noticeId:id(n),createdAt:'2026-01-01T00:00:00Z',...(programme?{programme}:{})});
const program=[{id:'lab-a',title:'Fictional lab A',method:'lab' as const,preparation:''}];

// Item 6: an attended visit from an earlier programme no longer blocks a new booking.
const attendedEarlier=visit(1,'confirmed',{currentProgramme:false,open:false});
assert.equal(canBookNewVisit([attendedEarlier]),true,'An attended visit for an earlier programme does not block a new booking');
assert.deepEqual(programmeVisits([attendedEarlier]),[],'It is history, not part of the current programme');
assert.equal(testStates(program,programmeVisits([attendedEarlier])).get('lab-a'),'to-book','Today\'s test is not shown as booked by the earlier visit');
assert.equal(fencesHomeRequest(attendedEarlier),false,'Nor does it fence a home-visit request (the SQL fence agrees)');
// The same programme: the database refuses a second booking, so the app does not offer one.
const attendedCurrent=visit(2,'confirmed',{currentProgramme:true,open:false});
assert.equal(canBookNewVisit([attendedCurrent]),false,'A visit for the current programme blocks a second one');
assert.equal(fencesHomeRequest(attendedCurrent),true,'And fences a home request');
// A cancelled visit for the current programme is booked again from its own card, not as a new one.
const cancelledCurrent=visit(3,'cancelled',{currentProgramme:true,open:false});
assert.equal(canBookNewVisit([cancelledCurrent]),false,'A cancelled current-programme visit is rebooked from its card');
assert.equal(fencesHomeRequest(cancelledCurrent),false,'A cancelled visit never fences a home request');
// An earlier programme's visit that is still upcoming must be moved or cancelled first.
const openEarlier=visit(4,'confirmed',{currentProgramme:false,open:true});
assert.equal(canBookNewVisit([attendedEarlier,openEarlier]),false,'An open earlier visit still blocks a new booking');
assert.deepEqual(programmeVisits([attendedEarlier,openEarlier]).map(a=>a.id),[id(4)],'Only the open visit is shown with the current programme');
// Without the programme state (read failed, or before the migration) every visit blocks, as before.
assert.equal(canBookNewVisit([visit(5,'confirmed')]),false,'Unknown state keeps the earlier rule');
assert.equal(canBookNewVisit([visit(6,'cancelled')]),false,'Unknown state keeps the earlier rule for a cancelled visit');
assert.equal(canBookNewVisit([]),true,'Nothing booked: book');

// The runtime attaches the programme state to each visit, and tolerates its absence.
const workspace={member:{id:member,name:'Fictional'},appointments:[visit(1,'confirmed')]};
const details={memberId:member,phone:null,purposes:{},clinics:{}};
const reader=(state:unknown):BookingRpc=>({rpc:async(name:string)=>name==='booking_pilot_workspace'?{data:workspace,error:null}:name==='booking_pilot_workspace_details'?{data:details,error:null}:name==='booking_pilot_programme_state'?(state instanceof Error?{data:null,error:{code:'PGRST202'}}:{data:state,error:null}):{data:null,error:{code:'42883'}}});
const withState=await readAppointmentWorkspace({memberId:member,read:reader({memberId:member,appointments:{[id(1)]:{currentProgramme:false,open:false}}})},{details:'optional'});
assert.deepEqual(withState.appointments[0].programme,{currentProgramme:false,open:false},'Programme state attached');
const missing=await readAppointmentWorkspace({memberId:member,read:reader(new Error('absent'))},{details:'optional'});
assert.equal(missing.appointments[0].programme,undefined,'A missing function leaves the earlier rule in place');
const wrongMember=await readAppointmentWorkspace({memberId:member,read:reader({memberId:id(99),appointments:{[id(1)]:{currentProgramme:false,open:false}}})},{details:'optional'});
assert.equal(wrongMember.appointments[0].programme,undefined,'State for another member is ignored');
const bare=await readAppointmentWorkspace({memberId:member,read:reader({memberId:member,appointments:{}})});
assert.equal(bare.appointments[0].programme,undefined,'The plain workspace read (staff access check) does not read the state');

// Item 12: only confirmed visits count as confirmed.
const summary=(appointments:Appointment[])=>visitSummary({available:false,unavailableReason:null,program:[],offers:[],appointments},'en');
assert.equal(summary([visit(7,'cancelled')]),'No confirmed visit. Your visit was cancelled.','One cancelled visit is not "1 confirmed visit"');
assert.equal(summary([visit(7,'cancelled'),visit(8,'cancelled')]),'No confirmed visit. Your visits were cancelled.','Plural cancelled wording');
assert.equal(summary([visit(7,'cancelled'),visit(9,'confirmed')]),'1 confirmed visit.','A cancelled visit beside a confirmed one counts only the confirmed');
assert.equal(summary([visit(9,'confirmed'),visit(10,'confirmed')]),'2 confirmed visits.','Two confirmed visits');
assert.equal(visitSummary({available:false,unavailableReason:null,program:[],offers:[],appointments:[visit(7,'cancelled')]},'hy'),'Հաստատված այց չկա։ Ձեր այցը չեղարկվել է։','Armenian cancelled wording');
assert.equal(summary([]),null,'Nothing booked: no line');
console.log('Booking after an attended visit: ok');
