import assert from "node:assert/strict";
import {textRedFlags} from "@/lib/zoe/symptoms/red-flags";
import {stagingMatches} from "@/lib/zoe/urgent-staging";
import {dangerPassed,urgentWindowOpen} from "@/lib/zoe/urgent-window";
import {registeredSheets,URGENT_TEXT} from "@/lib/zoe/symptoms/intake";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {URGENT_STEPS_TEXT} from "@/lib/zoe/health-answer";

/**
 * Three false or stuck 103s on staging, 20 Oct.
 * 1. Armen 22:24, «Hba1c 7 է, ինչ անեմ»: bp_crisis_reading fired (a stored 194/110 from 22:20, and "a symptom" from earlier
 *    messages in the window: nausea at 18:49, a headache at 19:41). A stored crisis reading now needs the symptom asserted in the
 *    newest message (or an intake open). Lab numbers are never blood pressure.
 * 2. Gohar: «Զանգել եմ 103» and «Zangel em 103» did not close the 103 window (only «Զանգեցի 103» did); the Latin-letter message
 *    got the English 103 text.
 * 3. P52 (Armen 20 Oct 19:54): fainting at 65 or over is Level 1 by itself.
 */
const fires=(t:string)=>stagingMatches(t).length>0||textRedFlags([t],{intakeActive:false}).length>0;
// A future stroke question alone is not an asserted event. Any current sign still opens the urgent route.
const futureQuestions=["Will I have a stroke?","А инсульт будет?","Ինսուլտ կլինի՞","Insult klini?","Insult em unenalu?"];
for(const q of futureQuestions){
 assert.ok(!fires(q),`future question: ${q}`);
 for(const sign of ["My right arm suddenly went numb","Внезапно перекосило лицо","հանկարծ աջ ձեռքս թուլացավ","aj dzerqs tulacel e"])
  for(const t of [`${q} ${sign}`,`${sign}. ${q}`])assert.ok(fires(t),`asserted sign wins: ${t}`);
}
for(const t of ["I am having a stroke","У меня инсульт","Ինսուլտ եմ տանում","insult em tarel hima","А инсульт будет","Ինսուլտ կլինի"])
 assert.ok(fires(t),`no future-question exception: ${t}`);
const crisis={systolic:194,diastolic:110,minutesAgo:4};

// ------------------------------------------------------------------ 1. lab numbers and a stored crisis reading
const ARMEN_WINDOW=["Սրտախռնոց ունեմ, քիչ առաջ սկսվեց","Բայց ես սովորական սրխառնոց ունեմ","Գլխացավի դեպքում ինչ անեմ","Գիշերը չեմ կարողանում քնել"];
for(const lab of ["Hba1c 7 է, ինչ անեմ","Hba1c 7 է","A1c 6.5","շաքարը 7.8","LDL 4.2","Холестерин 6.1, что делать?","glucose 11.2","TG 2.3, creatinine 95","K 5.1"]){
 assert.ok(!fires(lab),`no deterministic 103 for a lab value: ${lab}`);
 const hits=textRedFlags([...ARMEN_WINDOW,lab],{intakeActive:false,latestReading:crisis});
 assert.ok(!hits.some(h=>h.id.startsWith("bp_crisis")),`a lab question after earlier symptoms, with a stored crisis reading: ${lab} -> ${hits.map(h=>h.id)}`);
}
// The stored crisis reading still fires with a symptom in the newest message, or an intake open.
for(const now of ["Գլուխս շատ է ցավում","I have a bad headache now","Сильно болит голова","Գլխացավ ունեմ"])
 assert.ok(textRedFlags([...ARMEN_WINDOW,now],{intakeActive:false,latestReading:crisis}).some(h=>h.id==="bp_crisis_reading"),`stored crisis + symptom now: ${now}`);
