import { parseNativeAdmission } from "@/lib/security/native-admission";
import {
  CONSENT_VERSION,
  createPatientService,
  type PatientStore,
} from "./service";
import type { FieldValue } from "@/lib/clinical/types";

type Context = {
  user: { userId: string; phone: string };
  store: PatientStore;
  admit: () => Promise<unknown>;
};
type Dependencies = {
  enabled: () => boolean;
  context: (token: string, signal: AbortSignal) => Promise<Context | null>;
  timeoutMs?: number;
};
class RequestFailure extends Error {}
function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return (
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((k) => allowed.includes(k))
  );
}
function revision(value: unknown, min = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}
function fail(reason = "invalid"): never {
  throw new RequestFailure(reason);
}
function active(signal: AbortSignal) {
  if (signal.aborted) fail("unavailable");
}
/** A stalled/non-cooperating dependency cannot keep the HTTP request open. */
export function untilAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RequestFailure("unavailable"));
    if (signal.aborted) {
      work.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
async function body(request: Request, signal: AbortSignal) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail();
  const reader = request.body?.getReader();
  if (!reader) fail();
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      active(signal);
      const part = await untilAbort(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) fail();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    fail();
  } finally {
    void reader.cancel().catch(() => {});
  }
}
/** Guard every transition to storage, including after a non-cooperating read. */
function guardedStore(store: PatientStore, signal: AbortSignal): PatientStore {
  async function run<T>(work: () => Promise<T>) {
    active(signal);
    const value = await untilAbort(work(), signal);
    active(signal);
    return value;
  }
  return {
    read: (id) => run(() => store.read(id)),
    profile: (...args) => run(() => store.profile(...args)),
    assessment: (...args) => run(() => store.assessment(...args)),
    measurement: (...args) => run(() => store.measurement(...args)),
  };
}
async function command(input: unknown, ctx: Context, signal: AbortSignal) {
  if (!object(input)) fail();
  const service = createPatientService({
    user: async () => {
      active(signal);
      return ctx.user;
    },
    store: () => guardedStore(ctx.store, signal),
  });
  if (input.type === "profile") {
    if (
      !keys(input, [
        "type",
        "profile",
        "consent",
        "consentVersion",
        "expectedRevision",
      ]) ||
      !object(input.profile) ||
      !keys(input.profile, ["name", "birthDate", "biologicalSex", "locale"]) ||
      input.consent !== true ||
      input.consentVersion !== CONSENT_VERSION ||
      !revision(input.expectedRevision, -1)
    )
      fail();
    return service.saveProfile(input.profile, true, input.expectedRevision);
  }
  if (input.type === "answers") {
    if (
      !keys(input, ["type", "entries", "expectedRevision"]) ||
      !revision(input.expectedRevision) ||
      !Array.isArray(input.entries) ||
      input.entries.length < 1 ||
      input.entries.length > 10 ||
      !input.entries.every(
        (e) =>
          object(e) &&
          keys(e, ["fieldId", "value"]) &&
          typeof e.fieldId === "string",
      )
    )
      fail();
    return service.saveAnswers({
      expectedRevision: input.expectedRevision,
      entries: input.entries as { fieldId: string; value: FieldValue | null }[],
    });
  }
  if (input.type === "complete") {
    if (
      !keys(input, ["type", "expectedRevision"]) ||
      !revision(input.expectedRevision)
    )
      fail();
    return service.completeAssessment(input.expectedRevision);
  }
  fail();
}
export function createNativeJourneyHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return json({ error: "disabled" }, 503);
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "method_not_allowed" }, 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return json({ error: "unauthorized" }, 401);
    const auth = request.headers.get("authorization");
    if (!auth || auth.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(auth))
      return json({ error: "unauthorized" }, 401);
    const controller = new AbortController(),
      signal = controller.signal;
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, deps.timeoutMs ?? 20000);
    try {
      active(signal);
      const ctx = await untilAbort(deps.context(auth.slice(7), signal), signal);
      active(signal);
      if (!ctx) fail("unauthorized");
      const admission = parseNativeAdmission(
        await untilAbort(ctx.admit(), signal),
      );
      active(signal);
      if (!admission.allowed)
        return json({ error: "rate_limited" }, 429, {
          "Retry-After": String(admission.retry_after),
        });
      if (request.method === "GET")
        return json({
          state: await guardedStore(ctx.store, signal).read(ctx.user.userId),
          consentVersion: CONSENT_VERSION,
        });
      const input = await body(request, signal);
      active(signal);
      const result = await untilAbort(command(input, ctx, signal), signal);
      active(signal);
      // The enrolment hint stays internal. The native app is not in the pilot and does not enrol
      // on finishing the questionnaire (its bearer session is not the web cookie the enrolment
      // RPC uses); its members use "request review" (Fable #277 F1).
      const payload = result.ok ? { ok: true as const, revision: result.revision } : result;
      return json(
        payload,
        result.ok
          ? 200
          : result.reason === "conflict"
            ? 409
            : result.reason === "invalid" || result.reason === "incomplete"
              ? 400
              : 503,
      );
    } catch (error) {
      const reason =
        error instanceof RequestFailure ? error.message : "unavailable";
      return json(
        { error: reason },
        reason === "unauthorized" ? 401 : reason === "invalid" ? 400 : 503,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      controller.abort();
    }
  };
}
