export type AcceptedReading = {
  id:string;case_id:string;submission_id:string;measured_at:string;accepted_at:string;
  systolic:number;diastolic:number;pulse:number|null;
};
export type MonitoringRequirement = {
  id:string;case_id:string;created_at:string;starts_at:string;ends_at:string;
  required_count:number;instructions:string;status:'active'|'cancelled'|'superseded';
  actor_id:string|null;actor_label:string;acknowledged_at:string|null;revision:number;
  source_publication:number;current_publication:number;
};
export type FollowupWork = {requirement_id:string;case_id:string;status:'open'|'fulfilled'|'cancelled'|'superseded';due_at:string;resolved_at:string|null};
export type FollowupEvent = {id:number;requirement_id:string;kind:string;actor_label:string;note:string|null;created_at:string};
export type FollowupReviewLink = {requirement_id:string;review_task_id:string;event:'window-ended'|'referred';created_at:string};
export type MonitoringDecision = {requirement_id:string;decision:'retain'|'supersede';evidence_revision:number;publication_version:number;draft:unknown};
export type MonitoringEvidence={requirement_id:string;reading_id:string;late:boolean};
export type MonitoringSnapshot={evidence:MonitoringEvidence[];requirements:MonitoringRequirement[];readings:AcceptedReading[];work:FollowupWork[];events:FollowupEvent[];links:FollowupReviewLink[];decisions:MonitoringDecision[]};
export const emptyMonitoring:MonitoringSnapshot={evidence:[],requirements:[],readings:[],work:[],events:[],links:[],decisions:[]};
/** Counts receipt only. No blood-pressure interpretation or clinical cadence. */
export function qualifyingReadings(requirement:MonitoringRequirement,readings:AcceptedReading[]) {
  const start=Date.parse(requirement.starts_at),end=Date.parse(requirement.ends_at),created=Date.parse(requirement.created_at);
  return [...new Map(readings.filter(r=>r.case_id===requirement.case_id&&Date.parse(r.measured_at)>=start&&Date.parse(r.measured_at)<end&&Date.parse(r.accepted_at)>=created).map(r=>[r.id,r])).values()]
    .sort((a,b)=>Date.parse(a.measured_at)-Date.parse(b.measured_at)||a.id.localeCompare(b.id));
}
export function monitoringProgress(requirement:MonitoringRequirement,readings:AcceptedReading[]) {
  const evidence=qualifyingReadings(requirement,readings);
  return {received:evidence.length,missing:Math.max(0,requirement.required_count-evidence.length),late:evidence.filter(r=>Date.parse(r.accepted_at)>=Date.parse(requirement.ends_at)).length};
}
export function readingsForRequirement(requirementId:string,readings:AcceptedReading[],links:MonitoringEvidence[]) {
  const ids=new Set(links.filter(l=>l.requirement_id===requirementId).map(l=>l.reading_id));
  return readings.filter(r=>ids.has(r.id));
}
export function memberMonitoring(requirements:MonitoringRequirement[],readings:AcceptedReading[],links:MonitoringEvidence[]) {
  return requirements.map(r=>({id:r.id,instructions:r.instructions,startsAt:r.starts_at,endsAt:r.ends_at,requiredCount:r.required_count,status:r.status,doctor:r.actor_label,createdAt:r.created_at,acknowledgedAt:r.acknowledged_at,...monitoringProgress(r,readingsForRequirement(r.id,readings,links))}));
}
export type MemberMonitoring=ReturnType<typeof memberMonitoring>;
