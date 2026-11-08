import "server-only";
import { workspaceAdmin } from "@/lib/staff/auth";
import { MeasurementConflict } from "./measurement-store";
import { normalizeSharedWorkflow } from "@/lib/service-workflow/normalization";
import { reconcileLocalReview } from "@/lib/service-workflow/local-review";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  newDemoState,
  restartedDemoQuestions,
  openDemoSession,
  sealSharedSession,
  localDemoToken,
  demoStoreFor,
  type DemoState,
} from "./demo-model";
import type { PatientStore } from "./service";
import { findWorkspaceCase, persistWorkspaceCase, sharedDemoEnabled } from "@/lib/staff/cases";
export const DEMO_PHONE = "+37499000000";
const prefix = "noreon-demo-",
  chunks = 8;
export function demoEnabled() {
  return process.env.NEXT_PUBLIC_PATIENT_DEMO === "true";
}
export async function readDemoSnapshot() {
  if (!demoEnabled() || (process.env.NOREON_DEMO_SECRET?.length ?? 0) < 32)
    return null;
  const jar = await cookies();
  let token = "";
  for (let i = 0; i < chunks; i++) {
    const part = jar.get(prefix + i)?.value;
    if (!part) break;
    token += part;
  }
  const session = token ? openDemoSession(token, process.env.NOREON_DEMO_SECRET!) : null;
  if (!session) return null;
  if (!sharedDemoEnabled()) return session.version === 1 ? {state:session,workspaceCase:null} : null;
  const saved = await findWorkspaceCase(session.userId);
  // A cookie that already referred to shared storage must never resurrect a deleted case.
  // The old browser-only consent did not cover shared storage. Start a fresh demo
  // instead of silently uploading that old case when shared mode is enabled.
  return saved ? {state:saved.state,workspaceCase:saved} : null;
}
export async function readDemo() {
  return (await readDemoSnapshot())?.state ?? null;
}
export async function saveDemo(data: DemoState) {
  normalizeSharedWorkflow(data);
  const shared = sharedDemoEnabled();
  if (!shared) {
    const previous = await readDemo();
    reconcileLocalReview(previous,data,new Date().toISOString(),randomUUID());
  }
  // Preflight before the database write: never report a post-commit cookie-size failure.
  const secret = process.env.NOREON_DEMO_SECRET ?? "";
  const token = shared ? sealSharedSession(data,secret) : localDemoToken(data,secret);
  if (shared) await persistWorkspaceCase(data);
  await writeDemoToken(token,data.expiresAt);
}
/** Preserve the complete cookie snapshot for a locale-only preference. */
export async function saveLocalDemoPreference(data: DemoState) {
  if (!demoEnabled() || sharedDemoEnabled()) throw new Error("Local demo unavailable");
  await writeDemoToken(localDemoToken(data, process.env.NOREON_DEMO_SECRET ?? ""), data.expiresAt);
}
/** Upgrade a legacy shared cookie before a narrow database command. */
export async function refreshSharedDemoSession(data: DemoState) {
  if (!sharedDemoEnabled()) throw new Error("Shared session unavailable");
  await writeDemoToken(sealSharedSession(data,process.env.NOREON_DEMO_SECRET ?? ""),data.expiresAt);
}
async function writeDemoToken(token: string, expiresAt: number) {
  const jar = await cookies();
  for (let i = 0; i < chunks; i++) {
    const value = token.slice(i * 3000, (i + 1) * 3000);
    jar.set(prefix + i, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/patient",
      maxAge: value
        ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
        : 0,
    });
  }
}
export async function demoSignIn(phone: string, code: string) {
  if (!demoEnabled() || phone !== DEMO_PHONE || code !== "123456") return false;
  await saveDemo((await readDemo()) ?? newDemoState());
  return true;
}
export async function demoSignOut() {
  const jar = await cookies();
  for (let i = 0; i < chunks; i++)
    jar.delete({ name: prefix + i, path: "/patient" });
}
export function demoStore(): PatientStore {
  const run = async () => {
    const data = await readDemo();
    if (!data) throw new Error("Demo session missing");
    return demoStoreFor(data, saveDemo);
  };
  return {
    read: async (id) => (await run()).read(id),
    profile: async (...args) => (await run()).profile(...args),
    assessment: async (...args) => (await run()).assessment(...args),
    measurement: async (id,input) => {
      if(!sharedDemoEnabled()) return (await run()).measurement(id,input);
      const data=await readDemo();
      if(!data || data.userId!==id) throw new Error("Demo session missing");
      await refreshSharedDemoSession(data);
      const result=await workspaceAdmin().rpc("workspace_accept_reading",{p_id:id,p_submission:input.submissionId,p_measured_at:input.measuredAt,p_systolic:input.systolic,p_diastolic:input.diastolic,p_pulse:input.pulse});
      if(result.error) {
        if(result.error.message.includes("measurement conflict")) throw new MeasurementConflict();
        throw new Error("This reading could not be saved. Try again.");
      }
    },
  };
}

export async function restartDemoQuestions(expectedRevision: number) {
  if (!demoEnabled())
    return { ok: false as const, reason: "unavailable" as const };
  const data = await readDemo();
  if (!data) return { ok: false as const, reason: "unavailable" as const };
  const next = restartedDemoQuestions(data, expectedRevision);
  if (!next) return { ok: false as const, reason: "conflict" as const };
  await saveDemo(next);
  return { ok: true as const };
}
