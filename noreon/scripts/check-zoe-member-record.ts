import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {asksForHeldData,memberRecordBlock,memberRecordFrom,memberRecordRowSchema,memberRecordSchema,zoeLdlTargetOn,type MemberRecord} from "@/lib/zoe/member-record";
import {createFakeProvider,type ProviderRequest,type ZoeProvider} from "@/lib/zoe/provider";
import {LOGGING_LINE,plainLoggingRequest} from "@/lib/zoe/logging-request";
import {cardIntent} from "@/lib/zoe-chat-actions/intent";
import {CHAT_LOG_RULE,type HealthData} from "@/lib/zoe/health-answer";
import {whyData,zoeWhySchema} from "@/lib/zoe/why";
import {UNKNOWN} from "@/lib/clinical/types";

// What the record already holds, in Zoe's context. Fictional data, stand-in models.
const base={runId:"7b0f8a64-3d8e-4f4b-9c55-3a6b7c9d1e20",enabled:true,today:"2026-10-30",ageYears:58,medicines:null,ldl:null};
const obs=(id:string,value:number,on:string,source:string,name:string|null="LDL-C")=>({id,value,unit:"mmol/L",on,source,name,memberVisible:true});
const fullLdl={goal:{thresholdMmol:1.4,setOn:"2026-10-01"},observations:[obs("a",3.1,"2026-08-01","clinic_result"),obs("b",2.4,"2026-10-18","clinic_reviewed")],
 event:{type:"acs_mi",other:null,on:"2026-07-01"},therapies:[{drug:"atorvastatin",other:null,dose:"40 mg",startedOn:"2026-07-03"},{drug:"other",other:"Fictional-statin",dose:"5 mg",startedOn:null}],nextTestOn:"2026-11-19"};
const row=(extra={})=>memberRecordRowSchema.parse({...base,...extra});
const clean=(t:string)=>t;
const full=memberRecordFrom(row({ldl:fullLdl}));memberRecordSchema.parse(full);
assert.deepEqual(full.ldl!.latest,{mmol:2.4,daysAgo:12},"the newest reviewed value");assert.equal(full.ldl!.nextTestInDays,20);assert.equal(full.ldl!.event!.daysAgo,121);
assert.deepEqual(full.ldl!.therapies.map(t=>t.name),["atorvastatin","Fictional-statin"]);

// The goal number stays out until the switch; a goal that is not set says so.
const off=memberRecordBlock(full,{target:false,clean}),on=memberRecordBlock(full,{target:true,clean});
assert.ok(!/1\.4/.test(off),"no goal number by default");assert.match(off,/set by the doctor; the member sees it on their goal card, and you do not have the number/);assert.match(on,/below 1\.4 mmol\/L/);
assert.equal(zoeLdlTargetOn({}),false);assert.equal(zoeLdlTargetOn({NOREON_ZOE_LDL_TARGET:"on"}),true);
assert.match(off,/Latest LDL reviewed or released by the doctor: 2\.4 mmol\/L, 12 days ago\./);assert.match(off,/Heart event: heart attack or acute coronary syndrome, 121 days ago\./);assert.match(off,/atorvastatin 40 mg, started 119 days ago; Fictional-statin 5 mg, start date not known/);assert.match(off,/Next LDL test: in 20 days\./);

