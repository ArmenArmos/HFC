import {staffLocale} from '@/lib/staff/staff-locale';
import type {Locale} from '@/lib/locale';
import {staffDisplayText,staffRuleLabel} from '@/lib/staff/display-text';
import {Fragment} from 'react';
import Link from 'next/link';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {ZoeTrace} from '@/components/conversation/zoe-trace';
import type {ZoeRunDetail} from '@/lib/zoe/contracts';
import {zoeRunDetail} from '@/lib/zoe/admin';
import {readZoeWhy,type ZoeWhyView} from '@/lib/zoe/why-read';
import {actorText,conversationTraceSchema,outcomeLabel,traceReason,traceTitle,traceViewEnabled,type TraceEvent} from '@/lib/conversation-trace/contracts';
export const dynamic='force-dynamic';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const last=(events:TraceEvent[],pick:(e:TraceEvent)=>boolean)=>events.findLast(pick);

function Summary({events,locale}:{events:TraceEvent[];locale:Locale}){
 const intake=last(events,e=>e.name==='intake.processed'&&e.step==='intake');
 const ack=last(events,e=>e.name==='auto_ack.decided');
 const reply=last(events,e=>e.name.startsWith('delivery.'));
 const rows:[string,TraceEvent|undefined,string][]=[['Last incoming message',intake,'No incoming Telegram message yet.'],['Last acknowledgement decision',ack,'No acknowledgement decision yet.'],['Last doctor reply',reply,'No doctor reply has been approved yet.']];
 return <CareSection title="Why it replied, or not"><dl className="grid gap-4 md:grid-cols-3">{rows.map(([label,e,none])=><div key={label} className="space-y-1">
  <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
  <dd className="space-y-1 text-body2">{e?<><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{staffDisplayText(traceTitle(e),locale)}</span><Status tone={outcomeLabel[e.outcome].tone}>{outcomeLabel[e.outcome].label}</Status></span>{traceReason(e)&&<span className="block">Because {staffDisplayText(traceReason(e)??'',locale)}.</span>}<span className="block text-caption text-muted-foreground">{stamp(e.at,locale)}</span></>:none}</dd>
 </div>)}</dl></CareSection>;
}

export default async function TraceTimelinePage({params,searchParams}:{params:Promise<{memberId:string}>;searchParams:Promise<{run?:string|string[]}>}){
 if(!traceViewEnabled())notFound();
 const {memberId}=await params;
 if(!uuid.test(memberId))notFound();
 const {client}=await requireRealAdmin();
 const locale=await staffLocale('admin');
 let view:ReturnType<typeof conversationTraceSchema.parse>;
 try{const {data,error}=await client.rpc('conversation_trace',{p_member:memberId});if(error)throw Error('unavailable');view=conversationTraceSchema.parse(data);}
 catch(error){unstable_rethrow(error);return <CareSection title="Trace unavailable"><p className="text-body2">The timeline could not be loaded. Reload to try again.</p></CareSection>;}
 const run=(await searchParams).run;
 // Opening one run's why and its redacted input and output is an explicit, journaled admin action.
 let detail:ZoeRunDetail|null=null,why:ZoeWhyView|null=null;
 if(typeof run==='string'&&uuid.test(run)){
  detail=await zoeRunDetail(client,run,view.memberId).catch(error=>{unstable_rethrow(error);return null;});
  // The why stays out of a run that is not this member's: the detail above has already checked that.
  if(detail)why=await readZoeWhy(client,run).catch(error=>{unstable_rethrow(error);return null;});
 } return <div className="space-y-6">
  <header className="max-w-3xl space-y-2">
   <Link href={'/staff/real/trace' as Route} className="inline-flex min-h-11 items-center text-body2 underline underline-offset-4">All traced conversations</Link>
   <h1 className="text-h1">Trace: {view.memberName||'Member without a name'}</h1>
   <p className="text-body2 text-muted-foreground">Oldest first. Each row is one decision with the rule or guard that made it. Message and reply text is not shown; open the <Link href={`/staff/real/members/${view.memberId}` as Route} className="underline underline-offset-4">member page</Link> for what you can already see there.</p>
   <p className="text-caption text-muted-foreground">As of {stamp(view.asOf,locale)} · {view.events.length} {view.events.length===1?'event':'events'}{view.events.length>=300?' (latest 300)':''}</p></header>
  {!view.events.length?<CareSection title="Nothing recorded"><p className="text-body2">This member has no traced events.</p></CareSection>:<>
  <Summary events={view.events} locale={locale}/>
  <ZoeTrace memberId={view.memberId} events={view.events} detail={detail} why={why} locale={locale}/>
  <CareSection title="Timeline"><ol className="space-y-0 border-l-2 pl-4">{view.events.map(e=><li key={e.id} className="relative space-y-1 py-3">
   <span aria-hidden className="absolute -left-[1.4rem] top-5 size-2.5 rounded-full bg-border"/>
   <div className="flex flex-wrap items-center gap-2"><span className="text-body2 font-semibold">{staffDisplayText(traceTitle(e),locale)}</span><Status tone={outcomeLabel[e.outcome].tone}>{outcomeLabel[e.outcome].label}</Status></div>
   {traceReason(e)&&<p className="text-body2">Because {staffDisplayText(traceReason(e)??'',locale)}.</p>}
   <p className="text-caption text-muted-foreground">{stamp(e.at,locale)} · {actorText(e)}{e.rule?` · ${staffRuleLabel(e.rule,locale)}`:''}</p>
   {Object.keys(e.attributes).length>0&&<details className="text-caption"><summary className="min-h-11 cursor-pointer py-2 font-medium">Details</summary>
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 break-all font-mono text-muted-foreground"><dt>event</dt><dd>{e.name} #{e.id}</dd><dt>{e.subjectKind}</dt><dd>{e.subjectId}</dd>{Object.entries(e.attributes).map(([k,v])=><Fragment key={k}><dt>{staffDisplayText(k,locale)}</dt><dd>{staffDisplayText(typeof v==='object'&&v!==null?JSON.stringify(v):String(v),locale)}</dd></Fragment>)}</dl></details>}
  </li>)}</ol></CareSection></>}
 </div>;
}
