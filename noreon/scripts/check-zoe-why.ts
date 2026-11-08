import assert from "node:assert/strict";
import {buildZoeWhy,readModelWhy,whyData,whyDataDoubts,whySourcesBlock,zoeWhyModelOn,zoeWhySchema,zoeWhySections,type WhyInput} from "@/lib/zoe/why";
import {HEALTH_SUMMARY_PROMPT,HEALTH_SUMMARY_WHY_PROMPT,type HealthData} from "@/lib/zoe/health-answer";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {createFakeProvider,type ProviderRequest,type ZoeProvider} from "@/lib/zoe/provider";
import {repairSummary,URGENT_SUMMARY_WAIT_MS} from "@/lib/zoe/pipeline";
import type {ZoeWhy} from "@/lib/zoe/why";

// Zoe's why record, the pure part: the record comes from the run, a fixed rule's record has no model in it, the model's rationale
// can only point at data the run had, and a bad rationale leaves a usable record that says it is missing. Fictional data.
const now=new Date("2026-10-30T10:00:00Z");
const health:HealthData={bpWeek:{count:6,avgSystolic:148,avgDiastolic:92,latest:{systolic:150,diastolic:95,daysAgo:1}},
 labs:[{marker:"LDL",value:3.4,unit:"mmol/L",low:null,high:2.6,daysAgo:5,reviewed:true},{marker:"HbA1c",value:6.1,unit:"%",low:null,high:5.7,daysAgo:2,reviewed:false}],plan:null};
const data=whyData({messages:[{seq:12},{seq:14}],health,profile:{conditions:["t2d"],bpDiagnosed:"treated",medicines:[],openAlerts:[],nextVisitInDays:null}},now);
const input=(extra:Partial<WhyInput>={}):WhyInput=>({at:now,outcome:"answered",reason:"health_answer_passed_guards",answer:"Fictional reply.",draft:null,receipt:null,language:"en",modelWords:true,
 health:{urgency:"doctor_soon",modelUrgency:"doctor_soon",forward:"none",forwardReason:"none"},toDoctor:false,
 events:[{name:"zoe.guard.urgent_match",outcome:"allow",reason:"no_staging_list_words",rule:"zoe.urgent_staging_placeholder",ruleVersion:"s1",attributes:{}},
  {name:"zoe.provider.call",outcome:"allow",reason:"completed",rule:"zoe.provider",ruleVersion:"p1",attributes:{}}],
 provider:"vercel.ai_gateway",model:"anthropic/claude-opus-5.5",tier:"high",fallbackUsed:false,config:"cfg",prompt:"zoe-free-mode-2.7:coach",data,doubts:whyDataDoubts(data,health),
 rationale:{asked:true,why:{signs:["Home average above 135/85"],data_used:["bp_week","lab1","invented_key"],doubts:["Not known whether readings were before tablets"],doctor:"Readings need a treatment decision."},model:"anthropic/claude-haiku-5.5",missing:null},...extra});

// Snapshot: values and dates, no references; dates come from daysAgo.
const bp=data.find(d=>d.key==="bp_week")!,lab2=data.find(d=>d.key==="lab2")!;
assert.equal(bp.date,"2026-10-29");assert.match(bp.value!,/150\/95/);
assert.equal(data.find(d=>d.key==="lab1")!.date,"2026-10-25");
assert.equal(lab2.reviewed,false);
assert.ok(data.every(d=>d.key!=="health_profile"||!/t2d/.test(d.value!)),"the profile's contents stay out");
assert.ok(whyDataDoubts(data,health).some(d=>d.includes("HbA1c")),"an unreviewed result is a doubt");
assert.ok(whyDataDoubts(data,health).includes("No published care plan."));
assert.deepEqual(whyDataDoubts([],undefined),[],"a run that loaded no data claims nothing about it");
assert.match(whySourcesBlock(data),/<source key="lab1">LDL 3\.4 mmol\/L<\/source>/);
assert.match(whySourcesBlock([{key:"x",source:"lab_result",date:null,value:"<b>",reviewed:null,relied:null}]),/&lt;b&gt;/,"sources are escaped");

