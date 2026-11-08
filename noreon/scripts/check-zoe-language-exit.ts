import assert from 'node:assert/strict';
import {classifyScope,replyLanguageOf} from '@/lib/zoe/scope';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import type {ZoeJob} from '@/lib/zoe/pipeline';
import {closingText,emptyRecord,registeredSheets} from '@/lib/zoe/symptoms/intake';
import {MIXED_LANGUAGE_MESSAGES,URGENT_MIXED_LANGUAGE_MESSAGES} from '@/lib/zoe/eval/conversation-families-lang';
import {textRedFlags} from '@/lib/zoe/symptoms/red-flags';
import {stagingMatches} from '@/lib/zoe/urgent-staging';

const env={NOREON_ZOE_MEMBER_CLEAR:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:'false'};
const conversation={enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const input=(text:string,extra:Partial<ZoeJob>={})=>job(text,{healthAnswers:true,directAnswers:true,conversation,intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},...extra});
const run=(text:string,extra:Partial<ZoeJob>={})=>runPipeline(input(text,extra),{directAnswers:true,env});
const body=(r:Awaited<ReturnType<typeof run>>)=>r.finish?.answer??r.finish?.receipt?.text??'';
let checks=0;
const failures:string[]=[];
async function check(label:string,f:()=>void|Promise<void>){try{await f();checks++;}catch(e){failures.push(label);console.error(`${label}: ${(e as Error).message}`);}}

for(const [text,want] of [['abcdefghijk абвгдежзи','en'],['abcdefghi абвгдежзийк','ru']] as const){
 await check(`dominant ${want}: ${text}`,()=>{const sc=classifyScope(text);assert.equal(sc.language,'mixed');assert.equal(sc.replyLanguage,want);});
}
for(const [text,want] of [['aaaaaa бббб','en'],['aaaa бббббб','ru']] as const)await check(`60% threshold: ${text}`,()=>assert.equal(classifyScope(text).replyLanguage,want));
for(const [context,want] of [[{},'hy'],[{previous:'ru',locale:'en'},'ru'],[{locale:'en'},'en']] as const)
 await check(`tie ${want}`,()=>assert.equal(classifyScope('aaaa бббб',context).replyLanguage,want));
await check('trilingual with no script at 60% or Armenian at 20%',()=>assert.deepEqual(
 [classifyScope('abcdefghi абвгдежз ա').language,classifyScope('abcdefghi абвгдежз ա').replyLanguage],['mixed','en']));