// Where the member stands: counts and a section's name from the app's own rules, never an answer. A row from the older function has none of it.
{const age={fieldId:"q1.age",value:77,answeredAt:"2026-10-01T10:00:00Z"};
 const partly=memberRecordFrom(row({questionnaire:{completed:false,answers:{"q1.age":age,"q6.conditions":{fieldId:"q6.conditions",value:UNKNOWN,answeredAt:"2026-10-01T10:00:00Z"}}},nextVisit:null}));memberRecordSchema.parse(partly);
 const q=partly.status!.questionnaire!;assert.equal(q.complete,false);assert.equal(q.sections,10);assert.ok(q.missing&&q.sectionsDone<10);
 const b=memberRecordBlock(partly,{target:false,clean});assert.match(b,new RegExp(`Health questionnaire: not finished, ${q.sectionsDone} of 10 sections done, next open section: `));assert.match(b,/Next booked appointment: none booked yet\./);assert.ok(!/77/.test(b),"no answer in the block");
 const booked=memberRecordFrom(row({questionnaire:{completed:false,answers:{}},nextVisit:{at:"2026-11-05 10:30"}}));assert.match(memberRecordBlock(booked,{target:false,clean}),/Next booked appointment: 5 November 2026 at 10:30, Yerevan time\./);
 assert.equal(memberRecordFrom(row()).status,null,"the older function: nothing, so the member's input does not change");assert.equal(memberRecordBlock(memberRecordFrom(row()),{target:false,clean}).includes("questionnaire"),false);
 memberRecordFrom(row({questionnaire:{completed:true,answers:{"q1.age":null}}}));
 const none=memberRecordFrom(row({questionnaire:{completed:false,answers:{}}}));memberRecordSchema.parse(none);assert.equal(none.status!.questionnaire!.started,false);assert.match(memberRecordBlock(none,{target:false,clean}),/Health questionnaire: not started\./);
 assert.equal(row().viaTelegram,false,"an older function: not Telegram");assert.equal(row({viaTelegram:true}).viaTelegram,true);
}

// Unknown stays unknown, never a normal value.
const thin=memberRecordFrom(row({ldl:{goal:null,observations:[],event:{type:"tia",other:null,on:null},therapies:[],nextTestOn:null}}));
const t=memberRecordBlock(thin,{target:true,clean});
assert.match(t,/Latest LDL reviewed or released by the doctor: not on record, so unknown/);assert.match(t,/transient ischaemic attack, date not known/);assert.match(t,/Lipid therapy: not on record, so unknown/);assert.match(t,/LDL goal: the doctor has not set one yet/);assert.match(t,/Next LDL test: not on record, so unknown/);
assert.equal(thin.ldl!.goal,null);assert.equal(memberRecordFrom(row({ldl:{goal:null,observations:[],event:null,therapies:[],nextTestOn:null}})).ldl,null,"not in the pathway: no LDL lines at all");
assert.equal(memberRecordBlock(null,{target:false,clean}),"");assert.equal(memberRecordBlock({chatCards:false,ageYears:null,doses:null,ldl:null},{target:false,clean}),"","nothing to say changes nothing");
// A member's own entry never counts as reviewed; an unusable value is dropped.
assert.equal(memberRecordFrom(row({ldl:{...fullLdl,goal:null,observations:[obs("m",1.9,"2026-10-29","member",null),obs("x",900,"2026-10-28","clinic_result")]}})).ldl!.latest,null);
// Plain dose counts: no medicine with a due dose, nothing to say.
assert.equal(memberRecordFrom(row({medicines:{now:"2026-10-30T10:00:00+04:00",self:[],plan:[]}})).doses,null);
assert.match(memberRecordBlock({chatCards:false,ageYears:58,doses:{days:7,expected:14,taken:11,skipped:1},ldl:null},{target:false,clean}),/11 of 14 marked taken, 1 marked skipped.*An unticked dose is unknown, not missed\./);

