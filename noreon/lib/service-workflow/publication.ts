import { z } from 'zod';
import type { ServiceWorkflow } from './types';
const short = z.string().trim().max(120);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const MAX_REGIMEN_MEDICINES = 8;
/** One medicine of a regimen, exactly as the doctor entered it. No field is filled or suggested by code. */
export const draftMedicineSchema = z.object({
  name: short.min(1), dose: short.min(1), instructions: z.string().trim().max(500), times: z.array(time).min(1).max(4),
}).strict();
export type DraftMedicine = z.infer<typeof draftMedicineSchema>;
/** Versions compare medicines by this key, as _regimen_name_key does: the typed name, ignoring case and spacing. */
export const regimenNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export const draftSchema = z.object({
  explanation: z.string().trim().min(1).max(1500),
  instructions: z.string().trim().min(1).max(1500),
  followUp: z.string().trim().max(500),
  medicationName: short, medicationDose: short,
  medicationInstructions: z.string().trim().max(500),
  medicationTimes: z.array(time).max(4),
  /** A regimen. When present the four fields above are blank; absent is a one-medicine draft (20261030210000). */
  medicines: z.array(draftMedicineSchema).max(MAX_REGIMEN_MEDICINES).optional(),
  /** What the doctor records about activity after a heart attack, stent or stroke (Task 16). Absent: nothing recorded. */
  activityLimits: z.string().trim().min(1).max(500).optional(),
}).strict();
export function validReviewDraft(value: unknown): boolean {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return false;
  const d = parsed.data;
  if (d.instructions === 'Add the approved care instructions.') return false;
  if (!d.medicines) return !d.medicationName || (!!d.medicationDose && d.medicationTimes.length > 0);
  return !d.medicationName && !d.medicationDose && !d.medicationInstructions && !d.medicationTimes.length
    && new Set(d.medicines.map(m => regimenNameKey(m.name))).size === d.medicines.length;
}
export type PublicationContext = {
  workflow: ServiceWorkflow;
  questionnaireComplete?: boolean;
  urgent?: boolean;
  reportsReady?: boolean;
  reportEvidenceRevision?: number;
  reportEvidenceSession?: string;
  now?: Date;
};
export function publicationBlockers({workflow: w, questionnaireComplete = true, urgent = false,
  reportsReady = true, reportEvidenceRevision = 0, reportEvidenceSession, now = new Date()}: PublicationContext) {
  const blockers: {code: string; message: string}[] = [];
  const add = (code: string, message: string) => blockers.push({code, message});
  if (urgent) add('urgent', 'Urgent guidance takes priority over routine publication.');
  if (!questionnaireComplete) add('questionnaire', 'Complete the questionnaire before publication.');
  if (!w.doctors.find(d => d.id === w.assignedDoctorId)?.active) add('doctor', 'Assign an active GP in an active clinic before publication.');
  if (!w.allResultsAt || w.tests.some(t => !w.receivedTestIds.includes(t.id))) add('results', 'Receive every required test result before publication.');
  if (w.consultation === 'undecided') add('decision', 'Record whether a consultation is needed.');
  if (w.consultation === 'required' && (w.appointment?.status !== 'completed' || (w.clinicalContext !== undefined && w.appointment.completedForContext !== w.clinicalContext) || !Number.isFinite(Date.parse(w.appointment.at)) || Date.parse(w.appointment.at) > now.getTime())) add('consultation', 'Complete the required consultation after its scheduled time.');
  if (!w.draftSaved || !validReviewDraft(w.draft)) add('draft', 'Save a valid review draft before publication.');
  if (w.draftEvidenceRevision == null || w.draftEvidenceRevision !== (w.evidenceRevision ?? 0) || (w.draftReportEvidenceRevision ?? 0) !== reportEvidenceRevision || (reportEvidenceSession !== undefined && w.draftReportEvidenceSession !== reportEvidenceSession)) add('evidence', 'Review the changed evidence and save the draft again.');
  if (!reportsReady) add('reports', 'Check and approve every imported report before publication.');
  return blockers;
}
