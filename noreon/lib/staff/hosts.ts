import { realReviewEnabled } from "@/lib/patient-care/real-review-config";

type Environment = Record<string, string | undefined>;
export type StaffPortal = "doctor" | "admin";
export function staffPortalForHost(host: string): StaffPortal | null {
  const name = host.toLowerCase().split(":")[0];
  if (name === "doctors.noreon.health") return "doctor";
  if (BACKOFFICE_HOSTS.includes(name)) return "admin";
  return null;
}
/** The one staff and clinic domain and its alias (Khikar, 17 Oct): every role, one sign-in at "/". */
/** The test site's own staff host (3 Nov): set only in the staging Vercel environment, e.g. staging-backoffice.noreon.health. One *.noreon.health name, never a member or public-site host. */
function stagingStaffHost(env: Environment): string[] {
  const host = env.NOREON_STAGING_STAFF_HOST?.toLowerCase();
  const reserved = ["app", "www", "demo", "doctors"].map((name) => `${name}.noreon.health`);
  return host && /^[a-z0-9]+(?:-[a-z0-9]+)*\.noreon\.health$/.test(host) && !reserved.includes(host) ? [host] : [];
}
export const BACKOFFICE_HOSTS: readonly string[] = Object.freeze(["backoffice.noreon.health", "doctor.noreon.health", ...stagingStaffHost(globalThis.process?.env ?? {})]);
export function backofficeHost(host: string) {
  return BACKOFFICE_HOSTS.includes(host.toLowerCase().split(":")[0]);
}
export function staffHostAllowed(host: string, role?: StaffPortal | "nurse" | "coordinator", env: Environment = process.env) {
  const portal = staffPortalForHost(host);
  // One staff domain (Khikar, 17 Oct): backoffice serves every staff role, detected at sign-in.
  // doctors.noreon.health stays doctor/nurse only until its permanent redirect to backoffice.
  if (portal === "admin") return true;
  // A care coordinator works logistics, so belongs with the backoffice portal, never the doctors' host.
  if (portal) return !role || portal === (role === "nurse" ? "doctor" : role === "coordinator" ? "admin" : role);
  return env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}
/** Legacy workspaces require shared demo mode, including existing staff aliases during rollout. */
export function demoStaffHostAllowed(host: string, role?: StaffPortal | "nurse" | "coordinator", env: Environment = process.env) {
  if (env.NEXT_PUBLIC_PATIENT_DEMO !== "true" || env.NOREON_SHARED_DEMO !== "true" || env.NOREON_DEPLOYMENT_TARGET === "app" || env.NOREON_DEPLOYMENT_TARGET === "marketing") return false;
  const name = host.toLowerCase().split(":")[0];
  // The legacy demo keeps its portal split: on backoffice only the admin demo exists (review F-3).
  if (BACKOFFICE_HOSTS.includes(name) && role && role !== "admin") return false;
  return name === "demo.noreon.health" || staffHostAllowed(host, role, env);
}
export function isRealStaffPath(path: string) {
  return path === "/staff/real" || path.startsWith("/staff/real/");
}
/** Only old portal entry bookmarks may redirect; legacy data and actions stay blocked. */
export function legacyStaffEntryRedirect(host: string, path: string, method: string, env: Environment = process.env) {
  if ((method !== "GET" && method !== "HEAD") || !realReviewEnabled(env)) return null;
  const portal = staffPortalForHost(host);
  if ((portal === "doctor" && path === "/staff/doctor") ||
      (portal === "admin" && (path === "/staff/backoffice" || path === "/staff/backoffice/cases" || path === "/staff/doctor"))) {
    return "/staff/real/members";
  }
  return null;
}
export function staffPathAllowed(host: string, path: string, env: Environment = process.env) {
  const portal = staffPortalForHost(host);
  const staffPath = path === "/staff" || path.startsWith("/staff/");
  if (portal) {
    if (path === "/" || path === "/api/health" || path.startsWith("/_next/") || path === "/favicon.ico" || path === "/manifest.webmanifest" || /^\/icons\/icon-(192|512)\.png$/.test(path)) return true;
    if (isRealStaffPath(path)) return realReviewEnabled(env);
    if (!staffPath || !demoStaffHostAllowed(host, undefined, env)) return false;
    if (path === "/staff/backoffice" || path.startsWith("/staff/backoffice/")) return portal === "admin";
    if (path === "/staff/doctor" || path.startsWith("/staff/doctor/") || path === "/staff/nurse" || path.startsWith("/staff/nurse/")) return portal === "doctor";
    return true;
  }
  if (!staffPath) return true;
  if (isRealStaffPath(path)) return staffHostAllowed(host, undefined, env) && realReviewEnabled(env);
  return demoStaffHostAllowed(host, undefined, env);
}
