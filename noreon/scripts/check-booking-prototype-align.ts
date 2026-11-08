/** Booking in the prototype's style (pairs 08, 09): per-test state comes only from saved
 * appointments, the strip never runs ahead of what the booking page knows, and its labels stay
 * equal to Home's. */
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {testStates,BookingTests,BookingJourney,VisitActor,BOOKING_STRIP_LABELS} from '@/components/real-booking/booking-tests';
import {STAGE_LABEL,JOURNEY_STAGES} from '@/lib/patient-care/journey-strip';
import type {Appointment,PublicProgramItem} from '@/lib/real-booking/appointment-schema';

assert.deepEqual(BOOKING_STRIP_LABELS,JOURNEY_STAGES.map(s=>[STAGE_LABEL[s].en,STAGE_LABEL[s].hy,STAGE_LABEL[s].ru]),'booking strip labels equal the Home strip');
const program:PublicProgramItem[]=[{id:'blood',title:'Fictional blood test',method:'lab',preparation:'Fast for 8 hours.'},{id:'ecg',title:'Fictional ECG',method:'clinic',preparation:''},{id:'diary',title:'Fictional home diary',method:'home-log',preparation:''}];
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const arr=(covered:string[],mode:'clinic'|'home'='clinic')=>({offerId:id(9),offerVersion:'v',clinicId:id(8),mode,startsAt:'2026-10-20T07:00:00Z',endsAt:'2026-10-20T08:00:00Z',timezone:'Asia/Yerevan' as const,location:'Fictional street',preparation:'',preparationVersion:'p',coveredTestIds:covered,followUps:[]});
const appt=(status:Appointment['status'],covered:string[],current=true,extra:Partial<Appointment>={}):Appointment=>({version:'email-pilot-v1',id:id(1),memberId:id(2),revision:1,status,program,current:current?arr(covered):null,proposed:arr(covered),noticeId:id(3),createdAt:'2026-10-18T00:00:00Z',...extra} as Appointment);

let s=testStates(program,[]);
assert.deepEqual([...s.values()],['to-book','to-book','home'],'nothing saved: to book; home tracking is never bookable');
s=testStates(program,[appt('confirmed',['blood','ecg'])]);
assert.deepEqual([s.get('blood'),s.get('ecg')],['booked','booked'],'a confirmed visit books what it covers');
s=testStates(program,[appt('notification-pending',['blood'],false)]);
assert.equal(s.get('blood'),'requested','waiting on the clinic is requested, not booked');
assert.equal(s.get('ecg'),'to-book');
assert.equal(testStates(program,[appt('cancelled',['blood','ecg'])]).get('blood'),'to-book','a cancelled visit covers nothing');
assert.equal(testStates(program,[appt('failed',['blood','ecg'],false)]).get('blood'),'to-book','a failed new booking (no accepted visit) covers nothing');
// #256 review F1: a visit that still exists keeps its tests Booked whatever email or change is in flight.
const cancelFail=appt('failed',['blood','ecg'],true,{noticePurpose:'cancellation'} as never);
assert.deepEqual([testStates(program,[cancelFail]).get('blood'),testStates(program,[cancelFail]).get('ecg')],['booked','booked'],'failed cancellation email: the visit is still booked');
assert.equal(testStates(program,[appt('failed',['blood','ecg'],true,{noticePurpose:'change'} as never)]).get('blood'),'booked','failed time change: the current visit is still booked');
assert.equal(testStates(program,[appt('notification-pending',['blood','ecg'],true,{noticePurpose:'cancellation'} as never)]).get('blood'),'booked','pending cancellation: booked until it lands');
for(const status of ['notification-pending','unknown'] as const){
 const change={...appt(status,['blood'],true,{noticePurpose:'change'} as never),proposed:arr(['blood','ecg'])};
 const st=testStates(program,[change]);
 assert.deepEqual([st.get('blood'),st.get('ecg')],['booked','requested'],`${status} change: current tests stay booked, only new ones are requested`);
}

for(const locale of ['en','hy'] as const){
 const preparation=locale==='en'?'Fast for 8 hours.':'Այցից առաջ 8 ժամ մի կերեք։';
 const localizedProgram=program.map(item=>item.id==='blood'?{...item,preparation}:item);
 const html=renderToStaticMarkup(createElement(BookingTests,{program:localizedProgram,appointments:[appt('confirmed',['blood'])],locale}));
 assert.ok(html.includes('data-booking-program')&&!/<details[^>]*data-booking-program[^>]*open/.test(html),'compact disclosure, closed');
 assert.ok(html.includes(locale==='en'?'1 of 2 booked':'1՝ 2-ից գրանցված'),'ring text counts bookable tests only');
 assert.match(html,/stroke-dasharray="50 100"/,'ring is booked over bookable');
 assert.ok(html.includes(preparation),'preparation is reachable');
 assert.equal(renderToStaticMarkup(createElement(BookingJourney,{appointments:[],current:1,locale})),'','no strip before a visit exists');
 assert.equal(renderToStaticMarkup(createElement(BookingJourney,{appointments:[appt('confirmed',['blood'])],locale})),'','no strip without Home\'s index');
 for(const current of [1,2,3])assert.equal((renderToStaticMarkup(createElement(BookingJourney,{appointments:[appt('confirmed',['blood'])],current,locale})).match(/data-state="done"/g)??[]).length,current,'strip shows exactly Home\'s index');
 // #256 F2: no "choose below" without offered times; an open home request is never "to book".
 assert.ok(!renderToStaticMarkup(createElement(BookingTests,{program,appointments:[],locale,offered:false})).includes(locale==='en'?'Choose where and when below':'Ստորև ընտրեք'),'no choose-below line without offered times');
 assert.ok(renderToStaticMarkup(createElement(BookingTests,{program,appointments:[],locale,offered:true})).includes(locale==='en'?'Choose where and when below':'Ստորև ընտրեք'));
 const home=renderToStaticMarkup(createElement(BookingTests,{program,appointments:[],locale,offered:true,homeRequest:true}));
 assert.ok(!home.includes(locale==='en'?'To book':'Գրանցելու')&&!home.includes('<svg width="40"')&&!home.includes(locale==='en'?'Choose where':'Ստորև ընտրեք'),'open home request: no to-book chips, ring or choose-below line');
 assert.equal(renderToStaticMarkup(createElement(VisitActor,{appointment:appt('notification-pending',['blood'],true,{noticePurpose:'cancellation'} as never),locale})),'','no visit-type line while cancelling');
 assert.match(renderToStaticMarkup(createElement(VisitActor,{appointment:appt('confirmed',['blood'],true,{proposed:arr(['blood'],'home'),current:arr(['blood'],'home')}),locale})),/data-actor="nurse"/);
}
console.log('Booking prototype alignment: tests on a still-existing visit stay booked, requested only for pending bookings or changes, no to-book under a home request, strip is Home\'s index, labels equal Home.');
