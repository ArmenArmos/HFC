import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {guardField} from "@/lib/zoe/output-guard";
import {createFakeProvider,FAKE_SCENARIOS} from "@/lib/zoe/provider";
import {runZoeSweep} from "@/lib/zoe/server";
import {openRunIo,sealRunIo} from "@/lib/zoe/seal";
import {runTelegramSweep} from "@/lib/telegram-runtime/dispatch";
import {redactText} from "@/lib/zoe/redact";
import {DEFAULT_ROUTE_CONFIG} from "@/lib/zoe/eval/routing-cases";

/** SYNTHETIC checks for the Zoe message pipeline with the fake provider. No model or network. */

// Step order and OTel GenAI fields on a normal run.
const ok=await runPipeline(job("I have had a mild headache since yesterday"));
assert.equal(ok.outcome,"draft_proposed");
assert.deepEqual(ok.events.map(e=>e.name),["zoe.guard.urgent_match","zoe.guard.scope","zoe.route.tier","zoe.guard.redaction","zoe.route.health_answer","zoe.route.direct_answer","zoe.provider.call","zoe.guard.output_schema","zoe.guard.output_summary","zoe.guard.output_missing_info","zoe.guard.output_draft"],"Guards run in the designed order");
const call=ok.events.find(e=>e.name==="zoe.provider.call")!;
for(const k of ["gen_ai.operation.name","gen_ai.provider.name","gen_ai.request.model","gen_ai.response.model","gen_ai.response.id","gen_ai.response.finish_reasons","gen_ai.usage.input_tokens","gen_ai.usage.output_tokens","noreon.zoe.latency_ms","noreon.zoe.cost_usd"])assert.ok(k in call.attributes,`provider event has ${k}`);
assert.equal(call.actor,"ai");
assert.ok((ok.finish?.costUsd??0)>0&&(ok.finish?.usage?.inputTokens??0)>0,"Spend is accounted from the fake token counts");
assert.ok(ok.reserved&&ok.reserved.local&&ok.reserved.estimateUsd>=ok.finish!.costUsd,"Reservation precedes the call and covers the cost");
assert.ok(Object.keys(call.attributes).length<=24,"Attribute budget");
for(const e of ok.events)assert.match(e.reason,/^[a-z0-9_.:-]{1,80}$/,`reason is a code: ${e.reason}`);

// Both default drafts pass the guards in their language; the HY-Latn member gets Armenian script.
for(const [text,lang] of [["My knee hurts after walking","en"],["Գլուխս ցավում է երեկվանից","hy"]] as const){
 const r=await runPipeline(job(text));
 assert.equal(r.outcome,"draft_proposed",`default ${lang} draft passes`);
 assert.equal(guardField("draft",r.finish!.draft!,{memberTexts:[text],replyLanguage:lang}).outcome,"pass");
}

// Every fake scenario ends in a recorded outcome, never a throw, and never a blocked draft for the doctor.
for(const scenario of FAKE_SCENARIOS){
 const r=await runPipeline(job(`How do I send a reading? #zoe-fake:${scenario}`));
 assert.ok(r.finish,`${scenario} finishes`);
 if(["dose","medication_change","reassurance","threshold","time_promise","false_status","link","wrong_language","long_draft"].includes(scenario))
  {assert.equal(r.outcome,"draft_blocked",`${scenario} blocks the draft`);assert.equal(r.finish!.draft,null);}
 if(["extra_keys","bad_schema"].includes(scenario))assert.equal(r.reason,"schema_invalid",scenario);
 if(scenario==="no_draft")assert.equal(r.outcome,"summary_only");
}

// The model never sees the scenario marker's effect on authority: the summary for the doctor has contacts redacted.
const linky=await runPipeline(job("my email is someone@example.com"));
assert.ok(!(linky.providerCalls[0]?.memberBlock??"").includes("someone@example.com"),"Email redacted before the provider");
assert.equal(redactText("BP 150/95 at 08:30, call 103").count,0,"Readings, times and 103 are not identifiers");

// A provider that throws is a recorded no-output, with bounded attempts.
const throwing={...createFakeProvider(),complete:async()=>{throw Error("boom");}};
const thrown=await runPipeline(job("hello"),{provider:throwing});
assert.equal(thrown.outcome,"no_output");assert.equal(thrown.reason,"provider_unavailable");
assert.equal((await runPipeline(job("hello"),{provider:null})).reason,"provider_unavailable","No provider: no output, no reservation");

