import {costUsd,type ProviderResult,type ProviderUsage,type ZoeProvider} from '@/lib/zoe/provider';
import {nameTokens} from '@/lib/zoe/redact';
import {FAST_PRICE_MULTIPLIER,fastAvailable} from '@/lib/zoe/gateway';
import {answerSchema,ROLE_TOOLS,STAFF_ZOE_PROMPT_VERSION,STAFF_ZOE_VERSION,type Answer,type AnswerContent,type AskRequest,type BeginResult,type L,type Quote,type StaffZoeRole,type StreamEvent,type ToolId,type ToolResult} from './contracts';
import {checkRendered,checkSelection,CHECK_VERSION,factLine,turnIndex,type CheckProblem} from './check';
import {generalLabQuestion,guardAnalytes,namedAnalytes} from './analyte';
import {emptyResult,isIncompleteAlertFact} from './facts';
import {smallTalk,smallTalkLines} from './small-talk';
import {asksSend,gapLines,keptQuotes,lastReviewed,noticeLines,openWithUnreviewed,redLineOf} from './limits';
import {asksLdl,asksMessages,asksSummary,notices,planTools,questionBlock,recordBlock,staffSystemPrompt,summaryTurn,wantedTools} from './prompt';

/**
 * One staff turn. Reads as the staff user, shows the cards, then asks the model, checks what it wrote and keeps the
 * result. Nothing in here can write to a member: there is no member port. A held or failed answer still leaves the
 * cards, which code built from the reads, so the doctor always gets the record.
 *
 * At most 3 billable attempts in all (an error retry, a read it asked for, a correction), inside one time budget. Each attempt
 * is counted; a failed attempt with unknown usage leaves the cost unset, so the reservation stands in for it.
 */
export class AccessLost extends Error{constructor(){super('Member access required');this.name='AccessLost';}}
export const TURN_BUDGET_MS=45_000;
export const MAX_OUTPUT_TOKENS=1200;
/** Every billable attempt of a turn: a retry, a fallback, a read the model asked for, a correction. */
export const MAX_ATTEMPTS=3;
/**
 * The input an attempt may send, in UTF-8 bytes, and the reservation pays for one token per byte: a tokenizer spends at least
 * a byte on a token, so token-dense text cannot run past it, whatever the script (Astra DZ-04b). An attempt over the allowance
 * is never made, so a read the model asks for cannot outgrow what was reserved. The count holds the system prompt and the
 * prompt, plus what the Gateway adapter adds to it and the request's framing, GATEWAY_ADDED_BYTES.
 */
export const INPUT_ALLOWANCE_BYTES=24_000;
export const GATEWAY_ADDED_BYTES=256;
const bytes=(t:string)=>new TextEncoder().encode(t).length;
export const inputBytes=(system:string,block:string)=>bytes(system)+bytes(block)+GATEWAY_ADDED_BYTES;

export type FinishInput={state:AnswerContent['state'];reason:string|null;body:string;content:AnswerContent;provider:string|null;model:string|null;promptVersion:string;
 /** Null: an attempt's usage is unknown, so the reservation stays as the cost. */costUsd:number|null;
 usage:ProviderUsage|null;latencyMs:number;tools:ToolId[];checks:Record<string,unknown>;why:Record<string,unknown>;sealedIo:string|null};
export type ModelSet={primary:ZoeProvider;fallback:ZoeProvider|null;fast:boolean;effort:'none'|'low'|'medium'|'high'|null}|null;
export type TurnPorts={
 begin:(req:AskRequest)=>Promise<BeginResult>;
 /** Gate, then read: as the staff user, every time. Throws AccessLost when the gate refuses. */
 read:(tool:ToolId,run:{runId:string;memberId:string;role:StaffZoeRole})=>Promise<ToolResult>;
 models:(tier:'low'|'medium'|'high')=>Promise<ModelSet>;
 reserve:(runId:string,estimateUsd:number,local:boolean,tier:string,model:string)=>Promise<{ok:true}|{ok:false;code:string}>;
 finish:(runId:string,input:FinishInput)=>Promise<void>;
 seal:(plain:{memberBlock:string;response:string|null})=>string|null;
 now:()=>number;
};

