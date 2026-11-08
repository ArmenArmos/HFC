import {z} from 'zod';

/**
 * OpenAI Decisions API next to Zoe's own routing (lead decision 31 Oct; offline test output/decisions-eval: route 96.5% against
 * 93.0%, language 100% against 94.2%). Shadow mode only: the call runs beside the current code, both answers are written to the
 * trace as labels, and nothing a member sees depends on it. It never delays a run (the pipeline does not wait for it) and fails open:
 * a timeout, an error or an unexpected answer is one trace line and nothing else.
 *
 * NOREON_ZOE_DECISIONS=shadow switches it on; anything else is off. The key is OPENAI_API_KEY2 and is never logged.
 * The text sent is the redacted member window (names and identifiers replaced as for the answering model); no member id is sent.
 */
export const DECISIONS_VERSION='zoe-decisions-1';
export const DECISIONS_TIMEOUT_MS=1_500;
export const DECISIONS_MAX_MESSAGES=6;
export const DECISIONS_MAX_CHARS=1_000;
const ENDPOINT='https://api.openai.com/v1/decisions';
const MODEL='gpt-6-luna';

/**
 * NOREON_ZOE_DECISIONS: a list of switches, comma or space separated (case does not matter), and OPENAI_API_KEY2 must be set.
 *   shadow    ask and write the trace line only
 *   language  Decisions may turn "English" into Armenian in Latin letters (never the other way)
 *   route     Decisions may raise the risk tier, never lower it
 *   topic     Decisions may veto "this is a new, independent question" (keeps the whole window), never create one
 * language, route and topic each imply the call and the trace line. Any other word is ignored.
 */
export type DecisionsFlags={shadow:boolean;language:boolean;route:boolean;topic:boolean;any:boolean;effects:boolean};
export const decisionsFlags=(env:Record<string,string|undefined>):DecisionsFlags=>{
 const words=new Set((env.NOREON_ZOE_DECISIONS??'').toLowerCase().split(/[\s,]+/u).filter(Boolean));
 const keyed=!!env.OPENAI_API_KEY2?.trim();
 const language=keyed&&words.has('language'),route=keyed&&words.has('route'),topic=keyed&&words.has('topic'),shadow=keyed&&words.has('shadow');
 const effects=language||route||topic;
 return {shadow,language,route,topic,effects,any:shadow||effects};
};
/** Kept for the shadow-only reading of the flag. */
export const decisionsMode=(env:Record<string,string|undefined>):'off'|'shadow'=>decisionsFlags(env).any?'shadow':'off';

export type DecisionsRoute='low'|'medium'|'high';
export type DecisionsLanguage='en'|'hy'|'hy-Latn'|'ru';
export type DecisionsTopic='same'|'new';
export type DecisionsVerdict={route:{value:DecisionsRoute;confidence:number};language:{value:DecisionsLanguage;confidence:number};topic?:{value:DecisionsTopic;confidence:number}};
export type DecisionsResult={ok:true;verdict:DecisionsVerdict;latencyMs:number;inputTokens:number}|{ok:false;reason:'timeout'|'http_error'|'bad_shape'|'network'|'not_authorized';latencyMs:number};

type Question={name:string;type:'choice';instructions:string;choices:{value:string;description:string}[]};
const choices=(...values:string[])=>values.map(value=>({value,description:value}));

/** The request: route and language always, topic only when the window has an earlier message. */
export function buildDecisionsRequest(texts:string[]){
 const window=texts.slice(-DECISIONS_MAX_MESSAGES).map(t=>t.slice(0,DECISIONS_MAX_CHARS));
 const questions:Question[]=[
  {name:'route',type:'choice',choices:choices('low','medium','high'),
   instructions:'Classify the entire member message window. low: closed small talk, logistics or app help only; medium: general health information; high: personal symptoms, results, medicines, clinical risk or urgency. Any clinical matter in the window wins.'},
  {name:'language',type:'choice',choices:choices('en','hy','hy-Latn','ru'),
   instructions:'What language is the newest member message written in? hy is Armenian script; hy-Latn is Armenian written in Latin letters. Identify the language, not the desired reply script.'}];
 if(window.length>1)questions.push({name:'topic',type:'choice',choices:choices('same','new'),
  instructions:'Does the newest member message continue or refer back to the earlier matter (same), including an acknowledgment, or start a different matter (new)?'});
 return {model:MODEL,input:JSON.stringify({memberMessages:window}),questions};
}

