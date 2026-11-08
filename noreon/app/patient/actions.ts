"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { completeVerifiedPhone } from "@/lib/messaging/twilio-verify-feedback";
import { requestTelegramCode, startTelegramProof, verifyTelegramCode } from "@/lib/telegram-auth/member-signin";
import { isTestSigninPhone, requestTestSigninCode, verifyTestSigninCode } from "@/lib/telegram-auth/test-signin";
import { cancelSigninLinks } from "@/lib/telegram-auth/signin-link";
import { realRegistrationReady } from "@/lib/deployment";
import { captchaRequired } from "@/lib/captcha";
import { rateLimit, recordRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/patient/validation";
import { phoneCodeAllowed, phoneCodePolicy, type PhoneCodePolicy } from "@/lib/patient/phone-code-policy";
import { patientIdentity } from "@/lib/patient/auth";
import { patientStore } from "@/lib/patient/repository";
import { createPatientService } from "@/lib/patient/service";
import { anamnesisSource } from "@/lib/patient/zoe-app-v3";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { setZoeConsent, zoeConsentPromptDue } from "@/lib/zoe/member";
import { enrolAfterQuestionnaire } from "@/lib/patient-care/enrolment";
import { bpStepAfterSave } from "@/lib/patient/bp-after-save";
import type { MeasurementInput, ProfileInput } from "@/lib/patient/types";
function service() {
  return createPatientService({ user: patientIdentity, store: patientStore, answerSource: anamnesisSource });
}
export const requestPhoneCode = loggedAction("requestPhoneCode",async function requestPhoneCode(input: string, captchaToken?: string, shownLink?: string) {
  const phone = normalizePhone(input);
  const testPhone = !!phone && isTestSigninPhone(phone);
  if (!testPhone && !realRegistrationReady(process.env)) return { ok: false, reason: "unavailable" as const };
  const policy = phoneCodePolicy(process.env);
  if (!testPhone && !policy) return { ok: false, reason: "unavailable" as const };
  if (!phone || (!testPhone && !phoneCodeAllowed(phone, policy!)) || (captchaRequired() && !captchaToken))
    return { ok: false, reason: "invalid" as const };
  // Every request counts against this network; the number's own quota counts only confirmed
  // sends (CAPTCHA passed), so a stranger cannot lock a member out by asking for their codes.
  try {
    const admitted = await rateLimit("member_code", [{ kind: "source" }, { kind: "phone", value: phone, mode: "peek" }]);
    if (!admitted.ok) return { ok: false, reason: "rate_limited" as const };
  } catch { return { ok: false, reason: "unavailable" as const }; }
  const sent = testPhone
    ? await requestTestSigninCode(phone, captchaToken).catch(() => ({ ok: false, reason: "unavailable" as const }))
    : await sendPhoneCode(phone, policy!, captchaToken, typeof shownLink === "string" ? shownLink : undefined);
  if (sent.ok) await recordRateLimit("member_code", [{ kind: "phone", value: phone }]);
  return sent;
});
async function sendPhoneCode(phone: string, policy: PhoneCodePolicy, captchaToken?: string, shownLink?: string) {
  if (policy.provider === "telegram-hook") {
    // Includes pending: leave the current step and retry timing to the member page.
    try { return await requestTelegramCode(phone, captchaToken, shownLink); }
    catch { return { ok: false, reason: "unavailable" as const }; }
  }
  try {
    const client = await createClient();
    const { error } = await client.auth.signInWithOtp({
      phone,
      options: { captchaToken, channel: policy.authChannel },
    });
    return error ? { ok: false, reason: "unavailable" as const } : { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" as const };
  }
}
/** Telegram codes only: confirm the number from another Telegram account. */
export const switchTelegramAccount = loggedAction("switchTelegramAccount",async function switchTelegramAccount(input: string) {
  if (!realRegistrationReady(process.env)) return { ok: false, reason: "unavailable" as const };
  const phone = normalizePhone(input);
  const policy = phoneCodePolicy(process.env);
  if (!phone || !policy || policy.provider !== "telegram-hook" || isTestSigninPhone(phone) || !phoneCodeAllowed(phone, policy)) return { ok: false, reason: "unavailable" as const };
  try {
    if (!(await rateLimit("member_code", [{ kind: "source" }])).ok) return { ok: false, reason: "rate_limited" as const };
    return await startTelegramProof(phone);
  }
  catch { return { ok: false, reason: "unavailable" as const }; }
});
export const verifyPhoneCode = loggedAction("verifyPhoneCode",async function verifyPhoneCode(input: string, code: string) {
  const phone = normalizePhone(input);
  const testPhone = !!phone && isTestSigninPhone(phone);
  if (!testPhone && !realRegistrationReady(process.env)) return { ok: false };
  if (!phone || typeof code !== "string" || !/^\d{6}$/.test(code))
    return { ok: false };
  const policy = phoneCodePolicy(process.env);
  if (!testPhone && (!policy || !phoneCodeAllowed(phone, policy))) return { ok: false };
  // Wrong guesses are also bounded per code and per number in the database; this caps one network.
  try {
    if (!(await rateLimit("member_verify", [{ kind: "source" }])).ok) return { ok: false, reason: "rate_limited" as const };
  } catch { return { ok: false, reason: "unavailable" as const }; }
  if (testPhone) {
    try { return await verifyTestSigninCode(phone, code); }
    catch { return { ok: false }; }
  }
  if (policy!.provider === "telegram-hook") {
    try { return await verifyTelegramCode(phone, code); }
    catch { return { ok: false }; }
  }
  try {
    const client = await createClient();
    const result = await client.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    return { ok: policy!.provider === "twilio-verify-hook" ? await completeVerifiedPhone(phone, code, result) : !result.error };
  } catch {
    return { ok: false };
  }
});
export const saveProfile = loggedAction("saveProfile",async function saveProfile(input: ProfileInput, consent: boolean, expectedRevision: number, withZoe?: boolean) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < -1)
    return { ok: false, reason: "invalid" as const };
  const result = await service().saveProfile(input, consent, expectedRevision);
  // Enrolment "Agree and continue" (not "Continue without Zoe"): also record Zoe reading messages
  // (source 'enrolment'). The server re-checks that the statement is due right now (Fable F4)
  // rather than trusting the form, and the database accepts it only as the member's first Zoe
  // decision right after the enrolment consent. A failure leaves no decision: the Home card asks.
  // "Continue without Zoe" (or Enter) with the statement shown records a no (Gohar D-011, lead 19 Oct
  // 23:10), so the Home card does not ask again; the member can still turn Zoe on in Me or on the Zoe
  // screen. Same server re-check; a failure leaves no decision, as before.
  if (result.ok && typeof withZoe === "boolean" && expectedRevision === -1 && await zoeConsentPromptDue())
    await setZoeConsent("zoe_reads_messages", withZoe, "enrolment").catch(() => null);
  if (result.ok) revalidatePath("/patient", "layout");
  return result;
});
export const completeAssessment = loggedAction("completeAssessment",async function completeAssessment(revision: number, expectedAssessmentId?: string) {
  const result = await service().completeAssessment(revision, expectedAssessmentId);
  if (!result.ok) return result;
  // Khikar 18 Oct: finishing the questionnaire puts the member in the backoffice (case + doctor).
  const reason = result.enrol;
  if (reason) after(() => enrolAfterQuestionnaire(reason));
  revalidatePath("/patient", "layout");
  return { ok: true as const, revision: result.revision };
});
export const recordMeasurement = loggedAction("recordMeasurement",async function recordMeasurement(input: unknown) {
  const result = await service().recordMeasurement(input);
  if (!result.ok) return result;
  revalidatePath("/patient/dashboard");
  revalidatePath("/patient/measurements");
  const { systolic, diastolic, measuredAt } = input as MeasurementInput;
  const client = (await createClient()) as unknown as { rpc(name: string, args: unknown): PromiseLike<{ data: unknown; error: unknown }> };
  return { ...result, bp: await bpStepAfterSave((name, args) => Promise.resolve(client.rpc(name, args)).then(r => { if (r.error) throw new Error("Reading read failed"); return r.data; }), null, { systolic, diastolic, measuredAt }) };
});
export const signOut = loggedAction("signOut",async function signOut() {
  // Telegram one-tap links still in the member's chat stop working too (review F-2); best effort.
  const identity = await patientIdentity().catch(() => null);
  if (identity) await cancelSigninLinks(identity.userId);
  const client = await createClient();
  // This device only. The default (global) also ended the member's other sessions, so signing
  // out in Safari signed the installed home-screen app out too (FINDINGS 17 Oct 2026).
  const { error } = await client.auth.signOut({ scope: "local" });
  return { ok: !error };
});

