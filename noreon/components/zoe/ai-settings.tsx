'use client';
import {useEffect,useId,useState,type FormEvent,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {fieldClass,buttonClass} from '@/components/staff/shell';
import {SelectField,type SelectOption} from '@/components/ui/select-field';
import {Status,stamp} from '@/components/patient-care/common';
import type {AiSettings,DataAgreement,EvalJob,SettingsResult} from '@/lib/zoe/settings-core';
import type {Tier} from '@/lib/zoe/routing';
import {BELOW_RECOMMENDED_TEXT,tierClassFit} from '@/lib/zoe/tier-class';

type Port=(input:Record<string,unknown>)=>Promise<SettingsResult>;
type Mode='fake'|'gateway'|'off';
type Tone='neutral'|'due'|'complete'|'attention';
const secondary='inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
const label='block min-w-0 space-y-1 text-body2';
const summaryClass='min-h-11 cursor-pointer py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';
const usd=(n:number)=>`US$${n.toFixed(n>0&&n<0.01?4:2)}`;
const TIER_TEXT:Record<Tier,{name:string;what:string}>={
 low:{name:'Low risk',what:'Logistics: booking, times, where results are.'},
 medium:{name:'Medium risk',what:'General health information and summaries for the doctor.'},
 high:{name:'High risk',what:'Symptoms, medication, results and questions about the care plan.'},
};
const STRENGTH=['','Small','Mid','Strongest'];
type Model=AiSettings['catalog'][number];
type Provider=AiSettings['providers'][number];
const AGREEMENT:Record<DataAgreement,{text:string;tone:'attention'|'complete'}>={
 none:{text:'No data agreement yet',tone:'attention'},pending:{text:'Data agreement pending',tone:'attention'},signed:{text:'Data agreement signed',tone:'complete'},
};
const priceText=(m:Model)=>`${usd(m.inputUsdPerMTok)} in / ${usd(m.outputUsdPerMTok)} out per million tokens`;
// A provider missing from the list (older database) counts as having no agreement.
const providerOf=(data:AiSettings,id:string):Provider=>data.providers.find(p=>p.id===id)??{id,label:id,dataAgreement:'none'};
/** Models grouped by provider (by name), strongest and then cheapest first within each. */
function byProvider(data:AiSettings,models:Model[]){
 const groups=new Map<string,Model[]>();
 for(const m of models)groups.set(m.provider,[...(groups.get(m.provider)??[]),m]);
 return [...groups].map(([id,ms])=>({provider:providerOf(data,id),models:ms.toSorted((a,b)=>b.strength-a.strength||a.inputUsdPerMTok-b.inputUsdPerMTok||a.label.localeCompare(b.label))}))
  .sort((a,b)=>a.provider.label.localeCompare(b.provider.label));
}
function AgreementBadge({agreement}:{agreement:DataAgreement}){
 return <Status tone={AGREEMENT[agreement].tone}>{AGREEMENT[agreement].text}</Status>;
}
/** Grouped by provider; the second line names the provider and its data agreement, as the old optgroup label did. */
function modelOptions(data:AiSettings,models:Model[],tier?:Tier):SelectOption[]{
 return byProvider(data,models).flatMap(g=>g.models.map(m=>({value:m.id,label:`${m.label} · ${STRENGTH[m.strength]}${tier&&tierClassFit(tier,m.strength)==='below_recommended'?' · below the recommended class':''}`,description:`${g.provider.label}: ${AGREEMENT[g.provider.dataAgreement].text.toLowerCase()} · ${priceText(m)}`})));
}
/** The chosen model's provider, strength, price and data agreement, under a picker. */
function ModelFacts({data,id,tier}:{data:AiSettings;id:string|null;tier?:Tier}){
 const m=id?data.catalog.find(c=>c.id===id):undefined;
 if(!m)return null;
 const p=providerOf(data,m.provider);
 return <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground"><span>{p.label} · {STRENGTH[m.strength]} · {priceText(m)}</span><AgreementBadge agreement={p.dataAgreement}/>{tier&&tierClassFit(tier,m.strength)==='below_recommended'?<Status tone="attention">{BELOW_RECOMMENDED_TEXT}</Status>:null}</span>;
}

const codeText:Record<string,string>={
 stale:'These settings changed since you opened the page. Reload and try again.',eval_unknown:'The eval result was not found. Try again.',eval_already_used:'That eval result was already used. Try again.',
 eval_expired:'The eval result is older than 15 minutes. Try again.',eval_not_passed:'The eval set did not pass, so nothing changed.',eval_mode_mismatch:'The eval ran in the wrong mode for the current switch state. Try again.',
 above_total_cap:'A tier limit cannot be above the total daily cap.',model_not_allowed:'That model is not allowed for this tier. A tier needs a model of at least its minimum class.',
 change_unknown:'That change no longer exists.',gateway_off:'Real calls are not set up in this deployment (Gateway provider, app switch and the data-agreement setting). Nothing ran.',
 eval_recent:'A model eval for this tier ran in the last 10 minutes. Use that result or try again later.',
 eval_running:'A model eval is already running. Wait for it to finish, then try again.',
 no_basis_for_real_calls:'Staging AI mode is off and real calls are not allowed, so no real model was called.',tier_unknown:'That tier does not exist.',invalid:'Check the values and try again.',not_admin:'Only an administrator can make this change.',
};
export function settingsResultText(r:SettingsResult){
 switch(r.status){
  case 'applied':return `Eval set passed (${r.evalRows} rows, no MUST failure). The new settings are live as version ${r.version}.`;
  case 'rolled_back':return `Rolled back. The earlier settings are live as version ${r.version}.`;
  case 'eval_failed':return `The eval set failed (${r.mustFailures} MUST ${r.mustFailures===1?'failure':'failures'} of ${r.total} rows: ${r.failedIds.join(', ')||'see the eval history'}). Nothing changed.`;
  case 'refused':return codeText[r.code]??'The change was refused. Nothing changed.';
  case 'apply_started':return `Model eval started for ${TIER_TEXT[r.tier].name.toLowerCase()} with the new model. The change applies only if it passes; it takes up to 10 minutes and this page updates when it finishes.`;
  case 'eval_started':return `Model eval started for ${TIER_TEXT[r.tier].name.toLowerCase()}. It takes up to 10 minutes and this page updates when it finishes.`;
  case 'disabled':return 'AI settings are switched off.';
  case 'access':return 'Only an administrator can make this change.';
  case 'invalid':return 'Check the values and try again.';
  case 'unavailable':return 'Couldn’t run the check right now. Nothing changed. Try again.';
 }
}

function useSend(port:Port){
 const router=useRouter();
 const [pending,setPending]=useState(false),[result,setResult]=useState<SettingsResult|null>(null);
 async function send(input:Record<string,unknown>){
  if(pending)return;
  setPending(true);setResult(null);
  const r=await port(input).catch(():SettingsResult=>({status:'unavailable'}));
  setPending(false);setResult(r);
  if(r.status==='applied'||r.status==='rolled_back'||r.status==='eval_failed'||r.status==='eval_started'||r.status==='apply_started')router.refresh();
 }
 return {pending,result,send};
}
function Outcome({result}:{result:SettingsResult|null}){
 if(!result)return null;
 const ok=result.status==='applied'||result.status==='rolled_back'||result.status==='eval_started'||result.status==='apply_started';
 return <p role={ok?'status':'alert'} className="text-body2">{settingsResultText(result)}</p>;
}

/** One titled card per group; the lead line is the only always-visible explanation. */
function Section({id,title,lead,children}:{id:string;title:string;lead?:ReactNode;children:ReactNode}){
 return <section aria-labelledby={id} className="space-y-4 rounded-xl border bg-background p-4 sm:p-6">
  <header className="space-y-1"><h2 id={id} className="text-h3">{title}</h2>{lead&&<p className="text-body2 text-muted-foreground">{lead}</p>}</header>
  {children}
 </section>;
}
/** Longer explanation, closed by default. */
function More({summary,children}:{summary:string;children:ReactNode}){
 return <details className="border-t"><summary className={summaryClass}>{summary}</summary><div className="space-y-2 pb-2 text-body2 text-muted-foreground">{children}</div></details>;
}
/** Spend against a limit: the words carry the numbers, the bar is decoration. */
function Meter({used,cap}:{used:number;cap:number}){
 const pct=cap>0?Math.min(100,Math.round(used/cap*100)):0;
 return <div aria-hidden className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:`${pct}%`}}/></div>;
}

