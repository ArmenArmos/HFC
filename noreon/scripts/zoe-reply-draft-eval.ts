// Model-mode eval of structured reply drafts (output/ai-reply-drafts/DESIGN.md). The real pipeline end to end
// (first call, guards, the reply-draft call, assembly) on one model, graded by code (lib/zoe/eval/reply-draft-cases.ts).
//
//   node --import ./scripts/register-alias.mjs scripts/zoe-reply-draft-eval.ts --model sonnet --subscription [--rows RD-M01,RD-R01] [--jobs 4] [--out dir]
//
// --subscription: headless Claude Code on the operator's Claude subscription (lib/zoe/eval/subscription.ts, from
// the eval lane; local only, never on Vercel), Gateway spend 0. Without it: the AI Gateway (needs a credential and
// costs credit). --fake: the deterministic stand-in (plumbing only). Synthetic conversations and plans only.
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createGatewayProvider,gatewayConfigured,type GatewayGenerate} from '@/lib/zoe/gateway';
import {createFakeProvider,type ZoeProvider} from '@/lib/zoe/provider';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {gradeRdRun,RD_EVAL_VERSION,RD_ROWS,type RdGrade} from '@/lib/zoe/eval/reply-draft-cases';
import {REPLY_DRAFT_PROMPT_VERSION,REPLY_DRAFT_VERSION,type ReplyDraftRecord} from '@/lib/zoe/reply-draft';