const probability=z.number().min(0).max(1);
const responseSchema=z.object({answers:z.array(z.object({name:z.string(),type:z.literal('choice'),choice:z.string(),
 probabilities:z.array(z.object({value:z.string(),probability})),confidence:probability}))});

/** Strict: anything that is not exactly the asked questions with the asked options is a bad shape. */
export function parseDecisionsResponse(raw:unknown,request:ReturnType<typeof buildDecisionsRequest>):DecisionsVerdict|null{
 const r=responseSchema.safeParse(raw);
 if(!r.success||r.data.answers.length!==request.questions.length)return null;
 const out:Record<string,{value:string;confidence:number}>={};
 for(const a of r.data.answers){
  const q=request.questions.find(q=>q.name===a.name);
  if(!q||out[a.name]||!q.choices.some(c=>c.value===a.choice))return null;
  out[a.name]={value:a.choice,confidence:a.confidence};
 }
 if(!out.route||!out.language)return null;
 return {route:out.route as DecisionsVerdict['route'],language:out.language as DecisionsVerdict['language'],...(out.topic?{topic:out.topic as NonNullable<DecisionsVerdict['topic']>}:{})};
}

/** One call. Never throws; `fetchImpl` is injected by checks. */
export async function askDecisions(texts:string[],env:Record<string,string|undefined>,opts:{fetchImpl?:typeof fetch;timeoutMs?:number;now?:()=>number}={}):Promise<DecisionsResult>{
 const now=opts.now??Date.now,t0=now(),limit=opts.timeoutMs??DECISIONS_TIMEOUT_MS;
 // The wait is bounded by this timer as well as by the request's own signal, so nothing a transport does can hold a run.
 let timer:ReturnType<typeof setTimeout>|undefined;
 const late=new Promise<DecisionsResult>(resolve=>{timer=setTimeout(()=>resolve({ok:false,reason:'timeout',latencyMs:Math.max(0,now()-t0)}),limit+100);});
 try{return await Promise.race([callDecisions(texts,env,opts,now,t0),late]);}finally{clearTimeout(timer);}
}

