import assert from "node:assert/strict";
import {job,runPipeline} from "@/lib/zoe/eval/harness";
import type {ZoeJob} from "@/lib/zoe/pipeline";
import {createFakeProvider,type ProviderRequest} from "@/lib/zoe/provider";
import {asksForSummary,asksToWithhold,inventedNegatives,MEDICINE_ADDED,MEDICINE_NOT_ADDED,MEDICINE_NOT_SAVED,medicineAskLine,offerableMedicines,pendingMedicines,promisesSecrecy,questionnaireBlock,questionnaireCorrections,saysAdd,saysNoMedicines,WITHHOLD_LINE,type ChatMedicine,type MemberStatement} from "@/lib/zoe/chat-record";
import {replyLanguageOf,requestedLanguage} from "@/lib/zoe/scope";
import {healthSummaryBlock} from "@/lib/zoe/topic";
import {classifyScope} from "@/lib/zoe/scope";
import {URGENT_TEXT} from "@/lib/zoe/symptoms/intake";
import {memberRecordFrom,memberRecordRowSchema,memberRecordSchema} from "@/lib/zoe/member-record";
import {selfMedicineSchema,todaysDoses,adherence} from "@/lib/member-medicines/model";

/** SYNTHETIC checks for the chat record (chat-record.ts, scope.ts replyLanguageOf). Fake provider, stand-in judge, no model, network or database. */
const ctx=(extra:Partial<NonNullable<ZoeJob["conversation"]>>={})=>({enabled:true,doctorName:"Dr Anna Hakobyan",answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:"en" as const,...extra});
const intakeOn={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
const record={chatCards:false,medicineList:true,questionnaire:null,disputed:[],ageYears:48,doses:null,ldl:null};
const profile=(extra={})=>({conditions:[],bpDiagnosed:"treated" as const,medicines:[],openAlerts:[],nextVisitInDays:null,...extra});
const on=(texts:string|string[],extra:Partial<ZoeJob>={})=>job(texts,{healthAnswers:true,directAnswers:true,displayName:"Test Member",conversation:ctx(),intake:intakeOn,memberRecord:record,topic:{breakAfterSeq:null,startSeq:null,zoeOwns:false,profile:profile()},...extra});
const reply=(o:Record<string,unknown>={})=>JSON.stringify({reply:"Thanks for telling me, that helps your care team.",urgency:"planned",forward:"none",forward_reason:"none",language:"en",...o});
const store=()=>({medicines:[] as ChatMedicine[],statements:[] as MemberStatement[]});
const run=(j:ZoeJob,o:Parameters<typeof runPipeline>[1]={})=>runPipeline(j,{directAnswers:true,...o});

// ---- 1. Medicines named in chat ----------------------------------------------------------------------------------------------
{
 const amlo="I take amlodipine 5 mg every morning";
 const named=await run(on(amlo),{fixtureRaw:reply({medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.equal(named.outcome,"answered");
 assert.match(named.finish!.answer!,/You take amlodipine 5 mg\. Shall I add this to your list for your doctor to check\?$/,"The question closes the reply");
 assert.deepEqual(pendingMedicines(named.finish!.answer),[{name:"amlodipine",dose:"5 mg"}],"The line itself carries the medicine to the yes");
 assert.equal(named.finish!.health!.urgency,"planned","Asking changes no level");
 const noDose=await run(on("I take amlodipine"),{fixtureRaw:reply({medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.deepEqual(pendingMedicines(noDose.finish!.answer),[{name:"amlodipine",dose:null}],"A dose the member never wrote stays unknown, whatever the model says");
 const invented=await run(on("I take amlodipine"),{fixtureRaw:reply({medicines_named:[{name:"aspirin",dose:null}]})});
 assert.equal(pendingMedicines(invented.finish!.answer),null,"A name the member never wrote is not offered");
 const mother=await run(on("my mother takes amlodipine 5 mg"),{fixtureRaw:reply({medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.equal(pendingMedicines(mother.finish!.answer),null,"Someone else's tablets are not the member's list");
 const listed=await run(on(amlo,{topic:{breakAfterSeq:null,startSeq:null,zoeOwns:false,profile:profile({medicines:[{name:"Amlodipine",dose:"5 mg",times:[],sinceDays:1}]})}}),{fixtureRaw:reply({medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.equal(pendingMedicines(listed.finish!.answer),null,"Already on the list");
 const question=await run(on(amlo),{fixtureRaw:reply({reply:"What dose is on the package?",medicines_named:[{name:"amlodipine",dose:null}]})});
 assert.equal(pendingMedicines(question.finish!.answer),null,"Never after a question of her own");
 const off=await run(on(amlo,{memberRecord:{...record,medicineList:false}}),{fixtureRaw:reply({medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.equal(pendingMedicines(off.finish!.answer),null,"List switched off: nothing is offered");
 const sameDay=await run(on("I take amlodipine 5 mg and my pressure is 186/122"),{fixtureRaw:reply({urgency:"same_day",forward:"auto",forward_reason:"same_day",medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.ok(sameDay.finish?.answer==null||pendingMedicines(sameDay.finish.answer)===null,"Same-day: no question about a list");
 const scriptAsk=medicineAskLine("hy",[{name:"ամլոդիպին",dose:"5 մգ"}]);
 assert.deepEqual(pendingMedicines(scriptAsk),[{name:"ամլոդիպին",dose:"5 մգ"}]);assert.deepEqual(pendingMedicines(`Текст.\n\n${medicineAskLine("ru",[{name:"лизиноприл",dose:null},{name:"Omega 3",dose:null}])}`),[{name:"лизиноприл",dose:null},{name:"Omega 3",dose:null}],"Two medicines, one with no dose");
 assert.deepEqual(offerableMedicines([{name:"amlodipine",dose:"five"},{name:"x"},{name:"amlodipine, then"}],{memberTexts:["amlodipine five, then x"],listed:[],earlierAnswers:[]}),[{name:"amlodipine",dose:null}],"A dose is a number and a unit; a name is one plain name");
 assert.deepEqual(pendingMedicines(medicineAskLine("en",[{name:"omega 3",dose:"1000 mg"}])),[{name:"omega 3",dose:"1000 mg"}],"The last number that is a dose");
 assert.deepEqual(offerableMedicines([{name:"123 pills"},{name:"ab12345"},{name:"vitamin B12",dose:"1000 mcg"}],{memberTexts:["123 pills, ab12345, vitamin B12 1000 mcg"],listed:[],earlierAnswers:[]}),[{name:"vitamin B12",dose:"1000 mcg"}],"A name starts with letters and is no long number");
 const midQuestion=await run(on(amlo),{fixtureRaw:reply({reply:"Is that the 5 mg tablet? It helps your care team to know.",medicines_named:[{name:"amlodipine",dose:"5 mg"}]})});
 assert.equal(pendingMedicines(midQuestion.finish!.answer),null,"Never in a reply that asks anything");
 assert.deepEqual(offerableMedicines("rubbish",{memberTexts:["x"],listed:[],earlierAnswers:[]}),[],"An unreadable field offers nothing");
 assert.deepEqual(offerableMedicines([{name:"amlodipine",dose:null}],{memberTexts:["amlodipine"],listed:[],earlierAnswers:[medicineAskLine("en",[{name:"amlodipine",dose:null}])]}),[],"Asked once, not again");

 // The yes, the no, and a list that cannot take it.
 const ask=named.finish!.answer!;
 const after=(text:string,extra:Partial<ZoeJob>={})=>on([amlo,text],{answers:[{body:ask,minutesAgo:1}],conversation:ctx({answeredThroughSeq:1}),messageSeq:2,...extra});
 const s=store(),yes=await run(after("yes"),{chatRecord:s});
 assert.equal(yes.providerCalls.length,0,"No model on the yes");
 assert.deepEqual(s.medicines,[{name:"amlodipine",dose:"5 mg"}]);
 assert.equal(yes.finish!.receipt!.text,MEDICINE_ADDED.en);
 assert.deepEqual(yes.finish!.health,{urgency:"none",modelUrgency:"none",forward:"auto",forwardReason:"member_statement"},"The doctor gets it to check");
 assert.match(yes.finish!.summary!,/amlodipine, 5 mg[\s\S]*their statement/u);
 const add=store();await run(after("add it"),{chatRecord:add});assert.equal(add.medicines.length,1,"Add it is a yes");assert.ok(saysAdd("Добавьте"));
 const n=store(),no=await run(after("no"),{chatRecord:n});assert.equal(n.medicines.length,0);assert.equal(no.finish!.answer,MEDICINE_NOT_ADDED.en);assert.equal(no.finish!.health,undefined,"A no sends nothing");
 const full={...store(),status:"limit"},limit=await run(after("yes"),{chatRecord:full});
 assert.equal(limit.finish!.receipt!.text,MEDICINE_NOT_SAVED.en,"Never says added when it was not");assert.equal(full.medicines.length,0);
 const later=await run(on([amlo,"why do my ankles swell?"],{answers:[{body:ask,minutesAgo:1}],conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{fixtureRaw:reply()});
 assert.equal(later.outcome,"answered","Another message after the question goes to the model");
 const urgentYes=store(),urgent=await run(after("yes and now I have crushing chest pain"),{chatRecord:urgentYes,env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"}});
 assert.equal(urgentYes.medicines.length,0);assert.match(urgent.reason,/urgent|red_flag/u,"The urgent route wins over the question");

 // "No medications on record" only when true.
 assert.ok(saysNoMedicines("You have no medications on record."));assert.ok(saysNoMedicines("Ваш список пуст."));assert.ok(saysNoMedicines("Your medicine list is empty."));assert.ok(!saysNoMedicines("Take your medicines as your doctor wrote them."));
 const genericWord=await run(on("Should I take my pills with food?"),{fixtureRaw:reply({reply:"I see no medications on record for you."})});
 assert.match(genericWord.finish!.answer??"",/no medications on record/,"The word pill names no medicine");
 let n2=0;const empty={...createFakeProvider({fixtureRaw:reply()}),complete:async(q:ProviderRequest)=>{if(q.purpose==="health_answer")n2++;return {kind:"ok" as const,raw:reply({reply:n2===1?"I see no medications on record for you.":"You told me you take amlodipine."}),usage:{inputTokens:1,outputTokens:1},responseModel:"fake",responseId:"x",finishReason:"stop" as const};}};
 const held=await run(on(amlo),{provider:empty});
 assert.equal(n2,2,"The false claim is held once");assert.ok(!/no medications/iu.test(held.finish!.answer!));
 const none=await run(on("What medicines am I on?"),{fixtureRaw:reply({reply:"I see no medications on record for you."})});
 assert.match(none.finish!.answer??"",/no medications on record/,"True: it may be said");
 assert.match(healthSummaryBlock(profile()),/a medicine named in <member_messages> counts/);

 // A row with no times: nothing due, nothing counted, and the staff and member reads still parse.
 const row=selfMedicineSchema.parse({id:"7b0f8a64-3d8e-4f4b-9c55-3a6b7c9d1e20",source:"self-reported",name:"amlodipine",dose:null,times:[],fromChat:true,startedOn:"2026-11-01",createdAt:"2026-11-01T08:00:00Z",stoppedAt:null,doses:[]});
 assert.deepEqual(todaysDoses(row,new Date("2026-11-02T10:00:00Z")),[]);assert.equal(adherence(row,7,new Date("2026-11-02T10:00:00Z")).expected,0);
}

// ---- 2. A summary the member asks for ------------------------------------------------------------------------------------------
{
 for(const t of ["Can you give me a summary of my health?","summarise what I told you so far","Сделайте сводку о моём здоровье","Ամփոփեք իմ առողջությունը"])assert.ok(asksForSummary(t),t);
 for(const t of ["what is a summary of the guideline on salt","How much water should I drink?","summarise what my doctor said","overview of my care plan"])assert.ok(!asksForSummary(t),t);
 const chat=["My BP this morning was 134/86","I quit smoking five years ago","I snore"];
 const facts={"q3.status":"former","q3.quit_years_ago":5,"q8.breathing":"snoring","q7.relatives":["cad","diabetes"],"q7.relative_age":"male_under_55","q2.height":180,"q2.weight":90,"q4.frequency":"two_to_four_month","q6.hba1c":6.4,"q9.right_now":"no"};
 const block=questionnaireBlock(facts);
 assert.match(block,/I used to smoke/);assert.match(block,/Yes, I snore loudly/);assert.match(block,/Heart[\s\S]*Diabetes/u);assert.match(block,/BMI from these: 27\.8\./);assert.match(block,/6\.4/);assert.ok(!/q9|right_now/.test(block),"Never the red-flag questions");
 assert.equal(questionnaireBlock({"q3.status":"unknown"}),"","An unknown answer is not a fact");assert.equal(questionnaireBlock(null),"");

 const texts=[...chat,"Please give me a summary of my health"];
 const j=on(texts,{messageSeq:4,messages:texts.map((text,i)=>({seq:i+1,text,minutesAgo:(4-i)*600})),conversation:ctx({answeredThroughSeq:3}),answers:[{body:"Noted.",minutesAgo:1000}],memberRecord:{...record,questionnaire:facts}});
 const asked=await run(j,{fixtureRaw:reply({reply:"You gave a reading of 134/86, you stopped smoking five years ago and you snore. Family history and BMI are on your questionnaire."})});
 assert.equal(asked.outcome,"answered");
 const input=asked.providerCalls.find(c=>c.purpose==="health_answer")!.memberBlock;
 assert.match(input,/134\/86/,"A topic break does not take the earlier readings away");assert.match(input,/I snore/);assert.match(input,/<member_questionnaire>/);assert.match(input,/<member_summary_request>/);
 assert.equal(asked.events.find(e=>e.name==="zoe.topic")?.reason.startsWith("topic_refers_back"),true);
 const plain=await run(on("Why does salt matter?",{memberRecord:{...record,questionnaire:facts}}),{fixtureRaw:reply()});
 assert.ok(!/<member_questionnaire>/.test(plain.providerCalls.find(c=>c.purpose==="health_answer")!.memberBlock),"Only a summary reads the questionnaire: it never changes an ordinary answer's level");
 assert.ok(!plain.judgeCalls.some(c=>/member_questionnaire/.test(c.memberBlock)),"Nor the judge's");

 assert.deepEqual(inventedNegatives("No shortness of breath.",chat),["No shortness of breath"],"Roo: the negative nobody said");
 assert.ok(inventedNegatives("No BP readings yet.",chat).includes("readings"),"Roo: three readings were given");
 assert.deepEqual(inventedNegatives("You said no shortness of breath.",["I have no shortness of breath"]),[],"Said by the member: fine");
 assert.deepEqual(inventedNegatives("Allergies: not mentioned.",chat),[],"Missing means not mentioned");
 assert.deepEqual(inventedNegatives("Нет одышки.",["Давление 130/80"]),["Нет одышки"]);
 for(const t of ["There is no need to change anything.","No more than two cups.","No later than Friday.","Take it without food.","No cigarettes since May.","Нет данных.","Без задержки."])assert.deepEqual(inventedNegatives(t,chat),[],t);
 let m=0;const neg={...createFakeProvider({fixtureRaw:reply()}),complete:async(q:ProviderRequest)=>{if(q.purpose==="health_answer")m++;return {kind:"ok" as const,raw:reply({reply:m===1?"Your reading was 134/86, with no shortness of breath.":"Your reading was 134/86."}),usage:{inputTokens:1,outputTokens:1},responseModel:"fake",responseId:"x",finishReason:"stop" as const};}};
 const clean=await run(j,{provider:neg});
 assert.equal(clean.finish!.answer,"Your reading was 134/86.\n\nMember-reported, not verified: 134/86 mmHg.","An invented negative is held and written again, with provenance on the quoted typed reading");
 const stuck=await run(j,{fixtureRaw:reply({reply:"Your reading was 134/86, with no shortness of breath."})});
 assert.ok(stuck.finish!.answer===null&&!/shortness/.test(stuck.finish!.receipt!.text),"It never reaches the member");assert.equal(stuck.finish!.health!.forward,"auto","The doctor gets it");
}

// ---- 3. Nothing is withheld from the doctor (Monika 558) --------------------------------------------------------------------
{
 for(const t of ["don't tell my doctor I skipped my pills","Please do not tell the doctor about this","keep this from my doctor","Не говорите врачу, что я пропустил таблетки","բժշկին մի ասեք, որ դեղը չեմ խմել","my doctor must not know"])assert.ok(asksToWithhold(t),t);
 for(const t of ["tell my doctor","What did my doctor say?","Do not stop your pills","My doctor should know about this","Don't let me forget to ask my doctor","Between you and me, I like coffee","Don't tell me to see a doctor"])assert.ok(!asksToWithhold(t),t);
 const r=await run(on("I skipped my pills, don't tell my doctor"),{fixtureRaw:reply({reply:"Skipped doses happen. Take the next one as your doctor wrote it."})});
 assert.equal(r.finish!.health!.forward,"auto");assert.equal(r.finish!.health!.forwardReason,"withhold_request");assert.equal(r.finish!.health!.urgency,"planned","Only who sees it, never the level");
 assert.ok(r.finish!.answer!.endsWith(WITHHOLD_LINE.en),"Honest in the chat");assert.match(r.finish!.summary!,/asked to keep this from the doctor/);
 assert.ok(promisesSecrecy("Fine, I won't tell them."));
 const promise=await run(on("don't tell my doctor"),{fixtureRaw:reply({reply:"Fine, I won't tell them."})});
 assert.ok(!/won't tell/.test(promise.finish!.answer??promise.finish!.receipt!.text),"A promise of secrecy never goes out");
 const asked=await run(on("Why does salt raise blood pressure?"),{fixtureRaw:reply()});assert.equal(asked.finish!.health!.forward,"none","Nothing changes without the request");
}

// ---- 4. The conversation's language (Khikar, 4 Nov: the language of the latest message) --------------------------------------------------------------------
{
 const detect=(t:string)=>classifyScope(t).replyLanguage;
 const keep=(latest:string,previous:"en"|"hy"|"ru"|null)=>replyLanguageOf(latest,detect(latest)!,previous);
 assert.equal(keep("What about coffee in the morning?","ru"),"en","An English question in a Russian chat is answered in English");
 assert.equal(keep("Կարո՞ղ եմ սուրճ խմել առավոտյան","en"),"hy","An Armenian question after English is answered in Armenian (Gohar)");
 assert.equal(keep("Можно ли мне кофе по утрам?","hy"),"ru");
 assert.equal(keep("ok thanks","hy"),"hy","A short Latin acknowledgement says nothing about the language");
 assert.equal(keep("tea?","ru"),"ru");assert.equal(keep("weight 80 kg","hy"),"hy");assert.equal(keep("spasibo","hy"),"hy");assert.equal(keep("thank you","ru"),"ru");
 assert.equal(keep("Tea please","hy"),"en","A short request is English (Astra LANG-01)");assert.equal(keep("Coffee tomorrow morning","ru"),"en");assert.equal(keep("спасибо","en"),"ru","Russian letters always count");assert.equal(keep("շնորհակալություն","ru"),"hy","So do Armenian ones");
 assert.equal(keep("Please answer in English","ru"),"en","An explicit request wins");
 assert.equal(keep("Отвечайте по-русски, пожалуйста","en"),"ru");assert.equal(requestedLanguage("Խնդրում եմ, հայերեն գրեք"),"hy");assert.equal(requestedLanguage("What does LDL mean in English?"),null);
 assert.equal(keep("Hello there my friend",null),"en","No earlier answer: the message's language");
 // R-01: a 103 text in a relative's language does not move the conversation.
 const afterUrgent=await run(on(["My pressure today is 126/80","Не могу дышать, сильная боль в груди","I feel better now, what should I do next?"],{answers:[{body:"Your reading looks fine, keep measuring.",minutesAgo:9},{body:URGENT_TEXT.ru,minutesAgo:3}],conversation:ctx({answeredThroughSeq:2}),messageSeq:3}),{fixtureRaw:reply()});
 assert.equal(afterUrgent.finish!.language,"en",afterUrgent.reason);
 const urgentOnly=await run(on("ok",{answers:[{body:URGENT_TEXT.ru,minutesAgo:3}],conversation:ctx({answeredThroughSeq:0})}),{fixtureRaw:reply({language:"ru",reply:"Хорошо."})});
 assert.equal(urgentOnly.finish?.language??urgentOnly.finish?.receipt?.language,"ru","With nothing else, that text is the conversation");

 const answers=[{body:"Давление в порядке, продолжайте измерять.",minutesAgo:2}],ru=(o:Record<string,unknown>={})=>reply({reply:"Кофе в умеренном количестве обычно можно.",language:"ru",...o});
 const health=await run(on(["Давление сегодня 126/80","А можно мне кофе по утрам?"],{answers,conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{fixtureRaw:ru()});
 assert.equal(health.finish!.language,"ru","The model is asked for the latest message's language");assert.equal(health.providerCalls.find(c=>c.purpose==="health_answer")!.replyLanguage,"ru");
 const urgent=await run(on(["Давление сегодня 126/80","I have crushing chest pain right now"],{answers,conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"}});
 assert.equal(urgent.finish!.language,"en","A 103 text is in the language of the message that raised it");assert.match(urgent.reason,/urgent/u);
 const enAnswers=[{body:"Your reading looks fine, keep measuring.",minutesAgo:2}];
 const relative=await run(on(["My pressure today is 126/80","Не могу дышать, сильная боль в груди"],{answers:enAnswers,conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"}});
 assert.match(relative.reason,/urgent|red_flag/u,relative.reason);assert.equal(relative.finish!.language,"ru","A relative typing in Russian in an English chat can read it");
 const window={answers:[{body:URGENT_TEXT.en,minutesAgo:1}],urgentSinceMinutes:1,urgentOpenedBy:"rule" as const,conversation:ctx({answeredThroughSeq:1}),messageSeq:2};
 for(const [ack,want] of [["спасибо","ru"],["да","ru"],["շնորհակալ եմ","hy"],["ok","en"],["thanks","en"]] as const){const r=await run(on(["I have crushing chest pain right now",ack],window),{env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"}});assert.equal(r.finish!.language,want,`An acknowledgement in Russian or Armenian letters is read in them; a Latin one keeps the conversation's language: ${ack} (${r.reason})`);}
 // Astra LANG-03: an explicit request for a language moves a 103 text as well, and triage does not change.
 {const env={NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"};
  const plain=await run(on("I have crushing chest pain right now"),{env}),asked=await run(on("I have crushing chest pain right now, please answer in Russian"),{env});
  assert.equal(asked.finish!.language,"ru",asked.reason);assert.equal(asked.reason,plain.reason,"Same route");assert.equal(asked.providerCalls.length,plain.providerCalls.length,"Same provider calls");}
 const held=await run(on(["Давление сегодня 126/80","What about coffee in the morning?"],{answers,conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{fixtureRaw:reply()});
 assert.equal(held.finish!.language,"en","An ordinary reply is in the language of the latest message");
 // Gohar's case in the three languages: a blood pressure message in one language, then a dinner question in another, answered in the second.
 const dinner={en:"What can I eat for dinner tonight?",hy:"Ի՞նչ կարող եմ ուտել այսօր երեկոյան",ru:"Что мне можно съесть на ужин сегодня?"} as const,bp={en:"My pressure today is 126/80",hy:"Ճնշումս այսօր 126/80 է",ru:"Давление сегодня 126/80"} as const;
 const said={en:"Your reading looks fine, keep measuring.",hy:"Ձեր ցուցանիշը նորմալ է, շարունակեք չափել։",ru:"Давление в порядке, продолжайте измерять."} as const;
 const dinnerAnswer={en:"A light dinner with vegetables and fish is a good choice.",hy:"Թեթև ընթրիքը բանջարեղենով և ձկով լավ ընտրություն է։",ru:"Лёгкий ужин с овощами и рыбой — хороший выбор."} as const;
 for(const from of ["en","hy","ru"] as const)for(const to of ["en","hy","ru"] as const){
  const r=await run(on([bp[from],dinner[to]],{answers:[{body:said[from],minutesAgo:2}],conversation:ctx({answeredThroughSeq:1}),messageSeq:2}),{fixtureRaw:reply({language:to,reply:dinnerAnswer[to]})});
  assert.equal(r.finish!.language,to,`${from} then ${to}: ${r.reason}`);
  assert.equal(r.providerCalls.find(c=>c.purpose==="health_answer")?.replyLanguage??to,to,`${from} then ${to}: the model is asked for the latest language`);
 }
 // The fixed lines follow the same rule: the spend-cap line and a 103 text.
 const capped=await run(on(["Давление сегодня 126/80",dinner.hy],{answers,conversation:ctx({answeredThroughSeq:1,memberSpentTodayUsd:1000}),messageSeq:2}),{fixtureRaw:reply()});
 if(capped.finish)assert.equal(capped.finish.language??capped.finish.receipt?.language,"hy",`The limit line is in the latest language: ${capped.reason}`);
}

// ---- 5. A questionnaire correction (Task 14) -----------------------------------------------------------------------------------
{
 const withStroke={topic:{breakAfterSeq:null,startSeq:null,zoeOwns:false,profile:profile({conditions:["stroke"]})}};
 assert.deepEqual(questionnaireCorrections({seq:1,text:"I never had a stroke"},["stroke"]),[{subject:"stroke",words:"I never had a stroke"}]);
 assert.deepEqual(questionnaireCorrections({seq:1,text:"I never had a stroke"},[]),[],"Nothing on the questionnaire to correct");
 assert.deepEqual(questionnaireCorrections({seq:1,text:"My father never had a stroke"},["stroke"]),[],"Someone else");
 const s=store(),r=await run(on("I never had a stroke",withStroke),{chatRecord:s,fixtureRaw:reply()});
 assert.deepEqual(s.statements,[{subject:"stroke",words:"I never had a stroke"}],"Stored as the member's statement");
 assert.equal(r.finish!.health!.forward,"auto");assert.equal(r.finish!.health!.forwardReason,"member_statement");assert.match(r.finish!.summary!,/Their statement, to check; the urgency rules are unchanged/);
 assert.equal(r.finish!.health!.urgency,"planned");
 const urgentS=store(),urgent=await run(on("I never had a stroke but my face droops and my arm is weak now",withStroke),{chatRecord:urgentS,env:{NOREON_ZOE_TEST_LEXICON:"false",NOREON_PRELAUNCH_STAGING:"true"}});
 assert.match(urgent.reason,/urgent|red_flag/u,"The 103 rules stay");
 const block=healthSummaryBlock(profile({conditions:["stroke"]}),t=>t,["stroke"]);
 assert.match(block,/a stroke or TIA \(the member says this is wrong; do not state it as a fact, it still counts for the urgency level until a doctor confirms\)/,"It stays listed and still counts");

 // The record's new keys, and a row from the old build.
 const row=memberRecordRowSchema.parse({runId:"7b0f8a64-3d8e-4f4b-9c55-3a6b7c9d1e20",enabled:true,today:"2026-11-02",ageYears:48,medicines:null,ldl:null,medicineList:true,questionnaire:{"q3.status":"former"},disputed:["stroke"]});
 assert.deepEqual(memberRecordSchema.parse(memberRecordFrom(row)).disputed,["stroke"]);
 const old=memberRecordFrom(memberRecordRowSchema.parse({runId:"7b0f8a64-3d8e-4f4b-9c55-3a6b7c9d1e20",enabled:true,today:"2026-11-02",ageYears:48,medicines:null,ldl:null}));
 assert.equal(old.medicineList,false);assert.equal(old.questionnaire,null);
}
console.log("Zoe chat record: medicines, the summary, nothing withheld, the conversation's language and corrections passed.");
