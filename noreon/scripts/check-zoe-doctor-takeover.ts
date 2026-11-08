import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {emptyRecord} from "@/lib/zoe/symptoms/intake";
import {runZoeSweep} from "@/lib/zoe/server";
import {createFakeProvider} from "@/lib/zoe/provider";
import {DEFAULT_ROUTE_CONFIG} from "@/lib/zoe/eval/routing-cases";
import {handBackToZoe,parseHandBackNotice} from "@/lib/zoe/doctor-mode";
import type {ZoeJob} from "@/lib/zoe/pipeline";

/**
 * SYNTHETIC checks for doctor takeover (20261020082321; Armen 20 Oct), no model or network. In doctor mode the pipeline
 * runs the urgent text, the 103 window, the self-harm crisis text and the symptom red flags exactly as before, and nothing
 * else: no model call, no receipt, no chat reply, no intake turn. The database side (who may switch, the member's line, the
 * finish guard) is in check-zoe-doctor-takeover.sql.
 */
const env={NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false"};
const ctx={enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const};
const intakeOn={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
// Free mode with every switch on, as on staging.
const on=(texts:string|string[],extra:Partial<ZoeJob>={})=>job(texts,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:ctx,intake:intakeOn,...extra});
const run=(j:ZoeJob)=>runPipeline(j,{directAnswers:true,env});
const dm={doctorMode:true};

// Zoe mode: a health question is answered by Zoe (the model is called).
const q="What does a blood pressure of 150/95 mean?";
const zoe=await run(on(q));
assert.equal(zoe.outcome,"answered","Zoe mode: Zoe answers");assert.ok(zoe.providerCalls.length>0);

// Doctor mode: the same question waits for the doctor. No model call, no reservation, no receipt, no text.
for(const t of [q,"Hello","Thanks a lot","Ի՞նչ է նշանակում 150/95 ճնշումը","Что значит давление 150/95?","I have a headache since this morning"]){
 const r=await run(on(t,dm));
 assert.equal(r.outcome,"discarded",`doctor mode: ${t}`);assert.equal(r.reason,"doctor_mode",`doctor mode reason: ${t}`);
 assert.equal(r.providerCalls.length,0,`doctor mode: no model call: ${t}`);assert.equal(r.reserved,null,`doctor mode: nothing reserved: ${t}`);
 assert.equal(r.finish!.answer,null,`doctor mode: no text: ${t}`);assert.equal(r.finish!.receipt,null,`doctor mode: no receipt: ${t}`);
 assert.equal(r.finish!.intake??null,null,`doctor mode: no intake started: ${t}`);
 assert.ok(r.events.some(e=>e.name==="zoe.guard.doctor_mode"),`doctor mode: traced: ${t}`);
}
// Without free mode (the doctor-draft path) as well: no draft, nothing.
{const r=await run(job(q,{directAnswers:true,...dm}));assert.equal(r.reason,"doctor_mode");assert.equal(r.providerCalls.length,0,"doctor path off in doctor mode");}

// The safety exception: urgent words, self-harm, the 103 window and red flags answer at once, exactly as in Zoe mode.
const same=async(texts:string|string[],extra:Partial<ZoeJob>={})=>{
 const a=await run(on(texts,extra)),b=await run(on(texts,{...extra,...dm}));
 assert.equal(b.outcome,a.outcome,`same outcome: ${texts}`);assert.equal(b.reason,a.reason,`same reason: ${texts}`);
 assert.equal(b.finish!.answer,a.finish!.answer,`same text: ${texts}`);assert.deepEqual(b.finish!.health??null,a.finish!.health??null,`same forward: ${texts}`);
 assert.equal(b.providerCalls.length,0,`no model: ${texts}`);assert.ok(b.finish!.answer,`a text for the member: ${texts}`);
 return b;};
assert.equal((await same("I have crushing chest pain right now")).reason,"urgent_route_no_model_call","urgent words: the 103 text");
assert.equal((await same("I want to kill myself")).finish!.health?.forwardReason,"self_harm","self-harm: the crisis text, forwarded to the doctor");
assert.equal((await same("Лучше покончу с собой, чем буду звонить")).finish!.health?.forwardReason,"self_harm","self-harm in Russian");
assert.equal((await same(["I have crushing chest pain right now","I won't call, I'll wait till morning"])).finish!.health?.forwardReason,"refused_103","103 refusal: S100, forwarded");
assert.equal((await same("ok",{answers:[],urgentSinceMinutes:4,messageSeq:2,messages:[{seq:2,text:"ok",minutesAgo:1}]})).reason,"urgent_in_window_no_model_call","the 103 window repeats 103");
assert.equal((await same("I have a headache and my arm is numb")).outcome,"intake_escalated","red flag: 103 text and the care-team alert");

// Symptom intake in progress: it pauses (no turn, the record untouched); a red flag inside it still escalates.
const act={id:"00000000-0000-4000-8000-0000000000ab",sheetId:"headache",sheetVersion:1,startedSeq:1,language:"en" as const,record:{...emptyRecord(),asked:[],turns:1}};
{const r=await run(on(["I have a headache","Since this morning"],{...dm,intake:{...intakeOn,active:act}}));
 assert.equal(r.reason,"doctor_mode","intake paused in doctor mode");assert.equal(r.finish!.intake??null,null,"the intake record is not touched");
 assert.equal(r.events.find(e=>e.name==="zoe.guard.doctor_mode")?.attributes["noreon.zoe.intake.paused"],true,"the trace says the intake is paused");}
{const r=await run(on(["I have a headache","My face is drooping and I feel confused"],{...dm,intake:{...intakeOn,active:act}}));
 assert.equal(r.outcome,"intake_escalated","red flag inside a paused intake still escalates");assert.equal(r.finish!.intake!.state,"escalated");}

// Astra DT-01: a "yes" to the intake's pending red-flag question (sudden worst headache) escalates in doctor mode too, in EN, HY
// and RU, with no model call: the 103 text and the intake escalated (the care alert).
const ASK={en:"Did it come on suddenly, reaching its worst within about a minute?",hy:"Հանկարծակի՞ սկսվեց և մոտ մեկ րոպեում հասավ ամենաուժեղին։",ru:"Она началась внезапно и стала максимальной примерно за минуту?"};
for(const [lang,yes] of [["en","Yes"],["hy","Այո"],["ru","Да"]] as const){
 const asked={...act,language:lang,record:{...emptyRecord(),asked:["sudden"],lastAsked:["sudden"],turns:1}};
 const extra=(t:string)=>({intake:{...intakeOn,active:asked},answers:[{body:ASK[lang],minutesAgo:1}],messageSeq:2,messages:[{seq:1,text:"headache",minutesAgo:3},{seq:2,text:t,minutesAgo:0}]});
 const zm=await run(on(yes,extra(yes))),d=await run(on(yes,{...extra(yes),...dm}));
 assert.equal(zm.outcome,"intake_escalated",`${lang}: Zoe mode escalates the yes`);
 assert.equal(d.outcome,"intake_escalated",`DT-01 ${lang}: doctor mode escalates the yes (${d.reason})`);assert.equal(d.reason,"intake_red_flag_answer_no_model_call");
 assert.equal(d.finish!.answer,zm.finish!.answer,`DT-01 ${lang}: the same 103 text`);assert.equal(d.providerCalls.length,0,`DT-01 ${lang}: no model`);
 assert.equal(d.finish!.intake!.state,"escalated",`DT-01 ${lang}: the intake escalates (care alert)`);
 // A plain "no" in doctor mode is recorded nowhere: the intake stays paused.
 const nt=lang==="en"?"No":lang==="hy"?"Ոչ":"Нет";const no=await run(on(nt,{...extra(nt),...dm}));assert.equal(no.reason,"doctor_mode",`${lang}: a no waits for the doctor (${no.outcome} ${no.reason})`);
}
// Free mode: a "yes" to Zoe's own danger-sign question escalates in doctor mode too.
{const danger="Is one side of your face drooping right now?";const extra={answers:[{body:danger,minutesAgo:1}],messageSeq:2,messages:[{seq:1,text:"I feel odd",minutesAgo:3},{seq:2,text:"Yes",minutesAgo:0}]};
 const zm=await run(on("Yes",extra)),d=await run(on("Yes",{...extra,...dm}));
 assert.equal(zm.reason,"urgent_health_answer_red_flag_yes","Zoe mode: yes to a danger-sign question is urgent");
 assert.equal(d.reason,"urgent_health_answer_red_flag_yes","DT-01: doctor mode too");assert.equal(d.finish!.answer,zm.finish!.answer);assert.equal(d.providerCalls.length,0);
 assert.deepEqual(d.finish!.health,zm.finish!.health,"DT-01: forwarded as in Zoe mode");}

// The per-member cap does not change the safety texts in doctor mode, and nothing else runs anyway.
{const capped={...ctx,memberSpentTodayUsd:5,memberDailyCapUsd:1};
 assert.equal((await run(on("I have crushing chest pain right now",{...dm,conversation:capped}))).reason,"urgent_route_no_model_call","capped member: still 103");
 const r=await run(on(q,{...dm,conversation:capped}));assert.equal(r.reason,"doctor_mode","capped member in doctor mode: waits for the doctor");}

// The worker reads doctor mode after the claim (zoe_run_doctor_mode); unreadable: runs as before (the database holds the text).
{const j=on(q);const seen:string[]=[];const fin:string[]=[];
 const rpc=(mode:"on"|"off"|"down")=>async(name:string)=>{seen.push(name);
  if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};if(name==="zoe_run_claim")return [j];
  if(name==="zoe_run_urgent_window")return [{runId:j.runId,urgentSinceMinutes:null}];
  if(name==="zoe_run_doctor_mode"){if(mode==="down")throw Error("down");return [{runId:j.runId,doctorMode:mode==="on"}];}
  if(name==="zoe_run_reserve")return {ok:true};
  if(name==="zoe_run_finish"){fin.push(name);return {ok:true,outcome:"discarded"};}
  throw Error(`unexpected ${name}`);};
 await runZoeSweep(rpc("on"),{provider:createFakeProvider(),env});
 assert.ok(seen.includes("zoe_run_doctor_mode")&&!seen.includes("zoe_run_reserve"),"sweep: doctor mode read, nothing reserved");
 seen.length=0;await runZoeSweep(rpc("down"),{provider:createFakeProvider(),env});
 assert.ok(seen.includes("zoe_run_reserve"),"sweep: unreadable doctor mode runs as before");}

// The hand back: one call for a valid member, the notice for the page.
{const calls:string[]=[];const id="00000000-0000-4000-8000-00000000abcd";
 assert.equal(await handBackToZoe({handBack:async m=>{calls.push(m);return {ok:true,replayed:false,notified:true};}},id),"handed_back");
 assert.equal(await handBackToZoe({handBack:async()=>({ok:true,replayed:true})},id),"already_zoe");
 assert.equal(await handBackToZoe({handBack:async()=>({ok:false,code:"x"})},id),"unavailable");
 assert.equal(await handBackToZoe({handBack:async m=>{calls.push(m);return {ok:true,replayed:false};}},"not-a-uuid"),"unavailable");
 assert.deepEqual(calls,[id],"called once, only for a valid id");
 assert.equal(parseHandBackNotice("handed_back"),"handed_back");assert.equal(parseHandBackNotice(["x"]),null);assert.equal(parseHandBackNotice("other"),null);}

console.log("check-zoe-doctor-takeover: all assertions passed");
