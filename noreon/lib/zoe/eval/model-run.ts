import {runEvalSet,type EvalSummary} from './run';
import {modelTranscript} from './model-cases';
import {createFakeProvider} from '../provider';
import {createGatewayProvider,type GatewayGenerate} from '../gateway';
import {TIERS,type Tier} from '../routing';
import type {RouteConfig} from '../pipeline';
import {createLabGatewayProvider} from '@/lib/lab-ai/provider';
import {runLabFixtures,type LabEvalResult} from '@/lib/lab-ai/eval-fixtures';

type Env=Record<string,string|undefined>;
export type TierModelEval={tier:Tier;model:string;fallback:string|null;summary:EvalSummary;lab:LabEvalResult[]|null;transcript:typeof modelTranscript;costUsd:number;
 /** The numbers recorded in zoe_eval_runs (stand-in rows, model rows and, for the high tier, the lab fixtures). */
 record:{total:number;mustFailures:number;failures:number;failedIds:string[];harnessVersion:string}};

/**
 * Model-mode eval for each tier's primary model (staging AI mode). The stand-in rows run with the
 * fake; the model rows (and, for the tier that reads lab PDFs, the lab fixtures) run against the real
 * Gateway model. The caller must already have decided real calls are allowed: env must carry
 * NOREON_ZOE_MODEL_CALLS_ENABLED=true, or the adapter refuses and every model row fails.
 * Cost is small and bounded (about 40 short calls per tier plus 5 lab sheets).
 */
export async function runModelEval(input:{config:RouteConfig;tiers?:readonly Tier[];env?:Env;labTier?:Tier|null;readSql?:(file:string)=>string|null;
 /** Eval transport other than the Gateway (the subscription eval provider, eval/subscription.ts). Lab fixtures then do not run. */generate?:GatewayGenerate;
 /** Every model row against each tier's model (with the judge rows), not only the rows production routes to that tier. */allRows?:boolean}):Promise<TierModelEval[]>{
 const env=input.env??process.env,out:TierModelEval[]=[];
 for(const tier of input.tiers??TIERS){
  const cfg=input.config.tiers[tier];if(!cfg)continue;
  const modelProvider=createGatewayProvider(cfg.model,{env,...(input.generate?{generate:input.generate}:{})});
  // The medium tier's model is the reply judge (reply-check.ts): its eval also runs the judge rows.
  const summary=await runEvalSet({routeConfig:input.config,providerFor:()=>createFakeProvider(),modelProvider,...(input.allRows?{}:{tier}),judgeRows:input.allRows||tier==='medium',...(input.readSql?{readSql:input.readSql}:{})});
  const transcript=[...modelTranscript];
  let lab:LabEvalResult[]|null=null,labCost=0;
  if(input.labTier===tier&&!input.generate){const r=await runLabFixtures(createLabGatewayProvider(cfg.model,{env}));lab=r.results;labCost=r.costUsd;}
  const labFailed=(lab??[]).filter(r=>!r.ok);
  const failedIds=[...summary.failedIds,...labFailed.map(r=>r.id)].slice(0,40);
  out.push({tier,model:cfg.model.id,fallback:cfg.fallback?.id??null,summary,lab,transcript,costUsd:transcript.reduce((n,t)=>n+t.costUsd,0)+labCost,
   record:{total:summary.total+(lab?.length??0),mustFailures:summary.mustFailures+labFailed.filter(r=>r.level==='MUST').length,failures:summary.failures+labFailed.length,failedIds,
    harnessVersion:`${summary.harnessVersion}${lab?`+lab-${lab.length}`:''}`.slice(0,240)}});
 }
 return out;
}