export function AiSettingsAdmin({data,job=null,status,rules,apply,rollback,modelEval}:{data:AiSettings;job?:EvalJob|null;status:{appFlag:boolean;gateway:boolean;mode:Mode};rules:{tier:Tier;rules:string[]}[];apply:Port;rollback:Port;modelEval?:Port}){
 const modelName=(id:string|null)=>id?data.catalog.find(c=>c.id===id)?.label??id:'None';
 const live=data.modelCallsAllowed&&status.appFlag&&status.mode==='gateway';
 const evalAvailable=!!modelEval&&status.mode==='gateway'&&(data.stagingAiMode||data.modelCallsAllowed);
 return <div className="space-y-6">
  <Summary data={data} status={status} live={live}/>
  <Switches data={data} status={status}/>

  <Section id="tiers-title" title="Models and daily limits" lead="Each message gets a risk tier, and each tier has its own model, a fallback if that model fails, and a daily spending limit.">
   <ul className="divide-y border-y">{data.tiers.map(t=><TierRow key={t.tier} tier={t} data={data} apply={apply} modelName={modelName}/>)}</ul>
   <p className="text-caption text-muted-foreground">Spending is counted per Yerevan day ({data.spendDay}). The total cap is US$10 a day and cannot be raised here.</p>
   <More summary="How a message gets its tier">
    <p>Fixed rules and the scope check decide the tier before any model is called; the model never chooses its own route. Every message in the conversation window counts, the highest tier wins, and when the route is unsure (no rule matched, a possible third party, a suspected instruction to the AI, mixed language) it goes one tier up, never down.</p>
    <ul className="grid gap-3 sm:grid-cols-3">{rules.map(r=><li key={r.tier} className="rounded-lg border p-3"><p className="text-body2 font-medium text-foreground">{TIER_TEXT[r.tier].name}</p><ul className="list-disc pl-5 text-caption">{r.rules.map(x=><li key={x}>{x}</li>)}</ul></li>)}</ul>
   </More>
  </Section>

  <Providers data={data}/>

  <Section id="checks-title" title="Checks and change history" lead="Every change runs the eval set first, is recorded, and can be rolled back.">
   {(evalAvailable||job)&&<ModelEval data={data} job={job} run={evalAvailable?modelEval:undefined} modelName={modelName}/>}
   <History data={data} rollback={rollback} modelName={modelName}/>
   <EvalRuns data={data} modelName={modelName}/>
  </Section>
 </div>;
}

