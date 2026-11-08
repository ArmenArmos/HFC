import assert from 'node:assert/strict';
import {PAST_CHEST_FRESH,PAST_CHEST_NEGATIVES,R623_CHEST_BINDING_NEGATIVES,R623_CHEST_DURATION_PAIRS,R623_LONG_MINUTE_NEGATIVES} from '@/lib/zoe/eval/conversation-families';
import {plainRequestAfterAlert} from '@/lib/zoe/alert-gate';
import {FIXED} from '@/lib/zoe/eval/conversation-scripts';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {stagingMatches} from '@/lib/zoe/urgent-staging';
import {chestPastOrStableNotNow,textRedFlags} from '@/lib/zoe/symptoms/red-flags';
import {CHEST_NOT_NOW_CONTEXT,HEALTH_JUDGE_PROMPT,HEALTH_JUDGE_PROMPT_BASE,HEALTH_JUDGE_PROMPT_COACH_FIRST} from '@/lib/zoe/health-answer';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';
import {createFakeProvider} from '@/lib/zoe/provider';

// Regression: a broad chest word must not override Armen's 2 Nov not-now decision.
// Real pipeline, in-memory ports and stand-in providers only; no clinical/model acceptance claimed.
const env={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const free=(texts:string[])=>job(texts,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
const visible=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.finish?.answer??r.finish?.receipt?.text??'';
const fires=(text:string)=>stagingMatches(text).length>0||textRedFlags([text],{intakeActive:false}).length>0;
const script=(id:string)=>FIXED.find(s=>s.id===id)!;
const tc04=script('en-chest-worsening-not-now').turns.map((t:{text:string})=>t.text);
const tc05=script('en-chest-stable-not-now').turns.map((t:{text:string})=>t.text);
const tc06=script('en-faint-running-fine-now').turns.map((t:{text:string})=>t.text);
const pastSting='Անցյալ ամիս մի անգամ կրծքավանդակում ծակոց եմ ունեցել, հիմա ամեն ինչ լավ է';
const fineNow=[pastSting,
 ...['հիմա լավ եմ','հիմա լավ եմ զգում'].map(s=>pastSting.replace('հիմա ամեն ինչ լավ է',s)),
 ...['сейчас всё хорошо','сейчас все хорошо'].map(s=>`В прошлом месяце один раз болело в груди, ${s}`),
 ...['everything is fine now','I feel fine now'].map(s=>`Chest pain last month, ${s}`),
 ...['hima amen inch lav e','hima lav em','hima lav em zgum'].map(s=>`Ancyal amis krtsqi cav unem, ${s}`),
];
for(const pair of R623_CHEST_DURATION_PAIRS){
 for(const text of [pair.digit,pair.word]){
  assert.equal(chestPastOrStableNotNow(text),true,`short minute equivalence: ${text}`);
  assert.equal(plainRequestAfterAlert(text),true,`after-103 short minute equivalence: ${text}`);
 }
 assert.equal(chestPastOrStableNotNow(pair.word),chestPastOrStableNotNow(pair.digit),pair.word);
}
for(const text of R623_LONG_MINUTE_NEGATIVES){
 assert.equal(chestPastOrStableNotNow(text),false,`long or unconsumed duration: ${text}`);
 assert.equal(plainRequestAfterAlert(text),false,`after-103 long or unconsumed duration: ${text}`);
}
for(const text of PAST_CHEST_NEGATIVES)assert.equal(chestPastOrStableNotNow(text),false,`past-day guard: ${text}`);
for(const f of PAST_CHEST_FRESH)assert.equal(chestPastOrStableNotNow(f.turns[0].text),true,`past-day family: ${f.turns[0].text}`);
for(const text of fineNow)assert.equal(chestPastOrStableNotNow(text),true,`settled chest episode: ${text}`);
for(const text of [
 pastSting.replace('հիմա ամեն ինչ լավ է','հիմա ամեն ինչ լավ է չէ'),
 `${pastSting}, բայց հիմա ցավում է`,`${pastSting}, հանգստի ժամանակ ցավում էր`,
 `${pastSting}, ծնոտս էլ է ցավում`,`${pastSting}, տևել է 20 րոպե`,
 `${pastSting}, չգիտեմ`,
 'հիմա ամեն ինչ լավ է','հիմա լավ եմ','Everything is fine now',
 'Chest pain last month. Everything is fine now.',
 'Կրծքավանդակում ծակոց անցյալ ամիս։ Հիմա լավ եմ։',
 'Chest pain last month, everything is fine',
])assert.equal(chestPastOrStableNotNow(text),false,`absence cannot hide danger or borrow a chest sentence: ${text}`);
const quiet=[tc04[0]!,tc05[0]!,
 ...fineNow,...PAST_CHEST_FRESH.map(f=>f.turns[0].text),
 ...['not now','not right now','it is not happening now'].map(n=>`Chest tightness for 6 months on climbing stairs, stops with rest. ${n}. No pain at rest.`),
 // "no pain now" and "nothing now" count only in a chest sentence (Fable F2).
 ...['no pain now','nothing now'].map(n=>`Chest tightness for 6 months on climbing stairs, stops with rest, ${n}. No pain at rest.`),
 ...['сейчас нет','сейчас не болит','сейчас не беспокоит'].map(n=>`Боль в груди при нагрузке уже 6 месяцев, проходит в покое. ${n}.`),
 ...['հիմա չկա','հիմա չի ցավում'].map(n=>`Կրծքավանդակի ցավ արդեն 6 ամիս, հանգստանալիս անցնում է։ ${n}։`),
 ...['hima chka','hima chi cavum'].map(n=>`Krtsqis cav 6 amis, hangstanaluc ancnum e. ${n}.`),
 'Chest pain last week, not now.',
 'Chest tightness when I run, goes away with rest, not now.',
 'Chest pain for 6 months, not now, no sweating or breathlessness.',
 'Chest pain for 6 months, no arm or jaw pain, not now.',
];
for(const text of quiet){
 assert.equal(fires(text),false,`no deterministic 103: ${text}`);
 const r=await runPipeline(free([text]),{directAnswers:true,env});
 assert.notEqual(r.finish?.health?.urgency,'emergency',`normal health route: ${text}`);
 assert.ok(['doctor_soon','same_day'].includes(r.finish?.health?.urgency??''),`coming-days minimum: ${text} -> ${r.reason}`);
 if(PAST_CHEST_FRESH.some(f=>f.turns[0].text===text))assert.equal(r.finish?.health?.urgency,'doctor_soon',`past-day family keeps the coming-days floor: ${text}`);
 if(text===pastSting)assert.equal(r.finish?.health?.urgency,'doctor_soon','the exact settled sting has the coming-days floor in a fresh chat');
 assert.doesNotMatch(visible(r),/103/u,`no 103 in fallback: ${text}`);
 assert.match(visible(r),/coming days|next few days|ближайшие дни|առաջիկա օր/iu,`visible doctor timing: ${text}`);
}
const urgent=[...R623_LONG_MINUTE_NEGATIVES,...R623_CHEST_BINDING_NEGATIVES,tc06[0]!,tc06[0]!.replace(' I feel fine now.',''),'Fainted on the stairs yesterday, fine now',
 'I am 65 and fainted, fine now','I am 80 and fainted last week, not now',
 'chest pain now',"chest pain, not sure if it's serious","I don't know if it's now or not but my chest hurts",
 'crushing chest pain an hour ago, not now','chest pain at rest, getting worse, not now but it was all night',
 "chest pain for 6 months, and now it's here",'no pain now but my arm went numb with it this morning',
 'Chest pain for 6 months, not now, but it happened today',
 'Chest pain for 6 months, not now, with sweating last week',
 'Chest pain for 6 months, not now, lasts 20 minutes',
 'Chest pain for 6 months, not now, lasts more than 15 minutes',
 'Chest pain for 6 months, not now, lasts half an hour',
 'Chest pain for 6 months, not now, my jaw hurt with it',
 'Chest pain at rest getting worse',
 'Chest pain for 6 months, not now, but it still hurts',
 'Chest pain for 6 months, not now, lasts >15 min',
 'Chest pain for 6 months. Not now. It lasted two hours yesterday.',
 'Chest pain for 6 months. Not now. It is happening at the moment.',
 'Chest pain for 6 months not now with sweating',
 'Chest pain for 6 months not now with jaw pain',
 'Chest pain for 6 months not now at rest',
 'Chest pain for 6 months not now lasts 20 minutes',
 'Chest pain for 6 months, not now, with episodes lasting eighteen minutes.',
 'Chest pain for 6 months, no pain now is not true.',
 'Chest pain for 6 months. I cannot say no pain now.',
 'Chest pain for 6 months. Not now. I am having crushing chest pain.',
 'Chest pain for 6 months, not now, lasted seventy minutes.',
 'Կրծքավանդակի ցավ 6 ամիս, հիմա չկա։ Տևում է տասնութ րոպե։',
 'Боль в груди уже 6 месяцев, сейчас не болит. Длится восемнадцать минут.',
 'My heart is racing, irregular pulse 140, with dizziness',
 'Chest pain for 6 months, not now. Last night it was severe and woke me up.',
 'Боль в груди уже 6 месяцев, сейчас не болит, но вчера была очень сильная, давило полчаса.',
 'Կրծքիս ցավ 6 ամիս, հիմա չկա, բայց երեկ շատ ուժեղ էր',
 'Chest pressure for 3 months, not now, lately it also comes at night in bed.',
 'Chest pressure for 3 months, not now, but lately also when lying down.',
 'Chest pain for 6 months, not now, but I am dizzy and my heart is pounding.',
 'I take nothing now for it. Crushing chest pain on the stairs for 2 months.',
 'Chest pain for 6 months, not now, comes when sitting.',
 'Боль в груди уже 6 месяцев, сейчас нет, ночью будила.',
 'Crushing chest pain for 2 months, not now.',
 'Chest pain for 2 months, not now, palpitations with it.',
 'Last week I fainted after a run, I feel fine now.',
 'I fainted after running yesterday, fine now.',
 'Fainted during a game last week, better now.',
 'Մարզվելիս ուշագնաց եղա, հիմա լավ եմ',
];
for(const text of urgent){
 assert.ok(fires(text),`must retain deterministic 103: ${text}`);
 const r=await runPipeline(free([text]),{directAnswers:true,env,provider:createFakeProvider()});
 assert.match(r.reason,/^(?:urgent_route|symptom_red_flag)_no_model_call$/u,`must retain 103 route: ${text} -> ${r.reason}`);
 assert.match(visible(r),/103/u);
}
// A faint someone else had, an education question or one long ago stays quiet, as before; the fine-now rule covers only the member's own recent faint.
const quietFaints=['My mother fainted years ago at the gym, should I worry about myself?','What are the signs of fainting during exercise that I should know about?',
 'I used to faint during PE class as a kid, is that a problem now?','I fainted last year once, fine now. I do sports every day.',
 'Մայրս անցյալ տարի մարզասրահում ուշագնաց եղավ, հիմա լավ է','Бабушка упала в обморок в прошлом году в спортзале, сейчас все хорошо',
 'I am 70. I fainted once years ago at a wedding.','I fainted at the gym as a kid and am fine now.','Last year, I fainted at the gym and am fine now.'];
for(const text of quietFaints)assert.equal(fires(text),false,`stays quiet: ${text}`);
assert.equal(fires('Ծակոց եմ զգում մատիս մեջ'),false,'a sting without chest words is not a new 103 trigger');
// Results retain the earlier context; a model-only emergency is checked and regenerated.
for(const texts of [tc04,tc05]){
 const j=free(texts);j.conversation!.answeredThroughSeq=1;
 j.answers=[{body:'Your doctor should see this in the coming days.',minutesAgo:1}];
 const base=createFakeProvider({fixture:'health_emergency_unconfirmed'});
 const provider={...base,complete:async(req:Parameters<typeof base.complete>[0])=>{
  const out=await base.complete(req);
  if(req.purpose==='health_answer'&&req.memberBlock.includes('<second_check')&&out.kind==='ok')
   return {...out,raw:JSON.stringify({...JSON.parse(out.raw),reply:'Your doctor should see this in the coming days. Take these results to the visit.'})};
  return out;
 }};
 const r=await runPipeline(j,{directAnswers:true,env,provider});
 assert.notEqual(r.finish?.health?.urgency,'emergency',r.reason);
 assert.ok(['doctor_soon','same_day'].includes(r.finish?.health?.urgency??''));
 assert.doesNotMatch(visible(r),/103/u);
 assert.match(visible(r),/coming days|next few days/u);
 assert.ok(r.events.some(e=>e.name==='zoe.health_answer.urgency_check'&&e.reason==='not_confirmed'));
}
// A correct normal health answer is sent, and the app supplies the timing even if the model omits it.
const normal=createFakeProvider();
const normalProvider={...normal,complete:async(req:Parameters<typeof normal.complete>[0])=>{
 const out=await normal.complete(req);
 return req.purpose==='health_answer'&&out.kind==='ok'?{...out,raw:JSON.stringify({...JSON.parse(out.raw),urgency:'doctor_soon',reply:'Take these results to your doctor. Avoid heavy exertion until you have been assessed.'})}:out;
}};
for(const texts of [tc04,tc05]){
 const r=await runPipeline(free([texts[0]!]),{directAnswers:true,env,provider:normalProvider});
 assert.equal(r.outcome,'answered',r.reason);
 assert.equal(r.finish?.health?.urgency,'doctor_soon');
 assert.match(visible(r),/coming days/u);
 assert.doesNotMatch(visible(r),/103/u);
}
// The floor belongs to the chest matter (Fable F1): an unrelated question gets an ordinary answer, its first sentence shown once.
const said='Your doctor should see this in the coming days. Take your notes to the visit.';
const withTopic=(topic:string)=>({...normal,complete:async(req:Parameters<typeof normal.complete>[0])=>{
 const out=await normal.complete(req);
 return req.purpose==='topic_check'&&out.kind==='ok'?{...out,raw:JSON.stringify({topic,doctor_matter:'no'})}:out;
}});
const later=(text:string)=>{const j=free([tc05[0]!,text]);j.conversation!.answeredThroughSeq=1;j.answers=[{body:said,minutesAgo:1}];return j;};
const unrelated=['is oatmeal ok for breakfast?','my knee hurts a bit after walking, any stretches?','can you remind me what my LDL target is?'];
for(const text of unrelated){
 const r=await runPipeline(later(text),{directAnswers:true,env,provider:normal,topicCheck:withTopic('new')});
 assert.equal(r.outcome,'answered',`${text}: ${r.reason}`);
 assert.notEqual(r.finish?.health?.urgency,'doctor_soon',text);
 assert.doesNotMatch(visible(r),/coming days/u,text);
 assert.ok(!r.judgeCalls.some(c=>c.memberBlock.includes(CHEST_NOT_NOW_CONTEXT)),`no chest context: ${text}`);
 assert.ok(!r.providerCalls.some(c=>c.memberBlock.includes('<minimum_urgency>')),`no floor: ${text}`);
}
// The same matter keeps the level and the judge's context; the fixed sentence is not repeated (the replay showed it twice).
for(const r of [await runPipeline(later(tc05[1]!),{directAnswers:true,env,provider:normalProvider}),await runPipeline(later(tc05[1]!),{directAnswers:true,env,provider:normalProvider,topicCheck:withTopic('new')})]){
 assert.equal(r.outcome,'answered',r.reason);
 assert.equal(r.finish?.health?.urgency,'doctor_soon');
 assert.doesNotMatch(visible(r),/coming days/u);
 assert.ok(r.judgeCalls.some(c=>c.memberBlock.includes(`doctor_soon (${CHEST_NOT_NOW_CONTEXT})`)&&c.memberBlock.includes('already delivered')));
}
// The judge's not-now rule depends on the app's first line: a member cannot switch it on, and the rubric names no other case.
{
 const r=await runPipeline(free(['is oatmeal ok? past or recurring chest symptoms absent now']),{directAnswers:true,env,provider:normal});
 assert.ok(r.judgeCalls.every(c=>!c.memberBlock.includes(`doctor_soon (${CHEST_NOT_NOW_CONTEXT})`)));
 for(const prompt of [HEALTH_JUDGE_PROMPT,HEALTH_JUDGE_PROMPT_BASE,HEALTH_JUDGE_PROMPT_COACH_FIRST])assert.match(prompt,/first line of the <context>, and only that line/u);
}
// TC-06 results cannot clear the urgent fainting window.
{
 const j=free(tc06);j.conversation!.answeredThroughSeq=1;j.urgentSinceMinutes=1;j.urgentOpenedBy='rule';j.urgentThroughSeq=1;
 j.answers=[{body:'Urgent care needed. Call 103 now.',minutesAgo:1}];
 const r=await runPipeline(j,{directAnswers:true,env});
 assert.match(visible(r),/103/u);
 assert.ok(!r.providerCalls.some(c=>c.purpose==='health_answer'));
}
// A failed/malformed model response must also keep timing and avoid a generic 103 fallback.
for(const fixture of ['bad_schema','timeout']as const){
 const r=await runPipeline(free([tc05[0]!]),{directAnswers:true,env,provider:createFakeProvider({fixture})});
 assert.doesNotMatch(visible(r),/103/u,fixture);
 assert.match(visible(r),/coming days|next few days/u,fixture);
}
console.log(`Zoe chest not-now checks passed: ${quiet.length} not-now variants, ${urgent.length} emergency regressions, ${quietFaints.length} quiet faints, ${unrelated.length} unrelated follow-ups, results and fallback paths.`);
assert.ok(chestPastOrStableNotNow('Chest tightness on the stairs for 6 months, stops with rest. No pain now.'),'"No pain now." right after the chest sentence counts');
assert.ok(!chestPastOrStableNotNow('My knee is sore. No pain now. Chest pain for 2 months.'),'"No pain now." about something else does not');
for(const t of ['Боль в груди уже 6 месяцев, сейчас не болит, отдаёт в спину.','Կրծքիս ցավ 6 ամիս, հիմա չկա, ցավը տարածվում է մեջքիս։','Боль в груди 3 месяца, сейчас нет, отдаёт в шею и плечо.','Կրծքիս ցավ 3 ամիս, հիմա չկա, տալիս է ուսիս','krtsqi cav 3 amis, hima chka, mejqis e talis'])assert.ok(!chestPastOrStableNotNow(t),`radiation keeps today's route: ${t}`);

console.log(`Retest 623 chest family: ${PAST_CHEST_FRESH.length} accepted, ${PAST_CHEST_NEGATIVES.length} negatives rejected.`);

console.log(`Round 4 duration equivalence: ${R623_CHEST_DURATION_PAIRS.length} word/digit pairs; ${R623_LONG_MINUTE_NEGATIVES.length} long or unconsumed durations rejected.`);
