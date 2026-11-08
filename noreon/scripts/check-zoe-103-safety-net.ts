import assert from "node:assert/strict";
import {registeredSheets} from "@/lib/zoe/symptoms/intake";
import {textRedFlags} from "@/lib/zoe/symptoms/red-flags";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {routeTier} from "@/lib/zoe/routing";
import {classifyScope} from "@/lib/zoe/scope";
import {URGENT_STEPS_TEXT} from "@/lib/zoe/health-answer";
import {loadDataset} from "@/lib/zoe/eval/armen-dataset";
import {isCorrection,mentionsSymptomWord,modelWindowExit,readUrgencyVerdict,RED_FLAG_QUESTION_TEXT,symptomTypos,unclearSymptom} from "@/lib/zoe/urgent-check";
import type {ZoeJob} from "@/lib/zoe/pipeline";

/**
 * The 103 safety net (lib/zoe/urgent-check.ts; Armen and Khikar, 20 Oct 19:00 and addendum). Armen's three staging messages of
 * 20 Oct are regressions: 18:49 «Սրտխոնց ունեմ, քիչ առաջ սկսվեց» (a typo for nausea) got the 103 text from the light tier's model;
 * 18:50 and 19:41 the 103 window repeated it to his correction and to a new topic. Deterministic: the stand-in model only.
 */
const STAGING={NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"};
const ARMEN_1="Սրտխոնց ունեմ, քիչ առաջ սկսվեց";
const ARMEN_2="Բայց ես սովորական սրտխառնոց ունեմ, ինչու ես առաջարկում շտապ օգնությանը դիմեմ";
const ARMEN_3="Ատամնացավ ու գլխացավ";
const free=(texts:string[],extra:Partial<ZoeJob>={})=>job(texts,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"hy"},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0,resumable:null},...extra});
const run=(j:ZoeJob)=>runPipeline(j,{directAnswers:true,env:STAGING});
const tier=(texts:string[])=>routeTier(texts,classifyScope(texts.at(-1)!));

// ------------------------------------------------------------------ (a) symptom words and typos never reach the low tier
// The staging run: a "thanks" earlier in the window made the whole window logistics (rule_logistics, Haiku).
for(const w of [[ARMEN_1],["Շնորհակալություն",ARMEN_1],["Բարև","Արդեն մի քանի օր է այդպես է"],["thanks","I feel nausia"],["спасибо","тошнато"],["ok","srtxarnoc unem"],["hello","palpitaions since morning"]]){
 const d=tier(w);assert.notEqual(d.tier,"low",`never the low tier: ${JSON.stringify(w)} -> ${d.tier} (${d.reason})`);
}
for(const t of [ARMEN_1,"սրտխարնոց ունեմ","I feel nausia","тошнато","srtxarnoc","Ինձ մոտ գլխապտուտ կա"])assert.ok(mentionsSymptomWord(t),`symptom word: ${t}`);
for(const t of ["Շնորհակալություն, լավ եմ","սրտանց շնորհակալ եմ","Ես գլխավոր բժշկի մոտ եմ","Ինչպես գրանցվել այցի համար","When is my visit?"])assert.ok(!mentionsSymptomWord(t),`not a symptom word: ${t}`);
// Logistics alone still go to the low tier (and "Բարև" is recognised: the normaliser writes it «բարեւ»).
assert.equal(tier(["Բարև","Երբ է այցս"]).tier,"low");assert.equal(tier(["When is my visit?"]).tier,"low");

// ------------------------------------------------------------------ (d) an unclear symptom word: one clarifying question first
assert.deepEqual(unclearSymptom(ARMEN_1)?.meanings.sort(),["nausea","palpitations"]);
for(const t of ["սրտխարնոց ունեմ",ARMEN_2,ARMEN_3,"I feel nausia"])assert.equal(unclearSymptom(t),null,`not unclear: ${t}`);
// No clarifying question on any member turn of Armen's dataset or the go-live suites (spelling is fine there).
{const d=loadDataset();const noisy=d.scenarios.flatMap(s=>s.turns.filter(t=>t.role==="user").map(t=>t.text)).filter(t=>unclearSymptom(t));
 assert.deepEqual(noisy,[],`dataset turns that would get a clarifying question: ${noisy.join(" | ")}`);
 const typos=d.scenarios.flatMap(s=>s.turns.filter(t=>t.role==="user").flatMap(t=>symptomTypos(t.text)));
 assert.ok(typos.length<=4,`few typo words in the dataset: ${JSON.stringify(typos)}`);}
{const r=await run(free([ARMEN_1]));
 assert.equal(r.reason,"unclear_symptom_word_clarify",`Armen 18:49: ${r.reason}`);
 assert.equal(r.providerCalls.length,0,"the clarifying question needs no model");
 assert.ok(!/103/u.test(r.finish?.receipt?.text??"")&&/սրտխառնոց/u.test(r.finish?.receipt?.text??"")&&/սրտխփոց/u.test(r.finish?.receipt?.text??""),`question: ${r.finish?.receipt?.text}`);
 assert.equal(r.finish?.answer??null,null);}