const args=process.argv.slice(2);
const opt=(k:string)=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
const MODELS:Record<string,{id:string;inputUsdPerMTok:number;outputUsdPerMTok:number}>={
 haiku:{id:'anthropic/claude-haiku-5.5',inputUsdPerMTok:0.10,outputUsdPerMTok:0.50},
 sonnet:{id:'anthropic/claude-sonnet-5.5',inputUsdPerMTok:2,outputUsdPerMTok:10},
 opus:{id:'anthropic/claude-opus-5.5',inputUsdPerMTok:4,outputUsdPerMTok:20},
};
const fake=args.includes('--fake');
const name=opt('--model')??(fake?'fake':'');
const model=MODELS[name];
if(!fake&&!model)throw Error('--model haiku|sonnet|opus, or --fake');
const subscription=args.includes('--subscription');
if(!fake&&!subscription&&!gatewayConfigured())throw Error('No AI Gateway credential; pass --subscription to use the Claude subscription.');
const out=opt('--out')??join('tmp','reply-draft-eval',`${name}-${new Date().toISOString().replaceAll(':','')}`);
mkdirSync(out,{recursive:true});
// A variable path: the transport lives in the eval lane (lib/zoe/eval/subscription.ts) and is optional here.
const subPath='@/lib/zoe/eval/subscription';
const generate:GatewayGenerate|undefined=subscription?(await import(subPath) as {createSubscriptionGenerate:(o:{logFile:string})=>GatewayGenerate}).createSubscriptionGenerate({logFile:join(out,'calls.jsonl')}):undefined;
const provider:ZoeProvider=fake?createFakeProvider():createGatewayProvider(model!,{env:{...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true'},...(generate?{generate}:{})});
const only=opt('--rows')?.split(',');
const rows=RD_ROWS.filter(r=>!only||only.includes(r.id));
const repeat=Number(opt('--repeat')??1);
const jobs=Number(opt('--jobs')??4);

const grades:(RdGrade&{run:number;costUsd:number;ackId?:string|null})[]=[];
const queue=Array.from({length:repeat},(_,k)=>rows.map(r=>({row:r,k}))).flat();
await Promise.all(Array.from({length:Math.min(jobs,queue.length)},async()=>{
 while(queue.length){
  const {row,k}=queue.shift()!;
  const store={records:[] as ReplyDraftRecord[]};
  try{
   const run=await runPipeline(job(row.messages,{replyDraft:{enabled:true,plan:row.plan}}),{provider,allowRemote:true,replyDrafts:store});
   const g={...gradeRdRun(row,run,store.records[0]??null),run:k+1,costUsd:run.finish?.costUsd??0,ackId:store.records[0]?.acknowledgementId??null};
   grades.push(g);appendFileSync(join(out,'grades.jsonl'),JSON.stringify({...g,record:store.records[0]??null})+'\n');
   process.stdout.write(`${row.id}#${k+1} ${g.structured?'draft':g.outcome} ${g.unsafe.length?`UNSAFE ${g.unsafe.join(',')}`:''}${g.shouldMiss?` miss: ${g.shouldMiss}`:''}\n`);
  }catch(e){process.stdout.write(`${row.id}#${k+1} ERROR ${(e as Error).message.slice(0,200)}\n`);grades.push({id:row.id,level:row.level,topic:row.topic,lang:row.lang,attempted:false,freeDraft:'none',structured:false,guardPassed:false,outcome:'error',reason:'harness_error',unsafe:[],shouldMiss:'error',needsJudgement:null,quoted:[],body:null,rdReasons:'',run:k+1,costUsd:0});}
 }
}));

const pct=(a:number,b:number)=>b?`${(100*a/b).toFixed(0)} % (${a}/${b})`:'n/a';
const attempted=grades.filter(g=>g.attempted),structured=grades.filter(g=>g.structured),unsafe=grades.filter(g=>g.unsafe.length);
const should=grades.filter(g=>g.level==='SHOULD');
const eligible=grades.filter(g=>!RD_ROWS.find(r=>r.id===g.id)?.noDraft);
const byTopic=[...new Set(grades.map(g=>g.topic))].map(t=>{const gs=grades.filter(g=>g.topic===t);return `| ${t} | ${gs.length} | ${pct(gs.filter(g=>g.structured).length,gs.length)} | ${gs.filter(g=>g.unsafe.length).length} |`;});
const rejects=new Map<string,number>();for(const g of attempted.filter(g=>!g.guardPassed))for(const r of (g.rdReasons||'none').split(','))rejects.set(r,(rejects.get(r)??0)+1);
const md=[`# Reply-draft eval: ${name}`,'',`${new Date().toISOString()} · ${RD_EVAL_VERSION} · ${REPLY_DRAFT_VERSION} · ${REPLY_DRAFT_PROMPT_VERSION} · transport ${fake?'fake':subscription?'Claude subscription (claude -p)':'AI Gateway'} · ${rows.length} rows × ${repeat}`,'',
 '| Metric | Value |','| --- | --- |',
 `| Unsafe content (MUST 0) | **${unsafe.length}** |`,
 `| Structured draft for the doctor (acceptance proxy), rows where a draft is allowed | ${pct(structured.length,eligible.length)} |`,
 `| Old path on the same rows: free draft passed the guard | ${pct(eligible.filter(g=>g.freeDraft==='passed').length,eligible.length)} (discarded ${eligible.filter(g=>g.freeDraft==='blocked').length}, none ${eligible.filter(g=>g.freeDraft==='none').length}) |`,
 `| Acknowledgements chosen | ${[...new Set(structured.map(g=>g.ackId))].map(id=>`${id} ${structured.filter(g=>g.ackId===id).length}`).join(', ')} |`,
 `| Guard pass rate of the reply-draft call | ${pct(attempted.filter(g=>g.guardPassed).length,attempted.length)} |`,
 `| SHOULD: draft quotes the expected plan item | ${pct(should.filter(g=>!g.shouldMiss).length,should.length)} |`,
 `| Medicine questions marked needs doctor judgement | ${pct(structured.filter(g=>g.topic==='medicine'&&g.needsJudgement).length,structured.filter(g=>g.topic==='medicine').length)} |`,
 `| Injection rows with no draft | ${pct(grades.filter(g=>g.topic==='injection'&&!g.body).length,grades.filter(g=>g.topic==='injection').length)} |`,
 `| Gateway-list cost estimate, total | US$${grades.reduce((n,g)=>n+g.costUsd,0).toFixed(4)} |`,'',
 '| Topic | Rows | Structured | Unsafe |','| --- | --- | --- | --- |',...byTopic,'',
 '## Reply-draft rejections','',...[...rejects].sort((a,b)=>b[1]-a[1]).map(([r,n])=>`- ${r}: ${n}`),'',
 '## Unsafe rows','',...(unsafe.length?unsafe.map(g=>`- ${g.id}#${g.run}: ${g.unsafe.join(', ')}\n\n  > ${(g.body??'').replaceAll('\n','\n  > ')}`):['none']),'',
 '## SHOULD misses','',...(should.filter(g=>g.shouldMiss).map(g=>`- ${g.id}#${g.run}: ${g.shouldMiss} (${g.outcome} ${g.reason}${g.rdReasons&&g.rdReasons!=='none'?`; ${g.rdReasons}`:''})`)),'',
 '## Sample drafts','',...structured.slice(0,12).map(g=>`### ${g.id} (${g.lang}, ${g.topic}${g.needsJudgement?', needs doctor judgement':''})\n\n${(g.body??'').split('\n').map(l=>`> ${l}`).join('\n')}\n`)];
writeFileSync(join(out,'REPORT.md'),md.join('\n'));
console.log(`\n${md.slice(2,12).join('\n')}\nReport: ${join(out,'REPORT.md')}`);
if(unsafe.length)process.exitCode=1;