// The held-data check: a question about what they have, for data the record holds.
const health:HealthData={bpWeek:{count:6,avgSystolic:148,avgDiastolic:92,latest:{systolic:150,diastolic:95,daysAgo:1}},labs:[{marker:"LDL",value:3.4,unit:"mmol/L",low:null,high:2.6,daysAgo:5,reviewed:true}],plan:null};
const d={health,record:full};
assert.deepEqual(asksForHeldData("What was your last LDL result?",d),["ldl","lab"].slice(0,1));
assert.deepEqual(asksForHeldData("Do you have your recent blood pressure readings?",d),["bp"]);
assert.deepEqual(asksForHeldData("Which medicines are you taking?",d),["medicine"]);
assert.deepEqual(asksForHeldData("Какой у вас последний холестерин?",d),["ldl"]);
assert.deepEqual(asksForHeldData("Ո՞րն է ձեր վերջին խոլեստերինը։",d),["ldl"]);
assert.deepEqual(asksForHeldData("Ի՞նչ դեղեր եք ընդունում։",d),["medicine"]);
for(const fine of["What is your blood pressure right now?","Can you measure your blood pressure today?","Do you have chest pain?","Your LDL was 3.4. How have you been sleeping?","Have you had a blood test?".replace("Have you had","Did the doctor order"),"Ի՞նչ ճնշում ունեք հիմա։"])assert.deepEqual(asksForHeldData(fine,d),[],fine);
// Astra ZMR-01: the record answers none of these, so they stay.
for(const fine of["What is your blood pressure at the moment?","Какое у вас давление в данный момент?","Ի՞նչ ճնշում ունեք այս պահին։","Which other medicines or supplements are you taking?","Какие другие лекарства или добавки вы принимаете?","Ի՞նչ այլ դեղեր կամ հավելումներ եք ընդունում։","Do you have blood test results for potassium?","Do you have recent potassium blood test results?","Есть ли у вас последние анализы калия?","Ունե՞ք կալիումի վերջին անալիզի արդյունքները։","Which medicines did you take just now?","How many tablets did you take?","Сколько таблеток вы приняли?","Ի՞նչն է ձեզ անհանգստացնում այս դեղի հարցում։","What worries you about your medicine?","Որ դեղն է ձեզ համար դժվար։","Ինչու՞ եք ուզում դադարեցնել դեղը։"])assert.deepEqual(asksForHeldData(fine,d),[],fine);
assert.deepEqual(asksForHeldData("What was your last LDL result?",{health:null,record:null}),[],"not held: the question is fine");
{const labs={...health,labs:[...health.labs,{marker:"HbA1c",value:6.1,unit:"%",low:null,high:5.7,daysAgo:5,reviewed:true}]};assert.deepEqual(asksForHeldData("What was your last HbA1c?",{health:labs}),["lab"],"a test the data holds, named");}
assert.deepEqual(asksForHeldData("Which medicines are you taking?",{health:null,record:null,medicines:[{name:"x"}]}),["medicine"]);

// The pipeline: the block reaches the reply call; a held-data question gets one regenerate with the reason, then goes on.
const convo={enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const};
const on2=(text:string|string[],extra={})=>job(text,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:convo,intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},health,memberRecord:full,...extra});
const replies=(texts:string[],urgency="planned"):ZoeProvider=>{const fake=createFakeProvider();let n=0;return {...fake,complete:async(req:ProviderRequest)=>{if(req.purpose!=="health_answer")return fake.complete(req);
 const raw=JSON.stringify({reply:texts[Math.min(n++,texts.length-1)],urgency,forward:"none",forward_reason:"none",summary:"x",language:"en"});return {kind:"ok",raw,finishReason:"stop",usage:{inputTokens:10,outputTokens:10},responseModel:"fake",responseId:"r"};}};};
