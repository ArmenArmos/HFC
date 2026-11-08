import { consultationWindow, evaluate, unknownFields } from '@/lib/clinical/rules/engine';
import type { AssessmentDraft, Measurement } from '@/lib/patient/types';
import { pastReadings } from '@/lib/patient/measured-at';
import { checkedCaseRows } from './case-summary';
import type { ServiceWorkflow, TreatmentDraft } from './types';
import { createWorkflow } from './model';

/** Saved or published clinician text is never replaced automatically. */
export function automaticCareDraftAllowed(workflow: ServiceWorkflow): boolean {
  const template = createWorkflow([]).draft;
  return !workflow.publication && !workflow.draftSaved && !workflow.events.some(event => event.text.endsWith('save-draft'))
    && (Object.keys(template) as (keyof TreatmentDraft)[]).every(key => JSON.stringify(workflow.draft[key]) === JSON.stringify(template[key]));
}

function bounded(lines: string[], max: number): string {
  const suffix='\nFull evidence remains available in the case.';
  const text=lines.join('\n');
  return text.length<=max ? text : text.slice(0,max-suffix.length-1)+'…'+suffix;
}

/** Screening-protocol prefill, not a prescription generator or a publication. */
export function prepareCarePlanDraft({workflow, assessment, measurements, reports, approvals = {}}: {
  workflow: ServiceWorkflow;
  assessment: AssessmentDraft | null;
  measurements: Measurement[];
  reports: {id?:string; revision?:number; state:string; reviewed:unknown}[];
  approvals?: Record<string,{revision:number}>;
}): TreatmentDraft | null {
  if(!assessment?.completedAt || assessment.urgentRule) return null;
  const decision=evaluate({answers:assessment.answers,observations:[]});
  if(decision.urgency==='red') return null;
  const rows=checkedCaseRows(reports).filter(row=>!row.uncertain);
  const latest=pastReadings(measurements).sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt))[0];
  const findings=decision.findings.slice(0,4);
  const unknown=unknownFields(assessment.answers);
  const pending=workflow.tests.filter(test=>!workflow.receivedTestIds.includes(test.id));
  const unchecked=reports.filter(report=>report.state!=='confirmed').length;
  const clinicallyUnchecked=reports.filter(report=>!report.id || approvals[report.id]?.revision !== report.revision).length;
  const explanation=bounded([
    'This review brings together your health-question answers and selected recorded results. Your answers describe what you reported at that time; they are not a new diagnosis.',
    ...findings.map(f=>`From your health questions: ${f.reason.en ?? f.reason.hy}`),
    ...(decision.findings.length>4 ? [`Showing 4 of ${decision.findings.length} protocol findings.`] : []),
    latest ? `Latest blood pressure you recorded: ${latest.systolic}/${latest.diastolic} mmHg.` : 'No measured blood pressure has been recorded in this case.',
    ...rows.slice(0,4).map(row=>`From a source-checked past report: ${row.name}: ${row.literal}${row.unit ? ` ${row.unit}` : ''}.`),
    'Source-checked values still need clinical interpretation. Receiving a result does not automatically resolve an earlier finding.',
    rows.length>4 ? `Showing 4 of ${rows.length} certain checked result rows.` : `${rows.length} certain checked result rows included.`,
    `${unknown.length} questionnaire items remain unknown; missing information is not a normal result.`,
  ],1500);
  const steps=[...new Set(decision.findings.filter(f=>f.category!=='missing-data').map(f=>f.nextStep?.en ?? f.nextStep?.hy).filter((step):step is string=>!!step))];
  const instructions=bounded([
    'Review these screening-protocol next steps with your care team:',
    ...steps.slice(0,4),
    ...(steps.length>4 ? [`Showing 4 of ${steps.length} protocol next steps; review the full case before approval.`] : []),
    'Continue only your existing agreed care instructions. Medicine selection and dose changes must be confirmed by your clinician.',
  ],1500);
  const followUp=bounded([
    `Screening-protocol review window: ${consultationWindow(decision).en ?? consultationWindow(decision).hy}.`,
    `${pending.length} recorded test results outstanding; ${unchecked} imported reports need source checking; ${clinicallyUnchecked} imported reports await clinical review.`,
    'Confirm your follow-up date and any additional monitoring instructions with your care team.',
  ],500);
  return {...structuredClone(workflow.draft),explanation,instructions,followUp};
}
