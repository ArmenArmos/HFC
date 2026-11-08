import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {sameDayFloor,SAME_DAY_LINE} from "@/lib/zoe/health-answer";
import {stagingMatches} from "@/lib/zoe/urgent-staging";
import {textRedFlags} from "@/lib/zoe/symptoms/red-flags";
import type {ZoeJob} from "@/lib/zoe/pipeline";

/**
 * Codex Astra review of PR #384 (22 Oct): its exact reproductions. SYNTHETIC, fake provider, no network.
 * R1 an asserted current symptom keeps the 103 next to a leaflet; R2 corrections and other people's facts are not joined across
 * messages; R3 "heavy" said of an object is not a limb sign; R4 a stable lopsided smile is not a stroke; R5 the SGLT2 floor needs the
 * member's own current illness; R6 a pasted lab panel with a same-day value keeps the same-day line.
 */
const fires=(t:string)=>stagingMatches(t).length>0||textRedFlags([t],{intakeActive:false}).length>0;
// R1
for(const t of ["I have chest pain as the leaflet describes.","I have chest pain and your leaflet says to call 103."])assert.ok(fires(t),`R1 current symptom: ${t}`);
for(const t of ["Reading your chest pain leaflet, I do not have any symptoms","Where can I read your stroke prevention leaflet"])assert.ok(!fires(t),`R1 education only: ${t}`);
// R3
for(const t of ["My left arm is in a heavy cast after a fracture.","My left arm tattoo has heavy black shading."])assert.ok(!fires(t),`R3 object: ${t}`);
assert.ok(fires("My left arm is not numb but has gone heavy"),"R3 the limb itself");
// R4
assert.ok(!fires("My smile is naturally lopsided in photographs."),"R4 stable appearance");
assert.ok(fires("My smile is suddenly lopsided"),"R4 a new change");
// R5
for(const t of ["How does an SGLT2 inhibitor affect poor appetite?","I take Jardiance with Jermuk mineral water.","Jardiance em xmum Jermuk jrov.","I take Jardiance. My wife feels unwell today."])
 assert.equal(sameDayFloor([t],null),false,`R5 ordinary: ${t}`);
for(const t of ["I take dapagliflozin and cannot eat","forxiga em x mum, jerm unem","My husband takes Jardiance and has been vomiting since morning"])assert.equal(sameDayFloor([t],null),true,`R5 sick day: ${t}`);

const env={NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false"};
const ctx={enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const};
const on=(t:string|string[])=>job(t,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:ctx,intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}} as Partial<ZoeJob>);
const run=(j:ZoeJob)=>runPipeline(j,{directAnswers:true,env});
// R2
for(const pair of [["My glucose is 25.","Sorry, I mistyped: my glucose is 5. I keep vomiting."],["My mother has glucose 25.","I am vomiting after eating something bad."],
 ["My BP is 190/120.","Sorry, wrong reading: my BP is 120/80. My vision is blurred."],["My BP is 190/120.","Actually that was my mother's reading. My vision is blurred."]]){
 const r=await run(on(pair));assert.ok(!r.events.some(e=>e.reason==="urgent_combination_across_unanswered"),`R2 not joined: ${pair.join(" / ")} -> ${r.reason}`);}
for(const pair of [["My glucose is 25.","I keep vomiting."],["My BP is 190/120.","My vision is blurred."]]){
 const r=await run(on(pair));assert.equal(r.reason,"urgent_route_no_model_call",`R2 still joined: ${pair.join(" / ")}`);}
// R6
{const panel=["Potassium | 6.3 mmol/L","Sodium | 139 mmol/L","Creatinine | 92 umol/L","Glucose | 5.4 mmol/L","Calcium | 2.31 mmol/L","Albumin | 41 g/L","Hemoglobin | 138 g/L","Platelets | 240 x10^9/L"].join("\n");
 const r=await run(on(panel));
 if(/read_in_full/u.test(r.reason)){assert.equal(r.finish?.health?.urgency,"same_day",`R6 panel: ${r.reason}`);assert.ok(r.finish?.receipt?.text.startsWith(SAME_DAY_LINE.en),"R6 the same-day line");}
 else assert.ok(["same_day","emergency"].includes(r.finish?.health?.urgency??"none"),`R6 panel keeps same day: ${r.reason}`);
 assert.equal(r.providerCalls.length,0,"R6 no model call");}
console.log("check-zoe-astra-384: ok");