const healthCalls=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.providerCalls.filter(c=>c.purpose==="health_answer");
const q="Is my cholesterol treatment working?";
const plain=await runPipeline(on2(q),{directAnswers:true});
assert.equal(plain.outcome,"answered");const first=healthCalls(plain)[0]!;assert.match(first.memberBlock,/<member_record>[\s\S]*Latest LDL reviewed/);assert.ok(!/1\.4/.test(first.memberBlock),"no goal number in the model's input");assert.ok(plain.judgeCalls.every(c=>!/below 1\.4/.test(c.memberBlock)));assert.ok(plain.judgeCalls.every(c=>/Latest LDL reviewed or released by the doctor: 2\.4/.test(c.memberBlock)),"the judge sees the record, so a true value is not an invented one");
const unchanged=await runPipeline(on2(q,{memberRecord:undefined}),{directAnswers:true}),none=await runPipeline(on2(q,{memberRecord:null}),{directAnswers:true});
assert.equal(healthCalls(unchanged)[0]!.memberBlock,healthCalls(none)[0]!.memberBlock);assert.ok(!healthCalls(none)[0]!.memberBlock.includes("member_record"),"no record: the input is as before");
const asked=await runPipeline(on2(q),{directAnswers:true,provider:replies(["What was your last LDL result?","Your LDL was 2.4 mmol/L twelve days ago; a visit can go through the rest."])});
assert.equal(asked.outcome,"answered");assert.equal(healthCalls(asked).length,2,"one regenerate");assert.match(healthCalls(asked)[1]!.memberBlock,/known_data\.ldl[\s\S]*already holds this/);assert.match(asked.finish!.answer!,/2\.4/);
assert.ok(asked.events.concat(asked.finish!.events).some(e=>e.name==="zoe.health_answer.asks_known_data"));
const again=await runPipeline(on2(q),{directAnswers:true,provider:replies(["What was your last LDL result?","What was your last LDL result, do you recall?"])});
assert.equal(healthCalls(again).length,2,"once only");assert.equal(again.outcome,"answered","the second text goes on to the judge, never the careful line for this");
const today=await runPipeline(on2("My triglycerides are 11 mmol/L and I feel fine"),{directAnswers:true,provider:replies(["What was your last LDL result?"],"same_day")});
assert.equal(healthCalls(today).length,1,"a same-day answer does not wait for this");
// Logging. A plain request while a card can do it: no model, no hold. Anything else: the ordinary path.
for(const t of["I took my pill, can you log it","I took my pills today","took my tablet","Please log my dose","Record my blood pressure","log my bp please","Я выпила таблетку","Выпил лекарство, запиши","Խմեցի դեղս","Դեղս խմեցի, գրանցիր"])assert.ok(plainLoggingRequest(t),t);
for(const t of["I took all my pills and feel dizzy","I took all my pills","I took my pills twice","I took my pill and feel dizzy","I took too many pills","I took my pill late, is that ok?","Record my blood pressure 150/95","I took 10 tablets","Я выпил все таблетки","Выпила таблетку и кружится голова","Խմեցի բոլոր դեղերս","Դեղս խմեցի ու գլուխս պտտվում է","Should I take my pill?","I forgot my pill"])assert.ok(!plainLoggingRequest(t),t);
// The line promises a card: whatever the route takes, cardIntent has to offer one, or Zoe points at nothing.
{const pills=["pill","pills","tablet","tablets","medicine","medicines","medication","meds","dose"],whens=[""," today"," this morning"," this evening"," tonight"],phrases=["log my bp please","record my blood pressure","can you save my blood pressure reading","log my pressure","note my bp","запиши давление","запишите мое давление","գրանցիր ճնշումս","գրանցեք դեղս"];
 for(const p of pills)for(const w of whens)for(const d of["my","the"])for(const f of[`I took ${d} ${p}${w}`,`took ${d} ${p}${w}`,`I've taken ${d} ${p}${w}`,`I took ${d} ${p}${w}, can you note it`,`I took ${d} ${p}${w}. Could you record this please`,`log ${d} ${p}${w}`,`please mark ${d} ${p}${w} as taken`,`can you note ${d} ${p}${w}`,`could you save ${d} ${p}${w} please`])phrases.push(f);
 for(const v of["выпил","приняла","я выпила"])for(const n of["таблетку","таблетки","лекарство","лекарства","дозу"])for(const w of[""," сегодня"," утром"])for(const a of["",", запиши",". отметь"])phrases.push(`${v} ${n}${w}${a}`,`запиши что я ${v.replace("я ","")} ${n}`);
 for(const n of["դեղս","դեղերս","հաբս","հաբերս","դեղը","հաբը"])for(const v of["խմեցի","ընդունեցի"])for(const w of[""," այսօր"," առավոտյան"])for(const a of[""," գրանցիր",", նշեք"])phrases.push(`${n} ${v}${w}${a}`,`ես ${v} ${n}${w}${a}`);
 let taken=0;for(const t of phrases)if(plainLoggingRequest(t)){taken++;assert.ok(["dose","bp"].includes(String(cardIntent(t))),`Promised a card with none behind it: ${t}`);}
 assert.ok(taken>500,"The walk reaches the patterns");}
