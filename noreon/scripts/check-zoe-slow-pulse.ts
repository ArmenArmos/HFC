import assert from 'node:assert/strict';
import {levelTwoFloors} from '@/lib/zoe/same-day-floors';
import {FREE_MODE_CONFIG} from '@/lib/zoe/free-mode-config';
import {sameDayFloor,SAME_DAY_LINE} from '@/lib/zoe/health-answer';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';
import {createFakeProvider} from '@/lib/zoe/provider';

// STAGING rule pending Armen sign-off. The pipeline checks use local stand-ins and in-memory ports only.
const positives=[
 'My pulse is 46 and I feel dizzy',
 'My pulse is 49 and I feel lightheaded',
 'My heart rate is 45 and I feel weak',
 'My pulse: 49.9 bpm, I have weakness',
 'My watch says my pulse is 46. I feel dizzy.',
 'Pulse 48, dizziness',
 'My pulse is 46 and I am dizzy, should I call my doctor?',
 'У меня пульс 46 и головокружение',
 'Мой пульс 49, кружится голова',
 'У меня пульс 45, слабость',
 'ЧСС 48, голова кружится',
 'Пульс 49,9, чувствую слабость',
 'Պուլսս 46 է, գլխապտույտ ունեմ',
 'Իմ պուլսը 49 է, թույլ եմ',
 'Զարկերս 48 են, գլուխս պտտվում է',
 'Պուլսս 45 է։ Թուլություն ունեմ։',
 'Իմ սրտի զարկերը 47 են, գլխապտույտ ունեմ',
 'Սրտիս զարկերը 48 է, գլուխս պտտվում է',
 'Pulss 46 a, glxaptuyt unem',
 'Im puls 49 e, tuyl em',
 'Pulsis 48 e, gluxs pttvum e',
 'Im srti zarker 45 en, tulutyun unem',
 'My pulse is 46 and I feel dizzy, can I wait until tomorrow?',
 'My pulse is 46 and I feel dizzy, can you help?',
 'My pulse is 46 and I feel dizzy can you help?',
 'My pulse is 46 and I feel weak, could I wait?',
 'My pulse is 46 and I feel lightheaded, would resting help?',
 'My pulse is 46 and I feel dizzy, does this need a doctor?',
 'My pulse is 46. Can you help, I feel dizzy?',
 'У меня пульс 46 и головокружение, может ли врач помочь?',
 'Պուլսս 46 է, գլխապտույտ ունեմ, կարող եմ սպասել՞',
 'Pulss 46 a, glxaptuyt unem, karox em spasel?',
];
// R1: another person in the message must not erase the member's reading/symptom.
// Only certainly other-person readings AND symptoms are excluded; mixed/unclear ownership keeps the floor.
const mixedPeople=[
 'My pulse is 46 and my mother and I both feel dizzy',
 'My pulse is 46, and I feel dizzy. My mother is here.',
 'My pulse is 46 and I feel dizzy. My mother has a normal pulse.',
 'My mother is here. My pulse is 46 and I feel dizzy.',
 'My mother and I both feel dizzy. My pulse is 46.',
 'My pulse is 46 and we both feel dizzy',
 'My pulse is 46 and both of us feel weak',
 'My mother feels fine, my pulse is 46 and I feel dizzy',
 'Her pulse is 70; my pulse is 46 and I feel weak',
 'My pulse is 46 and I feel weak; my doctor told me to ask.',
 'My pulse is 46. My mother feels dizzy.',
 'Her pulse is 46 and I feel dizzy',
 'У меня пульс 46, и мы с мамой оба чувствуем слабость',
 'Мой пульс 46, у мамы тоже головокружение, и у меня головокружение',
 'Мама рядом. У меня пульс 46 и головокружение',
 'У меня пульс 46 и головокружение. У мамы пульс нормальный.',
 'У мамы пульс 70, а у меня пульс 46 и слабость',
 'Мы оба чувствуем слабость. Мой пульс 46.',
 'У меня пульс 46, у нас обоих кружится голова',
 'Мама и я чувствуем слабость, мой пульс 46',
 'У неё пульс 46, а у меня головокружение',
 'У меня пульс 46. У мамы головокружение.',
 'Պուլսս 46 է, մայրս ու ես գլխապտույտ ունենք',
 'Իմ պուլսը 46 է, երկուսս էլ թուլություն ունենք',
 'Մայրս այստեղ է։ Պուլսս 46 է, գլխապտույտ ունեմ։',
 'Պուլսս 46 է, գլխապտույտ ունեմ։ Մորս պուլսը նորմալ է։',
 'Մորս պուլսը 70 է, իմ պուլսը 46 է, թույլ եմ',
 'Մենք երկուսս էլ գլխապտույտ ունենք։ Պուլսս 46 է։',
 'Իմ պուլսը 46 է, ես ու մայրս թուլություն ունենք',
 'Նրա պուլսը 46 է, ես գլխապտույտ ունեմ',
 'Պուլսս 46 է։ Մայրս գլխապտույտ ունի։',
 'My pulse is 46, у меня головокружение. Мама рядом.',
 'Պուլսս 46 է, I feel dizzy and my mother is here',
 'У мамы pulse 70, my pulse 46 and I feel weak',
 'Im puls 46 e, mayrs ev es glxaptuyt unenq',
 'Mayrs aystegh e. Pulss 46 e, glxaptuyt unem',
 'My mother is here, im puls 46 e, tuyl em',
 'Nra puls 46 e, glxaptuyt unem',
 'Pulse 46, dizziness; mother is here',
 'Her pulse is 46. Dizzy.',
 'My mother is here, pulse 46 and dizziness',
 'My mother is here and pulse 46 and I feel dizzy',
 'My mother says pulse 46 and dizziness',
 'My mother brought the monitor, pulse 46, dizziness',
 'Мама рядом, пульс 46 и головокружение',
 'У мамы новый прибор, пульс 46 и слабость',
 'Մայրս այստեղ է, պուլս 46, գլխապտույտ կա',
 'Mayrs aystegh e, puls 46, glxaptuyt ka',
 'My mother asked if she should sit down, my pulse is 46 and I feel dizzy',
 'My mother had a slow pulse last year and my pulse is 46 and I feel dizzy',
 'Мама спросила, если ей нужно сесть, мой пульс 46 и у меня головокружение',
 'Մայրս հարցրեց, եթե նստի լավ կլինի, պուլսս 46 է, գլխապտույտ ունեմ',
 'Her pulse is 46 and we both feel dizzy, should we call a doctor?',
 'Her pulse is 46 and both of us feel weak, can we wait?',
 'У неё пульс 46, у нас обоих головокружение, что делать?',
 'Նրա պուլսը 46 է, մենք գլխապտույտ ունենք, կարող ենք սպասել՞',
 'Nra puls 46 e, glxaptuyt unenq, karox enq spasel?',
];
positives.push(...mixedPeople);
const negatives=[
 'My watch says my pulse is 46 this morning',
 'My pulse is 49',
 'My pulse is 50 and I am dizzy',
 'My pulse is 51 and I feel weak',
 'My pulse is 60 and I feel lightheaded',
 'My pulse is 46, I am not dizzy',
 'My pulse is 46, no weakness or dizziness',
 'My pulse is not 46 and I am dizzy',
 'My mother has pulse 46 and dizziness',
 'Her pulse is 46 and she feels weak',
 'Is pulse below 50 with dizziness dangerous?',
 'If my pulse is 46 and I feel dizzy, what should I do?',
 'Can a pulse of 46 cause dizziness?',
 'My pulse is 46. Can it cause dizziness?',
 'My pulse is 46. Am I dizzy?',
 'My pulse is 46. Is weakness a symptom?',
 'У меня пульс 46. Может ли это вызывать слабость?',
 'My pulse is below 50 and I feel dizzy',
 'My pulse was 46 last year and I felt dizzy',
 'My pulse is 0 and I feel dizzy',
 'My pulse medicine is 46 mg and I feel dizzy',
 'У мамы пульс 46, слабость',
 'У отца пульс 46, головокружение',
 'Մորս պուլսը 46 է, գլխապտույտ ունի',
 'Пульс 46, головокружения нет',
 'У меня пульс 50, кружится голова',
 'Если пульс ниже 50 и слабость, это опасно?',
 'Պուլսս 46 է, գլխապտույտ չկա',
 'Մայրս պուլս 46 ունի, թույլ է',
 'Պուլսս 50 է, թուլություն ունեմ',
 'Եթե պուլսը 46 է ու գլխապտույտ կա, ի՞նչ անել',
 'Pulss 46 e',
 'Im puls 50 e, tuyl em',
 'Mayrs puls 46 uni, glxaptuyt uni',
 'Im puls 46 e, glxaptuyt chka',
 'Can pulse 46 cause dizziness?',
 'Can I feel dizzy with my pulse of 46?',
 'My pulse is 46, could I develop weakness?',
 'My pulse is 46. Would I feel lightheaded?',
 'My pulse is 46, does this cause dizziness?',
 'My pulse is 46 and I do not feel dizzy, can you help?',
 "My mother's pulse is 46 and she feels dizzy. I am here.",
 'His pulse is 46. He feels weak.',
 'У мамы пульс 46 и у неё головокружение. Я рядом.',
 'Мамин пульс 46, она чувствует слабость.',
 'Մորս պուլսը 46 է, նա գլխապտույտ ունի։ Ես այստեղ եմ։',
 'Nra puls 46 e, nra glxaptuyt ka',
];
assert.equal(FREE_MODE_CONFIG.slowPulseBpm,50);
const fires=(texts:readonly string[])=>levelTwoFloors(texts,null).includes('slow_pulse_dizzy');
for(const text of positives){assert.equal(fires([text]),true,`slow pulse floor: ${text}`);assert.equal(sameDayFloor([text],null),true,text);}
for(const text of negatives)assert.equal(fires([text]),false,`no slow pulse floor: ${text}`);
for(const texts of [['My pulse is 46','I feel dizzy'],['Պուլսս 46 է','Թույլ եմ'],['Пульс 46','Кружится голова'],['Pulss 46 e','tuyl em']])
 assert.equal(fires(texts),false,'the pulse and symptom must be in the same message');

