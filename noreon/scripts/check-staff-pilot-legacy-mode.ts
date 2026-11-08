import assert from 'node:assert/strict';import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';
import{legacyBookingMode,withClinicalHold,evidenceClinicalHold}from'@/lib/real-booking/legacy-mode';import{PilotStaffBooking}from'@/components/real-booking/pilot-staff';
import type{Appointment,PilotBookingData}from'@/lib/real-booking/appointment-schema';

// CP14-F1: with the email pilot switched off and no pilot history, members use the legacy request flow.
// Staff must not see the pilot panel then, and when the panel does show it must not speak as the member.
const id='b3000000-0000-4000-8000-000000000071';
const program=[{id:'synthetic',title:'Synthetic',method:'lab' as const,preparation:''}];
const proposed={offerId:id,offerVersion:'v1',clinicId:id,mode:'clinic' as const,startsAt:'2030-01-01T09:00:00+04:00',endsAt:'2030-01-01T10:00:00+04:00',timezone:'Asia/Yerevan' as const,location:'Synthetic clinic',preparation:'Synthetic only',preparationVersion:'v1',coveredTestIds:['synthetic'],followUps:[]};
const appointment:Appointment={version:'email-pilot-v1',id,memberId:id,revision:0,status:'confirmed',program,current:null,proposed,noticeId:id,createdAt:'2026-10-16T00:00:00Z'};
const legacy:PilotBookingData={available:false,unavailableReason:'legacy-reconciliation',program,offers:[],appointments:[]};

assert.equal(legacyBookingMode(legacy,false),true,'Pilot off and no pilot history: legacy flow, no pilot panel');
assert.equal(legacyBookingMode({...legacy,appointments:[appointment]},false),false,'Pilot history stays visible even when the pilot is off');
assert.equal(legacyBookingMode(legacy,true),false,'Configured pilot always shows the panel');
assert.equal(legacyBookingMode({...legacy,unavailableReason:'clinical-hold'},false),false,'CP14-F1-R1: a clinical hold stays visible with the pilot off');
assert.equal(legacyBookingMode({...legacy,unavailableReason:'configuration-unavailable'},false),true,'Derived program with no runtime is legacy, as for the member');
for(const reason of['source-unavailable','unavailable'] as const)assert.equal(legacyBookingMode({...legacy,unavailableReason:reason},false),false,`CP14-F3: ${reason} never proved the clinical state, so it is not legacy`);
assert.equal(legacyBookingMode(null,false),false,'Unknown pilot state is never treated as legacy');
assert.equal(legacyBookingMode(undefined,false),false);

// CP14-F3: a hold found from stored evidence wins over a non-clinical pilot outage and closes booking.
const outage:PilotBookingData={...legacy,available:false,unavailableReason:'unavailable',offers:[]};
assert.deepEqual(withClinicalHold(outage,true),{...outage,unavailableReason:'clinical-hold'});
assert.equal(withClinicalHold(outage,false),outage,'No hold leaves pilot data untouched');
const open:PilotBookingData={...legacy,available:true,unavailableReason:null,offers:[{id,version:'v1',clinicId:id,mode:'clinic',startsAt:proposed.startsAt,endsAt:proposed.endsAt,timezone:'Asia/Yerevan',clinicAddress:'Synthetic',preparation:'',preparationVersion:'v1',coveredTestIds:['synthetic'],followUps:[],clinicName:'Synthetic'}],appointments:[appointment]};
const closed=withClinicalHold(open,true);
assert.equal(closed.available,false);assert.equal(closed.unavailableReason,'clinical-hold');assert.deepEqual(closed.offers,[],'A hold removes bookable choices');assert.deepEqual(closed.appointments,[appointment],'Recorded appointments stay visible');
assert.equal(legacyBookingMode(withClinicalHold({...legacy,unavailableReason:'configuration-unavailable'},true),false),false,'A detected hold is never hidden as legacy');
const evidence={profile:{name:'Synthetic',birthDate:'1980-01-01',biologicalSex:'female'},consent:null,assessment:null,reports:[],visits:[]};
const snapshot=(systolic:number)=>({id,revision:0,evidenceToken:'synthetic',draft:null,draftSavedAt:null,draftStale:false,evidence:{...evidence,measurements:[{id,systolic,diastolic:80,pulse:null,measured_at:'2026-10-16T08:00:00Z'}]}});
assert.equal(evidenceClinicalHold(snapshot(190)),true,'Crisis-range blood pressure is a clinical booking hold');
assert.equal(evidenceClinicalHold(snapshot(120)),false,'A non-clinical engine stop (incomplete questionnaire) is not reported as a hold');

const props={locale:'en' as const,commandIds:{},changeAction:async()=>({ok:true}),refreshHref:'/staff/real/members/synthetic'};
for(const reason of ['legacy-reconciliation','clinical-hold','source-unavailable','configuration-unavailable','unavailable'] as const){
 const html=renderToStaticMarkup(createElement(PilotStaffBooking,{...props,data:{...legacy,unavailableReason:reason}}));
 assert.doesNotMatch(html,/\bYour\b/,`Staff pilot panel speaks about the member, not as the member (${reason})`);
}
const held=renderToStaticMarkup(createElement(PilotStaffBooking,{...props,data:{...legacy,unavailableReason:'legacy-reconciliation'}}));
assert.match(held,/Assigned program/);assert.match(held,/The member’s earlier arrangement needs review before another booking\./);
const hold=renderToStaticMarkup(createElement(PilotStaffBooking,{...props,data:{...legacy,unavailableReason:'clinical-hold'}}));
assert.match(hold,/The assigned program needs clinical review before booking\./);
console.log('Staff pilot panel: hidden in legacy mode, shown with pilot history or configuration, staff wording only.');