// Sealing: AES-GCM round trip; tampering is refused; no key, nothing stored.
const key=Buffer.alloc(32,7).toString("base64");
const sealed=sealRunIo({memberBlock:"<member_messages>x</member_messages>",response:"{}"},{NOREON_ZOE_RUN_KEY:key})!;
assert.deepEqual(openRunIo(sealed,{NOREON_ZOE_RUN_KEY:key}),{memberBlock:"<member_messages>x</member_messages>",response:"{}"});
const parts=sealed.split(":");parts[4]=Buffer.from("tampered").toString("base64");
assert.equal(openRunIo(parts.join(":"),{NOREON_ZOE_RUN_KEY:key}),"key_unavailable","Tampered ciphertext refused");
assert.equal(sealRunIo({memberBlock:"x",response:null},{NOREON_ZOE_RUN_KEY:"short"}),null,"Invalid key: nothing stored");

// The sweep claims, reserves and finishes through the RPC port; a failed claim reports, never throws.
const calls:string[]=[];
const claimJob=job("Is it fine to walk every day?");
const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push(name);
 if(name==="zoe_run_claim")return [claimJob];
 if(name==="zoe_run_urgent_window")return (args.p_runs as string[]).map(id=>({runId:id,urgentSinceMinutes:null}));
 if(name==="zoe_run_doctor_mode")return (args.p_runs as string[]).map(id=>({runId:id,doctorMode:false}));
 if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};
 if(name==="zoe_run_reserve"){assert.ok(["low","medium","high"].includes(args.p_tier as string)&&typeof args.p_model==="string","reserve names the tier and model");return {ok:true};}
 if(name==="zoe_run_finish"){assert.equal((args.p_result as {configVersion?:string}).configVersion?.startsWith("zoe-conversation-prompt-5"),true);return {ok:true,outcome:(args.p_result as {outcome:string}).outcome};}
 throw Error(`unexpected ${name}`);};
