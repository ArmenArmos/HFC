import assert from "node:assert/strict";
import {createGatewayProvider,gatewayConfigured,zoeModelCallsEnabled,type GatewayGenerate} from "@/lib/zoe/gateway";
import {configuredZoeRouting,parseRouteConfig,providerMode} from "@/lib/zoe/route-config";
import {routeTier} from "@/lib/zoe/routing";
import {classifyScope} from "@/lib/zoe/scope";
import {runZoeSweep} from "@/lib/zoe/server";
import {job} from "@/lib/zoe/eval/harness";
import {DEFAULT_ROUTE_CONFIG} from "@/lib/zoe/eval/routing-cases";
import {aiSettingsSchema,evalJobSchema,applyTierChangeCore,candidateConfig,rollbackTierChangeCore,runTierModelEvalCore,tierChangeSchema,type AiSettings} from "@/lib/zoe/settings-core";
import type {runModelEval} from "@/lib/zoe/eval/model-run";
import {BELOW_RECOMMENDED_TEXT,TIER_FLOOR,TIER_RECOMMENDED,tierClassFit} from "@/lib/zoe/tier-class";
import {runEvalSet,type EvalSummary} from "@/lib/zoe/eval/run";
import {createFakeProvider} from "@/lib/zoe/provider";

/** SYNTHETIC checks for Zoe AI settings and tier routing. The Gateway is mocked; any network use fails the check. */
const realFetch=globalThis.fetch;
globalThis.fetch=(()=>{throw Error("network used in a check");}) as typeof fetch;

// Routing: deterministic, window-wide, unsure goes up, never decided by a model.
const tier=(t:string|string[])=>{const texts=Array.isArray(t)?t:[t];return routeTier(texts,classifyScope(texts.at(-1)!)).tier;};
assert.equal(tier("Where are my results?"),"low");
assert.equal(tier("What time is my visit on Monday?"),"low");
assert.equal(tier("Is walking good for my weight?"),"medium");
assert.equal(tier("I feel dizzy when I stand up"),"high");
assert.equal(tier("Can I stop taking metformin?"),"high");
assert.equal(tier("My blood pressure was 150/95 this morning"),"high");
assert.equal(tier("Can I eat bread on my plan?"),"high");
assert.equal(tier("ok"),"low");
assert.equal(tier("blah"),"high","No rule matched: medium, then one tier up");
assert.equal(tier(["My chest feels tight","thanks"]),"high","The window keeps the highest tier");
const unsure=routeTier(["When is my wife's visit?"],classifyScope("When is my wife's visit?"));
assert.equal(unsure.tier,"medium");assert.match(unsure.reason,/^unsure_/);
const classified=routeTier(["When is my visit?"],classifyScope("When is my visit?"),()=>({tier:"low",confidence:0.5,label:"test"}));
assert.equal(classified.tier,"medium","A low-confidence classifier result goes one tier up");
const raised=routeTier(["When is my visit?"],classifyScope("When is my visit?"),()=>({tier:"high",confidence:0.95,label:"test"}));
assert.equal(raised.tier,"high","A classifier can raise the tier, never lower it");
const lowered=routeTier(["My knee hurts"],classifyScope("My knee hurts"),()=>({tier:"low",confidence:0.99,label:"test"}));
assert.equal(lowered.tier,"high","A classifier cannot lower a rule's tier");

