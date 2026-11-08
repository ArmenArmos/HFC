import { memberInstruction } from '@/lib/text-language';
import { clinicalLocale } from '@/lib/locale';
import type { DemoState } from '@/lib/patient/demo-model';
import { buildPlan, evaluate } from '@/lib/clinical/rules/engine';
import { createWorkflow } from './model';
import { clinicalContext, reconcileRecommendations } from './reconciliation';
/** Normalize at the write boundary. Reads never invent a second workflow. */
export function normalizeSharedWorkflow(data: DemoState): boolean {
  const { profile, assessment } = data.state;
  if (!profile || !data.state.consentAccepted) return false;
  const old = data.workflow;
  const context = clinicalContext(data.state);
  const incompleteIsNormalized = old && old.tests.length === 0 &&
    old.receivedTestIds.length === 0 && old.allResultsAt === null;
  const tests = assessment?.completedAt ? buildPlan(evaluate({answers: assessment.answers, observations: []})).map(t => ({
    id: t.id, title: t.name[clinicalLocale(profile.locale)] ?? t.name.en ?? t.name.hy,
    method: t.method === 'blood_draw' || t.method === 'urine_sample' ? 'lab' as const : t.method === 'home_log' ? 'home-log' as const : 'clinic' as const,
    preparation: memberInstruction(t.preparation[profile.locale] ?? t.preparation.en ?? t.preparation.hy, profile.locale),
    source: `NRN-CLIN-ALG-001: ${t.sourceRuleIds.join(', ')}`,
  })) : [];
  // An unchanged questionnaire can still have corrected source requirements.
  // Compare the current engine projection before trusting a cached workflow.
  // Labels, translations and registry attribution are presentation metadata.
  // They must not reopen a clinical review when the required checks are the same.
  const requirementKey = (items: typeof tests) => JSON.stringify(items.map(({id,method}) => ({id,method})).sort((a,b)=>a.id.localeCompare(b.id)));
  const requirementsChanged = !!old && requirementKey(old.tests) !== requirementKey(tests);
  if (old && old.requirements && old.clinicalContext === context && old.questionnaireRevision === assessment?.revision &&
    !requirementsChanged && (assessment?.completedAt || incompleteIsNormalized)) return false;
  const at = new Date(assessment?.completedAt ?? Date.now());
  const base = old ?? createWorkflow(tests, at);
  data.workflow = reconcileRecommendations(base, tests, !!assessment?.completedAt, assessment?.revision ?? 0, context, at);
  data.workflow.questionnaireRevision = assessment?.revision;
  if(requirementsChanged) {
    data.workflow.evidenceRevision=(old?.evidenceRevision??0)+1;
    data.workflow.consultation='undecided';
  }
  data.workflow.revision = old ? old.revision + 1 : 0;
  return true;
}
