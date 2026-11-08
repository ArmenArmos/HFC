/** Shared stage and allowed Zoe sentence classes. Pure: no database or provider calls. */
import assert from 'node:assert/strict';
import {JOURNEY_STAGES,STAGE_CLASSES,journeyStage,zoeSentenceMatchesStage,type JourneyStage,type JourneyOptions} from '@/lib/patient/journey-stage';
import {type JourneyInput} from '@/lib/patient/next-step';
import {chatNextStep,nextStepSnapshot,type NextStep} from '@/lib/zoe-chat-actions/next-step';
import type {Appointment} from '@/lib/real-booking/appointment-schema';

const base:JourneyInput={questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date('2026-11-02T09:00:00Z')};
const arrangement={offerId:'offer',offerVersion:'1',clinicId:'clinic',mode:'clinic' as const,startsAt:'2026-11-03T08:00:00Z',endsAt:'2026-11-03T09:00:00Z',timezone:'Asia/Yerevan' as const,location:'Fixture clinic',preparation:'Bring your ID.',preparationVersion:'1',coveredTestIds:[],followUps:[]};
const visit:Appointment={version:'email-pilot-v1',id:'visit',memberId:'member',revision:1,status:'confirmed',program:[],current:arrangement,proposed:arrangement,noticeId:'notice',createdAt:'2026-11-01T08:00:00Z'};
const proposal={id:'proposal',startsAt:arrangement.startsAt,endsAt:arrangement.endsAt,note:null,clinicId:'clinic',clinicName:'Fixture clinic',clinicAddress:'Fixture address',createdAt:'2026-11-02T08:00:00Z'};
type Row={stage:JourneyStage;input:Partial<JourneyInput>;options?:Partial<JourneyOptions>;target:NextStep['target'];identity:string};
const rows:Row[]=[
 {stage:'questionnaire_open',input:{questionnaireComplete:false},target:null,identity:'a:r:waiting'},
 {stage:'tests_to_choose',input:{},target:'tests_needed',identity:'a:r:journey-book'},
 {stage:'booking_needed',input:{},options:{testsChosen:true},target:'visit',identity:'a:r:journey-book'},
 {stage:'visit_booked',input:{appointments:[visit]},target:'visit',identity:'a:r:journey-visit'},
 {stage:'results_waiting',input:{lab:'at-lab'},target:'results',identity:'a:r:journey-samples:plan-approval'},
 {stage:'review_pending',input:{lab:'results-received',review:{status:'review_pending'}},target:'results',identity:'a:r:journey-results:plan-approval'},
 {stage:'consultation',input:{review:{status:'consultation_needed'}},options:{resultsReleased:true},target:'message',identity:'a:r:journey-consultation'},
 {stage:'plan_preparing',input:{planPreparing:true},options:{resultsReleased:true},target:'results',identity:'a:r:journey-plan-preparing:plan-approval'},
 {stage:'plan_published',input:{planPublished:true},options:{planId:'p'},target:'plan',identity:'a:plan:p:published'},
 {stage:'plan_confirmed',input:{planPublished:true},options:{planId:'p',teachBackConfirmed:true},target:null,identity:'a:plan:p:confirmed'},
 {stage:'waiting',input:{review:undefined,appointments:undefined,canBook:false},target:null,identity:'a:r:waiting'},
 {stage:'review_needed',input:{review:'none'},target:'review',identity:'a:r:journey-review'},
 {stage:'test_request_pending',input:{hasOpenRequest:true},target:'visit',identity:'a:r:journey-request'},
 {stage:'visit_confirmation_pending',input:{appointments:[{...visit,status:'notification-pending',current:null}]},target:'visit',identity:'a:r:journey-waiting'},
 {stage:'visit_time_proposed',input:{appointments:[{...visit,portal:{channel:'portal',noticeState:'accepted',portalRevisions:[1],decline:null,proposal,checkin:null}}]},target:'visit',identity:'a:r:journey-proposal'},
 {stage:'visit_needs_checking',input:{appointments:[{...visit,status:'failed'}]},target:'visit',identity:'a:r:journey-visit-check'},
];
assert.deepEqual([...new Set(rows.map(r=>r.stage))].sort(),JOURNEY_STAGES.filter(s=>s!=='results_released').sort(),'Every reachable stage has an agreement fixture');
for(const row of rows){
 const input={...base,...row.input},options={episode:'a',revision:'r',...row.options};
 assert.equal(journeyStage(input,options),row.stage);
 const card=chatNextStep(input,options);
 assert.equal(card.journeyStage,row.stage);
 assert.equal(card.target,row.target,row.stage);
 assert.equal(card.stage,row.identity,'Card identity retires prior results-ready promises only for approval holds');
 assert.equal(nextStepSnapshot.parse(card).journeyStage,row.stage,'The persisted snapshot retains the shared stage');
 const sentence=STAGE_CLASSES[row.stage];
 for(const locale of ['hy','en','ru'] as const)assert.ok(sentence[locale].trim(),`${row.stage}: ${locale}`);
 for(const other of JOURNEY_STAGES)assert.equal(zoeSentenceMatchesStage(row.stage,STAGE_CLASSES[other].key),other===row.stage,'Another stage cannot supply Zoe’s next-step sentence');
 assert.equal(zoeSentenceMatchesStage(row.stage,'unknown'),false);
}
// Alternate Home actions and conflicting facts must keep the same precedence.
const variants:Array<[Partial<JourneyInput>,Partial<JourneyOptions>,JourneyStage,NextStep['target']]>=[
 [{lab:'collected'},{},'results_waiting','results'],
 [{lab:'partial'},{},'results_waiting','results'],
 [{lab:'results-received'},{},'results_waiting','results'],
 [{released:[{clinic:'Fixture clinic',uploadedAt:'2026-11-02T08:00:00Z'}]},{},'results_waiting','results'],
 [{canBook:false,review:{status:'awaiting_assignment'}},{},'review_pending',null],
 [{canBook:false,review:{status:'review_pending'}},{},'review_pending',null],
 [{appointments:[{...visit,portal:{channel:'portal',noticeState:'accepted',portalRevisions:[1],decline:null,proposal:null,checkin:{outcome:'no-show',at:'2026-11-02T08:00:00Z'}}}]},{},'tests_to_choose','tests_needed'],
 [{appointments:[{...visit,current:{...arrangement,endsAt:'2026-11-01T09:00:00Z'}}]},{},'results_waiting','results'],
 [{questionnaireComplete:false},{resultsReleased:true},'questionnaire_open',null],
 [{questionnaireComplete:false,planPublished:true,planPreparing:true,review:{status:'consultation_needed'}},{resultsReleased:true},'plan_published','plan'],
 [{planPreparing:true,review:{status:'consultation_needed'}},{resultsReleased:true},'consultation','message'],
 [{hasOpenRequest:true},{testsChosen:true},'test_request_pending','visit'],
];
for(const step of ['confirmed','samples-collected','samples-at-lab','completed'] as const)
 variants.push([{nurseVisit:{startsAt:arrangement.startsAt,mode:'home',samplesTaken:1,steps:[{step,at:'2026-11-02T08:00:00Z'}]}},{},step==='confirmed'?'visit_booked':'results_waiting',step==='confirmed'?'visit':'results']);