// A model answer: every field in the brief is there, and it fits the stored shape.
const w=zoeWhySchema.parse(buildZoeWhy(input()));
assert.equal(w.decidedBy,"model");assert.equal(w.level.final,"doctor_soon");assert.equal(w.reply.words,"model");
assert.deepEqual(w.signs,[{text:"Home average above 135/85",from:"model"}]);
assert.ok(w.data.find(d=>d.key==="bp_week")!.relied===true&&w.data.find(d=>d.key==="lab2")!.relied===false,"relied marks only what the model cited");
assert.ok(!w.data.some(d=>d.key==="invented_key"),"a key the run did not have is dropped");
assert.ok(w.doubts.some(d=>d.from==="rule")&&w.doubts.some(d=>d.from==="model"));
assert.ok(w.doubts.some(d=>d.text.includes("staging list")),"the staging urgent list is named as a doubt");
assert.ok(w.rules.some(r=>r.rule==="zoe.urgent_staging_placeholder"&&r.version==="s1"),"rule and version");
assert.deepEqual([w.doctor.suggested,w.doctor.how,w.doctor.why],[false,"none","Readings need a treatment decision."]);
assert.equal(w.models.rationaleModel,"anthropic/claude-haiku-5.5");assert.equal(w.models.prompt,"zoe-free-mode-2.7:coach");assert.equal(w.rationale.status,"written");

// A fixed rule: comes from the code, says so, no model anywhere.
const rule=zoeWhySchema.parse(buildZoeWhy(input({outcome:"discarded",reason:"urgent_route_no_model_call",answer:"Fixed urgent text.",modelWords:false,health:null,provider:"none",model:"none",tier:"none",prompt:null,data:[],doubts:[],
 events:[{name:"zoe.guard.urgent_match",outcome:"escalate",reason:"urgent_words_matched_staging_list",rule:"zoe.urgent_staging_placeholder",ruleVersion:"s1",attributes:{"noreon.zoe.urgent.red_flags":"RF-01"}}],
 rationale:{asked:false,why:null,model:null,missing:null}})));
assert.equal(rule.decidedBy,"rule");assert.equal(rule.level.final,"emergency");assert.equal(rule.reply.words,"fixed");
assert.deepEqual(rule.signs,[{text:"RF-01 (zoe.urgent_staging_placeholder)",from:"rule"}]);
assert.equal(rule.doctor.how,"care_alert");assert.equal(rule.rationale.status,"not_asked");assert.equal(rule.models.rationaleModel,null);
assert.ok(rule.signs.concat(rule.doubts).every(s=>s.from==="rule"),"nothing in a fixed rule's record is the model's");

// A missing level is not "none".
assert.equal(buildZoeWhy(input({health:null,reason:"chat_passed_guards",outcome:"chatted"})).level.final,null);

// The rationale missing: the record is still whole and says why.
const gone=zoeWhySchema.parse(buildZoeWhy(input({rationale:{asked:true,why:null,model:null,missing:"summary_late"}})));
assert.deepEqual([gone.rationale.status,gone.rationale.missing],["missing","summary_late"]);
assert.ok(gone.data.every(d=>d.relied===null),"no rationale, no claim about what was relied on");
assert.ok(zoeWhySections(gone).find(s=>s.title==="AI rationale")!.lines[0]!.includes("summary late"));
// A text that was held and not sent: the rationale is about that text, and says so.
assert.equal(buildZoeWhy(input({answer:null,receipt:{text:"Careful line."},modelWords:false,outcome:"summary_only",reason:"health_answer_blocked_by_reply_check"})).rationale.aboutHeldText,true);

// Reading the model's output: one bad field never costs the summary, and never throws.
assert.deepEqual(readModelWhy('{"summary":{"asked":"x"},"why":{"signs":["a"],"data_used":["bp_week"],"doubts":[],"doctor":"d"}}')?.signs,["a"]);
assert.equal(readModelWhy('Here it is: {"summary":{"asked":"x"},"why":{"signs":["a"],"doctor":"d"}} done')?.doctor,"d");
assert.equal(readModelWhy('{"summary":{"asked":"x","why":{"signs":["a"],"doctor":"d"}}}')?.doctor,"d","inside the summary");
// The summary model closed its object early and went on: the rationale and the summary are both still read.
const early='{"summary":{"asked":"x","warning_signs":"not asked"},"questions_asked":null},"why":{"signs":["a } b"],"doctor":"d"}}';
assert.equal(readModelWhy(early)?.doctor,"d");assert.equal(repairSummary(early)?.asked,"x");
assert.equal(repairSummary(JSON.stringify({summary:{asked:"x",severity:"y".repeat(300)}}))?.severity?.length,120,"an over-long field is cut, not a lost summary");
for(const bad of['','not json','{"summary":{"asked":"x"}}','{"why":{"signs":"a","doctor":"d"}}','{"why":{"signs":["a"]}}','null','[]'])assert.equal(readModelWhy(bad),null,bad);
assert.equal(readModelWhy(JSON.stringify({why:{signs:Array(20).fill("s"),data_used:[],doubts:Array(20).fill("d"),doctor:"x".repeat(900)}}))!.doctor.length,300,"too long is cut, not failed");
assert.equal(readModelWhy(JSON.stringify({why:{signs:Array(20).fill("s"),doctor:"d"}}))!.signs.length,5);