assert.ok(textRedFlags(["Hba1c 7 է"],{intakeActive:true,latestReading:crisis}).some(h=>h.id==="bp_crisis_reading"),"intake open: as before");
// Astra #377 F1: a symptom earlier in the same unanswered batch still counts ("severe headache", then "what do I do?").
for(const [a,b] of [["I have a severe headache","What do I do?"],["Գլուխս շատ է ցավում","Ինչ անեմ"],["Сильно болит голова","Что делать?"],["Gluxs shat e cavum","Inch anem"]])
 assert.ok(textRedFlags([a,b],{intakeActive:false,latestReading:crisis,readingContextTexts:[a,b]}).some(h=>h.id==="bp_crisis_reading"),`unanswered symptom + crisis reading: ${a} / ${b}`);
// Text crises are unchanged.
for(const t of ["My BP is 190/120 and I have a terrible headache","Ճնշումս 200/120 է, գլուխս ցավում է","Давление 210 на 120, болит голова"])assert.ok(fires(t),`text crisis: ${t}`);
// Through the pipeline: Armen's 22:24 run (free mode, the stored reading) no longer gets the 103 text.
const STAGING={NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"};
const free=(texts:string[])=>job(texts,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"hy"},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:crisis,redFlagsAfterSeq:0,resumable:null}});
// The same questions through the pipeline's actual urgent entry point, with local fake providers only.
for(const q of futureQuestions){
 const j=free([q]);j.intake!.latestReading=null;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.ok(!/urgent|red_flag/u.test(r.reason),`future question stays in chat: ${q} ${r.reason}`);
 const signs=free([`${q} My right arm suddenly went numb`]);signs.intake!.latestReading=null;
 const urgent=await runPipeline(signs,{directAnswers:true,env:STAGING});assert.match(urgent.reason,/urgent|red_flag/u,`new sign takes the urgent route: ${q}`);
}
{const r=await runPipeline(free([...ARMEN_WINDOW,"Գլուխս շատ է ցավում"]),{directAnswers:true,env:STAGING});
 assert.equal(r.reason,"symptom_red_flag_no_model_call",`crisis reading + headache now: ${r.reason}`);}

{const j=free(["I have a severe headache","What do I do?"]);j.conversation!.answeredThroughSeq=0;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.equal(r.reason,"symptom_red_flag_no_model_call",`unanswered batch: ${r.reason}`);}
{const j=free([...ARMEN_WINDOW,"Hba1c 7 է, ինչ անեմ"]);j.conversation!.answeredThroughSeq=ARMEN_WINDOW.length;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.ok(!/urgent|red_flag/u.test(r.reason),`Armen 22:24, earlier messages answered: ${r.reason}`);}

// ------------------------------------------------------------------ 2. window exits and the language of the 103 text
for(const t of ["Զանգել եմ 103","Zangel em 103","Զանգեցի 103","zangeci 103","Արդեն զանգել ենք 103","103 զանգեցի","Շտապօգնություն կանչել եմ","Շտապօգնությանը զանգել եմ",
 "kanchel em shtap ognutyun","shtap ognutyun@ ekav","hivandanocum enq","Я позвонил в 103","Скорую уже вызвали","103 вызвал","I called 103","The ambulance is here"])
 assert.ok(dangerPassed(t),`help called or arrived: ${t}`);
