import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {decideForward,healthDataBlock,healthReplyPrompt,HEALTH_JUDGE_PROMPT,sameDayFloor,SAME_DAY_LINE,URGENCY_LEVELS,type HealthData} from "@/lib/zoe/health-answer";
import {levelTwoFloors} from "@/lib/zoe/same-day-floors";
import {memberRecordBlock} from "@/lib/zoe/member-record";
import {textRedFlags} from "@/lib/zoe/symptoms/red-flags";
import {FIXED} from "@/lib/zoe/eval/conversation-scripts";
import {judge} from "@/lib/zoe/eval/conversation-rules";
import {FREE_MODE_CONFIG} from "@/lib/zoe/free-mode-config";
import {draftSchema} from "@/lib/service-workflow/publication";
import {checkDraft} from "@/lib/service-workflow/draft-input";
import {findMedicines,MEDICINE_LIST,medicineWarningText,METFORMIN_EGFR,planMedicineChecks} from "@/lib/medicines/plan-checks";
import {LDL_RETEST_WEEKS} from "@/lib/ldl/constants";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import type {ZoeJob} from "@/lib/zoe/pipeline";
import {LDL_EVENT_TYPES} from "@/lib/ldl/schema";
import {assessLdl,ldlOnePartMet,ldlPilotEligibility,ldlReductionShown,type LdlGoal,type RawLdlObservation} from "@/lib/ldl/status";
import {nextStepFor} from "@/lib/ldl/response";
import {proposeRetest} from "@/lib/ldl/retest";
import {LDL} from "@/lib/zoe-chat-actions/copy";
import {LdlGoalCard} from "@/components/patient-care/ldl-goal-card";
import {MedicineChecks} from "@/components/real-review/medicine-checks";

/** Armen's Tasks 14, 15, 16, 17, 19 and 20 (2 Nov). No model, no database: the rules, the prompt text and the pure functions. */
const prompts=(["coach-first","coach"] as const).map(s=>healthReplyPrompt(s,true,true));
const everyPrompt=(re:RegExp,why:string)=>{for(const p of prompts)assert.match(p,re,why);};

// ---------- Task 14: a level comes down only on the list
for(const part of [/LEVEL COMING DOWN/,/pain is mild and did not come on suddenly/,/no neurological or visual signs/,/below 180\/110 and falling/,/Once a red sign has appeared, feeling better never lowers it/])everyPrompt(part,`lowering rule: ${part}`);
assert.deepEqual(FREE_MODE_CONFIG.levelDownBp,{systolic:180,diastolic:110});
assert.match(HEALTH_JUDGE_PROMPT,/LEVEL COMING DOWN/,"the judge knows the rule, so a correct step down is not held");
everyPrompt(/a mild headache that did not come on suddenly[^;]*below 180\/110, whatever the questionnaire lists/,"Khikar's case is coming days");
assert.match(prompts[0]!,/bring a level down only as LEVEL COMING DOWN says/);
assert.equal(sameDayFloor(["mild headache, bp 155/87","now 120/80"],null),false,"no same-day floor in Khikar's case");
assert.deepEqual(textRedFlags(["mild headache, came on slowly, bp 155/87"],{intakeActive:false}),[],"no 103 list hit in Khikar's case");

