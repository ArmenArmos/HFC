import 'server-only';
import {clinicalConsultationProposal} from '@/lib/patient-care/clinical-review-engine';
import {firstPublicationGate} from '@/lib/doctor-decisions/publication-gate';
import {z} from 'zod';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {doctorFirstNoteSchema} from '@/lib/first-note/schema';
import {firstNoteNext,prepareFirstNote} from '@/lib/first-note/compose';
import {doctorRegimenReviewSchema} from '@/lib/patient-care/regimen';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import {appointmentSchema} from '@/lib/real-booking/appointment-schema';
import type {Answers} from '@/lib/clinical/types';
import type {DecisionRpc} from './items';
import type {ApprovalCards} from './approvals';
import {currentClinicalReview} from '@/lib/patient-care/clinical-review-current';
import {validReviewDraft} from '@/lib/service-workflow/publication';

const readSchema=z.object({snapshot:snapshotSchema.extend({evidenceToken:z.string().regex(/^[a-f0-9]{32}$/)}),firstNote:doctorFirstNoteSchema,regimen:doctorRegimenReviewSchema,
 appointments:z.array(appointmentSchema),appointmentsRevision:z.string().regex(/^[a-f0-9]{32}$/),replacementId:z.uuid().nullable()});
/** One frozen read for the shown draft and context. Only the fields the cards need reach the browser. */
export async function readApprovalCards(client:DecisionRpc,memberId:string,doctorId?:string):Promise<ApprovalCards|null>{
 try{
  const r=await client.rpc('doctor_approval_cards_read',{p_member:memberId});
  const p=readSchema.safeParse(r.data);if(r.error||!p.success||p.data.snapshot.id!==memberId)return null;
  const {snapshot:s,firstNote:n,regimen,appointments,appointmentsRevision,replacementId}=p.data;
  const context={memberId,revision:s.revision,evidenceToken:s.evidenceToken};
  const a=s.evidence.assessment;
  const draft=n.enabled&&!n.note&&!n.planActive&&!n.urgent?prepareFirstNote({answers:(a?.answers??{}) as Answers,
   completedAt:a?.completed_at??null,urgentRule:a?.urgent_rule??null,firstName:s.evidence.profile.name?.split(' ')[0]||null,...firstNoteNext(appointments)}):null;
  // A legacy active plan without a reviewable version cannot be shown as an empty replacement.
  const replacementShown=replacementId===null||regimen.versions.some(v=>v.current&&v.planId===replacementId);
  if(multiMedicineEnabled()&&regimen.enabled&&!replacementShown)return null;
  const reviewCurrent=currentClinicalReview(s,doctorId),draftCurrent=reviewCurrent&&!s.draftStale&&validReviewDraft(s.draft);
  const consultationAt=s.review?.consultation.at;
  const consultationChanged=s.draftStale&&typeof consultationAt==='string'&&!!s.draftSavedAt&&Date.parse(consultationAt)>Date.parse(s.draftSavedAt);
  return {
   firstNote:n.enabled?{context:{...context,appointmentsRevision},submissionId:crypto.randomUUID(),data:n,draft:typeof draft==='string'?null:draft,assessmentRevision:a?.revision??0}:null,
   regimen:multiMedicineEnabled()&&regimen.enabled&&s.draft&&regimen.draft&&replacementShown?{context,requestId:crypto.randomUUID(),draft:s.draft,review:regimen,clinicalReview:s.review,current:draftCurrent,publicationGate:firstPublicationGate(s.review,draftCurrent,s.evidence.reports),staleReason:consultationChanged?'consultation':undefined}:null,
   consultation:s.review&&reviewCurrent?{context,review:s.review,proposal:clinicalConsultationProposal(s)}:null,
  };
 }catch{return null;}
}