for(const t of["habs xmeci","xmeci dexs","habs xmeci, grancir","chnshums grancir","grancir chnshums xndrum em","nshi chnshums","nshek chnshums","chnshums nshi","grancek chnshumy","habs yndunetsi","yndunechi dexs","haberys khmeci, nshek","dexs xmeci aysor grancek"]){assert.ok(plainLoggingRequest(t),t);assert.ok(["dose","bp"].includes(String(cardIntent(t))),`Promised a card with none behind it: ${t}`);}
for(const t of["habs xmeci u gluxs cavum a","bolor habers xmeci","erku habs xmeci"])assert.ok(!plainLoggingRequest(t),t);
const cardsOn={...full,chatCards:true};
const logged=await runPipeline(on2("I took my pill, can you log it",{memberRecord:cardsOn}),{directAnswers:true});
assert.equal(logged.outcome,"chatted");assert.equal(logged.reason,"logging_request_no_model");assert.equal(logged.providerCalls.length,0,"no model");assert.equal(logged.finish!.answer,LOGGING_LINE.en);assert.deepEqual(logged.finish!.chat,{kind:"capabilities",source:"fixed"});
for(const text of ["I took my pill","I took my pill, can you log it","Record my blood pressure"]){
 const r=await runPipeline(on2(text,{memberRecord:cardsOn}),{directAnswers:true});
 assert.equal(r.outcome,"chatted");assert.equal(r.finish!.tier,"none","no-model logging satisfies the chatted finish contract");
 assert.equal(r.reserved,null);assert.equal(r.providerCalls.length,0);
}
assert.equal((await runPipeline(on2("I took my pill, can you log it"),{directAnswers:true})).reason.includes("logging"),false,"cards off: the health answer, as before");
const cardsPrompt=await runPipeline(on2(q,{memberRecord:cardsOn}),{directAnswers:true});assert.ok(healthCalls(cardsPrompt)[0]!.system.includes(CHAT_LOG_RULE));assert.ok(!healthCalls(plain)[0]!.system.includes(CHAT_LOG_RULE),"cards off: the prompt as before");
assert.equal(healthCalls(plain)[0]!.system,healthCalls(none)[0]!.system,"cards off: byte-identical");
// Emergency routing does not change: the fixed list, then an urgent reading, then an open question of Zoe's.
{const r=await runPipeline(on2("I took all my pills and feel dizzy",{memberRecord:cardsOn}),{directAnswers:true,env:{NOREON_ZOE_TEST_LEXICON:undefined,NOREON_ZOE_URGENT_PLACEHOLDER:"true"}});assert.match(r.reason,/urgent/,"103, no card");assert.equal(r.providerCalls.length,0);
 const u=await runPipeline(on2("Record my blood pressure",{memberRecord:cardsOn,messages:[{seq:1,text:"My pressure is 190/125",minutesAgo:2},{seq:2,text:"Record my blood pressure",minutesAgo:0}],conversation:{...convo,answeredThroughSeq:0}}),{directAnswers:true});assert.notEqual(u.reason,"logging_request_no_model","a same-day reading in the window");
 const open=await runPipeline(on2("I took my pill",{memberRecord:cardsOn,messages:[{seq:1,text:"Hello",minutesAgo:4},{seq:2,text:"I took my pill",minutesAgo:0}],answers:[{body:"Have you taken your tablet today?",minutesAgo:2}],conversation:{...convo,answeredThroughSeq:1}}),{directAnswers:true});assert.notEqual(open.reason,"logging_request_no_model","an answer to Zoe's question goes to the model");}
