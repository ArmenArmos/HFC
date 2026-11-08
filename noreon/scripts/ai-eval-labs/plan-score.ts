import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {summaryRejections} from '@/lib/ai-plan/compose';
import {LAB_ANALYTES} from '@/lib/lab-ai/catalogue';

/**
 * Summarises a plan-eval.ts run: how often the production guard shows the summary, why it rejects,
 * and the Opus judge's grades (faithfulness, coverage, unreviewed values, language, clinical risk).
 *
 *   node scripts/ai-eval-labs/plan-score.ts --runs <dir> --label baseline
 */
const args=process.argv.slice(2);
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const runs=opt('--runs')??'../output/ai-eval-labs-2026-10-19/plan-runs',label=opt('--label')??'baseline';
type Judge={faithful:number;unsupported:string[];coversKeyFindings:number;coversGaps:number;namesJudgementItems:number;unreviewedHandledRight:boolean;languageOk:boolean;clinicalRisk:'none'|'minor'|'major';note:string};
type Run={id:string;name:string;model:string;language:string;summary:string|null;guard:string[];shown:boolean;rejections:{words:string[];numbers:number[]}|null;judge:Judge|{error:string}|null;
 call:{ok:boolean;inputTokens:number;outputTokens:number;latencyMs:number;retries:number};gatewayUsd:number|null};
const dir=join(runs,label);
const all:Run[]=readdirSync(dir).filter(m=>!m.startsWith('_')&&!m.includes('.')).flatMap(m=>readdirSync(join(dir,m)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(dir,m,f),'utf8')) as Run));
// Re-check word rejections with the current guard. The run's facts are not saved, so the units are the catalogue's canonical
// units (the only units the plan facts carry); the number check needs the facts and is kept as recorded.
const unitFacts={units:[...new Set(LAB_ANALYTES.map(a=>a.canonical))].map(unit=>({unit}))};
for(const r of all)if(!r.shown&&r.summary&&r.guard.length===1&&r.guard[0]==='summary:word'&&!summaryRejections(r.summary,unitFacts).words.length){r.shown=true;r.guard=['(passes current guard)'];}
const models=[...new Set(all.map(r=>r.model))].sort();
const pct=(a:number,b:number)=>b?`${(100*a/b).toFixed(0)}%`:'–';
const avg=(xs:number[])=>xs.length?(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(2):'–';
const isJ=(j:Run['judge']):j is Judge=>!!j&&!('error'in j);
const lines=[`# AI care plan summary eval: ${label}`,'',`${all.length} summaries over ${new Set(all.map(r=>r.id)).size} synthetic members. "Shown" = passes the production guard (guardProse). Judge: Opus 5.5 with the same facts (0-2 scales).`,'',
 '| Model | Runs | Call ok | Shown (guard pass) | Rejected: word | Rejected: number | Faithful (0-2) | Key findings | Gaps | Judgement items | Unreviewed handled | Language ok | Clinical risk minor/major | Gateway $/summary | Latency |',
 '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for(const m of models){
 const r=all.filter(x=>x.model===m),j=r.map(x=>x.judge).filter(isJ);
 lines.push(`| ${m} | ${r.length} | ${pct(r.filter(x=>x.call.ok).length,r.length)} | ${pct(r.filter(x=>x.shown).length,r.length)} | ${r.filter(x=>x.guard.includes('summary:word')).length} | ${r.filter(x=>x.guard.includes('summary:number')).length} | ${avg(j.map(x=>x.faithful))} | ${avg(j.map(x=>x.coversKeyFindings))} | ${avg(j.map(x=>x.coversGaps))} | ${avg(j.map(x=>x.namesJudgementItems))} | ${pct(j.filter(x=>x.unreviewedHandledRight).length,j.length)} | ${pct(j.filter(x=>x.languageOk).length,j.length)} | ${j.filter(x=>x.clinicalRisk==='minor').length}/${j.filter(x=>x.clinicalRisk==='major').length} | $${avg(r.map(x=>x.gatewayUsd??0)).replace(/^(\d\.\d\d)$/,'$1')} | ${(r.reduce((a,x)=>a+x.call.latencyMs,0)/Math.max(r.length,1)/1000).toFixed(1)} s |`);
}
lines.push('','## Guard rejections (word or number that tripped it)','');
for(const r of all.filter(x=>!x.shown&&x.rejections))lines.push(`- ${r.model} ${r.id}: words ${JSON.stringify(r.rejections!.words)} numbers ${JSON.stringify(r.rejections!.numbers)}`);
lines.push('','## Judge: major or minor clinical risk, and unsupported statements','');
for(const r of all.filter(x=>isJ(x.judge)&&((x.judge as Judge).clinicalRisk!=='none'||(x.judge as Judge).unsupported.length)))
 {const j=r.judge as Judge;lines.push(`- ${r.model} ${r.id} (${r.name}) risk=${j.clinicalRisk}, faithful=${j.faithful}${r.shown?'':' [not shown]'}: ${j.note.replace(/\n/g,' ')} ${j.unsupported.length?`Unsupported: ${j.unsupported.join(' | ')}`:''}`);}
lines.push('','## Sample summaries (first run per member, Opus and Haiku)','');
for(const id of [...new Set(all.map(r=>r.id))].sort().slice(0,6))for(const m of models.filter(x=>/opus|haiku/.test(x))){
 const r=all.find(x=>x.id===id&&x.model===m);if(r?.summary)lines.push(`- **${id} ${m}** (${r.shown?'shown':'rejected'}): ${r.summary}`);}
writeFileSync(join(dir,'_scores.md'),lines.join('\n')+'\n');
console.log(lines.slice(0,6+models.length).join('\n'));
