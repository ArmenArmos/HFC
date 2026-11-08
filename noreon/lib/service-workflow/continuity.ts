import type { ServiceMedicationOrder, ServicePublication, ServiceWorkflow, TreatmentDraft } from './types';

function medicationFields(draft: TreatmentDraft) {
  return {
    name: draft.medicationName.trim(), dose: draft.medicationDose.trim(),
    instructions: draft.medicationInstructions.trim(),
    times: [...new Set(draft.medicationTimes)].sort(),
  };
}
function sameMedication(order: ServiceMedicationOrder, draft: TreatmentDraft) {
  const next = medicationFields(draft);
  return order.name === next.name && order.dose === next.dose &&
    order.instructions === next.instructions &&
    JSON.stringify([...new Set(order.times)].sort()) === JSON.stringify(next.times);
}
/** Import only the publication that actually survives in a legacy case. */
export function publicationOrder(workflow: ServiceWorkflow): ServiceMedicationOrder | null {
  const publication = workflow.publication;
  if (!publication?.draft.medicationName.trim()) return null;
  const id = publication.medicationOrderId ?? `workflow-medication-${publication.version}`;
  const stored = workflow.medicationOrders?.find(order => order.id === id);
  if (stored) return stored;
  // A missing explicit reference is corruption, not permission to invent an order.
  if (publication.medicationOrderId) throw new Error('The published medication order is unavailable.');
  return {id, originatingPlanId: `workflow-plan-${publication.version}`,
    effectiveAt: publication.at, retiredAt: null, ...medicationFields(publication.draft)};
}
/** SQL implements the same transition under the case lock in shared mode. */
export function publishWithContinuity(workflow: ServiceWorkflow, publication: ServicePublication): ServiceWorkflow {
  const next = structuredClone(workflow);
  const orders = next.medicationOrders ?? [];
  const previous = publicationOrder(next);
  if (previous && !orders.some(order => order.id === previous.id)) orders.push(previous);
  const newPublication = structuredClone(publication);
  if (previous && previous.retiredAt === null && sameMedication(previous, publication.draft)) {
    newPublication.medicationOrderId = previous.id;
  } else {
    if (previous) {
      const old = orders.find(order => order.id === previous.id)!;
      old.retiredAt ??= publication.at;
    }
    if (publication.draft.medicationName.trim()) {
      const id = `workflow-medication-${publication.version}`;
      if (orders.some(order => order.id === id)) throw new Error('Medication order identity already exists.');
      orders.push({id, originatingPlanId:`workflow-plan-${publication.version}`,
        effectiveAt:publication.at, retiredAt:null, ...medicationFields(publication.draft)});
      newPublication.medicationOrderId = id;
    }
  }
  next.publicationHistory = [...(next.publicationHistory ?? []),
    ...(next.publication ? [{...next.publication, ...(previous ? {medicationOrderId:previous.id} : {})}] : [])];
  next.medicationOrders = orders;
  next.publication = newPublication;
  return next;
}
