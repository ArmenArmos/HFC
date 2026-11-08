import type {ClinicalSnapshot} from './clinical-case-repository';
import {hasEvidencePath} from './required-evidence';

export type ConsultationProposal={decision:'required'|'not-required'|null;note:string};
/** Only explicit protocol/draft wording supplies a decision. Keep its sentence verbatim. */
export function consultationProposal(urgency:string|null|undefined,sentence:string|null|undefined):ConsultationProposal|null{
 if(!['green','yellow','orange'].includes(urgency??'')||!sentence?.trim()||sentence.length>2000)return null;
 const required=/^(?:Medical consultation (?:today|within \d+ (?:hours?|days?|weeks?))|Բժշկի խորհրդատվություն՝ (?:այսօր|\d+ (?:ժամվա|օրվա|շաբաթվա) ընթացքում)|Консультация врача (?:сегодня|в течение \d+ (?:часов|дней|недел[ьи])))\.?$/.test(sentence);
 const notRequired=/^(?:No consultation is needed|Consultation is not required|Խորհրդատվություն անհրաժեշտ չէ|Խորհրդատվություն չի պահանջվում|Консультация не требуется|Консультация не нужна)[.։]?$/.test(sentence);
 return {decision:required?'required':notRequired&&urgency==='green'?'not-required':null,note:sentence};
}
/** A proposal is a convenience, never permission to bypass publication's live checks. */
export function safeConsultationProposal(review:ClinicalSnapshot['review'],proposal:ConsultationProposal|null|undefined,current:boolean,urgent=false):ConsultationProposal|null{
 if(!current||urgent||!review||review.consultation.decision!=='undecided')return null;
 const parsed=consultationProposal(review.engine.urgency,proposal?.note);
 if(!parsed)return null;
 const abnormal=review.engine.tests.some(test=>test.method!=='lab'&&hasEvidencePath(test.id)&&review.evidenceReceipts?.[test.id]?.snapshot.result==='abnormal');
 if(parsed.decision==='not-required'&&(abnormal||review.engine.tests.some(test=>test.method!=='lab'&&(!hasEvidencePath(test.id)||!review.evidenceReceipts?.[test.id]))))return null;
 // Do not carry a contradictory reason into a required/urgent pathway.
 if(proposal?.decision==='not-required'&&parsed.decision!=='not-required')return null;
 return parsed;
}
