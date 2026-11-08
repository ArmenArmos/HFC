import type {DemoState} from '@/lib/patient/demo-model';
import type {ServicePublication} from './types';
import {evidenceProjection} from './evidence';
import {advanceReviewTask,completeReviewTask} from './review-task';
/** Browser-held reports are deliberately outside this cookie-held task. */
export function reconcileLocalReview(previous:DemoState|null,next:DemoState,at:string,id:string) {
  const w=next.workflow;
  if (!w) return;
  const tasks=structuredClone(previous?.reviewTasks??next.reviewTasks??[]);
  const oldProjection=previous ? JSON.parse(evidenceProjection(previous)) : {};
  const newProjection=JSON.parse(evidenceProjection(next));
  const kinds=Object.keys(newProjection).filter(k=>JSON.stringify(oldProjection[k])!==JSON.stringify(newProjection[k]));
  if (previous && kinds.length) w.evidenceRevision=Math.max(w.evidenceRevision??0,(previous.workflow?.evidenceRevision??0)+1);
  const reset=!!previous?.workflow?.publication&&!w.publication;
  const publishing=!!w.publication&&w.publication.at!==previous?.workflow?.publication?.at;
  const opens=kinds.some(k=>k!=='measurements'&&k!=='profile')
    || oldProjection.profile?.birthDate!==newProjection.profile?.birthDate
    || oldProjection.profile?.biologicalSex!==newProjection.profile?.biologicalSex;
  const eligible=!!next.state.assessment?.completedAt||!!w.publication;
  const current=tasks.find(t=>t.status==='open')??null;
  const task=advanceReviewTask(current,{id,revision:w.evidenceRevision??0,ownerId:w.assignedDoctorId||null,at,
    opensTask:reset||publishing||(eligible&&opens),reason:reset?'workflow.reset':publishing?'publication':'evidence'});
  if (task) {
    const result=publishing ? completeReviewTask(task,{revision:w.evidenceRevision??0,actorId:w.assignedDoctorId,
      actorLabel:w.publication!.doctor,at,outcome:'published',note:''}) : task;
    const index=tasks.findIndex(t=>t.id===result.id);
    if (index<0) tasks.push(result);else tasks[index]=result;
  }
  next.reviewTasks=tasks;
}
export function localReportReviewStatus(publication:ServicePublication|null,session:string,revision:number) {
  if (!publication) return 'initial' as const;
  const baseline=publication.localReportBaseline;
  if (!baseline||baseline.session!==session) return 'unavailable' as const;
  return baseline.revision===revision?'unchanged' as const:'changed' as const;
}
