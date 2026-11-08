import { evaluate } from '@/lib/clinical/rules/engine';
import type { AssessmentDraft } from './types';
/** Routine presentation never outranks current or persisted emergency evidence. */
export function patientPresentation(assessment: Pick<AssessmentDraft,'answers'|'urgentRule'|'completedAt'>) {
 const urgent=!!assessment.urgentRule || evaluate({answers:assessment.answers,observations:[]}).urgency==='red';
 return {urgent,showRoutine:!urgent && !!assessment.completedAt};
}
