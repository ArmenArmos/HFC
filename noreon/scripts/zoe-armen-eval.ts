import {appendFileSync,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {gatewayConfigured} from '@/lib/zoe/gateway';
import {evalRouting,loadDataset,mergeOne,newSpend,replayLedger,type LedgerEvent,rubric,runScenario,scenarioBlock,scoreSchema,summaryMarkdown,type ScenarioRun} from '@/lib/zoe/eval/armen-dataset';

/**
 * Armen's clinical dialogue dataset (100 scenarios) against Zoe's real pipeline. Synthetic conversations only.
 *
 *   NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/zoe-armen-eval.ts run <out-dir> [--transport gateway|subscription] [--cap 2] [--only 001,006] [--parallel 4]
 *     [--health-answers] [--config <route-config.json>]
 *   ... scripts/zoe-armen-eval.ts merge <out-dir>
 *
 * batches: rewrites the grading batches from runs.json (after a rubric change).
 * run: plays every scenario's member turns (lib/zoe/eval/armen-dataset.ts), writes <out>/runs.json and the grading
 * batches <out>/grading/batch-NN.md (10 scenarios each, rubric included). Grade them with Claude Code subagents on the
 * subscription, one per batch: "Read batch-NN.md, grade every scenario exactly as the rubric says, write the JSON array
 * to the scores file it names." Then merge: <out>/graded.json and <out>/SUMMARY.md (per-chapter pass rates, MUST failures).
 *
 * Spend: --transport gateway sends every model call to the AI Gateway; subscription sends Anthropic models through
 * headless Claude Code (no Gateway spend) and only the other providers' models (OpenAI fallbacks, a GPT judge) to the
 * Gateway. Either way the Gateway part is capped (--cap, default US$2): a call starts only if the spend so far plus the
 * calls in flight plus its own worst case (input estimate plus its whole output allowance at list price) fits, else it is
 * refused like an unavailable provider and counted. The Gateway SDK can authenticate through the Vercel CLI login with no
 * key in the environment, so the cap is enforced here, never left to the credential.
 * --health-answers adds job.healthAnswers=true (feat/zoe-health-answers; main's job schema rejects it).
 */
const args=process.argv.slice(2);
const [cmd,outArg]=args;
const opt=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
if(!cmd||!outArg||!['run','batches','merge'].includes(cmd))throw Error('usage: zoe-armen-eval.ts run|batches|merge <out-dir> [options]');
const out=resolve(outArg);
const dataset=loadDataset();
const head=(()=>{try{return execSync('git rev-parse --short HEAD',{encoding:'utf8'}).trim();}catch{return 'unknown';}})();

/** Grading batches: 10 scenarios each, the rubric at the top, the scores file named. */
function writeBatches(runs:Map<string,ScenarioRun>){
 mkdirSync(join(out,'grading'),{recursive:true});
 const ordered=dataset.scenarios.filter(s=>runs.has(s.id));
 for(let b=0;b*10<ordered.length;b++){
  const nn=String(b+1).padStart(2,'0'),part=ordered.slice(b*10,b*10+10);
  writeFileSync(join(out,'grading',`batch-${nn}.md`),[`Scores file: ${join(out,'grading',`scores-${nn}.json`)} (scenarios ${part.map(s=>s.id).join(', ')})`,'',rubric(dataset),'',...part.map(s=>scenarioBlock(s,runs.get(s.id)!))].join('\n'));
 }
}
// batches: rewrite the grading files from runs.json (after a rubric change), without rerunning Zoe.
if(cmd==='batches'){const saved=JSON.parse(readFileSync(join(out,'runs.json'),'utf8')) as {runs:ScenarioRun[]};writeBatches(new Map(saved.runs.map(r=>[r.id,r])));console.log('batches written');}

if(cmd==='run'){
 if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true for this run: it makes real model calls.');
 if(process.env.VERCEL==='1'||process.env.VERCEL_ENV)throw Error('Never on Vercel.');
 const transport=z.enum(['gateway','subscription']).parse(opt('--transport')??'gateway');
 const capUsd=Number(opt('--cap')??'2');if(!(capUsd>=0&&capUsd<=2))throw Error('--cap must be between 0 and 2 (US$)');
 const parallel=Math.max(1,Math.min(6,Number(opt('--parallel')??(transport==='subscription'?'4':'2'))));
 const only=opt('--only')?.split(',');
 const config=opt('--config')?parseRouteConfig(JSON.parse(readFileSync(opt('--config')!,'utf8'))):DEFAULT_ROUTE_CONFIG;
 if(transport==='gateway'&&!gatewayConfigured())console.warn('No AI_GATEWAY_API_KEY/VERCEL_OIDC_TOKEN in the environment: relying on the Vercel CLI login.');
 // Production's posture on prod-as-staging: the placeholder urgent list (no fictional test lexicon), real calls on.
 const env={...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:undefined};
 mkdirSync(join(out,'grading'),{recursive:true});
 // The Gateway ledger (Astra AE-04): every reservation and settlement, appended before and after each call. A resumed run
 // starts from its replay (an unsettled reservation counts at its worst case), so the cap covers all invocations together.
 const ledgerFile=join(out,'gateway-ledger.jsonl');
 const resume=args.includes('--resume');
 if(existsSync(ledgerFile)&&!resume)throw Error(`${out} already has a Gateway ledger: pass --resume to continue that run, or use a new directory.`);
 const runsFile=join(out,'runs.json');
 const priorRuns=existsSync(runsFile)&&resume?JSON.parse(readFileSync(runsFile,'utf8')) as {runs:ScenarioRun[];subscriptionCalls?:number;gatewaySpentUsd?:number;gatewayCalls?:number}:null;
 // A run saved before the ledger existed carries its Gateway totals only in runs.json: they are carried over and written
 // to a new ledger as one settled entry, so a resume never gets a fresh allowance (Astra AE-04, round 2).
 const legacy=!existsSync(ledgerFile)&&priorRuns&&((priorRuns.gatewayCalls??0)>0||(priorRuns.gatewaySpentUsd??0)>0)
  ?{spentUsd:priorRuns.gatewaySpentUsd??0,calls:priorRuns.gatewayCalls??0,refused:0}:undefined;
 if(legacy)for(const kind of ['reserve','settle'] as const)appendFileSync(ledgerFile,JSON.stringify({kind,id:'legacy-runs-json',model:'legacy',usd:legacy.spentUsd})+'\n');
 const prior=legacy??(resume&&existsSync(ledgerFile)?replayLedger(readFileSync(ledgerFile,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as LedgerEvent)):undefined);
 const spend=newSpend(capUsd,prior);
 spend.onLedger=e=>appendFileSync(ledgerFile,JSON.stringify(e)+'\n');
 if(prior)console.log(`Resumed ledger: US$${prior.spentUsd.toFixed(4)} already counted in ${prior.calls} calls; US$${Math.max(0,capUsd-prior.spentUsd).toFixed(4)} left.`);
 let subCalls=0;
 const subscription=transport==='subscription'?(()=>{let g:ReturnType<typeof import('@/lib/zoe/eval/subscription')['createSubscriptionGenerate']>|null=null;
  return (async a=>{g??=(await import('@/lib/zoe/eval/subscription')).createSubscriptionGenerate({logFile:join(out,'subscription-calls.jsonl')});subCalls++;return g(a);}) as Parameters<typeof evalRouting>[1]['subscription'];})():undefined;
 const routing=evalRouting(config,{transport,spend,env,...(subscription?{subscription}:{})});
 const scenarios=dataset.scenarios.filter(s=>!only||only.includes(s.id));
 const runs=new Map((priorRuns?.runs??[]).map(r=>[r.id,r]));
 subCalls=priorRuns?.subscriptionCalls??0;
 const todo=scenarios.filter(s=>!runs.has(s.id));
 console.log(`${todo.length} scenarios, transport ${transport}, Gateway cap US$${capUsd}, parallel ${parallel}, head ${head}`);
 const save=()=>writeFileSync(runsFile,JSON.stringify({head,transport,capUsd,gatewaySpentUsd:spend.spentUsd,gatewayCalls:spend.calls,refusedByCap:spend.refused,subscriptionCalls:subCalls,
  config,healthAnswers:args.includes('--health-answers'),runs:dataset.scenarios.map(s=>runs.get(s.id)).filter(Boolean)},null,1));
 let next=0,done=0;
 const worker=async()=>{
  while(next<todo.length){
   const s=todo[next++]!;
   const r=await runScenario(s,{routing,env,healthAnswers:args.includes('--health-answers')});
   runs.set(s.id,r);done++;save();
   console.log(`${s.id} ${s.urgency} ${r.turns.map(t=>t.reason).join(' > ')} | Gateway $${spend.spentUsd.toFixed(4)} (${done}/${todo.length}, refused ${spend.refused})`);
  }
 };
 await Promise.all(Array.from({length:parallel},worker));
 save();
 writeBatches(runs);
 console.log(`done: Gateway US$${spend.spentUsd.toFixed(4)} in ${spend.calls} calls (refused by cap ${spend.refused}), subscription calls ${subCalls}. Batches in ${join(out,'grading')}`);
 if(spend.refused)console.log('WARNING: the cap refused calls; those turns ran as if the provider were unavailable. Rerun with --transport subscription.');
}

if(cmd==='merge'){
 const saved=JSON.parse(readFileSync(join(out,'runs.json'),'utf8')) as {head:string;transport:string;gatewaySpentUsd:number;subscriptionCalls:number;refusedByCap:number;runs:ScenarioRun[]};
 const scores=readdirSync(join(out,'grading')).filter(f=>/^scores-\d+\.json$/.test(f)).flatMap(f=>{
  const raw=readFileSync(join(out,'grading',f),'utf8');const j=JSON.parse(raw.slice(raw.indexOf('['),raw.lastIndexOf(']')+1)) as unknown[];
  return j.map((x,i)=>{const p=scoreSchema.safeParse(x);if(!p.success)throw Error(`${f}[${i}]: ${p.error.message.slice(0,300)}`);return p.data;});});
 const byId=new Map(scores.map(s=>[s.id,s]));
 const missing=saved.runs.filter(r=>!byId.has(r.id)).map(r=>r.id);
 if(missing.length)console.warn(`No score for ${missing.join(',')}`);
 const graded=saved.runs.filter(r=>byId.has(r.id)).map(r=>mergeOne(dataset.scenarios.find(s=>s.id===r.id)!,r,byId.get(r.id)!));
 writeFileSync(join(out,'graded.json'),JSON.stringify(graded,null,1));
 writeFileSync(join(out,'SUMMARY.md'),summaryMarkdown(dataset,graded,{label:outArg,head:saved.head,transport:saved.transport,spentUsd:saved.gatewaySpentUsd,subscriptionCalls:saved.subscriptionCalls,
  ...(saved.refusedByCap?{note:`${saved.refusedByCap} Gateway calls refused by the cap.`}:{})}));
 const pass=graded.filter(g=>g.pass).length;
 console.log(`${graded.length} graded, pass ${pass}, MUST-failing ${graded.length-pass}. ${join(out,'SUMMARY.md')}`);
}
