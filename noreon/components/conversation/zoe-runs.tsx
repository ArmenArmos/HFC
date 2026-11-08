import type {Locale} from '@/lib/locale';
import {staffDisplayText} from '@/lib/staff/display-text';
import {Bot} from 'lucide-react';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {zoeGuardReasonText,zoeReasonText,zoeRunLabel,type ZoeRunView} from '@/lib/zoe/contracts';

/** Zoe's recent work on this conversation, for the assigned doctor. Read-only. Zoe sends only her own guarded logistics answers, shown here. */
export function ZoeRuns({runs,audience='doctor',locale='en'}:{locale?:Locale;runs:ZoeRunView[]|null;audience?:'doctor'|'admin'}){
 if(runs===null)return <CareSection title="Zoe, AI assistant"><p className="text-body2">Zoe’s results could not be loaded. Your messages and drafts below are unaffected.</p></CareSection>;
 if(!runs.length)return null;
 return <CareSection title="Zoe, AI assistant" detail={audience==='admin'?'What Zoe did with the newest messages, with the safety checks she ran. The assigned doctor approves every reply about health.':'What Zoe did with the newest messages. Zoe answers only questions about logistics and using the app, shown below; you approve every reply about health.'}>
  <ol className="space-y-4">{runs.map(run=><li key={run.id} className="space-y-2 border-l-2 border-primary/20 pl-4">
   <p className="flex flex-wrap items-center gap-2"><Bot className="size-4 shrink-0" aria-hidden/><span className="text-body2 font-semibold">{zoeRunLabel(run).label}</span><Status tone={zoeRunLabel(run).tone}>Message {run.messageSeq}</Status></p>
   {run.draftState!=='superseded'&&run.draftCurrent!==false&&zoeReasonText(run.reason)&&<p className="text-body2">Because {zoeReasonText(run.reason)}.</p>}
   {run.guardReasons.length>0&&<p className="text-body2">Safety checks found: {run.guardReasons.map(zoeGuardReasonText).join('; ')}.</p>}
   {run.answer&&<div className="space-y-1"><p className="text-caption font-medium text-muted-foreground">Zoe’s answer, sent to the member</p><p className="whitespace-pre-wrap text-body2 [overflow-wrap:anywhere]">{staffDisplayText(run.answer,locale)}</p></div>}
   {run.summary&&<div className="space-y-1"><p className="text-caption font-medium text-muted-foreground">AI summary: check it against the member’s messages</p><p className="whitespace-pre-wrap text-body2 [overflow-wrap:anywhere]">{staffDisplayText(run.summary,locale)}</p></div>}
   <p className="text-caption text-muted-foreground">{stamp(run.finishedAt,locale)}{run.provider==='noreon.fake'?' · test provider, not a real model':''}</p>
  </li>)}</ol>
 </CareSection>;
}
