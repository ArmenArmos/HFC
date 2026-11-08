import type {ChatMedicine,MemberStatement} from '../chat-record';
import type {ZoeWhy} from '../why';
import {runZoeJob,type FinishInput,type ZoeEvent,type ZoeJob,type ZoePorts,type ZoeRouting} from '../pipeline';
import type {Tier} from '../routing';
import {createFakeJudge} from '../reply-check';
import {MEMBER_DAILY_CAP_USD} from '../conversation';
import {createFakeProvider,type FakeScenario,type ProviderRequest,type ZoeProvider} from '../provider';
import {guardDraftOutput,guardField,type GuardContext} from '../output-guard';
import type {ReplyDraftRecord} from '../reply-draft';

/**
 * Deterministic eval harness for EVAL_SET v6 layers 1 and 2 (no model, no network): the real
 * pipeline with the fake provider and in-memory ports, plus fixture model outputs fed straight
 * into the output guard. A pass here is PLUMBING ACCEPTANCE ONLY: the urgent list is a fictional
 * test list and no wording is signed (EVAL_SET "Plumbing vs clinical acceptance").
 */
export type Level='MUST'|'SHOULD';
export type EvalCase={id:string;level:Level;title:string;
 /** Throws on failure. Absent when nothing of the row is built yet. */
 check?:()=>Promise<void>|void;
 /** What of the row is not built yet (task named). Present with check = partial. */
 pending?:string;
 /** Rows checked by a SQL check: the label must exist in that file. */
 sql?:{file:string;labels:string[]}};

export type PipelineRun={outcome:string;reason:string;providerCalls:ProviderRequest[];judgeCalls:ProviderRequest[];finish:FinishInput|null;reserved:{estimateUsd:number;local:boolean;events:ZoeEvent[];tier?:Tier;model?:string;judgeModel?:string|null}|null;events:ZoeEvent[];classifierAuths?:number};

/** Set by the AI settings eval run: the provider that stands in for (or, once calls are on, is) the candidate model. */
let evalProvider:ZoeProvider|undefined;
export const setEvalProvider=(p:ZoeProvider|undefined)=>{evalProvider=p;};

let seq=0;
const uuid=()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
export function job(texts:string|string[],extra:Partial<ZoeJob>={}):ZoeJob{
 const list=Array.isArray(texts)?texts:[texts];
 return {runId:uuid(),memberId:uuid(),messageSeq:list.length,displayName:extra.displayName??null,messages:list.map((text,i)=>({seq:i+1,text,minutesAgo:list.length-i})),replies:[],answers:[],directAnswers:false,
  // Health-answer runs of the whole set (NOREON_ZOE_EVAL_HEALTH_ANSWERS=true): every row with the switch on (health-answer.ts).
  ...(process.env.NOREON_ZOE_EVAL_HEALTH_ANSWERS==='true'?{healthAnswers:true}:{}),...extra};
}