/** The answer to "what is Zoe doing right now", in one card. */
function Summary({data,status,live}:{data:AiSettings;status:{appFlag:boolean;gateway:boolean;mode:Mode};live:boolean}){
 const headline=live?'Zoe is using real AI models':status.mode==='fake'?'Zoe is using the stand-in model':status.mode==='gateway'?'Real AI calls are blocked':'Zoe makes no AI calls';
 const detail=live?'Messages go through the Vercel AI Gateway to the models below.':status.mode==='fake'?'The stand-in model runs on the server. Nothing is sent to an AI provider.':status.mode==='gateway'?'The Vercel AI Gateway is selected, but the database switch refuses every call.':'No provider is set up, so Zoe makes no AI call.';
 const signed=byProvider(data,data.catalog).filter(g=>g.provider.dataAgreement==='signed').length;
 const providers=byProvider(data,data.catalog).length;
 const chips:{text:string;tone:Tone}[]=[
  {text:`Real AI calls ${live?'on':'off'}`,tone:live?'complete':'neutral'},
  {text:`Staging AI mode ${data.stagingAiMode?'on':'off'}`,tone:data.stagingAiMode?'attention':'neutral'},
  {text:`Zoe’s own answers ${data.directAnswersEnabled?'on':'off'}`,tone:data.directAnswersEnabled?'complete':'neutral'},
  {text:`Data agreements ${signed} of ${providers} signed`,tone:signed===providers&&providers>0?'complete':'attention'},
 ];
 return <section aria-labelledby="summary-title" className="grid gap-6 rounded-xl border bg-background p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
  <div className="min-w-0 space-y-3">
   <p className="text-overline text-muted-foreground">Status now</p>
   <h2 id="summary-title" className="text-h2">{headline}</h2>
   <p className="text-body2 text-muted-foreground">{detail}</p>
   <ul className="flex flex-wrap gap-2" aria-label="Switches">{chips.map(c=><li key={c.text}><Status tone={c.tone}>{c.text}</Status></li>)}</ul>
   {data.stagingAiMode&&<p className="text-body2">Staging AI mode allows real calls without a signed data agreement. It stays on by the owner’s decision until the data agreements and the legal check are done.</p>}
  </div>
  <div className="min-w-0 space-y-2 md:border-l md:pl-6">
   <p className="text-overline text-muted-foreground">Spent today</p>
   <p className="font-heading text-display3 tabular-nums">{usd(data.spentTodayUsd)}</p>
   <p className="text-caption text-muted-foreground">of the {usd(data.totalCapUsd)} daily cap</p>
   <Meter used={data.spentTodayUsd} cap={data.totalCapUsd}/>
   {!data.settingsRow&&<p role="alert" className="text-body2">Zoe settings are not set up on this database, so the cap is US$0 and nothing can run.</p>}
  </div>
 </section>;
}

