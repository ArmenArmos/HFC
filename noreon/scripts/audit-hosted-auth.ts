/** Read-only hosted inspection. Never print or persist the raw Auth config. */
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
type AuditFailureReason =
  | "invalid_project"
  | "missing_credential"
  | "invalid_payload"
  | "response_too_large"
  | "request_failed"
  | "execution_context"
  | `http_${number}`;
export class AuditFailure extends Error {
  readonly reason: AuditFailureReason;
  constructor(reason: AuditFailureReason) {
    super("Hosted Auth audit unavailable");
    this.reason = reason;
  }
}
const booleanFields = [
  "disable_signup",
  "external_anonymous_users_enabled",
  "external_email_enabled",
  "external_phone_enabled",
  "security_captcha_enabled",
  "security_sb_forwarded_for_enabled",
  "security_update_password_require_reauthentication",
  "password_hibp_enabled",
  "mailer_autoconfirm",
  "sms_autoconfirm",
  "refresh_token_rotation_enabled",
  "hook_password_verification_attempt_enabled",
  "hook_before_user_created_enabled",
  "hook_send_sms_enabled",
] as const;
const numberFields = [
  "rate_limit_anonymous_users",
  "rate_limit_email_sent",
  "rate_limit_sms_sent",
  "rate_limit_verify",
  "rate_limit_token_refresh",
  "rate_limit_otp",
  "password_min_length",
  "sms_otp_exp",
  "sms_otp_length",
  "jwt_exp",
  "security_refresh_token_reuse_interval",
  "sms_max_frequency",
  "sessions_timebox",
  "sessions_inactivity_timeout",
] as const;
export function safeAuthReport(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AuditFailure("invalid_payload");
  const input = raw as Record<string, unknown>,
    settings: Record<string, boolean | number | string | null> = {};
  for (const key of booleanFields)
    settings[key] =
      typeof input[key] === "boolean" ? (input[key] as boolean) : null;
  for (const key of numberFields)
    settings[key] =
      typeof input[key] === "number" &&
      Number.isSafeInteger(input[key]) &&
      Number(input[key]) >= 0
        ? (input[key] as number)
        : null;
  settings.security_captcha_provider = ["hcaptcha", "turnstile"].includes(
    String(input.security_captcha_provider),
  )
    ? String(input.security_captcha_provider)
    : null;
  settings.sms_provider = [
    "twilio",
    "twilio_verify",
    "messagebird",
    "textlocal",
    "vonage",
  ].includes(String(input.sms_provider))
    ? String(input.sms_provider)
    : null;
  settings.sms_test_otp_configured =
    typeof input.sms_test_otp === "string"
      ? input.sms_test_otp.trim().length > 0
      : null;
  const expiry = input.sms_test_otp_valid_until;
  settings.sms_test_otp_valid_until =
    typeof expiry === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      expiry,
    ) &&
    Number.isFinite(Date.parse(expiry))
      ? new Date(expiry).toISOString()
      : null;
  const observations: string[] = [];
  if (settings.sms_test_otp_configured === true)
    observations.push(
      "Test phone OTP entries are configured. Check their validity and remove fixed-code access before live member activation; no phone numbers or codes are included here.",
    );
  const unknown = Object.keys(settings).filter((key) => settings[key] === null);
  if (unknown.length)
    observations.push(
      `Unverified or absent fields (not evidence that a control is disabled): ${unknown.join(", ")}.`,
    );
  if (settings.security_captcha_enabled === false)
    observations.push(
      "CAPTCHA is disabled. Application throttling alone does not cover direct hosted Auth requests.",
    );
  if (settings.security_captcha_enabled === null)
    observations.push(
      "CAPTCHA configuration was not returned as a boolean; protection is unverified.",
    );
  if (settings.rate_limit_token_refresh === null)
    observations.push("The token-endpoint limit is unverified.");
  if (settings.external_anonymous_users_enabled === true)
    observations.push("Anonymous sign-in is enabled; confirm it is required.");
  if (settings.sms_autoconfirm === true)
    observations.push(
      "Phone auto-confirm is enabled; verified phone ownership requires investigation.",
    );
  if (settings.mailer_autoconfirm === true)
    observations.push(
      "Email auto-confirm is enabled; confirm the account-creation policy.",
    );
  observations.push(
    "These are configuration observations, not a runtime abuse test or a blanket security approval. Null means missing or unexpected type. No settings were changed and no OTP or sign-in was requested.",
  );
  return { settings, observations };
}
export async function inspectHostedAuth(
  project: string,
  token: string,
  request: typeof fetch = fetch,
) {
  if (!/^[a-z0-9]{20}$/.test(project))
    throw new AuditFailure("invalid_project");
  if (!token) throw new AuditFailure("missing_credential");
  try {
    const response = await request(
      `https://api.supabase.com/v1/projects/${project}/config/auth`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new AuditFailure(`http_${response.status}`);
    // Bound the sensitive response in memory and only expose fixed, typed fields.
    const reader = response.body?.getReader();
    if (!reader) throw new AuditFailure("invalid_payload");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1048576) {
        await reader.cancel();
        throw new AuditFailure("response_too_large");
      }
      chunks.push(value);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AuditFailure("invalid_payload");
    }
    return safeAuthReport(raw);
  } catch (error) {
    if (error instanceof AuditFailure) throw error;
    throw new AuditFailure("request_failed");
  }
}
async function main() {
  try {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_REF !== "refs/heads/main"
    )
      throw new AuditFailure("execution_context");
    const report = await inspectHostedAuth(
      process.env.SUPABASE_PROJECT_ID ?? "",
      process.env.SUPABASE_ACCESS_TOKEN ?? "",
    );
    const text = `## Hosted Auth configuration audit\n\nObserved at ${new Date().toISOString()}. Read-only; production target supplied by the existing deployment secret.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
  } catch (error) {
    const reason =
      error instanceof AuditFailure ? error.reason : "unexpected_error";
    console.error(
      `Hosted Auth audit unavailable (${reason}); no raw response or credentials were logged.`,
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  await main();
