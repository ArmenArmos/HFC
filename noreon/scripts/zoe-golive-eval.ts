import {freeSpeed,type FreeSpeed} from '@/lib/zoe/free-mode-speed';
import {freeStyle,type FreeStyle} from '@/lib/zoe/free-mode-style';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {gatewayConfigured} from '@/lib/zoe/gateway';
import {evalRouting,loadDataset,runMemberTurns,type ScenarioRun} from '@/lib/zoe/eval/armen-dataset';
import {ALL_SUITES,caseBlock,coachMarkdown,coachRubric,gateMarkdown,gateVerdict,goCases,goRubric,goScoreSchema,gradeRun,openSpend,scoreKeyProblems,SUITES,type GoCase,type Suite} from '@/lib/zoe/eval/golive-suites';

/**
 * Zoe go-live gate (Zoe spec v1 section 15: reference x5, robustness, out-of-scope; section 13 as MUSTs). Synthetic only.
 *
 *   NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/zoe-golive-eval.ts run <out-dir> [--suites reference,robustness,oos] [--repeat 5] [--transport subscription|gateway]
 *     [--cap 3] [--only S006,R006-carer,O08] [--parallel 6] [--health-answers] [--config <route-config.json>] [--resume]
 *     [--chat-cards]   (zoe_chat_actions_enabled on: the logging rule in the prompt and the plain logging route)
 *     [--suites ...,coach] [--coach-repeat 3]   (the coach suite, COACH_SPEC 8.1/8.7; NOREON_ZOE_FREE_STYLE=base runs the style before C1)
 *   ... scripts/zoe-golive-eval.ts batches <out-dir>     (rewrite the grading files from runs.json)
 *   ... scripts/zoe-golive-eval.ts merge <out-dir>       (graded.json and GATE.md)
 *
 * --repeat applies to the reference suite (spec: at least 5); robustness and out-of-scope cases run once each (each
 * restatement is its own case). Grade <out>/grading/batch-NN.md with one Claude Code subagent each: "Read batch-NN.md,
 * grade every conversation exactly as the rubric says, write the JSON array to the scores file it names."
 * Gateway spend: the in-script cap (default and maximum US$3 per full run) is checked before every Gateway call against
 * the worst case of that call plus the calls in flight, and kept across --resume by the ledger (lib/zoe/eval/armen-dataset.ts).
 * The subscription transport sends Anthropic models through claude -p (no Gateway spend) and only other providers' models to the Gateway.
 */
const args=process.argv.slice(2);
const [cmd,outArg]=args;
const opt=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
if(!cmd||!outArg||!['run','batches','merge'].includes(cmd))throw Error('usage: zoe-golive-eval.ts run|batches|merge <out-dir> [options]');
const out=resolve(outArg);
const dataset=loadDataset();
const head=(()=>{try{return execSync('git rev-parse --short HEAD',{encoding:'utf8'}).trim();}catch{return 'unknown';}})();
type Saved={head:string;transport:string;capUsd:number;gatewaySpentUsd:number;gatewayCalls:number;refusedByCap:number;subscriptionCalls:number;suites:Suite[];repeats:Record<string,number>;

 healthAnswers:boolean;speed?:FreeSpeed;style?:FreeStyle;runs:(ScenarioRun&{caseKey:string;run:number})[]};
const runsFile=join(out,'runs.json');
const readSaved=()=>JSON.parse(readFileSync(runsFile,'utf8')) as Saved;
const casesOf=(suites:readonly Suite[])=>goCases(dataset,suites);

/** Grading batches: whole cases (all their runs together), about 20 conversations per batch. */
function writeBatches(saved:Saved){
 mkdirSync(join(out,'grading'),{recursive:true});
 const cases=casesOf(saved.suites).filter(c=>saved.runs.some(r=>r.caseKey===c.key));
 const batches:GoCase[][]=[];let cur:GoCase[]=[],n=0;
 for(const c of cases){
  const k=saved.runs.filter(r=>r.caseKey===c.key).length;
  if(cur.length&&(n+k>20||cur[0]!.suite!==c.suite)){batches.push(cur);cur=[];n=0;}
  cur.push(c);n+=k;
 }
 if(cur.length)batches.push(cur);
 batches.forEach((b,i)=>{const nn=String(i+1).padStart(2,'0');
  const keys=b.flatMap(c=>saved.runs.filter(r=>r.caseKey===c.key).map(r=>r.id));
  writeFileSync(join(out,'grading',`batch-${nn}.md`),[`Scores file: ${join(out,'grading',`scores-${nn}.json`)} (${keys.length} conversations: ${keys.join(', ')})`,'',goRubric(),'',...(b[0]!.suite==='coach'?[coachRubric(),'']:[]),
   ...b.map(c=>caseBlock(c,saved.runs.filter(r=>r.caseKey===c.key)))].join('\n'));});
 console.log(`${batches.length} grading batches in ${join(out,'grading')}`);
}