const parse=(raw:string):Answer|null=>{let v:unknown;try{v=JSON.parse(raw);}catch{return null;}const a=answerSchema.safeParse(v);return a.success?a.data:null;};
const toBody=(c:AnswerContent)=>[...c.say.map(l=>l.text),...(c.notice?[c.notice]:[]),...(c.say.length||c.notice?[]:['-'])].join('\n').slice(0,8000);

type Attempt={result:ProviderResult;provider:ZoeProvider;fast:boolean};
/** The attempt plan of one call: fast endpoint, then the same model standard, then the tier's fallback. */
const attemptsOf=(set:NonNullable<ModelSet>)=>[...(set.fast&&fastAvailable(set.primary.requestModel)?[{p:set.primary,fast:true}]:[]),{p:set.primary,fast:false},...(set.fallback?[{p:set.fallback,fast:false}]:[])];
/** The dearest attempt a turn can make, per million tokens, so the reservation is a true ceiling (Astra DZ-04). */
const priceCeiling=(set:NonNullable<ModelSet>)=>{const a=attemptsOf(set).map(x=>({i:x.p.pricing.inputUsdPerMTok*(x.fast?FAST_PRICE_MULTIPLIER:1),o:x.p.pricing.outputUsdPerMTok*(x.fast?FAST_PRICE_MULTIPLIER:1)}));return {inputUsdPerMTok:Math.max(...a.map(x=>x.i)),outputUsdPerMTok:Math.max(...a.map(x=>x.o)),label:'ceiling'};};

const problemNote=(ps:readonly CheckProblem[])=>[...new Set(ps.map(p=>`${p.code}: ${p.detail}`))].slice(0,10).join('; ');