// Never twice in a row: after the question, the next message goes to the model.
{const r=await run(free([ARMEN_1,ARMEN_1],{answers:[{body:"Ուզում եմ ճիշտ հասկանալ ձեզ։ «սրտխոնց» ասելով նկատի ունե՞ք սրտխառնոց, թե՞ սրտխփոց կամ սրտի ցավ։",minutesAgo:1}]}));
 assert.notEqual(r.reason,"unclear_symptom_word_clarify");assert.ok(r.providerCalls.length>0);}
// The red-flag rules run first: an unclear word next to a danger sign is the 103 text, no question.
{const r=await run(free(["Սրտխոնց ունեմ, ծնոտս ցավում է, շունչս պակասում է"]));
 assert.ok(/urgent|red_flag/u.test(r.reason)&&/103/u.test(r.finish?.answer??""),`red flag before the question: ${r.reason}`);}

// ------------------------------------------------------------------ (b) a model-only emergency is confirmed by a second check
{const r=await run(free(["#zoe-fake:health_emergency Ինձ մոտ ինչ-որ բան այն չէ"]));
 assert.equal(r.reason,"urgent_health_answer_model",`confirmed: ${r.reason}`);
 assert.ok(/103/u.test(r.finish?.answer??""),"confirmed: the 103 text");
 assert.ok(r.providerCalls.some(c=>c.purpose==="urgency_check"),"the check ran");
 const e=r.events.find(x=>x.name==="zoe.health_answer.urgency_check");assert.equal(e?.attributes["noreon.zoe.urgency_check.confirmed"],true);}
{const r=await run(free(["#zoe-fake:health_emergency_unconfirmed Ինձ մոտ ինչ-որ բան այն չէ"]));
 assert.notEqual(r.reason,"urgent_health_answer_model","not confirmed: no 103 text");
 assert.ok(!(r.finish?.answer??"").startsWith(URGENT_STEPS_TEXT.hy.slice(0,20)),"no 103 text");
 assert.ok(r.reason==="health_answer_emergency_not_confirmed",`not confirmed: ${r.reason}`);
 assert.equal(r.finish?.health?.urgency,"doctor_soon","answered at the confirmed level");assert.equal(r.finish?.health?.modelUrgency,"emergency");
 const call=r.providerCalls.filter(c=>c.purpose==="health_answer").at(-1);assert.ok(call?.memberBlock.includes('<second_check urgency="doctor_soon">'),"the regenerate is told the level");}
// The verdict fails safe: malformed, missing or contradictory confirms the 103.
assert.equal(readUrgencyVerdict(null).confirmed,true);assert.equal(readUrgencyVerdict("not json").confirmed,true);
assert.equal(readUrgencyVerdict('{"emergency":false,"urgency":"emergency"}').confirmed,true);
assert.equal(readUrgencyVerdict('{"emergency":"no","urgency":"planned"}').confirmed,true);
assert.deepEqual(readUrgencyVerdict('Sure. {"emergency":false,"urgency":"planned","reason":"nausea only"}'),{confirmed:false,urgency:"planned",malformed:false});
// No checker (null) or a failing one: the 103 goes out (fail safe).
{const {createFakeProvider}=await import("@/lib/zoe/provider");
 for(const checker of [null,createFakeProvider({fixture:"server_error"}),createFakeProvider({fixtureRaw:"no verdict"})]){
  const r=await runPipeline(free(["#zoe-fake:health_emergency_unconfirmed Ինձ մոտ ինչ-որ բան այն չէ"]),{directAnswers:true,env:STAGING,urgencyCheck:checker});
  assert.equal(r.reason,"urgent_health_answer_model",`fail safe (${checker?.requestModel??"none"}): ${r.reason}`);
 }}

// ------------------------------------------------------------------ The 12 dataset emergencies: 103 at once, no model, no check
{const d=loadDataset();
 for(const id of ["S006","S011","S023","S024","S025","S029","S035","S046","S057","S063","S094","S100"]){
  const s=d.scenarios.find(x=>`S${x.id}`===id)!;const first=s.turns.find(t=>t.role==="user")!.text;
  const r=await run(free([first]));
  assert.ok(/urgent|red_flag/u.test(r.reason)&&r.providerCalls.length===0&&/103/u.test(r.finish?.answer??""),`${id}: 103 before any model call (${r.reason})`);
 }}

