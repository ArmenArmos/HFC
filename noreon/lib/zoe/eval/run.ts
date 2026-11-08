import {EVAL_CASES,checkNormalisation} from './cases';
import {routingCases} from './routing-cases';
import {CONVERSATION_CASES} from './conversation-cases';
import {modelCases} from './model-cases';
import {intakeModelCases,intakePlumbingCases} from './intake-cases';
import {chatModelCases,chatPlumbingCases} from './chat-cases';
import {adversarialModelCases,adversarialPlumbingCases} from './adversarial-cases';
import {unshacklePlumbingCases} from './unshackle-cases';
import {judgeModelCases,judgePlumbingCases} from './judge-cases';
import {healthJudgeModelCases} from './health-judge-cases';
import {budgetPlumbingCases} from './budget-cases';
import {setEvalProvider,type EvalCase} from './harness';
import {ZOE_CONFIG_VERSION,type RouteConfig,type RouteModel} from '../pipeline';
import type {ZoeProvider} from '../provider';
import type {Tier} from '../routing';

/**
 * Runs EVAL_SET v6 (262 rows) plus the routing and conversation rows, all with the deterministic
 * stand-in. With a modelProvider (model mode: staging AI, a real Gateway model) the model rows run
 * too, against that model; the stand-in rows never call it. Shared by scripts/check-zoe-eval.ts (CI) and the
 * admin AI settings page, which runs it for a candidate tier configuration before the change can
 * take effect. MUST failures block. SQL-asserted rows have their label checked only when the SQL
 * file is readable (CI); the SQL itself runs in CI.
 */
export const EVAL_MIN_ROWS=262;
export type EvalStatus='pass'|'partial'|'pending'|'fail';
export type EvalResult={id:string;level:string;title:string;status:EvalStatus;note:string};
export type EvalSummary={harnessVersion:string;total:number;mustFailures:number;failures:number;failedIds:string[];results:EvalResult[]};

export async function runEvalSet(options:{routeConfig?:RouteConfig;provider?:ZoeProvider;providerFor?:(m:RouteModel)=>ZoeProvider|null;readSql?:(file:string)=>string|null;
 /** Model mode: the real model the model rows run against. */modelProvider?:ZoeProvider;
 /** Model mode for one tier: only the rows production routes to it (symptom intake is always high; conversational
  * replies are always low; the other rows by the routing rules). Omitted: every row (local runs). */tier?:Tier;
 /** Model mode for the judge tier: also run the reply-judge rows (MJ-*) with this model as the judge. */judgeRows?:boolean}={}):Promise<EvalSummary>{
 checkNormalisation();
 const m=options.modelProvider,tier=options.tier;
 const intakeModel=m&&(!tier||tier==='high')?intakeModelCases(m):[];
 const chatModel=m&&(!tier||tier==='low')?chatModelCases(m):[];
 const attackModel=m?adversarialModelCases(m,tier):[];
 // The judge tier also runs the free-mode health rubric rows (MH-*; Zoe spec v1 §13).
 const judgeModel=m&&options.judgeRows?[...judgeModelCases(m),...healthJudgeModelCases(m)]:[];
 const cases:EvalCase[]=[...EVAL_CASES,...routingCases(options.routeConfig,options.providerFor),...CONVERSATION_CASES,...intakePlumbingCases(),...chatPlumbingCases(),...adversarialPlumbingCases(),...judgePlumbingCases(),...unshacklePlumbingCases(),...budgetPlumbingCases(),...(m?modelCases(m,tier):[]),...intakeModel,...chatModel,...attackModel,...judgeModel];
 const results:EvalResult[]=[];const ids=new Set<string>();
 setEvalProvider(options.provider);
 try{
  for(const c of cases){
   if(ids.has(c.id))throw Error(`Duplicate eval row ${c.id}`);
   ids.add(c.id);
   let status:EvalStatus='pending',note=c.pending??'';
   try{
    if(c.check)await c.check();
    const text=c.sql&&options.readSql?options.readSql(c.sql.file):null;
    if(c.sql&&text!==null)for(const label of c.sql.labels)if(!text.includes(label.replaceAll("'","''"))&&!text.includes(label))throw Error(`SQL check label missing: ${label}`);
    if(c.check||c.sql)status=c.pending?'partial':'pass';
    if(c.sql)note=[note,`SQL: ${c.sql.labels.join('; ')}`].filter(Boolean).join(' · ');
   }catch(error){status='fail';note=error instanceof Error?error.message:String(error);}
   results.push({id:c.id,level:c.level,title:c.title,status,note});
  }
 }finally{setEvalProvider(undefined);}
 const failed=results.filter(r=>r.status==='fail');
 // +intake-N / +chat-N: the symptom intake and conversational model rows ran (the database switches require them).
 return {harnessVersion:`${ZOE_CONFIG_VERSION.replaceAll(/[^a-z0-9_.:+-]/g,'-')}+${options.modelProvider?'model':'plumbing'}${m&&tier?`+tier-${tier}`:''}+rows-${results.length}${intakeModel.length?`+intake-${intakeModel.length}`:''}${chatModel.length?`+chat-${chatModel.length}`:''}${attackModel.length?`+attack-${attackModel.length}`:''}${judgeModel.length?`+judge-${judgeModel.length}`:''}`.slice(-240),total:results.length,mustFailures:failed.filter(r=>r.level==='MUST').length,failures:failed.length,failedIds:failed.map(r=>r.id).slice(0,40),results};
}
