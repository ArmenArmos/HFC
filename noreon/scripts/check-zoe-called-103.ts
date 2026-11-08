import assert from 'node:assert/strict';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {CALLED_EAT_DRINK_TEXT,calledAndAsksToEatOrDrink,DRIVE_TEXT,urgentFollowUp} from '@/lib/zoe/urgent-followup';
import {createFakeProvider} from '@/lib/zoe/provider';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';

// "I called 103, can I drink coffee?" (Armen's QA, 3 Nov) got the generic careful line. Now: the fixed answer (nothing to eat or drink, no new medicine, until the ambulance team
// says otherwise), through the urgent route so the care team is told; the same with or without an earlier 103 text; nothing else changes.
type L='en'|'ru'|'hy';
const ASKS:Record<L,string[]>={
 en:['I called 103, can I drink coffee?','I have called an ambulance, may I eat something?','I called 103. Can I have some water?','The ambulance is on its way, can I smoke?'],
 ru:['Я вызвала 103, можно выпить кофе?','Я позвонила в скорую, можно поесть?','Скорая едет, можно попить воды?'],
 hy:['Զանգել եմ 103, իսկ սուրճ կարելի՞ է խմել։','Զանգեցի 103, կարելի՞ է ջուր խմել','Շտապօգնությունը ճանապարհին է, կարելի՞ է ուտել']};
// Astra: not an affirmative, current call by the member, a driving question, glucose, a relative's emergency.
const MUST_NOT=["I wasn't calling 103, can I drink coffee?",'I called 103 in 2025, can I drink coffee?','Yesterday I called 103 and now I want to drink coffee, can I?','I called 103 and the ambulance came, can I eat?',
 'Я вызвала 103, можно выпить сока? У меня гипогликемия.','Զանգել եմ 103, գլյուկոզաս 3.2 է, կարելի՞ է հյութ խմել։','Zangel em 103, shakarus ceric e, karelia xmel hyut?','I have not called 103, can I drink coffee?','I am not calling 103, can I drink coffee?','If I called 103, could I drink coffee?','I called 103 last week, can I drink coffee?','I called 103 yesterday, may I eat something?',
 'I called 103, can I drink juice? My glucose is 3.2 mmol/L.','I called 103, can I eat something, I have diabetes','I called 103, can I drive to buy coffee?','My mother has blood pressure 190/110. I called 103 for her, can she drink coffee?',
 'Я не вызывала 103, можно выпить кофе?','Если я вызову 103, можно будет выпить кофе?','Я вызвала 103, можно выпить сока? Сахар 3,2','Моя мама: я вызвала 103 для неё, ей можно выпить кофе?','Զանգել եմ 103, ինձ սուրճ կարելի՞ է խմել, շաքարս ցածր է'];
const NOT:Record<L,string[]>={
 en:['I called 103','Can I drink coffee?','I called my doctor, can I drink coffee?','Can I drink coffee after I called the clinic?'],
 ru:['Я вызвала 103','Можно выпить кофе?','Я позвонила врачу, можно выпить кофе?'],
 hy:['Զանգեցի 103','Սուրճ կարելի՞ է խմել','Բժշկին զանգեցի, կարելի՞ է սուրճ խմել']};
