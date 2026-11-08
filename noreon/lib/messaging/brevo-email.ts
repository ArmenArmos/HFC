import "server-only";
import { z } from "zod";

const configSchema = z.object({ apiKey: z.string().min(20).max(1024), sender: z.email().max(320), origin: z.url().max(200) });
const inputSchema = z.object({ role: z.enum(["doctor", "nurse"]).default("doctor"), name: z.string().trim().min(1).max(180), email: z.email().max(320), url: z.url().max(1500) });
export type BrevoEmailConfig = z.infer<typeof configSchema>;
export type EmailSubmission = { status: "accepted"; reference: string } | { status: "failed" | "unknown" };
export function doctorInvitationOrigin(env: Record<string, string | undefined> = process.env) {
  const origin = new URL(env.NOREON_STAFF_INVITATION_ORIGIN ?? "https://backoffice.noreon.health");
  // backoffice is the one staff domain; doctors.noreon.health redirects there (17 Oct).
  const canonical = origin.origin === "https://backoffice.noreon.health" || origin.origin === "https://doctors.noreon.health";
  const local = env.NODE_ENV !== "production" && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
  if ((!canonical && !local) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw Error("Invitation delivery is unavailable.");
  return origin.origin;
}
export function parseBrevoEmailConfig(value: unknown): BrevoEmailConfig {
  return configSchema.parse(value);
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
async function sendStaffEmail(config: BrevoEmailConfig, value: unknown, recovery: boolean, fetchImpl: typeof fetch, timeoutMs: number): Promise<EmailSubmission> {
  const checked = configSchema.parse(config), input = inputSchema.parse(value), url = new URL(input.url);
  if (url.origin !== checked.origin || url.username || url.password || url.pathname !== (recovery ? "/staff/real/recover" : "/staff/real/invite") || url.search || !url.hash) throw Error("Invalid invitation destination.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw Error("Invalid email timeout.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<EmailSubmission>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ status: "unknown" }); }, timeoutMs);
  });
  const operation = (async (): Promise<EmailSubmission> => {
    try {
      const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "api-key": checked.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "Noreon", email: checked.sender }, to: [{ email: input.email, name: input.name }],
          subject: recovery ? "Reset your Noreon password" : `Set up your Noreon ${input.role} account`,
          htmlContent: recovery ? `<h1>Noreon</h1><h2>Reset your password</h2><p>Hello ${escapeHtml(input.name)},</p><p>Your administrator requested password recovery for your Noreon ${input.role} account.</p><p><a href="${escapeHtml(input.url)}">Reset your password</a></p><p>Open this link to verify your email and choose a new password. This link expires within one hour. If you were not expecting this, contact your administrator.</p>` : `<h1>Noreon</h1><h2>Your ${input.role} workspace</h2><p>Hello ${escapeHtml(input.name)},</p><p>You have been invited to Noreon as a ${input.role}.</p><p><a href="${escapeHtml(input.url)}">Set up your ${input.role} account</a></p><p>Verify your email and choose your own password. This invitation expires within one hour. If you were not expecting it, you can ignore this email.</p>`,
          textContent: recovery ? `Hello ${input.name},\n\nYour administrator requested password recovery for your Noreon ${input.role} account.\nReset your password: ${input.url}\n\nOpen this link to verify your email and choose a new password. This link expires within one hour. If you were not expecting this, contact your administrator.` : `Hello ${input.name},\n\nYou have been invited to Noreon as a ${input.role}.\nSet up your ${input.role} account: ${input.url}\n\nVerify your email and choose your own password. This invitation expires within one hour. If you were not expecting it, you can ignore this email.`,
        }),
      });
      if (!response.ok) return { status: response.status >= 500 ? "unknown" : "failed" };
      const receipt = z.object({ messageId: z.string().min(1).max(255) }).safeParse(await response.json());
      return receipt.success ? { status: "accepted", reference: receipt.data.messageId } : { status: "unknown" };
    } catch { return { status: "unknown" }; }
  })();
  try { return await Promise.race([operation, timedOut]); }
  finally { clearTimeout(timer); }
}

export function sendDoctorInvitation(config: BrevoEmailConfig, value: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<EmailSubmission> {
  return sendStaffEmail(config, value, false, fetchImpl, timeoutMs);
}
export function sendStaffPasswordRecovery(config: BrevoEmailConfig, value: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<EmailSubmission> {
  return sendStaffEmail(config, value, true, fetchImpl, timeoutMs);
}