if(cmd==='run'){
 if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true for this run: it makes real model calls.');
 if(process.env.VERCEL==='1'||process.env.VERCEL_ENV)throw Error('Never on Vercel.');
 const transport=z.enum(['gateway','subscription']).parse(opt('--transport')??'subscription');
 const capUsd=Number(opt('--cap')??'3');if(!(capUsd>=0&&capUsd<=3))throw Error('--cap must be between 0 and 3 (US$)');
 const parallel=Math.max(1,Math.min(8,Number(opt('--parallel')??'6')));
 const suites=(opt('--suites')??SUITES.join(',')).split(',').map(s=>z.enum(ALL_SUITES as [Suite,...Suite[]]).parse(s));
 const repeat=Math.max(1,Math.min(10,Number(opt('--repeat')??'5')));
 const only=opt('--only')?.split(',');
 const config=opt('--config')?parseRouteConfig(JSON.parse(readFileSync(opt('--config')!,'utf8'))):DEFAULT_ROUTE_CONFIG;
 if(transport==='gateway'&&!gatewayConfigured())console.warn('No AI_GATEWAY_API_KEY/VERCEL_OIDC_TOKEN in the environment: relying on the Vercel CLI login.');
 const resume=args.includes('--resume');
 mkdirSync(out,{recursive:true});
 const prior=resume&&existsSync(runsFile)?readSaved():null;
 const {spend,resumedUsd}=openSpend(out,{capUsd,resume,legacy:prior});
 if(resumedUsd!==null)console.log(`Resumed ledger: US$${resumedUsd.toFixed(4)} already counted; US$${Math.max(0,capUsd-resumedUsd).toFixed(4)} left.`);
 const env={...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:undefined};
 let subCalls=prior?.subscriptionCalls??0;
 let sub:import('@/lib/zoe/gateway').GatewayGenerate|null=null;
 const subscription=transport==='subscription'?(async(a:Parameters<import('@/lib/zoe/gateway').GatewayGenerate>[0])=>{
  sub??=(await import('@/lib/zoe/eval/subscription')).createSubscriptionGenerate({logFile:join(out,'subscription-calls.jsonl')});subCalls++;return sub(a);}):undefined;
 const routing=evalRouting(config,{transport,spend,env,...(subscription?{subscription}:{})});
 // Free-mode speed settings: the environment's NOREON_ZOE_* overrides on the shipped default (free-mode-speed.ts).
 const speed=freeSpeed(env);
 console.log(`free-mode speed: ${JSON.stringify(speed)}`);
 // The answer style (free-mode-style.ts): the environment's NOREON_ZOE_FREE_STYLE, else the coach style.
 const style=freeStyle(env);
 console.log(`free-mode style: ${style}`);
 const repeats={reference:repeat,robustness:1,oos:1,coach:Math.max(1,Math.min(10,Number(opt('--coach-repeat')??'3')))};
 const jobs=casesOf(suites).filter(c=>!only||only.includes(c.key)).flatMap(c=>Array.from({length:repeats[c.suite]},(_,i)=>({c,run:i+1})));
 const runs=new Map((prior?.runs??[]).map(r=>[r.id,r]));
 const todo=jobs.filter(j=>!runs.has(`${j.c.key}#${j.run}`));
 console.log(`${todo.length} runs (${suites.join(', ')}; reference x${repeat}), transport ${transport}, Gateway cap US$${capUsd}, parallel ${parallel}, head ${head}`);
 const save=()=>writeFileSync(runsFile,JSON.stringify({head,transport,capUsd,gatewaySpentUsd:spend.spentUsd,gatewayCalls:spend.calls,refusedByCap:spend.refused,subscriptionCalls:subCalls,
  suites:[...new Set([...(prior?.suites??[]),...suites])],repeats,healthAnswers:args.includes('--health-answers'),speed,style,runs:[...runs.values()]} satisfies Saved,null,1));
 let next=0,done=0;
 const worker=async()=>{while(next<todo.length){const {c,run}=todo[next++]!;
  const r=await runMemberTurns(`${c.key}#${run}`,c.urgency,c.memberTurns,{routing,env,...(args.includes('--chat-cards')?{memberRecord:{chatCards:true,ageYears:null,doses:null,ldl:null}}:{}),freeSpeed:speed,freeStyle:style,healthAnswers:args.includes('--health-answers'),...(c.health!==undefined?{health:c.health}:{})});
  runs.set(r.id,{...r,caseKey:c.key,run});done++;save();
  console.log(`${r.id} ${c.urgency} ${r.turns.map(t=>t.reason).join(' > ')} | Gateway $${spend.spentUsd.toFixed(4)} (${done}/${todo.length}, refused ${spend.refused})`);}};
 await Promise.all(Array.from({length:parallel},worker));
 save();writeBatches(readSaved());
 console.log(`done: Gateway US$${spend.spentUsd.toFixed(4)} in ${spend.calls} calls (refused by cap ${spend.refused}), subscription calls ${subCalls}.`);
 if(spend.refused)console.log('WARNING: the cap refused calls; those turns ran as if the provider were unavailable.');
}

if(cmd==='batches')writeBatches(readSaved());