// Switches and provider mode.
assert.equal(zoeModelCallsEnabled({}),false);assert.equal(zoeModelCallsEnabled({NOREON_ZOE_MODEL_CALLS_ENABLED:"1"}),false);
assert.equal(providerMode({}),"fake");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway"}),"off","Gateway without the app flag is no provider at all");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true"}),"gateway","Owner basis by default (19 Oct): no staging marker needed");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_AI_WITHOUT_DPA_CONFIRMATION:"false"}),"off","Gateway with the flag but no basis (owner switch off, not staging, no confirmed DPA) is no provider");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_AI_WITHOUT_DPA_CONFIRMATION:"false",NOREON_PRELAUNCH_STAGING:"1"}),"off","The staging marker must be exactly true");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_PRELAUNCH_STAGING:"true"}),"gateway");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_ZOE_DPA_CONFIRMED:"true"}),"gateway");
assert.equal(providerMode({NOREON_ZOE_PROVIDER:"bedrock",NOREON_ZOE_MODEL_CALLS_ENABLED:"true"}),"off");
assert.equal(gatewayConfigured({}),false);assert.equal(gatewayConfigured({AI_GATEWAY_API_KEY:"x"}),true);
const off=configuredZoeRouting(DEFAULT_ROUTE_CONFIG,{NOREON_ZOE_PROVIDER:"gateway"});
assert.equal(off.providerFor(DEFAULT_ROUTE_CONFIG.tiers.high!.model),null);
assert.equal(configuredZoeRouting(DEFAULT_ROUTE_CONFIG,{}).providerFor(DEFAULT_ROUTE_CONFIG.tiers.high!.model)?.local,true,"Default: the local stand-in");

// Gateway adapter with a mocked generate.
const opus={id:"anthropic/claude-opus-5.5",inputUsdPerMTok:4,outputUsdPerMTok:20};
const req={purpose:"intake_draft" as const,promptVersion:"p",system:"SYSTEM",memberBlock:"<member_messages>x</member_messages>",replyLanguage:"hy" as const,maxOutputTokens:800};
const seen:Parameters<GatewayGenerate>[0][]=[];
const gen=(impl:()=>Awaited<ReturnType<GatewayGenerate>>|Promise<never>):GatewayGenerate=>async a=>{seen.push(a);return impl();};
const on={NOREON_ZOE_MODEL_CALLS_ENABLED:"true"};
const okGen=gen(()=>({text:'{"summary":"s"}',finishReason:"stop",usage:{inputTokens:120,outputTokens:30},response:{id:"gen_1",modelId:"anthropic/claude-opus-5.5"}}));
assert.deepEqual(await createGatewayProvider(opus,{env:{},generate:okGen}).complete(req),{kind:"error",errorClass:"unavailable",usage:null});
assert.equal(seen.length,0,"No call while the app flag is off");
const p=createGatewayProvider(opus,{env:on,generate:okGen});
assert.equal(p.local,false);assert.equal(p.providerName,"vercel.ai_gateway");assert.equal(p.requestModel,opus.id);
assert.deepEqual(await p.complete(req),{kind:"ok",raw:'{"summary":"s"}',finishReason:"stop",usage:{inputTokens:120,outputTokens:30},responseModel:"anthropic/claude-opus-5.5",responseId:"gen_1"});
assert.equal(seen[0]!.model,opus.id);assert.equal(seen[0]!.system,"SYSTEM");assert.equal(seen[0]!.maxRetries,0);assert.equal(seen[0]!.temperature,0);assert.equal(seen[0]!.maxOutputTokens,800);
assert.match(seen[0]!.prompt,/Reply language: Armenian/);
const err=(e:object)=>createGatewayProvider(opus,{env:on,generate:gen(()=>Promise.reject(e))}).complete(req);
assert.equal((await err({statusCode:429})).kind==="error"&&(await err({statusCode:429}) as {errorClass:string}).errorClass,"rate_limited");
assert.equal((await err({statusCode:503}) as {errorClass:string}).errorClass,"server_error");
assert.equal((await err({name:"AbortError"}) as {errorClass:string}).errorClass,"timeout");
assert.equal((await err({statusCode:401}) as {errorClass:string}).errorClass,"unavailable");
const filtered=await createGatewayProvider(opus,{env:on,generate:gen(()=>({text:"",finishReason:"content-filter",usage:{inputTokens:5,outputTokens:0},response:{id:"g",modelId:"m"}}))}).complete(req);
assert.equal(filtered.kind,"refusal");
const slow=await createGatewayProvider(opus,{env:on,timeoutMs:5,generate:async a=>new Promise((_,reject)=>a.abortSignal.addEventListener("abort",()=>reject(Object.assign(Error("aborted"),{name:"AbortError"}))))}).complete(req);
assert.deepEqual(slow,{kind:"error",errorClass:"timeout",usage:null});