const env={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const free=(texts:string[])=>job(texts,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0}});
const visible=(r:Awaited<ReturnType<typeof runPipeline>>)=>r.finish?.answer??r.finish?.receipt?.text??'';
const base=createFakeProvider();
const ordinary={...base,complete:async(req:Parameters<typeof base.complete>[0])=>{
 const out=await base.complete(req);
 return req.purpose==='health_answer'&&out.kind==='ok'?{...out,raw:JSON.stringify({...JSON.parse(out.raw),urgency:'self_monitoring',reply:'Rest while you arrange a clinical assessment.'})}:out;
}};
// The ordinary mocked answer cannot lower the floor, and failed provider output cannot drop its timing.
for(const text of [positives[0]!,positives[7]!,positives[12]!,positives[17]!,...mixedPeople]){
 const r=await runPipeline(free([text]),{directAnswers:true,env,provider:ordinary});
 assert.equal(r.finish?.health?.urgency,'same_day',`${text}: ${r.reason}`);
 assert.doesNotMatch(r.reason,/^(?:urgent_route|symptom_red_flag)_/u,text);
 assert.match(visible(r),/today|сегодня|այսօր/u,text);
}
for(const fixture of ['bad_schema','timeout']as const)for(const text of [positives[0]!,...mixedPeople]){
 const r=await runPipeline(free([text]),{directAnswers:true,env,provider:createFakeProvider({fixture})});
 assert.equal(r.finish?.health?.urgency,'same_day',fixture);
 assert.match(visible(r),/today|сегодня|այսօր/u,`${fixture}: ${text}`);
}
for(const text of [negatives[0]!,negatives[2]!,negatives[8]!,negatives[11]!]){
 const r=await runPipeline(free([text]),{directAnswers:true,env});
 assert.notEqual(r.finish?.health?.urgency,'same_day',`${text}: ${r.reason}`);
 assert.ok(!r.providerCalls.some(c=>c.memberBlock.includes('<minimum_urgency>same_day')),text);
}
// Existing urgent symptoms and an already-open urgent window retain the emergency route.
for(const text of ['My pulse is 46 and I feel dizzy. I have chest pain now.',
 'My pulse is 46 and I feel weak. I cannot breathe.']){
 const r=await runPipeline(free([text]),{directAnswers:true,env});
 assert.match(visible(r),/103/u,text);
 assert.ok(!r.providerCalls.some(c=>c.purpose==='health_answer'),text);
}
{
 const j=free(['I have chest pain now',positives[0]!]);
 j.conversation!.answeredThroughSeq=1;j.urgentSinceMinutes=1;j.urgentOpenedBy='rule';j.urgentThroughSeq=1;
 j.answers=[{body:'Call 103 now.',minutesAgo:1}];
 const r=await runPipeline(j,{directAnswers:true,env,provider:ordinary});
 assert.match(visible(r),/103/u,'an open urgent window wins');
 assert.ok(!r.providerCalls.some(c=>c.purpose==='health_answer'));
}
// An answered same-day matter keeps its level when the member follows up with its own full reading and symptom.
{
 const j=free([positives[0]!, 'My pulse is still 46 and I still feel dizzy']);
 j.conversation!.answeredThroughSeq=1;j.answers=[{body:SAME_DAY_LINE.en,minutesAgo:1}];
 const r=await runPipeline(j,{directAnswers:true,env,provider:ordinary});
 assert.equal(r.finish?.health?.urgency,'same_day',r.reason);
 assert.doesNotMatch(r.reason,/^(?:urgent_route|symptom_red_flag)_/u);
}
console.log(`Zoe slow pulse checks passed: ${positives.length} positives (${mixedPeople.length} mixed-person), ${negatives.length} negatives, 4 split-message controls, ${14+mixedPeople.length*3} mocked pipeline checks. STAGING: pending Armen sign-off.`);
