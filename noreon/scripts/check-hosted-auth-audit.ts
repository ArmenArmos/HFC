import assert from "node:assert/strict";
import { inspectHostedAuth, safeAuthReport } from "./audit-hosted-auth";
const report = safeAuthReport({
  security_captcha_enabled: false,
  security_captcha_provider: "hcaptcha",
  rate_limit_token_refresh: 1800,
  sms_otp_exp: 60,
  smtp_pass: "DO_NOT_PRINT",
  jwt_secret: "DO_NOT_PRINT",
  security_captcha_secret: "DO_NOT_PRINT",
  external_phone_enabled: true,
});
assert.equal(report.settings.security_captcha_enabled, false);
assert.equal(report.settings.rate_limit_token_refresh, 1800);
assert.equal(report.settings.disable_signup, null);
assert.ok(!JSON.stringify(report).includes("DO_NOT_PRINT"));
assert.ok(report.observations.some((s) => s.includes("CAPTCHA is disabled")));
const malformed = safeAuthReport({
  security_captcha_enabled: "DO_NOT_PRINT",
  rate_limit_token_refresh: "DO_NOT_PRINT",
  security_captcha_provider: "DO_NOT_PRINT",
});
assert.ok(!JSON.stringify(malformed).includes("DO_NOT_PRINT"));
let calls = 0;
const read = async (url: string | URL | Request, options?: RequestInit) => {
  calls++;
  assert.equal(
    String(url),
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth",
  );
  assert.equal(options?.method, "GET");
  assert.equal(options?.redirect, "error");
  assert.equal(
    new Headers(options?.headers).get("Authorization"),
    "Bearer fictional",
  );
  return new Response(
    JSON.stringify({
      security_captcha_enabled: true,
      jwt_secret: "DO_NOT_PRINT",
    }),
    { status: 200 },
  );
};
assert.equal(
  (await inspectHostedAuth("abcdefghijklmnopqrst", "fictional", read)).settings
    .security_captcha_enabled,
  true,
);
assert.equal(calls, 1);
await assert.rejects(inspectHostedAuth("../bad", "fictional", read));
assert.equal(calls, 1);
await assert.rejects(
  inspectHostedAuth(
    "abcdefghijklmnopqrst",
    "fictional",
    async () => new Response("DO_NOT_PRINT", { status: 403 }),
  ),
  { message: "Hosted Auth audit unavailable" },
);
await assert.rejects(
  inspectHostedAuth("abcdefghijklmnopqrst", "fictional", async () => {
    throw Error("DO_NOT_PRINT");
  }),
  { message: "Hosted Auth audit unavailable" },
);

await assert.rejects(
  inspectHostedAuth(
    "abcdefghijklmnopqrst",
    "fictional",
    async () => new Response("x".repeat(1048577)),
  ),
  { message: "Hosted Auth audit unavailable" },
);
await assert.rejects(
  inspectHostedAuth(
    "abcdefghijklmnopqrst",
    "fictional",
    async () => new Response("not json DO_NOT_PRINT"),
  ),
  { message: "Hosted Auth audit unavailable" },
);

const phone = safeAuthReport({
  sms_test_otp: "123456789:DO_NOT_PRINT",
  sms_test_otp_valid_until: "2026-10-12T20:00:00Z",
  sms_max_frequency: 60,
  sms_provider: "twilio",
  security_refresh_token_reuse_interval: 10,
});
assert.equal(phone.settings.sms_test_otp_configured, true);
assert.equal(
  phone.settings.sms_test_otp_valid_until,
  "2026-10-12T20:00:00.000Z",
);
assert.equal(phone.settings.sms_max_frequency, 60);
assert.equal(phone.settings.sms_provider, "twilio");
assert.equal(phone.settings.security_refresh_token_reuse_interval, 10);
assert.ok(!JSON.stringify(phone).includes("DO_NOT_PRINT"));
assert.ok(!JSON.stringify(phone).includes("123456789"));
assert.equal(
  safeAuthReport({ sms_test_otp: "" }).settings.sms_test_otp_configured,
  false,
);
assert.equal(
  safeAuthReport({
    sms_provider: "DO_NOT_PRINT",
    sms_test_otp_valid_until: "DO_NOT_PRINT",
  }).settings.sms_test_otp_valid_until,
  null,
);



await assert.rejects(
  inspectHostedAuth(
    "abcdefghijklmnopqrst",
    "fictional",
    async () => new Response("DO_NOT_PRINT", { status: 403 }),
  ),
  (error) => {
    assert.equal((error as Error & { reason: string }).reason, "http_403");
    assert.ok(!JSON.stringify(error).includes("DO_NOT_PRINT"));
    return true;
  },
);

console.log(
  "Hosted Auth audit redaction, phone-OTP privacy, fixed GET destination and error handling passed",
);