await check('mixed Armenian and Russian is read in its main language',()=>{assert.equal(classifyScope('Ջուր խմե՞մ, можно немного воды?').replyLanguage,'ru');assert.equal(classifyScope('Ջուր խմե՞մ, թե լավ կլինի խմել, можно?').replyLanguage,'hy');});
await check('English with a few Armenian letters is English; Armenian typed in Latin stays Armenian (Astra LANG-02)',()=>{
 assert.equal(classifyScope('Ջուր խմե՞մ, can I drink some water please?').replyLanguage,'en');
 assert.equal(classifyScope('Can I see իմ պլանը please?').replyLanguage,'en');
 assert.equal(classifyScope('Կարո՞ղ եմ water խմել').replyLanguage,'hy');
 assert.equal(classifyScope('ays, Yerevanum kayne ինչ kaxm e aystor?').replyLanguage,'hy');
});
await check('a mixed message is answered in its main language, whatever the chat spoke before',()=>assert.equal(replyLanguageOf('Can I drink water, плохо себя чувствую','ru','en'),'ru'));
for(const text of MIXED_LANGUAGE_MESSAGES)await check(`visible mixed: ${text}`,async()=>{
 assert.ok(classifyScope(text).replyLanguage,'supported mixtures have a language');
 const r=await run(text);assert.ok(body(r),r.reason);assert.ok(!/language.*not_supported/u.test(r.reason),r.reason);
 assert.ok(!/urgent.*no_model_call|red_flag/u.test(r.reason),`ordinary mixed text escalated: ${r.reason}`);
 if(r.providerCalls.length)assert.ok(r.providerCalls.every(c=>c.replyLanguage===classifyScope(text).replyLanguage),'model receives reply language');
});
for(const text of URGENT_MIXED_LANGUAGE_MESSAGES)await check(`urgent mixed: ${text}`,async()=>{
 const r=await run(text);assert.ok(/103/u.test(body(r))||r.finish?.health?.urgency==='same_day',r.reason);
 assert.ok(/urgent|red_flag/u.test(r.reason)||r.finish?.health?.urgency==='same_day',`plain answer: ${r.reason}`);
 assert.equal(r.providerCalls.length,0,'deterministic before model');
});
for(const text of ['У меня большой chest tattoo','This chest tattoo is большой','My chest does not hurt, болит нога','My chest tattoo is fine. Болит нога'])await check(`not mixed chest pain: ${text}`,async()=>{
 assert.equal(textRedFlags([text],{intakeActive:false}).length,0);
 const r=await run(text);assert.ok(!/urgent|red_flag/u.test(r.reason),r.reason);
});
const quietMixedChest=[
 'My chest не болит','My chest нет боли','My chest без боли','Нет боли в chest','Без боли в chest',
 'My chest չի ցավում','My chest ցավ չկա','My chest ցավ չունեմ','Առանց ցավի in my chest',
 'No pain в груди','Without pain в груди','Not painful в груди','My chest not ցավում',
 'My chest не давит','My chest չի սեղմում','No pressure կրծքավանդակում',
 'My chest tattoo is fine and болит нога','My chest tattoo болит нога','Болит нога near my chest tattoo',
 'My chest tattoo и болит зуб','My chest tattoo но болит живот','My chest tattoo а болит колено',
 'My chest tattoo and ցավում է ոտքս','My chest tattoo but ցավում է ատամս','My chest tattoo while ցավում է գլուխս',
 'My chest tattoo ու ցավում է փորս','My chest tattoo և ցավում է մեջքս','My chest tattoo բայց ցավում է ծունկս',
 'My chest нога болит','My chest зуб болит','My chest голова болит','My chest живот болит','My chest спина болит',
 'My chest ոտքս ցավում է','My chest ատամս ցավում է','My chest գլուխս ցավում է','My chest փորս ցավում է',
 'Կրծքավանդակում leg pain','Կրծքավանդակում tooth pain','Կրծքավանդակում head pain',
 'Կրծքավանդակում stomach pain','Կրծքավանդակում back pain','Կրծքավանդակում knee pain',
 'My chest he болит','My chest она ցավում է','My chest ընկերս ցավում է',
 'My chest болит нога','My chest болит зуб','My chest болит голова','My chest болит живот','My chest болит спина',
 'My chest ցավում է ոտքս','My chest ցավում է ատամս','My chest ցավում է գլուխս','My chest ցավում է փորս',
 'My chest and болит','My chest but болит','My chest while болит','My chest и болит','My chest но болит',
 'My chest а болит','My chest ու болит','My chest և болит','My chest բայց болит',
 'My chest is feeling very very now болит','больи in chest','ցավազուրկ in chest',
 'My chest is covered by a very large tattoo болит',
 'My chest pendant болит','My chest украшение болит','My chest рисунок болит','My chest նկարը ցավում է',
 'My chest tattoo. Боли в ноге','My chest tattoo; ցավում է ոտքս','My chest tattoo, болит зуб',
];
for(const text of quietMixedChest)await check(`denied or unrelated mixed chest: ${text}`,async()=>{
 assert.equal(textRedFlags([text],{intakeActive:false}).length,0,'no deterministic red flag');
 const r=await run(text);
 assert.doesNotMatch(r.reason,/urgent|red_flag/u);assert.notEqual(r.finish?.health?.urgency,'emergency',r.reason);
 assert.ok(r.providerCalls.some(c=>c.purpose==='health_answer'),`normal health path: ${r.reason}`);
});
const urgentMixedChest=[
 'Chest pain, сильно давит в груди','боль в chest','my chest давит','Ցավ կա in my chest',
 'My chest болит','My chest ցավում է','Pain կրծքավանդակում','Pressure կրծքավանդակում',
 'My chest не проходит боль','My chest չի անցնում ցավը','My chest not sure if it ցավում է',
 'No leg pain; my chest болит','My chest не болит; my chest давит',
 'My chest болит but my tooth is fine','My chest ցավում է, ոտքս լավ է',
];
for(const text of urgentMixedChest)await check(`affirmed mixed chest: ${text}`,async()=>{
 const r=await run(text);assert.match(body(r),/103/u);assert.match(r.reason,/^(?:urgent_route|symptom_red_flag)_no_model_call$/u);
 assert.equal(r.providerCalls.length,0,'true chest pain is deterministic');
});
// Valid inflections, with foreign-script locations in both orders and a mixed-script noun.
const painForms=[
 {forms:['боль','боли','болью','болей','болям','болями','болях','болит','болят','болело','болела','болели','больно'],locations:['chest','chest-ում']},
 {forms:['pain','pains','painful','hurt','hurts','hurting','ache','aches','aching'],locations:['груди','կրծքավանդակում']},
 {forms:['ցավ','ցավը','ցավս','ցավի','ցավով','ցավեր','ցավերը','ցավերի','ցավերով','ցավում','ցավում է','ցավեց','ցավել'],locations:['chest','груди']},
];
for(const {forms,locations} of painForms)for(const form of forms)for(const location of locations)
 for(const text of [`${form} in ${location} прямо сейчас`,`${location} ${form} now`])await check(`mixed chest inflection: ${text}`,async()=>{
  const r=await run(text);assert.match(body(r),/103/u);assert.match(r.reason,/^(?:urgent_route|symptom_red_flag)_no_model_call$/u);
  assert.equal(r.providerCalls.length,0,'inflected mixed chest pain is deterministic');
 });