// ---------- Task 15: statin muscle pain
everyPrompt(/muscle pain alone on a statin \(never stop the statin on your own\)/,"muscle pain alone is coming days");
everyPrompt(/jaundice, yellow skin, dark urine or marked weakness on a statin/,"the red signs are today");
assert.match(prompts[1]!,/but the pain really is there[^.]*say first that you hear them/,"turn 2 acknowledges, not repeats");
const floors=(t:string[],d:HealthData|null=null)=>levelTwoFloors(t,d);
for(const t of ["I take atorvastatin and my urine is dark","On rosuvastatin. My skin looks yellow","atorvastatin, severe muscle weakness since yesterday","На аторвастатине, моча стала тёмная","Принимаю статин, сильная слабость в мышцах","Ատորվաստատին եմ խմում, մեզս մուգ է","statin ei khmum, mug mez unem"])assert.deepEqual(floors([t]),["statin_red_sign"],t);
assert.deepEqual(floors(["Two days ago my urine went dark"],{bpWeek:null,labs:[],plan:{explanation:"x",instructions:"y",followUp:"",medicationName:"Atorvastatin",medicationDose:"40 mg",medicationInstructions:"",medicationTimes:[],publishedDaysAgo:1}}),["statin_red_sign"],"the statin in the plan counts");
// F2: mild pain and other people's weakness are not the floor. F3: brands, the words members use, and the context from elsewhere.
for(const t of ["Аторвастатин, боль очень слабая","На статине, мышцы очень слабо болят","ստատին եմ խմում, ցավը շատ թույլ է","atorvastatin, pain is very weak","на статине, зубы пожелтели","yesterday I was so weak with flu, better now on atorvastatin"])assert.deepEqual(floors([t]),[],t);
for(const t of ["Пью Торвакард, моча темная","Принимаю Тулип, пожелтели глаза","On Roxera, urine looks like tea","Mertenil, my urine is the colour of cola","На статине моча коричневая","Статин, моча цвета чая","Аторвастатин, сильно ослаб, еле хожу","atorvastatin. My muscles ache and I'm very weak"])assert.deepEqual(floors([t]),["statin_red_sign"],t);
assert.deepEqual(floors(["my urine went dark today"],null),[],"no statin known: not this floor");
// Astra: the sign must be the member's, and the statin one they take.
for(const t of [["I take atorvastatin. My mother has severe weakness."],["I do not take statins. My urine went dark today."],["I take atorvastatin and my mother has severe weakness"],["I take atorvastatin. She has dark urine."],["Я не принимаю статины. Моча стала тёмная."],["Ստատին չեմ խմում։ Մեզս մուգ է։"],["Do I need a statin? My urine went dark today."],["На аторвастатине. У мамы сильная слабость."]])assert.deepEqual(floors(t),[],t.join(" "));
assert.deepEqual(levelTwoFloors(["my urine went dark today"],null,["I do not take statins"]),[],"a denial in an earlier message is no statin");
assert.deepEqual(floors(["My mother takes atorvastatin and her urine is dark"]),["statin_red_sign"],"a carer about the person on the statin");
assert.deepEqual(floors(["I don't drink much, but I take atorvastatin. My urine went dark today."]),["statin_red_sign"],"a denial of something else");
assert.deepEqual(levelTwoFloors(["my urine went dark today"],null,["atorvastatin"]),["statin_red_sign"],"a statin named elsewhere counts");
assert.deepEqual(levelTwoFloors(["my urine went dark today"],null,["Торвакард 20 мг"]),["statin_red_sign"],"a brand elsewhere counts");
for(const name of ["Ezetimibe","Evolocumab","Эзетрол"])assert.deepEqual(levelTwoFloors(["my urine went dark today"],null,[name]),[],`${name} is not a statin`);
assert.deepEqual(levelTwoFloors(["сильно ослаб, еле хожу"],null,["боль справа"]),[],"«права» inside a word is no medicine");
assert.deepEqual(levelTwoFloors(["I take atorvastatin and my urine is dark"],null,false),[],"false leaves this floor out");
for(const t of ["My statin gives me muscle pain","atorvastatin, my legs ache, urine is normal, no dark urine","On a statin. No yellow skin and no marked weakness","Can a statin cause dark urine?","My urine is dark","Болят мышцы от статина, слабости нет","If my urine is dark on a statin, what then?"])assert.deepEqual(floors([t]),[],t);
for(const t of ["I take atorvastatin and my urine is dark","atorvastatin, severe muscle weakness since yesterday","Принимаю статин, сильная слабость в мышцах"])assert.deepEqual(textRedFlags([t],{intakeActive:false}),[],`today, not a false 103: ${t}`);
// F3, the whole pipeline: the statin named in an answered message, then the sign. Then the same sign again: the level stays, the fixed sentence does not repeat.
const intakeOn={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
const conv=(answeredThroughSeq:number)=>({enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const});
const env={NOREON_ZOE_URGENT_PLACEHOLDER:"true",NOREON_ZOE_TEST_LEXICON:"false",NOREON_ZOE_FREE_STYLE:"coach-first"};
const member=(texts:string[],answered:number,extra:Partial<ZoeJob>={})=>job(texts,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:conv(answered),intake:intakeOn,health:{bpWeek:null,labs:[],plan:null},...extra});
const said=(r:{finish:{answer?:string|null;receipt?:{text:string}|null}|null})=>r.finish?.answer??r.finish?.receipt?.text??"";
{const first=await runPipeline(member(["I take Торвакард every evening","my urine went dark today"],1,{answers:[{body:"Thank you, noted.",minutesAgo:1}]}),{directAnswers:true,env});
 assert.equal(first.finish?.health?.urgency,"same_day","two turns: the statin from the earlier message");
 assert.ok(said(first).includes(SAME_DAY_LINE.en),`the fixed sentence on the first warning: ${first.reason}`);
 const record=await runPipeline(member(["my urine went dark today"],0,{memberRecord:{chatCards:false,ageYears:60,doses:null,ldl:{goal:null,latest:null,event:null,therapies:[{name:"rosuvastatin",dose:"20 mg",startedDaysAgo:10}],nextTestInDays:null}}}),{directAnswers:true,env});
 assert.equal(record.finish?.health?.urgency,"same_day","the LDL record names it");
 const follow=JSON.stringify({reply:"Noted. Bring your medicine list with you.",urgency:"same_day",forward:"none",forward_reason:"none",language:"en"});
 const still=["I take atorvastatin","my urine went dark today","my urine is still dark"];
 const again=await runPipeline(member(still,2,{answers:[{body:`${SAME_DAY_LINE.en}\nThank you.`,minutesAgo:1}]}),{directAnswers:true,env,fixtureRaw:follow});
 assert.equal(again.finish?.health?.urgency,"same_day","the floor stays");
 assert.ok(said(again).length>0&&!said(again).includes(SAME_DAY_LINE.en),`once per matter: the sentence is not said again: ${again.reason}`);
 const doctorSince=await runPipeline(member(still,2,{answers:[{body:SAME_DAY_LINE.en,minutesAgo:5}],replies:[{body:"Please come in.",minutesAgo:2}]}),{directAnswers:true,env,fixtureRaw:follow});
 assert.ok(said(doctorSince).includes(SAME_DAY_LINE.en),"a doctor's reply since then: the warning is due again");
 const newSign=await runPipeline(member(["I take atorvastatin","my BP is 150/90","my urine went dark today"],2,{answers:[{body:`${SAME_DAY_LINE.en}\nThank you.`,minutesAgo:1}]}),{directAnswers:true,env,fixtureRaw:follow});
 assert.ok(said(newSign).includes(SAME_DAY_LINE.en),"an earlier warning about something else does not cover a new sign");
}
// F4: a long plan and four earlier messages cannot push the activity record out of the judge's context.
{const long="x ".repeat(740);
 const r=await runPipeline(member(["a".repeat(240),"b".repeat(240),"c".repeat(240),"d".repeat(240),"I had a stent two years ago, can I walk more?"],4,{answers:[{body:"Thank you, noted.",minutesAgo:1}],health:{bpWeek:null,labs:[],plan:{explanation:long,instructions:long,followUp:"y ".repeat(240),medicationName:"",medicationDose:"",medicationInstructions:"",medicationTimes:[],publishedDaysAgo:3}}}),{directAnswers:true,env});
 const blocks=r.judgeCalls.map(c=>JSON.stringify(c));
 assert.ok(blocks.length>0,`the judge ran: ${r.reason}`);
 assert.ok(blocks.every(b=>/activity_permission recorded=\\?"no/.test(b)),"the judge always sees whether it is recorded");
}
assert.equal(decideForward({forward:"auto",forward_reason:"stopped_medicine"},"doctor_soon",false,"coach-first").forward,"auto","\"I will stop\" sends a note (Task 11)");

// ---------- Task 16: activity permission
const plan=(activityLimits?:string|null):HealthData=>({bpWeek:null,labs:[],plan:{explanation:"x",instructions:"y",followUp:"",medicationName:"",medicationDose:"",medicationInstructions:"",medicationTimes:[],publishedDaysAgo:3,activityLimits}});
assert.match(healthDataBlock(plan()),/<activity_permission recorded="no">/);
assert.match(healthDataBlock(plan(" ")),/<activity_permission recorded="no">/,"blank is nothing recorded");
assert.match(healthDataBlock(null),/<activity_permission recorded="no">/,"no plan is nothing recorded");
assert.match(healthDataBlock(plan("Walking up to 30 minutes <b>")),/<activity_permission recorded="yes">Walking up to 30 minutes &lt;b&gt;<\/activity_permission>/);
everyPrompt(/Activity after a heart attack, a stent or a stroke[^.]*however long ago/,"no time limit");
everyPrompt(/do not suggest more exertion in any form/,"no increase while empty");
everyPrompt(/cardiac rehabilitation is the thing to ask about/,"the rehab note");
assert.match(HEALTH_JUDGE_PROMPT,/suggesting more exertion after a heart attack, stent or stroke while the context shows activity_permission recorded="no"/);
assert.equal(draftSchema.safeParse({explanation:"a",instructions:"b",followUp:"",medicationName:"",medicationDose:"",medicationInstructions:"",medicationTimes:[]}).success,true,"old drafts stay valid");
assert.equal(checkDraft({explanation:"a",instructions:"b",followUp:"",medicationName:"",medicationDose:"",medicationInstructions:"",medicationTimes:[],activityLimits:"Walking only"}).ok,true);
const long=checkDraft({explanation:"a",instructions:"b",followUp:"",medicationName:"",medicationDose:"",medicationInstructions:"",medicationTimes:[],activityLimits:"x".repeat(501)});
assert.ok(!long.ok&&long.messages[0]!.startsWith("Shorten the activity"),"a fixed message, not the generic one");
const migration=readFileSync("supabase/migrations/20261102183134_zoe_activity_limits_ldl_pilot.sql","utf8");
// Astra: the file must run. No database here, so its shape is checked; Verify runs it.
{const bare=migration.replaceAll("$function$","");
 assert.equal((bare.match(/\$\$/gu)??[]).length%2,0,"$$ delimiters pair up");
 assert.equal((migration.match(/\$function\$/gu)??[]).length,2);
 assert.doesNotMatch(migration,/as \$\n|^\$;|(?<!\$)\$;/mu,"no single-dollar delimiter");
 for(const f of ["doctor_ldl_event_add","_ldl_pilot_excluded","_member_ldl_read","_ldl_retest_eligible","ldl_response_candidates","ldl_response_record","zoe_run_member_record","workspace_valid_review_draft","zoe_run_health_context"])
  assert.equal((migration.match(new RegExp(`^create (?:or replace )?function public\\.${f}\\(`,"gimu"))??[]).length,1,`one definition of ${f}`);
 assert.equal((migration.match(/'activityLimits',nullif/gu)??[]).length,1,"one read of the field");
 assert.match(migration,/\|\|jsonb_strip_nulls\(jsonb_build_object\('activityLimits',nullif/u,"the key is omitted when empty");
 assert.match(migration,/'ldl',case when on_ and ldl_on and not public\._ldl_pilot_excluded\(r\.member_id\)then/u,"an excluded member gives Zoe no LDL record, so no goal text or dates");
}

// ---------- Task 17: questions and the higher level
for(const p of prompts){assert.doesNotMatch(p,/3 to 5 questions/);assert.match(p,/start with one question on the key danger sign[^.]*at most 3 questions in all, one or two at a time/);}
everyPrompt(/Only when today or 103 is one of the possible levels: if the member cannot answer or things look unstable, choose the higher level/,"the higher level only at today and above");
everyPrompt(/ask one clarifying question, then decide from the answer; doubt alone never raises the level/,"lower down: one question");
everyPrompt(/a watch pulse of 46, two glucose meters that differ/,"the odd device cases");
for(const t of ["my watch says my pulse is 46 this morning","Часы показывают пульс 46"]){assert.equal(sameDayFloor([t],null),false,t);assert.deepEqual(textRedFlags([t],{intakeActive:false}),[],t);}

// ---------- Replay conversations and their rules
const ids=FIXED.map(s=>s.id);
for(const id of ["en-mild-headache-falling","ru-statin-pain","hy-after-stent-exercise","en-watch-pulse-46"])assert.ok(ids.includes(id),id);
assert.equal(new Set(ids).size,ids.length,"ids stay unique");
for(const s of FIXED)if(/^(en-mild-headache|ru-statin-pain|hy-after-stent)/.test(s.id))assert.equal(s.rules.noForward,undefined,`${s.id}: coming days may send a quiet note`);
const t=(o:object)=>({n:1,seq:1,member:"x",flags:{},visible:"ok",reason:"health_answer_passed_guards",outcome:"answered",urgency:"none",forward:"none",...o});
assert.ok(judge({rules:{maxQuestions:1},lang:"en"},[t({visible:"How long?"}),t({n:2,seq:2,visible:"Any dizziness?"})]).some(f=>f.rule.startsWith("asked in 2 replies")),"the question limit trips");
assert.ok(judge({rules:{},lang:"en"},[t({flags:{mention:"hear"},visible:"Do not stop."})]).some(f=>f.rule.startsWith("missing what this turn must say")),"a required line trips");
assert.ok(!judge({rules:{},lang:"en"},[t({flags:{mention:"hear"},visible:"I hear you."})]).some(f=>f.rule.startsWith("missing")),"and passes");
assert.ok(URGENCY_LEVELS.includes("doctor_soon"));

// ---------- Task 19: LDL pilot, behind ldl_goal_settings
assert.ok((LDL_EVENT_TYPES as readonly string[]).includes("haemorrhagic_stroke"),"stroke types are stored separately");
assert.equal(ldlPilotEligibility([{type:"haemorrhagic_stroke"}]),"excluded");
assert.equal(ldlPilotEligibility([{type:"acs_mi"},{type:"haemorrhagic_stroke"}]),"eligible_with_warning","a qualifying event as well: eligible, the doctor warned");
assert.equal(ldlPilotEligibility([{type:"tia"},{type:"haemorrhagic_stroke"}]),"eligible_with_warning");
assert.equal(ldlPilotEligibility([{type:"other"},{type:"haemorrhagic_stroke"}]),"excluded","other does not qualify");
for(const type of ["acs_mi","ischaemic_stroke","tia"])assert.equal(ldlPilotEligibility([{type}]),"eligible",type);
assert.equal(ldlPilotEligibility([{type:"other"}]),"unknown","other is the doctor's call");
assert.equal(ldlPilotEligibility([]),"unknown");
assert.deepEqual(LDL_RETEST_WEEKS,{acs:[4,6],other:[4,6]},"Armen: 4 to 6 weeks after a therapy change; LR-02 disagrees and is unsigned");
assert.deepEqual([proposeRetest({eventTypes:["acs_mi"],startedOn:"2026-11-01",today:"2026-11-01"})?.dueTo,proposeRetest({eventTypes:["ischaemic_stroke"],startedOn:"2026-11-01",today:"2026-11-01"})?.dueTo],["2026-12-13","2026-12-13"]);
const goal=(baseline:LdlGoal["baseline"]):LdlGoal=>({version:1,category:"very_high",thresholdMmol:1.4,reductionRule:true,reductionPct:50,baseline,nextTestOn:null,setAt:"2026-10-01T00:00:00Z"});
const ob=(value:number,on:string):RawLdlObservation=>({id:on,value,unit:"mmol/L",on,source:"clinic_result",name:"LDL cholesterol",memberVisible:true});
const pre=goal({kind:"pre_treatment",mmol:2,on:"2026-01-01",source:"document"}),none=goal({kind:"unknown",mmol:null,on:null,source:null}),onRx=goal({kind:"on_treatment",mmol:2,on:"2026-01-01",source:"document"});
{ // Below 1.4 but only 35% lower: both parts show, and it is not called "below your goal".
 const a=assessLdl({goal:pre,observations:[ob(1.3,"2026-10-10")]});
 assert.equal(ldlReductionShown(pre,a),true);assert.equal(ldlOnePartMet(a),true);
 const both=assessLdl({goal:pre,observations:[ob(0.9,"2026-10-10")]});
 assert.equal(ldlOnePartMet(both),false,"both parts met");assert.equal(both.status,"at_goal");
 assert.equal(assessLdl({goal:pre,observations:[ob(1.8,"2026-10-10")]}).status,"above_goal");
}
for(const g of [none,onRx]){ // No pre-treatment value: only "below 1.4 or not", nothing estimated.
 const a=assessLdl({goal:g,observations:[ob(1.3,"2026-10-10")]});
 assert.equal(ldlReductionShown(g,a),false);assert.equal(ldlOnePartMet(a),false);assert.equal(a.status,"at_goal");
 assert.equal(a.reduction.state,"not_assessable");assert.ok(!("percent" in a.reduction),"no estimated percentage");
}
assert.equal(ldlReductionShown(pre,assessLdl({goal:pre,observations:[]})),true,"a baseline with no later value keeps the goal's second part");
assert.equal(LDL.setting.en,"Your doctor is setting your goal");
assert.doesNotMatch(`${LDL.setting.en} ${LDL.settingBody.en}`,/\d/,"no number before the doctor confirms");
const record=(g:object|null)=>memberRecordBlock({chatCards:false,ageYears:60,doses:null,ldl:{goal:g as never,latest:null,event:null,therapies:[],nextTestInDays:null}},{target:false,clean:s=>s});
assert.match(record(null),/your doctor is setting your goal/);assert.doesNotMatch(record(null),/1\.4/);
assert.doesNotMatch(record({thresholdMmol:1.4,setDaysAgo:2}),/1\.4/,"Zoe has no number unless the target switch is on");
{ // No 90% rule: no cut-off decides the next step, and nothing in lib/ldl names one.
 const a=(percent:number|null)=>({windowDays:28,expected:28,taken:0,skipped:0,percent,medicines:["Rosuvastatin"]});
 for(const p of [100,90,89.9,20])assert.equal(nextStepFor("above_goal",a(p)),"step_up",String(p));
 assert.equal(nextStepFor("above_goal",a(null)),"adherence_unknown");assert.equal(nextStepFor("above_goal",null),"adherence_unknown");assert.equal(nextStepFor("at_goal",a(100)),null);
 assert.doesNotMatch(readFileSync("lib/ldl/constants.ts","utf8"),/STEP_UP_PCT/);
}

// ---------- Task 20: fixed list and checks
const say=(en:string,hy:string,ru:string)=>{assert.ok(en&&hy&&ru);return en;};
const rules=(i:Parameters<typeof planMedicineChecks>[0])=>planMedicineChecks(i).map(w=>w.rule);
assert.deepEqual(new Set(MEDICINE_LIST.map(m=>m.name)).size,MEDICINE_LIST.length,"one row per medicine");
assert.deepEqual(findMedicines("Конкор 5 мг").map(m=>m.name),["Bisoprolol"],"a brand reads as its medicine");
assert.deepEqual(findMedicines("Lisinopril + amlodipine").map(m=>m.name),["Lisinopril","Amlodipine"],"a combination is both");
assert.deepEqual(rules({plan:[]}),[]);
assert.deepEqual(rules({plan:["Amlodipine","Atorvastatin 40 mg"]}),[],"an ordinary plan stays quiet");
assert.deepEqual(rules({plan:["Atorvastatin"],allergies:"atorvastatin"}),["allergy"]);
assert.deepEqual(rules({plan:["Rosuvastatin"],allergies:"Statins, penicillin"}),["allergy"],"an allergy to the class");
assert.deepEqual(rules({plan:["Amlodipine"],allergies:"penicillin"}),[],"another allergy is quiet");
assert.deepEqual(rules({plan:["Atorvastatin","Rosuvastatin"]}),["duplicate_class"]);
assert.deepEqual(rules({plan:["Concor","Bisoprolol 5 mg"]}),["duplicate_class"],"a renamed medicine is one medicine");
assert.deepEqual(rules({plan:["Aspirin 75 mg","Clopidogrel 75 mg"]}),[],"two antiplatelets after a stent are no duplicate");
assert.deepEqual(rules({plan:["Bisoprolol"],others:["Concor"]}),[],"the member's list naming a plan medicine is no duplicate");
assert.deepEqual(rules({plan:["Atorvastatin"],others:["Rosuvastatin"]}),["duplicate_class"],"a second statin on the member's list still is");
assert.deepEqual(rules({plan:["Amlodipine"],others:["Herbal mix"]}),["not_recognised"]);
assert.match(medicineWarningText(planMedicineChecks({plan:[],others:["Herbal mix"]})[0]!,say),/^Medicines not recognised: Herbal mix/);
assert.deepEqual(rules({plan:["Lisinopril"],allergies:"ACEi"}),["allergy"]);
assert.deepEqual(rules({plan:["Losartan"],allergies:"cough on ARBs"}),["allergy"]);
assert.deepEqual(rules({plan:["Ibuprofen"],allergies:"NSAIDs"}),["allergy","nsaid"]);
assert.deepEqual(rules({plan:["Losartan"],allergies:"arbidol"}),[],"a short form matches as a whole word");
assert.deepEqual(rules({plan:["Lisinopril","Losartan"]}),["acei_arb"]);
assert.deepEqual(rules({plan:["Enalapril","Spironolactone"]}),["k_sparing_acei"]);
assert.deepEqual(rules({plan:["Losartan","Amlodipine"]}),[],"an ARB with a calcium blocker is quiet");
assert.deepEqual(rules({plan:["Ibuprofen"]}),["nsaid"]);
assert.equal(planMedicineChecks({plan:["Lisinopril"],others:["Nurofen"]})[0]!.rule,"nsaid","what the member reported counts");
assert.deepEqual(rules({plan:["Aspirin 75 mg"]}),[],"low-dose aspirin is not the NSAID check");
assert.deepEqual(rules({plan:["Metformin"],egfr:68}),[]);
assert.deepEqual(rules({plan:["Metformin"],egfr:METFORMIN_EGFR.review}),[],"the cut itself is not below it");
assert.deepEqual(rules({plan:["Metformin"],egfr:40}),["egfr_metformin"]);
assert.deepEqual(rules({plan:["Metformin"],egfr:null}),["egfr_missing"],"a missing value is not a normal one");
assert.deepEqual(rules({plan:["Amlodipine"],others:["St John's wort tea"]}),["herbal"]);
assert.deepEqual(rules({plan:["Amlodipine"],others:["licorice tea"]}),["herbal"]);
assert.deepEqual(rules({plan:["Amlodipine"],others:["зверобой"]}),["herbal"]);
assert.deepEqual(rules({plan:["Unknownium 5 mg"]}),["not_on_list"],"off the list stays allowed and flagged");
assert.deepEqual(rules({plan:["Amlodipine"],others:["Unknownium"]}),["not_recognised"],"the member's list has its own line");
for(const i of [{plan:["Atorvastatin"],allergies:"atorvastatin"},{plan:["Atorvastatin","Rosuvastatin"]},{plan:["Lisinopril","Losartan"]},{plan:["Enalapril","Spironolactone"]},{plan:["Ibuprofen"]},{plan:["Metformin"],egfr:40},{plan:["Metformin"],egfr:20},{plan:["Metformin"]},{plan:["Licorice"]},{plan:["Зверобой"]},{plan:["X"]}])
 for(const w of planMedicineChecks(i))assert.doesNotMatch(medicineWarningText(w,say),/—|!|undefined/);

// ---------- What people see: the rendered card and form section
const card=(g:LdlGoal,v:number)=>renderToStaticMarkup(createElement(LdlGoalCard,{locale:"en",data:{version:"ldl-member-v1",enabled:true,inPathway:true,goal:{...g,doctorName:null},observations:[ob(v,"2026-10-10")] as never}}));
{const one=card(pre,1.3);assert.match(one,/One part of your goal is met/);assert.match(one,/and at least 50% lower than before treatment/);assert.doesNotMatch(one,/Below your goal/);
 assert.match(card(pre,0.9),/Below your goal/);
 const noBase=card(none,1.3);assert.match(noBase,/Below your goal/);assert.doesNotMatch(noBase,/at least 50%/,"no pre-treatment value: only below 1.4 or not");}
{const html=renderToStaticMarkup(createElement(MedicineChecks,{names:["Lisinopril","Losartan"],context:{others:["Nurofen"],egfr:null},locale:"en"}));
 assert.match(html,/ACE inhibitor with an ARB/);assert.match(html,/NSAID/);assert.match(html,/not yet signed/);
 assert.equal(renderToStaticMarkup(createElement(MedicineChecks,{names:[""],context:{others:[],egfr:null},locale:"en"})),"","nothing to check, nothing shown");}

console.log("Zoe tasks 14-20: all checks passed");
