import type {ClinicLabSource} from '@/lib/patient-care/clinic-lab-sources';
import type {StaffLabResults} from '@/lib/lab-ai/staff-results';
import {coversRequiredLabTest,labDateEligible,requiredLabValues} from '@/lib/patient-care/required-lab-match';

type Test={id:string;title:string;method:'lab'|'clinic'|'home-log'};
export {consultationProposal,type ConsultationProposal} from '@/lib/patient-care/consultation-proposal';
import type {ConsultationProposal} from '@/lib/patient-care/consultation-proposal';
/** Sources contain only currently doctor-reviewed clinic values. Never combine incomplete files into a panel. */
export function matchedPlanResults(tests:Test[],sources:ClinicLabSource[],questionnaireAt:string|null|undefined){
 return tests.map(test=>{
  const source=test.method==='lab'?sources.map(source=>({...source,values:source.values.filter(value=>labDateEligible(value.collectedOn,questionnaireAt))})).find(source=>coversRequiredLabTest(test.id,source.values))??null:null;
  const questionnaireDay=questionnaireAt&&Number.isFinite(Date.parse(questionnaireAt))?new Date(Date.parse(questionnaireAt)+4*60*60*1000).toISOString().slice(0,10):null;
  const before=!source&&test.method==='lab'&&!!questionnaireDay&&sources.some(source=>coversRequiredLabTest(test.id,source.values)&&requiredLabValues(test.id,source.values).some(value=>value.collectedOn<questionnaireDay));
  const badDate=!source&&test.method==='lab'&&sources.some(source=>coversRequiredLabTest(test.id,source.values));
  return {...test,source,reason:source?null:before?'before' as const:badDate?'date' as const:'missing' as const};
 });
}
export type PlanReadyResult=ReturnType<typeof matchedPlanResults>[number]&{recorded:boolean};
/** Current clinic files, including those that cannot supply a reviewed result yet. */
export function planLabFiles(labs:StaffLabResults|null|undefined){
 return labs?.enabled?labs.clinic.map(file=>({fileId:file.fileId,fileName:file.name,needsReview:file.values.some(value=>value.status==='unverified')})):[];
}
export type PlanLabFile=ReturnType<typeof planLabFiles>[number];
export type PlanReadyEvidence={results:PlanReadyResult[];labFiles?:PlanLabFile[];sourcesAvailable:boolean;reviewCurrent:boolean;urgency:'green'|'yellow'|'orange'|null;proposal:ConsultationProposal|null};