await check('LANG-R3 exact Russian plural',async()=>{
 const r=await run('Сильные боли в chest прямо сейчас');assert.match(body(r),/103/u);assert.equal(r.providerCalls.length,0);
});
for(const text of ['My chest не болит','My chest tattoo is fine and болит нога','My chest tattoo болит нога','My chest pendant болит'])
 await check(`ambiguous pair retains second urgency check: ${text}`,async()=>{
  const r=await runPipeline(input(text),{directAnswers:true,env,fixture:'health_emergency_unconfirmed'});
  assert.ok(r.providerCalls.some(c=>c.purpose==='health_answer'),'normal health model ran');
  assert.ok(r.providerCalls.some(c=>c.purpose==='urgency_check'),'model emergency received second check');
  assert.equal(r.reason,'health_answer_emergency_not_confirmed');assert.notEqual(r.finish?.health?.urgency,'emergency');
 });
// A denial in one script must not hide a current danger in another clause/script.
for(const text of ['No chest pain; рука онемела','Нет онемения; my left arm is numb','Ցավ չկա; I cannot speak'])await check(`all red-flag lists: ${text}`,()=>assert.ok(textRedFlags([text],{intakeActive:false}).length));
for(const text of ['Can I drink water? сильно давит в груди','Можно воды? I cannot breathe','Please help; շնչահեղձ եմ'])await check(`all urgent lists: ${text}`,()=>assert.ok(stagingMatches(text).length));
const unsupported=['თავს ცუდად ვგრძნობ','أشعر بتوعك','我感觉不舒服','気分が悪いです','몸이 좋지 않아요','मुझे अच्छा नहीं लग रहा'];
for(const locale of ['en','hy','ru'] as const)for(const text of unsupported)await check(`unsupported ${locale}: ${text}`,async()=>{
 const r=await run(text,{conversation:{...conversation,locale}});assert.equal(r.reason,'language_unreadable_forwarded');
 assert.equal(r.finish?.receipt?.kind,'receipt');assert.equal(r.finish?.receipt?.language,locale);
 assert.equal(body(r),closingText(locale,null));assert.equal(r.finish?.health?.forward,'auto');
 assert.ok(['doctor_soon','same_day','emergency'].includes(r.finish?.health?.urgency??''));
 assert.equal(r.providerCalls.length,0);assert.equal(r.judgeCalls.length,0);
});
for(const extra of [{doctorMode:true},{conversation:{...conversation,memberSpentTodayUsd:1}},
 {intake:{enabled:false,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}},
 {answers:[{body:'Пожалуйста, расскажите подробнее.',minutesAgo:1}]}] satisfies Partial<ZoeJob>[])await check('unreadable exit before other modes',async()=>{
 const r=await run('我感觉不舒服',extra);assert.equal(r.reason,'language_unreadable_forwarded');assert.ok(body(r));assert.equal(r.providerCalls.length,0);assert.equal(r.judgeCalls.length,0);
});
await check('unreadable long message still receives receipt',async()=>assert.equal((await run('字'.repeat(4100))).reason,'language_unreadable_forwarded'));
await check('unsigned lexicon still forwards unreadable letters',async()=>{
 const r=await runPipeline(input('თავს ცუდად ვგრძნობ'),{directAnswers:true,env:{NOREON_ZOE_TEST_LEXICON:'false',NOREON_ZOE_URGENT_PLACEHOLDER:'false',NOREON_PRELAUNCH_STAGING:'false'}});
 assert.equal(r.reason,'language_unreadable_forwarded');assert.ok(body(r));assert.equal(r.providerCalls.length,0);
});
await check('unreadable active intake forwards instead of asking another question',async()=>{
 const sheet=registeredSheets()[0]!;
 const r=await run('我感觉不舒服',{intake:{enabled:true,registered:registeredSheets(),active:{id:'00000000-0000-4000-8000-000000000001',sheetId:sheet.id,sheetVersion:sheet.version,startedSeq:1,language:'en',record:emptyRecord()},doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
 assert.equal(r.reason,'language_unreadable_forwarded');assert.equal(r.finish?.health?.forward,'auto');assert.equal(r.providerCalls.length,0);
});
await check('unreadable receipt preserves an unanswered same-day matter',async()=>{
 const r=await runPipeline(job(['My triglycerides are 11 mmol/L','我感觉不舒服'],{healthAnswers:true,directAnswers:true,conversation,intake:input('x').intake}),{directAnswers:true,env});assert.equal(r.reason,'language_unreadable_forwarded');assert.equal(r.finish?.health?.urgency,'same_day');assert.equal(r.providerCalls.length,0);
});
await check('known urgent words earlier in batch win over unreadable latest',async()=>{
 const r=await runPipeline(job(['My left arm is numb','我感觉不舒服'],{healthAnswers:true,directAnswers:true,conversation,intake:input('x').intake}),{directAnswers:true,env});
 assert.match(body(r),/103/u);assert.match(r.reason,/urgent|red_flag/u);assert.equal(r.providerCalls.length,0);
});
await check('trilingual emergency with no script above 60% and little Armenian',async()=>{
 const text='Օ, рука онемела, please help me now';assert.equal(classifyScope(text).language,'mixed');
 const r=await run(text);assert.match(body(r),/103/u);assert.match(r.reason,/urgent|red_flag/u);assert.equal(r.providerCalls.length,0);
});
await check('original water symptom report reaches the health path',async()=>{
 const r=await run('Can I drink water, плохо себя чувствую');assert.ok(r.providerCalls.some(c=>c.purpose==='health_answer')||r.finish?.intake||r.finish?.health?.urgency==='same_day',r.reason);
});
// Property-style combinations: script proportions, ties, products and unrecognised letters.
for(const a of ['a','ա','я','字'])for(const b of ['b','բ','б','ب'])for(const n of [4,5,6])await check(`letters never discarded: ${a}/${b}/${n}`,async()=>{
 const r=await run(`${a.repeat(n)} ${b.repeat(10-n)} Telegram`);
 assert.ok(!(r.outcome==='discarded'&&/language/u.test(r.reason)),r.reason);assert.ok(body(r),r.reason);
});
for(const text of ['128/82','👍','?'])await check(`no letters unchanged: ${text}`,async()=>assert.notEqual((await run(text)).reason,'language_unreadable_forwarded'));
if(failures.length){console.error(`${checks} passed, ${failures.length} failed`);process.exitCode=1;}
else console.log(`Zoe language exit: ${checks} checks passed (32 mixed phrasings, 12 urgent, 6 unsupported scripts in 3 locales, 48 script combinations; ${quietMixedChest.length} denied/unrelated chest cases, ${urgentMixedChest.length} affirmative chest cases, table-driven inflections and second urgency checks).`);