/** Read-only: these are set outside this page. Add a row here when a new switch reaches the settings read. */
function Switches({data,status}:{data:AiSettings;status:{appFlag:boolean;gateway:boolean;mode:Mode}}){
 const rows:{name:string;help:string;state:string;tone:Tone}[]=[
  {name:'Real AI calls',help:data.modelCallsAllowed?'Database switch on: Zoe may call the selected models.':'Database switch off: every real AI call is refused.',state:data.modelCallsAllowed?'On':'Off',tone:data.modelCallsAllowed?'complete':'neutral'},
  {name:'Staging AI mode',help:data.stagingAiMode?'Real calls without a signed data agreement (owner’s decision, pending the data agreements and legal check).':'Real calls need a signed data agreement for every provider.',state:data.stagingAiMode?'On':'Off',tone:data.stagingAiMode?'attention':'neutral'},
  {name:'Zoe’s own answers',help:data.directAnswersEnabled?'Zoe answers logistics and app questions herself. Health questions still go to the doctor.':'Every reply goes through the doctor.',state:data.directAnswersEnabled?'On':'Off',tone:data.directAnswersEnabled?'complete':'neutral'},
  {name:'App switch',help:'NOREON_ZOE_MODEL_CALLS_ENABLED in the deployment.',state:status.appFlag?'On':'Off',tone:status.appFlag?'complete':'neutral'},
  {name:'Vercel AI Gateway key',help:'Kept in hosting secrets, never shown on this page.',state:status.gateway?'Set up':'Missing',tone:status.gateway?'complete':'neutral'},
 ];
 return <Section id="switch-title" title="Switches" lead="What is allowed right now. These are changed outside this page and shown here so you can check them.">
  <ul className="divide-y border-y">{rows.map(r=><li key={r.name} className="flex items-start justify-between gap-4 py-3">
   <div className="min-w-0"><p className="text-body2 font-medium">{r.name}</p><p className="text-caption text-muted-foreground">{r.help}</p></div>
   <Status tone={r.tone}>{r.state}</Status></li>)}</ul>
  <More summary="How the switches work and what keeps members safe">
   <p>Zoe calls a real model only when the database switch, the app switch and the Gateway provider are all on. The database switch can be switched on only in staging AI mode (real calls before the data agreements) or with a signed data agreement for every configured provider, and only after a passing model eval for each tier.</p>
   <p>Urgent words never reach a model: they go straight to the care alert. Every AI draft about health still needs the assigned doctor’s approval before a member sees it.</p>
  </More>
 </Section>;
}

