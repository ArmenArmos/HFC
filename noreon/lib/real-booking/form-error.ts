import { z } from 'zod';
import type { BookingFormState } from './schema';

export const clinicalBookingHold = 'Routine test requests are on hold. Review your health guidance and contact Noreon before continuing.';
const clinicalHolds = new Set([
  'Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.',
  'Urgent guidance takes priority over routine publication.',
  'Routine publication is on hold: the native source-specific mandatory consultation pathway is unavailable. Follow the clinical rule guidance; this workspace cannot record its completion.',
]);
/** The profile's age or sex disagrees with the saved questionnaire answers (a data fault, not a clinical hold). */
export function profileContextMismatch(error: unknown): boolean {
  return error instanceof Error && error.message === 'Profile and questionnaire context disagree.';
}
export function clinicalBookingFailure(error: unknown): string | undefined {
  return error instanceof Error && clinicalHolds.has(error.message) ? clinicalBookingHold : undefined;
}
/** Log fields for a booking load failure. A clinical hold's message names the member's clinical state, so only its name is logged. */
export function bookingLoadLogFields(error: unknown, fields: Record<string, unknown>): Record<string, unknown> {
  return clinicalBookingFailure(error) ? { error_name: error instanceof Error ? error.name : 'NonError' } : fields;
}
const providerMessages = new Set([
  'The same provider must offer replacement terms while retaining the existing arrangement. Cancel separately before changing provider',
  'Past provider arrangements require operational follow-up',
  'Resolve the pending cancellation first',
  'No current future provider proposal to accept',
  'Record complete actual provider terms, source and preparation',
  'Record complete replacement terms and obtain member acceptance first',
  'Record the actual provider response to the pending change',
]);

/** Supabase errors are plain objects, so do not rely on Error instanceof alone. */
export function bookingFailure(error: unknown): BookingFormState {
  const value = typeof error === 'object' && error !== null ? error : {};
  const code = 'code' in value ? value.code : null;
  const message = 'message' in value && typeof value.message === 'string' ? value.message : '';
  if (clinicalBookingFailure(error)) return { ok: false, code: 'clinical-hold', message: clinicalBookingHold };
  if (providerMessages.has(message)) return { ok: false, code: 'provider-action', message };
  if (code === '40001' || code === '55P03') return { ok: false, code: 'conflict', message: 'The request or its context changed. Reload and check before trying again.' };
  if (message === 'Choose a future preferred time' || message === 'Choose valid future preferred terms') return { ok: false, code: 'past-time', message: 'Choose a future arrival window.' };
  if (message === 'Your questionnaire or profile changed. Reload before requesting.' || message === 'Your recommended tests changed. Reload before requesting.') return { ok: false, code: 'conflict', message: 'The request or its context changed. Reload and check before trying again.' };
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError || message === 'Choose each test once.';
  return invalid ? { ok: false, code: 'invalid', message: 'Check the time, location and required details.' } : { ok: false, code: 'failed', outcomeUnknown: true, message: 'The result is unknown. Do not send again. Check current details before another action.' };
}
