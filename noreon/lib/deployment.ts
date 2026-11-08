/** Deployment rules. The public site's hosts never serve the member app (the demo was retired on 18 Oct 2026). */
import { phoneCodePolicy } from "./patient/phone-code-policy";
import { CAPTCHA_ENABLED, captchaEnabled, captchaSettingInvalid } from "./captcha";
import { aiSwitchErrors } from "./ai-posture";
type Environment = Record<string, string | undefined>;
export const MEMBER_APP_ORIGIN = 'https://app.noreon.health';
/**
 * How this host answers /patient: serve it, send it to the member app (the public site's
 * own hosts, so bookmarks and old links keep working), or not found (the retired demo host).
 */
export function memberAppAccess(host: string): 'serve' | 'redirect' | 'not-found' {
  const hostname = host.toLowerCase().split(':')[0];
  if (hostname === 'noreon.health' || hostname === 'www.noreon.health') return 'redirect';
  if (hostname === 'demo.noreon.health') return 'not-found';
  return 'serve';
}
export function deploymentErrors(env: Environment): string[] {
  const target = env.NOREON_DEPLOYMENT_TARGET;
  const errors: string[] = [];
  if (env.NOREON_SHARED_DEMO === "true") {
    if ((env.NOREON_WORKSPACE_SERVICE_ROLE_KEY?.length ?? 0) < 32) errors.push("Shared workspaces require a service key of at least 32 characters for admission signing");
    if (env.NEXT_PUBLIC_PATIENT_DEMO !== "true") errors.push("Shared workspaces require demo mode");
    for (const key of ["NOREON_WORKSPACE_SUPABASE_URL", "NOREON_WORKSPACE_ANON_KEY", "NOREON_WORKSPACE_SERVICE_ROLE_KEY"]) {
      if (!env[key]) errors.push(`Shared workspaces require ${key}`);
    }
  }
  // CAPTCHA and the AI posture are explicit settings (Khikar, 19 Oct): a typo fails the build rather than deciding silently.
  if (captchaSettingInvalid(env)) errors.push(`${CAPTCHA_ENABLED} must be "true" or "false"`);
  if (captchaEnabled(env) && !env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY) errors.push(`${CAPTCHA_ENABLED}=true requires NEXT_PUBLIC_HCAPTCHA_SITE_KEY`);
  errors.push(...aiSwitchErrors(env));
  if (!target) return errors; // Compatibility during the existing site's migration.
  if (!['app', 'marketing'].includes(target)) errors.push('Unknown NOREON_DEPLOYMENT_TARGET');
  if (target === 'app') {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (!env[key]) errors.push(`The real app requires ${key}`);
    }
  }
  if (target === 'app' && env.NOREON_REGISTRATION_ENABLED === 'true' && !phoneCodePolicy(env)) errors.push('Live registration requires an explicit configured phone-code provider and country scope');
  return errors;
}

export function realRegistrationReady(env: Environment): boolean {
  return env.NOREON_DEPLOYMENT_TARGET !== "app" || (env.NOREON_REGISTRATION_ENABLED === "true" && phoneCodePolicy(env) !== null);
}