async function callDecisions(texts:string[],env:Record<string,string|undefined>,opts:{fetchImpl?:typeof fetch;timeoutMs?:number},now:()=>number,t0:number):Promise<DecisionsResult>{
 const request=buildDecisionsRequest(texts);
 const elapsed=()=>Math.max(0,now()-t0);
 let response:Response;
 try{
  response=await (opts.fetchImpl??fetch)(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY2??''}`},
   body:JSON.stringify(request),signal:AbortSignal.timeout(opts.timeoutMs??DECISIONS_TIMEOUT_MS)});
 }catch(e){return {ok:false,reason:e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError')?'timeout':'network',latencyMs:elapsed()};}
 if(!response.ok)return {ok:false,reason:'http_error',latencyMs:elapsed()};
 let raw:unknown;
 try{raw=await response.json();}catch(e){return {ok:false,reason:e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError')?'timeout':'bad_shape',latencyMs:elapsed()};}
 const verdict=parseDecisionsResponse(raw,request);
 const tokens=(raw as {usage?:{input_tokens?:unknown}}|null)?.usage?.input_tokens;
 return verdict?{ok:true,verdict,latencyMs:elapsed(),inputTokens:typeof tokens==='number'?tokens:0}:{ok:false,reason:'bad_shape',latencyMs:elapsed()};
}

/** What today's code decided on the same window, as plain labels. */
export type CurrentDecision={tier:DecisionsRoute;base:DecisionsRoute;language:string;replyLanguage:string|null;topic:'same'|'new'|'undecided'};

const route2=(t:DecisionsRoute)=>t==='high'?3:t==='medium'?2:1;
const topicOf=(c:CurrentDecision['topic'])=>c;

/** The shadow trace line: both answers as labels (no member text), whether they agree, and what Decisions would have changed. */
export function decisionsTraceEvent(r:DecisionsResult,current:CurrentDecision,effects:string[]=[]){
 const base={name:'zoe.route.decisions',rule:'zoe.decisions',ruleVersion:DECISIONS_VERSION,actor:'system'as const};
 const common={'noreon.zoe.decisions.latency_ms':r.latencyMs,'noreon.zoe.decisions.effects':effects.join(',')||'none','noreon.zoe.decisions.current_tier':current.tier,'noreon.zoe.decisions.current_base':current.base,
  'noreon.zoe.decisions.current_language':current.language,'noreon.zoe.decisions.current_topic':topicOf(current.topic)};
 if(!r.ok)return {...base,outcome:'skipped'as const,reason:`decisions_${r.reason}`,attributes:{'noreon.zoe.decisions.status':r.reason,...common}};
 const v=r.verdict;
 return {...base,outcome:'recorded'as const,reason:'decisions_shadow',attributes:{'noreon.zoe.decisions.status':'ok',...common,
  'noreon.zoe.decisions.tokens':r.inputTokens,
  'noreon.zoe.decisions.route':v.route.value,'noreon.zoe.decisions.route_confidence':v.route.confidence,
  'noreon.zoe.decisions.route_vs_tier':route2(v.route.value)>route2(current.tier)?'higher':route2(v.route.value)<route2(current.tier)?'lower':'same',
  'noreon.zoe.decisions.route_vs_base':route2(v.route.value)>route2(current.base)?'higher':route2(v.route.value)<route2(current.base)?'lower':'same',
  'noreon.zoe.decisions.language':v.language.value,'noreon.zoe.decisions.language_confidence':v.language.confidence,
  'noreon.zoe.decisions.language_agrees':v.language.value===current.language,
  ...(v.topic?{'noreon.zoe.decisions.topic':v.topic.value,'noreon.zoe.decisions.topic_confidence':v.topic.confidence,
   'noreon.zoe.decisions.topic_agrees':current.topic==='undecided'?'undecided':v.topic.value===current.topic}:{})}};
}

export const DECISIONS_MIN_CONFIDENCE=0.8;
export const DECISIONS_MIN_ROUTE_CONFIDENCE=0.5;
const TIER_ORDER:DecisionsRoute[]=['low','medium','high'];

/** Route, raise only: the higher of today's tier and Decisions' route. Never lowers; a weak answer changes nothing. */
export function raiseRoute(current:DecisionsRoute,v:DecisionsVerdict):{tier:DecisionsRoute;raised:boolean}{
 if(v.route.confidence<DECISIONS_MIN_ROUTE_CONFIDENCE)return {tier:current,raised:false};
 const tier=TIER_ORDER.indexOf(v.route.value)>TIER_ORDER.indexOf(current)?v.route.value:current;
 return {tier,raised:tier!==current};
}

/** Language: only English can become Armenian in Latin letters, and only on a confident answer. Nothing else is touched. */
export const languageToLatinArmenian=(current:string,v:DecisionsVerdict)=>current==='en'&&v.language.value==='hy-Latn'&&v.language.confidence>=DECISIONS_MIN_CONFIDENCE;

/** Topic: only a veto. "Same matter" keeps the whole window; a rule that said "new" is overruled, a rule that said "same" never is. */
export const topicKeepsWindow=(rulesSaid:'new'|'same'|'undecided',v:DecisionsVerdict)=>rulesSaid==='new'&&v.topic?.value==='same'&&v.topic.confidence>=DECISIONS_MIN_CONFIDENCE;
