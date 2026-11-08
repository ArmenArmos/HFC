import assert from 'node:assert/strict';
import {replayBmiCases} from './zoe-bmi-replay-cases';
import {BMI_FAMILY} from '@/lib/zoe/eval/conversation-families-bmi-bp';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {registeredSheets} from '@/lib/zoe/symptoms/intake';
import type {ReplyLanguage} from '@/lib/zoe/provider';
import {personalBmiCases,inexactMeasurements,validBmiReplies,wrongBmiReplies,otherSubjects,selfSwitches,harmlessMeasurements} from './zoe-bmi-round2-cases';

// Real pipeline, in-memory ports, no provider or hosted data. Real-model replay belongs to the lead.
const env={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const free=(text:string,lang:ReplyLanguage='en',questionnaire:Record<string,string|number>={})=>job(text,{directAnswers:true,healthAnswers:true,
 conversation:{enabled:true,doctorName:'Test Doctor',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:lang==='en'?'en':'hy'},
 intake:{enabled:true,registered:registeredSheets(),active:null,doctorName:'Test Doctor',latestReading:null,redFlagsAfterSeq:0},memberRecord:{chatCards:false,ageYears:null,doses:null,ldl:null,questionnaire}});
const run=(j:ReturnType<typeof free>)=>runPipeline(j,{directAnswers:true,env});
const visible=(r:Awaited<ReturnType<typeof run>>)=>r.finish?.answer??r.finish?.receipt?.text??'';
const first=await run(free('Can you calculate my BMI?'));
assert.equal(first.reason,'bmi_request','A BMI request asks for numbers before any reply model or doctor handoff');
const {bmiRequest,bmiNumbers,bmiReply}=await import('@/lib/zoe/bmi-request');
const {bmiMessageNumbers,bmiReplyHasValue}=await import('@/lib/zoe/bmi-request');
// Round 4: a recognized correct assertion cannot hide another label in any position.
// Unmarked labels default to personal; only positively identified references are exempt.
const assertionFailures:string[]=[];
for(const [correct,constructions,values]of [
 ['Your BMI is 30.0.', ['Your BMI is VALUE.', 'Your own BMI is VALUE.', 'You have a BMI of VALUE.', 'BMI for you is VALUE.', 'BMI is VALUE for you.', 'BMI VALUE.', 'A BMI of VALUE.'], ['22.0','about 22.0','unknown']],
 ['Индекс массы тела при росте 175 см и весе 92 кг составляет 30,0.', ['У вас ИМТ VALUE.', 'Ваш ИМТ VALUE.', 'Ваш личный ИМТ VALUE.', 'Ваше значение ИМТ VALUE.', 'По вашим данным ИМТ VALUE.', 'ИМТ у вас VALUE.', 'ИМТ VALUE у вас.', 'ИМТ VALUE.'], ['22,0','примерно 22,0','неизвестен']],
 ['Ձեր ՄԶԻ-ն 30.0 է։', ['Ձեր ՄԶԻ-ն VALUE է։', 'Ձեր անձնական ՄԶԻ-ն VALUE է։', 'ՄԶԻ-ն VALUE է ձեր համար։', 'ՄԶԻ-ն VALUE է։'], ['22.0','մոտ 22.0','անհայտ']],
]as const){
 for(const construction of constructions){
  const matching=construction.replace('VALUE','30.0');
  assert.equal(bmiReplyHasValue(matching,'30.0'),true,matching);
  for(const value of values){
   const wrong=construction.replace('VALUE',value);
   for(const text of [`${correct} ${wrong}`,`${wrong} ${correct}`,`${correct}\n${wrong}`,`${wrong}\n${correct}`]){
    if(bmiReplyHasValue(text,'30.0'))assertionFailures.push(text);
   }
  }
 }
}
for(const text of [
 'Your BMI is 30.0; BMI is unknown.',
 'ИМТ неизвестен; Ваш ИМТ 30,0.',
 'Ձեր ՄԶԻ-ն 30.0 է։ ՄԶԻ-ն անհայտ է։',
 'Your BMI is 30.0. Your own BMI is 22 or more.',
 'Ваш ИМТ 30.0. Ваш личный ИМТ 22 и выше.',
 'Ձեր ՄԶԻ-ն 30.0 է։ Ձեր անձնական ՄԶԻ-ն 22-ից բարձր է։',
 'Your BMI is 30.0. BMI 22 is one of your values.',
 'Ваш ИМТ 30.0. ИМТ 22 является обычным для вас.',
 'Your BMI is 30.0. BMI 22 or more for you.',
 'Ваш ИМТ 30.0. ИМТ 22 и выше у вас.',
 'Ձեր ՄԶԻ-ն 30.0 է։ ՄԶԻ-ն 22-ից բարձր է ձեր համար։',
 'Ваш ИМТ 30.0. ИМТ по вашим данным (рост 175 см, вес 92 кг) составляет 22 и выше.',
])if(bmiReplyHasValue(text,'30.0'))assertionFailures.push(text);
assert.deepEqual(assertionFailures,[],'Every non-reference BMI assertion must parse and match');
for(const reference of [
 'A BMI of 25 or more is overweight.',
 'The usual adult BMI range is 18.5 to 24.9.',
 'Обычный диапазон ИМТ для взрослых от 18,5 до 24,9.',
 'Մեծահասակների ՄԶԻ-ի սովորական միջակայքը 18.5-ից 24.9 է։',
])for(const text of [`Your BMI is 30.0. ${reference}`,`${reference} Your BMI is 30.0.`]){
 assert.equal(bmiReplyHasValue(text,'30.0'),true,text);
}
console.log('BMI round 4: personal constructions, unknown values, both assertion orders and general references in en/ru/hy.');
// Captured valid assertions pass; changing a personal value must never be rescued by a reference.
const replayFailures:string[]=[];
for(const row of replayBmiCases){
 if(bmiReplyHasValue(row.reply,row.expected)!==row.valid)replayFailures.push(row.id);
 if(row.valid){
  const wrong=row.reply.replace(new RegExp(row.expected.replace('.', '[.,]'),'u'),'18.6');
  if(bmiReplyHasValue(`${wrong} A BMI of ${row.expected} is a boundary.`,row.expected))replayFailures.push(`${row.id}: wrong personal value`);
  for(const text of [`${wrong}\nYour BMI is ${row.expected}.`,`Your BMI is ${row.expected}.\n${wrong}`]){
   if(bmiReplyHasValue(text,row.expected))replayFailures.push(`${row.id}: conflicting personal values`);
  }
 }else{
  const wrong=row.reply.replace(new RegExp(row.expected.replace('.', '[.,]'),'u'),'18.6');
  for(const candidate of [row.reply,wrong])for(const text of [`${candidate}\nՁեր ՄԶԻ-ն ${row.expected} է։`,`Ձեր ՄԶԻ-ն ${row.expected} է։\n${candidate}`]){
   if(bmiReplyHasValue(text,row.expected))replayFailures.push(`${row.id}: uncertain assertion rescued`);
  }
 }
}
assert.deepEqual(replayFailures,[]);
// Parenthetical aliases and interposed measurements cannot turn a general band into a personal value.
for(const text of [
 'Рост 175 см, вес 92 кг; индекс массы тела (ИМТ) 30 является границей.',
 '175 սմ եւ 92 կգ; մարմնի զանգվածի ինդեքսը (ՄԶԻ) 30-ը սահման է։',
 'Ձեր ՔԶԻ-ն 18,5 է։ Ձեր ՄԶԻ-ն 30.0 է։',
 'Ваш ИМТ по вашим данным (рост 175 см, вес 92 кг) составляет -30.0. Ваш ИМТ 30.',
 'Your BMI is about 18.5. Your BMI is 30.0.',
 'Ваш ИМТ по росту 175 см и весу 92 кг примерно 18,5. Ваш ИМТ 30.',
 'Ձեր ՔԶԻ-ն մոտ 18,5 է։ Ձեր ՄԶԻ-ն 30 է։',
])assert.equal(bmiReplyHasValue(text,'30.0'),false,text);
console.log(`BMI replay: ${replayBmiCases.filter(r=>r.valid).length} captured valid replies, ${replayBmiCases.filter(r=>!r.valid).length} uncertain labels held.`);
// R10-01: checking any mention instead of every personal value must fail here.
for(const row of personalBmiCases)assert.equal(bmiReplyHasValue(row.reply,'30.0'),row.valid,row.reply);
// The pipeline's voice cleaner repairs repeated dots before this guard; check the raw token here.
assert.equal(bmiReplyHasValue('Your BMI is 30..0. Your BMI is 30.','30.0'),false);
console.log(`BMI round 3: ${personalBmiCases.length} personal-assertion cases in en/ru/hy.`);
// Round 2: never promote ambiguous inputs or another person's measurements to member facts.
const round2Failures:string[]=[];
for(const text of validBmiReplies)if(!bmiReplyHasValue(text,'30.0'))round2Failures.push(`M2 valid: ${text}`);
for(const text of [...wrongBmiReplies,'BMI 30..0'])if(bmiReplyHasValue(text,'30.0'))round2Failures.push(`M2 wrong: ${text}`);
for(const text of inexactMeasurements){
 const n=bmiMessageNumbers(text),direct=bmiNumbers(text);
 if(n.height!==null&&n.weight!==null||direct.height!==null&&direct.weight!==null)round2Failures.push(`M1: ${text}`);
}
for(const previous of otherSubjects){
 const n=bmiMessageNumbers('175 cm, 92 kg',[previous,'What do those readings mean?']);
 if(n.height!==null||n.weight!==null)round2Failures.push(`M3: ${previous}`);
 const stillOther=bmiMessageNumbers('175 cm, 92 kg',[previous,'I am asking for a brief explanation']);
 if(stillOther.height!==null||stillOther.weight!==null)round2Failures.push(`M3 neutral first person: ${previous}`);
 for(const text of selfSwitches){
  const own=bmiMessageNumbers(text,[previous]);
  if(own.height!==175||own.weight!==92)round2Failures.push(`M3 switch: ${previous} -> ${text}`);
 }
}
for(const text of harmlessMeasurements){
 const n=bmiMessageNumbers(text);
 if(n.height!==175||n.weight!==92)round2Failures.push(`M4: ${text}`);
}
assert.deepEqual(round2Failures,[]);
console.log(`BMI round 2: M1 ${inexactMeasurements.length}, M2 ${validBmiReplies.length} equivalent and ${wrongBmiReplies.length+1} wrong replies, M3 ${otherSubjects.length*2} third-party follow-ups and ${otherSubjects.length*selfSwitches.length} explicit switches, M4 ${harmlessMeasurements.length}.`);
const missing={en:{height:/height/u,weight:/weight/u},hy:{height:/հասակ/iu,weight:/քաշ/iu},ru:{height:/рост/iu,weight:/вес/iu}};
function fixed(r:Awaited<ReturnType<typeof run>>){
 assert.equal(r.reason,'bmi_request');assert.equal(r.providerCalls.length,0);assert.equal(r.judgeCalls.length,0);assert.equal(r.reserved,null);
 assert.deepEqual(r.finish?.health,{urgency:'none',modelUrgency:'none',forward:'none',forwardReason:'none'});
 assert.doesNotMatch(visible(r),/103|I've also passed|Սա փոխանցեցի նաև|Я также передала|risk score|риск|ռիսկ/iu);
 assert.ok(r.events.some(e=>e.name==='zoe.bmi_request'&&e.actor==='system'&&e.reason==='bmi_request'));
}
for(const [index,f] of BMI_FAMILY.entries()){
 const text=f.turns[0]!.text as string;
 assert.equal(bmiRequest(text),true,text);
 const r=await run(free(text,f.lang as ReplyLanguage));fixed(r);
 const lang=r.finish!.receipt!.language;
 assert.equal(lang,f.lang,'The receipt uses safetyLang');
 const given=new Map([[5,'26.8'],[6,'31.1'],[9,'31.1'],[12,'26.1']]);
 if(given.has(index))assert.ok(visible(r).includes(given.get(index)!),text);
 else{
  assert.match(visible(r),missing[lang].height,text);
  assert.equal(missing[lang].weight.test(visible(r)),index!==4,text);
  const heightKnown=await run(free(text,f.lang as ReplyLanguage,{'q2.height':172}));fixed(heightKnown);
  if(index===4)assert.match(visible(heightKnown),/27\.7/u);
  else assert.match(visible(heightKnown),missing[lang].weight);
  const weightKnown=await run(free(text,f.lang as ReplyLanguage,{'q2.weight':82}));fixed(weightKnown);
  assert.match(visible(weightKnown),missing[lang].height);assert.doesNotMatch(visible(weightKnown),missing[lang].weight);
 }
 // Requests already carrying measurements must not gain a second height or weight.
 const withNumbers=index===4||given.has(index)?'Calculate my BMI':text;
 const both=await run(free(`${withNumbers} Height 178 cm, weight 85 kg.`,f.lang as ReplyLanguage));fixed(both);
 assert.match(visible(both),/26\.8/u,text);assert.match(visible(both),/178/u);assert.match(visible(both),/85/u);assert.match(visible(both),/18\.5.*24\.9/u);
}
const negatives=[
 'What is BMI?','What does BMI stand for?','What does a BMI of 32 mean?','Tell me about BMI','How do you calculate BMI?',
 'What is the formula for body mass index?','Is BMI useful?','My BMI is 25','Can you explain my BMI of 32?',
 'What is a normal BMI?','Calculate my risk score','Please tell me my height','Can you calculate 2 + 2?',
 "Calculate my mother's BMI","What is my son's BMI?","Can you calculate her BMI?","Calculate BMI for my friend",
 'Посчитай ИМТ моей мамы','Какой ИМТ у моего мужа?','Что такое ИМТ?','Что значит ИМТ 32?','Как рассчитать ИМТ?',
 'Что такое индекс массы тела?','Ի՞նչ է BMI-ն','Ինչպե՞ս հաշվել BMI-ն','Հաշվիր մորս BMI-ն','Ի՞նչ է նշանակում BMI 32',
 'Посчитай ИМТ моей сестры','Calculate BMI using an example',
 'Calculate BMI for Alex','Calculate my brother-in-law’s BMI','Посчитай ИМТ моего брата',
 'Calculate your BMI','Do not calculate my BMI','I do not want you to calculate my BMI',
];
for(const text of negatives)assert.equal(bmiRequest(text),false,text);
const extra=['Compute my BMI','Count my BMI','Give me my body mass index','Tell me my BMI','Work out BMI for me',
 'rasschitai moi imt','hashvir im BMI','hashvel im marmni zangvatsi indeks','Հաշվեք իմ մարմնի զանգվածի ինդեքսը',
 'Можешь рассчитать мой индекс массы тела?','Ինչքան է իմ BMI-ն'];
for(const text of extra)assert.equal(bmiRequest(text),true,text);
for(const lang of ['en','hy','ru']as const){
 const ask=lang==='en'?'Calculate my BMI':lang==='hy'?'Հաշվիր իմ BMI-ն':'Посчитай мой ИМТ';
 for(const [facts,height,weight]of [ [{},true,true],[{'q2.height':172},false,true],[{'q2.weight':82},true,false] ]as const){
  const r=await run(free(ask,lang,facts));fixed(r);
  assert.equal(missing[lang].height.test(visible(r)),height);assert.equal(missing[lang].weight.test(visible(r)),weight);
 }
 const known=await run(free(ask,lang,{'q2.height':172,'q2.weight':82}));fixed(known);assert.match(visible(known),/27\.7/u);
 assert.match(visible(known),/172/u);assert.match(visible(known),/82/u);
 assert.match(visible(known),/doctor|բժիշկ|врач/iu);assert.doesNotMatch(visible(known),/obes|overweight|lose|goal|ожир|похуд|նիհար|ճարպակալ/iu);
}
for(const [text,expected]of [
 ['178 cm and 85 kg',{height:178,weight:85}],['height 1.70 m, weight 90 kg',{height:170,weight:90}],
 ['рост 1,70, вес 90',{height:170,weight:90}],['рост 170, вес 90',{height:170,weight:90}],
 ['Հասակս 175 է, քաշս՝ 80',{height:175,weight:80}],['I weigh 82 kg',{height:null,weight:82}],
 ['1.70 metres and 90 kilograms',{height:170,weight:90}],['170 см и 90 кг',{height:170,weight:90}],
 ['հասակս՝ 170 սմ, քաշս՝ 90 կգ',{height:170,weight:90}],
 ['height 99 cm, weight 24 kg',{height:null,weight:null}],['height 231 cm weight 301 kg',{height:null,weight:null}],
 ['height 100 cm weight 25 kg',{height:100,weight:25}],['height 230 cm weight 300 kg',{height:230,weight:300}],
 ['height 170 cm weight 80..5 kg',{height:170,weight:null}],['height 170 cm weight 80 pounds',{height:170,weight:null}],
 ['height 1.70 cm weight 80 kg',{height:null,weight:80}],['height 170 m weight 80 kg',{height:null,weight:80}],
 ['height -170 cm weight -80 kg',{height:null,weight:null}],['I am 45 years old, BMI?',{height:null,weight:null}],
]as const)assert.deepEqual(bmiNumbers(text),expected,text);
assert.deepEqual(bmiNumbers('I weigh 82 kg',{'q2.height':172,'q2.weight':90}),{height:172,weight:82});
assert.deepEqual(bmiNumbers('height 170 cm weight +800 kg',{'q2.height':172,'q2.weight':90}),{height:170,weight:null});
assert.deepEqual(bmiNumbers('height 99 cm',{'q2.height':172,'q2.weight':80}),{height:null,weight:80},'An explicit invalid number must not revive the record value');
assert.deepEqual(bmiNumbers('',{'q2.height':'170','q2.weight':'90'}),{height:170,weight:90});
assert.deepEqual(bmiNumbers('',{'q2.height':1.70,'q2.weight':80}),{height:null,weight:80},'Questionnaire height is always cm');
assert.deepEqual(bmiNumbers('',{'q2.height':99,'q2.weight':301}),{height:null,weight:null});
assert.match(bmiReply('en',bmiNumbers('178 cm 85 kg')),/26\.8/u);
// No deterministic BMI answer can swallow another matter, including an urgent or mild symptom, a saved floor or doctor mode.
for(const text of ['Calculate my BMI. I have a rash','Calculate my BMI. I have diarrhea','Calculate my BMI. Should I stop my medication?',
 'Calculate my BMI. Chest pain now','Calculate my BMI, BP 190/120','Calculate my BMI. I have a headache',
 'Calculate my BMI. My knee hurts','Calculate my BMI. У меня кашель','Հաշվիր իմ BMI-ն, փորս ցավում է']){
 const r=await run(free(text));assert.notEqual(r.reason,'bmi_request',text);
}
for(const patch of [
 {doctorMode:true}, {healthAnswers:false},
 {urgentSinceMinutes:1,urgentOpenedBy:'rule' as const,urgentThroughSeq:1,answers:[{body:'Urgent care needed. Call 103 now.',minutesAgo:1}]},
 {health:{bpWeek:null,labs:[{marker:'Potassium',value:6.3,unit:'mmol/L',low:null,high:null,daysAgo:0,reviewed:false}],plan:null}},
])assert.notEqual((await run({...free('Calculate my BMI'),...patch})).reason,'bmi_request');
// Why records carry the fixed rule and never imply a doctor forward.
const why:{records:import('@/lib/zoe/why').ZoeWhy[]}={records:[]};
await runPipeline(free('Calculate my BMI'),{directAnswers:true,env,why});
assert.equal(why.records.length,1);assert.equal(why.records[0]!.decidedBy,'rule');
assert.equal(why.records[0]!.doctor.how,'none');
assert.ok(why.records[0]!.rules.some(r=>r.rule==='zoe.bmi_request'&&r.reason==='bmi_request'));
// A second unanswered message cannot hide an earlier concern in the same batch.
const batch=free('Calculate my BMI');batch.messages=[{seq:1,text:'I have a rash',minutesAgo:1},{seq:2,text:'Calculate my BMI',minutesAgo:0}];batch.messageSeq=2;
assert.notEqual((await run(batch)).reason,'bmi_request');
assert.equal(bmiRequest('Calculate my BMI, height 170 cm, weight 80 kg. 170/80'),false,'BMI-02: an extra bare BP pair stays in normal flow');
// BMI-01: only Zoe's latest fixed BMI question opens measurement-only replies.
// Each turn runs through the real pipeline; losing this gate would reserve/call the fake model.
function follow(text:string,previousZoe:string,previousMember='Calculate my BMI',lang:ReplyLanguage='en'){
 const j=free(text,lang);
 j.messages=[{seq:1,text:previousMember,minutesAgo:2},{seq:2,text,minutesAgo:0}];j.messageSeq=2;
 j.conversation!.answeredThroughSeq=1;j.answers=[{body:previousZoe,minutesAgo:1}];
 return j;
}
const followCases:[ReplyLanguage,string,string[]][]=[
 ['en','Calculate my BMI',['170 cm and 80 kg']],
 ['ru','Посчитай мой ИМТ',['170 см и 80 кг']],
 ['hy','Հաշվիր իմ BMI-ն',['170 սմ և 80 կգ']],
 ['en','Calculate my BMI',['height 170 cm','weight 80 kg']],
 ['en','Calculate my BMI',['weight 80 kg','height 170 cm']],
 ['ru','Посчитай мой ИМТ',['рост 170','вес 80']],
 ['ru','Посчитай мой ИМТ',['вес 80','рост 170']],
 ['hy','Հաշվիր իմ BMI-ն',['հասակս՝ 170 սմ','քաշս՝ 80 կգ']],
 ['hy','Հաշվիր իմ BMI-ն',['քաշս՝ 80 կգ','հասակս՝ 170 սմ']],
 ['en','Calculate my BMI',['рост 170 см','քաշս՝ 80 կգ']],
 ['hy','Հաշվիր իմ BMI-ն',['weight 80 kg','height 1.70 m']],
 ['ru','Посчитай мой ИМТ',['1,70 m and 80 kg']],
 ['en','Calculate my BMI, height 170 cm',['80 kg']],
 ['ru','Посчитай мой ИМТ, вес 80 кг',['170 см']],
 ['hy','Հաշվիր իմ BMI-ն, հասակս՝ 170 սմ',['80 կգ']],
];
// Khikar, 4 Nov: the reply is in the language of the latest message; a short Latin-letter reply ("weight 80 kg") keeps the conversation's.
const answerLang=(text:string,lang:'en'|'ru'|'hy')=>/\p{Script=Cyrillic}/u.test(text)?'ru':/\p{Script=Armenian}/u.test(text)?'hy':lang;
for(const [lang,request,replies]of followCases){
 let previousMember=request,previous=await run(free(request,lang));fixed(previous);
 for(const [i,text]of replies.entries()){
  const r=await run(follow(text,visible(previous),previousMember,lang));fixed(r);
  if(i===replies.length-1){assert.match(visible(r),/27\.7/u,text);assert.match(visible(r),/170/u);assert.match(visible(r),/80/u);}
  else assert.match(visible(r),missing[answerLang(text,lang)][text.includes('80')?'height':'weight']);
  previousMember=text;previous=r;
 }
}
const bothQuestion=visible(first);
// Keep the entire exchange, including Zoe's actual answers, on every pipeline call.
// These catch losing the request's height, ignoring corrections, and reviving a record value after invalid input.
const exchangeCases:[string[],string,Record<string,number>][]=[
 [['Calculate my BMI, height 170 cm','weight 800 kg','80 kg'],'27.7',{'q2.height':180}],
 [['Calculate my BMI, height 99 cm, weight 80 kg','no, 72 kg','170 cm'],'24.9',{'q2.height':180,'q2.weight':90}],
 [['Calculate my BMI, weight 800 kg','170 cm','weight 800 kg','no, 72 kg'],'24.9',{'q2.height':180,'q2.weight':90}],
 [['Calculate my BMI, height 99 cm, weight 80 kg','weight 800 kg','170 cm'],'27.7',{'q2.height':180,'q2.weight':90}],
 [['Calculate my BMI, height 99 cm','weight 800 kg','80 kg'],'height',{'q2.height':180}],
 [['Calculate my BMI, weight 800 kg','170 cm','height 999 cm','80 kg'],'27.7',{'q2.height':180,'q2.weight':90}],
 [['Calculate my BMI, weight 800 kg','height 170','no, 72 kg'],'24.9',{'q2.height':180,'q2.weight':90}],
];
for(const [texts,expected,record]of exchangeCases){
 for(const questionnaire of [{},record]){
  let history:ReturnType<typeof free>['messages']=[],answers:ReturnType<typeof free>['answers']=[];
  for(const [i,text]of texts.entries()){
   history=history.map(m=>({...m,minutesAgo:m.minutesAgo+2}));
   answers=answers.map(a=>({...a,minutesAgo:a.minutesAgo+2}));
   history.push({seq:i+1,text,minutesAgo:0});
   const j=free(text,'en',questionnaire);j.messages=history;j.messageSeq=i+1;
   j.conversation!.answeredThroughSeq=i;j.answers=answers;
   const r=await run(j);fixed(r);
   if(i===texts.length-1)assert.match(visible(r),new RegExp(expected.replace('.','\\.')),texts.join(' -> '));
   else assert.match(visible(r),/What (?:are|is)/u,texts.join(' -> '));
   answers.push({body:visible(r),minutesAgo:-1});
  }
 }
}
const noPendingCases=[
 free('170 cm and 80 kg'),
 follow('170 cm and 80 kg','How are you feeling today?'),
 {...follow('170 cm and 80 kg',bothQuestion),answers:[{body:bothQuestion,minutesAgo:3},{body:'What medicines do you take?',minutesAgo:1}]},
 // The claim keeps only recent answers. The old BMI question has already fallen out of that window.
 {...follow('170 cm and 80 kg',bothQuestion),answers:Array.from({length:10},(_,i)=>({body:'How are you feeling today?',minutesAgo:10-i}))},
 {...follow('170 cm and 80 kg',bothQuestion),replies:[{body:'What medicines do you take?',minutesAgo:0}]},
 follow('170 cm and 80 kg. My knee hurts',bothQuestion),
];
for(const j of noPendingCases)assert.notEqual((await run(j)).reason,'bmi_request','Only a pending BMI measurement reply takes the fixed route');
// Old measurements outside the recent member window cannot supply a missing value.
const noOldNumbers=follow('80 kg',bmiReply('en',{height:null,weight:80}));
noOldNumbers.messages=[{seq:2,text:'80 kg',minutesAgo:0}];
const noOldResult=await run(noOldNumbers);fixed(noOldResult);assert.match(visible(noOldResult),/height/u);assert.doesNotMatch(visible(noOldResult),/27\.7/u);

const weightQuestion=bmiReply('en',{height:170,weight:null});
const boundaryBase=()=>{
 const j=free('80 kg');
 j.messages=[{seq:1,text:'Calculate my BMI, height 170 cm',minutesAgo:6},{seq:2,text:'weight 800 kg',minutesAgo:4},{seq:3,text:'80 kg',minutesAgo:0}];
 j.messageSeq=3;j.conversation!.answeredThroughSeq=2;
 j.answers=[{body:weightQuestion,minutesAgo:5},{body:weightQuestion,minutesAgo:3}];
 return j;
};
const boundaryCases=[
 // The request has expired out of the claim's existing recent window, while its later correction remains.
 (j:ReturnType<typeof free>)=>{j.messages=j.messages.slice(1);j.answers=j.answers.slice(1);},
 (j:ReturnType<typeof free>)=>{j.messages[0]!.text='My knee hurts';},
 (j:ReturnType<typeof free>)=>{j.answers[0]!.body='How are you feeling today?';},
 (j:ReturnType<typeof free>)=>{j.replies=[{body:'How are you feeling today?',minutesAgo:4}];},
 (j:ReturnType<typeof free>)=>{j.messages[1]!.text='Calculate my BMI';j.answers[1]!.body=bothQuestion;},
 // Two Zoe lines after the request must not be mistaken for one answer to each member turn.
 (j:ReturnType<typeof free>)=>{j.answers.splice(1,0,{body:'How are you feeling today?',minutesAgo:4});},
];
for(const patch of boundaryCases){
 for(const questionnaire of [{} as Record<string,string|number>,{'q2.height':180} as Record<string,string|number>]){
  const j=boundaryBase();j.memberRecord!.questionnaire=questionnaire;patch(j);
  const r=await run(j);fixed(r);assert.doesNotMatch(visible(r),/27\.7/u);
  assert.match(visible(r),'q2.height'in questionnaire?/24\.7.*180/u:/What is your height/u);
 }
}
// The claim rounds timestamps to minutes; equal ages must still preserve the paired exchange.
const sameMinute=boundaryBase();
sameMinute.messages=sameMinute.messages.map(m=>({...m,minutesAgo:0}));
sameMinute.answers=sameMinute.answers.map(a=>({...a,minutesAgo:0}));
const sameMinuteResult=await run(sameMinute);fixed(sameMinuteResult);assert.match(visible(sameMinuteResult),/27\.7/u);

// The earlier safety and mode gates also win when Zoe has a pending BMI question.
const followSafety=[
 {doctorMode:true}, {healthAnswers:false},
 {urgentSinceMinutes:1,urgentOpenedBy:'rule' as const,urgentThroughSeq:1,answers:[{body:'Urgent care needed. Call 103 now.',minutesAgo:2},{body:bothQuestion,minutesAgo:1}]},
 {health:{bpWeek:null,labs:[{marker:'Potassium',value:6.3,unit:'mmol/L',low:null,high:null,daysAgo:0,reviewed:false}],plan:null}},
];
for(const patch of followSafety)assert.notEqual((await run({...follow('170 cm and 80 kg',bothQuestion),...patch})).reason,'bmi_request');
const urgentFollow=await run(follow('170 cm and 80 kg. Chest pain now',bothQuestion));
assert.equal(urgentFollow.reason,'urgent_route_no_model_call');assert.equal(urgentFollow.providerCalls.length,0);

// BMI-02: every number must belong to the single height or weight, in requests and pending replies.
const numericExtras=[
 '170/80','BP 170/80','190/120','blood pressure 190/120','190 over 120','BP 190 over 120',
 'glucose 7.2 mmol/L','7.2','dose 5 mg','5 mg','2026-11-03','03/11/2026',
 'height 175 cm','175 cm','weight 85 kg','85 kg',
 'давление 170/80','глюкоза 7,2','ճնշում 190/120','5 մգ',
];
for(const extra of numericExtras){
 const measurements=`height 170 cm, weight 80 kg. ${extra}`;
 const request=`Calculate my BMI, ${measurements}`;
 assert.equal(bmiRequest(request),false,request);
 for(const j of [free(request),follow(measurements,bothQuestion)]){
  const r=await run(j);assert.notEqual(r.reason,'bmi_request',j.messages.at(-1)!.text);
  if(extra==='190/120'||extra==='BP 190 over 120'||extra==='blood pressure 190/120'){
   assert.equal(r.reason,'bp_remeasure',extra);assert.equal(r.providerCalls.length,0);assert.equal(r.judgeCalls.length,0);
   assert.match(visible(r),/190\/120/u);
  }
 }
}
console.log(`Zoe BMI checks passed: ${BMI_FAMILY.length} family variants, ${negatives.length} negatives, ${extra.length} extra request variants, ${followCases.length+noPendingCases.length+1+exchangeCases.length*2+boundaryCases.length*2+1} BMI-01 cases (${exchangeCases.length*2} full exchanges, ${boundaryCases.length*2} boundary cases, one same-minute exchange), ${numericExtras.length} BMI-02 cases (each request and follow-up), numbers, record fallback, three languages and safety precedence.`);
