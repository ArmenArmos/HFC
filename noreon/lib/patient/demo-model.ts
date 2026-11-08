import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import type { PatientState, Measurement } from "./types";
import type { PatientStore } from "./service";
import { dateInArmenia } from "@/lib/patient/validation";
import { assessmentProgress, pruneAnswers } from "@/lib/patient/questionnaire";
import { MeasurementConflict } from "@/lib/patient/measurement-store";
export type DemoState = {
  version: 1;
  workspaceRevision?: number;
  acceptedReadingRevision?:number;
  monitoringEvidenceRevision?:number;
  reviewTasks?: import("@/lib/service-workflow/review-task").ReviewTask[];
  userId: string;
  expiresAt: number;
  state: PatientState;
  measurements: Measurement[];
  workflow?: import("@/lib/service-workflow/types").ServiceWorkflow;
  reminderPreferences?: import("@/lib/patient-care/reminders").SavedReminderPreferences;
  care?: {
    stage: import("@/lib/patient-care/types").DemoCareStage;
    events: import("@/lib/patient-care/types").DoseEvent[];
    acknowledged: boolean;
    acknowledgements?: {planId: string; at: string | null}[];
    anchorAt?: string;
  };
};
export function newDemoState(): DemoState {
  return {
    version: 1,
    userId: randomUUID(),
    expiresAt: Date.now() + 7 * 86400000,
    state: { profile: null, consentAccepted: false, assessment: null },
    measurements: [],
  };
}
function key(secret: string) {
  if (secret.length < 32) throw new Error("Demo encryption key unavailable");
  return createHash("sha256").update(secret).digest();
}
export type SharedDemoSession = {version: 2; kind: "shared-session"; userId: string; expiresAt: number};
function sealPayload(state: DemoState | SharedDemoSession, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const plain = brotliCompressSync(Buffer.from(JSON.stringify(state)));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function openDemoSession(
  token: string,
  secret: string,
  now = Date.now(),
): DemoState | SharedDemoSession | null {
  try {
    if (token.length > 24000) return null;
    const data = Buffer.from(token, "base64url"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        key(secret),
        data.subarray(0, 12),
      );
    decipher.setAuthTag(data.subarray(12, 28));
    const plain = brotliDecompressSync(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]),
      { maxOutputLength: 100000 },
    );
    const state = JSON.parse(plain.toString()) as DemoState | SharedDemoSession;
    if (state.version === 2) return state.kind === "shared-session" &&
      typeof state.userId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.userId) &&
      Number.isFinite(state.expiresAt) && state.expiresAt > now ? state : null;
    return state.version === 1 &&
      typeof state.userId === "string" &&
      state.expiresAt > now &&
      state.state &&
      Array.isArray(state.measurements)
      ? state
      : null;
  } catch {
    return null;
  }
}
export function sealDemoState(state: DemoState, secret: string) { return sealPayload(state,secret); }
export function sealSharedSession(state: Pick<DemoState,"userId" | "expiresAt">, secret: string) {
  return sealPayload({version:2,kind:"shared-session",userId:state.userId,expiresAt:state.expiresAt},secret);
}
export function openDemoState(token: string, secret: string, now=Date.now()): DemoState | null {
  const state=openDemoSession(token,secret,now);
  return state?.version===1 ? state : null;
}
export function localDemoToken(state: DemoState, secret: string): string {
  const message="Local demo storage is full. Your previous records are still available.";
  if (Buffer.byteLength(JSON.stringify(state),"utf8")>100000) throw new Error(message);
  const token=sealDemoState(state,secret);
  if (token.length>24000) throw new Error(message);
  return token;
}
export function demoStoreFor(
  data: DemoState,
  persist: (state: DemoState) => Promise<void>,
): PatientStore {
  const own = (id: string) => {
    if (id !== data.userId) throw new Error("Demo owner mismatch");
  };
  return {
    async read(id) {
      own(id);
      return data.state;
    },
    async profile(id, input, seed, revision, urgentRule) {
      own(id);
      const old = data.state.assessment;
      if ((old?.revision ?? -1) !== revision) return -1;
      const changed =
        data.state.profile?.birthDate !== input.birthDate ||
        data.state.profile?.biologicalSex !== input.biologicalSex;
      // Name/language edits are presentation changes, not a new assessment.
      if (old && !changed) {
        data.state.profile = { ...input, userId: id };
        data.state.consentAccepted = true;
        await persist(data);
        return old.revision;
      }
      const answers = pruneAnswers({ ...old?.answers, ...seed });
      data.state = {
        profile: { ...input, userId: id },
        consentAccepted: true,
        assessment: {
          id: old?.id ?? randomUUID(),
          revision: old ? old.revision + 1 : 0,
          assessmentDate: old?.assessmentDate ?? dateInArmenia(),
          answers,
          completedAt: assessmentProgress(answers).complete && urgentRule === null
            ? (old?.completedAt ?? null)
            : null,
          urgentRule,
        },
      };
      await persist(data);
      return data.state.assessment!.revision;
    },
    async assessment(id, revision, answers, complete, urgentRule) {
      own(id);
      const old = data.state.assessment;
      if (!old || old.revision !== revision) return -1;
      data.state.assessment = {
        ...old,
        revision: revision + 1,
        answers,
        completedAt: complete
          ? (old.completedAt ?? new Date().toISOString())
          : null,
        urgentRule,
      };
      await persist(data);
      return revision + 1;
    },
    async measurement(id, input) {
      own(id);
      const old = data.measurements.find(
        (m) => m.submissionId === input.submissionId,
      );
      if (old) {
        if (
          old.systolic !== input.systolic ||
          old.diastolic !== input.diastolic ||
          old.pulse !== input.pulse ||
          Date.parse(old.measuredAt) !== Date.parse(input.measuredAt)
        )
          throw new MeasurementConflict();
        return;
      }
      data.measurements = [
        { ...input, id: randomUUID(), source: "manual" as const },
        ...data.measurements,
      ]
        .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))
        .slice(0, 20);
      await persist(data);
    },
  };
}

/** Reset only the fictional questionnaire, retaining identity and measurements. */
export function restartedDemoQuestions(
  data: DemoState,
  expectedRevision: number,
): DemoState | null {
  const assessment = data.state.assessment;
  if (
    !Number.isInteger(expectedRevision) ||
    !assessment ||
    assessment.revision !== expectedRevision ||
    !data.state.profile ||
    !data.state.consentAccepted ||
    data.expiresAt <= Date.now()
  )
    return null;
  const next = structuredClone(data);
  next.state.assessment = {
    ...assessment,
    revision: assessment.revision + 1,
    answers: Object.fromEntries(
      Object.entries(assessment.answers).filter(([id]) => id.startsWith("q1.")),
    ),
    completedAt: null,
    urgentRule: null,
  };
  return next;
}