const real={...createFakeProvider(),local:false};
const env={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const mk=(lang:L,texts:string[],answers:string[])=>{
 const j=job(texts,{directAnswers:true,healthAnswers:true,
  conversation:{enabled:true,doctorName:null,answeredThroughSeq:answers.length,memberSpentTodayUsd:0,injectionsLast24h:0,locale:lang==='en'?'en':'hy'},
  intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
 j.answers=answers.map((body,i)=>({body,minutesAgo:(answers.length-i)*2}));
 j.messages.forEach((m,i)=>{m.minutesAgo=(texts.length-i)*2;});
 return j;
};
const run=(j:ReturnType<typeof mk>,memberClear:boolean)=>runPipeline(j,{directAnswers:true,allowRemote:true,env:{...env,NOREON_ZOE_MEMBER_CLEAR:String(memberClear)},provider:real});
const OPEN:Record<L,string>={en:'My chest hurts badly, it is pressing, and my left arm hurts too',ru:'Сильная боль в груди, давит, и левая рука тоже болит',hy:'Կրծքավանդակիս ուժեղ ցավ ունեմ, սեղմում է, ձախ ձեռքս էլ է ցավում'};
for(const text of MUST_NOT)assert.ok(!calledAndAsksToEatOrDrink(text),`not recognised: ${text}`);
// A diabetes mention earlier in the chat keeps the existing guidance in charge; a driving question keeps its own answer.
assert.ok(!calledAndAsksToEatOrDrink('I called 103, can I drink coffee?',{context:['I have type 2 diabetes']}),'earlier diabetes mention');
assert.equal(urgentFollowUp('I called 103, can I drive to buy coffee?','en',true),DRIVE_TEXT.en,'combined driving request keeps the driving answer');
assert.ok(!calledAndAsksToEatOrDrink('Я вызвала 103, можно выпить аспирин?',{medicine:true}),'a medicine question is never the called-103 answer');
assert.ok(!calledAndAsksToEatOrDrink('I called 103, can I drink coffee?',{sugar:true}),'low sugar anywhere in the chat blocks it');
for(const memberClear of [false,true])for(const text of ['Я вызвала 103, можно выпить аспирин?','Я вызвала 103, можно выпить сока? У меня гипогликемия.','I called 103, can I take aspirin?','I called 103, can I drive to buy coffee?','I called 103, can I drink juice? My glucose is 3.2 mmol/L.','If I called 103, could I drink coffee?']){
 const r=await run(mk(/[А-Яа-я]/u.test(text)?'ru':'en',[text],[]),memberClear);
 assert.ok(!Object.values(CALLED_EAT_DRINK_TEXT).includes(r.finish?.answer??''),`pipeline: "${text}" never gets the called-103 answer (${r.outcome}/${r.finish?.reason??r.reason})`);
}
for(const lang of ['en','ru','hy']as L[]){
 for(const text of ASKS[lang]){
  assert.ok(calledAndAsksToEatOrDrink(text),`${lang} "${text}" is recognised`);
  for(const memberClear of [false,true]){
   // Fresh, and right after an emergency (the 103 text already sent).
   const fresh=await run(mk(lang,[text],[]),memberClear);
   assert.equal(fresh.finish?.outcome,'discarded',`${lang} fresh "${text}": urgent route (${fresh.outcome}/${fresh.finish?.reason??fresh.reason})`);
   assert.ok((fresh.finish?.answer??'').startsWith(CALLED_EAT_DRINK_TEXT[lang]),`${lang} fresh "${text}": the lead-in first`);
   assert.ok((fresh.finish?.answer??'').length>CALLED_EAT_DRINK_TEXT[lang].length+40,`${lang} fresh "${text}": the ordinary urgent text follows it`);
   assert.equal(fresh.providerCalls.filter(c=>c.purpose==='health_answer').length,0,'no model');
   const after=await run(mk(lang,[OPEN[lang],text],['Call 103 now. Do not wait for this service.']),memberClear);
   assert.ok((after.finish?.answer??'').startsWith(CALLED_EAT_DRINK_TEXT[lang]),`${lang} after an emergency "${text}": an urgent answer (${after.outcome}/${after.finish?.reason??after.reason}, clear=${memberClear})`);
   assert.ok(!/want to be careful|ուզում եմ զգույշ|хочу быть осторожной/u.test(after.finish?.receipt?.text??''),'never the generic careful line');
  }
 }
 for(const text of NOT[lang]){
  assert.ok(!calledAndAsksToEatOrDrink(text),`${lang} "${text}" is not recognised`);
 }
}
// Astra round 3: a severe allergic reaction reported earlier keeps its own guidance (the prescribed adrenaline exception); the called-103 answer never replaces it.
for(const memberClear of [false,true]){
 const a=await run(mk('en',['My lips and tongue are swelling and I cannot breathe after eating peanuts'],[]),memberClear);
 const first=a.finish?.answer??'';
 const j=mk('en',['My lips and tongue are swelling and I cannot breathe after eating peanuts','I called 103, can I drink water?'],[first]);
 const b=await run(j,memberClear);
 assert.ok(!Object.values(CALLED_EAT_DRINK_TEXT).includes(b.finish?.answer??''),`allergic reaction earlier (clear=${memberClear}): not the called-103 answer (${b.outcome}/${b.finish?.reason??b.reason})`);
 assert.ok(!calledAndAsksToEatOrDrink('I called 103, can I drink water?',{special:true}),'the special blocker');
}
// Astra round 4: a PDE5 inhibitor with a nitrate reported earlier keeps its warning; the called-103 answer is a lead-in and the ordinary urgent text (with it) follows.
for(const memberClear of [false,true]){
 const first='I took sildenafil and nitroglycerin and my chest hurts badly.';
 const a=await run(mk('en',[first],[]),memberClear);
 const b=await run(mk('en',[first,'I called 103, can I drink them together?'],[a.finish?.answer??'']),memberClear);
 assert.ok((b.finish?.answer??'').includes('Never take these medicines together'),`PDE5 and nitrate earlier (clear=${memberClear}): the nitrate warning stays (${b.outcome}/${b.finish?.reason??b.reason})`);
 const c2=await run(mk('en',[first,'I called 103, can I drink water?'],[a.finish?.answer??'']),memberClear);
 // A plain water question: the lead-in, then the whole ordinary urgent text (the same steps the member gets for any message in this window), nothing dropped.
 assert.ok((c2.finish?.answer??'').includes('unlock the door')&&(c2.finish?.answer??'').includes("Don't take any new or extra medicine"),`PDE5 and nitrate earlier, water question (clear=${memberClear}): the ordinary urgent steps follow the lead-in`);
 // The allergic reaction too: the adrenaline-pen exception stays with or without the lead-in.
 const al='My lips and tongue are swelling and I cannot breathe after eating peanuts';
 const al1=await run(mk('en',[al],[]),memberClear);
 const al2=await run(mk('en',[al,'I called 103, can I drink water?'],[al1.finish?.answer??'']),memberClear);
 assert.ok((al2.finish?.answer??'').includes('adrenaline pen'),`allergy earlier (clear=${memberClear}): the adrenaline-pen exception stays`);
}
console.log('Called-103 checks passed: a member who called 103 and asks about eating or drinking gets the fixed answer.');
