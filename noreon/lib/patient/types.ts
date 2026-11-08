import type { Answers } from "@/lib/clinical/types";
import type { Locale } from "@/lib/locale";
export type PatientProfile = {
  userId: string;
  name: string;
  birthDate: string;
  biologicalSex: "male" | "female";
  locale: Locale;
};
export type ProfileInput = Omit<PatientProfile, "userId">;
export type AssessmentDraft = {
  id: string;
  revision: number;
  assessmentDate: string;
  answers: Answers;
  completedAt: string | null;
  urgentRule: string | null;
};
export type PatientState = {
  profile: PatientProfile | null;
  consentAccepted: boolean;
  assessment: AssessmentDraft | null;
};
export type MeasurementInput = {
  /** Provenance only. Never changes validation or escalation. */
  photoConfirmed?: boolean;
  submissionId: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  measuredAt: string;
};
export type Measurement = MeasurementInput & { id: string; acceptedAt?:string; entrySource?:string|null; source: "manual" };
export type SaveResult =
  | { ok: true; revision: number; enrol?: "completed" | "urgent" }
  | { ok: false; reason: "invalid" | "conflict" | "unavailable" | "signed_out" };
/** Finishing the questionnaire also says when answers are missing: the details answers (age, sex) that come from the registration profile, or a question answered with a value that no longer counts. */
export type CompleteResult = SaveResult | { ok: false; reason: "incomplete"; missing: "profile" | "answers" };