/** Runs the real pipeline with a recording provider and in-memory ports. */
export async function runPipeline(input:ZoeJob,options:{provider?:ZoeProvider|null;fixture?:FakeScenario;fixtureRaw?:string;env?:Record<string,string|undefined>;spentTodayUsd?:number;capUsd?:number;routing?:ZoeRouting;tierCapUsd?:number;
 /** Lets the pipeline answer directly (the job's directAnswers must be true as well). */directAnswers?:boolean;
 /** Accept non-local providers at the reservation (model-mode eval: the real reservation is the database's). */allowRemote?:boolean;
 /** The reply judge (default: the stand-in judge; null: none, so every member text is blocked; 'routing': the pipeline picks it from the routing). */judge?:ZoeProvider|null|'routing';
 /** The run's clock and time budget (time-budget rows); onReserve runs inside the reservation (a slow database). */now?:()=>number;timeBudget?:{budgetMs:number;cutoffMs:number};onReserve?:()=>void;
 /** Member spend read under the reservation lock; may be newer than the job context. */memberSpentTodayUsd?:number;
 /** An explicit database refusal (failure-path checks). */reserveCode?:string;
 /** The classifier authorization (decisions.ts): absent, the port answers like the reservation would (a reservation refusal, or the member over the cap, refuses it); false: no such port. */classifierCode?:string;noClassifierPort?:boolean;
 /** The second check on a model-only emergency (urgent-check.ts); absent: the pipeline's default. */urgencyCheck?:ZoeProvider|null;
 /** Structured reply drafts: the in-memory store for recordReplyDraft (absent: the port is absent, so the path is off). */replyDrafts?:{records:ReplyDraftRecord[];refuse?:boolean};
 /** The topic check's model (topic.ts; absent: the pipeline's own choice). */topicCheck?:ZoeProvider|null;
 /** The why record (why.ts): the in-memory store for recordWhy (absent: the port is absent); fail: the save refuses or throws. */why?:{records:ZoeWhy[];fail?:'refuse'|'throw'};
 /** A typed very high reading's save (zoe_run_bp_typed_save): the readings the port was asked to save (absent: the port is absent); result: what it answers. */typedBp?:{saves:{seq:number;index:number;systolic:number;diastolic:number}[];result?:{saved:boolean;notified:boolean}|'throw'};
 /** The chat record (chat-record.ts): the in-memory store (absent: the ports are absent); status: what the list answers. */chatRecord?:{medicines:ChatMedicine[];statements:MemberStatement[];status?:string}}={}):Promise<PipelineRun>{
 const calls:ProviderRequest[]=[];
 const inner=options.provider===undefined&&evalProvider&&!options.fixture&&options.fixtureRaw===undefined?evalProvider:options.provider===undefined?createFakeProvider({...(options.fixture?{fixture:options.fixture}:{}),...(options.fixtureRaw!==undefined?{fixtureRaw:options.fixtureRaw}:{})}):options.provider;
 const provider:ZoeProvider|null=inner&&{...inner,providerName:inner.providerName,requestModel:inner.requestModel,region:inner.region,local:inner.local,pricing:inner.pricing,complete:async(r:ProviderRequest)=>{calls.push(r);return inner.complete(r);}};
 const run:PipelineRun={outcome:'',reason:'',providerCalls:calls,judgeCalls:[],finish:null,reserved:null,events:[]};
 const ports:ZoePorts={
  reserve:async(_id,estimateUsd,local,events,route)=>{options.onReserve?.();run.reserved={estimateUsd,local,events,tier:route.tier,model:route.model,judgeModel:route.judgeModel??null};run.events.push(...events);
   if(options.reserveCode)return {ok:false,code:options.reserveCode};
   if(!local&&!options.allowRemote)return {ok:false,code:'model_calls_not_permitted'};
   if(options.tierCapUsd!==undefined&&(options.spentTodayUsd??0)+estimateUsd>options.tierCapUsd)return {ok:false,code:'tier_spend_cap_reached'};
   if((options.spentTodayUsd??0)+estimateUsd>(options.capUsd??10))return {ok:false,code:'daily_spend_cap_reached'};
   if(!local&&(options.memberSpentTodayUsd??input.conversation?.memberSpentTodayUsd??0)>=Math.min(input.conversation?.memberDailyCapUsd??MEMBER_DAILY_CAP_USD,options.capUsd??10))return {ok:false,code:'member_spend_cap_reached'};
   return {ok:true};},
  ...(options.noClassifierPort?{}:{authorizeClassifier:async()=>{run.classifierAuths=(run.classifierAuths??0)+1;
   const code=options.classifierCode??options.reserveCode??((options.memberSpentTodayUsd??input.conversation?.memberSpentTodayUsd??0)>=Math.min(input.conversation?.memberDailyCapUsd??MEMBER_DAILY_CAP_USD,options.capUsd??10)?'member_spend_cap_reached':undefined);
   return code?{ok:false,code}:{ok:true};}}),
  finish:async(_id,f)=>{run.finish=f;run.events.push(...f.events);return {ok:true,outcome:f.outcome};},
  ...(options.why?{recordWhy:async(_id:string,w:ZoeWhy)=>{if(options.why!.fail==='throw')throw Error('why save failed');if(options.why!.fail==='refuse')return {ok:false};options.why!.records.push(w);return {ok:true};}}:{}),
  ...(options.chatRecord?{addMedicines:async(_id:string,m:readonly ChatMedicine[])=>{const status=options.chatRecord!.status??'added';if(status==='added')options.chatRecord!.medicines.push(...m);return {status};},
   recordStatements:async(_id:string,x:readonly MemberStatement[])=>{options.chatRecord!.statements.push(...x);}}:{}),
  ...(options.typedBp?{saveTypedBp:async(_id:string,r:{seq:number;index:number;systolic:number;diastolic:number})=>{options.typedBp!.saves.push(r);if(options.typedBp!.result==='throw')throw Error('save failed');return options.typedBp!.result??{saved:true,notified:true};}}:{}),
  ...(options.replyDrafts?{recordReplyDraft:async(_id:string,record:ReplyDraftRecord)=>{if(options.replyDrafts!.refuse)return {ok:false};options.replyDrafts!.records.push(record);return {ok:true};}}:{}),
 };
 // With routing, the recording wrapper sits around every tier provider too.
 const wrap=(p:ZoeProvider|null):ZoeProvider|null=>p&&{...p,complete:async(r:ProviderRequest)=>{calls.push(r);return p.complete(r);}};
 const routing=options.routing&&{...options.routing,providerFor:(m:Parameters<ZoeRouting['providerFor']>[0])=>wrap(options.routing!.providerFor(m))};
 // The reply judge: the stand-in judge unless the row passes one (or null, for "no judge"); recorded like the provider.
 const judgeInner=options.judge===undefined?createFakeJudge():options.judge==='routing'?undefined:options.judge;
 const judge=judgeInner&&{...judgeInner,complete:async(r:ProviderRequest)=>{run.judgeCalls.push(r);return judgeInner.complete(r);}};
 const r=await runZoeJob(input,{provider,ports,seal:p=>JSON.stringify(p),env:{NOREON_ZOE_TEST_LEXICON:'true',...options.env},...(routing?{routing}:{}),...(options.directAnswers!==undefined?{directAnswers:options.directAnswers}:{}),...(judge===undefined?{}:{judge}),...(options.now?{now:options.now}:{}),...(options.timeBudget?{timeBudget:options.timeBudget}:{}),...(options.urgencyCheck!==undefined?{urgencyCheck:options.urgencyCheck}:{}),...(options.topicCheck!==undefined?{topicCheck:options.topicCheck}:{})});
 run.outcome=r.outcome;run.reason=r.reason;
 return run;
}

/** A fixture model output with this draft (layer 2). */
export const fixtureRaw=(draft:string|null,lang:'en'|'hy'|'ru'='en',extra:Record<string,unknown>={})=>JSON.stringify({summary:'Member asked a question; see their message.',draft_reply:draft,no_draft_reason_code:draft===null?'needs_doctor':null,missing_info:[],language:lang,...extra});

export const draftVerdict=(draft:string,member:string,lang:'en'|'hy'|'ru'='en')=>guardDraftOutput(fixtureRaw(draft,lang),{memberTexts:[member],replyLanguage:lang},{draftsAllowed:true});
export const fieldCats=(field:'draft'|'summary'|'missing_info',text:string,ctx:Partial<GuardContext>={})=>guardField(field,text,{memberTexts:[],replyLanguage:'en',...ctx});

export class EvalFailure extends Error{}
export function expect(condition:unknown,message:string):asserts condition{if(!condition)throw new EvalFailure(message);}
