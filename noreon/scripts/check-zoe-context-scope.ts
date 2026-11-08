import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {createFakeProvider,type ProviderRequest,type ZoeProvider} from "@/lib/zoe/provider";
import {TOPIC_SCOPE_RULE} from "@/lib/zoe/health-answer";
import {healthSummaryBlock,parseTopicCheck,timeline,topicRules,topicTurns,TOPIC_MAX_GAP_MIN,type HealthProfile} from "@/lib/zoe/topic";
import {canStartNewQuestion,chatItems} from "@/lib/zoe/app-chat-contracts";
import type {ZoeJob} from "@/lib/zoe/pipeline";

/**
 * SYNTHETIC checks for Zoe's topic scope and the per-topic doctor takeover (Armen and Khikar, 20 Oct; 20261021070207), no
 * model or network: stand-in speaker and a scripted topic check. The database side (dividers, the finish guard, the
 * settings) is in check-zoe-context-scope.sql.
 */
const env={NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false"};
const ctx={enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const};
const intakeOn={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
const DAY=24*60;

/** A scripted topic check: answers with `verdict` (or fails) and records what it was asked. */
function check(verdict:{topic:string;doctor_matter?:string}|"error"|"garbage"){
 const asked:ProviderRequest[]=[];
 const p:ZoeProvider={providerName:"noreon.fake",requestModel:"topic-check-stand-in",region:"local",local:true,pricing:{inputUsdPerMTok:0.1,outputUsdPerMTok:0.5,label:"test"},
  async complete(r){asked.push(r);
   if(verdict==="error")return {kind:"error",errorClass:"timeout",usage:null};
   const raw=verdict==="garbage"?"I think it is the same topic.":JSON.stringify({doctor_matter:"unsure",...verdict});
   return {kind:"ok",raw,finishReason:"stop",usage:{inputTokens:200,outputTokens:12},responseModel:"topic-check-stand-in",responseId:"t1"};}};
 return {p,asked};
}
// A conversation: earlier turns (member, Zoe, doctor) at minutes ago, then the newest message one minute ago.
type T={who:"member"|"zoe"|"doctor";text:string;ago:number};
function convo(earlier:T[],newest:string,extra:Partial<ZoeJob>={}):ZoeJob{
 const members=earlier.filter(t=>t.who==="member");
 const messages=[...members.map((t,i)=>({seq:i+1,text:t.text,minutesAgo:t.ago})),{seq:members.length+1,text:newest,minutesAgo:1}];
 return job(newest,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:{...ctx,answeredThroughSeq:members.length},intake:intakeOn,
  messageSeq:messages.length,messages,answers:earlier.filter(t=>t.who==="zoe").map(t=>({body:t.text,minutesAgo:t.ago})),replies:earlier.filter(t=>t.who==="doctor").map(t=>({body:t.text,minutesAgo:t.ago})),...extra});
}
const healthCall=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.providerCalls.find(c=>c.purpose==="health_answer");
const run=(j:ZoeJob,tc?:ZoeProvider|null,e:Record<string,string>={})=>runPipeline(j,{directAnswers:true,env:{...env,...e},...(tc!==undefined?{topicCheck:tc}:{})});

const platelets=(ago:number):T[]=>[{who:"member",text:"My platelets came back at 140, is that low?",ago},{who:"zoe",text:"A platelet count of 140 is slightly below the usual range. Your doctor will look at it.",ago:ago-1}];
const breakfast="What is a good breakfast for my blood pressure?";

// 1. The rules ---------------------------------------------------------------------------------------------------------------
{
 const t=(earlier:T[])=>timeline({messages:earlier.filter(x=>x.who==="member").map((x,i)=>({seq:i+1,text:x.text,minutesAgo:x.ago})),answers:earlier.filter(x=>x.who==="zoe").map(x=>({body:x.text,minutesAgo:x.ago})),replies:[]});
 const rule=(earlier:T[],newest:string,o:{breakAfterSeq?:number|null}={})=>{const turns=t(earlier);return topicRules({text:newest,minutesAgo:1},turns,{breakAfterSeq:o.breakAfterSeq??null,prevMemberSeq:[...turns].reverse().find(x=>x.who==="member")?.seq??null});};
 const decided=(r:ReturnType<typeof rule>)=>"decided" in r?r.decided.topic:`ask:${r.fallback}`;
 assert.equal(decided(rule([],breakfast)),"new","nothing earlier: new");
 assert.equal(decided(rule(platelets(6),breakfast)),"ask:same","5 minutes later, a question of its own: the check (Astra ZCS-01)");
 assert.equal(decided(rule(platelets(6),"Ok, 145 this time")),"same","5 minutes later, a reading: same (rules, no check)");
 assert.equal(decided(rule(platelets(6),"Is coffee healthy?")),"ask:same","a short question of its own: the check");
 assert.equal(decided(rule(platelets(6),"Back to the platelets I mentioned earlier, should I retest?")),"ask:refers_back","a pointer back within minutes: the check, else the whole window");
 assert.equal(decided(rule(platelets(61),breakfast)),"ask:same","an hour later: the check decides; failing that, the turns stay");
 assert.equal(decided(rule(platelets(DAY),breakfast)),"new","a day later: new (rules)");
 assert.equal(decided(rule(platelets(5*DAY),breakfast)),"new","5 days later: new (rules)");
 assert.equal(decided(rule(platelets(DAY),"About the platelets you mentioned yesterday, should I retest?")),"ask:refers_back","a day later, pointing back: the check, else the turns come back");
 assert.equal(decided(rule(platelets(6),breakfast,{breakAfterSeq:1})),"new","the member's divider: new");
 assert.equal(decided(rule(platelets(6),"Another question: can I drink coffee?")),"new","the member says it is another question");
 assert.equal(decided(rule([{who:"member",text:"My BP is 150/95",ago:400},{who:"zoe",text:"When did you measure it?",ago:399}],"In the morning")),"same","a short answer to Zoe's question, hours later");
 assert.equal(decided(rule([{who:"member",text:"Ճնշումս 150/95 է",ago:DAY}],"Երեկվա ճնշման մասին եմ հարցնում, նորից չափեմ?")),"ask:refers_back","Armenian reference back");
 assert.equal(decided(rule([{who:"member",text:"Давление 150/95",ago:DAY}],"Другой вопрос: можно ли кофе?")),"new","Russian: another question");
 // The current topic's turns.
 const turns=t([{who:"member",text:"old",ago:600},{who:"member",text:"a",ago:30},{who:"zoe",text:"b",ago:29},{who:"member",text:"c",ago:5}]);
 assert.deepEqual(topicTurns(turns,1,"same",null).map(x=>x.text),["a","b","c"],"same: back to the first long gap");
 assert.deepEqual(topicTurns(turns,1,"same",3).map(x=>x.text),["c"],"same: from the recorded topic start");
 assert.deepEqual(topicTurns(turns,1,"new",null),[],"new: none");
 assert.equal(topicTurns(turns,1,"refers_back",null).length,4,"refers back: the whole window");
 assert.ok(TOPIC_MAX_GAP_MIN<=240,"a few hours at most");
 assert.deepEqual(parseTopicCheck('Sure: {"topic":"new","doctor_matter":"no"}'),{topic:"new",doctor_matter:"no"});
 assert.equal(parseTopicCheck("same"),null);
}

// 2. Leakage: an unrelated topic 1 hour, 1 day and 5 days earlier, then a new question ---------------------------------------
for(const ago of [61,DAY,5*DAY]){
 const tc=check({topic:"new"});
 const r=await run(convo(platelets(ago),breakfast),tc.p);
 assert.equal(r.outcome,"answered",`leak ${ago}: answered`);
 const call=healthCall(r)!;
 assert.ok(!/platelet/i.test(call.memberBlock),`leak ${ago}: the old topic is not in the model's input`);
 assert.ok(call.memberBlock.includes(breakfast),`leak ${ago}: the newest message is`);
 assert.ok(call.memberBlock.includes("<health_summary>"),`leak ${ago}: the health summary is`);
 assert.ok(call.system.includes(TOPIC_SCOPE_RULE),`leak ${ago}: the prompt says to answer the newest message only`);
 assert.equal(r.finish!.topic?.topic,"new");assert.equal(r.finish!.topic?.owner,"zoe");assert.equal(r.finish!.topic?.startSeq,2);
 assert.equal(tc.asked.length,ago===61?1:0,`leak ${ago}: the check only where the rules cannot tell`);
}
// Before (NOREON_ZOE_TOPIC_SCOPE=off): the whole window, as on main.
{const r=await run(convo(platelets(DAY),breakfast),null,{NOREON_ZOE_TOPIC_SCOPE:"off"});
 assert.ok(/platelet/i.test(healthCall(r)!.memberBlock),"scope off: the old topic is in");assert.ok(!healthCall(r)!.system.includes(TOPIC_SCOPE_RULE),"scope off: the prompt as before");}

// 3. Carry-over ---------------------------------------------------------------------------------------------------------------
{const tc=check({topic:"new"});const r=await run(convo(platelets(6),"It was measured this morning"),tc.p);
 assert.ok(/platelet/i.test(healthCall(r)!.memberBlock),"a reply minutes later: the turns stay (rules, no check)");assert.equal(tc.asked.length,0);}
{const tc=check({topic:"new"});const r=await run(convo(platelets(6),"Ok"),tc.p);
 assert.equal(r.outcome,"chatted","a closed acknowledgement uses the short chat path");
 assert.equal(r.judgeCalls.length,1,"the acknowledgement is checked");assert.equal(tc.asked.length,0);}
// Astra ZCS-01: a question of its own five minutes after another topic is checked and leaves the old topic out ...
{const tc=check({topic:"new"});const r=await run(convo(platelets(6),breakfast),tc.p);
 assert.ok(!/platelet/i.test(healthCall(r)!.memberBlock),"breakfast five minutes after platelets: no platelets");assert.equal(tc.asked.length,1);}
// Round 2: a short question of its own, and a question without "?" right after Zoe asked something, are checked too.
for(const [earlier,q] of [[platelets(6),"Is coffee healthy?"],[[{who:"member" as const,text:"My platelets came back at 140",ago:7},{who:"zoe" as const,text:"Thank you. Did your doctor order the test?",ago:6}],"What is a healthy breakfast"]] as const){
 const tc=check({topic:"new"});const r=await run(convo([...earlier],q),tc.p);
 assert.ok(!healthCall(r)!.memberBlock.includes("140"),`${q}: no platelets`);assert.equal(tc.asked.length,1,`${q}: checked`);}
// Safety carries over (G2 S020): a same-day matter minutes ago is never scoped away, even when the check says "new".
for(const [earlier,label] of [[[{who:"member" as const,text:"My triglycerides are 11.4. I feel fine. Should I do anything?",ago:4},{who:"zoe" as const,text:"This needs a doctor today, within the next 2 to 4 hours.",ago:3}],"a same-day reading"],
 [[{who:"member" as const,text:"I get headaches in the evenings lately",ago:9},{who:"zoe" as const,text:"If a sudden, very severe headache comes with weakness or trouble speaking, call 103.",ago:8}],"Zoe's 103 advice"]] as const){
 const r=await run(convo([...earlier],"Which symptoms mean I should go at once?"),check({topic:"new"}).p);
 assert.ok(healthCall(r)!.memberBlock.includes(earlier[0].text.slice(0,20)),`${label}: kept although the check said new`);
 assert.equal(r.events.find(e=>e.name==="zoe.topic")?.attributes["noreon.zoe.topic.safety_carry"],true,`${label}: traced`);}
// ... and a pointer back after another topic brings the earlier one back.
{const r=await run(convo([...platelets(60),{who:"member",text:breakfast,ago:6},{who:"zoe",text:"Oats with fruit and no added salt.",ago:5}],"Back to the platelets I mentioned earlier, should I retest?"),check({topic:"refers_back"}).p);
 assert.ok(healthCall(r)!.memberBlock.includes("140"),"a pointer back: the platelet value is back");}
// Astra ZCS-02: a short answer five hours (and 23 hours) later keeps the question and the reading it answers.
for(const ago of [300,23*60]){const r=await run(convo([{who:"member",text:"My blood pressure was 148/94 this morning",ago:ago+1},{who:"zoe",text:"Thank you. Was it before or after your morning tablets?",ago}],"Before"),check("error").p);
 const b=healthCall(r)!.memberBlock;assert.ok(b.includes("148/94")&&b.includes("morning tablets"),`a short answer ${ago} minutes later: the question and the reading reach the model`);}
// A "same" from the check a day later keeps the exchange it continues.
{const r=await run(convo(platelets(DAY),"I asked about my test yesterday, should I repeat it?"),check({topic:"same"}).p);
 assert.ok(healthCall(r)!.memberBlock.includes("140"),"same topic a day later (the check): the exchange is kept");}
{const tc=check({topic:"same"});const r=await run(convo(platelets(90),"And should I retest it?"),tc.p);
 assert.ok(/platelet/i.test(healthCall(r)!.memberBlock),"an hour and a half later, same topic by the check: the turns stay");assert.equal(tc.asked.length,1);}
{const tc=check({topic:"refers_back"});const r=await run(convo(platelets(2*DAY),"About the platelets you mentioned before, should I retest?"),tc.p);
 assert.ok(/platelet/i.test(healthCall(r)!.memberBlock),"a reference back two days later: the turns come back");assert.equal(r.finish!.topic?.topic,"refers_back");}
{const r=await run(convo(platelets(90),"And should I retest it?"),check("error").p);
 assert.ok(/platelet/i.test(healthCall(r)!.memberBlock),"check failed: the turns stay (as before)");assert.equal(r.finish!.topic?.source,"check_failed");}
// An open red flag in an earlier message still escalates, whatever the topic (red flags read the whole window first).
// (Since #377 only messages Zoe has not answered are re-read: this one never got an answer.)
{const r=await run(convo([{who:"member",text:"My face is drooping and my arm is numb",ago:DAY}],breakfast,{conversation:{...ctx,answeredThroughSeq:0}}),check({topic:"new"}).p);
 assert.ok(r.outcome==="intake_escalated"||/^urgent_/u.test(r.reason),`an earlier danger sign: the 103 text, before any topic step (${r.reason})`);
 assert.equal(healthCall(r),undefined,"no model");assert.ok(r.finish!.answer,"a text for the member");}
// The 103 window carries over a new topic.
{const r=await run(convo(platelets(DAY),breakfast,{urgentSinceMinutes:20}),check({topic:"new"}).p);
 assert.equal(r.reason,"urgent_in_window_no_model_call","the 103 window: still the 103 text");}
// The member's cap: no model call, whatever the topic.
{const r=await run(convo(platelets(DAY),breakfast,{conversation:{...ctx,memberSpentTodayUsd:99}}),check({topic:"new"}).p);
 assert.equal(healthCall(r),undefined,"cap reached: no model");}

// 4. Per-topic doctor takeover --------------------------------------------------------------------------------------------
const matter={reply:"Your platelets of 140 are slightly low. Please repeat the blood count in two weeks.",minutesAgo:120,messages:[{text:"My platelets came back at 140, is that low?",minutesAgo:130}]};
const dm=(extra:Partial<ZoeJob>={}):Partial<ZoeJob>=>({doctorMode:true,doctorScope:"topic",doctorMatter:matter,...extra});
const afterDoctor:T[]=[...platelets(130),{who:"doctor",text:matter.reply,ago:120}];
{const tc=check({topic:"new",doctor_matter:"no"});const r=await run(convo(afterDoctor,breakfast,dm()),tc.p);
 assert.equal(r.outcome,"answered","doctor mode, unrelated new question: Zoe answers");
 assert.equal(r.finish!.topic?.owner,"zoe");assert.equal(r.finish!.topic?.doctorTopic,"no");
 assert.ok(!/platelet/i.test(healthCall(r)!.memberBlock),"Zoe's answer does not carry the doctor's matter");
 assert.ok(tc.asked[0]!.memberBlock.includes("<doctor_matter>"),"the check sees the doctor's matter");}
for(const [v,label] of [[{topic:"same",doctor_matter:"yes"},"a follow-up on the doctor's matter"],[{topic:"same",doctor_matter:"unsure"},"unsure on the same topic"],[{topic:"new",doctor_matter:"unsure"},"unsure on a new topic"],[{topic:"refers_back",doctor_matter:"no"},"a reference back"],["error","check failed"],["garbage","check unreadable"]] as const){
 const r=await run(convo(afterDoctor,"Should I repeat the test sooner?",dm()),check(v).p);
 // The doctor's own topic waits for the doctor unless the check clearly says it is not theirs; only a new topic or a clear "no" goes to Zoe.
 if(typeof v!=='object'||v.doctor_matter==='yes'||v.doctor_matter==='unsure'&&v.topic==='same'){
  assert.equal(r.reason,"doctor_mode",`doctor mode, ${label}: waits for the doctor`);assert.equal(r.finish!.answer,null);assert.equal(r.finish!.receipt,null,`${label}: no receipt`);
  assert.equal(healthCall(r),undefined,`${label}: no answer call`);assert.equal(r.finish!.topic?.owner,"doctor");
 }else{
  assert.equal(r.outcome,"answered",`${label}: Zoe answers a new topic or a clear no`);
  assert.ok(healthCall(r),`${label}: guarded health-answer call`);assert.equal(r.finish!.topic?.owner,"zoe");
 }
}
// Zoe keeps her follow-up unless the check positively identifies the doctor's matter.
{const r=await run(convo([...afterDoctor,{who:"member",text:breakfast,ago:10},{who:"zoe",text:"Oats with fruit and no added salt.",ago:9}],"And can I add honey?",dm({topic:{breakAfterSeq:null,startSeq:2,zoeOwns:true,profile:null}})),check({topic:"same",doctor_matter:"no"}).p);
 assert.equal(r.outcome,"answered","Zoe's own topic since the doctor's reply: Zoe answers the follow-up");
 assert.ok(healthCall(r)!.memberBlock.includes("Oats"),"with her topic's turns");assert.ok(!/platelet/i.test(healthCall(r)!.memberBlock),"not the doctor's");}
{const r=await run(convo(afterDoctor,"And can I add honey?",dm({topic:{breakAfterSeq:null,startSeq:1,zoeOwns:false,profile:null}})),check({topic:"same",doctor_matter:"no"}).p);
 assert.equal(r.outcome,"answered","same topic with a negative doctor-matter check: Zoe answers");assert.ok(healthCall(r));assert.equal(r.finish!.topic?.owner,"zoe");}
// The divider counts as a new topic; the check still has to clear the doctor's matter.
{const r=await run(convo(afterDoctor,breakfast,dm({topic:{breakAfterSeq:1,startSeq:null,zoeOwns:false,profile:null}})),check({topic:"same",doctor_matter:"no"}).p);
 assert.equal(r.outcome,"answered","divider plus not the doctor's matter: Zoe");}
// The whole-conversation setting, a missing matter, an intake or a limit: as before (no model at all).
for(const [extra,label] of [[{doctorScope:"conversation" as const},"scope conversation"],[{doctorMatter:null},"no matter"],[{conversation:{...ctx,memberSpentTodayUsd:99}},"member cap"]] as const){
 const tc=check({topic:"new",doctor_matter:"no"});const r=await run(convo(afterDoctor,breakfast,dm(extra as Partial<ZoeJob>)),tc.p);
 assert.equal(r.reason,"doctor_mode",`${label}: held`);assert.equal(r.providerCalls.length,0,`${label}: no model`);assert.equal(tc.asked.length,0,`${label}: no check`);
}
// Urgent and crisis texts are unchanged in doctor mode with the topic scope.
{const r=await run(convo(afterDoctor,"I have crushing chest pain right now",dm()),check({topic:"new",doctor_matter:"no"}).p);
 assert.equal(r.reason,"urgent_route_no_model_call","doctor mode, topic scope: urgent unchanged");}
{const r=await run(convo(afterDoctor,"I want to kill myself",dm()),check({topic:"new",doctor_matter:"no"}).p);
 assert.equal(r.finish!.health?.forwardReason,"self_harm","doctor mode, topic scope: crisis unchanged");}
// A worker that did not know about doctor mode never claims the doctor's verdict (the database lets through only "no").
{const r=await run(convo(afterDoctor,breakfast),check({topic:"new"}).p);assert.equal(r.finish!.topic?.doctorTopic,null);}

// 5. The health summary -------------------------------------------------------------------------------------------------------
{const p:HealthProfile={conditions:["diabetes","kidney"],bpDiagnosed:"treated",medicines:[{name:"Amlodipine <b>",dose:"5 mg",times:["08:00"],sinceDays:30}],openAlerts:[{daysAgo:2,urgent:true}],nextVisitInDays:5};
 const b=healthSummaryBlock(p);
 assert.ok(b.includes("diabetes")&&b.includes("chronic kidney disease")&&b.includes("high blood pressure (takes medicines for it)"));
 assert.ok(b.includes("Amlodipine &lt;b&gt; 5 mg at 08:00"),"member text escaped");assert.ok(b.includes("Open care-team alerts")&&b.includes("in 5 days"));
 assert.equal(healthSummaryBlock(null),"<health_summary>Not available.</health_summary>");}

// 6. The member's chat: the divider -----------------------------------------------------------------------------------------
{const at=(m:number)=>new Date(Date.UTC(2026,9,20,10,m)).toISOString();
 const thread={messages:[{seq:1,text:"a",at:at(0),channel:"app" as const,requestId:null},{seq:2,text:"b",at:at(5),channel:"app" as const,requestId:null}],
  replies:[],answers:[{id:"00000000-0000-4000-8000-000000000001",text:"z",at:at(1)}],ack:null,settledSeq:2,breaks:[{afterSeq:1,at:at(3)}]};
 const kinds=chatItems(thread,Date.parse(at(30))).map(i=>i.kind);
 assert.deepEqual(kinds,["member","answer","divider","member","ack"],"divider before the new question");
 const end=chatItems({...thread,breaks:[{afterSeq:2,at:at(6)}]},Date.parse(at(30)));
 assert.equal(end.at(-1)?.kind,"divider","a divider waiting for the new question is last");assert.equal(canStartNewQuestion(end),false,"no second divider");
 assert.equal(canStartNewQuestion(chatItems(thread,Date.parse(at(30)))),true);
 assert.equal(canStartNewQuestion([]),false,"nothing to divide");}

// The stand-in topic check keeps the turns (the safe side).
{const fake=createFakeProvider();const r=await fake.complete({purpose:"topic_check",promptVersion:"t",system:"",memberBlock:"",replyLanguage:"en",maxOutputTokens:60});
 assert.ok(r.kind==="ok"&&parseTopicCheck(r.raw)?.topic==="same"&&parseTopicCheck(r.raw)?.doctor_matter==="unsure");}
console.log("Zoe topic scope and per-topic doctor takeover checks passed.");