function TierRow({tier,data,apply,modelName}:{tier:AiSettings['tiers'][number];data:AiSettings;apply:Port;modelName:(id:string|null)=>string}){
 const c=useSend(apply);
 const allowed=data.catalog.filter(m=>tierClassFit(tier.tier,m.strength)!=='not_allowed');
 const [model,setModel]=useState(tier.model),[fallback,setFallback]=useState(tier.fallback??''),[cap,setCap]=useState(String(tier.dailyCapUsd)),[reason,setReason]=useState('');
 const changed=model!==tier.model||(fallback||null)!==tier.fallback||Number(cap)!==tier.dailyCapUsd;
 function submit(event:FormEvent){event.preventDefault();
  void c.send({tier:tier.tier,model,fallback:fallback||null,dailyCapUsd:Number(cap),expectedVersion:tier.version,...(reason.trim()?{reason:reason.trim()}:{})});}
 const id=`tier-${tier.tier}`;const f=useId();
 const short=(mid:string|null)=>{const m=mid?data.catalog.find(x=>x.id===mid):undefined;return m?`${providerOf(data,m.provider).label} · ${STRENGTH[m.strength]}${tierClassFit(tier.tier,m.strength)==='below_recommended'?' · below the recommended class':''}`:null;};
 return <li><article aria-labelledby={id} className="space-y-3 py-4">
  <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
   <div className="min-w-0"><h3 id={id} className="text-body1 font-semibold">{TIER_TEXT[tier.tier].name}</h3><p className="text-caption text-muted-foreground">{TIER_TEXT[tier.tier].what}</p></div>
   <span className="text-caption text-muted-foreground">Version {tier.version} · since {stamp(tier.updatedAt,'en')}</span></header>
  <dl className="grid gap-3 text-body2 sm:grid-cols-3">
   <div className="min-w-0"><dt className="text-caption text-muted-foreground">Model</dt><dd className="break-words"><span className="block font-medium">{modelName(tier.model)}</span><span className="text-caption text-muted-foreground">{short(tier.model)}</span></dd></div>
   <div className="min-w-0"><dt className="text-caption text-muted-foreground">Fallback</dt><dd className="break-words"><span className="block font-medium">{modelName(tier.fallback)}</span><span className="text-caption text-muted-foreground">{short(tier.fallback)}</span></dd></div>
   <div className="min-w-0 space-y-1"><dt className="text-caption text-muted-foreground">Today</dt><dd className="space-y-1"><span className="block"><span className="font-medium tabular-nums">{usd(tier.spentTodayUsd)}</span> <span className="text-muted-foreground">of {usd(tier.dailyCapUsd)} limit</span></span><Meter used={tier.spentTodayUsd} cap={tier.dailyCapUsd}/></dd></div>
  </dl>
  <details className="rounded-lg border px-3"><summary className={summaryClass}>Change this tier</summary>
   <form onSubmit={submit} className="space-y-3 pb-3" aria-label={`Change ${TIER_TEXT[tier.tier].name}`}>
    <div className="grid gap-3 sm:grid-cols-2">
     <div className={label}><label htmlFor={`${f}-m`}>Model</label><SelectField id={`${f}-m`} value={model} onValueChange={setModel} options={modelOptions(data,allowed,tier.tier)} searchPlaceholder="Search models"/><ModelFacts data={data} id={model} tier={tier.tier}/></div>
     <div className={label}><label htmlFor={`${f}-f`}>Fallback, if the model fails</label><SelectField id={`${f}-f`} value={fallback} onValueChange={setFallback} options={[{value:'',label:'No fallback'},...modelOptions(data,allowed.filter(m=>m.id!==model),tier.tier)]} searchPlaceholder="Search models"/><ModelFacts data={data} id={fallback||null} tier={tier.tier}/></div>
     <label className={label}><span>Daily limit in US$ (at most {usd(data.totalCapUsd||10)})</span><input required inputMode="decimal" pattern="[0-9]{1,2}(\.[0-9]{1,2})?" value={cap} onChange={e=>setCap(e.target.value)} className={fieldClass}/></label>
     <label className={label}><span>Reason (optional)</span><input maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} className={fieldClass}/></label>
    </div>
    <p className="text-caption text-muted-foreground">Models at or above this tier’s minimum class are offered; a model below its recommended class is marked. The full eval set runs first; if any MUST row fails, nothing changes.</p>
    <button className={buttonClass} disabled={c.pending||!changed||model===fallback}>{c.pending?'Running the eval set…':'Run the eval set and apply'}</button>
    <Outcome result={c.result}/>
   </form>
  </details>
 </article></li>;
}