export async function* runStaffTurn(req:AskRequest,locale:L,ports:TurnPorts):AsyncGenerator<StreamEvent,void,void>{
 const started=ports.now();
 let begun:BeginResult;
 try{begun=await ports.begin(req);}catch(error){yield {type:'refused',code:error instanceof AccessLost?'access':'unavailable'};return;}
 if(!begun.ok){yield {type:'refused',code:begun.code==='off'||begun.code==='busy'||begun.code==='replayed'||begun.code==='invalid'?begun.code:'unavailable'};return;}
 const run={runId:begun.runId,memberId:begun.memberId,role:begun.role};
 const results=new Map<ToolId,ToolResult>();
 // The doctor's lipid plan comes with the LDL record, as a card only: `list` is what the model reads, `shown` is what the staff member sees.
 let planCard:ToolResult|null=null,planRead=false;
 const readTool=async(tool:ToolId)=>{try{return await ports.read(tool,run);}catch(e){if(e instanceof AccessLost)throw e;return emptyResult(tool,'unavailable',run.memberId,run.role);}};
 const read=async(ids:readonly ToolId[])=>{const out=await Promise.all(ids.filter(id=>!results.has(id)).map(readTool));for(const r of out)results.set(r.tool,r);
  if(!planRead&&run.role==='doctor'&&results.get('ldl')?.state==='ok'){planRead=true;const r=await readTool('lipid_plan');if(r.state==='ok')planCard=r;}
  const needsWords=req.intent==='summary'||asksSummary(req.text)||req.intent==='messages'||asksMessages(req.text)||list().some(r=>r.facts.some(f=>f.urgent));
  if(needsWords&&!results.has('member_messages')&&ROLE_TOOLS[run.role].includes('member_messages')){
   const words=await readTool('member_messages');results.set(words.tool,words);
  }};
 const list=()=>[...results.values()];
 // Monika, 2 Nov: a plain summary gives the member's notes as a count with a link. Their words show when an urgent alert is open,
 // when the question is about what they wrote, or when a message tried to steer Zoe (limits.keptQuotes).
 const urgentFacts=()=>list().flatMap(r=>r.facts).filter(f=>f.urgent);
 // The cut-short warning leads the answer but is no open alert of this member, so it does not bring the member's words.
 const memberAlerts=()=>urgentFacts().filter(f=>!isIncompleteAlertFact(f));
 const memberQuote=(q:Quote)=>q.nurseName===undefined&&!q.zoe&&!q.id.startsWith('zoe_why.');
 const steered=()=>list().some(r=>r.tool==='member_messages'&&r.quotes.some(q=>memberQuote(q)&&q.flagged));
 const notesOnly=()=>summaryTurn(req.text,req.intent)&&!steered()&&!memberAlerts().length;
 const withoutNotes=(cards:ToolResult[])=>notesOnly()?cards.map(c=>({...c,quotes:c.quotes.filter(q=>!memberQuote(q))})):cards;
 const shown=()=>withoutNotes(planCard?[...list(),planCard]:list());
 const recentQuotes=()=>{
  if(!memberAlerts().length&&req.intent!=='messages'&&!asksMessages(req.text))return [];
  const recent=(results.get('member_messages')?.quotes??[])
   .filter(q=>q.nurseName===undefined&&q.at&&Date.parse(q.at)<=started&&Date.parse(q.at)>=started-24*60*60*1000)
   .sort((a,b)=>Date.parse(b.at!)-Date.parse(a.at!));
  return [...recent.filter(memberQuote).slice(0,3),...recent.filter(q=>q.zoe).slice(0,2)];
 };
 const notPermitted=(t:ToolId)=>emptyResult(t,'not_permitted',run.memberId,run.role);
 let provider:string|null=null,model:string|null=null,cost=0,calls=0,unknownCost=false;
 const attempted:string[]=[];
 const usage:ProviderUsage={inputTokens:0,outputTokens:0};
 let sealedResponse:string|null=null,lastBlock='';
 // The plan is worked out on each read and stored nowhere: a saved answer keeps no plan card, so switching it off leaves none in the history.
 const finish=async(shownContent:AnswerContent,reason:string|null,checks:Record<string,unknown>)=>{
  const content={...shownContent,cards:shownContent.cards.filter(c=>c.tool!=='lipid_plan')};
  const cited=content.say.flatMap(l=>l.facts.map(f=>f.id));
  await ports.finish(run.runId,{state:content.state,reason,body:toBody(content),content,provider,model,promptVersion:STAFF_ZOE_PROMPT_VERSION,costUsd:unknownCost?null:cost,usage:calls?usage:null,latencyMs:Math.max(0,Math.round(ports.now()-started)),tools:[...results.keys()],checks,
   // The why record of this answer, the same shape the zoe-why lane stores for member runs plus the two staff fields (FABLE_PLAN §3.7).
   why:{v:1,version:STAFF_ZOE_VERSION,tools_called:[...results.keys()],facts_cited:[...new Set(cited)],quotes_shown:content.quotes.map(q=>q.id),numbers_verified:checks.numbers??0,check:CHECK_VERSION,attempts:attempted,reason},
   sealedIo:calls&&lastBlock?ports.seal({memberBlock:lastBlock,response:sealedResponse}):null});
 };
 const base=(state:AnswerContent['state'],extra:Partial<AnswerContent>={}):AnswerContent=>({version:STAFF_ZOE_VERSION,state,say:[],quotes:[],notKnown:[],declined:false,notice:null,cards:shown(),...extra});
 const refuse=async function*():AsyncGenerator<StreamEvent,void,void>{
  results.clear();planCard=null;lastBlock='';sealedResponse=null;
  await finish(base('refused',{cards:[],notice:notices.refused[locale]}),'access',{}).catch(()=>{});yield {type:'refused',code:'access'};
 };

 const end=async function*(state:'no_answer'|'held',reason:string,notice:string,checks:Record<string,unknown>={}):AsyncGenerator<StreamEvent,void,void>{
  // Model failure cannot hide urgency that code has already read. Access refusal uses its own empty answer.
  const say=urgentFacts().map(f=>({text:factLine(f),facts:[f]}));
  const required=checkRendered(say,list());
  const content=base(state,{notice,say:required.ok?say:[],quotes:recentQuotes(),notKnown:list().flatMap(r=>r.missing)});
  await finish(content,reason,{version:CHECK_VERSION,...checks,numbers:required.numbers,lines:required.lines,required});yield {type:'answer',content};
 };

 // A greeting, "can you talk", "what can you do", thanks or goodbye is no question about a record: fixed words, no record read, no model call.
 const talk=req.intent===null?smallTalk(req.text):null;
 if(talk){
  const content=base('answered',{say:smallTalkLines(talk,run.role,locale).map(text=>({text,facts:[]})),cards:[]});
  await finish(content,'small_talk',{version:CHECK_VERSION,smallTalk:talk});yield {type:'answer',content};return;
 }
 try{await read(planTools(req.text,req.intent,run.role,begun.lastTools));
  for(const t of wantedTools(req.text,req.intent,begun.lastTools))if(!results.has(t))results.set(t,notPermitted(t));}
 catch(error){if(error instanceof AccessLost){yield* refuse();return;}yield* end('no_answer','read_failed',notices.no_answer[locale]);return;}
 yield {type:'cards',cards:shown()};

 const set=await ports.models(begun.tier).catch(()=>null);
 if(!set){yield* end('no_answer','no_provider',notices.no_answer[locale]);return;}
 const names=nameTokens(begun.memberName);
 const system=staffSystemPrompt(run.role);
 const question=questionBlock(req.text,begun.history,begun.memberName);
 // The spend ceiling of the turn: every attempt at the full output limit, at the dearest price an attempt can have.
 const estimate=costUsd(priceCeiling(set),{inputTokens:INPUT_ALLOWANCE_BYTES*MAX_ATTEMPTS,outputTokens:MAX_OUTPUT_TOKENS*MAX_ATTEMPTS});
 const reserved=await ports.reserve(run.runId,set.primary.local?0:estimate,set.primary.local,begun.tier,set.primary.requestModel).catch(()=>({ok:false as const,code:'reserve_failed'}));
 if(!reserved.ok){const capped=/cap_reached/.test(reserved.code);yield* end('no_answer',reserved.code,capped?notices.cap[locale]:notices.no_answer[locale]);return;}
 provider=set.primary.providerName;model=set.primary.requestModel;

 let correction:string|null=null,previous:string|null=null,answer:Answer|null=null,lastProblems:CheckProblem[]=[],reason='no_output';
 const plan=attemptsOf(set);let step=0;
 const account=(r:Attempt)=>{
  attempted.push(`${r.provider.requestModel}${r.fast?':fast':''}:${r.result.kind}`);
  // The Gateway adapter reports a missing count as 0, and no real call used 0 tokens: unknown, so the reservation stands.
  const u=r.result.usage;
  if(u&&u.inputTokens>0&&u.outputTokens>0){usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;cost+=costUsd(r.provider.pricing,u)*(r.fast?FAST_PRICE_MULTIPLIER:1);}
  else if(!r.provider.local)unknownCost=true;
  provider=r.provider.providerName;if(r.result.kind!=='error')model=r.result.responseModel||r.provider.requestModel;
 };
 try{
  while(calls<MAX_ATTEMPTS&&ports.now()-started<TURN_BUDGET_MS-1500){
   const block=[recordBlock(list(),names),question,...(correction?[`<correction>Your last answer was not used: ${correction.replaceAll('<','&lt;')}. Return the exact JSON object, with ids that are in <record>.</correction>`]:[]),...(previous?[`<last_answer>${previous.replaceAll('<','&lt;').slice(0,1000)}</last_answer>`]:[])].join('\n');
   if(!set.primary.local&&inputBytes(system,block)>INPUT_ALLOWANCE_BYTES){reason='input_over_allowance';break;}
   lastBlock=block;calls++;
   const a=plan[step]!;
   const result=await a.p.complete({purpose:'staff_answer',promptVersion:STAFF_ZOE_PROMPT_VERSION,system,memberBlock:block,replyLanguage:locale,maxOutputTokens:MAX_OUTPUT_TOKENS,timeoutMs:Math.max(1500,TURN_BUDGET_MS-(ports.now()-started)),...(set.effort?{effort:set.effort}:{}),...(a.fast?{fast:true}:{})});
   account({result,provider:a.p,fast:a.fast});
   if(result.kind==='error'){reason=`provider_${result.errorClass}`;if(++step>=plan.length)break;continue;}
   if(result.kind==='refusal'){reason='refusal';break;}
   sealedResponse=result.raw;
   const parsed=parse(result.raw);
   if(!parsed){reason='schema_invalid';previous=result.raw;correction='The output was not the exact JSON object asked for.';continue;}
   const wanted=parsed.need.filter(t=>!results.has(t));
   if(wanted.length&&!correction&&calls<MAX_ATTEMPTS){
    await read(wanted.filter(t=>ROLE_TOOLS[run.role].includes(t)));
    for(const t of wanted)if(!results.has(t))results.set(t,notPermitted(t));
    yield {type:'cards',cards:shown()};continue;
   }
   const problems=checkSelection(parsed,turnIndex(list()));
   if(!problems.length){answer=parsed;break;}
   lastProblems=problems;reason='check_failed';previous=result.raw;correction=problemNote(problems);
  }
 }catch(error){
  if(error instanceof AccessLost){yield* refuse();return;}
  reason='turn_error';
 }
 const unshown=reason==='check_failed'||reason==='schema_invalid';
 if(!answer){yield* end(unshown?'held':'no_answer',reason,unshown?notices.held[locale]:notices.no_answer[locale],{version:CHECK_VERSION,problems:lastProblems.slice(0,20),attempts:attempted});return;}
 const index=turnIndex(list());
 // Code writes every line, from the fact. The last check runs on these exact lines.
 // A question that names a lab value is answered only by facts of that value (guardAnalytes); otherwise it is not known.
 const named=namedAnalytes(req.text);
 const guarded=guardAnalytes([...new Set(answer.facts)].map(id=>index.facts.get(id)!),{named,general:req.intent!==null||asksSummary(req.text)||generalLabQuestion(req.text),ldl:asksLdl(req.text)});
 const summary=req.intent==='summary'||asksSummary(req.text);
 const reviewed=lastReviewed(guarded.unanswered,list());
 const selected=openWithUnreviewed([...guarded.facts,...reviewed.facts],list(),{summary,named,ldl:asksLdl(req.text)});
 // open_items transcribes alerts newest first. Required urgency precedes all model picks and lab guards.
 const urgent=urgentFacts();
 const say=[...new Map([...urgent,...selected].map(f=>[f.id,f])).values()].map(f=>({text:factLine(f),facts:[f]}));
 // A value on screen, reviewed or not, is not also denied.
 const missingValues=reviewed.unanswered.filter(n=>!say.some(l=>l.facts[0]!.analyte===n));
 const verified=checkRendered(say,list());
 const checks={version:CHECK_VERSION,numbers:verified.numbers,lines:verified.lines,problems:verified.problems.slice(0,20),attempts:attempted,analytes:{named,dropped:guarded.dropped,unanswered:guarded.unanswered}};
 if(!verified.ok){yield* end('held','check_failed',notices.held[locale],checks);return;}
 const pickedQuotes=keptQuotes([...new Set(answer.quotes)].map(id=>index.quotes.get(id)!),list(),!asksSend(req.text)&&(summary||req.intent==='messages'||asksMessages(req.text)));
 const recent=recentQuotes();
 // At most two of Zoe's replies, newest first, from the last 24 hours, however they were selected.
 const zoeShown=new Set([...new Map([...recent,...pickedQuotes].map(q=>[q.id,q])).values()].filter(q=>q.zoe&&q.at&&Date.parse(q.at)<=started&&Date.parse(q.at)>=started-24*60*60*1000)
  .sort((a,b)=>Date.parse(b.at!)-Date.parse(a.at!)).slice(0,2).map(q=>q.id));
 const quotes=[...new Map([...pickedQuotes.filter(q=>!q.zoe),...recent,...pickedQuotes.filter(q=>q.zoe)].map(q=>[q.id,q])).values()].filter(q=>!q.zoe||zoeShown.has(q.id)).filter(q=>!notesOnly()||!memberQuote(q));
 const notes=notesOnly()||(summaryTurn(req.text,req.intent)&&steered())?results.get('member_messages'):undefined;
 const memberNotes=notes?.messageCount?{count:notes.messageCount,flagged:notes.flaggedCount??0,href:notes.href}:null;
 const line=redLineOf(req.text);
 const gaps=list().flatMap(r=>r.missing);
 const content=base('answered',{say,quotes,notKnown:[...gapLines(req.text,missingValues,line==='clearance'||(!asksSend(req.text)&&(missingValues.length||answer.not_known||(!say.length&&!quotes.length)))?notices.not_known[locale]:null,locale),...gaps].slice(0,10),declined:answer.declined||line!==null,memberNotes,notice:[...noticeLines(req.text,say.flatMap(l=>l.facts),locale),...(set.primary.local?[notices.stand_in[locale]]:[])].join(' ')||null});
 await finish(content,null,checks);
 yield {type:'answer',content};
}