// Route configuration from the database, and the sweep with it.
assert.throws(()=>parseRouteConfig({ok:true,tiers:{high:{version:1,dailyCapUsd:20,model:opus,fallback:null}}}),"A tier limit above US$10 is rejected");
const parsed=parseRouteConfig({ok:true,tiers:{high:{version:2,dailyCapUsd:"6.00",model:{id:opus.id,inputUsdPerMTok:"4.0000",outputUsdPerMTok:"20.0000"},fallback:null}}});
assert.equal(parsed.tiers.high?.dailyCapUsd,6);assert.equal(parsed.tiers.high?.model.inputUsdPerMTok,4);
const sweep=async(route:()=>unknown,env:Record<string,string>)=>{const calls:{name:string;args:Record<string,unknown>}[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});
  if(name==="zoe_run_claim")return [job("My knee hurts after walking")];
  if(name==="zoe_run_urgent_window")return (args.p_runs as string[]).map(id=>({runId:id,urgentSinceMinutes:null}));
  if(name==="zoe_run_doctor_mode")return (args.p_runs as string[]).map(id=>({runId:id,doctorMode:false}));
  if(name==="zoe_route_config")return route();
  if(name==="zoe_run_reserve")return {ok:false,code:"model_calls_not_permitted"};
  if(name==="zoe_run_finish")return {ok:true,outcome:(args.p_result as {outcome:string}).outcome};
  throw Error(name);};
 const report=await runZoeSweep(rpc,{env:{NOREON_ZOE_TEST_LEXICON:"true",...env}});
 return {calls,report,finish:calls.find(c=>c.name==="zoe_run_finish")?.args.p_result as {reason:string;tier:string;model:string}};};
const unreadable=await sweep(()=>{throw Error("down");},{});
// Quality review C-1: unreadable routing claims nothing (the next sweep retries), so no message is finished as tier_not_configured.
assert.ok(!unreadable.calls.some(c=>c.name==="zoe_run_claim"||c.name==="zoe_run_reserve"||c.name==="zoe_run_finish"),"Unreadable routing: no claim, no reservation, no finish");
assert.equal(unreadable.report.failed,1);
// Gateway mode with the flag on: the reservation is asked for a non-local provider and refused; no call is made.
const gw=await sweep(()=>({ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers}),{NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_PRELAUNCH_STAGING:"true"});
const reserve=gw.calls.find(c=>c.name==="zoe_run_reserve")!.args;
assert.equal(reserve.p_local,false);assert.equal(reserve.p_tier,"high");assert.equal(reserve.p_model,"anthropic/claude-opus-5.5");
assert.equal(gw.finish.reason,"model_calls_not_permitted");assert.equal(gw.finish.tier,"high");
// Gateway selected without the app flag: provider unavailable before any reservation.
const noFlag=await sweep(()=>({ok:true,tiers:DEFAULT_ROUTE_CONFIG.tiers}),{NOREON_ZOE_PROVIDER:"gateway"});
assert.equal(noFlag.finish.reason,"provider_unavailable");assert.ok(!noFlag.calls.some(c=>c.name==="zoe_run_reserve"));

