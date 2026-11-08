import type {Locale} from '@/lib/locale';
import {staffDisplayText,staffCodeLabel} from '@/lib/staff/display-text';
import Link from 'next/link';
import type {Route} from 'next';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import type {ZoeRunDetail} from '@/lib/zoe/contracts';
import {zoeWhySections} from '@/lib/zoe/why';
import type {ZoeWhyView} from '@/lib/zoe/why-read';
import {outcomeLabel,traceReason,traceTitle,type TraceEvent} from '@/lib/conversation-trace/contracts';


// "redact" means "not read" for Telegram media; for Zoe it means personal details were removed.
const badge=(e:TraceEvent)=>e.outcome==='redact'&&e.name==='zoe.guard.redaction'?{label:'Redacted',tone:'due'as const}:outcomeLabel[e.outcome];
const KEY_ATTRS=['noreon.zoe.tier','noreon.zoe.tier_rules','noreon.zoe.tier_unsure','noreon.zoe.route.model','noreon.zoe.route.fallback','noreon.zoe.fallback_used','gen_ai.provider.name','gen_ai.request.model','gen_ai.usage.input_tokens','gen_ai.usage.output_tokens','noreon.zoe.latency_ms','noreon.zoe.cost_usd','noreon.zoe.guard.categories','noreon.zoe.language','noreon.zoe.redaction.count','noreon.zoe.spent_today_usd','noreon.zoe.daily_cap_usd','noreon.zoe.tier_cap_usd','error.type'];

/** Zoe's pipeline grouped per member message: each guard, the model call and the result, in order. */
export function ZoeTrace({memberId,events,detail,why,locale='en'}:{locale?:Locale;memberId:string;events:TraceEvent[];detail:ZoeRunDetail|null;why:ZoeWhyView|null}){
 const runs=new Map<string,TraceEvent[]>();
 for(const e of events){const id=e.attributes['noreon.zoe.run.id'];if(typeof id==='string'&&e.name.startsWith('zoe.'))runs.set(id,[...(runs.get(id)??[]),e]);}
 if(!runs.size)return null;
 return <CareSection title="Zoe pipeline, per message" detail="Each member message Zoe handled: consent, urgent words, scope, redaction, spending cap, the AI call and the safety checks on its answer. Message text is not shown here.">
  <div className="space-y-6">{[...runs.entries()].reverse().map(([runId,steps])=>{
   const seq=steps[0]?.attributes['noreon.message.seq'];const result=steps.findLast(s=>s.name==='zoe.route');
   return <article key={runId} className="space-y-3 border-t pt-4">
    <header className="flex flex-wrap items-center gap-2"><h3 className="text-body1 font-semibold">Message {String(seq??'?')}</h3>{result&&<Status tone={outcomeLabel[result.outcome].tone}>{String(result.attributes['noreon.zoe.run.outcome']??result.outcome).replaceAll('_',' ')}</Status>}</header>
    <ol className="space-y-2">{steps.map(e=><li key={e.id} className="text-body2">
     <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{staffDisplayText(traceTitle(e),locale)}</span><Status tone={badge(e).tone}>{badge(e).label}</Status></span>
     {traceReason(e)&&<span className="block">Because {staffDisplayText(traceReason(e)??'',locale)}.</span>}
     <span className="block break-all font-mono text-caption text-muted-foreground">{e.rule?staffCodeLabel(e.rule,locale):''}{KEY_ATTRS.filter(k=>k in e.attributes).map(k=>` · ${staffDisplayText(k,locale)}=${staffDisplayText(String(e.attributes[k]),locale)}`).join('')}</span>
    </li>)}</ol>
    {detail?.id===runId?<><RunWhy why={why} locale={locale}/><RunIo detail={detail} locale={locale}/></>:<Link href={`/staff/real/trace/${memberId}?run=${runId}` as Route} className="inline-flex min-h-11 items-center text-body2 underline underline-offset-4">Open why Zoe did this, and the redacted AI input and output (this is recorded)</Link>}
    <p className="text-caption text-muted-foreground">{steps[0]?stamp(steps[0].at,locale):''} · run {runId}</p>
   </article>;})}</div>
 </CareSection>;
}

/** The run's saved why: what was recorded then, never worked out again from today's data. */
function RunWhy({why,locale}:{why:ZoeWhyView|null;locale:Locale}){
 if(!why)return <p className="text-body2">The why record could not be loaded.</p>;
 return <section className="space-y-3 rounded-lg border bg-muted/30 p-3" aria-label="Why Zoe did this">
  <header className="space-y-1"><h4 className="text-body1 font-semibold">Why Zoe did this</h4><p className="text-caption text-muted-foreground">{why.label}</p>
   {why.run.reason&&why.why&&why.run.reason!==why.why.reply.reason&&<p className="text-caption text-muted-foreground">The run finally ended as {staffDisplayText(why.run.reason,locale)}.</p>}</header>
  {why.status==='missing'?<p className="text-body2">No why record was saved for this run.</p>
   :!why.why?<p className="text-body2">This why record cannot be read by this version of the app.</p>
   :<dl className="space-y-3">{zoeWhySections(why.why).map(s=><div key={s.title} className="space-y-1">
    <dt className="text-body2 font-semibold">{staffDisplayText(s.title,locale)}</dt>
    <dd><ul className="space-y-0.5 break-words text-body2">{s.lines.map((l,i)=><li key={i}>{staffDisplayText(l,locale)}</li>)}</ul></dd>
   </div>)}</dl>}
 </section>;
}

function RunIo({detail,locale}:{detail:ZoeRunDetail;locale:Locale}){
 const meta=`tier ${detail.tier??'none'} (${detail.tierReason??'not routed'})${detail.fallbackUsed?' · fallback used':''} · ${detail.provider??'none'} · ${detail.model??'none'} · ${detail.inputTokens??0} in / ${detail.outputTokens??0} out tokens · US$${detail.costUsd??0} · ${detail.latencyMs??0} ms · config ${detail.configVersion??'unknown'}`;
 return <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
  <p className="break-all text-caption text-muted-foreground">{staffDisplayText(meta,locale)}</p>
  {detail.io==='not_stored'?<p className="text-body2">The AI input and output were not stored for this run.</p>
   :detail.io==='key_unavailable'?<p className="text-body2">The stored input and output cannot be opened with the current key.</p>
   :<><p className="text-body2 font-semibold">AI input, after redaction</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-caption">{staffDisplayText(detail.io.memberBlock,locale)}</pre>
    <p className="text-body2 font-semibold">AI output, after redaction</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-caption">{staffDisplayText(detail.io.response??'No output.',locale)}</pre>
    {detail.io.judgeMalformed!==undefined&&<><p className="text-body2 font-semibold">Safety check reply that could not be read (first 200 characters)</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption">{staffDisplayText(detail.io.judgeMalformed,locale)}</pre></>}</>}
 </div>;
}
