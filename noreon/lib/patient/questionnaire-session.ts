import type { Answers, FieldValue } from "@/lib/clinical/types";
import type { AssessmentDraft } from "@/lib/patient/types";
import { activeFields, answersFingerprint, fieldComplete, mergeAnswers } from "@/lib/patient/questionnaire";
import { AnswerSaveQueue } from "@/lib/patient/answer-save-queue";

type Entry = { fieldId: string; value: FieldValue | null };
type Save = ConstructorParameters<typeof AnswerSaveQueue>[1];
export function questionnaireEntries(id: string, answers: Answers): Entry[] {
  return Object.values(answers)
    .filter(answer => answer.fieldId === id || answer.fieldId === `${id}.systolic` || answer.fieldId === `${id}.diastolic`)
    .map(answer => ({ fieldId: answer.fieldId, value: answer.value }));
}

/** A slow auth or database moment (QA M-09) is retried quietly before "couldn't save" shows. */
export const ANSWER_SAVE_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export class QuestionnaireSession {
  readonly id: string;
  readonly queue: AnswerSaveQueue;
  answers: Answers;
  fieldId: string;
  entries: Entry[];
  dirty = false;
  constructor(initial: AssessmentDraft, save: Save, retryDelaysMs: readonly number[] = ANSWER_SAVE_RETRY_DELAYS_MS) {
    this.id = initial.id;
    this.answers = initial.answers;
    this.queue = new AnswerSaveQueue(initial.revision, save, undefined, retryDelaysMs);
    const fields = activeFields(initial.answers).filter(field => field.topic.id !== "q1");
    this.fieldId = (fields.find(field => !fieldComplete(field, initial.answers)) ?? fields[0]).id;
    this.entries = questionnaireEntries(this.fieldId, this.answers);
  }
  accept(entries: Entry[]) {
    const answers = mergeAnswers(this.answers, entries);
    this.answers = answers;
    this.entries = entries;
    this.dirty = false;
    this.queue.enqueue(entries, answersFingerprint(answers));
    return answers;
  }
  edit(entries: Entry[]) { this.entries = entries; this.dirty = true; }
  go(id: string) { this.fieldId = id; this.entries = questionnaireEntries(id, this.answers); this.dirty = false; }
}

/** Memory belongs to this browser document, never localStorage or an SSR process.
 * A route unmount cannot discard accepted answers or their ordered save queue.
 */
export class QuestionnaireMemory {
  private current: QuestionnaireSession | undefined;
  get pending() {
    return !!this.current && (this.current.dirty || this.current.queue.pending || this.current.queue.failure !== undefined);
  }
  open(initial: AssessmentDraft, save: Save, retryDelaysMs?: readonly number[]) {
    const current = this.current;
    if (current?.id === initial.id && (current.dirty || current.queue.pending || current.queue.failure !== undefined || current.queue.revision >= initial.revision)) return current;
    current?.queue.cancel();
    return this.current = new QuestionnaireSession(initial, save, retryDelaysMs);
  }
  clear(id: string) {
    if (this.current?.id !== id) return;
    this.current.queue.cancel();
    this.current = undefined;
  }
}
const memory = new QuestionnaireMemory();
let unloadGuardInstalled = false;
export function openQuestionnaireSession(initial: AssessmentDraft, save: Save, retryDelaysMs?: readonly number[]) {
  if (typeof window === "undefined") return new QuestionnaireSession(initial, save, retryDelaysMs);
  if (!unloadGuardInstalled) {
    unloadGuardInstalled = true;
    window.addEventListener("beforeunload", event => {
      if (!memory.pending) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
  return memory.open(initial, save, retryDelaysMs);
}
/** Editing a completed questionnaire opens at the first question, unless this tab still holds
 * an unsaved or failed draft, which keeps its place so nothing is lost (QA 175). */
export function startQuestionnaireAtFirst(session: QuestionnaireSession) {
  if (session.dirty || session.queue.pending || session.queue.failure !== undefined) return;
  const first = activeFields(session.answers).find(field => field.topic.id !== "q1");
  if (first) session.go(first.id);
}
export function clearQuestionnaireSession(id: string) { memory.clear(id); }

/** Explicitly reopen the server's saved assessment after a rejected local edit. */
export function reopenSavedQuestionnaire(id: string) {
  clearQuestionnaireSession(id);
  window.location.reload();
}
