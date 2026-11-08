/**
 * Zoe free-mode speed bench (output/zoe-speed): real Gateway latency of the free-mode path, per speed configuration.
 * Quality is measured separately (scripts/zoe-golive-eval.ts on the subscription transport); this measures time only.
 *
 * Each configuration plays the FIRST member message of the chosen Armen scenarios through the real pipeline
 * (runMemberTurns, in-memory ports) with every model on the Gateway under one spend cap, and records each call's wall
 * time. Synthetic scenarios only. Never on Vercel.
 *
 *   AI_GATEWAY_API_KEY=... NOREON_ZOE_MODEL_CALLS_ENABLED=true node --conditions=noreon-server-test --import ./scripts/register-alias.mjs \
 *     scripts/zoe-speed-bench.ts <out.json> [--cap 3] [--only S001,S005] [--configs before,split,opus-low,...]
 */
import {writeFileSync} from 'node:fs';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {evalRouting,loadDataset,newSpend,runMemberTurns,type TurnCall} from '@/lib/zoe/eval/armen-dataset';
import {FREE_SPEED_BEFORE,type FreeSpeed} from '@/lib/zoe/free-mode-speed';
import type {RouteConfig,RouteModel} from '@/lib/zoe/pipeline';

const args=process.argv.slice(2);
const opt=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const out=args[0];
if(!out||out.startsWith('--'))throw Error('usage: zoe-speed-bench.ts <out.json> [--cap 3] [--only ...] [--configs ...]');
if(process.env.NOREON_ZOE_MODEL_CALLS_ENABLED!=='true')throw Error('Set NOREON_ZOE_MODEL_CALLS_ENABLED=true: this makes real Gateway calls.');
if(process.env.VERCEL==='1'||process.env.VERCEL_ENV)throw Error('Never on Vercel.');
const capUsd=Number(opt('--cap')??'3');if(!(capUsd>0&&capUsd<=5))throw Error('--cap must be above 0 and at most 5 (US$)');