// Settings core: eval first, recorded by the server, applied by the admin only on a pass.
const settings:AiSettings={ok:true,modelCallsAllowed:false,settingsRow:true,stagingAiMode:false,directAnswersEnabled:false,totalCapUsd:10,spendDay:"2026-10-17",spentTodayUsd:0,
 tiers:[{tier:"low",model:"anthropic/claude-haiku-5.5",fallback:"openai/gpt-6-luna",dailyCapUsd:1,version:1,updatedAt:"2026-10-17T10:00:00Z",spentTodayUsd:0},
  {tier:"medium",model:"anthropic/claude-sonnet-5.5",fallback:"openai/gpt-6-sol",dailyCapUsd:3,version:1,updatedAt:"2026-10-17T10:00:00Z",spentTodayUsd:0},
  {tier:"high",model:"anthropic/claude-opus-5.5",fallback:"openai/gpt-6-astra",dailyCapUsd:6,version:1,updatedAt:"2026-10-17T10:00:00Z",spentTodayUsd:0}],
 catalog:[["anthropic/claude-haiku-5.5",1,0.1,0.5],["openai/gpt-6-luna",1,0.1,0.5],["anthropic/claude-sonnet-5.5",2,2,10],["openai/gpt-6-sol",2,2,10],["anthropic/claude-opus-5.5",3,4,20],["openai/gpt-6-astra",3,10,50],["anthropic/claude-fable-5.1",3,10,50],
  ["google/gemini-4-argon",3,2,10],["spacexai/grok-4.7",3,2,6],["deepseek/deepseek-v4-pro",2,0.66,1.98]]
  .map(([id,strength,i,o])=>({id:id as string,label:id as string,provider:(id as string).split("/")[0]!,strength:strength as number,inputUsdPerMTok:i as number,outputUsdPerMTok:o as number})),changes:[],evalRuns:[],
 providers:[["anthropic","Anthropic"],["openai","OpenAI"],["google","Google"],["spacexai","xAI"],["deepseek","DeepSeek"]].map(([id,label])=>({id:id!,label:label!,dataAgreement:"none" as const}))};
const enabled={NOREON_ZOE_AI_SETTINGS_ENABLED:"true"};
const ports=(applyResult:unknown={ok:true,version:2},record:unknown={ok:true,id:"5d2f4f0e-0000-4000-8000-000000000001"})=>{const log:{name:string;args:Record<string,unknown>}[]=[];
 return {log,admin:async(name:string,args:Record<string,unknown>)=>{log.push({name,args});return name==="zoe_ai_settings_admin"?settings:applyResult;},
  service:async(name:string,args:Record<string,unknown>)=>{log.push({name,args});return record;}};};
const change={tier:"high",model:"anthropic/claude-fable-5.1",fallback:"anthropic/claude-opus-5.5",dailyCapUsd:5,expectedVersion:1,reason:"Try Fable"};
assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",...ports(),env:{}}),{status:"disabled"});
for(const v of [1.1,2.3,0.07,5.55])assert.equal(tierChangeSchema.safeParse({...change,dailyCapUsd:v}).success,true,`limit ${v} accepted (Fable F-3)`);
assert.deepEqual(await applyTierChangeCore({...change,dailyCapUsd:11},{adminId:"a",...ports(),env:enabled}),{status:"invalid"});
assert.deepEqual(await applyTierChangeCore({...change,model:"openai/gpt-9"},{adminId:"a",...ports(),env:enabled}),{status:"invalid"},"Off the allow-list");
assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",admin:ports().admin,service:null,env:enabled}),{status:"unavailable"});
const good=ports();
const applied=await applyTierChangeCore(change,{adminId:"a",...good,env:enabled});
assert.equal(applied.status,"applied");assert.ok(applied.status==="applied"&&(applied.evalRows??0)>=262,"The real eval set ran (262+ rows)");
assert.deepEqual(good.log.map(l=>l.name),["zoe_ai_settings_admin","zoe_eval_run_record","zoe_tier_config_apply"],"Eval recorded before the apply");
const rec=good.log[1]!.args;assert.equal(rec.p_mode,"plumbing");assert.equal(rec.p_must_failures,0);assert.equal(rec.p_admin,"a");assert.equal(rec.p_model,change.model);
assert.equal(good.log[2]!.args.p_eval,"5d2f4f0e-0000-4000-8000-000000000001");assert.equal(good.log[2]!.args.p_daily_cap_usd,5);
const failing:()=>Promise<EvalSummary>=async()=>({harnessVersion:"x",total:279,mustFailures:2,failures:2,failedIds:["A01","R04"],results:[]});
const bad=ports();
assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",...bad,env:enabled,runEval:failing}),{status:"eval_failed",total:279,mustFailures:2,failedIds:["A01","R04"]});
assert.deepEqual(bad.log.map(l=>l.name),["zoe_ai_settings_admin","zoe_eval_run_record"],"A failed eval is recorded and never applied");
assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",...ports({ok:false,code:"stale"}),env:enabled}),{status:"refused",code:"stale"});
assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",...ports(undefined,{ok:false,code:"not_admin"}),env:enabled}),{status:"refused",code:"not_admin"});
assert.equal(candidateConfig(settings,"high","anthropic/claude-fable-5.1","anthropic/claude-fable-5.1"),null,"Fallback must differ from the model");
assert.deepEqual(await rollbackTierChangeCore({changeId:3,expectedVersion:2},{admin:async()=>({ok:true,version:3}),env:enabled}),{status:"rolled_back",version:3});
assert.deepEqual(await rollbackTierChangeCore({changeId:3,expectedVersion:2},{admin:async()=>({ok:false,code:"stale"}),env:enabled}),{status:"refused",code:"stale"});

