import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import {createFakeProvider,type ZoeProvider} from "@/lib/zoe/provider";
import {namesMildSideEffect,namesSeriousEffect,nurseFirst} from "@/lib/zoe/nurse-first";

// Mild side effects go to the nurse first (Armen 2 Nov, item 13). The rule and its words, then the real pipeline. Fictional text.
const on={NOREON_NURSE_CHAT:"true",NOREON_NURSE_CHAT_V2:"true"};
const rule=(text:string,o:Partial<Parameters<typeof nurseFirst>[0]>={})=>nurseFirst({forward:"auto",reason:"serious_side_effect",urgency:"doctor_soon",declined:false,sameDayMatter:false,newTexts:[text],texts:[text],env:on,...o});

for(const t of ["mild nausea after my tablet","I feel slightly dizzy, no fainting or falls","a mild headache since yesterday","my ankles are swollen in the evening","this dry cough is annoying","frequent urination since the new pill",
 "Меня немного подташнивает по утрам","Слегка кружится голова, обмороков нет","Немного болит голова после таблетки","Лодыжки отекают к вечеру","Появился сухой кашель","Частое мочеиспускание после таблеток",
 "Թեթև սրտխառնոց ունեմ առավոտները","Թեթև գլխապտույտ ունեմ, ուշագնացություն չկա","Թեթև գլխացավ ունեմ դեղից հետո","Կոճերս ուռել են երեկոյան","Չոր հազ եմ ունենում","Հաճախամիզություն է սկսվել",
 "tetev srtkharnots unem aravotnern","tetev glxaptuyt unem","tetev glxacav unem","chor haz unem"])assert.equal(rule(t),true,`Nurse first: ${t}`);

// Astra on #527: severe descriptions the old exclusion list missed, plain and with a mild word in front, in every language.
for(const t of ["nausea and my urine is red","mild nausea and my urine is red","a little nausea, my urine is brown","slight headache and my eye hurts","dry cough and my urine is red","my ankles are swollen and my leg hurts",
 "Тошнит и моча красная","Немного тошнит и моча красная","Слегка кружится голова и болит живот","Сухой кашель и моча красная","Головная боль нестерпимая","Немного болит голова, нестерпимая",
 "Գլխացավ ունեմ, ուշաթափվել եմ","Թեթև գլխացավ ունեմ, ուշաթափվել եմ","Թեթև սրտխառնոց ունեմ, մեզս կարմիր է","Չոր հազ ունեմ, մեզս կարմիր է",
 "glxacav unem, antaneli e","tetev glxacav unem, antaneli e","tetev srtkharnots unem, mezs karmir e","chor haz unem, mezs karmir e",
 "nausea since the tablet","Тошнит после таблетки","Գլխացավ ունեմ","glxacav unem"])assert.equal(rule(t),false,`Doctor: ${t}`);
for(const t of ["severe headache since morning","I fainted and my head hurts","dizzy and I fell in the kitchen","nausea and blood in my urine","my muscles ache and I have a headache on atorvastatin","nausea with a rash",
 "Сильная головная боль","Кружится голова, упала дома","Кровь в моче и тошнит","Болят мышцы и голова болит","Ուժեղ գլխացավ ունեմ","Գլխապտույտ ունեմ և ընկա","Մկաններս ցավում են, գլխացավ էլ ունեմ","glxacav u mkannery cavum en"])assert.equal(rule(t),false,`Doctor: ${t}`);
for(const t of ["I have a rash, no dizziness","muscle pain on my statin","my appointment time changed","where is my blood test"])assert.equal(rule(t),false,`No mild word to act on: ${t}`);
// Only what is denied is denied: the mild word stands, the serious one does not.
assert.equal(namesSeriousEffect("no fainting or falls"),false);assert.equal(namesMildSideEffect("no dizziness"),false);assert.equal(namesSeriousEffect("dizzy, no fainting, but I fell"),true);

// Every gate keeps today's doctor route.
const t="mild nausea";
assert.equal(rule(t,{env:{}}),false,"Flags off");assert.equal(rule(t,{env:{NOREON_NURSE_CHAT:"true"}}),false,"V2 off");assert.equal(rule(t,{env:{NOREON_NURSE_CHAT_V2:"true"}}),false,"Nurse chat off");
for(const urgency of ["same_day","emergency"])assert.equal(rule(t,{urgency}),false,urgency);
for(const reason of ["stopped_medicine","member_request","other","none"])assert.equal(rule(t,{reason}),false,reason);
for(const forward of ["none","asked","member_request"])assert.equal(rule(t,{forward}),false,forward);
assert.equal(rule(t,{declined:true}),false,"Declined");assert.equal(rule(t,{sameDayMatter:true}),false,"Open same-day matter");
assert.equal(rule(t,{texts:["I fainted yesterday",t]}),false,"Serious word earlier in the conversation");
assert.equal(rule(t,{newTexts:[t,"and my urine is red"]}),false,"Another unanswered message about the body");assert.equal(rule(t,{newTexts:[t,"thanks"]}),true,"Another unanswered message about nothing");
assert.equal(rule("old message",{newTexts:["thanks"],texts:[t,"thanks"]}),false,"Mild word must be in what is unanswered");
assert.equal(rule(t,{texts:["crushing chest pain for 20 minutes",t]}),false,"Red flag earlier in the conversation");

// The real pipeline: the reason changes, the forward and the member's line do not.
const scripted=(raw:string):ZoeProvider=>createFakeProvider({fixtureRaw:raw});
const out=(urgency:string)=>JSON.stringify({reply:"Thanks for telling me. Please write again here if it changes.",urgency,forward:"auto",forward_reason:"serious_side_effect",summary:"s",language:"en"});
const ctx={enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const};
const intake={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
const member=(text:string)=>job(text,{healthAnswers:true,directAnswers:true,displayName:"Richard Smith",conversation:ctx,intake});
const run=(text:string,urgency:string,env:Record<string,string>)=>runPipeline(member(text),{directAnswers:true,env:{NOREON_ZOE_FREE_STYLE:"coach-first",...env},provider:scripted(out(urgency))});
const mild=await run("I have mild nausea since the new tablet, what should I do?","doctor_soon",on);
assert.equal(mild.finish?.health?.forward,"auto");assert.equal(mild.finish?.health?.forwardReason,"mild_side_effect","Mild: nurse first");
assert.match(mild.finish?.answer??"",/I've also passed this to Dr Anna Hakobyan/u,"The doctor line stays true");
assert.equal((await run("I have mild nausea since the new tablet, what should I do?","doctor_soon",{})).finish?.health?.forwardReason,"serious_side_effect","Flags off: doctor");
assert.equal((await run("I have severe nausea since the new tablet, what should I do?","doctor_soon",on)).finish?.health?.forwardReason,"serious_side_effect","Severe: doctor");
assert.equal((await run("I have mild nausea since the new tablet, what should I do?","same_day",on)).finish?.health?.forwardReason,"serious_side_effect","Same-day: doctor");
console.log("Zoe nurse first: OK");
