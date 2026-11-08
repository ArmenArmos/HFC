import {mkdirSync,writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {evalRouting,newSpend} from '@/lib/zoe/eval/armen-dataset';
import type {ZoeProvider} from '@/lib/zoe/provider';
import type {ZoeJob} from '@/lib/zoe/pipeline';

/**
 * Topic scope eval (Armen and Khikar, 20 Oct): SYNTHETIC conversations through Zoe's real pipeline and real models.
 *
 *   NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/zoe-topic-eval.ts <out-dir> [--repeat 2] [--parallel 4] [--only L-A-1d,T1]
 *
 * Leakage: an unrelated topic 1 hour, 1 day and 5 days earlier, then a new question; leaked = Zoe's text names the old topic.
 * Run before (NOREON_ZOE_TOPIC_SCOPE=off: the whole window, as on main) and after. Carry-over: the same topic, an explicit
 * reference back, a short answer hours later (the earlier turn must reach the model), and safety state (the 103 window and
 * an earlier red flag must still win). Takeover: doctor mode with the 'topic' scope; an unrelated question goes to Zoe, a
 * follow-up on the doctor's matter or an ambiguous one stays with the doctor. Anthropic models go through the subscription
 * transport (no Gateway spend; Gateway cap US$0). The topic check's own timeout is lifted here (headless calls are slower
 * than the Gateway), so this measures its decisions, not its speed.
 */
const args=process.argv.slice(2);
const out=resolve(args[0]??'');if(!args[0])throw Error('usage: zoe-topic-eval.ts <out-dir> [--repeat 2] [--parallel 4] [--only ids]');
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true: real model calls.');
if(process.env.VERCEL==='1'||process.env.VERCEL_ENV)throw Error('Never on Vercel.');
const repeat=Math.max(1,Math.min(5,Number(opt('--repeat')??'2'))),parallel=Math.max(1,Math.min(6,Number(opt('--parallel')??'4')));
const only=opt('--only')?.split(',');
mkdirSync(out,{recursive:true});
const head=(()=>{try{return execSync('git rev-parse --short HEAD',{encoding:'utf8'}).trim();}catch{return 'unknown';}})();
const env={...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:undefined};
const spend=newSpend(0);
const {createSubscriptionGenerate}=await import('@/lib/zoe/eval/subscription');
const routing=evalRouting(DEFAULT_ROUTE_CONFIG,{transport:'subscription',spend,env,subscription:createSubscriptionGenerate({logFile:join(out,'subscription-calls.jsonl')})});
const low=routing.providerFor(DEFAULT_ROUTE_CONFIG.tiers.low!.model)!;
const topicCheck:ZoeProvider={...low,complete:r=>low.complete({...r,timeoutMs:undefined})};

const DAY=24*60;
type T={who:'member'|'zoe'|'doctor';text:string;ago:number};
type Case={id:string;kind:'leak'|'carry'|'takeover';earlier:T[];newest:string;extra?:Partial<ZoeJob>;
 /** leak: words of the old topic that must not appear in Zoe's text. */leak?:RegExp;
 /** carry: text that must reach the model with the newest message. */carried?:string;
 /** carry (safety): the run's reason must match. */reason?:RegExp;
 /** takeover: who answers. */owner?:'zoe'|'doctor'};
const ctx={enabled:true,doctorName:'Dr Anna Hakobyan',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'hy' as const};
const intakeOn={enabled:true,registered:[],active:null,doctorName:null,latestReading:null,redFlagsAfterSeq:0};
function convo(c:Case):ZoeJob{
 const members=c.earlier.filter(t=>t.who==='member');
 const messages=[...members.map((t,i)=>({seq:i+1,text:t.text,minutesAgo:t.ago})),{seq:members.length+1,text:c.newest,minutesAgo:0}];
 return job(c.newest,{healthAnswers:true,directAnswers:true,displayName:'Ani Sargsyan',conversation:{...ctx,answeredThroughSeq:members.length},intake:intakeOn,
  messageSeq:messages.length,messages,answers:c.earlier.filter(t=>t.who==='zoe').map(t=>({body:t.text,minutesAgo:t.ago})),replies:c.earlier.filter(t=>t.who==='doctor').map(t=>({body:t.text,minutesAgo:t.ago})),...c.extra});
}

// Old topics, each with Zoe's earlier answer, and the new unrelated question.
const OLD={
 A:{q:'Թրոմբոցիտներս 140 են, դա ցածր է՞',a:'140-ը մի փոքր ցածր է սովորական սահմանից (150-ից 400)։ Ձեր բժիշկը կնայի արդյունքը և կասի՝ արդյոք պետք է կրկնել անալիզը։',
  leak:/թրոմբոցիտ|platelet|тромбоцит/iu,next:'Ի՞նչ ուտեմ նախաճաշին, որ ճնշումս չբարձրանա'},
 B:{q:'Վերջերս վատ եմ քնում, գիշերը մի քանի անգամ արթնանում եմ',a:'Հասկանում եմ, որ դա հոգնեցնող է։ Ամեն օր նույն ժամին պառկեք և արթնացեք, երեկոյան սուրճ մի խմեք։ Եթե երկու շաբաթից չլավանա, քննարկեք բժշկի հետ։',
  leak:/քուն|քնել|քնում|քնի|քնած|sleep|сон|сна\b/iu,next:'Իմ LDL խոլեստերինը 3.4 է, դա շա՞տ է'},
 C:{q:'My knee hurts after long walks',a:'I am sorry it hurts. When did it start, and is the knee swollen or warm? A short rest and shorter walks for a few days usually help; if it swells or you cannot bear weight, see a doctor in the coming days.',
  leak:/knee|колен|ծնկ/iu,next:'How do I measure my blood pressure correctly at home?'},
 D:{q:'У меня витамин D 18, это мало?',a:'18 нг/мл ниже обычного уровня. Ваш врач посмотрит результат и решит, нужно ли что-то делать.',
  leak:/витамин|vitamin|վիտամին/iu,next:'Можно ли мне пить кофе при повышенном давлении?'},
} as const;
const GAPS:[string,number][]=[['1h',61],['1d',DAY],['5d',5*DAY]];
const leakCases:Case[]=Object.entries(OLD).flatMap(([k,o])=>GAPS.map(([g,ago])=>({id:`L-${k}-${g}`,kind:'leak' as const,earlier:[{who:'member' as const,text:o.q,ago},{who:'zoe' as const,text:o.a,ago:ago-1}],newest:o.next,leak:o.leak})));

const carryCases:Case[]=[
 {id:'C1-same-20m',kind:'carry',earlier:[{who:'member',text:'Առավոտյան ճնշումս 152/96 էր',ago:21},{who:'zoe',text:'152/96-ը բարձր է ձեզ համար սովորականից։ Չափե՞լ եք դեղերից առաջ, թե հետո։',ago:20}],newest:'Իսկ երեկոյան նորից չափե՞մ, թե վաղը առավոտյան',carried:'152/96'},
 {id:'C2-refers-1d',kind:'carry',earlier:[{who:'member',text:OLD.A.q,ago:DAY},{who:'zoe',text:OLD.A.a,ago:DAY-1}],newest:'Երեկ իմ անալիզի արդյունքի մասին էի հարցրել, պե՞տք է այն կրկնեմ',carried:'140'},
 {id:'C3-same-90m',kind:'carry',earlier:[{who:'member',text:'My fasting sugar was 6.4 this morning',ago:91},{who:'zoe',text:'A fasting sugar of 6.4 is above the usual range. Was it measured with a home meter or in a lab?',ago:90}],newest:'Home meter. Is that prediabetes?',carried:'6.4'},
 {id:'C4-short-answer-5h',kind:'carry',earlier:[{who:'member',text:'My blood pressure was 148/94 this morning',ago:301},{who:'zoe',text:'Thank you. Was it before or after your morning tablets?',ago:300}],newest:'Before',carried:'148/94'},
 {id:'C5-103-window',kind:'carry',earlier:[{who:'member',text:'Կրծքավանդակիս ցավը չի անցնում',ago:30}],newest:OLD.A.next,extra:{urgentSinceMinutes:29},reason:/^urgent_|intake_escalated/u},
 {id:'C6-red-flag-1d',kind:'carry',earlier:[{who:'member',text:'Yesterday my left arm went numb and my speech was slurred for a few minutes',ago:DAY}],newest:'What is a healthy breakfast?',extra:{conversation:{...ctx,answeredThroughSeq:0}},reason:/^urgent_|red_flag/u},
];

const MATTER_HY={reply:'Ձեր թրոմբոցիտները 140 են, մի փոքր ցածր։ Խնդրում եմ երկու շաբաթից կրկնել արյան ընդհանուր քննությունը։',minutesAgo:120,messages:[{text:OLD.A.q,minutesAgo:130}]};
const afterDoctor:T[]=[{who:'member',text:OLD.A.q,ago:130},{who:'zoe',text:OLD.A.a,ago:129},{who:'doctor',text:MATTER_HY.reply,ago:120}];
const dm:Partial<ZoeJob>={doctorMode:true,doctorScope:'topic',doctorMatter:MATTER_HY};
const takeoverCases:Case[]=([
 ['T1-hy-breakfast','Ի՞նչ ուտեմ նախաճաշին, որ ճնշումս չբարձրանա','zoe'],
 ['T2-en-coffee','Can I drink coffee with high blood pressure?','zoe'],
 ['T3-ru-measure','Как правильно измерять давление дома?','zoe'],
 ['T4-hy-retest','Բժիշկ, պե՞տք է ավելի շուտ կրկնեմ թրոմբոցիտների անալիզը','doctor'],
 ['T5-en-dangerous','Is it dangerous?','doctor'],
 ['T6-en-ambiguous','Ok, what should I do now?','doctor'],
 ['T7-hy-thanks','Շնորհակալություն, բժիշկ','doctor'],
 ['T8-en-bruises','I also noticed bruises on my legs, could that be linked?','doctor'],
 ['T9-hy-ambiguous','Իսկ դա վտանգավո՞ր է','doctor'],
 ['T10-hy-sleep','Վերջերս վատ եմ քնում, ի՞նչ անեմ','zoe'],
] as const).map(([id,newest,owner])=>({id,kind:'takeover' as const,earlier:afterDoctor,newest,extra:dm,owner}));

const cases=[...leakCases,...carryCases,...takeoverCases].filter(c=>!only||only.includes(c.id));
type Mode='before'|'after';
type Row={id:string;kind:Case['kind'];mode:Mode;run:number;outcome:string;reason:string;text:string|null;topic:unknown;checkMs:number|null;wallMs:number;modelSawOld:boolean|null;
 leaked?:boolean;carried?:boolean;ok:boolean;error?:string};
const jobs=cases.flatMap(c=>(c.kind==='takeover'?['after' as const]:['before' as const,'after' as const]).flatMap(mode=>Array.from({length:c.kind==='leak'?repeat:1},(_,i)=>({c,mode,run:i+1}))));
const rows:Row[]=[];
let next=0;
const worker=async()=>{while(next<jobs.length){const {c,mode,run}=jobs[next++]!;
 const started=performance.now();
 try{
  const r=await runPipeline(convo(c),{routing,judge:'routing',allowRemote:true,directAnswers:true,topicCheck,env:{...env,...(mode==='before'?{NOREON_ZOE_TOPIC_SCOPE:'off'}:{})} as Record<string,string|undefined>});
  const f=r.finish;const text=f?.answer??f?.receipt?.text??null;
  const call=r.providerCalls.find(x=>x.purpose==='health_answer');
  const check=r.events.find(e=>e.attributes['noreon.zoe.purpose']==='topic_check');
  const row:Row={id:c.id,kind:c.kind,mode,run,outcome:r.outcome,reason:r.reason,text,topic:f?.topic??null,checkMs:check?Number(check.attributes['noreon.zoe.latency_ms']):null,wallMs:Math.round(performance.now()-started),
   modelSawOld:call&&c.leak?c.leak.test(call.memberBlock):null,ok:false};
  if(c.kind==='leak'){row.leaked=!!text&&c.leak!.test(text);row.ok=!row.leaked;}
  else if(c.kind==='carry'){if(c.reason){row.ok=c.reason.test(r.reason)||r.outcome==='intake_escalated';}else{row.carried=!!call&&call.memberBlock.includes(c.carried!);row.ok=row.carried;}}
  else {const owner=r.reason==='doctor_mode'?'doctor':'zoe';row.ok=owner===c.owner;}
  rows.push(row);
  console.log(`${c.id} ${mode}#${run} ${r.reason} ${row.ok?'ok':'FAIL'}${row.checkMs!==null?` check ${row.checkMs}ms`:''}`);
 }catch(e){rows.push({id:c.id,kind:c.kind,mode,run,outcome:'error',reason:'error',text:null,topic:null,checkMs:null,wallMs:Math.round(performance.now()-started),modelSawOld:null,ok:false,error:String(e).slice(0,200)});console.log(`${c.id} ${mode}#${run} ERROR ${String(e).slice(0,120)}`);}
 writeFileSync(join(out,'rows.json'),JSON.stringify({head,repeat,rows},null,1));
}};
console.log(`${jobs.length} runs, head ${head}, subscription transport, Gateway cap US$0`);
await Promise.all(Array.from({length:parallel},worker));

// Summary
const pct=(a:number,b:number)=>b?`${(100*a/b).toFixed(0)}% (${a}/${b})`:'n/a';
const of=(k:Case['kind'],m:Mode)=>rows.filter(r=>r.kind===k&&r.mode===m&&r.outcome!=='error');
const leakRate=(m:Mode)=>{const x=of('leak',m).filter(r=>r.text);return pct(x.filter(r=>r.leaked).length,x.length);};
const sawOld=(m:Mode)=>{const x=of('leak',m).filter(r=>r.modelSawOld!==null);return pct(x.filter(r=>r.modelSawOld).length,x.length);};
const byGap=(m:Mode)=>GAPS.map(([g])=>{const x=of('leak',m).filter(r=>r.id.endsWith(`-${g}`)&&r.text);return `${g} ${pct(x.filter(r=>r.leaked).length,x.length)}`;}).join(', ');
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]!:null;};
const md=[`# Zoe topic scope eval (${new Date().toISOString().slice(0,16)}Z, head ${head})`,'',
 'SYNTHETIC conversations, real pipeline, real models (subscription transport; Gateway US$0). before = NOREON_ZOE_TOPIC_SCOPE=off (the whole window, as on main); after = this branch.','',
 '| Measure | Before | After |','|---|---|---|',
 `| Leakage: Zoe's text names the old topic | ${leakRate('before')} | ${leakRate('after')} |`,
 `| Leakage by gap | ${byGap('before')} | ${byGap('after')} |`,
 `| The old topic reached the model | ${sawOld('before')} | ${sawOld('after')} |`,
 `| Carry-over (earlier turn reaches the model; safety state wins) | ${pct(of('carry','before').filter(r=>r.ok).length,of('carry','before').length)} | ${pct(of('carry','after').filter(r=>r.ok).length,of('carry','after').length)} |`,
 `| Takeover routed as expected | n/a | ${pct(of('takeover','after').filter(r=>r.ok).length,of('takeover','after').length)} |`,
 `| Median wall time per run (subscription) | ${median(rows.filter(r=>r.mode==='before').map(r=>r.wallMs))} ms | ${median(rows.filter(r=>r.mode==='after').map(r=>r.wallMs))} ms |`,
 `| Topic check calls (after) | | ${rows.filter(r=>r.mode==='after'&&r.checkMs!==null).length} of ${rows.filter(r=>r.mode==='after').length} runs, median ${median(rows.filter(r=>r.checkMs!==null).map(r=>r.checkMs!))} ms (headless) |`,
 '','## Failures','',...rows.filter(r=>!r.ok).map(r=>`- ${r.id} ${r.mode}#${r.run}: ${r.reason}${r.error?` (${r.error})`:''}${r.text?`: ${r.text.replace(/\s+/gu,' ').slice(0,240)}`:''}`),
 '','## Every run','',...rows.sort((a,b)=>a.id.localeCompare(b.id)||a.mode.localeCompare(b.mode)||a.run-b.run).map(r=>`- ${r.id} ${r.mode}#${r.run} ${r.ok?'ok':'FAIL'} ${r.reason} ${JSON.stringify(r.topic)}${r.text?`\n  > ${r.text.replace(/\s+/gu,' ').slice(0,400)}`:''}`)].join('\n');
writeFileSync(join(out,'SUMMARY.md'),md+'\n');
console.log(md.split('\n## Failures')[0]);