// Staging AI mode: the admin model-mode eval runs real calls only with Gateway on, a basis for real
// calls and the database in staging mode (or calls already allowed); it records mode "model".
// It runs in the background (lead, 18 Oct: the high tier takes about 9 minutes): the action starts a
// job and returns; the deferred work records the eval run and closes the job, or closes it as failed.
{
 const gwEnv={...enabled,NOREON_ZOE_PROVIDER:"gateway",NOREON_ZOE_MODEL_CALLS_ENABLED:"true",NOREON_PRELAUNCH_STAGING:"true"};
 const fakeRun:typeof runModelEval=async i=>[{tier:i.tiers![0]!,model:i.config.tiers[i.tiers![0]!]!.model.id,fallback:i.config.tiers[i.tiers![0]!]!.fallback?.id??null,
  summary:{harnessVersion:"h",total:360,mustFailures:0,failures:3,failedIds:["M-X-1"],results:[]},lab:i.labTier?[]:null,transcript:[],costUsd:0.01,
  record:{total:365,mustFailures:0,failures:3,failedIds:["M-X-1"],harnessVersion:"h+lab-5"}}];
 // The real eval set with the stand-in provider in place of the Gateway model: the whole background path, no network.
 const fakeProviderRun:typeof runModelEval=async i=>{const tier=i.tiers![0]!;const cfg=i.config.tiers[tier]!;
  const summary=await runEvalSet({routeConfig:i.config,providerFor:()=>createFakeProvider(),modelProvider:createFakeProvider()});
  return [{tier,model:cfg.model.id,fallback:cfg.fallback?.id??null,summary,lab:null,transcript:[],costUsd:0,
   record:{total:summary.total,mustFailures:summary.mustFailures,failures:summary.failures,failedIds:summary.failedIds.slice(0,40),harnessVersion:summary.harnessVersion}}];};
 const JOB="5d2f4f0e-0000-4000-8000-0000000000aa",RUN="5d2f4f0e-0000-4000-8000-0000000000bb";
 const jobPorts=(start:unknown={ok:true,id:JOB},record:unknown={ok:true,id:RUN})=>{const p=ports();const base=p.admin;
  p.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true}:base(n,a);
  p.service=async(name,args)=>{p.log.push({name,args});return name==="zoe_model_eval_start"?start:name==="zoe_eval_run_record"?record:{ok:true};};
  const deferred:(()=>Promise<void>)[]=[];return {...p,deferred,defer:(w:()=>Promise<void>)=>{deferred.push(w);}};};
 const noDefer=()=>assert.fail("nothing may be deferred");
 assert.deepEqual(await runTierModelEvalCore({tier:"low"},{adminId:"a",...ports(),defer:noDefer,env:{...gwEnv,NOREON_PRELAUNCH_STAGING:undefined,NOREON_AI_WITHOUT_DPA_CONFIRMATION:"false"},run:fakeRun}),{status:"refused",code:"gateway_off"},"No basis for real calls in the app");
 assert.deepEqual(await runTierModelEvalCore({tier:"low"},{adminId:"a",...ports(),defer:noDefer,env:{...enabled,NOREON_PRELAUNCH_STAGING:"true"},run:fakeRun}),{status:"refused",code:"gateway_off"},"Gateway not selected");
 assert.deepEqual(await runTierModelEvalCore({tier:"low"},{adminId:"a",...ports(),defer:noDefer,env:gwEnv,run:fakeRun}),{status:"refused",code:"no_basis_for_real_calls"},"Database not in staging mode and calls not allowed");
 // Started: the action returns before any model call; the deferred work records, then closes the job.
 const st=jobPorts();let ran=0;
 const r=await runTierModelEvalCore({tier:"high"},{adminId:"a",...st,env:gwEnv,run:async i=>{ran++;return fakeRun(i);}});
 assert.deepEqual(r,{status:"eval_started",tier:"high",model:"anthropic/claude-opus-5.5"});
 assert.equal(ran,0,"No model call before the response");assert.equal(st.deferred.length,1);
 assert.deepEqual(st.log.find(l=>l.name==="zoe_model_eval_start")!.args,{p_admin:"a",p_tier:"high",p_model:"anthropic/claude-opus-5.5"});
 await st.deferred[0]!();
 assert.equal(ran,1);
 const recArgs=st.log.find(l=>l.name==="zoe_eval_run_record")!.args;
 assert.equal(recArgs.p_mode,"model");assert.equal(recArgs.p_total,365);assert.equal(recArgs.p_model,"anthropic/claude-opus-5.5");assert.equal(recArgs.p_tier,"high");
 assert.deepEqual(st.log.at(-1),{name:"zoe_model_eval_finish",args:{p_job:JOB,p_eval_run:RUN,p_error_code:null}},"The job closes with the recorded run");
 // The real eval set through the same path with the stand-in provider.
 const fp=jobPorts();
 assert.equal((await runTierModelEvalCore({tier:"low"},{adminId:"a",...fp,env:gwEnv,run:fakeProviderRun})).status,"eval_started");
 await fp.deferred[0]!();
 const fpRec=fp.log.find(l=>l.name==="zoe_eval_run_record")!.args;
 assert.ok((fpRec.p_total as number)>=262,"The full eval set ran with the stand-in provider");assert.equal(typeof fpRec.p_must_failures,"number","Its MUST failures (the model rows fail with a stand-in) are recorded as they are");
 assert.deepEqual(fp.log.at(-1)!.args,{p_job:JOB,p_eval_run:RUN,p_error_code:null});
 // A second start while one runs is refused by the database; nothing is deferred.
 assert.deepEqual(await runTierModelEvalCore({tier:"medium"},{adminId:"a",...jobPorts({ok:false,code:"eval_running"}),env:gwEnv,run:fakeRun,defer:noDefer}),{status:"refused",code:"eval_running"});
 // Failures close the job as failed, never leave it running.
 const errors:string[]=[];
 const boom=jobPorts();await runTierModelEvalCore({tier:"low"},{adminId:"a",...boom,env:gwEnv,run:async()=>{throw Error("gateway down");},onError:s=>errors.push(s)});
 await boom.deferred[0]!();
 assert.deepEqual(boom.log.at(-1),{name:"zoe_model_eval_finish",args:{p_job:JOB,p_eval_run:null,p_error_code:"run_failed"}});assert.deepEqual(errors,["run"]);
 const refused=jobPorts(undefined,{ok:false,code:"not_admin"});await runTierModelEvalCore({tier:"low"},{adminId:"a",...refused,env:gwEnv,run:fakeRun});
 await refused.deferred[0]!();
 assert.deepEqual(refused.log.at(-1)!.args,{p_job:JOB,p_eval_run:null,p_error_code:"record_refused"});
 const recent=ports();const b2=recent.admin;recent.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true,evalRuns:[{id:"5d2f4f0e-0000-4000-8000-000000000009",tier:"low",model:"anthropic/claude-haiku-5.5",fallback:null,mode:"model",harnessVersion:"h",totalRows:400,mustFailures:0,failures:0,failedIds:[],used:false,at:new Date(Date.now()-60_000).toISOString()}]}:b2(n,a);
 assert.deepEqual(await runTierModelEvalCore({tier:"low"},{adminId:"a",...recent,defer:noDefer,env:gwEnv,run:fakeRun}),{status:"refused",code:"eval_recent"},"One model eval per tier per 10 minutes");
 assert.deepEqual(await runTierModelEvalCore({tier:"top"},{adminId:"a",...ports(),defer:noDefer,env:gwEnv,run:fakeRun}),{status:"invalid"});
 assert.deepEqual(await runTierModelEvalCore({tier:"low"},{adminId:"a",...ports(),defer:noDefer,env:{},run:fakeRun}),{status:"disabled"});
 // The page's job read; an older database without the jobs read is handled by the page.
 // Model mode tier change (lead 18 Oct): the candidate's eval runs in the background on the job; the change
 // applies only after the recorded eval passes, never in the request.
 {const mp=jobPorts();const b3=mp.admin;mp.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true,modelCallsAllowed:true}:b3(n,a);
  let ran2=0;
  const r2=await applyTierChangeCore(change,{adminId:"a",...mp,env:gwEnv,run:async i=>{ran2++;assert.deepEqual(i.tiers,["high"]);assert.equal(i.config.tiers.high!.model.id,change.model);return fakeRun(i);}});
  assert.deepEqual(r2,{status:"apply_started",tier:"high",model:change.model});assert.equal(ran2,0,"No model call before the response");
  assert.ok(!mp.log.some(l=>l.name==="zoe_tier_config_apply"),"Nothing applied in the request");
  await mp.deferred[0]!();
  assert.deepEqual(mp.log.filter(l=>l.name!=="zoe_ai_settings_admin").map(l=>l.name),["zoe_model_eval_start","zoe_eval_run_record","zoe_tier_config_apply","zoe_model_eval_finish"],"Recorded, applied, then the job closes");
  assert.deepEqual(mp.log.at(-1)!.args,{p_job:JOB,p_eval_run:RUN,p_error_code:null},"Applied: the job closes as done with the run");
  // A refused apply (stale version) or an apply error closes the job as failed, so the page never says it applied (Codex F1).
  for(const [applyPort,code] of [[async()=>({ok:false,code:"stale"}),"apply_refused"],[async()=>{throw Error("rpc down");},"apply_failed"]]as const){
   const ap=jobPorts();const b6=ap.admin;ap.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true,modelCallsAllowed:true}:n==="zoe_tier_config_apply"?(ap.log.push({name:n,args:a}),applyPort()):b6(n,a);
   await applyTierChangeCore(change,{adminId:"a",...ap,env:gwEnv,run:fakeRun,onError:()=>undefined});await ap.deferred[0]!();
   assert.deepEqual(ap.log.at(-1),{name:"zoe_model_eval_finish",args:{p_job:JOB,p_eval_run:null,p_error_code:code}},`${code}: job closed as failed`);
  }
  assert.equal(mp.log.find(l=>l.name==="zoe_eval_run_record")!.args.p_mode,"model");
  // A failing candidate eval is recorded and never applied.
  const mf=jobPorts();const b4=mf.admin;mf.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true,modelCallsAllowed:true}:b4(n,a);
  await applyTierChangeCore(change,{adminId:"a",...mf,env:gwEnv,run:async i=>{const [x]=await fakeRun(i);return [{...x!,record:{...x!.record,mustFailures:1}}];}});
  await mf.deferred[0]!();
  assert.ok(!mf.log.some(l=>l.name==="zoe_tier_config_apply"),"A failing model eval never applies");
  assert.deepEqual(mf.log.at(-1)!.args,{p_job:JOB,p_eval_run:RUN,p_error_code:null},"A failing eval closes the job with its recorded run (the page shows the MUST failures)");
  // Without a background runner the model-mode change is refused, not run in the request.
  const md=jobPorts();const b5=md.admin;md.admin=async(n,a)=>n==="zoe_ai_settings_admin"?{...settings,stagingAiMode:true,modelCallsAllowed:true}:b5(n,a);
  assert.deepEqual(await applyTierChangeCore(change,{adminId:"a",admin:md.admin,service:md.service,env:gwEnv,run:fakeRun}),{status:"unavailable"});}
 assert.equal(evalJobSchema.parse({ok:true,job:null}).job,null);
 assert.equal(evalJobSchema.parse({ok:true,job:{id:JOB,tier:"high",model:"anthropic/claude-opus-5.5",status:"done",errorCode:null,startedAt:"2026-10-18T11:00:00Z",finishedAt:"2026-10-18T11:09:00Z",result:{total:646,mustFailures:0,failedIds:[]}}}).job?.result?.total,646);
}