for(const t of ["Զանգե՞մ 103","Չեմ զանգել 103","Zangel em 103?","Պետք է զանգեմ 103","Should I call 103","Не вызвал скорую","zangel em 103 bayc chen ekel"])assert.ok(!dangerPassed(t),`not an exit: ${t}`);
assert.ok(!urgentWindowOpen([{body:URGENT_TEXT.hy,minutesAgo:3}],"Zangel em 103"),"Gohar: the Latin message closes the window");
// A Latin-letter Armenian follow-up in the window gets the Armenian text, not the English one.
{const j=free(["Krtskavandaks seghmum e","Inch anem?"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.intake!.latestReading=null;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});
 assert.equal(r.reason,"urgent_in_window_no_model_call");assert.equal(r.finish?.language,"hy",`Latin-letter follow-up language: ${r.finish?.language}`);}
{const j=free(["Krtskavandaks seghmum e","zangel em 103, bayc chen galis, vat a"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.intake!.latestReading=null;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.equal(r.finish?.language,"hy",`Latin follow-up with "a": ${r.finish?.language}`);}
// An English member (app in English) keeps English.
{const j=free(["Help","what now"]);j.conversation!.locale="en";j.answers=[{body:URGENT_STEPS_TEXT.en,minutesAgo:1}];j.urgentSinceMinutes=1;j.intake!.latestReading=null;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.equal(r.finish?.language,"en");}

// Gohar on prod, 20 Oct 22:53: a lexicon 103 («Ընկույզ եմ կերել…»), then «Զանգեցի 103» got the 103 text AGAIN, in every mode: the
// answered urgent message was re-read from the window before the 103-window exits were checked. Answered urgent words no
// longer re-trigger; the window's own exits decide. Doctor mode and free mode alike.
{const GOHAR="Ընկույզ եմ կերել և լեզուս ուռածության զգացողություն ունի";
 assert.ok(fires(GOHAR),"Gohar's first message is a lexicon 103");
 for(const exit of ["Զանգեցի 103","Զանգել եմ 103","Զանգել եմ","Զանգեցի","Zangel em","I called","Позвонил"])for(const doctorMode of [false,true]){
  const j=free([GOHAR,exit]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;j.doctorMode=doctorMode;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING});
  assert.ok(!/urgent|red_flag/u.test(r.reason)&&!Object.values(URGENT_STEPS_TEXT).some(u=>(r.finish?.answer??"").startsWith(u.slice(0,30))),`Gohar: "${exit}" (doctor mode ${doctorMode}) closes the window: ${r.reason}`);
 }
 // Anything else in the window still gets the 103 text (the window is not closed by other words).
 for(const doctorMode of [false,true]){const j=free([GOHAR,"Ինչ անեմ"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;j.doctorMode=doctorMode;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.equal(r.reason,"urgent_in_window_no_model_call",`window stays (doctor mode ${doctorMode})`);}
 // An urgent message Zoe has NOT answered yet still escalates, whatever comes after it.
 {const j=free([GOHAR,"Զանգեցի 103"]);j.conversation!.answeredThroughSeq=0;j.intake!.latestReading=null;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.ok(/urgent/u.test(r.reason),`unanswered urgent words still escalate: ${r.reason}`);}
}

// Gohar on prod, 21 Oct 21:35 (#376/#377/#379 live): «Շրթունքներս ուռել են» got the 103 text, then «Զանգել եմ» got it AGAIN. The window
// closed as it should, but the model read the emergency in the window and the second check confirmed it. After the member says help was
// called or came, a model emergency is never the 103 text again (the stand-in model says "emergency" here); Zoe answers at same day.
{const LIPS="Շրթունքներս ուռել են";assert.ok(fires(LIPS),"Gohar 21 Oct: the first message is a lexicon 103");
 for(const doctorMode of [false]){
  const j=free([LIPS,"Զանգել եմ"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;j.doctorMode=doctorMode;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING,fixture:"health_emergency"});
  assert.ok(r.reason!=="urgent_health_answer_model"&&!Object.values(URGENT_STEPS_TEXT).some(u=>(r.finish?.answer??"").startsWith(u.slice(0,30))),`Gohar 21 Oct: «Զանգել եմ» gets no second 103 text: ${r.reason}`);
  assert.ok(!r.providerCalls.some(c=>c.purpose==="urgency_check"),"no second check after help was called");
 }
 // A window the model opened (Astra #385) is unchanged: the exit still goes through the second check, which confirms the stand-in's emergency.
 {const j=free(["Ինձ մոտ ինչ-որ բան այն չէ","Զանգել եմ"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.urgentOpenedBy="model";j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING,fixture:"health_emergency"});
  assert.ok(r.providerCalls.some(c=>c.purpose==="urgency_check"),`model-opened window: the second check still runs: ${r.reason}`);}
 // A model emergency on an ordinary message (no window) is still the 103 text.
 {const j=free(["Ինձ մոտ ինչ-որ բան այն չէ"]);j.intake!.latestReading=null;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING,fixture:"health_emergency"});assert.equal(r.reason,"urgent_health_answer_model",`model emergency without an exit: ${r.reason}`);}
 // The same model emergency right after a message that is not an exit stays inside the window (the 103 text, no model).
 {const j=free([LIPS,"Ինչ անեմ"]);j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:1}];j.urgentSinceMinutes=1;j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;
  const r=await runPipeline(j,{directAnswers:true,env:STAGING,fixture:"health_emergency"});assert.equal(r.reason,"urgent_in_window_no_model_call");}
}

