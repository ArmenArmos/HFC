import type { Answers, FieldValue } from "@/lib/clinical/types";
import { firesEmergency } from "@/lib/clinical/rules/rules";
import {
  ageOn,
  dateInArmenia,
  validProfile,
  normalizeName,
  validMeasurement,
} from "@/lib/patient/validation";
import {
  assessmentProgress,
  answersFingerprint,
  detailsAnswered,
  mergeAnswers,
  pruneAnswers,
} from "@/lib/patient/questionnaire";
import type {
  PatientState,
  ProfileInput,
  SaveResult,
  CompleteResult,
  MeasurementInput,
} from "./types";
import { MeasurementConflict } from "@/lib/patient/measurement-store";
export const CONSENT_VERSION = "patient-pilot-v1";
export type PatientStore = {
  read(userId: string, options?: { coherentProfile?: boolean }): Promise<PatientState>;
  profile(
    userId: string,
    input: ProfileInput,
    answers: Answers,
    expectedRevision: number,
    urgentRule: string | null,
  ): Promise<number>;
  assessment(
    userId: string,
    revision: number,
    answers: Answers,
    complete: boolean,
    urgentRule: string | null,
    /** Where each saved field came from; null clears the source of a field that lost its answer. */
    sources?: Record<string, string | null>,
  ): Promise<number>;
  measurement(userId: string, input: MeasurementInput): Promise<void>;
};
export function createPatientService(deps: {
  user: () => Promise<{ userId: string; phone: string } | null>;
  store: () => PatientStore;
  /** The provenance tag for answers saved through this service, when one applies. */
  answerSource?: () => string | null;
}) {
  async function ready() {
    const user = await deps.user();
    if (!user) return null;
    const store = deps.store(),
      state = await store.read(user.userId);
    if (!state.profile || !state.consentAccepted || !state.assessment)
      return null;
    return { user, store, state, assessment: state.assessment };
  }
  return {
    async saveProfile(
      input: unknown,
      consent: unknown,
      expectedRevision?: number,
    ): Promise<SaveResult> {
      try {
        const user = await deps.user();
        if (
          !user ||
          consent !== true ||
          !validProfile(input) ||
          (expectedRevision !== undefined &&
            (!Number.isSafeInteger(expectedRevision) || expectedRevision < -1))
        )
          return { ok: false, reason: "invalid" };
        const store = deps.store(),
          state = await store.read(user.userId),
          date = state.assessment?.assessmentDate ?? dateInArmenia();
        if (
          expectedRevision !== undefined &&
          expectedRevision !== (state.assessment?.revision ?? -1)
        )
          return { ok: false, reason: "conflict" };
        // The stored age is the age on the assessment date, so that is the age the 18-110 range
        // applies to (a birth-date correction months into an assessment).
        if (!validProfile(input, date)) return { ok: false, reason: "invalid" };
        const seed: Answers = {};
        for (const [fieldId, value] of [
          ["q1.age", ageOn(input.birthDate, date)],
          ["q1.sex", input.biologicalSex],
        ] as const)
          seed[fieldId] = {
            fieldId,
            value,
            source: "manual",
            answeredAt: new Date().toISOString(),
          };
        // save_patient_profile merges the seed into the stored answers. A birth-date correction
        // that contradicts retained smoking years is accepted on purpose: the questionnaire then
        // reopens that answer as invalid and completion waits for the correction
        // (check-questionnaire-input-consistency.ts). Pruning removes nothing here while no showIf
        // reads q1.* (check-patient-service.ts guards that), so the evaluated set equals the stored merge.
        const updated = pruneAnswers({ ...state.assessment?.answers, ...seed }),
          urgentRule =
            firesEmergency({ answers: updated, observations: [] })?.id ?? null;
        const revision = await store.profile(
          user.userId,
          {
            name: normalizeName(input.name),
            birthDate: input.birthDate,
            biologicalSex: input.biologicalSex,
            locale: input.locale,
          },
          seed,
          state.assessment?.revision ?? -1,
          urgentRule,
        );
        return revision < 0
          ? { ok: false, reason: "conflict" }
          : { ok: true, revision };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async saveAnswers(input: {
      expectedAssessmentId?: string;
      expectedRevision: number;
      entries: Array<{ fieldId: string; value: FieldValue | null }>;
      /** answersFingerprint of the answers the caller holds once this batch is stored. */
      expectedAnswers?: string;
    }): Promise<SaveResult> {
      try {
        const ctx = await ready();
        if (
          !ctx ||
          !input ||
          !Number.isSafeInteger(input.expectedRevision) ||
          input.expectedRevision < 0
        )
          return { ok: false, reason: "invalid" };
        if (input.expectedAssessmentId !== undefined && input.expectedAssessmentId !== ctx.assessment.id)
          return { ok: false, reason: "conflict" };
        let answers: Answers;
        try {
          answers = mergeAnswers(ctx.assessment.answers, input.entries);
        } catch {
          return input.expectedRevision === ctx.assessment.revision
            ? { ok: false, reason: "invalid" }
            : { ok: false, reason: "conflict" };
        }
        const urgentRule =
          firesEmergency({ answers, observations: [] })?.id ?? null;
        const complete = assessmentProgress(answers).complete && urgentRule === null;
        if (input.expectedRevision !== ctx.assessment.revision) {
          // A retry of a save whose response was lost: the batch committed as the next revision, and
          // the stored answers are exactly the set the caller expects after it (not merely a set the
          // batch leaves unchanged: another session's edit, a red answer say, changes the stored set
          // and stays a conflict). Answer as that save did instead of a conflict the queue cannot
          // recover from. Any other mismatch is a competing edit.
          if (
            input.expectedRevision === ctx.assessment.revision - 1 &&
            typeof input.expectedAnswers === "string" &&
            input.expectedAnswers === answersFingerprint(ctx.assessment.answers) &&
            answersFingerprint(answers) === input.expectedAnswers
          )
            return { ok: true, revision: ctx.assessment.revision, ...(urgentRule ? { enrol: "urgent" as const } : complete ? { enrol: "completed" as const } : {}) };
          return { ok: false, reason: "conflict" };
        }
        const source = deps.answerSource?.() ?? null;
        const saved = [ctx.user.userId, input.expectedRevision, answers, complete, urgentRule] as const;
        const revision = source
          ? await ctx.store.assessment(...saved, Object.fromEntries(input.entries.map((entry) => [entry.fieldId, entry.value === null ? null : source])))
          : await ctx.store.assessment(...saved);
        // A finished questionnaire, or a red flag, enrols the member for the care team (caller).
        return revision < 0
          ? { ok: false, reason: "conflict" }
          : { ok: true, revision, ...(urgentRule ? { enrol: "urgent" as const } : complete ? { enrol: "completed" as const } : {}) };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async completeAssessment(expectedRevision: number, expectedAssessmentId?: string): Promise<CompleteResult> {
      try {
        const ctx = await ready();
        if (!ctx || !Number.isSafeInteger(expectedRevision))
          return { ok: false, reason: "invalid" };
        if (expectedAssessmentId !== undefined && expectedAssessmentId !== ctx.assessment.id)
          return { ok: false, reason: "conflict" };
        if (ctx.assessment.revision !== expectedRevision)
          return { ok: false, reason: "conflict" };
        let answers = pruneAnswers(ctx.assessment.answers);
        // The details answers are written by the profile save. An assessment that never had them (an account made before
        // that save wrote them, a seeded member) is repaired from the saved profile instead of failing the member at the last question.
        const profile = ctx.state.profile;
        if (!detailsAnswered(answers) && profile?.birthDate && profile.biologicalSex) {
          const age = ageOn(profile.birthDate, ctx.assessment.assessmentDate);
          if (Number.isFinite(age)) {
            const stamp = new Date().toISOString();
            answers = pruneAnswers({
              ...answers,
              "q1.age": { fieldId: "q1.age", value: age, source: "manual", answeredAt: stamp },
              "q1.sex": { fieldId: "q1.sex", value: profile.biologicalSex, source: "manual", answeredAt: stamp },
            });
          }
        }
        if (firesEmergency({ answers, observations: [] })) return { ok: false, reason: "invalid" };
        if (!assessmentProgress(answers).complete) {
          // The details answers come only from the registration profile; say so instead of a bare failure.
          return { ok: false, reason: "incomplete", missing: detailsAnswered(answers) ? "answers" : "profile" };
        }
        // Completion prunes too: an empty map still reconciles the stored sources with these answers.
        const saved = [ctx.user.userId, expectedRevision, answers, true, null] as const;
        const revision = deps.answerSource?.()
          ? await ctx.store.assessment(...saved, {})
          : await ctx.store.assessment(...saved);
        return revision < 0
          ? { ok: false, reason: "conflict" }
          : { ok: true, revision, enrol: "completed" };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async recordMeasurement(
      input: unknown,
    ): Promise<{ ok: boolean; reason?: "conflict" | "signed_out" }> {
      try {
        const ctx = await ready();
        if (!ctx) return (await deps.user()) ? { ok: false } : { ok: false, reason: "signed_out" };
        if (!validMeasurement(input)) return { ok: false };
        await ctx.store.measurement(ctx.user.userId, input);
        return { ok: true };
      } catch (error) {
        return error instanceof MeasurementConflict
          ? { ok: false, reason: "conflict" }
          : { ok: false };
      }
    },
  };
}