const m=(id:string,i:number,o:number):RouteModel=>({id,inputUsdPerMTok:i,outputUsdPerMTok:o});
const OPUS=m('anthropic/claude-opus-5.5',4,20),SONNET=m('anthropic/claude-sonnet-5.5',2,10),HAIKU=m('anthropic/claude-haiku-5.5',0.1,0.5);
/** The high tier's model replaced; the other tiers as configured by default. */
const withHigh=(model:RouteModel):RouteConfig=>({tiers:{...DEFAULT_ROUTE_CONFIG.tiers,high:{...DEFAULT_ROUTE_CONFIG.tiers.high!,model}}});
const fast:Partial<FreeSpeed>={split:true,judgeTier:'low',judgeEffort:'none',summaryTier:'low',summaryEffort:'none'};
const CONFIGS:Record<string,{speed:FreeSpeed;config:RouteConfig;caching?:boolean}>={
 'before-nocache':{speed:FREE_SPEED_BEFORE,config:DEFAULT_ROUTE_CONFIG,caching:false},
 before:{speed:FREE_SPEED_BEFORE,config:DEFAULT_ROUTE_CONFIG},
 split:{speed:{...FREE_SPEED_BEFORE,split:true},config:DEFAULT_ROUTE_CONFIG},
 'opus-low':{speed:{...FREE_SPEED_BEFORE,split:true,replyEffort:'low',judgeEffort:'low',summaryTier:'low',summaryEffort:'none'},config:DEFAULT_ROUTE_CONFIG},
 'opus-low-haiku-judge':{speed:{...FREE_SPEED_BEFORE,...fast,replyEffort:'low'},config:DEFAULT_ROUTE_CONFIG},
 'opus-fast-low':{speed:{...FREE_SPEED_BEFORE,split:true,fast:true,replyEffort:'low',judgeEffort:'low',summaryTier:'low',summaryEffort:'none'},config:DEFAULT_ROUTE_CONFIG},
 'opus-fast-default':{speed:{...FREE_SPEED_BEFORE,split:true,fast:true,summaryTier:'low',summaryEffort:'none'},config:DEFAULT_ROUTE_CONFIG},
 'opus-fast-low-judgedefault':{speed:{...FREE_SPEED_BEFORE,split:true,fast:true,replyEffort:'low',summaryTier:'low',summaryEffort:'none'},config:DEFAULT_ROUTE_CONFIG},
 'sonnet-low':{speed:{...FREE_SPEED_BEFORE,...fast,replyEffort:'low'},config:withHigh(SONNET)},
 'haiku-none':{speed:{...FREE_SPEED_BEFORE,...fast,replyEffort:'none',judgeTier:'medium',judgeEffort:'low'},config:withHigh(HAIKU)},
};
void OPUS;
// Opus fast runs through the fast setting (gateway.ts FAST_MODELS), as production would.
const names=(opt('--configs')?.split(',')??Object.keys(CONFIGS));
for(const n of names)if(!CONFIGS[n])throw Error(`unknown config ${n}; known: ${Object.keys(CONFIGS).join(', ')}`);
const dataset=loadDataset();
// Varied first messages: planned, same-day numbers, doctor-soon, labs, medicine, lifestyle, oncology, endocrine.
const only=opt('--only')?.split(',')??['S001','S005','S013','S030','S047','S052','S072','S088'];
const scenarios=only.map(k=>{const s=dataset.scenarios.find(x=>`S${x.id}`===k);if(!s)throw Error(`no scenario ${k}`);return s;});
const spend=newSpend(capUsd);
const results:Record<string,{id:string;reason:string;criticalMs:number;calls:TurnCall[]}[]>={};
for(const name of names){
 const c=CONFIGS[name]!;
 const env={...process.env,NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_TEST_LEXICON:undefined,NOREON_ZOE_GATEWAY_CACHING:c.caching===false?'off':'on'};
 const routing=evalRouting(c.config,{transport:'gateway',spend,env});
 results[name]=[];
 // One at a time, so calls do not compete: the numbers are latency, not throughput.
 for(const s of scenarios){
  const first=s.turns.find(t=>t.role==='user')!.text;
  const r=await runMemberTurns(`S${s.id}`,s.urgency,[first],{routing,env,freeSpeed:c.speed,healthAnswers:true});
  const t=r.turns[0]!;
  results[name].push({id:r.id,reason:t.reason,criticalMs:t.timing?.criticalMs??0,calls:t.timing?.calls??[]});
  console.log(`${name} ${r.id} ${t.reason} ${((t.timing?.criticalMs??0)/1000).toFixed(1)} s [${(t.timing?.calls??[]).map(x=>`${x.kind} ${(x.ms/1000).toFixed(1)}`).join(', ')}] spent US$${spend.spentUsd.toFixed(3)} refused ${spend.refused}`);
  writeFileSync(out,JSON.stringify({capUsd,spentUsd:spend.spentUsd,refused:spend.refused,results},null,1));
 }
}
const q=(xs:number[],p:number)=>{const a=[...xs].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(p*a.length))]!:NaN;};
for(const [name,rs] of Object.entries(results)){
 const model=rs.filter(r=>r.calls.some(c=>c.kind==='reply'));const crit=model.map(r=>r.criticalMs);
 const k=(kind:string)=>model.flatMap(r=>r.calls.filter(c=>c.kind===kind).map(c=>c.ms));
 console.log(`${name}: n ${model.length}, member-path p50 ${(q(crit,.5)/1000).toFixed(1)} s p90 ${(q(crit,.9)/1000).toFixed(1)} s; reply p50 ${(q(k('reply'),.5)/1000).toFixed(1)}; judge p50 ${(q(k('judge'),.5)/1000).toFixed(1)}; summary p50 ${(q(k('summary'),.5)/1000).toFixed(1)}`);
}
console.log(`Gateway spend US$${spend.spentUsd.toFixed(3)} of US$${capUsd} (refused ${spend.refused}).`);
