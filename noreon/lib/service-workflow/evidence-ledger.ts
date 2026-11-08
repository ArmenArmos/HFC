import type {AcceptedReading} from './follow-up';
import {evaluate} from '@/lib/clinical/rules/engine';
import type {AssessmentDraft,Measurement} from '@/lib/patient/types';
import type {ServiceWorkflow} from './types';
import {workflowCare} from './model';
import {validateCaseEvidence,type CaseEvidence} from './case-summary';
import {reportEvidence,type EvidenceReport} from './report-evidence';
export type OmittedEvidence={findings:number;bloodPressure:number;reportRows:number};
const categories=['findings','bloodPressure','reportRows'] as const;
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function buildCaseLedger({workflow:w,assessment,measurements,reports,durableMeasurements=[]}:{workflow:ServiceWorkflow;assessment:AssessmentDraft|null;measurements:Measurement[];reports:EvidenceReport[];durableMeasurements?:AcceptedReading[]}) {
  const decision=evaluate({answers:assessment?.answers??{},observations:[]});
  const history=reportEvidence(reports);
  const allMeasurements=[...new Map([...measurements,...durableMeasurements.map(m=>({id:m.id,measuredAt:m.measured_at,systolic:m.systolic,diastolic:m.diastolic,pulse:m.pulse??undefined}))].map(m=>[m.id,m])).values()];
  const current=workflowCare({...w,publicationHistory:[],publication:{at:w.allResultsAt??w.startedAt,doctor:'',version:0,resultTestIds:w.receivedTestIds,draft:w.draft}},[],false).results;
  const evidence:CaseEvidence={
    findings:decision.findings.map(f=>({id:f.ruleId,text:f.reason.en??f.reason.hy,ruleIds:/^RF-\d{2}$/.test(f.ruleId)?[f.ruleId]:[],source:'NRN-CLIN-ALG-001' as const})).sort((a,b)=>a.id.localeCompare(b.id)),
    bloodPressure:allMeasurements.sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt)||a.id.localeCompare(b.id)).map(m=>({id:m.id,measuredAt:m.measuredAt,systolic:m.systolic,diastolic:m.diastolic,pulse:m.pulse??null})),
    reportRows:[...history.rows,...current.map(r=>({id:r.id,name:`Fictional current test: ${r.marker}`,literal:String(r.value),unit:r.unit,reference:null,page:1,uncertain:false,reportDate:r.collectedAt.slice(0,10)})).sort((a,b)=>a.id.localeCompare(b.id))],
  };
  return {evidence,sources:history.sources};
}
export function selectCaseEvidence(full:CaseEvidence) {
  const evidence={findings:full.findings.slice(0,40),bloodPressure:full.bloodPressure.slice(0,20),reportRows:full.reportRows.slice(0,100)};
  return {evidence,omitted:Object.fromEntries(categories.map(k=>[k,full[k].length-evidence[k].length])) as OmittedEvidence};
}
export function validateConsentedSelection(input:unknown,full:CaseEvidence,omitted:OmittedEvidence) {
  const selected=validateCaseEvidence(input);
  for(const category of categories) {
    if(!Number.isSafeInteger(omitted[category])||omitted[category]<0||omitted[category]!==full[category].length-selected[category].length)throw new Error('invalid_omitted_count');
    const allowed=new Map(full[category].map(item=>[item.id,canonical(item)]));
    for(const item of selected[category]) if(allowed.get(item.id)!==canonical(item))throw new Error('invalid_evidence');
  }
  return selected;
}