// ------------------------------------------------------------------ (c) a model-only 103 window lets a correction or new topic through
const window=(openedBy:"model"|"rule")=>({answers:[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}],urgentSinceMinutes:1,urgentOpenedBy:openedBy});
// These longer corrections must match on their own, without a second correction phrase masking the miss.
for(const text of ["why are you telling me to call 103?","Why are you sending me to emergency"]){
 assert.equal(isCorrection(text),true,text);
 const model=await run(free([ARMEN_1,text],window("model")));
 assert.equal(model.reason,"urgent_window_model_red_flag_question",text);
 assert.equal(model.finish?.receipt?.text,RED_FLAG_QUESTION_TEXT.en);assert.equal(model.providerCalls.length,0);
 const rule=await run(free([ARMEN_1,text],window("rule")));
 assert.equal(rule.reason,"urgent_in_window_no_model_call",text);
 assert.match(rule.finish!.answer!,/103/u);assert.equal(rule.providerCalls.length,0);
 for(const danger of ["it is worse","I have chest pain now"]){
  const r=await run(free([ARMEN_1,`${text}. ${danger}`],window("model")));
  assert.notEqual(r.reason,"urgent_window_model_red_flag_question",`${danger} wins over correction`);
  assert.match(r.finish!.answer!,/103/u);assert.equal(r.providerCalls.length,0);
 }
}
assert.equal(modelWindowExit(ARMEN_2,false),"correction");assert.equal(modelWindowExit(ARMEN_3,false,[ARMEN_1]),"new_topic");
assert.equal(modelWindowExit("Գլխացավի դեպքում ինչ անեմ",false,[ARMEN_1]),"new_topic","Armen 19:41 as stored");
assert.equal(modelWindowExit("When is my visit tomorrow?",false,[ARMEN_1]),"new_topic");
assert.equal(modelWindowExit("ok",false),null);assert.equal(modelWindowExit("Չեմ կանչի, կսպասեմ մինչև առավոտ",true),null);
for(const t of ["Why are you telling me to call 103? It's just a normal headache","Почему скорую? Это обычная тошнота","Դա սովորական գլխացավ է"])assert.ok(isCorrection(t),`correction: ${t}`);
for(const [t,want] of [[ARMEN_2,"correction"],[ARMEN_3,"new_topic"]] as const){
 const r=await run(free([ARMEN_1,t],window("model")));
 assert.equal(r.reason,"urgent_window_model_red_flag_question",`Armen ${want}: ${r.reason}`);
 assert.equal(r.providerCalls.length,0);assert.equal(r.finish?.receipt?.text,RED_FLAG_QUESTION_TEXT.hy);assert.equal(r.finish?.answer??null,null);
 assert.ok(r.events.some(e=>e.name==="zoe.guard.urgent_window"&&e.reason===`model_window_${want}`));
}
// A fixed rule's window keeps today's exits: the same messages get the 103 text again.
for(const t of [ARMEN_2,ARMEN_3]){const r=await run(free(["Ծնոտս ցավում է, շունչս պակասում է",t],window("rule")));assert.equal(r.reason,"urgent_in_window_no_model_call");assert.ok(/103/u.test(r.finish?.answer??""));}
// Unknown opener (an older database): today's exits.
{const r=await run(free([ARMEN_1,ARMEN_2],{answers:[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}],urgentSinceMinutes:1}));assert.equal(r.reason,"urgent_in_window_no_model_call");}
// In a model-only window a danger sign still wins, and a refusal or "ok" keeps today's answer.
{const r=await run(free([ARMEN_1,"Հիմա ծնոտս ցավում է, շունչս պակասում է"],window("model")));assert.ok(/urgent|red_flag/u.test(r.reason)&&/103/u.test(r.finish?.answer??""),r.reason);}
{const r=await run(free([ARMEN_1,"ok"],window("model")));assert.equal(r.reason,"urgent_in_window_no_model_call");}
{const r=await run(free([ARMEN_1,"Չեմ կանչի, կսպասեմ մինչև առավոտ"],window("model")));assert.equal(r.reason,"urgent_in_window_no_model_call");assert.ok(r.finish?.health?.forwardReason==="refused_103");}
// The question ends with a danger-sign question: a plain "yes" next is the no-model urgent route.
for(const l of ["en","hy","ru"] as const)assert.ok(textRedFlags([RED_FLAG_QUESTION_TEXT[l].split(/(?<=[.։!])\s+/u).at(-1)!],{intakeActive:true}).length>0,`${l}: the question names red flags`);
{const r=await run(free([ARMEN_1,ARMEN_2,"Այո"],{answers:[{body:URGENT_STEPS_TEXT.hy,minutesAgo:3},{body:RED_FLAG_QUESTION_TEXT.hy,minutesAgo:1}],urgentSinceMinutes:null}));
 assert.equal(r.reason,"urgent_health_answer_red_flag_yes",`yes to the question: ${r.reason}`);assert.equal(r.providerCalls.length,0);}
{const r=await run(free([ARMEN_1,ARMEN_2,"Ոչ"],{answers:[{body:URGENT_STEPS_TEXT.hy,minutesAgo:3},{body:RED_FLAG_QUESTION_TEXT.hy,minutesAgo:1}],urgentSinceMinutes:null}));
 assert.ok(!/urgent/u.test(r.reason)&&r.providerCalls.some(c=>c.purpose==="health_answer"),`no to the question: normal handling (${r.reason})`);}
