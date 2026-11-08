import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {job,runPipeline,type PipelineRun} from '@/lib/zoe/eval/harness';
import type {ZoeJob} from '@/lib/zoe/pipeline';
import {autoLine,decideForward,FORWARD_REASONS,healthDataBlock,healthReplyPrompt,HEALTH_SYSTEM_PROMPT,healthDataSchema,medicineNoteDue,SAME_DAY_LINE,sameDayFloor,spendLabFloors,STATIN_PAUSE_LINE,STOP_MEDICINE_LINE,stopsMedicine,type HealthData} from '@/lib/zoe/health-answer';
import {soonFloor} from '@/lib/zoe/same-day-floors';
import {createFakeProvider,type ProviderRequest} from '@/lib/zoe/provider';
import {mentionsMedicine} from '@/lib/zoe/output-guard';

// Armen's 20 decisions, tasks 3, 11 and 12, each task's acceptance check. Fake models, in-memory ports, no network.
const env={NOREON_ZOE_FREE_STYLE:'coach-first'};
const free=(texts:string|string[],extra:Partial<ZoeJob>={})=>job(texts,{healthAnswers:true,directAnswers:true,
 intake:{enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0},
 conversation:{enabled:true,doctorName:null,answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'},...extra});
const says=(urgency:string,o:Record<string,unknown>={})=>{const seen:ProviderRequest[]=[];const f=createFakeProvider({fixtureRaw:JSON.stringify({reply:'Plain words about this.',urgency,forward:'none',forward_reason:'none',summary:'s',language:'en',...o})});
 return {seen,provider:{...f,complete:(r:ProviderRequest)=>{seen.push(r);return f.complete(r);}}};};
const run=(j:ZoeJob,urgency:string,o:Record<string,unknown>={})=>runPipeline(j,{directAnswers:true,env,provider:says(urgency,o).provider});
const line=autoLine('en',null);
const health=(r:PipelineRun)=>r.finish!.health!;
const med=(t:string,earlier:string[]=[],background:string[]=[])=>medicineNoteDue(t,earlier,mentionsMedicine,background);

// Task 3: every coming-days turn leaves a note and tells the member; planned and self-care send and offer nothing.
{
 assert.deepEqual(decideForward({forward:'none',forward_reason:'none'},'doctor_soon',false,'coach-first'),{forward:'auto',reason:'coming_days'});
 assert.deepEqual(decideForward({forward:'ask',forward_reason:'symptom_assessment'},'doctor_soon',false,'coach-first'),{forward:'auto',reason:'symptom_assessment'},'The model\'s reason stays for the doctor');
 assert.deepEqual(decideForward({forward:'none',forward_reason:'same_day'},'doctor_soon',false,'coach-first'),{forward:'auto',reason:'coming_days'},'Never labelled same-day below that level');
 for(const u of ['planned','self_monitoring','none']as const)assert.deepEqual(decideForward({forward:'ask',forward_reason:'symptom_assessment'},u,false,'coach-first'),{forward:'none',reason:'none'},u);
 assert.deepEqual(decideForward({forward:'none',forward_reason:'none'},'doctor_soon',false,'coach'),{forward:'none',reason:'none'},'The other styles keep their ask');
 assert.ok(!(FORWARD_REASONS as readonly string[]).includes('coming_days'),'The app sets this reason, the model cannot');
 assert.match('coming_days',/^[a-z0-9_]{1,40}$/u,'zoe_runs_forward_reason_check accepts it, so no migration');
 const note=await run(free('My knee has ached for a week.'),'doctor_soon');
 assert.equal(note.outcome,'answered');assert.equal(note.finish!.reason,'health_answer_passed_guards','An answered run: the urgent routes alone raise a care alert');
 assert.equal(health(note).urgency,'doctor_soon','Below same-day, so the queue keeps it low priority');assert.equal(health(note).forward,'auto');assert.equal(health(note).forwardReason,'coming_days');
 assert.ok(note.finish!.answer!.endsWith(line),'The member is told');
 for(const u of ['planned','self_monitoring']){const r=await run(free('How much salt is fine?'),u);assert.equal(health(r).forward,'none',u);assert.ok(!r.finish!.answer!.includes(line),u);}
 // The same matter, not yet answered by the doctor: the note goes again, the member already knows.
 const next=await run(free(['My knee has ached for a week.','It is the left one.'],{answers:[{body:`It needs a look.\n\n${line}`,minutesAgo:2}],conversation:{enabled:true,doctorName:null,answeredThroughSeq:1,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'}}),'doctor_soon');
 assert.equal(health(next).forward,'auto');assert.ok(!next.finish!.answer!.includes(line),'One line per matter');
 const prompt=healthReplyPrompt('coach-first',true);assert.ok(prompt.includes('At doctor_soon the app always leaves a quiet note'));assert.ok(prompt.includes('for planned, self_monitoring and everything else'));assert.ok(prompt.includes('never offer to send it'));
 assert.ok(!HEALTH_SYSTEM_PROMPT.includes('At doctor_soon the app always leaves'),'The coach prompt keeps its ask');
}

// Task 11: one missed dose stays self-care; a stop is sent; the listed classes are sent however it is said.
{
 for(const t of ['I forgot my amlodipine last night','I did not take my amlodipine this morning','I have not taken my amlodipine today','Забыл вчера выпить амлодипин','Երեկ դեղս բաց թողեցի','Այսօր առավոտյան դեղս չեմ խմել'])
  {assert.equal(med(t),false,t);assert.equal(stopsMedicine(t,[],mentionsMedicine),false,t);}
 for(const t of ['I will stop taking my amlodipine','I stopped my statin last week','Хочу перестать пить лекарство','Ուզում եմ ամլոդիպինը թողնել','Որոշել եմ դադարեցնել ամլոդիպինը','Մի շաբաթ է դեղս չեմ խմում','Перестала пить амлодипин','I have not taken my amlodipine for a week',"I haven't taken my amlodipine for a week"])assert.equal(med(t),true,t);
 assert.equal(med('Կդադարեցնեմ։',['Մետֆորմինից ստամոքսս խանգարվում է։']),true,'The medicine named earlier');
 for(const t of ['I skipped my insulin yesterday','Forgot my warfarin last night','I missed one dose of Eliquis','Stopping prednisolone tomorrow','My doctor told me to stop the warfarin before surgery','I ran out of clopidogrel','I took an extra dose of insulin','Пропустила укол инсулина','Забыл принять варфарин','Երեկ ինսուլինը մոռացա','Վարֆարինի դեղաչափը բաց թողեցի'])assert.equal(med(t),true,t);
 assert.equal(med('I forgot my aspirin',[]),false,'Aspirin alone is a routine missed dose');assert.equal(med('I forgot my aspirin',['I had a stent in March']),true,'After a stent it is sent');assert.equal(med('I forgot my aspirin',[],['ascvd']),true,'A stent on the questionnaire');
 for(const t of ['I never miss my insulin','How should I store my insulin?','What does warfarin do?','I quit smoking, and I take a statin','My headache stopped after the tablet','I will stop by the pharmacy for my tablets','Боль прекратилась после таблетки','Is it fine to walk on warfarin?'])assert.equal(med(t),false,t);
 assert.equal(med('My doctor stopped my amlodipine'),false,'A clinician\'s stop is not the member\'s');
 const missed=await run(free('I forgot my amlodipine last night, what should I do?'),'self_monitoring');assert.equal(health(missed).forward,'none');assert.ok(!missed.finish!.answer!.includes(line),'Nothing sent');
 const stop=await run(free('I have stopped my amlodipine.'),'planned');assert.equal(health(stop).forward,'auto');assert.equal(health(stop).forwardReason,'stopped_medicine','The model\'s level cannot lose it');assert.ok(stop.finish!.answer!.includes(line));
 const key=await run(free('I skipped my insulin this morning.'),'self_monitoring');assert.equal(health(key).forward,'auto');assert.equal(health(key).forwardReason,'stopped_medicine');
 const prompt=healthReplyPrompt('coach-first',true);assert.ok(prompt.includes('One missed dose of a routine medicine is self_monitoring with forward "none"'));assert.ok(HEALTH_SYSTEM_PROMPT.includes('an antiplatelet after a stent, insulin or a steroid'));
 assert.equal(STOP_MEDICINE_LINE.en,"Please don't stop or change a medicine your doctor prescribed on your own; talk to your doctor first, they decide.",'E28 wording kept');
}

// Task 12: no number and no explanation before the doctor's review; critical values still go to the doctor at once.
{
 const lab=(marker:string,value:number,unit:string,o:Partial<HealthData['labs'][number]>={})=>({marker,value,unit,low:null,high:null,daysAgo:2,reviewed:false,...o});
 const withLabs=(...labs:HealthData['labs'])=>({bpWeek:null,labs,plan:null}as HealthData);
 const data=withLabs(lab('LDL cholesterol',5.2,'mmol/L',{high:3}),lab('HbA1c',6.2,'%',{high:5.6,reviewed:true}));
 const block=healthDataBlock(data);
 assert.match(block,/with the doctor, not yet reviewed: LDL cholesterol \(2 days ago\)/u);assert.ok(!block.includes('5.2'),'No value');assert.ok(!block.includes('reference'.concat(' up to 3')),'No range');assert.match(block,/reviewed by the member's doctor: HbA1c 6\.2/u);
 for(const s of ['coach-first','coach','base']as const){const p=healthReplyPrompt(s,true);assert.ok(!p.includes('may be explained'),s);assert.ok(p.includes('say only that the result is with the doctor'),s);}
 const r=says('none');await runPipeline(free('Did my cholesterol result come back?',{health:data}),{directAnswers:true,env,provider:r.provider});
 assert.ok(r.seen.length>0);// The doctor's summary call alone keeps it, in <why_sources>: it writes for the doctor and never reaches the member.
 for(const c of r.seen.filter(x=>x.purpose!=='health_summary'))assert.ok(!c.memberBlock.includes('5.2'),`${c.purpose}: the model never sees it`);
 const own=says('planned');await runPipeline(free('The lab website says my LDL is 5.2, is that high?',{health:data}),{directAnswers:true,env,provider:own.provider});
 assert.ok(own.seen.find(c=>c.purpose==='health_answer')!.memberBlock.includes('5.2'),'A number the member typed stays theirs to discuss');
 // Critical: the floor reads the stored value, whatever the model can see, and only while unreviewed and recent (same-day-floors.ts).
 for(const [m,v,u,o] of [['Potassium',6.4,'mmol/L',{}],['Sodium',120,'mmol/L',{}],['Sodium',156,'mmol/L',{}],['Glucose',2.5,'mmol/L',{}],['Haemoglobin',65,'g/L',{}],['Platelets',15,'10^9/L',{}],['Calcium',3.1,'mmol/L',{}],['INR',5.2,'',{}],['Troponin',45,'ng/L',{high:14}],['Triglycerides',11,'mmol/L',{}]]as const){
  assert.equal(sameDayFloor([],withLabs(lab(m,v,u,o))),true,`${m} ${v}`);assert.match(healthDataBlock(withLabs(lab(m,v,u,o))),/needs a doctor today/u,m);}
 for(const [m,v,u] of [['Sodium',138,'mmol/L'],['Haemoglobin',65,'g/dL'],['HbA1c',8,'%'],['Haemoglobin A1c',6,'%'],['Calcium',2.4,'mmol/L']]as const)assert.equal(sameDayFloor([],withLabs(lab(m,v,u))),false,`${m} ${v} ${u}`);
 assert.equal(sameDayFloor([],withLabs(lab('Sodium',120,'mmol/L',{daysAgo:15}))),false,'An old result');assert.equal(sameDayFloor([],withLabs(lab('Sodium',120,'mmol/L',{reviewed:true}))),false,'A reviewed one is the model\'s: it sees the number');
 const critical=await run(free('Hello, how are you?',{health:withLabs(lab('Sodium',120,'mmol/L'))}),'same_day');
 assert.equal(health(critical).urgency,'same_day');assert.equal(health(critical).forward,'auto','Sent to the doctor before review');assert.ok(!(critical.finish!.answer??critical.finish!.receipt!.text).includes('120'),'No number for the member');
}
// A stored lab floor fires once per result; the member's own words fire every time (Fable, #516).
{
 const lab=(marker:string,value:number,unit:string,o:Partial<HealthData['labs'][number]>={})=>({marker,value,unit,low:null,high:null,daysAgo:2,reviewed:false,arrivedMinutesAgo:600,...o});
 const stored=(l:HealthData['labs'][number])=>({bpWeek:null,labs:[l],plan:null}as HealthData);
 const text=(r:PipelineRun)=>r.finish!.answer??r.finish!.receipt!.text;
 const say=(x:string)=>x.includes(SAME_DAY_LINE.en);
 const conv=(n:number)=>({enabled:true,doctorName:null,answeredThroughSeq:n,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'as const});
 const turns=async(data:HealthData,words:string[],urgency:string,replies:ZoeJob['replies']=[])=>{const out:PipelineRun[]=[],answers:{body:string;minutesAgo:number}[]=[];
  for(let i=0;i<words.length;i++){const j=free(words.slice(0,i+1),{health:data,answers:answers.map((a,k)=>({...a,minutesAgo:(i-k)*10})),replies,conversation:conv(i)});const r=await run(j,urgency);out.push(r);answers.push({body:text(r),minutesAgo:0});}return out;};
 for(const l of [lab('Sodium',120,'mmol/L'),lab('Potassium',6.4,'mmol/L',{reviewed:true}),lab('Troponin',45,'ng/L',{high:14,reviewed:true}),lab('Triglycerides',11,'mmol/L',{reviewed:true}),lab('Sodium',120,'mmol/L',{daysAgo:0,arrivedMinutesAgo:300})]){
  const three=await turns(stored(l),['Hello, how are you?','What can I cook tonight?','Thanks, and a walk?'],'none');
  assert.equal(three.filter(r=>say(text(r))).length,1,`${l.marker}: one same-day line in three ordinary turns`);
  assert.equal(health(three[0]!).urgency,'same_day',l.marker);assert.equal(health(three[1]!).forward,'none',`${l.marker}: an ordinary answer, nothing sent`);
  assert.ok(!healthDataBlock(spendLabFloors(stored(l),[{body:SAME_DAY_LINE.en,minutesAgo:5}],[])).includes('needs a doctor today'),`${l.marker}: the model is not told again`);}
 const line=[{body:SAME_DAY_LINE.en,minutesAgo:5}],sodium=stored(lab('Sodium',120,'mmol/L'));
 assert.equal(sameDayFloor([],spendLabFloors(sodium,[],[])),true,'Nothing said yet');assert.equal(sameDayFloor([],spendLabFloors(sodium,line,[{minutesAgo:2}])),true,'The doctor replied since');
 assert.equal(sameDayFloor([],spendLabFloors(sodium,[{body:SAME_DAY_LINE.en,minutesAgo:601}],[])),true,'A line from before the result arrived');assert.equal(sameDayFloor([],spendLabFloors(sodium,[{body:SAME_DAY_LINE.en,minutesAgo:600}],[])),true,'The same minute is not after it');
 assert.equal(sameDayFloor([],spendLabFloors(stored(lab('Sodium',120,'mmol/L',{arrivedMinutesAgo:undefined})),line,[])),true,'No arrival time: the floor fires');
 assert.equal(sameDayFloor([],spendLabFloors(sodium,[{body:'Ordinary words.',minutesAgo:5}],[])),true,'Only the same-day line counts');
 // Through the pipeline: a same-day line for a reading before the lab arrived, one after it, and a different value that arrives later.
 const bpLine=[{body:`${SAME_DAY_LINE.en}\n185/115 mmHg.`,minutesAgo:900}],later=[{body:`${SAME_DAY_LINE.en}\n\nPlain words.`,minutesAgo:30}];
 const hello=(data:HealthData,answers:ZoeJob['answers'])=>run(free(['An earlier word.','Hello, how are you?'],{health:data,answers,conversation:conv(1)}),'none');
 const before=await hello(sodium,bpLine);assert.equal(health(before).urgency,'same_day','A line before the lab arrived does not spend it');assert.equal(health(before).forward,'auto');assert.ok(say(text(before)));
 const after=await hello(sodium,later);assert.equal(health(after).forward,'none','A line after it arrived does');assert.ok(!say(text(after)));
 const second={bpWeek:null,labs:[lab('Sodium',118,'mmol/L',{arrivedMinutesAgo:5}),lab('Sodium',120,'mmol/L')],plan:null}as HealthData;
 const fresh=await hello(second,later);assert.equal(health(fresh).urgency,'same_day','A different value that arrives later alerts again');assert.equal(health(fresh).forward,'auto');assert.ok(say(text(fresh)));
 const own=await turns(sodium,['My potassium is 6.4 today.','My potassium is 6.4 today.','My potassium is 6.4 today.'],'same_day');
 assert.equal(own.filter(r=>health(r).urgency==='same_day').length,3,'A floor in the member\'s own unanswered text fires every time');
}
// The database's cap and the parser's stay equal: one more row in the SQL would lose every run's data.
{
 const labs=(n:number)=>Array.from({length:n},()=>({marker:'x',value:1,unit:'u',low:null,high:null,daysAgo:0}));
 assert.equal(healthDataSchema.safeParse({bpWeek:null,labs:labs(16),plan:null}).success,true);assert.equal(healthDataSchema.safeParse({bpWeek:null,labs:labs(17),plan:null}).success,false);
 assert.match(readFileSync('supabase/migrations/20261102181143_zoe_health_context_lab_arrival.sql','utf8'),/cr\.id limit 16\)x/u);
}
// Armen's answers 11 and 12: multiples of the lab's own upper limit, once per result, and nothing with no upper limit on the row.
{
 const enzyme=(marker:string,value:number,high:number|null,o:Partial<HealthData['labs'][number]>={})=>({marker,value,unit:'U/L',low:null,high,daysAgo:1,reviewed:false,arrivedMinutesAgo:600,...o});
 const data=(l:HealthData['labs'][number])=>({bpWeek:null,labs:[l],plan:null}as HealthData);
 const text=(r:PipelineRun)=>r.finish!.answer??r.finish!.receipt!.text;
 const level=(l:HealthData['labs'][number],words:string[]=[])=>{const h=spendLabFloors(data(l),[],[],words);return sameDayFloor([],h)?'same_day':soonFloor(h)?'doctor_soon':'none';};
 for(const [v,want] of [[120,'none'],[120.5,'doctor_soon'],[200,'doctor_soon'],[200.5,'same_day']]as const)assert.equal(level(enzyme('ALT',v,40)),want,`ALT ${v}`);
 for(const m of ['ALT','ALAT','ALT (SGPT)','Alanine aminotransferase','АЛТ','Аланинаминотрансфераза','ԱԼՏ','Ալանինամինոտրանսֆերազ'])assert.equal(level(enzyme(m,150,40)),'doctor_soon',m);
 const sore=['My muscles ache a lot.'];
 for(const [v,words,want] of [[1000,sore,'none'],[1000.5,sore,'same_day'],[1000.5,[],'none'],[2000,[],'none'],[2000.5,[],'same_day'],[1000.5,['No muscle pain at all.'],'none']]as const)assert.equal(level(enzyme('CK',v,200),[...words]),want,`CK ${v} ${words.join()}`);
 for(const m of ['CK','CPK','Creatine kinase','Creatine phosphokinase','КК','КФК','Креатинкиназа','Կրեատինկինազ'])assert.equal(level(enzyme(m,2500,200)),'same_day',m);
 for(const m of ['CK-MB','КФК-МВ','ALP','Salt'])assert.equal(level(enzyme(m,99999,40)),'none',m);
 for(const [m,v] of [['ALT',9999],['CK',99999]]as const)assert.equal(level(enzyme(m,v,null),sore),'none',`${m}: no upper limit, no floor`);
 assert.equal(level(enzyme('ALT',500,40,{reviewed:true})),'none','Reviewed: the model reads the number');assert.equal(level(enzyme('ALT',500,40,{daysAgo:15})),'none','Old');
 assert.equal(sameDayFloor([],spendLabFloors(data(enzyme('ALT',500,40)),[],[],[])),true);
 const prompt=healthReplyPrompt('coach-first',true);assert.ok(prompt.includes('ALT over 5 times the lab\'s upper limit'));assert.ok(prompt.includes('- doctor_soon (the coming days')&&/doctor_soon \(the coming days[^\n]*ALT over 3 times/u.test(prompt),'The coming-days list');
 // Coming days, through the pipeline: the note and its line once, without the number; a same-day line is kept for the same-day result.
 const alt=data(enzyme('ALT',150,40));
 assert.match(healthDataBlock(spendLabFloors(alt,[],[])),/in the coming days/u);assert.ok(!healthDataBlock(alt).includes('150'));
 const first=await runPipeline(free('Hello, how are you?',{health:alt}),{directAnswers:true,env,provider:says('doctor_soon').provider});
 assert.equal(health(first).urgency,'doctor_soon');assert.equal(health(first).forward,'auto');assert.equal(health(first).forwardReason,'critical_lab');assert.ok(text(first).includes(line),'The member is told');assert.ok(!text(first).includes('150'));
 const short=await run(free('Hello, how are you?',{health:alt}),'planned');assert.equal(health(short).urgency,'doctor_soon','The model cannot go below it');assert.equal(health(short).forward,'auto');
 const conv=(n:number)=>({enabled:true,doctorName:null,answeredThroughSeq:n,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'as const});
 const again=await run(free(['Hello, how are you?','What can I cook tonight?'],{health:alt,answers:[{body:text(first),minutesAgo:5}],conversation:conv(1)}),'planned');assert.equal(health(again).forward,'none','Once per result');assert.equal(health(again).urgency,'planned');
 assert.equal(soonFloor(spendLabFloors(alt,[{body:`Words.\n\n${line}`,minutesAgo:700}],[])),true,'A note before it arrived does not spend it');
 assert.equal(sameDayFloor([],spendLabFloors(data(enzyme('ALT',500,40)),[{body:`Words.\n\n${line}`,minutesAgo:5}],[])),true,'A coming-days note never spends a same-day result');
 // CK with muscle symptoms: same day, with the statin sentence once, in each language; over 10 times without them: same day, no sentence.
 for(const [lang,words] of [['en','My muscles really hurt.'],['ru','Сильно болят мышцы.'],['hy','Մկաններս շատ են ցավում։']]as const){
  const ck=data(enzyme('CK',1500,200));const c={...conv(0),locale:lang==='ru'?null:lang};
  const r=await runPipeline(free(words,{health:ck,conversation:c}),{directAnswers:true,env,provider:says('same_day',{language:lang}).provider});
  assert.equal(health(r).urgency,'same_day',lang);assert.equal(health(r).forward,'auto',lang);assert.ok(text(r).includes(STATIN_PAUSE_LINE[lang]),`${lang}: ${text(r)}`);assert.ok(!text(r).includes('1500'),lang);}
 const big=await run(free('Hello, how are you?',{health:data(enzyme('CK',2500,200))}),'same_day');assert.equal(health(big).urgency,'same_day');assert.ok(!text(big).includes(STATIN_PAUSE_LINE.en),'No symptoms, no sentence');
 const calm=await run(free(['Hello, how are you?','What can I cook tonight?'],{health:data(enzyme('CK',2500,200)),answers:[{body:text(big),minutesAgo:5}],conversation:conv(1)}),'planned');assert.equal(health(calm).forward,'none','Same-day once per result too');
 for(const t of ['not feeling well','վատ եմ զգում']){const r=await run(free([t],{health:data(enzyme('ALT',150,40))}),'planned');assert.equal(r.finish!.health?.urgency,'doctor_soon',`A vague complaint keeps the lab floor: ${t} ${r.reason}`);assert.equal(r.finish!.health?.forward,'auto',t);}
}
console.log('zoe tasks 3, 11, 12: ok');