// Providers beyond Anthropic and OpenAI: the admin read carries each one's data agreement, and a
// tier change to a new provider goes through the same eval gate. Older payloads without providers still parse.
const noProviders={...settings,providers:undefined};
assert.deepEqual(aiSettingsSchema.parse(noProviders).providers,[],"A database before the provider migration reads as no providers");
assert.equal(aiSettingsSchema.parse(settings).providers.length,5);
assert.ok(aiSettingsSchema.parse(settings).providers.every(x=>x.dataAgreement==="none"),"No provider has a data agreement yet");
assert.throws(()=>aiSettingsSchema.parse({...settings,providers:[{id:"google",label:"Google",dataAgreement:"maybe"}]}),"An unknown agreement state is rejected");
const xai=ports();
const toGrok=await applyTierChangeCore({...change,model:"spacexai/grok-4.7",fallback:"google/gemini-4-argon"},{adminId:"a",...xai,env:enabled});
assert.equal(toGrok.status,"applied");
assert.deepEqual(xai.log.map(l=>l.name),["zoe_ai_settings_admin","zoe_eval_run_record","zoe_tier_config_apply"],"A new provider is eval-gated like the others");
assert.equal(xai.log[1]!.args.p_model,"spacexai/grok-4.7");assert.equal(xai.log[1]!.args.p_fallback,"google/gemini-4-argon");assert.equal(xai.log[1]!.args.p_mode,"plumbing","Real calls off: plumbing eval");
assert.equal(candidateConfig(settings,"medium","deepseek/deepseek-v4-pro",null)?.tiers.medium?.model.inputUsdPerMTok,0.66,"The candidate carries the new model's price");
const grokSeen:Parameters<GatewayGenerate>[0][]=[];
const grok=createGatewayProvider({id:"spacexai/grok-4.7",inputUsdPerMTok:2,outputUsdPerMTok:6},{env:{},generate:async a=>{grokSeen.push(a);throw Error("network");}});
assert.equal((await grok.complete(req)).kind,"error");assert.equal(grokSeen.length,0,"No call to a new provider while the app flag is off");
assert.equal(createGatewayProvider({id:"google/gemini-4-argon",inputUsdPerMTok:2,outputUsdPerMTok:10},{env:on,generate:okGen}).requestModel,"google/gemini-4-argon","The Gateway id is passed through as is");

globalThis.fetch=realFetch;
// 19 Oct (AI eval, lead): the high tier accepts a Mid model below its recommended class (the page marks it); Small stays out.
assert.deepEqual(TIER_FLOOR,{low:1,medium:2,high:2});assert.deepEqual(TIER_RECOMMENDED,{low:1,medium:2,high:3});
assert.equal(tierClassFit("high",3),"recommended");assert.equal(tierClassFit("high",2),"below_recommended");assert.equal(tierClassFit("high",1),"not_allowed");
assert.equal(tierClassFit("medium",1),"not_allowed");assert.equal(tierClassFit("medium",2),"recommended");assert.equal(tierClassFit("low",1),"recommended");
assert.match(BELOW_RECOMMENDED_TEXT,/eval required/);
console.log("Zoe AI settings checks passed.");
