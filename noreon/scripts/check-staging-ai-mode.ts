import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runTelegramSweep} from "@/lib/telegram-runtime/dispatch";
import {screenPendingMessages} from "@/lib/care-alerts/server";
import {configuredUrgentMatcher,urgentDecision} from "@/lib/zoe/urgent-test";
import {STAGING_ENTRIES,stagingDecision} from "@/lib/zoe/urgent-staging";
import {realCallsBasis,unfence} from "@/lib/zoe/gateway";
import {providerMode} from "@/lib/zoe/route-config";
import {labProviderMode} from "@/lib/lab-ai/config";
import {zoeTextRoute} from "@/lib/zoe/member-screen";
import {runZoeSweep} from "@/lib/zoe/server";
import {job} from "@/lib/zoe/eval/harness";
import {DEFAULT_ROUTE_CONFIG} from "@/lib/zoe/eval/routing-cases";
import {aiSwitchErrors,aiWithoutDpaAllowed,zoeUrgentPlaceholderOn} from "@/lib/ai-posture";
import {deploymentErrors} from "@/lib/deployment";
import {planProviderMode} from "@/lib/ai-plan/provider";
import type {TelegramChannelAdapter} from "@/lib/telegram-channel/outbound";

/** SYNTHETIC checks for staging AI mode. No model or network: any fetch fails. */
globalThis.fetch=(()=>{throw Error("network used in a check");}) as typeof fetch;
const STAGING={NOREON_PRELAUNCH_STAGING:"true"};

// The placeholder urgent list: only on prod-as-staging, labelled, EN/HY/RU, never the S1 list.
assert.equal(urgentDecision("I have chest pain",{}).outcome,"skipped","Without the staging marker the S1 list (empty) is skipped");
assert.equal(urgentDecision("I have chest pain",{NOREON_PRELAUNCH_STAGING:"1"}).outcome,"skipped","The marker must be exactly true");
assert.equal(urgentDecision("I have chest pain",STAGING).outcome,"escalate");
assert.equal(urgentDecision("Where is my visit?",STAGING).outcome,"recorded");
assert.equal(urgentDecision("chest pain",{...STAGING,NOREON_ZOE_TEST_LEXICON:"true"}).rule,"zoe.urgent_test_lexicon","The fictional test list still wins when explicitly on");
for(const l of ["en","hy","ru"])assert.ok(STAGING_ENTRIES.filter(e=>e.locale===l).length>=10,`placeholder list has ${l} entries`);
assert.equal(stagingDecision("Не могу дышать").outcome,"escalate","A phrase that starts with a negation still matches");
assert.equal(zoeTextRoute("Կրծքիս ցավ ունեմ",STAGING),"urgent","The in-app Zoe screen opens 103 with the placeholder list");
assert.equal(configuredUrgentMatcher({}).lexicon.status,"awaiting_s1_clinical_signoff");
assert.equal(configuredUrgentMatcher(STAGING).lexicon.status,"staging_placeholder");