const report=await runZoeSweep(rpc,{provider:createFakeProvider(),env:{NOREON_ZOE_TEST_LEXICON:"true"}});
assert.deepEqual(calls,["zoe_route_config","zoe_run_claim","zoe_run_context","zoe_run_plan","zoe_run_health_context","zoe_run_urgent_window","zoe_run_doctor_mode","zoe_run_topic","zoe_run_member_record","zoe_run_reserve","zoe_run_finish","zoe_run_why_record"],"route config before the claim (C-1); the run context and plan after it, unreadable counts as off");
assert.equal(report.claimed,1);assert.equal(report.finished.draft_proposed,1);
// Z-F1: with no active urgent list nothing is reserved or sent to a model.
calls.length=0;
const dark=await runZoeSweep(rpc,{provider:createFakeProvider(),env:{}});
assert.deepEqual(calls,["zoe_route_config","zoe_run_claim","zoe_run_context","zoe_run_plan","zoe_run_health_context","zoe_run_urgent_window","zoe_run_doctor_mode","zoe_run_topic","zoe_run_member_record","zoe_run_finish","zoe_run_why_record"]);assert.equal(dark.finished.discarded,1);
assert.deepEqual(await runZoeSweep(async()=>{throw Error("down");},{provider:createFakeProvider()}),{claimed:0,finished:{},failed:1});
// The 103 window (Astra #356 UW-2): zoe_run_urgent_window's history reaches the job; a doctor approval that emptied the
// claimed answers no longer ends the window. Unreadable: the claimed answers decide.
{const fin:string[]=[];const j=job("ok",{directAnswers:true});
 const r=await runZoeSweep(async(name,args)=>{if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};if(name==="zoe_run_claim")return [j];
  if(name==="zoe_run_urgent_window")return [{runId:j.runId,urgentSinceMinutes:6}];
  if(name==="zoe_run_finish"){fin.push((args.p_result as {reason:string}).reason);return {ok:true,outcome:"discarded"};}throw Error(`unexpected ${name}`);},
  {provider:createFakeProvider(),env:{NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false"}});
 assert.equal(r.finished.discarded,1,`the window's history makes the sweep repeat 103 (${JSON.stringify(r)} ${fin})`);assert.deepEqual(fin,["urgent_in_window_no_model_call"]);}
// Round 3: the window cannot be read (a failed read, or no row for the run): no answer and no receipt, no model call.
for(const reply of [()=>{throw Error("down");},()=>[]]){
 const fin:{reason:string;receipt:unknown;answer:unknown}[]=[];const j=job("ok",{directAnswers:true});let calls2=0;
 const r=await runZoeSweep(async(name,args)=>{if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};if(name==="zoe_run_claim")return [j];
  if(name==="zoe_run_urgent_window")return reply();if(name==="zoe_run_reserve"){calls2++;return {ok:true};}
  if(name==="zoe_run_finish"){const p=args.p_result as {reason:string;receipt:unknown;answer:unknown};fin.push({reason:p.reason,receipt:p.receipt,answer:p.answer});return {ok:true,outcome:"no_output"};}throw Error(`unexpected ${name}`);},
  {provider:createFakeProvider(),env:{NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false"}});
 assert.equal(r.finished.no_output,1,"unavailable window: no output");assert.equal(calls2,0,"unavailable window: no reservation or model");
 assert.equal(fin[0]!.reason,"urgent_window_unavailable");assert.equal(fin[0]!.receipt,null,"no receipt");assert.ok(!fin[0]!.answer,"no answer");
}
// Astra member-cap F1: a zero global cap gives a zero member cap; the run context still parses (locale, counts kept) and no model is called.
{const fin:string[]=[];let reserved=0;const j=job("Is it fine to walk every day?");
 const r=await runZoeSweep(async(name,args)=>{if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};if(name==="zoe_run_claim")return [j];
  if(name==="zoe_run_context")return [{runId:j.runId,enabled:true,doctorName:"Dr Test",answeredThroughSeq:0,memberSpentTodayUsd:0,memberDailyCapUsd:0,injectionsLast24h:0,locale:"en"}];
  if(name==="zoe_run_urgent_window")return [{runId:j.runId,urgentSinceMinutes:null}];
  if(name==="zoe_run_doctor_mode")return [{runId:j.runId,doctorMode:false}];
  if(name==="zoe_run_reserve"){reserved++;return {ok:true};}
  if(name==="zoe_run_finish"){fin.push((args.p_result as {reason:string}).reason);return {ok:true,outcome:"no_output"};}return [];},{provider:createFakeProvider(),env:{NOREON_ZOE_TEST_LEXICON:"true"}});
 assert.deepEqual(fin,["member_spend_cap_reached"],`a zero cap keeps the context and stops the run (${fin}, ${JSON.stringify(r)})`);assert.equal(reserved,0,"no reservation");}
// C-1: the route config cannot be read: nothing is claimed (the next sweep retries).
{const seen:string[]=[];
 const r=await runZoeSweep(async(name)=>{seen.push(name);if(name==="zoe_route_config")throw Error("down");return [];},{provider:createFakeProvider()});
 assert.deepEqual(seen,["zoe_route_config"],"no claim without the route config");assert.equal(r.failed,1);}
// C-3: a job that cannot be parsed is finished as worker_error, not left started.
{const fin:{run:unknown;reason:unknown}[]=[];
 const r=await runZoeSweep(async(name,args)=>{if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};if(name==="zoe_run_claim")return [{runId:"00000000-0000-4000-8000-0000000000aa",unexpected:true}];
  if(name==="zoe_run_finish"){fin.push({run:args.p_run,reason:(args.p_result as {reason:string}).reason});return {ok:true,outcome:"no_output"};}return [];},{provider:createFakeProvider()});
 assert.equal(r.failed,1);assert.deepEqual(fin,[{run:"00000000-0000-4000-8000-0000000000aa",reason:"worker_error"}],"failed job finished as worker_error");}

// In the Telegram sweep Zoe runs after every send, so a model call never delays an acknowledgement.
const order:string[]=[];
const tg=async(name:string)=>{order.push(name);
 if(name==="channel_inbox_next"||name==="telegram_auth_message_queue")return [];
 if(name==="delivery_reconcile_stale")return {reconciled:0};
 if(name==="telegram_dispatch_queue")return {system:[],replies:[]};
 return null;};
const adapter={id:"telegram",capabilities:()=>({plainText:{}}),deliver:async()=>({kind:"unknown",reason:"x"}),deliverText:async()=>({kind:"unknown",reason:"x"})} as never;
const sweep=await runTelegramSweep({rpc:tg,adapter,accountRef:"a",zoe:async()=>{order.push("zoe");return {claimed:0,finished:{},failed:0};}});
assert.equal(order.at(-1),"zoe","Zoe is the last step of the sweep");
assert.ok(order.indexOf("telegram_dispatch_queue")<order.indexOf("zoe"));
assert.deepEqual(sweep.zoe,{claimed:0,finished:{},failed:0});
const failing=await runTelegramSweep({rpc:tg,adapter,accountRef:"a",zoe:async()=>{throw Error("zoe down");}});
assert.equal(failing.zoe?.failed,1,"A Zoe failure never fails the Telegram sweep");
console.log("Zoe pipeline checks passed.");
