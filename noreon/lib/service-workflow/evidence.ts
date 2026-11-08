import type { DemoState } from '@/lib/patient/demo-model';
import type { PatientState, PatientProfile } from '@/lib/patient/types';
import type { ServiceWorkflow } from './types';
// Exhaustive classification: adding a field requires an explicit freshness decision.
export const demoEvidenceFields = {version:false,workspaceRevision:false,acceptedReadingRevision:true,monitoringEvidenceRevision:true,reviewTasks:false,userId:false,expiresAt:false,state:true,measurements:true,workflow:true,reminderPreferences:false,care:false} satisfies Record<keyof DemoState,boolean>;
export const patientEvidenceFields = {profile:true,consentAccepted:true,assessment:true} satisfies Record<keyof PatientState,boolean>;
export const profileEvidenceFields = {userId:true,name:true,birthDate:true,biologicalSex:true,locale:false} satisfies Record<keyof PatientProfile,boolean>;
export const workflowEvidenceFields = {bookingRequests:false,version:false,revision:false,questionnaireRevision:false,clinicalContext:false,recommendationsPending:true,requirements:true,receiptHistory:true,recommendationChanges:false,appointmentHistory:false,evidenceRevision:false,draftEvidenceRevision:false,draftReportEvidenceRevision:false,draftReportEvidenceSession:false,startedAt:false,tests:true,bookings:false,receivedTestIds:true,allResultsAt:true,lastResultsAt:false,doctors:false,assignedDoctorId:false,consultation:false,appointment:false,draft:false,draftSaved:false,publication:false,publicationHistory:false,medicationOrders:false,events:false} satisfies Record<keyof ServiceWorkflow,boolean>;
export function evidenceProjection(data: DemoState) {
  const profile = data.state.profile;
  return JSON.stringify({assessment:data.state.assessment, measurements:{readings:data.measurements,accepted:data.acceptedReadingRevision??0},monitoring:data.monitoringEvidenceRevision??0,
    profile:profile ? {userId:profile.userId,name:profile.name,birthDate:profile.birthDate,biologicalSex:profile.biologicalSex} : null,
    consent:data.state.consentAccepted,
    tests:(data.workflow?.tests ?? []).map(test => ({id:test.id,method:test.method,preparation:test.preparation,source:test.source})).sort((a,b) => a.id.localeCompare(b.id)),
    requirements:(data.workflow?.recommendationsPending ? [] : data.workflow?.requirements ?? []).filter(r=>r.retiredAtRevision===null).map(r=>({id:r.requirementId,testId:r.test.id,method:r.test.method})).sort((a,b)=>a.id.localeCompare(b.id)),
    receipts:(data.workflow?.recommendationsPending ? [] : data.workflow?.receiptHistory ?? []).filter(r=>data.workflow?.requirements?.some(q=>q.requirementId===r.requirementId && q.retiredAtRevision===null)).map(r=>({requirementId:r.requirementId,receivedAt:r.receivedAt})).sort((a,b)=>a.requirementId.localeCompare(b.requirementId)),
    pending:data.workflow?.recommendationsPending ?? false,
    received:[...new Set(data.workflow?.receivedTestIds ?? [])].sort(), allResultsAt:data.workflow?.allResultsAt ?? null});
}
