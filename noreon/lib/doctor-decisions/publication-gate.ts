import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {hasEvidencePath} from '@/lib/patient-care/required-evidence';

export type PublicationGate={kind:'stale'|'source'|'lab'|'evidence'|'unsupported'|'consultation'|'completion'|'abnormal-consultation';title?:string;reportId?:string};
/** Also used to expose the consultation controls, independently of earlier source gates. */
export function consultationPublicationGate(review:NonNullable<ClinicalSnapshot['review']>):PublicationGate|null{
 const consultation=review.consultation;
 const completed=consultation.decision==='required'&&!!consultation.completedAt&&
  Number.isFinite(Date.parse(consultation.completedAt))&&Date.parse(consultation.completedAt)<=Date.now()&&
  consultation.evidenceToken===review.evidenceToken;
 const abnormal=review.engine.tests.some(test=>test.method!=='lab'&&hasEvidencePath(test.id)&&review.evidenceReceipts?.[test.id]?.snapshot.result==='abnormal');
 if(abnormal&&!completed)return {kind:'abnormal-consultation'};
 if(consultation.decision==='undecided')return {kind:'consultation'};
 if(consultation.decision==='required'&&!completed)return {kind:'completion'};
 return null;
}
/** Presentation of the requirements this frozen read can prove. `current` includes
 * the clinical engine and saved-draft checks. Null does not prove live source
 * validity, authorization or transaction-only guards; publication rechecks them. */
export function firstPublicationGate(review:ClinicalSnapshot['review'],current:boolean,reports?:ClinicalSnapshot['evidence']['reports']):PublicationGate|null{
 if(!current||!review)return {kind:'stale'};
 const consultationGate=consultationPublicationGate(review);
 const unreviewed=reports?.find(r=>r.state!=='confirmed'||!r.reviewed||review.approvals[r.id]?.revision!==r.revision);
 if(unreviewed){
  const lab=review.engine.tests.find(t=>{const receipt=review.receipts[t.id];return t.method==='lab'&&receipt&&'reportId' in receipt&&receipt.reportId===unreviewed.id;});
  return lab?{kind:'lab',title:lab.title,reportId:unreviewed.id}:{kind:'source',reportId:unreviewed.id};
 }
 for(const test of review.engine.tests){
  if(test.method!=='lab'){
   if(!hasEvidencePath(test.id))return {kind:'unsupported',title:test.title};
   const evidence=review.evidenceReceipts?.[test.id];
   if(!evidence)return {kind:'evidence',title:test.title};
   if(evidence.snapshot.result==='abnormal'&&consultationGate)return consultationGate;
   continue;
  }
  const receipt=review.receipts[test.id];
  if(!receipt)return {kind:'lab',title:test.title};
  if('reportId' in receipt){
   const report=reports?.find(r=>r.id===receipt.reportId);
   if(!report||report.revision!==receipt.reportRevision||review.approvals[report.id]?.revision!==report.revision)return {kind:'lab',title:test.title,reportId:report?.id};
  }
 }
 return consultationGate;
}
