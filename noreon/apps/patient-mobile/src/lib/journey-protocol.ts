import type {
  PatientState,
  ProfileInput,
  SaveResult,
} from "../../../../lib/patient/types";
import type { FieldValue } from "../../../../lib/clinical/types";
export type JourneySnapshot = { state: PatientState; consentVersion: string };
export type JourneyCommand =
  | {
      type: "profile";
      profile: ProfileInput;
      consent: true;
      consentVersion: string;
      expectedRevision: number;
    }
  | {
      type: "answers";
      entries: { fieldId: string; value: FieldValue | null }[];
      expectedRevision: number;
    }
  | { type: "complete"; expectedRevision: number };
export type JourneyTransport = {
  read(signal: AbortSignal): Promise<JourneySnapshot>;
  write(command: JourneyCommand, signal: AbortSignal): Promise<SaveResult>;
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function nullableText(v: unknown) {
  return v === null || typeof v === "string";
}
export function parseJourneySnapshot(
  value: unknown,
  userId: string,
): JourneySnapshot {
  if (
    !object(value) ||
    value.consentVersion !== "patient-pilot-v1" ||
    !object(value.state)
  )
    throw Error("Journey unavailable");
  const { profile: p, assessment: a, consentAccepted: c } = value.state;
  if (
    typeof c !== "boolean" ||
    (p !== null &&
      (!object(p) ||
        p.userId !== userId ||
        typeof p.name !== "string" ||
        typeof p.birthDate !== "string" ||
        !["male", "female"].includes(String(p.biologicalSex)) ||
        !["en", "hy"].includes(String(p.locale))))
  )
    throw Error("Journey unavailable");
  if (a !== null) {
    if (
      !object(a) ||
      typeof a.id !== "string" ||
      !Number.isSafeInteger(a.revision) ||
      Number(a.revision) < 0 ||
      typeof a.assessmentDate !== "string" ||
      !nullableText(a.completedAt) ||
      !nullableText(a.urgentRule) ||
      !object(a.answers)
    )
      throw Error("Journey unavailable");
    for (const [id, answer] of Object.entries(a.answers)) {
      if (
        !object(answer) ||
        answer.fieldId !== id ||
        typeof answer.answeredAt !== "string" ||
        typeof answer.source !== "string"
      )
        throw Error("Journey unavailable");
      const v = answer.value;
      if (
        !(
          typeof v === "string" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (Array.isArray(v) && v.every((x) => typeof x === "string"))
        )
      )
        throw Error("Journey unavailable");
    }
  }
  return value as unknown as JourneySnapshot;
}