// The whole record stays well under the database's limit at its largest.
const big=buildZoeWhy(input({data:Array.from({length:40},(_,i)=>({key:`lab${i}`,source:"lab_result" as const,date:"2026-10-01",value:"x".repeat(200),reviewed:true,relied:null})),doubts:Array(40).fill("y".repeat(300)),
 events:Array.from({length:80},(_,i)=>({name:"zoe.x",outcome:"escalate",reason:`r${i}`.padEnd(80,"z"),rule:"zoe.rule",ruleVersion:"v".repeat(80),attributes:{}})),config:"c".repeat(900)}));
assert.ok(zoeWhySchema.safeParse(big).success,"the largest record still fits the schema");
assert.ok(Buffer.byteLength(JSON.stringify(big))<32768,"the largest record fits the database limit");

// The sections say only what the record says, and every section the brief names is there.
const titles=zoeWhySections(w).map(s=>s.title);
for(const t of["Level","Signs that led to it","Member data, as it was then","Unknown or doubtful","Rules and versions","The doctor","Model and prompt"])assert.ok(titles.includes(t),t);
assert.ok(!JSON.stringify(zoeWhySections(w)).toLowerCase().includes("doctor's reasoning"),"never presented as a doctor's reasoning");

assert.equal(zoeWhyModelOn({}),true);assert.equal(zoeWhyModelOn({NOREON_ZOE_WHY:"off"}),false);

// The pipeline. A stand-in model whose summary call writes the rationale; everything else is the fake provider.
const convo=(extra={})=>({enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const,...extra});
const on=(text:string,extra={})=>job(text,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:convo(),intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},health,...extra});
const q="What does a blood pressure of 150/95 mean?";
const SUMMARY={asked:"Blood pressure question."};
const GOOD_WHY={signs:["Home average 148/92 above target"],data_used:["bp_week","lab9"],doubts:["Timing against tablets not known"],doctor:"Home readings can wait for the planned visit."};
const speaking=(raw:string|((n:number)=>string|Promise<string>)):ZoeProvider=>{const fake=createFakeProvider();let n=0;
 return {...fake,complete:async(req:ProviderRequest)=>{if(req.purpose!=="health_summary")return fake.complete(req);const t=typeof raw==="string"?raw:await raw(++n);return {kind:"ok",raw:t,finishReason:"stop",usage:{inputTokens:10,outputTokens:10},responseModel:"fake",responseId:"r1"};}};};
const ran=async(j:ReturnType<typeof on>,o:Parameters<typeof runPipeline>[1]={})=>{const records:ZoeWhy[]=[];const r=await runPipeline(j,{directAnswers:true,...o,why:{records,...o?.why}});return {...r,record:records[0]};};
const calls=(r:Awaited<ReturnType<typeof runPipeline>>,purpose:string)=>r.providerCalls.filter(c=>c.purpose===purpose);

