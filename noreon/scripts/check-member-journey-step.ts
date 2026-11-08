/** Home "Your next step" for real members follows the saved journey, most advanced stage first (lead input 17 Oct). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberJourneyStep,currentAppointment,type JourneyInput} from '@/lib/patient-care/journey-step';
import type {Appointment} from '@/lib/real-booking/appointment-schema';
import {journeyStripIndex} from '@/lib/patient-care/journey-strip';

const now=new Date('2026-10-18T09:00:00Z');
const clinicId='11111111-1111-4111-8111-111111111111';
const arrangement=(startsAt:string,mode:'clinic'|'home'='clinic',preparation='Come fasting. Bring your ID.')=>({offerId:'22222222-2222-4222-8222-222222222222',offerVersion:'v1',clinicId,mode,startsAt,endsAt:new Date(Date.parse(startsAt)+30*60000).toISOString(),timezone:'Asia/Yerevan' as const,location:mode==='clinic'?'Fictional street 1, Yerevan':'Fictional home address 9',preparation,preparationVersion:'p1',coveredTestIds:['t1'],followUps:[]});
const visit=(over:Partial<Appointment>={}):Appointment=>({version:'email-pilot-v1',id:'33333333-3333-4333-8333-333333333333',memberId:'44444444-4444-4444-8444-444444444444',revision:1,status:'confirmed',program:[],current:arrangement('2026-10-20T07:00:00Z'),proposed:arrangement('2026-10-20T07:00:00Z'),noticeId:'55555555-5555-4555-8555-555555555555',createdAt:'2026-10-17T10:00:00Z',...over} as Appointment);
const portal=(over:Partial<NonNullable<Appointment['portal']>>)=>({channel:'portal' as const,noticeState:'accepted',portalRevisions:[1],decline:null,proposal:null,checkin:null,...over});
const base:JourneyInput={questionnaireComplete:true,review:{status:'review_pending'},appointments:[],clinics:{[clinicId]:'Fictional Polyclinic'},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now};
const step=(over:Partial<JourneyInput>)=>memberJourneyStep({...base,...over});

// 1 and 9: the existing actions lead.
assert.equal(step({questionnaireComplete:false}),null,'Unfinished questionnaire keeps its own action');
assert.equal(step({planPublished:true,lab:'results-received'}),null,'A published plan hands over to plan and medication actions');
// 2: review request.
assert.equal(step({review:'none'})?.id,'journey-review');
assert.equal(step({review:'none'})?.href,'/patient/review');
// 3: book tests (clinic or home).
assert.equal(step({})?.id,'journey-book');
assert.equal(step({canBook:false})?.id,'journey-reviewing','Without booking the member sees their review status');
// 4: waiting for the clinic, or a new proposed time.
assert.equal(step({appointments:[visit({status:'notification-pending',current:null})]})?.id,'journey-waiting');
const proposed=step({appointments:[visit({status:'notification-pending',current:null,portal:portal({noticeState:'pending',proposal:{id:'66666666-6666-4666-8666-666666666666',startsAt:'2026-10-21T08:00:00Z',endsAt:'2026-10-21T08:30:00Z',note:null,clinicId,clinicName:'Fictional Polyclinic',clinicAddress:'Fictional street 1',createdAt:'2026-10-17T12:00:00Z'}})})]});
assert.equal(proposed?.id,'journey-proposal');assert.match(proposed!.detail.en,/Wed 21 Oct, 12:00 at Fictional Polyclinic/);
assert.equal(step({appointments:[visit({status:'failed'})]})?.id,'journey-visit-check','A failed outcome is never shown as confirmed');
// 5: visit confirmed, with time, place, preparation and a map link.
const confirmed=step({appointments:[visit()]})!;
assert.equal(confirmed.id,'journey-visit');
assert.equal(confirmed.title.en,'Your visit is Tue 20 Oct, 11:00');
assert.match(confirmed.title.hy,/^Ձեր այցը՝ .*11:00$/);
assert.equal(confirmed.detail.en,'At Fictional Polyclinic, Fictional street 1, Yerevan. Come fasting. Bring your ID.');
assert.ok(confirmed.secondary?.href.startsWith('https://www.google.com/maps/search/?api=1&query=Fictional%20Polyclinic'),'Clinic visits get a map link');
assert.equal(confirmed.href,'/patient/service');
const home=step({appointments:[visit({current:arrangement('2026-10-20T07:00:00Z','home')})]})!;
assert.ok(!home.secondary,'A home visit has no clinic map');assert.match(home.detail.en,/^Home visit at/);
const longPrep=step({appointments:[visit({current:arrangement('2026-10-20T07:00:00Z','clinic','x'.repeat(400))})]})!;
assert.match(longPrep.detail.en,/Read your preparation before the visit\.$/,'Long preparation is not truncated mid-instruction');
// Visit done, no-show, cancelled.
assert.equal(step({appointments:[visit({portal:portal({checkin:{outcome:'arrived',at:'2026-10-20T07:05:00Z'}})})]})?.id,'journey-visit-done');
assert.equal(step({appointments:[visit()],now:new Date('2026-10-21T09:00:00Z')})?.title.en,'Your visit time has passed','No check-in: never claim the visit happened');
assert.equal(step({appointments:[visit({portal:portal({checkin:{outcome:'arrived',at:'2026-10-20T07:05:00Z'}})})]})?.title.en,'Your visit is done');
assert.doesNotMatch(readFileSync('lib/patient-care/journey-step.ts','utf8'),/doctor is reviewing/i);
assert.equal(step({appointments:[visit({portal:portal({checkin:{outcome:'no-show',at:'2026-10-20T07:40:00Z'}})})]})?.id,'journey-rebook');
assert.equal(step({appointments:[visit({status:'cancelled'})]})?.id,'journey-book','A cancelled visit sends the member back to booking');
assert.equal(currentAppointment([visit({status:'cancelled'}),visit({id:'77777777-7777-4777-8777-777777777777',status:'notification-pending',current:null,createdAt:'2026-10-17T11:00:00Z'})])?.status,'notification-pending');
// 6 and 7: lab stages outrank the visit.
assert.equal(step({appointments:[visit()],lab:'at-lab'})?.id,'journey-samples');
assert.equal(step({appointments:[visit()],lab:'collected'})?.title.en,'Your samples were collected');
assert.equal(step({lab:'results-received'})?.title.en,'Your results are with your doctor','Assignment is not a claim that review is under way');
assert.equal(step({lab:'results-received',review:{status:'awaiting_assignment'}})?.title.en,'Your lab results have arrived');
// 8: consultation outranks results.
const consult=step({lab:'results-received',review:{status:'consultation_needed'}})!;
assert.equal(consult.id,'journey-consultation');assert.equal(consult.detail.en,'Your care team will contact you to arrange a time.');
assert.equal(step({review:{status:'consultation_needed',consultation:{scheduledAt:'2026-10-22T08:00:00Z',channel:'phone',clinic:null}},consultationText:{en:'Arranged.',hy:'Նշանակված է։',ru:'Назначено.'}})?.detail.en,'Arranged.');
// Outages never send a member backwards or invent a step.
assert.equal(step({review:undefined,appointments:undefined,canBook:false}),null,'Unknown state shows no invented step');
assert.equal(step({review:undefined,appointments:[visit()]})?.id,'journey-visit','A failed review read does not hide a confirmed visit');
assert.notEqual(step({review:undefined})?.id,'journey-review','A failed review read never asks for a new review request');
// QA N-02 (18 Oct): the clinic's result link completes the visit and the doctor releases the PDF.
const completedVisit=visit({portal:portal({checkin:{outcome:'completed',at:'2026-10-20T09:00:00Z'}})});
assert.equal(step({appointments:[completedVisit],now:new Date('2026-10-21T09:00:00Z')})?.id,'journey-results','A completed visit (results sent) is results received, never "visit time has passed"');
assert.equal(step({appointments:[completedVisit],lab:'at-lab'})?.id,'journey-results','The most advanced recorded stage wins over an older lab stage');
assert.equal(step({appointments:[completedVisit],lab:null})?.title.en,'Your results are with your doctor');
const ready=step({appointments:[completedVisit],released:[{clinic:'Fictional Polyclinic',uploadedAt:'2026-10-20T09:00:00Z'},{clinic:'Older Clinic',uploadedAt:'2026-09-01T09:00:00Z'}]})!;
assert.equal(ready.id,'journey-results');assert.equal(ready.href,'/patient/results');
assert.equal(ready.title.en,'Your results are with your doctor');assert.equal(ready.title.hy,'Ձեր արդյունքները ձեր բժշկի մոտ են');
assert.match(ready.detail.en,/after approval/,'Released documents still wait for the doctor-approved plan');
assert.doesNotMatch(JSON.stringify(ready),/Your results are ready|Ձեր արդյունքները պատրաստ են|Ваши результаты готовы/);
assert.equal(step({lab:'results-received',released:[{clinic:'Fictional Polyclinic',uploadedAt:'2026-10-20T09:00:00Z'}],review:{status:'consultation_needed'}})?.id,'journey-consultation','A needed consultation still outranks released results');
assert.equal(step({planPublished:true,released:[{clinic:'Fictional Polyclinic',uploadedAt:'2026-10-20T09:00:00Z'}]}),null,'A published plan still hands over');
const rebooked=visit({id:'88888888-8888-4888-8888-888888888888',createdAt:'2026-11-01T10:00:00Z',current:arrangement('2026-11-05T07:00:00Z')});
assert.equal(step({appointments:[rebooked],released:[{clinic:'Fictional Polyclinic',uploadedAt:'2026-10-20T09:00:00Z'}]})?.id,'journey-visit','An older released PDF does not hide a newer booked visit (Fable F2)');
assert.equal(step({appointments:[visit({createdAt:'2026-10-17T10:00:00Z'})],released:[{clinic:'Fictional Polyclinic',uploadedAt:'2026-10-20T09:00:00Z'}]})?.id,'journey-results','Released results wait for plan approval');
assert.equal(step({appointments:[completedVisit],released:null})?.id,'journey-results','A failed document read falls back to results received, never backwards');
assert.equal(step({appointments:[completedVisit],released:[]})?.id,'journey-results');
assert.equal(step({appointments:[visit({portal:portal({checkin:{outcome:'arrived',at:'2026-10-20T07:05:00Z'}})})],released:[]})?.id,'journey-visit-done','Arrived without results stays at visit done');
// Copy: voice guide, no payment gate, no per-message review promise.
// The assigned doctor is named once the member may see it (Khikar 17 Oct); never before assignment.
const named=step({canBook:false,doctorName:'Dr Fictional Ani'})!;
assert.equal(named.title.en,'Your request is with Dr Fictional Ani');assert.match(named.detail.hy,/Dr Fictional Ani/);
assert.equal(step({canBook:false,doctorName:null})!.title.en,'Your request is with your doctor');
assert.equal(step({canBook:false,review:{status:'awaiting_assignment'},doctorName:'Dr Fictional Ani'})!.title.en,'Your review request is saved','No name before assignment');
// Journey strip: questionnaire, tests, results, plan; a failed lab read never moves forward.
const strip=(o:Partial<Parameters<typeof journeyStripIndex>[0]>)=>journeyStripIndex({questionnaireComplete:true,lab:null,planPublished:false,...o});
assert.equal(strip({questionnaireComplete:false,lab:'results-received'}),0);
assert.equal(strip({}),1);assert.equal(strip({lab:undefined}),1,'Failed read stays on tests');
assert.equal(strip({lab:'collected'}),2);assert.equal(strip({lab:'at-lab'}),2);
assert.equal(strip({lab:'results-received'}),3);assert.equal(strip({planPublished:true}),4);
// Nurse visit flow: the latest nurse step leads after lab stages; a newer booking leads; "confirmed"
// alone leads only without a booked visit.
const st=(step:'confirmed'|'samples-collected'|'samples-at-lab'|'completed',at='2026-10-18T08:00:00Z')=>({step,at});
const nurse=(steps:ReturnType<typeof st>[],samplesTaken:number|null=null)=>({startsAt:'2026-10-18T07:00:00Z',mode:'home' as const,steps,samplesTaken});
assert.equal(step({nurseVisit:nurse([st('confirmed'),st('samples-collected'),st('completed')],2)})?.id,'journey-nurse-visit-done');
assert.match(step({nurseVisit:nurse([st('completed')],2)})!.detail.en,/took 2 samples\. Your results are not ready yet\./);
assert.match(step({nurseVisit:nurse([st('completed')],0)})!.detail.en,/Your next step will appear here/);
assert.equal(step({nurseVisit:nurse([st('confirmed'),st('samples-collected'),st('samples-at-lab')])})?.id,'journey-nurse-samples-sent');
assert.equal(step({nurseVisit:nurse([st('samples-collected'),st('confirmed')])})?.id,'journey-nurse-samples-collected','Step order, not array order');
assert.equal(step({nurseVisit:nurse([st('confirmed')]),hasOpenRequest:true})?.id,'journey-nurse-confirmed','A confirmed home visit replaces "request saved"');
assert.match(step({nurseVisit:nurse([st('confirmed')])})!.detail.en,/^Home visit Sun 18 Oct, 11:00\.$/);
assert.equal(step({nurseVisit:nurse([st('confirmed','2026-10-18T09:30:00Z')]),appointments:[visit({createdAt:'2026-10-18T09:00:00Z'})]})?.id,'journey-visit','Confirmed alone does not hide a booked visit');
assert.equal(step({nurseVisit:nurse([st('completed')],1),lab:'at-lab'})?.id,'journey-samples','Lab stages lead');
assert.equal(step({nurseVisit:nurse([st('completed')],1),appointments:[visit({createdAt:'2026-10-18T09:00:00Z'})]})?.id,'journey-visit','A booking made after the latest step leads');
assert.equal(step({nurseVisit:undefined})?.id,'journey-book','A failed nurse visit read changes nothing');
assert.equal(strip({nurseSamplesTaken:true}),2);assert.equal(strip({nurseSamplesTaken:false}),1);
const source=readFileSync('lib/patient-care/journey-step.ts','utf8');
assert.doesNotMatch(source,/—|!"|pilot-commerce|pricing|paymentFor|reviews (each|every)/i,"Voice guide; payment is never read, so never a gate");
const home2=readFileSync('components/patient/member-home-content.tsx','utf8');
assert.match(home2,/memberJourneyStep\(/);assert.match(home2,/Your questionnaire summary/,'The questionnaire summary stays reachable');
console.log('Member journey step: questionnaire, review, book, waiting/proposal, visit confirmed (time, place, preparation, map), done/no-show, samples, results, consultation, plan hand-over; outages never move backwards.');

const placeholder=step({canBook:false,doctorName:'STAGING Test Doctor'})!;
for(const value of [...Object.values(placeholder.title),...Object.values(placeholder.detail)])assert.doesNotMatch(value,/STAGING|\btest\b/iu);
