import assert from 'node:assert/strict';
import {askDecisions,buildDecisionsRequest,decisionsFlags,decisionsMode,decisionsTraceEvent,parseDecisionsResponse,DECISIONS_MAX_CHARS,DECISIONS_MAX_MESSAGES,type CurrentDecision} from '@/lib/zoe/decisions';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {createFakeProvider} from '@/lib/zoe/provider';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';

// AbortSignal.timeout timers do not keep the process alive; the server always is.
const decisionsFlagsOf=(v:string)=>decisionsFlags({NOREON_ZOE_DECISIONS:v,OPENAI_API_KEY2:'k'});
const keepAlive=setInterval(()=>{},1_000);
const answer=(name:string,choice:string,options:string[],confidence=0.9)=>({name,type:'choice',choice,confidence,probabilities:options.map(v=>({value:v,probability:v===choice?0.9:0.1/(options.length-1)}))});
const ROUTE=['low','medium','high'],LANG=['en','hy','hy-Latn','ru'],TOPIC=['same','new'];
const okBody=(topic=true)=>({answers:[answer('route','high',ROUTE),answer('language','hy-Latn',LANG),...(topic?[answer('topic','new',TOPIC)]:[])],usage:{input_tokens:120,output_tokens:0}});
const respond=(body:unknown,status=200)=>async()=>new Response(JSON.stringify(body),{status});
const env={NOREON_ZOE_DECISIONS:'shadow',OPENAI_API_KEY2:'test-key-not-real'};

// Flag: off unless exactly shadow and a key exists.
assert.equal(decisionsMode(env),'shadow');
assert.equal(decisionsMode({...env,NOREON_ZOE_DECISIONS:'on'}),'off');
assert.equal(decisionsMode({NOREON_ZOE_DECISIONS:'shadow'}),'off');
assert.equal(decisionsMode({}),'off');

// Request: topic only with an earlier message; window and length bounded; no ids.
{
 const one=buildDecisionsRequest(['hello']);
 assert.deepEqual(one.questions.map(q=>q.name),['route','language']);
 const many=buildDecisionsRequest(Array.from({length:10},(_,i)=>`m${i}`.padEnd(DECISIONS_MAX_CHARS+50,'x')));
 assert.deepEqual(many.questions.map(q=>q.name),['route','language','topic']);
 const sent=JSON.parse(many.input).memberMessages as string[];
 assert.equal(sent.length,DECISIONS_MAX_MESSAGES);assert.ok(sent.every(t=>t.length===DECISIONS_MAX_CHARS));assert.ok(sent[0]!.startsWith('m4'));
}

// Response: strict.
{
 const req=buildDecisionsRequest(['a','b']);
 assert.equal(parseDecisionsResponse(okBody(),req)?.route.value,'high');
 assert.equal(parseDecisionsResponse(okBody(false),req),null,'a missing answer is a bad shape');
 assert.equal(parseDecisionsResponse({answers:[answer('route','urgent',ROUTE),answer('language','en',LANG),answer('topic','same',TOPIC)]},req),null,'unknown option');
 assert.equal(parseDecisionsResponse({answers:[answer('route','low',ROUTE),answer('route','low',ROUTE),answer('topic','same',TOPIC)]},req),null,'duplicate answer');
 assert.equal(parseDecisionsResponse({answers:[answer('route','low',ROUTE,1.4),answer('language','en',LANG),answer('topic','same',TOPIC)]},req),null,'confidence out of range');
 assert.equal(parseDecisionsResponse('nope',req),null);
}