// Doctor mode keeps the window as today (the doctor answers; they can clear the alert).
{const r=await run(free([ARMEN_1,ARMEN_2],{...window("model"),doctorMode:true}));assert.equal(r.reason,"urgent_in_window_no_model_call");}

// ------------------------------------------------------------------ Astra review 1 (Z103-01..04) and the real staging spellings
// Armen's messages as stored on staging: «Սրտախռնոց» (seq 19) and «սրխառնոց» (seq 20) are symptom words too.
for(const t of ["Սրտախռնոց ունեմ, քիչ առաջ սկսվեց","Բայց ես սովորական սրխառնոց ունեմ"])assert.ok(mentionsSymptomWord(t),`real spelling is a symptom word: ${t}`);
assert.notEqual(tier(["Շնորհակալություն","Սրտախռնոց ունեմ, քիչ առաջ սկսվեց"]).tier,"low");
// Z103-01: the same problem going on, worse or uncertain keeps the model window (the 103 text again), never the question.
for(const t of ["It hasn't stopped","It hurts","It is becoming unbearable","Դա չի անցնում","Это невыносимо","It is getting worse","The same thing is still happening","Ավելի է վատացել","Սրտխոնցս չի անցնում","Хуже стало","What should I do now?","I don't know what to do"]){
 assert.equal(modelWindowExit(t,false,[ARMEN_1]),null,`continuation keeps the window: ${t}`);
 const r=await run(free([ARMEN_1,t],window("model")));assert.equal(r.reason,"urgent_in_window_no_model_call",`continuation in a model window: ${t} -> ${r.reason}`);
}
// Z103-02: an unclear word next to another danger sign never gets only the clarifying question.
for(const t of ["Սրտխոնց ունեմ, I am choking","Սրտխոնց ունեմ, խեղդվում եմ","Սրտխոնց ունեմ, something is very wrong","Սրտխոնց ունեմ, I cannot brethe","Սրտխոնց ունեմ, շունչս չի հերիքում","Սրտխոնց ունեմ ու ցնցվում եմ","Սրտխոնց ունեմ, ձեռքս թուլացել է","Սրտխոնց ունեմ, կրծքավանդակս ցավում է","Սրտխոնց ունեմ, ուշագնաց եղա"]){
 const r=await run(free([t]));assert.notEqual(r.reason,"unclear_symptom_word_clarify",`danger next to the unclear word: ${t}`);
}
// Z103-03: a symptom with a typo inside a logistics message is not logistics only.
for(const t of ["today I have a feever","hello I have an eadache","today I am omiting","hi, I feel dizy today","Բարև, այսօր գլխապտուտ ունեմ"])assert.notEqual(tier([t]).tier,"low",`never low: ${t}`);
// Z103-04: urgent words Zoe already answered do not reopen a cleared or expired window; unanswered ones still escalate.
{const j=free(["I have chest pain now","When is my visit?"]);j.conversation!.answeredThroughSeq=1;j.urgentSinceMinutes=null;
 const r=await run(j);assert.ok(!/urgent/u.test(r.reason),`answered urgent words after a clear: ${r.reason}`);}
{const j=free(["I have chest pain now","When is my visit?"]);j.conversation!.answeredThroughSeq=0;
 const r=await run(j);assert.ok(/urgent/u.test(r.reason),`unanswered urgent words still escalate: ${r.reason}`);}

console.log("Zoe 103 safety net: Armen's three messages, routing, second check, model-only window, clarifying question, 12 emergencies: passed");