// A model answer: the code's record with the summary call's rationale, valid for the store.
const good=await ran(on(q),{provider:speaking(JSON.stringify({summary:SUMMARY,why:GOOD_WHY}))});
assert.equal(good.outcome,"answered");const g=good.record!;zoeWhySchema.parse(g);
assert.equal(g.decidedBy,"model");assert.equal(g.rationale.status,"written");assert.equal(g.reply.words,"model");assert.equal(g.level.final,"planned");
assert.ok(g.signs.some(s=>s.from==="model"&&s.text.includes("148/92")));assert.equal(g.data.find(d=>d.key==="bp_week")!.relied,true);assert.ok(!g.data.some(d=>d.key==="lab9"),"a cited key the run did not have is dropped");
assert.ok(g.data.some(d=>d.key==="lab1"&&/LDL 3\.4/.test(d.value!)),"the member data is a snapshot of values");
assert.match(g.models.prompt!,/^zoe-free-mode-/);assert.ok(g.rules.some(r=>r.rule==="zoe.health_answer"));assert.ok(g.rules.some(r=>r.rule==="zoe.provider"),"events from before the reservation and after it are both there");
assert.ok(g.rules.some(r=>r.rule.startsWith("zoe.urgent")),"the urgent check before the reservation is on the record");
const sumCall=calls(good,"health_summary")[0]!;assert.equal(sumCall.system,HEALTH_SUMMARY_WHY_PROMPT);assert.match(sumCall.memberBlock,/<why_sources>[\s\S]*key="bp_week"/);assert.ok(!/Richard|Smith|Hakobyan/.test(sumCall.memberBlock),"no names reach the summary model");
assert.match(good.finish!.summary!,/^Asked: Blood pressure question\./,"the doctor's summary reads as before");assert.ok(!JSON.stringify(good.finish).includes("148/92 above target"),"the rationale is nowhere in what the run finished with");

// The reply and the judge cannot tell whether the why is on: same prompts, same input.
const off=await ran(on(q),{env:{NOREON_ZOE_WHY:"off"}}),onn=await ran(on(q));
assert.deepEqual(calls(onn,"health_answer").map(c=>[c.system,c.memberBlock,c.maxOutputTokens]),calls(off,"health_answer").map(c=>[c.system,c.memberBlock,c.maxOutputTokens]),"the reply call is byte-identical");
assert.deepEqual(onn.judgeCalls.map(c=>[c.system,c.memberBlock]),off.judgeCalls.map(c=>[c.system,c.memberBlock]),"the judge call is byte-identical");
const offSum=calls(off,"health_summary")[0]!;assert.equal(offSum.system,HEALTH_SUMMARY_PROMPT);assert.ok(!offSum.memberBlock.includes("why_sources"));assert.equal(offSum.promptVersion,off.events.find(e=>e.name==="zoe.health_answer.urgency")!.ruleVersion);
assert.equal(off.record!.rationale.status,"not_asked","off: the code's record stays, no rationale asked for");assert.equal(off.record!.reply.words,"model");
assert.equal(onn.finish!.answer,off.finish!.answer);

// A fixed rule: comes from the code, no model call at all.
const fixed=await ran(on("I have crushing chest pain right now"),{env:{NOREON_ZOE_URGENT_PLACEHOLDER:"true"}});
assert.equal(fixed.providerCalls.length,0,"no model call");const rr=fixed.record!;zoeWhySchema.parse(rr);
assert.equal(rr.decidedBy,"rule");assert.equal(rr.level.final,"emergency");assert.equal(rr.reply.words,"fixed");assert.equal(rr.rationale.status,"not_asked");assert.equal(rr.models.prompt,null);assert.ok(rr.signs.length>0&&rr.signs.every(s=>s.from==="rule"));

// A save that fails, refuses or throws changes nothing about the run.
for(const fail of ["refuse","throw"] as const){const r=await ran(on(q),{why:{records:[],fail}});assert.equal(r.outcome,"answered",fail);assert.equal(r.finish!.answer,onn.finish!.answer,fail);assert.equal(r.record,undefined,fail);}

// A rationale that goes wrong never costs the answer or the summary, and the record says why.
const asks:[string,string,string][]=[["no why in the output",JSON.stringify({summary:SUMMARY}),"not_in_output"],["a malformed why",JSON.stringify({summary:SUMMARY,why:{signs:"x"}}),"not_in_output"]];
for(const [name,raw,missing] of asks){const r=await ran(on(q),{provider:speaking(raw)});assert.equal(r.outcome,"answered",name);assert.equal(r.record!.rationale.status,"missing",name);assert.equal(r.record!.rationale.missing,missing,name);assert.match(r.finish!.summary!,/^Asked: Blood pressure question\./,name);assert.equal(r.record!.data.find(d=>d.key==="bp_week")!.relied,null,name);}
{const r=await ran(on(`${q} #zoe-fake:summary_fail`));assert.equal(r.outcome,"answered");assert.equal(r.record!.rationale.missing,"summary_failed");}
{const r=await ran(on(`${q} #zoe-fake:health_emergency`),{provider:speaking(()=>new Promise(res=>setTimeout(()=>res("{}"),URGENT_SUMMARY_WAIT_MS+1500)))});
 assert.equal(r.record!.level.final,"emergency");assert.equal(r.record!.rationale.status,"missing");assert.equal(r.record!.rationale.missing,"summary_late","a model emergency does not wait for the rationale");assert.equal(r.record!.reply.words,"fixed");}