// Call: ok, http error, timeout, network, bad JSON, bad shape. Never throws; the key goes only in the header.
{
 let seen:{url:string;auth:string|null;body:string}|null=null;
 const spy=async(url:RequestInfo|URL,init?:RequestInit)=>{seen={url:String(url),auth:new Headers(init?.headers).get('authorization'),body:String(init?.body)};return new Response(JSON.stringify(okBody()),{status:200});};
 const r=await askDecisions(['hi','Zhamy ban e'],env,{fetchImpl:spy as typeof fetch});
 assert.ok(r.ok&&r.verdict.language.value==='hy-Latn'&&r.inputTokens===120);
 assert.equal(seen!.url,'https://api.openai.com/v1/decisions');assert.equal(seen!.auth,'Bearer test-key-not-real');assert.ok(!seen!.body.includes('test-key-not-real'));
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:respond({},500)as typeof fetch}).then(r=>!r.ok&&r.reason),'http_error');
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:respond({answers:[]})as typeof fetch}).then(r=>!r.ok&&r.reason),'bad_shape');
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:(async()=>new Response('<html>',{status:200}))as typeof fetch}).then(r=>!r.ok&&r.reason),'bad_shape');
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:(async()=>{throw new TypeError('fetch failed');})as typeof fetch}).then(r=>!r.ok&&r.reason),'network');
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:(async()=>{throw new DOMException('t','TimeoutError');})as typeof fetch}).then(r=>!r.ok&&r.reason),'timeout');
 const slow=(async(_u:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_,rej)=>init?.signal?.addEventListener('abort',()=>rej(init.signal!.reason))))as typeof fetch;
 assert.deepEqual(await askDecisions(['x'],env,{fetchImpl:slow,timeoutMs:30}).then(r=>!r.ok&&r.reason),'timeout');
}

// Trace line: labels only, agreement and direction.
{
 const cur:CurrentDecision={tier:'medium',base:'medium',language:'en',replyLanguage:'en',topic:'same'};
 const r=await askDecisions(['a','b'],env,{fetchImpl:respond(okBody())as typeof fetch});
 const e=decisionsTraceEvent(r,cur);
 assert.equal(e.name,'zoe.route.decisions');assert.equal(e.outcome,'recorded');
 assert.equal(e.attributes['noreon.zoe.decisions.route_vs_tier'],'higher');
 assert.equal(e.attributes['noreon.zoe.decisions.language_agrees'],false);
 assert.equal(e.attributes['noreon.zoe.decisions.topic_agrees'],false);
 assert.equal((decisionsTraceEvent(r,{...cur,topic:'undecided'}).attributes as Record<string,unknown>)['noreon.zoe.decisions.topic_agrees'],'undecided');
 assert.ok(!JSON.stringify(e).includes('"a"'),'no member text in the trace');
 const f=decisionsTraceEvent({ok:false,reason:'timeout',latencyMs:1500},cur);
 assert.equal(f.outcome,'skipped');assert.equal(f.reason,'decisions_timeout');
}