if(cmd==='merge'){
 const saved=readSaved();
 const cases=new Map(casesOf(saved.suites).map(c=>[c.key,c]));
 const scores=readdirSync(join(out,'grading')).filter(f=>/^scores-\d+\.json$/.test(f)).flatMap(f=>{
  const raw=readFileSync(join(out,'grading',f),'utf8');const j=JSON.parse(raw.slice(raw.indexOf('['),raw.lastIndexOf(']')+1)) as unknown[];
  return j.map((x,i)=>{const p=goScoreSchema.safeParse(x);if(!p.success)throw Error(`${f}[${i}]: ${p.error.message.slice(0,300)}`);return p.data;});});
 // One score per saved run, no duplicates, no unknown keys (Astra GE-02): a later score must never overwrite a failure.
 const {duplicates:dup,unknown}=scoreKeyProblems(saved.runs.map(r=>r.id),scores.map(s=>s.key));
 if(dup.length||unknown.length){
  console.error(`Score files rejected: duplicate keys ${dup.join(',')||'none'}; unknown keys ${unknown.join(',')||'none'}. Regrade those batches.`);
  process.exit(2);
 }
 const byKey=new Map(scores.map(s=>[s.key,s]));
 const missing=saved.runs.filter(r=>!byKey.has(r.id)).map(r=>r.id);
 if(missing.length)console.warn(`No score for ${missing.length} runs: ${missing.slice(0,20).join(',')}`);
 const graded=saved.runs.filter(r=>byKey.has(r.id)).map(r=>gradeRun(cases.get(r.caseKey)!,r,byKey.get(r.id)!));
 writeFileSync(join(out,'graded.json'),JSON.stringify(graded,null,1));
 writeFileSync(join(out,'GATE.md'),gateMarkdown(graded,{label:outArg,head:saved.head,transport:saved.transport,spentUsd:saved.gatewaySpentUsd,subscriptionCalls:saved.subscriptionCalls,repeats:saved.repeats})
  +coachMarkdown(graded)+(missing.length?`\nUngraded runs (${missing.length}): ${missing.join(', ')}\n`:'')+timingMarkdown(saved));
 const v=gateVerdict(graded);
 console.log(`gate 1 ${v.gate1.pass?'PASS':'FAIL'}, gate 2 ${v.gate2.pass?'PASS':'FAIL'}, gate 3 ${v.gate3.pass?'PASS':'FAIL'}. ${join(out,'GATE.md')}`);
 process.exitCode=v.gate1.pass&&v.gate2.pass&&v.gate3.pass&&!missing.length?0:1;
}

/** Reply time per model turn (criticalMs: the model's own time on the member's path) and the careful-line rate. */
function timingMarkdown(saved:Saved){
 const turns=saved.runs.flatMap(r=>r.turns);
 const model=turns.filter(t=>t.timing&&t.timing.calls.some(c=>c.kind==='reply'));
 const q=(xs:number[],p:number)=>{const a=[...xs].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(p*a.length))]!:NaN;};
 const s=(ms:number)=>Number.isFinite(ms)?`${(ms/1000).toFixed(1)} s`:'n/a';
 const crit=model.map(t=>t.timing!.criticalMs);
 const words=turns.filter(t=>t.reason==='health_answer_passed_guards'&&t.visible).map(t=>t.visible!.split(/\s+/u).filter(Boolean).length);
 const kind=(k:string)=>model.flatMap(t=>t.timing!.calls.filter(c=>c.kind===k).map(c=>c.ms));
 const careful=turns.filter(t=>/^health_answer_(?:blocked|schema|provider)/.test(t.reason)).length;
 const health=turns.filter(t=>/^health_answer_/.test(t.reason)).length;
 return ['','## Speed (output/zoe-speed)','',`Settings: ${JSON.stringify(saved.speed??null)}. Style: ${saved.style??'base (before C1)'}.`,'',
  `Model turns ${model.length}. Member-path model time p50 ${s(q(crit,.5))}, p90 ${s(q(crit,.9))} (production adds about 0.4 s of database calls and 0 to 2 s of polling).`,
  `Reply call p50 ${s(q(kind('reply'),.5))} p90 ${s(q(kind('reply'),.9))}; judge p50 ${s(q(kind('judge'),.5))} p90 ${s(q(kind('judge'),.9))}; summary p50 ${s(q(kind('summary'),.5))} p90 ${s(q(kind('summary'),.9))}; topic check ${kind('topic').length} calls, p50 ${s(q(kind('topic'),.5))}.`,
  // Same denominator as the reference run's 13.4% (every turn, output/zoe-health-answers/STATUS.md).
  // Reply length (Khikar 20 Oct: answers too long): words in the answers Zoe wrote and sent, the app's fixed lines included.
  `Answer length (sent model answers, ${words.length}): median ${q(words,.5)} words, p90 ${q(words,.9)}, over 80 words ${words.length?(100*words.filter(w=>w>80).length/words.length).toFixed(0):'n/a'}%.`,
  `Careful line ${careful}/${turns.length} turns (${turns.length?(100*careful/turns.length).toFixed(1):'n/a'}%; ${health?(100*careful/health).toFixed(1):'n/a'}% of the ${health} free-mode turns).`,''].join('\n');
}
