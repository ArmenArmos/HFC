/**
 * Pages a member may be sent on to after signing in (?next= on /patient). Only these exact paths:
 * the pages a one-tap Telegram link opens, so an expired link can still land on the same page.
 */
export const CONTINUE_PATHS = Object.freeze({
  next_profile: "/patient/profile", next_questionnaire: "/patient/questions", next_review: "/patient/review", replies_off: "/patient/account/telegram",
  open_care: "/patient/care", open_results: "/patient/results", open_home: "/patient/dashboard", open_progress: "/patient/progress",
  // Doctor replies and Zoe's Telegram replies: the member's thread.
  open_messages: "/patient/zoe", open_chat: "/patient/chat",
} as const);
export type ContinueStep = keyof typeof CONTINUE_PATHS;
/** Screens where a sign-in can end mid-task: the member comes back to them (BC-05). Telegram links never open these. */
const RETURN_PATHS = ["/patient/measurements/new", "/patient/medicines", "/patient/bp-week", "/patient/account"] as const;
const allowed: ReadonlySet<string> = new Set([...Object.values(CONTINUE_PATHS), ...RETURN_PATHS]);
/** The continue path if it is one of the allowed pages, otherwise null (never an open redirect). */
export function continuePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (allowed.has(value)) return value;
  // A push may open after the session expired. Carry only its opaque notice id,
  // never arbitrary query parameters or a destination supplied by the notification.
  return /^\/patient\/chat\?notice=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
/** Normal sign-in that continues to `path` afterwards; `linkExpired` shows a short note that the Telegram link has expired. */
export function signInContinuing(path: string | null | undefined, linkExpired = false): string {
  const q = new URLSearchParams();
  const next = continuePath(path);
  if (next) q.set("next", next);
  if (linkExpired) q.set("link", "expired");
  const s = q.toString();
  return s ? `/patient?${s}` : "/patient";
}