// Pipeline: the run is identical with the flag on, off, and when the API fails; the trace line appears only for a real model.
const free=(texts:string[])=>job(texts,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
const real={...createFakeProvider(),local:false};
const base={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const realFetch=globalThis.fetch;
let calls=0;
const install=(f:()=>Promise<Response>)=>{globalThis.fetch=(async()=>{calls++;return f();})as typeof fetch;};
try{
 const texts=['My blood pressure was 135/85 today, what does that mean?'];
 const run=async(e:Record<string,string>,o:{provider?:typeof real;input?:ReturnType<typeof free>;reserveCode?:string;memberSpentTodayUsd?:number}={})=>
  runPipeline(o.input??free(texts),{directAnswers:true,allowRemote:true,env:{...base,...e},provider:o.provider??real,...(o.reserveCode?{reserveCode:o.reserveCode}:{}),...(o.memberSpentTodayUsd!==undefined?{memberSpentTodayUsd:o.memberSpentTodayUsd}:{})});
 type R=Awaited<ReturnType<typeof run>>;
 const strip=(r:R)=>JSON.stringify({o:r.outcome,a:r.finish?.answer??null,rc:r.finish?.receipt??null,reason:r.finish?.reason??r.reason,u:r.finish?.health??null});
 const find=(r:R)=>(r.events??[]).filter(e=>e.name==='zoe.route.decisions');
 install(async()=>new Response(JSON.stringify(okBody(false)),{status:200}));
 const off=await run({});assert.equal(calls,0,'flag off: no call');assert.equal(find(off).length,0);
 assert.ok(off.reserved&&!off.reserved.local,'the fixture reaches a real-model reservation');
 const on=await run(env);
 assert.equal(calls,1,'flag on with a real model: one call');
 assert.equal(strip(on),strip(off),'shadow changes nothing the member sees');
 const line=find(on);assert.equal(line.length,1,'the trace has one Decisions line');
 assert.equal(line[0]!.attributes['noreon.zoe.decisions.status'],'ok');assert.ok(line[0]!.attributes['noreon.zoe.decisions.current_tier']);
 assert.ok(!JSON.stringify(line).includes('blood pressure'),'no member text in the trace');
 // The stand-in model: no call.
 calls=0;await run(env,{provider:createFakeProvider() as typeof real});assert.equal(calls,0,'stand-in model: no call');
 // Every refusal at the reservation (consent, database permission, spend caps) sends nothing.
 for(const code of ['no_zoe_reads_messages_consent','model_calls_not_permitted','daily_spend_cap_reached','member_spend_cap_reached','tier_spend_cap_reached']){
  const r=await run(env,{reserveCode:code});assert.equal(calls,0,`refusal ${code}: no call`);assert.equal(find(r).length,0);
 }
 {const r=await run(env,{memberSpentTodayUsd:100});assert.equal(calls,0,'member already over the cap: no call');void r;}
 // A deterministic emergency exit sends nothing and is not delayed by a hung API.
 {
  install(()=>new Promise(()=>{}));
  const urgent={...free(['My face feels odd','Yes']),answers:[{body:'Is one side of your face drooping right now?',minutesAgo:1}]};
  const t0=Date.now();const r=await run(env,{input:urgent});
  assert.equal(calls,0,'urgent exit: no call');assert.ok(Date.now()-t0<1_000,'urgent exit is not delayed');
  assert.ok(/urgent|red_flag|emergency/u.test(`${r.outcome} ${r.finish?.reason??r.reason}`),`urgent path reached (${r.outcome}/${r.finish?.reason??r.reason})`);
 }
 calls=0;
 install(async()=>{throw new TypeError('fetch failed');});
 const failed=await run(env);assert.equal(calls,1);assert.equal(strip(failed),strip(off),'a failing API changes nothing');
 assert.equal(find(failed)[0]?.outcome,'skipped');
 install(()=>new Promise(()=>{}));
 const hung=await Promise.race([run(env),new Promise<'hung'>(r=>setTimeout(()=>r('hung'),5000))]);
 assert.notEqual(hung,'hung','a hung API never holds the run');
}finally{globalThis.fetch=realFetch;}

// ---- The three switchable effects: language, route (raise only), topic (veto only). ----
{
 const bodyOf=(o:{route?:string;language?:string;topic?:string;conf?:number})=>({answers:[answer('route',o.route??'low',ROUTE,o.conf??0.95),answer('language',o.language??'en',LANG,o.conf??0.95),answer('topic',o.topic??'new',TOPIC,o.conf??0.95)]});
 // Answers exactly the questions asked (topic only comes with an earlier message), like the real API.
 let stub:Parameters<typeof bodyOf>[0]={};
 const serve=(o:Parameters<typeof bodyOf>[0])=>{stub=o;globalThis.fetch=(async(_u:RequestInfo|URL,init?:RequestInit)=>{
  calls++;const asked=(JSON.parse(String(init?.body)).questions as {name:string}[]).map(q=>q.name);
  return new Response(JSON.stringify({answers:bodyOf(stub).answers.filter(a=>asked.includes(a.name))}),{status:200});})as typeof fetch;};
 const mk=(texts:string[],locale:'en'|'hy'|'ru'|null='en')=>job(texts,{directAnswers:true,healthAnswers:true,
  conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale},
  intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
 const go=async(flag:string,texts:string[],o:{locale?:'en'|'hy'|'ru'|null;mutate?:(j:ReturnType<typeof mk>)=>void;classifierCode?:string;noPort?:boolean}={})=>{
  const j=mk(texts,o.locale);o.mutate?.(j);
  return runPipeline(j,{directAnswers:true,allowRemote:true,env:{...base,...(flag?{NOREON_ZOE_DECISIONS:flag,OPENAI_API_KEY2:'test-key-not-real'}:{})},provider:real,...(o.classifierCode?{classifierCode:o.classifierCode}:{}),...(o.noPort?{noClassifierPort:true}:{})});
 };
 // The language effect is applied at the routing site, after the scope line is written, so it shows in the trace effects and in the reply language.
 const lang=(r:Awaited<ReturnType<typeof go>>)=>String(r.events.find(e=>e.name==='zoe.route.decisions')?.attributes['noreon.zoe.decisions.effects']).includes('language_hy_latn')?'hy-Latn':r.events.find(e=>e.name==='zoe.guard.scope')?.attributes['noreon.zoe.language'];
 const effects=(r:Awaited<ReturnType<typeof go>>)=>r.events.find(e=>e.name==='zoe.route.decisions')?.attributes['noreon.zoe.decisions.effects'];
 const find2=(r:Awaited<ReturnType<typeof go>>)=>r.events.find(e=>e.name==='zoe.route.decisions');
 const LOW=['What time does the clinic open tomorrow?'],HIGH=['Can I take my statin at night?'];

 // Flags.
 const f=(v:string)=>decisionsFlagsOf(v);
 assert.deepEqual([f('route').route,f('route').language,f('route').shadow,f('route').effects],[true,false,false,true]);
 assert.deepEqual([f('Shadow, language topic').shadow,f('Shadow, language topic').language,f('Shadow, language topic').topic,f('Shadow, language topic').route],[true,true,true,false]);
 assert.equal(decisionsFlags({NOREON_ZOE_DECISIONS:'route'}).any,false,'no key, no flags');
 assert.equal(decisionsFlags({NOREON_ZOE_DECISIONS:'on',OPENAI_API_KEY2:'k'}).any,false,'unknown words do nothing');

 // Route: raise only.
 serve({route:'high'});
 const base0=await go('shadow',LOW);assert.equal(base0.reserved?.tier,'low');assert.equal(effects(base0),'none');
 const raised=await go('route',LOW);assert.equal(raised.reserved?.tier,'high','route switch: low raised to high');assert.equal(effects(raised),'route_raised');
 assert.notEqual(raised.finish?.reason,undefined);
 serve({route:'medium'});assert.equal((await go('route',LOW)).reserved?.tier,'medium','low raised to medium');
 serve({route:'low'});assert.equal((await go('route',HIGH)).reserved?.tier,'high','never lowered');
 serve({route:'low'});assert.equal((await go('route',LOW)).reserved?.tier,'low','agreement changes nothing');
 serve({route:'high',conf:0.4});assert.equal((await go('route',LOW)).reserved?.tier,'low','a weak answer changes nothing');
 serve({route:'high'});assert.equal((await go('shadow',LOW)).reserved?.tier,'low','shadow alone never raises');
 serve({route:'high'});assert.equal((await go('language topic',LOW)).reserved?.tier,'low','other switches never raise');
 // A failed or hung API leaves the tier alone.
 install(async()=>{throw new TypeError('fetch failed');});assert.equal((await go('route',LOW)).reserved?.tier,'low');
 install(()=>new Promise(()=>{}));{const t0=Date.now();assert.equal((await go('route',LOW)).reserved?.tier,'low');assert.ok(Date.now()-t0<3_000,'hung API is bounded');}
 // Authorization first: every refusal of the database check (consent, model calls not permitted for the provider, daily and member caps) sends nothing, for every switch.
 serve({route:'high'});
 for(const code of ['no_zoe_reads_messages_consent','model_calls_not_permitted','daily_spend_cap_reached','member_spend_cap_reached','run_not_authorizable']){
  for(const flag of ['route','language route topic','shadow','shadow language route topic']){
   calls=0;const r=await go(flag,LOW,{classifierCode:code});
   assert.equal(calls,0,`${code} (${flag}): nothing sent`);assert.notEqual(r.reserved?.tier==='high'&&flag!=='shadow',true,`${code}: not raised`);
   assert.ok((r.classifierAuths??0)<=1,'asked once at most');
   if(flag.includes('route')||flag.includes('shadow')){const e=find2(r);assert.ok(!e||e.reason==='decisions_not_authorized','a refusal leaves at most a skipped trace line');}
  }
 }
 {calls=0;const r=await go('route',LOW,{noPort:true});assert.equal(calls,0,'no authorization port: nothing sent');assert.notEqual(r.reserved?.tier,'high');}
 {calls=0;const r=await go('route',LOW,{mutate:j=>{j.conversation!.enabled=false;}});assert.equal(calls,0,'conversation off: nothing sent');void r;}
 {calls=0;install(async()=>new Response('{}'));const r=await go('route',LOW);assert.equal(r.classifierAuths,1,'authorized once');}
 // A yes to Zoe's own question never waits and is never raised.
 install(()=>new Promise(()=>{}));
 for(const flag of ['route','language','topic','shadow','shadow language route topic'])
 {const t0=Date.now();calls=0;const r=await go(flag,['My face feels odd','Yes'],{mutate:j=>{j.answers=[{body:'Is one side of your face drooping right now?',minutesAgo:1}];}});
  assert.ok(Date.now()-t0<1_000,`urgent yes is not delayed (${flag})`);assert.equal(calls,0,`urgent yes sends nothing (${flag})`);assert.match(`${r.outcome} ${r.finish?.reason??r.reason}`,/urgent|red_flag|emergency/u);}

 // Every fixed exit (a doctor request, a same-day reading with one, a yes to Zoe's question) sends nothing and never waits, with every switch and a hanging classifier.
 install(()=>new Promise(()=>{}));
 for(const [label,texts,mutate]of [
  ['same-day reading plus doctor request',['My triglycerides are 12 mmol/L. Please send this to my doctor.'],undefined],
  ['doctor request',['Please send this to my doctor.'],undefined],
  ['yes to a question of Zoe',['Yes'],(j:ReturnType<typeof mk>)=>{j.conversation!.answeredThroughSeq=1;j.messages=[{seq:1,text:'My knee hurts when I walk',minutesAgo:5},{seq:2,text:'Yes',minutesAgo:1}];j.messageSeq=2;j.answers=[{body:'Shall I send this to your doctor?',minutesAgo:3}];}],
 ]as const)for(const flag of ['route','language','topic','shadow','shadow language route topic']){
  const t0=Date.now();calls=0;const r=await go(flag,[...texts],{mutate:mutate as never});
  assert.equal(calls,0,`${label} (${flag}): nothing sent`);assert.ok(Date.now()-t0<1_000,`${label} (${flag}): not delayed (${r.outcome}/${r.finish?.reason??r.reason})`);
 }
 // A raised tier whose provider is unavailable is not applied (Astra round 3): the run finishes normally on today's tier, on the legacy path too.
 serve({route:'high'});
 {
  const routing={config:{tiers:{low:{model:{id:'low-m'},fallback:null,version:'t'},medium:{model:{id:'med-m'},fallback:null,version:'t'},high:{model:{id:'high-m'},fallback:null,version:'t'}}},
   providerFor:(m:{id:string})=>m.id==='high-m'?null:real,classifier:undefined};
  for(const legacy of [false,true]){
   const j=mk(LOW,'en');if(legacy)j.healthAnswers=false;
   const r=await runPipeline(j,{directAnswers:true,allowRemote:true,env:{...base,NOREON_ZOE_DECISIONS:'route',OPENAI_API_KEY2:'test-key-not-real'},provider:real,routing:routing as never});
   assert.ok(r.finish!==null,`unavailable raised provider (legacy=${legacy}): the run finishes normally`);
   assert.notEqual(r.reserved?.tier,'high','the unavailable tier is not used');
  }
 }
 // Language: English becomes Armenian in Latin letters only for a member with Armenian in the chat, only when sure.
 serve({language:'hy-Latn'});
 const LATN=['nayev ashxatanqy ban chi'];
 // The member's chat has Armenian script earlier but the app language is English, so today's own override (which needs the Armenian app language) does not apply.
 const HIST=(j:ReturnType<typeof mk>)=>{j.messages.unshift({seq:0,text:'Բարև, ես ունեմ հարց',minutesAgo:30});};
 assert.equal(lang(await go('',LATN,{mutate:HIST})),'en','without the switch nothing changes');
 assert.equal(lang(await go('shadow',LATN,{mutate:HIST})),'en','shadow alone never changes the language');
 assert.equal(lang(await go('language',LATN,{mutate:HIST})),'hy-Latn','Armenian in the chat: English becomes hy-Latn');
 assert.equal(effects(await go('language',LATN,{mutate:HIST})),'language_hy_latn');
 assert.equal(lang(await go('language',LATN)),'en','no Armenian in the chat: no change');
 serve({language:'hy-Latn',conf:0.5});assert.equal(lang(await go('language',LATN,{mutate:HIST})),'en','an unsure answer changes nothing');
 serve({language:'ru'});assert.equal(lang(await go('language',LATN,{mutate:HIST})),'en','only hy-Latn is ever applied');
 serve({language:'en'});assert.equal(lang(await go('language',['Ողջույն, ինչպես եք'],{locale:'hy'})),'hy','Armenian script is never touched');
 serve({language:'hy-Latn'});assert.equal(lang(await go('route topic',LATN,{mutate:HIST})),'en','other switches never change the language');
 // The reply is Armenian when the language was turned (the unsure-language tier-up applies too).
 {const a=await go('language',LATN,{mutate:HIST});assert.equal(a.providerCalls.filter(c=>c.purpose==='health_answer').at(-1)?.replyLanguage,'hy','the reply is Armenian');
  const b=await go('',LATN,{mutate:HIST});assert.equal(b.providerCalls.filter(c=>c.purpose==='health_answer').at(-1)?.replyLanguage,'en','control: English without the switch');}

 // Topic: a rule-made "new question" can be vetoed; the member's button and a first message cannot.
 // Ten hours after an answered medicine question, a plain breakfast question: the rules call it a new, independent question and route it alone.
 const TWO=['Can I take my statin at night?','What is a healthy breakfast?'];
 const LATER=(j:ReturnType<typeof mk>)=>{j.messages[0]!.minutesAgo=600;j.messages[1]!.minutesAgo=1;j.conversation!.answeredThroughSeq=1;j.answers=[{body:'Noted, thank you.',minutesAgo:590}];};
 const rank:Record<string,number>={low:1,medium:2,high:3};
 const t=(r:Awaited<ReturnType<typeof go>>)=>rank[r.reserved?.tier??'low']!;
 serve({topic:'same'});
 const none=await go('',TWO,{mutate:LATER}),shadowOnly=await go('shadow',TWO,{mutate:LATER}),veto=await go('topic',TWO,{mutate:LATER});
 assert.ok(t(none)<3,'the rules route the breakfast question alone (below high)');
 assert.equal(t(shadowOnly),t(none),'shadow alone changes nothing');
 assert.equal(effects(veto),'topic_kept_window','a same-matter answer vetoes the new question');
 assert.equal(veto.reserved?.tier,'high','the whole window counts again, so the medicine question lifts the tier');
 const answerBlock=(r:Awaited<ReturnType<typeof go>>)=>r.providerCalls.filter(c=>c.purpose==='health_answer').map(c=>c.memberBlock).join('\n');
 assert.ok(answerBlock(veto).includes('statin'),'the veto carries into the answering context: the earlier question is in the prompt');
 assert.ok(!answerBlock(none).includes('statin'),'without the veto the rules drop it (control)');
 assert.equal(veto.events.find(e=>e.name==='zoe.topic')?.attributes['noreon.zoe.topic.source'],'classifier','the topic record says Decisions decided');
 serve({topic:'new'});const agree=await go('topic',TWO,{mutate:LATER});assert.equal(agree.reserved?.tier,none.reserved?.tier);assert.equal(effects(agree),'none');
 serve({topic:'same',conf:0.5});assert.equal((await go('topic',TWO,{mutate:LATER})).reserved?.tier,none.reserved?.tier,'an unsure answer changes nothing');
 serve({topic:'same'});assert.equal((await go('route language',TWO,{mutate:LATER})).reserved?.tier,none.reserved?.tier,'other switches never veto');
 // The member's own "New question" button is never overruled.
 {const r=await go('topic',TWO,{mutate:j=>{LATER(j);j.topic={breakAfterSeq:1,startSeq:null,zoeOwns:false,profile:null};}});assert.notEqual(effects(r),'topic_kept_window');}
}
clearInterval(keepAlive);
console.log('Zoe Decisions shadow checks passed');