// Care-team alerts read the text and escalate with the placeholder list on staging only.
{
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});
  if(name==="care_alert_messages_pending")return [{messageId:"00000000-0000-4000-8000-000000000001",memberId:"00000000-0000-4000-8000-000000000002",text:args.p_with_text?"Сильно болит в груди":null}];
  return {ok:true,replayed:false,outcome:(args as {p_outcome:string}).p_outcome,alertId:null};};
 const r=await screenPendingMessages(rpc,configuredUrgentMatcher(STAGING));
 assert.deepEqual(r,{screened:1,escalated:1,failed:0});
 const screen=calls.find(c=>c.name==="care_alert_screen")!.args;
 assert.equal(calls[0]!.args.p_with_text,true);assert.equal(screen.p_rule,"care_alert.urgent_staging_placeholder");assert.deepEqual(screen.p_red_flags,["RF-01"]);
 calls.length=0;
 const off=await screenPendingMessages(rpc,configuredUrgentMatcher({}));
 assert.deepEqual(off,{screened:1,escalated:0,failed:0});assert.equal(calls[0]!.args.p_with_text,false,"Off staging no text is fetched");
}
// Self-harm phrases have no cardiometabolic red flag but still escalate, with no invalid flag.
{
 const calls:Record<string,unknown>[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{if(name==="care_alert_messages_pending")return [{messageId:"00000000-0000-4000-8000-000000000003",memberId:"00000000-0000-4000-8000-000000000002",text:"I don't want to live"}];calls.push(args);return {ok:true,replayed:false};};
 await screenPendingMessages(rpc,configuredUrgentMatcher(STAGING));
 assert.equal(calls[0]!.p_outcome,"escalate");assert.deepEqual(calls[0]!.p_red_flags,[]);
}

// Real-call basis in the app (Khikar, 19 Oct 01:28, keep AI on): the staging marker, a confirmed DPA, or
// the owner switch NOREON_AI_WITHOUT_DPA_CONFIRMATION (on unless "false"). Zoe, lab reading and the AI plan alike.
const NO_OWNER={NOREON_AI_WITHOUT_DPA_CONFIRMATION:"false"};
assert.equal(realCallsBasis({}),"owner");assert.equal(realCallsBasis({NOREON_AI_WITHOUT_DPA_CONFIRMATION:"true"}),"owner");
assert.equal(realCallsBasis(NO_OWNER),null);assert.equal(realCallsBasis({NOREON_AI_WITHOUT_DPA_CONFIRMATION:"TRUE"}),null,"A malformed value reads as off");
assert.equal(realCallsBasis(STAGING),"staging");assert.equal(realCallsBasis({...STAGING,...NO_OWNER}),"staging");
assert.equal(realCallsBasis({NOREON_ZOE_DPA_CONFIRMED:"true",...NO_OWNER}),"dpa");
assert.equal(aiWithoutDpaAllowed({}),true);assert.equal(aiWithoutDpaAllowed(NO_OWNER),false);
const gw={NOREON_ZOE_PROVIDER:"gateway",NOREON_LAB_AI_PROVIDER:"gateway",NOREON_AI_PLAN_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true"};
// Without the staging marker every Gateway path stays on by default...
assert.equal(providerMode(gw),"gateway");assert.equal(labProviderMode(gw),"gateway");assert.equal(planProviderMode(gw),"gateway");
// ...and the owner switch off brings the old requirement back (marker or confirmed DPA).
assert.equal(providerMode({...gw,...NO_OWNER}),"off");assert.equal(labProviderMode({...gw,...NO_OWNER}),"off");assert.equal(planProviderMode({...gw,...NO_OWNER}),"off");
assert.equal(providerMode({...gw,...NO_OWNER,NOREON_ZOE_DPA_CONFIRMED:"true"}),"gateway");
assert.equal(providerMode({...gw,NOREON_ZOE_MODEL_CALLS_ENABLED:"false"}),"off","The app model-call switch still decides");

// The placeholder urgent list as its own setting, with and without the staging marker.
const P="NOREON_ZOE_URGENT_PLACEHOLDER";
for(const [env,on] of [[{},false],[STAGING,true],[{[P]:"true"},true],[{[P]:"true",...STAGING},true],[{[P]:"false",...STAGING},false],[{[P]:"false"},false],[{[P]:"",...STAGING},true],[{[P]:"yes"},false],[{[P]:"yes",...STAGING},false]] as const){
 assert.equal(zoeUrgentPlaceholderOn(env),on,`placeholder ${JSON.stringify(env)}`);
 assert.equal(configuredUrgentMatcher(env).lexicon.status,on?"staging_placeholder":"awaiting_s1_clinical_signoff",`matcher ${JSON.stringify(env)}`);
 assert.equal(urgentDecision("I have chest pain",env).outcome,on?"escalate":"skipped",`urgent decision ${JSON.stringify(env)}`);
}
assert.equal(zoeTextRoute("I have chest pain",{[P]:"true"}),"urgent","Production without the marker keeps the 103 route when the setting is on");

// Deployment validation: only "true", "false" or unset.
assert.deepEqual(aiSwitchErrors({}),[]);assert.deepEqual(aiSwitchErrors({NOREON_AI_WITHOUT_DPA_CONFIRMATION:"false",[P]:"true"}),[]);
assert.deepEqual(aiSwitchErrors({NOREON_AI_WITHOUT_DPA_CONFIRMATION:"on",[P]:"1"}),['NOREON_AI_WITHOUT_DPA_CONFIRMATION must be "true" or "false"','NOREON_ZOE_URGENT_PLACEHOLDER must be "true" or "false"']);
assert.ok(deploymentErrors({[P]:"TRUE"}).includes('NOREON_ZOE_URGENT_PLACEHOLDER must be "true" or "false"'),"A malformed value fails the build even without a deployment target");
assert.deepEqual(deploymentErrors({NOREON_AI_WITHOUT_DPA_CONFIRMATION:"true",[P]:"true"}),[]);
assert.equal(providerMode({...gw,...STAGING}),"gateway");assert.equal(labProviderMode({...gw,...STAGING}),"gateway");
assert.equal(providerMode({...STAGING,NOREON_ZOE_PROVIDER:"gateway"}),"off","The app switch is still needed");

// Fenced JSON from a model is unwrapped, truncated fences too; plain JSON is untouched.
assert.equal(unfence('```json\n{"a":1}\n```'),'{"a":1}');assert.equal(unfence('```json\n{"a":1'),'{"a":1');assert.equal(unfence('{"a":1}'),'{"a":1}');

// The sweep allows direct answers only with a real model: with the stand-in nothing is answered.
{
 const finishes:Record<string,unknown>[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  if(name==="zoe_run_claim")return [job("Where can I see my visit times?",{directAnswers:true})];
  if(name==="zoe_run_urgent_window")return (args.p_runs as string[]).map(id=>({runId:id,urgentSinceMinutes:null}));
  if(name==="zoe_route_config")return {ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers};
  if(name==="zoe_run_reserve")return {ok:true};
  if(name==="zoe_run_finish"){finishes.push(args.p_result as Record<string,unknown>);return {ok:true,outcome:(args.p_result as {outcome:string}).outcome};}
  throw Error(name);};
 const r=await runZoeSweep(rpc,{env:STAGING});
 assert.equal(r.finished.answered,undefined,"stand-in never answers a member");assert.equal(finishes[0]!.outcome,"draft_proposed");
}

// Zoe's answer is sent in the same sweep, not five minutes later.
{
 const order:string[]=[];let queue=0;
 const adapter={id:"telegram",capabilities:()=>({adapter:"telegram",plainText:{maxUtf16Units:4096},idempotentRetry:false}),deliverText:async()=>({kind:"accepted",providerMessageId:"1"})} as unknown as TelegramChannelAdapter;
 const rpc=async(name:string)=>{order.push(name);
  if(name==="channel_inbox_next")return [];
  if(name==="delivery_reconcile_stale")return {reconciled:0};
  if(name==="member_notice_reminders_run")return {state:"off"};
  if(name==="telegram_dispatch_queue")return queue++===0?{system:[],replies:[]}:{system:["00000000-0000-4000-8000-0000000000aa"],replies:[]};
  if(name==="telegram_auth_message_queue")return [];
  if(name==="system_message_claim")return {ok:false,code:"template_unapproved"};
  throw Error(name);};
 const report=await runTelegramSweep({rpc,adapter,accountRef:"x",zoe:async()=>({claimed:1,finished:{answered:1},failed:0})});
 assert.deepEqual(report.afterZoe,{not_invoked:1});
 assert.deepEqual(order.slice(-2),["telegram_dispatch_queue","system_message_claim"],"a second send pass runs after Zoe");
 queue=0;order.length=0;
 const none=await runTelegramSweep({rpc,adapter,accountRef:"x",zoe:async()=>({claimed:1,finished:{stale:1},failed:0})});
 assert.equal(none.afterZoe,undefined,"no second pass when Zoe queued nothing (a stale run; any other outcome may queue a text, a receipt or a released acknowledgement)");
}
// F1 (#236): the TS finish for an answered run carries every key zoe_run_finish reads, language included.
{
 const {runPipeline}=await import("@/lib/zoe/eval/harness");
 const raw=JSON.stringify({summary:"Member asked about visit times.",draft_reply:null,no_draft_reason_code:"answered_directly",missing_info:[],language:"ru",direct_answer:"Время визита в разделе «Care plan»."});
 const r=await runPipeline(job("Где посмотреть время визита?",{directAnswers:true}),{directAnswers:true,env:{NOREON_PRELAUNCH_STAGING:"true",NOREON_ZOE_TEST_LEXICON:"false"},fixtureRaw:raw});
 assert.equal(r.outcome,"answered");
 const sql=readFileSync("supabase/migrations/20261017190654_staging_ai_mode.sql","utf8");
 const fn=sql.slice(sql.indexOf("create or replace function public.zoe_run_finish"),sql.indexOf("end$$;",sql.indexOf("create or replace function public.zoe_run_finish")));
 const read=new Set([...fn.matchAll(/p_result(?:->>|->|#>>)'?\{?([a-zA-Z]+)/g)].map(m=>m[1]!));
 for(const k of read)if(k!=="configVersion")assert.ok(k in r.finish!,`zoe_run_finish reads "${k}" but the pipeline's finish has no such key`);
 assert.equal(r.finish!.language,"ru");assert.ok(read.has("language"));
}
console.log("PASS staging AI mode: placeholder urgent list (staging only, EN/HY/RU, care alerts read it), real-call basis for Zoe and lab, fence unwrap, stand-in never answers, answer sent in the same sweep");
