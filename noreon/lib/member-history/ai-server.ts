import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { patientIdentity } from "@/lib/patient/auth";
import { labAiEnabled } from "@/lib/lab-ai/feature-config";
import { memberResultsSchema, type MemberResults } from "./lab-results";
import { editCommandSchema, identityCommandSchema, memberOverviewSchema, memberReadSchema, type MemberCommandResult, type MemberOverview, type MemberReading } from "./ai-reading";

type Rpc = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** The app side of the switch; the database's lab_ai_capabilities.member_upload_enabled decides as well. */
export const memberUploadAiEnabled = () => labAiEnabled();

async function member() {
  if (!memberUploadAiEnabled()) return null;
  const identity = await patientIdentity();
  return identity ? (await createClient()) as unknown as Rpc : null;
}

/** The signed-in member's uploads and their readings. Null means unreadable; `enabled: false` means off. */
export async function readOwnUploadReadings(): Promise<MemberOverview | null> {
  if (!memberUploadAiEnabled()) return { version: "member-upload-ai-v1", enabled: false, documents: [] };
  const c = await member().catch(() => null);
  if (!c) return null;
  try {
    const r = await c.rpc("member_upload_ai_overview");
    if (r.error) return null;
    const p = memberOverviewSchema.safeParse(r.data);
    return p.success ? p.data : null;
  } catch { return null; }
}

/** One upload's reading with its values, for the member to check. Null when unreadable or not theirs. */
export async function readOwnUploadReading(documentId: string): Promise<MemberReading | null> {
  if (!z.uuid().safeParse(documentId).success) return null;
  const c = await member().catch(() => null);
  if (!c) return null;
  try {
    const r = await c.rpc("member_upload_ai_read", { p_document: documentId });
    if (r.error) return null;
    const p = memberReadSchema.safeParse(r.data);
    return p.success && p.data.enabled && p.data.found ? p.data : null;
  } catch { return null; }
}

/** The member's results from their files: approved ones (or, with approval off, saved ones). Null when unreadable or off. */
export async function readOwnLabResults(): Promise<MemberResults | null> {
  const c = await member().catch(() => null);
  if (!c) return null;
  try {
    const r = await c.rpc("member_upload_results");
    if (r.error) return null;
    const p = memberResultsSchema.safeParse(r.data);
    return p.success && p.data.enabled ? p.data : null;
  } catch { return null; }
}

const commandResult = z.object({ status: z.enum(["saved", "invalid", "stale", "unchanged", "disabled", "unavailable"]) });
async function command(rpc: string, cmd: unknown): Promise<MemberCommandResult> {
  let c;
  try { c = await member(); } catch { return { status: "unavailable" }; }
  if (!c) return { status: "access" };
  try {
    const r = await c.rpc(rpc, { p_command: cmd });
    if (r.error) return { status: r.error.code === "42501" ? "access" : "unavailable" };
    const p = commandResult.safeParse(r.data);
    return p.success ? { status: p.data.status } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}
/** "Is this yours?" after a mismatch. Resending the same submission returns its recorded outcome. */
export async function answerOwnUploadIdentity(input: unknown): Promise<MemberCommandResult> {
  const cmd = identityCommandSchema.safeParse(input);
  return cmd.success ? command("member_upload_ai_identity", cmd.data) : { status: "invalid" };
}
/** Corrects or removes saved values. Resending the same submission returns its recorded outcome. */
export async function editOwnUploadReading(input: unknown): Promise<MemberCommandResult> {
  const cmd = editCommandSchema.safeParse(input);
  return cmd.success ? command("member_upload_ai_edit", cmd.data) : { status: "invalid" };
}
