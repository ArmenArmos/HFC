import {stepRequestId} from '@/lib/zoe-chat-actions/next-step-id';
/** Pure journey checks. No network, environment files or database. */
import assert from 'node:assert/strict';
import {memberJourneyStep,type JourneyInput} from '@/lib/patient/next-step';
import {memberJourneyStep as oldHomeRule} from '@/lib/patient-care/journey-step';
import {chatNextStep,testsNeeded,hasTestCoverage} from '@/lib/zoe-chat-actions/next-step';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {dialogThread} from '@/lib/zoe-chat-actions/thread';
const base:JourneyInput={questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date('2026-11-02T09:00:00Z')};
const cases:Array<[Partial<JourneyInput>,string|null]>=[
 [{questionnaireComplete:false},null],[{},'journey-book'],[{hasOpenRequest:true},'journey-request'],
 [{lab:'collected'},'journey-samples'],[{lab:'at-lab'},'journey-samples'],[{lab:'results-received'},'journey-results'],
 [{lab:'results-received',review:{status:'review_pending'}},'journey-results'],
 [{released:[{clinic:'Fixture clinic',uploadedAt:'2026-11-02T08:00:00Z'}]},'journey-results'],
 [{planPreparing:true},'journey-plan-preparing'],[{review:{status:'consultation_needed'}},'journey-consultation'],
 [{planPublished:true},null],[{review:undefined,appointments:undefined,canBook:false},null],
];
for(const [over,want]of cases){const input={...base,...over};assert.equal(memberJourneyStep(input)?.id??null,want);assert.deepEqual(memberJourneyStep(input),oldHomeRule(input));}
const step=(over:Partial<JourneyInput>={},extra={})=>chatNextStep({...base,...over},{episode:'assessment-1',...extra});
assert.equal(step().target,'tests_needed');
assert.equal(step({review:'none'}).target,'review');
assert.equal(step({review:{status:'consultation_needed'}},{resultsReleased:true}).target,'message');
assert.equal(step({planPreparing:true},{resultsReleased:true}).detail.en.includes('approved your plan'),true);
assert.equal(step({}, {testsChosen:true}).target,'visit');
assert.equal(step({lab:'at-lab'}).target,'results');
assert.equal(step({lab:'results-received'}).doctorInLoop,false,'Lab arrival alone is not doctor delivery');
assert.equal(step({lab:'results-received',review:{status:'review_pending'}}).doctorInLoop,true);
assert.equal(step({planPublished:true},{planId:'p1'}).target,'plan');
assert.equal(step({planPublished:true},{planId:'p1',teachBackConfirmed:true}).target,null);
assert.equal(step({review:undefined,appointments:undefined,canBook:false}).target,null);
assert.equal(step({review:undefined,appointments:undefined,canBook:false}).detail.en.includes('Nothing'),true);
assert.equal(chatNextStep(base,{episode:'a',unavailable:true}).detail.en,'Not available right now. Try again later.');
assert.equal(chatNextStep(base,{episode:'a',unavailable:true}).target,null);
assert.equal(stepRequestId('m',step()),stepRequestId('m',step({}, {testsChosen:true})),'Opening booking does not create another stage before the journey changes');
assert.equal(stepRequestId('m',step()),stepRequestId('m',step()));
const required=[{id:'lipids',title:'Lipid profile',method:'lab' as const},{id:'ecg',title:'ECG',method:'clinic' as const},{id:'hb',title:'Home readings',method:'home-log' as const}];
const fresh=testsNeeded(required,[{testId:'lipids',collectedOn:'2026-10-12',medicineChangedSince:false}],'2026-11-02');
assert.deepEqual(fresh.rows.map(r=>[r.id,r.fresh]),[['ecg',false],['hb',false]],'A valid recent result is not suggested');
assert.equal(testsNeeded(required,[{testId:'lipids',collectedOn:'2026-10-12',medicineChangedSince:null}],'2026-11-02').rows[0].fresh,false);
assert.equal(testsNeeded(required,[{testId:'unrelated',collectedOn:'2026-10-12',medicineChangedSince:false}],'2026-11-02').rows[0].fresh,false,'A dated panel must not make unrelated tests fresh');
const card=cardSchema.parse({id:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',kind:'next_step',source:'chip',sourceSeq:null,at:'2026-11-02T09:00:00Z',snapshot:step(),state:'done',claims:{},outcome:{next_step:{target:'tests_needed',doneAt:'2026-11-02T10:00:00Z'}}});
assert.equal(card.valid,true);
const thread=dialogThread([], [card]);
assert.equal(thread.length,0,'A receipt without its linked card must not say it opened');
assert.deepEqual(dialogThread([],JSON.parse(JSON.stringify([card]))),thread,'Reload uses saved action time');
const replaced=cardSchema.parse({...card,state:'done',outcome:{replaced:{doneAt:'2026-11-02T10:00:00Z'}}});
assert.equal(dialogThread([],[replaced]).length,0,'Superseded cards leave no unanswered form or receipt');

const parent=cardSchema.parse({...card,outcome:{next_step:{target:'tests_needed',requestId:'00000000-0000-4000-8000-000000000004',doneAt:'2026-11-02T10:00:00.123100Z'}}});
const child=cardSchema.parse({...card,id:'00000000-0000-4000-8000-000000000003',requestId:'00000000-0000-4000-8000-000000000004',kind:'tests_needed',snapshot:fresh,state:'open',outcome:{},at:'2026-11-02T10:00:00.123900Z'});
assert.deepEqual(dialogThread([],[child,parent]).map(e=>e.type),['turn','card'],'Sub-ms clock ties retain causal action/reply order');

assert.equal(hasTestCoverage(['Ընդհանուր խոլեստերին','HDL-C','LDL-C','Տրիգլիցերիդներ'],['total_cholesterol','hdl_c','ldl_c','triglycerides']),true,'Planned row names match the reader’s stored analyte keys');
assert.equal(hasTestCoverage(['Ընդհանուր խոլեստերին','HDL-C','LDL-C','Տրիգլիցերիդներ'],['total_cholesterol','hdl_c','triglycerides']),false,'A partial panel does not count as complete');
assert.equal(hasTestCoverage('Կրեատինին + eGFR',['creatinine']),false);
assert.equal(hasTestCoverage('Կրեատինին + eGFR',['creatinine','egfr']),true);

// Main's reused booking and plan controls also finish as dialog turns at the saved action time.
const after={kind:'member' as const,key:'later-message',text:'Another question',channel:'app' as const,requestId:null,at:'2026-11-02T10:30:00Z'};
for(const [kind,snapshot,outcome,claims,item]of [
 ['visit',{v:1,available:true,next:null,proposal:null,attention:false},{booking:{kind:'select',ok:true,doneAt:'2026-11-02T11:00:00Z'}},{},'booking'],
 ['plan',{v:1,available:true,plan:null},{'everyday:result':{status:'saved',doneAt:'2026-11-02T11:00:00Z'}},{everyday:{op:card.requestId,payload:{view:'plan_ack'}}},'everyday:result'],
] as const){
 const finished=cardSchema.parse({...card,kind,snapshot,outcome,claims,state:'done'});
 if(kind==='visit')assert.deepEqual(dialogThread([after],[finished]).map(e=>e.type),['card','item'],'Classic visit outcomes retain main’s default projection');
 const entries=dialogThread([after],[finished],true);
 assert.deepEqual(entries.map(e=>e.type),['item','turn'],`${kind}: used form leaves its old place`);
 assert.equal(entries[1].type==='turn'&&entries[1].item,item);
 assert.deepEqual(dialogThread([after],JSON.parse(JSON.stringify([finished])),true),entries,`${kind}: reload preserves the action order`);
}

console.log('Next step: shared home rule, stages, freshness, failures and persisted dialog checks passed');
