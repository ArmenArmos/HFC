import type { ServiceWorkflow } from './types';
export function fictionalResultStatus(workflow: ServiceWorkflow, testId: string | null): string {
  return testId !== null && workflow.publication?.resultTestIds.includes(testId) ? 'Published' : 'Awaiting approval';
}
/** Questionnaire findings retain their original scope; receipt is not a new clinical evaluation. */
export function questionnaireEvidenceStatus(workflow: ServiceWorkflow): string {
  const scope='These findings describe the original questionnaire answers and are not recalculated from later results.';
  return workflow.publication
    ? `${scope} See the published plan for the approved interpretation. Any new evidence still needs review.`
    : `${scope} Received results await interpretation alongside these answers; receipt alone does not resolve a finding.`;
}
