import { draftSchema, regimenNameKey } from './publication';

/** Doctor-typed medicine times (Gohar QA 161). Commas from other keyboards (Armenian ՝, Arabic ،, full-width ，),
 *  semicolons, slashes and spaces all separate times; the Armenian full stop ։ and the full-width colon are read
 *  as ':'; a single-digit hour gets its leading zero. Anything else is kept as typed so the schema rejects it. */
export function parseMedicationTimes(raw: unknown): string[] {
  return String(raw ?? '').replace(/[։：]/g, ':').split(/[,،՝，、;/\s]+/).filter(Boolean)
    .map(t => /^\d:[0-5]\d$/.test(t) ? `0${t}` : t);
}

/** Fixed English messages, one per failing rule, in form order. They are keys in staff-server-copy. */
const tooLong: Record<string, string> = {
  explanation: 'Shorten the review explanation to 1500 characters or fewer.',
  instructions: 'Shorten the care instructions to 1500 characters or fewer.',
  followUp: 'Shorten the follow-up to 500 characters or fewer.',
  medicationName: 'Shorten the medicine name to 120 characters or fewer.',
  medicationDose: 'Shorten the dose to 120 characters or fewer.',
  medicationInstructions: 'Shorten the medicine instructions to 500 characters or fewer.',
  activityLimits: 'Shorten the activity permission and limits to 500 characters or fewer.',
};
const empty: Record<string, string> = {
  explanation: 'Add the review explanation.',
  instructions: 'Add the care instructions.',
};
export const BAD_TIME = 'Use medicine times such as 09:00 or 18:00, separated by commas.';
export const TOO_MANY_TIMES = 'Use at most 4 medicine times.';
export const NEEDS_DOSE = 'Add the dose for this medicine.';
export const NEEDS_TIME = 'Add at least one time for this medicine.';
export const CHECK_DRAFT = 'Check the draft fields and use times such as 09:00, 18:00.';
export const NEEDS_MEDICINE_NAME = 'Add the name of every medicine.';
export const NEEDS_MEDICINE_DOSE = 'Add the dose of every medicine.';
export const NEEDS_MEDICINE_TIME = 'Add at least one time for every medicine.';
export const TOO_MANY_MEDICINES = 'Use at most 8 medicines in one plan.';
export const REPEATED_MEDICINE = 'List each medicine once. Different doses of one medicine go on one line.';
const needed: Record<string, string> = { name: NEEDS_MEDICINE_NAME, dose: NEEDS_MEDICINE_DOSE, times: NEEDS_MEDICINE_TIME };
const medicineTooLong: Record<string, string> = { name: 'medicationName', dose: 'medicationDose', instructions: 'medicationInstructions' };

/** The doctor's regimen rows from the form, times as typed. A value that is not a list stays as it is, so the schema refuses it. */
export function parseRegimenInput(raw: string): unknown {
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return raw; }
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => typeof row === 'object' && row !== null ? { ...row, times: parseMedicationTimes((row as { times?: unknown }).times) } : row);
}

/** Validates a draft as typed in the form. Medicine name without dose or time is refused at save by
 *  workspace_valid_review_draft, so it is reported here too instead of as a generic save failure. */
export function checkDraft(values: Record<string, unknown>) {
  const parsed = draftSchema.safeParse(values);
  const errors = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [field, , part] = issue.path;
      if (field === 'medicines') {
        if (issue.path.length === 1) errors.add(issue.code === 'too_big' ? TOO_MANY_MEDICINES : CHECK_DRAFT);
        else if (part === 'times' && issue.path.length > 3) errors.add(BAD_TIME);
        else if (part === 'times' && issue.code === 'too_big') errors.add(TOO_MANY_TIMES);
        else if (typeof part === 'string' && issue.code === 'too_small' && needed[part]) errors.add(needed[part]);
        else if (typeof part === 'string' && issue.code === 'too_big' && medicineTooLong[part]) errors.add(tooLong[medicineTooLong[part]]);
        else errors.add(CHECK_DRAFT);
      }
      else if (field === 'medicationTimes') errors.add(issue.path.length > 1 ? BAD_TIME : issue.code === 'too_big' ? TOO_MANY_TIMES : BAD_TIME);
      else if (typeof field === 'string' && issue.code === 'too_big' && tooLong[field]) errors.add(tooLong[field]);
      else if (typeof field === 'string' && issue.code === 'too_small' && empty[field]) errors.add(empty[field]);
      else errors.add(CHECK_DRAFT);
    }
  }
  const text = (k: string) => typeof values[k] === 'string' ? (values[k] as string).trim() : '';
  if (text('medicationName')) {
    if (!text('medicationDose')) errors.add(NEEDS_DOSE);
    if (!(Array.isArray(values.medicationTimes) && values.medicationTimes.length)) errors.add(NEEDS_TIME);
  }
  const named = parsed.success ? (parsed.data.medicines ?? []).map(m => regimenNameKey(m.name)) : [];
  if (new Set(named).size !== named.length) errors.add(REPEATED_MEDICINE);
  const order = [...Object.values(empty), ...Object.values(tooLong), NEEDS_MEDICINE_NAME, NEEDS_MEDICINE_DOSE, NEEDS_MEDICINE_TIME, REPEATED_MEDICINE, TOO_MANY_MEDICINES, BAD_TIME, TOO_MANY_TIMES, NEEDS_DOSE, NEEDS_TIME, CHECK_DRAFT];
  const messages = order.filter(m => errors.has(m));
  if (messages.length || !parsed.success) return { ok: false as const, messages: messages.length ? messages : [CHECK_DRAFT] };
  return { ok: true as const, draft: parsed.data };
}