for(const [over,extra,stage,target] of variants){
 const input={...base,...over},options={episode:'a',...extra},card=chatNextStep(input,options);
 assert.equal(journeyStage(input,options),stage);
 assert.equal(card.journeyStage,stage);
 assert.equal(card.target,target);
}
assert.equal(chatNextStep(base,{episode:'a',unavailable:true}).journeyStage,undefined,'Unavailable presentation must not invent a semantic stage');
// Older saved cards remain readable without the newly recorded semantic stage.
const oldCard={...chatNextStep(base,{episode:'a'})};
delete oldCard.journeyStage;
assert.equal(nextStepSnapshot.safeParse(oldCard).success,true);
const noShow={...visit,createdAt:'2026-11-03T08:00:00Z',portal:{channel:'portal' as const,noticeState:'accepted' as const,portalRevisions:[1],decline:null,proposal:null,checkin:{outcome:'no-show' as const,at:'2026-11-03T10:00:00Z'}}};
const rebook={...base,appointments:[noShow],now:new Date('2026-11-04T09:00:00Z')};
assert.equal(journeyStage(rebook,{episode:'a',resultsReleased:true,resultsPublishedAt:'2026-11-01T09:00:00Z'}),'tests_to_choose','An older structured publication cannot replace the newer no-show rebooking step');
assert.equal(journeyStage(rebook,{episode:'a',resultsReleased:true,resultsPublishedAt:'2026-11-04T08:00:00Z'}),'results_waiting','A newer recorded publication waits for doctor approval');
assert.equal(journeyStage(rebook,{episode:'a',resultsReleased:true,resultsPublishedAt:'invalid'}),'tests_to_choose','An unreadable publication date proves no release');
console.log(`Next-step agreement: ${rows.length} stages, card targets and identities, three languages and exclusive Zoe sentence classes passed`);