// One call mode has no summary call, so no rationale: the record says it was not asked for.
{const r=await ran(on(q),{env:{NOREON_ZOE_FREE_SPLIT:"false"}});assert.equal(r.outcome,"answered");assert.equal(r.record!.rationale.status,"not_asked");assert.equal(r.record!.reply.words,"model");}

// Redacted like the rest of the run; a rationale the summary guard would block is not kept.
{const r=await ran(on(q),{provider:speaking(JSON.stringify({summary:SUMMARY,why:{...GOOD_WHY,signs:["Richard Smith said 150/95, call +374 91 234567"]}}))});
 assert.equal(r.record!.rationale.status,"written");const t=JSON.stringify(r.record);assert.ok(!/Richard|Smith|234567/.test(t),"names and contacts are gone");assert.match(t,/150\/95/);}

{const r=await ran(on(q),{provider:speaking(JSON.stringify({summary:SUMMARY,why:{...GOOD_WHY,doctor:"The doctor will reply within an hour."}}))});
 assert.equal(r.outcome,"answered");assert.equal(r.record!.rationale.missing,"guard_blocked");assert.ok(!JSON.stringify(r.record).includes("within an hour"));}

// Held, then the careful line: the rationale was written about a text the member never saw, and says so.
{const r=await ran(on(`${q} #zoe-fake:dose`),{provider:speaking(JSON.stringify({summary:SUMMARY,why:GOOD_WHY}))});
 assert.equal(r.outcome,"summary_only");assert.equal(r.record!.rationale.aboutHeldText,true);assert.equal(r.record!.reply.kind,"line");}
// A regenerated reply has its own rationale: only the newest summary call's counts, whichever call returned last.
{const r=await ran(on(`${q} #zoe-fake:dose`),{provider:speaking(async n=>{if(n===1)await new Promise(res=>setTimeout(res,50));return JSON.stringify({summary:SUMMARY,why:{...GOOD_WHY,doctor:`Call ${n}.`}});})});
 const n=calls(r,"health_summary").length;assert.ok(n>=1);assert.equal(r.record!.doctor.why,`Call ${n}.`);}
// The doctor: a summary route says so, an unforwarded answer does not (Astra WHY-01).
{const r=await ran(job(q,{directAnswers:true}),{fixture:"no_draft"});assert.equal(r.outcome,"summary_only");assert.deepEqual([r.record!.doctor.suggested,r.record!.doctor.how],[true,"summary"]);
 const b=await ran(job(q,{directAnswers:true}),{fixture:"dose"});assert.equal(b.outcome,"draft_blocked");assert.deepEqual([b.record!.doctor.suggested,b.record!.doctor.how],[true,"summary"]);
 assert.deepEqual([g.doctor.suggested,g.doctor.how],[false,"none"],"an answered turn nobody forwarded");}
// A reply that ends with Zoe's own question gets no ask line: the rationale and the record carry that final decision (Astra WHY-02).
{const fake=createFakeProvider();const asks:ZoeProvider={...fake,complete:async(req:ProviderRequest)=>{
  if(req.purpose==="health_answer"){const raw=JSON.stringify({reply:"When did this start, and has it changed?",urgency:"doctor_soon",forward:"ask",forward_reason:"treatment_decision",summary:"x",language:"en"});return {kind:"ok",raw,finishReason:"stop",usage:{inputTokens:10,outputTokens:10},responseModel:"fake",responseId:"r2"};}
  return speaking(JSON.stringify({summary:SUMMARY,why:GOOD_WHY})).complete(req);}};
 const r=await ran(on(q),{provider:asks});assert.equal(r.outcome,"answered");assert.match(calls(r,"health_summary")[0]!.memberBlock,/<zoe_reply urgency="doctor_soon" forward="none">/);
 assert.deepEqual([r.record!.doctor.suggested,r.record!.doctor.how],[false,"none"]);assert.equal(r.finish!.health!.forwardReason,"zoe_question");assert.match(r.finish!.summary!,/Doctor: /u);}
console.log("Zoe why record checks passed.");