// Task words and a small-talk suffix never hide a high reading or its urgent symptoms.
for(const text of ["log my bp 190/125","log my bp 190/125 and I have crushing chest pain right now"])for(const thanks of [false,true]){
 const r=await runPipeline(on2(thanks?[text,"thanks"]:text,{memberRecord:cardsOn}),
  {directAnswers:true,env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_ZOE_URGENT_PLACEHOLDER:"true"}});
 assert.notEqual(r.reason,"logging_request_no_model");
 if(text.includes("chest pain")){assert.match(r.reason,/urgent/);assert.equal(r.providerCalls.length,0);}
 else assert.equal(r.reason,"bp_remeasure","A very high reading is the one BP check's, not a logging line");
}
// The why record holds what the model saw: the goal number only with the switch, and a blood pressure member's record has no LDL line.
{const at=new Date("2026-10-30T10:00:00Z"),rows=(target:boolean,record:MemberRecord)=>whyData({messages:[{seq:1}],record,recordTarget:target},at);
 const v=rows(false,full),keys=v.map(d=>d.key);assert.deepEqual(keys,["messages","age","ldl_latest","ldl_record"]);assert.ok(!/1\.4/.test(JSON.stringify(v)),"no goal number by default");assert.match(rows(true,full).at(-1)!.value!,/below 1\.4 mmol\/L/);
 assert.equal(v[2]!.date,"2026-10-18");assert.equal(v[2]!.reviewed,true);assert.deepEqual(rows(false,{chatCards:true,ageYears:52,doses:{days:7,expected:14,taken:12,skipped:1},ldl:null}).map(d=>d.key),["messages","age","doses"]);
 zoeWhySchema.shape.data.parse(v);
 const before=whyData({messages:[{seq:1}]},at);assert.deepEqual(whyData({messages:[{seq:1}],record:null},at),before,"no record: as before");}
// Astra ZMR-02: symptoms the normaliser drops, and anything the card route would not read, go to the health answer.
for(const s of["I took my pill 🤮","I took my pill, can you log it 🤒","Запиши что я выпил таблетку 🤮","Я выпил таблетку 🤮","Դեղս խմեցի 🤮","Log my pills\u200b please","l\u043Eg my pills","Դեղս խմե՞ցի","Я выпил таблетку?","I took my pill?","I have taken my medication?"])assert.equal(plainLoggingRequest(s),false,s);
for(const s of["I took my pill, can you log it","I took my pill, can you log it?","I took my pill","Record my blood pressure","Log my pills please?","Я выпил таблетку","Запиши что я выпил таблетку","Դեղս խմեցի։","Դեղս խմեցի, գրանցիր"]){assert.equal(plainLoggingRequest(s),true,s);assert.ok(cardIntent(s),s);}
{const r=await runPipeline(on2("I took my pill 🤮",{memberRecord:cardsOn}),{directAnswers:true});assert.notEqual(r.reason,"logging_request_no_model");assert.ok(r.providerCalls.length>0,"the health answer reads it");}
// Astra ZMR-01: a failed held-data regenerate leaves the first reply with the judge, not the careful line.
{const second=(next:(()=>unknown)):ZoeProvider=>{const fake=createFakeProvider();let n=0;return {...fake,complete:async(req:ProviderRequest)=>{if(req.purpose!=="health_answer")return fake.complete(req);
  if(n++>0)return next() as Awaited<ReturnType<ZoeProvider["complete"]>>;
  return {kind:"ok",raw:JSON.stringify({reply:"What was your last LDL result?",urgency:"planned",forward:"none",forward_reason:"none",summary:"x",language:"en"}),finishReason:"stop",usage:{inputTokens:10,outputTokens:10},responseModel:"fake",responseId:"r"};}};};
 for(const next of [()=>({kind:"error",errorClass:"unavailable",usage:null}),()=>({kind:"ok",raw:"not json",finishReason:"stop",usage:{inputTokens:10,outputTokens:10},responseModel:"fake",responseId:"r"})]){
  const r=await runPipeline(on2(q),{directAnswers:true,provider:second(next)});assert.equal(r.outcome,"answered","the first reply goes on");assert.match(r.finish!.answer!,/last LDL result/);assert.ok(r.judgeCalls.length>0,"and the judge read it");}}
console.log("Zoe member record checks passed.");

// Suggestions are ordinary task messages, with a fixed reply and no model call.
for (const text of ["Help me book my visit", "I want to read my plan", "I want to see my results", "I want to reply to my doctor"]) {
 const r = await runPipeline(on2(text, {memberRecord: cardsOn}), {directAnswers:true});
 assert.equal(r.providerCalls.length, 0, `Known task must not call a model: ${text}`);
 assert.equal(r.outcome, "chatted");
}
