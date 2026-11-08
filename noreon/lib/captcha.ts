/**
 * The one place that decides whether sign-in asks for hCaptcha.
 *
 * One production setting, NOREON_CAPTCHA_ENABLED, independent of the pre-launch staging marker
 * (Khikar, 19 Oct 01:28: "we don't need captcha for now. When we really need it we will turn it
 * on. Keep it off in the seed data as well."):
 *  - "true": sign-in pages render the widget and server actions require a token. Needs
 *    NEXT_PUBLIC_HCAPTCHA_SITE_KEY (the build fails without it).
 *  - unset or "false": off. A startup warning says so in build and runtime logs.
 *  - anything else: the build fails, so a typo never decides the posture silently.
 * Supabase Auth's own hCaptcha setting (dashboard, Attack Protection) is separate and must match:
 * docs/operations/abuse-protection.md.
 *
 * Server only: the variable is not NEXT_PUBLIC, so a client bundle that imported this would see
 * CAPTCHA as off. Pages pass the result down as a prop.
 */
type Environment = Record<string, string | undefined>;

export const CAPTCHA_ENABLED = "NOREON_CAPTCHA_ENABLED";
/** Retired 19 Oct 2026 (replaced by NOREON_CAPTCHA_ENABLED); ignored, with a warning to remove it. */
export const LEGACY_CAPTCHA_STAGING_SWITCH = "NOREON_CAPTCHA_DISABLED_FOR_STAGING";

/** The setting holds a value other than unset, "", "true" or "false". */
export function captchaSettingInvalid(env: Environment = process.env): boolean {
  const value = env[CAPTCHA_ENABLED];
  return value !== undefined && value !== "" && value !== "true" && value !== "false";
}

/** True only when NOREON_CAPTCHA_ENABLED is exactly "true". */
export function captchaEnabled(env: Environment = process.env): boolean {
  return env[CAPTCHA_ENABLED] === "true";
}

/** The site key the sign-in widget should use, or "" when no widget renders. */
export function captchaSiteKey(env: Environment = process.env): string {
  if (!captchaEnabled(env)) return "";
  return env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? "";
}

/** Whether a sign-in request must carry a CAPTCHA token. */
export function captchaRequired(env: Environment = process.env): boolean {
  return captchaSiteKey(env) !== "";
}

/**
 * The warnings for this environment: an app deployment running without CAPTCHA, and the retired
 * staging variable still set. Local and test runs without a site key get none.
 */
export function captchaWarnings(env: Environment = process.env): string[] {
  const warnings: string[] = [];
  const deployed = env.NOREON_DEPLOYMENT_TARGET === "app" || Boolean(env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
  if (deployed && !captchaEnabled(env))
    warnings.push(
      `WARNING: hCaptcha is OFF on every sign-in page (${CAPTCHA_ENABLED} is not "true"). Owner decision 19 Oct 2026; set ${CAPTCHA_ENABLED}=true to turn it on (GO_LIVE_GATES F-5b).`,
    );
  if (env[LEGACY_CAPTCHA_STAGING_SWITCH] !== undefined && env[LEGACY_CAPTCHA_STAGING_SWITCH] !== "")
    warnings.push(`WARNING: ${LEGACY_CAPTCHA_STAGING_SWITCH} is retired and ignored; remove it (use ${CAPTCHA_ENABLED}).`);
  return warnings;
}

let warned = false;
/** Loud log lines, once per process (build and server start). Never a build error. */
export function warnIfCaptchaDisabled(env: Environment = process.env): void {
  if (warned) return;
  const warnings = captchaWarnings(env);
  if (!warnings.length) return;
  warned = true;
  for (const warning of warnings) console.warn(warning);
}
