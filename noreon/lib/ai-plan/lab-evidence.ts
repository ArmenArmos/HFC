import type {PlanLabValue} from './contracts';
export type PlanLabEvidenceValue=Omit<PlanLabValue,'status'>&{status:PlanLabValue['status']|'member-reported';reportedAt?:string|null};
/** The generator reads these clinic labs and evaluates questionnaire HbA1c in the same case snapshot.
 * Its answer time is a reporting time, never a collection date. No clinical thresholds are applied here. */
export function planLabEvidence(values:PlanLabValue[],answers:Record<string,unknown>|undefined):PlanLabEvidenceValue[]{
 const labs:PlanLabEvidenceValue[]=values.map(({valueId,catalogueRef,testName,value,unit,labFlag,collectedOn,attention,status})=>({valueId,catalogueRef,testName,value,unit,labFlag,collectedOn,attention,status}));
 const answer=answers?.['q6.hba1c'];
 if(answer&&typeof answer==='object'&&'value' in answer&&typeof answer.value==='number'&&Number.isFinite(answer.value)){
  const at='answeredAt' in answer&&typeof answer.answeredAt==='string'&&Number.isFinite(Date.parse(answer.answeredAt))?answer.answeredAt:null;
  labs.push({valueId:'questionnaire:hba1c',catalogueRef:null,testName:'HbA1c',value:answer.value,unit:'%',labFlag:null,collectedOn:null,attention:null,status:'member-reported',reportedAt:at});
 }
 return labs;
}