// Astra (verification of the Gohar fix): an answered symptom still gives the context for a new red flag ("I have a headache",
// Zoe asks, "I feel confused"), in both modes; and an exit in doctor mode (no reply of Zoe's) keeps the window closed on the
// next message ("Thank you").
for(const doctorMode of [false,true]){
 const j=free(["I have a headache","I feel confused"]);j.answers=[{body:"When did it start?",minutesAgo:1}];j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;j.doctorMode=doctorMode;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.ok(/red_flag|urgent/u.test(r.reason),`answered symptom context + new red flag (doctor mode ${doctorMode}): ${r.reason}`);
}
for(const doctorMode of [false,true]){
 const GOHAR="Ընկույզ եմ կերել և լեզուս ուռածության զգացողություն ունի";
 const j=free([GOHAR,"Զանգեցի","Շնորհակալություն"]);j.messages=[{seq:1,text:GOHAR,minutesAgo:4},{seq:2,text:"Զանգեցի",minutesAgo:2},{seq:3,text:"Շնորհակալություն",minutesAgo:0}];j.messageSeq=3;
 j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:3}];j.urgentSinceMinutes=3;j.conversation!.answeredThroughSeq=1;j.intake!.latestReading=null;j.doctorMode=doctorMode;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.ok(!/urgent|red_flag/u.test(r.reason),`after the exit, "thank you" (doctor mode ${doctorMode}): ${r.reason}`);
 // A new danger sign after the exit still escalates.
 const k=structuredClone(j);k.messages[2]={seq:3,text:"Հիմա շնչահեղձ եմ լինում, լեզուս ավելի է ուռել",minutesAgo:0};
 const r2=await runPipeline(k,{directAnswers:true,env:STAGING});assert.ok(/urgent|red_flag/u.test(r2.reason),`new danger after the exit (doctor mode ${doctorMode}): ${r2.reason}`);
}

// Astra: an older exit and a newer urgent text in the same minute must not close the new window.
for(const doctorMode of [false,true]){
 const j=free(["Ընկույզ եմ կերել և լեզուս ուռածության զգացողություն ունի","Զանգեցի","Հիմա ծնոտս ցավում է, շունչս պակասում է","Ինչ անեմ"]);
 j.messages=j.messages.map((m,i)=>({...m,minutesAgo:i<3?0:0}));j.answers=[{body:URGENT_STEPS_TEXT.hy,minutesAgo:0}];j.urgentSinceMinutes=0;j.conversation!.answeredThroughSeq=3;j.intake!.latestReading=null;j.doctorMode=doctorMode;
 const r=await runPipeline(j,{directAnswers:true,env:STAGING});assert.equal(r.reason,"urgent_in_window_no_model_call",`same-minute tie keeps the new window (doctor mode ${doctorMode}): ${r.reason}`);
}

// ------------------------------------------------------------------ 3. P52: fainting at 65 or over is Level 1
for(const t of ["My 72-year-old father fainted","My grandmother fainted","I'm 70 years old and I fainted this morning","Տատիկս ուշագնաց եղավ","Պապիկս ուշաթափվեց",
 "Մայրս 78 տարեկան է, ուշագնաց եղավ","Бабушка упала в обморок","Отцу 80 лет, он потерял сознание","Пожилой сосед упал в обморок","tatiks ushagnac exav"])assert.ok(fires(t),`65+ faint is Level 1: ${t}`);
