import assert from 'node:assert/strict';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {createFakeProvider,type ProviderRequest} from '@/lib/zoe/provider';
import {createFakeJudge} from '@/lib/zoe/reply-check';
import {freeSpeed} from '@/lib/zoe/free-mode-speed';
import {createGatewayProvider} from '@/lib/zoe/gateway';

// Synthetic requests through the actual pipeline. Run with zoe-offline-guard.cjs.
const conversation={enabled:true,doctorName:null,answeredThroughSeq:1,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const on=(text:string,extra:Parameters<typeof job>[1]={})=>job(['My knee hurts after walking',text],{
 healthAnswers:true,directAnswers:true,conversation,
 intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},
 answers:[{body:'You can describe this here.',minutesAgo:2}],...extra,
});
const routing={config:DEFAULT_ROUTE_CONFIG,providerFor:(m:{id:string})=>({...createFakeProvider(),requestModel:m.id})};
const run=(j:ReturnType<typeof job>,extra:Parameters<typeof runPipeline>[1]={})=>runPipeline(j,{routing,directAnswers:true,...extra});

// The original expensive scenario: an answered symptom must not stick to a greeting or a new question.
for(const [text,tier] of [['Hello','low'],['Where can I find the app settings?','low'],['What is a healthy breakfast?','medium']] as const){
 const r=await run(on(text,text==='Hello'?{}:{topic:{breakAfterSeq:1,startSeq:null,zoeOwns:false,profile:null}}));
 assert.equal(r.finish?.tier,tier,`${text}: answered symptoms do not keep the high tier`);
 assert.ok(r.finish?.answer,`${text}: still answered`);
 assert.equal(r.judgeCalls.length,1,`${text}: free text is still judged`);
 if(text==='Hello'){
  assert.deepEqual(r.providerCalls.map(c=>c.purpose),['conversation']);
  assert.equal(r.providerCalls[0]!.maxOutputTokens,400);
  assert.doesNotMatch(r.providerCalls[0]!.memberBlock,/knee|member_data|member_record/);
 }
}
// Pending or referential clinical material must retain the strong route and the health judge.
for(const j of [
 on('Where can I find the app settings?',{conversation:{...conversation,answeredThroughSeq:0}}),
 on('What about the pain I mentioned earlier?'),
 on('What is a healthy breakfast?',{answers:[{body:'Are you breathless too?',minutesAgo:2}]}),
 on('What is a healthy breakfast?',{answers:[{body:'Your doctor should see this today.',minutesAgo:2}]}),
 on('Yes'),on('It is worse'),on('Should I stop my pills?'),on('My knee hurts again'),
 on('When will it go away?'),on('How do I manage it?'),on('What is causing it?'),
]){
 const r=await run(j,{topicCheck:null});
 assert.equal(r.finish?.tier,'high',j.messages.at(-1)!.text);
 assert.ok(r.judgeCalls.every(c=>c.checkedPath==='health'));
}
const divided=on('Where can I find the app settings?',{topic:{breakAfterSeq:1,startSeq:null,zoeOwns:false,profile:null}});
assert.equal((await run(divided,{env:{NOREON_ZOE_TOPIC_SCOPE:'off'}})).finish?.tier,'high','whole-window rollback keeps its original route');
for(const text of ['When will it go away?','How do I manage it?','What is causing it?']){
 const r=await run(on(text),{topicCheck:createFakeProvider()}); // The stand-in returns an explicit same-topic verdict.
 assert.equal(r.finish?.tier,'high',`${text}: same-topic clinical context keeps high`);
 assert.ok(r.providerCalls.find(c=>c.purpose==='health_answer')?.memberBlock.includes('knee'));
}
for(const [text,tier] of [['Where can I find the app settings?','low'],['What is a healthy breakfast?','medium']] as const){
 const j=on(text,{messages:[{seq:1,text:'My knee hurts after walking',minutesAgo:240},{seq:2,text,minutesAgo:1}],
  answers:[{body:'You can describe this here.',minutesAgo:239}]});
 assert.equal((await run(j)).finish?.tier,tier,'existing long-gap rule establishes independence inside 12 hours');
}
// The complete window still runs through the pre-model safety gates.
for(const text of ['I have chest pain right now','My blood pressure is 190/120 today']){
 const r=await run(on('Hello',{conversation:{...conversation,answeredThroughSeq:0},messages:[{seq:1,text,minutesAgo:2},{seq:2,text:'Hello',minutesAgo:1}]}));
 if(text.includes('chest')){
  assert.equal(r.providerCalls.length,0,'urgent history never reaches a model');
  assert.equal(r.judgeCalls.length,0);
 }else{
  assert.equal(r.reason,'bp_remeasure','the one BP check runs on the whole unanswered window');
  assert.equal(r.providerCalls.length,0,'a fixed line, no cheap chat route');
 }
}
assert.equal(freeSpeed({}).fast,false,'standard price by default');
assert.equal(freeSpeed({NOREON_ZOE_FREE_FAST:'true'}).fast,true,'explicit speed override still works');

// The existing Gateway cache option must stay on, including after request-size changes.
let cached=false;
const gateway=createGatewayProvider(DEFAULT_ROUTE_CONFIG.tiers.high!.model,{env:{NOREON_ZOE_MODEL_CALLS_ENABLED:'true'},generate:async a=>{
 cached=a.providerOptions?.gateway.caching==='auto';
 return {text:'{}',finishReason:'stop',usage:{inputTokens:1,outputTokens:1},response:{id:'synthetic',modelId:a.model}};
}});
await gateway.complete({purpose:'health_answer',promptVersion:'synthetic',system:'Stable rules',memberBlock:'Synthetic data',replyLanguage:'en',maxOutputTokens:10});
assert.equal(cached,true);

// A rejected reply may regenerate, but only the final exchange needs a doctor-summary call.
let answers=0;
const fake=createFakeProvider();
const regen={...fake,complete:async(req:ProviderRequest)=>{
 if(req.purpose==='health_answer'&&++answers===1)return fake.complete({...req,memberBlock:`${req.memberBlock} #zoe-fake:health_order`});
 return fake.complete(req);
}};
const retried=await run(on('My knee hurts again'),{provider:regen,routing:undefined});
assert.equal(retried.outcome,'answered');
assert.equal(retried.providerCalls.filter(c=>c.purpose==='health_answer').length,2);
assert.equal(retried.providerCalls.filter(c=>c.purpose==='health_summary').length,1,'superseded replies need no summary');

// A summary without a rationale needs the exchange and readings, not a second copy of the record.
const summaryOnly=await run(on('My knee hurts again',{memberRecord:{chatCards:false,ageYears:48,doses:null,ldl:null}}),{env:{NOREON_ZOE_WHY:'off'}});
const summaryRequest=summaryOnly.providerCalls.find(c=>c.purpose==='health_summary')!;
assert.equal(summaryRequest.maxOutputTokens,600,'English summary without rationale has its own limit');
assert.match(summaryRequest.memberBlock,/<member_messages>/);
assert.match(summaryRequest.memberBlock,/<zoe_reply/);
assert.doesNotMatch(summaryRequest.memberBlock,/member_record|health_summary|introduction_due|minimum_urgency|why_sources/);

// Judge failures continue to fail closed on the cheaper route.
const held=await run(on('What is a healthy breakfast?'),{judge:null});
assert.equal(held.outcome,'summary_only');
assert.equal(held.finish?.health?.forward,'auto');
assert.ok(createFakeJudge().local);
console.log('Zoe cost: routing, safety gates, caching, summary count and fail-closed checks passed.');
