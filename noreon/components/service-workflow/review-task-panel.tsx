'use client';
import {useState,useTransition} from 'react';
import type {ReviewTask} from '@/lib/service-workflow/review-task';
import {completeReviewNoChange} from '@/lib/staff/review-actions';
import {stamp} from '@/components/patient-care/common';
export function ReviewTaskPanel({task,caseId,caseRevision,evidenceRevision,blockedReason,refresh}:{task:ReviewTask;caseId:string;caseRevision:number;evidenceRevision:number;blockedReason:string;refresh:()=>Promise<boolean>}) {
  const [note,setNote]=useState('');
  const [message,setMessage]=useState('');
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const [pending,start]=useTransition();
  const [activeAction,setActiveAction]=useState<'complete'|'refresh'|null>(null);
  return <section className="space-y-3 rounded-xl border bg-background p-5">
    <h2 className="text-h3 font-semibold">Review pending</h2>
    <p className="text-body2">Opened {stamp(task.openedAt,'en')}. Review the changed evidence and record an outcome. The existing approved plan remains available.</p>
    <p className="text-caption text-muted-foreground">{task.ownerId ? 'Owned by the assigned doctor.' : 'A doctor must be assigned.'} Evidence revision {task.targetEvidenceRevision}.</p>
    {blockedReason && <p className="text-body2">{blockedReason}</p>}
    <label className="block space-y-2 text-body2"><span>Reason the approved plan needs no change</span><textarea className="min-h-24 w-full rounded-md border bg-background p-3" value={note} maxLength={1500} disabled={pending} onChange={e=>setNote(e.target.value)} /></label>
    <button type="button" className="min-h-11 rounded-md border px-4 text-body2 font-semibold" aria-busy={pending&&activeAction==='complete'} disabled={pending||!!blockedReason||needsRefresh||!note.trim()} onClick={()=>{setActiveAction('complete');start(async()=>{
      setMessage('');
      try {
        const result=await completeReviewNoChange({caseId,taskId:task.id,caseRevision,evidenceRevision,note});
        if (!result.ok) {setMessage(result.error??'Review was not completed.');setNeedsRefresh(true);return;}
        setNeedsRefresh(true);setMessage('Review completed. Refreshing the case…');
        try {
          if (!await refresh()) setMessage('Review completed, but the updated case could not be loaded. Refresh to confirm its status.');
        } catch {setMessage('Review completed, but the updated case could not be loaded. Refresh to confirm its status.');}
      } catch {setMessage('The response could not be confirmed. Refresh the case before trying again. Your note is retained.');setNeedsRefresh(true);}
    });}}>{pending&&activeAction==='complete'?'Completing review…':'Reviewed, no plan change'}</button>
    {message && <p role="status" className="text-body2">{message}</p>}
    {needsRefresh && <button type="button" className="min-h-11 rounded-md border px-4 text-body2" aria-busy={pending&&activeAction==='refresh'} disabled={pending} onClick={()=>{setActiveAction('refresh');start(async()=>{try {if(await refresh()){setNeedsRefresh(false);setMessage('Case refreshed. Review the current evidence before submitting again.');}}catch {setMessage('The case could not be refreshed. Your note is retained.');}});}}>{pending&&activeAction==='refresh'?'Refreshing case…':'Refresh current case'}</button>}
  </section>;
}
export function ReviewTaskHistory({tasks}:{tasks:ReviewTask[]}) {
  const completed=tasks.filter(t=>t.status==='completed');
  if (!completed.length) return null;
  return <section className="mt-6 space-y-3 rounded-xl border bg-background p-5"><h2 className="text-h3 font-semibold">Completed reviews</h2><ol className="divide-y">{completed.map(t=><li key={t.id} className="space-y-1 py-3"><p className="text-body2 font-semibold">{t.outcome==='published'?'Plan published':'Reviewed, no plan change'}</p><p className="text-caption">{t.completedAt ? stamp(t.completedAt,'en') : 'Time unknown'} · Reviewed evidence revision {t.completedEvidenceRevision}</p><p className="text-caption text-muted-foreground">Reviewer: {t.completedByLabel??'Name not recorded'}</p>{t.completionNote&&<p className="whitespace-pre-wrap text-body2">{t.completionNote}</p>}</li>)}</ol></section>;
}