// Astra #377 F3: ages without a unit; F2: the age belongs to the person who fainted.
for(const t of ["My father is 80 years old. He fainted.","I am 70 years old. I fainted.","Мне 70 лет. Я упал в обморок.","Հայրս 80 տարեկան է։ Նա ուշագնաց եղավ։","Ես 70 տարեկան եմ։ Ուշագնաց եղա։","Отцу 80 лет. Он упал в обморок.","Պապս 82 տարեկան է։ Ուշագնաց եղավ։","I am 65 and I fainted","My father is 80 and he fainted","Мне 70, я упал в обморок","Ես 70 եմ, ուշագնաց եղա","Papas 82 tarekan e, ushagnac exav"])assert.ok(fires(t),`65+ faint: ${t}`);
for(const t of ["I'm 30 and I fainted after standing up quickly. Can I take my grandmother's pills?","My 20-year-old son fainted after standing up quickly; his 70-year-old father is with him",
 "I am 64 and I fainted after standing up quickly","Мне 40, упала в обморок, когда встала, бабушкин тонометр показывает 110/70",
 "My father is 80 years old. My son fainted after standing up quickly.","My father is 80 years old. I fainted after standing up quickly.","Отцу 80 лет. Мой сын упал в обморок, когда встал.","Հայրս 80 տարեկան է։ Ես ուշագնաց եղա։","I am 30 years old and my father is 80 years old. I fainted after standing up quickly."])assert.ok(!fires(t),`not a 65+ faint: ${t}`);
// Astra N1-1 (22 Oct): the age is the fainting person's, not the nearest word's.
for(const t of ["My father is 80 years old. He fainted in front of his 20-year-old grandson.","My father is 80 years old. He fainted in front of his son.",
 "My father fainted this morning, he is 80","Отцу 80 лет. Он упал в обморок при внуке, которому 20 лет.",
 "At 70 years old, I fainted after standing up quickly.","В 70 лет я упал в обморок после вставания.","70 տարեկանում ես ուշագնաց եղա արագ վեր կենալիս։","Пожилой сосед упал в обморок, ему 20 лет назад поставили диабет.",
 "My 70-year-old frail mother fainted after standing up quickly.","Моя пожилая больная мама упала в обморок после вставания.","Իմ 70 տարեկան հիվանդ մայրը ուշագնաց եղավ։"])assert.ok(fires(t),`65+ faint, age of the person who fainted: ${t}`);
for(const t of ["I fainted after standing up quickly; my grandmother helped me.","My grandmother helped me after I fainted when I stood up quickly",
 "I am 30. I fainted after standing up quickly, my 70-year-old father caught me.","Տատիկս ինձ օգնեց, երբ ուշագնաց եղա արագ վեր կենալիս",
 "My grandmother helped when my son fainted, he is 20 years old.","Бабушка помогла, когда сын упал в обморок, ему 20 лет.","Տատիկս օգնեց, երբ որդիս ուշագնաց եղավ, նա 20 տարեկան է։",
 "My 80-year-old father helped when my son fainted, he is 20 years old.","Իմ 80 տարեկան հայրը օգնեց, երբ որդիս ուշագնաց եղավ, նա 20 տարեկան է։","I fainted after standing up quickly, my 70-year-old frail father caught me."])assert.ok(!fires(t),`a younger member's faint with an older relative nearby: ${t}`);
for(const t of ["My 30-year-old son fainted after standing up quickly","Ես 45 տարեկան եմ, մի անգամ ուշագնաց եմ եղել տարիներ առաջ","My grandmother did not faint","Бабушка не теряла сознание"])
 assert.ok(!fires(t),`not Level 1: ${t}`);

console.log("Zoe false red flags (lab numbers and stored readings, 103 window exits and language, 65+ syncope): passed");
