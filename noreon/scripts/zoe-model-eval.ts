import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {runModelEval} from '@/lib/zoe/eval/model-run';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {gatewayConfigured} from '@/lib/zoe/gateway';
import {TIERS,type Tier} from '@/lib/zoe/routing';

/**
 * Model-mode Zoe eval against REAL Gateway models (staging AI mode). Not a CI check: it spends money
 * (cents) and needs a Gateway credential. Run it locally with the Development AI_GATEWAY_API_KEY
 * loaded into the environment (never print it):
 *
 *   NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/zoe-model-eval.ts [--tiers low,medium,high] [--db] [--record <admin user id>] [--out <dir>]
 *
 * --db reads the tier models from the database (service role); otherwise the seeded defaults.
 * --record writes one zoe_eval_runs row per tier (mode model) through zoe_eval_run_record, which the
 * zoe_settings guard requires before model_calls_allowed can be switched on.
 *
 * --subscription [--log <file.jsonl>]: run the model rows through headless Claude Code on the operator's
 * Claude subscription instead of the Gateway (lib/zoe/eval/subscription.ts; local eval only, no Gateway
 * credential needed, lab fixtures skipped). Never combine with --record: those rows gate production.
 * --all-rows: every model row (and the judge rows) against each tier's model, for model comparison; not recordable.
 */
const args=process.argv.slice(2);
const opt=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true for this run: it makes real model calls.');
const subscription=args.includes('--subscription');
if((subscription||args.includes('--all-rows'))&&args.includes('--record'))throw Error('--subscription runs are not recorded: zoe_eval_runs gates production on the Gateway path.');
if(!subscription&&!gatewayConfigured())throw Error('No AI Gateway credential (AI_GATEWAY_API_KEY or OIDC) in the environment.');
const tiers=(opt('--tiers')??TIERS.join(',')).split(',').map(t=>z.enum(TIERS).parse(t)) as Tier[];
const out=opt('--out')??'output/zoe-model-eval';
const admin=opt('--record');

type Rpc=(name:string,a:Record<string,unknown>)=>Promise<unknown>;
let rpc:Rpc|null=null;
if(args.includes('--db')||admin){
 const {zoeServiceRpc}=await import('@/lib/zoe/server');
 rpc=zoeServiceRpc();if(!rpc)throw Error('--db/--record need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}
const config=args.includes('--db')&&rpc?parseRouteConfig(await rpc('zoe_route_config',{})):DEFAULT_ROUTE_CONFIG;
const readSql=(f:string)=>{try{return readFileSync(f,'utf8');}catch{return null;}};

const started=Date.now();
const generate=subscription?(await import('@/lib/zoe/eval/subscription')).createSubscriptionGenerate(opt('--log')?{logFile:opt('--log')!}:{}):undefined;
const results=await runModelEval({config,tiers,labTier:tiers.includes('high')?'high':null,readSql,...(generate?{generate}:{}),allRows:args.includes('--all-rows')});
mkdirSync(out,{recursive:true});
const md:string[]=[`# Zoe model-mode eval, ${new Date().toISOString()}`,'',`Synthetic conversations and fictional lab sheets only. Transport: ${subscription?'Claude subscription (claude -p), costs are Gateway-list estimates':'Vercel AI Gateway'}. Duration ${Math.round((Date.now()-started)/1000)} s.`,''];
for(const r of results){
 const model=r.summary.results.filter(x=>x.id.startsWith('M-'));
 md.push(`## ${r.tier}: ${r.model}`,'',`Recorded totals: ${r.record.total} rows, MUST failures ${r.record.mustFailures}, failures ${r.record.failures}. Model rows ${model.length} (pass ${model.filter(x=>x.status==='pass').length}). Cost about US$${r.costUsd.toFixed(4)}.`,'');
 for(const x of r.summary.results.filter(x=>x.status==='fail'))md.push(`- FAIL ${x.id} [${x.level}] ${x.title}: ${x.note}`);
 for(const l of r.lab??[])md.push(`- LAB ${l.ok?'PASS':'FAIL'} ${l.id} ${l.title}: ${l.note}`);
 md.push('','| Conversation | Kind | Outcome | Tier | Sent to member (direct answer) | Doctor draft | Guard reasons |','|---|---|---|---|---|---|---|');
 for(const t of r.transcript)md.push(`| ${t.id} | ${t.kind} | ${t.outcome} (${t.reason}) | ${t.tier} | ${(t.answer??(t.proposed?`NOT SENT: ${t.proposed}`:'')).replaceAll('|','/').replaceAll('\n',' ')} | ${(t.draft??'').replaceAll('|','/').replaceAll('\n',' ').slice(0,300)} | ${t.guardReasons.join(', ')} |`);
 md.push('');
 if(admin&&rpc){
  const rec=await rpc('zoe_eval_run_record',{p_admin:admin,p_tier:r.tier,p_model:r.model,p_fallback:r.fallback,p_mode:'model',p_harness_version:r.record.harnessVersion,
   p_total:r.record.total,p_must_failures:r.record.mustFailures,p_failures:r.record.failures,p_failed_ids:r.record.failedIds});
  md.push(`Recorded: ${JSON.stringify(rec)}`,'');
 }
 console.log(`${r.tier} ${r.model}: ${r.record.total} rows, MUST failures ${r.record.mustFailures}, failures ${r.record.failures}, ~US$${r.costUsd.toFixed(4)}`);
}
writeFileSync(join(out,'REPORT.md'),md.join('\n'));
writeFileSync(join(out,'results.json'),JSON.stringify(results.map(r=>({tier:r.tier,model:r.model,record:r.record,lab:r.lab,transcript:r.transcript,fails:r.summary.results.filter(x=>x.status==='fail')})),null,1));
console.log(`Report: ${join(out,'REPORT.md')}`);
process.exitCode=results.some(r=>r.record.mustFailures>0)?1:0;