function Providers({data}:{data:AiSettings}){
 const groups=byProvider(data,data.catalog);
 const signed=groups.filter(g=>g.provider.dataAgreement==='signed').length;
 return <Section id="providers-title" title="AI providers and data agreements" lead={`Real member data must not go to a provider until its data processing agreement is signed and the legal check is done. ${signed?`${signed} of ${groups.length} providers have a signed agreement.`:'No provider has one yet.'}`}>
  <ul className="divide-y border-y">{groups.map(g=><li key={g.provider.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
   <div className="min-w-0"><p className="text-body2 font-medium">{g.provider.label}</p><p className="text-caption text-muted-foreground">{g.models.length} {g.models.length===1?'model':'models'}: {g.models.map(m=>m.label).join(', ')}</p></div>
   <AgreementBadge agreement={g.provider.dataAgreement}/></li>)}</ul>
  <More summary="Model strengths and prices">
   <p>Every model goes through the Vercel AI Gateway, so switching provider is a setting. Prices are US$ per million tokens, input / output, from the Gateway model list. Small, Mid and Strongest set which risk tiers may use a model.</p>
   <ul className="grid gap-2 sm:grid-cols-2">{groups.flatMap(g=>g.models.map(m=><li key={m.id} className="flex justify-between gap-3 text-caption"><span className="min-w-0 break-words text-foreground">{m.label} · {STRENGTH[m.strength]}</span><span className="shrink-0 tabular-nums">{usd(m.inputUsdPerMTok)} / {usd(m.outputUsdPerMTok)}</span></li>))}</ul>
  </More>
 </Section>;
}

const JOB_FAILED:Record<string,string>={timed_out:'It did not finish in time, so nothing was recorded.',run_failed:'The run stopped with an error, so nothing was recorded.',
 record_failed:'It ran, but the result could not be saved.',record_refused:'It ran, but the result was refused when saving.',
 apply_refused:'The eval passed, but the change was refused (the settings changed meanwhile, or the change is no longer valid). Nothing changed.',
 apply_failed:'The eval passed, but the change could not be applied. Nothing changed.'};
/** The latest background eval: running (the page refreshes itself until it lands) or its result. */
function JobStatus({job,modelName}:{job:EvalJob;modelName:(id:string|null)=>string}){
 const router=useRouter();const running=job.status==='running';
 useEffect(()=>{if(!running)return;const t=setInterval(()=>router.refresh(),15_000);return ()=>clearInterval(t);},[running,router]);
 const what=`${TIER_TEXT[job.tier].name}: ${modelName(job.model)}`;
 if(running)return <div role="status" className="space-y-1 rounded-md bg-muted p-3 text-body2"><p className="font-medium">Eval running… {what}</p><p className="text-caption text-muted-foreground">Started {stamp(job.startedAt,'en')}. It takes up to 10 minutes; this page updates by itself.</p></div>;
 const r=job.result;
 return <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-body2">
  <div className="min-w-0"><p className="font-medium">Last model eval · {what}</p>
   <p className="text-caption text-muted-foreground">{stamp(job.finishedAt??job.startedAt,'en')} · {r?`${r.total} rows${r.failedIds.length?` · failed ${r.failedIds.join(', ')}`:''}`:JOB_FAILED[job.errorCode??'']??'It did not finish, so nothing was recorded.'}</p></div>
  <Status tone={r&&!r.mustFailures?'complete':'attention'}>{r?r.mustFailures?`${r.mustFailures} MUST failed`:'Passed':'Not finished'}</Status>
 </div>;
}

/** Model-mode eval with real calls, one tier at a time, run in the background. It spends real money, so it asks first. */
function ModelEval({data,job,run,modelName}:{data:AiSettings;job:EvalJob|null;run?:Port;modelName:(id:string|null)=>string}){
 const id=useId();const [tier,setTier]=useState<Tier>('low');const [confirm,setConfirm]=useState(false);const c=useSend(run??(async()=>({status:'unavailable'})));
 const current=data.tiers.find(t=>t.tier===tier);const running=job?.status==='running';
 return <form className="space-y-3 rounded-lg border p-4" onSubmit={(e:FormEvent)=>{e.preventDefault();if(!run||running)return;if(!confirm){setConfirm(true);return;}setConfirm(false);void c.send({tier});}}>
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-body1 font-semibold">Model eval with real calls</h3><Status tone="attention">Uses real AI calls</Status></div>
  <p className="text-caption text-muted-foreground">Runs the full eval set with the tier’s current model and records the result. Each tier needs a passing run in the last 7 days before real calls can be switched on. One eval runs at a time.</p>
  {job&&<JobStatus job={job} modelName={modelName}/>}
  {run&&<div className="flex flex-wrap items-end gap-3"><label htmlFor={id} className={label}><span>Tier</span>
   <select id={id} className={fieldClass} value={tier} disabled={confirm||c.pending} onChange={e=>setTier(e.target.value as Tier)}>{data.tiers.map(t=><option key={t.tier} value={t.tier}>{TIER_TEXT[t.tier].name}</option>)}</select></label>
   {!confirm&&<button className={secondary} disabled={c.pending||running}>{c.pending?'Starting the model eval…':running?'Eval running…':'Run the model eval'}</button>}</div>}
  {confirm&&<div className="space-y-2 rounded-md bg-[var(--status-warning-bg)] p-3">
   <p className="text-body2">This sends the eval set to {modelName(current?.model??null)} through the Vercel AI Gateway. It costs a few cents and takes up to 10 minutes.</p>
   <div className="flex flex-wrap gap-2"><button className={buttonClass}>Run it now</button><button type="button" className={secondary} onClick={()=>setConfirm(false)}>Cancel</button></div>
  </div>}
  <Outcome result={c.result}/>
 </form>;
}

function History({data,rollback,modelName}:{data:AiSettings;rollback:Port;modelName:(id:string|null)=>string}){
 return <div className="space-y-2">
  <h3 className="text-body1 font-semibold">Change history</h3>
  {data.changes.length?<ul className="divide-y border-y">{data.changes.map(ch=><HistoryRow key={ch.id} ch={ch} version={data.tiers.find(t=>t.tier===ch.tier)?.version??1} rollback={rollback} modelName={modelName}/>)}</ul>:<p className="text-body2 text-muted-foreground">No changes yet. The tiers use the decided defaults.</p>}
 </div>;
}
function HistoryRow({ch,version,rollback,modelName}:{ch:AiSettings['changes'][number];version:number;rollback:Port;modelName:(id:string|null)=>string}){
 const c=useSend(rollback);const [confirm,setConfirm]=useState(false);
 const describe=(x:AiSettings['changes'][number]['before'])=>`${modelName(x.model)}, fallback ${modelName(x.fallback)}, ${usd(x.dailyCapUsd)} a day`;
 return <li className="space-y-2 py-3 text-body2">
  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
   <div className="min-w-0 space-y-1">
    <p className="break-words"><span className="font-medium">{TIER_TEXT[ch.tier].name}: {ch.action==='apply'?'changed':`rolled back change ${ch.rolledBackChangeId}`}</span> <span className="text-muted-foreground">by {ch.actor}, {stamp(ch.at,'en')}</span></p>
    <p className="break-words text-caption text-muted-foreground">Before: {describe(ch.before)}. After: {describe(ch.after)}.{ch.reason?` Reason: ${ch.reason}`:''}</p>
   </div>
   {!confirm&&<button type="button" className={`${secondary} justify-self-start`} onClick={()=>setConfirm(true)}>Roll back this change</button>}
  </div>
  {confirm&&<div className="space-y-2 rounded-md bg-[var(--status-warning-bg)] p-3"><p>This makes the earlier settings live again: {describe(ch.before)}.</p>
   <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={c.pending} onClick={()=>void c.send({changeId:ch.id,expectedVersion:version}).then(()=>setConfirm(false))}>{c.pending?'Rolling back…':`Restore: ${describe(ch.before)}`}</button>
   <button type="button" className={secondary} onClick={()=>setConfirm(false)}>Keep the current settings</button></div></div>}
  <Outcome result={c.result}/>
 </li>;
}

function EvalRuns({data,modelName}:{data:AiSettings;modelName:(id:string|null)=>string}){
 const failed=data.evalRuns.filter(e=>e.mustFailures).length;
 return <details className="border-t"><summary className={summaryClass}>Eval runs ({data.evalRuns.length}{failed?`, ${failed} with MUST failures`:''})</summary>
  <div className="space-y-2 pb-2">
   <p className="text-caption text-muted-foreground">While real calls are off the eval set runs in plumbing mode: every guard, routing and safety row runs with the stand-in model, not the selected one. Once calls are on, the set must run with the selected model.</p>
   {data.evalRuns.length?<ul className="divide-y">{data.evalRuns.map(e=><li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-body2">
    <span className="min-w-0 break-words">{TIER_TEXT[e.tier].name}: {modelName(e.model)}, fallback {modelName(e.fallback)}<span className="block text-caption text-muted-foreground">{stamp(e.at,'en')} · {e.mode} · {e.totalRows} rows{e.failedIds.length?` · failed ${e.failedIds.join(', ')}`:''}</span></span>
    <Status tone={e.mustFailures?'attention':'complete'}>{e.mustFailures?`${e.mustFailures} MUST failed`:e.used?'Passed, applied':'Passed'}</Status></li>)}</ul>:<p className="text-body2">No eval runs yet.</p>}
  </div>
 </details>;
}
