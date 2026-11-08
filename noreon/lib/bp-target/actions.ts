"use server";
import { z } from "zod";
import { loggedAction } from "@/lib/observability/with-logging";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { readDoctorLdl, type LdlRpc } from "@/lib/ldl/runtime";
import type { DoctorLdl } from "@/lib/ldl/schema";
import { bpTargetsEnabled } from "@/lib/clinical-review/config";
import { canAny, rolesFromIdentities } from "@/lib/rbac/roles";
import { readDoctorBpTarget, runBpTargetSet, type BpTargetRpc } from "./runtime";
import type { BpTargetCommandResult, DoctorBpTargetRead } from "./schema";

export type TargetsCardRead =
  | { kind: "off" }
  | { kind: "access" }
  | { kind: "unavailable" }
  | { kind: "ready"; bp: DoctorBpTargetRead; ldl: DoctorLdl | null };

/**
 * The targets card in the doctor's member conversation. Any care-team member reads it; only the assigned family physician
 * or cardiologist gets canSet (the database decides). The LDL goal is read through the existing doctor LDL read.
 */
export const readTargetsCard = loggedAction("readTargetsCard", async function readTargetsCard(memberId: unknown): Promise<TargetsCardRead> {
  if (!bpTargetsEnabled()) return { kind: "off" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { kind: "unavailable" };
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor" && identity.role !== "nurse") return { kind: "access" };
  const [bp, ldl] = await Promise.all([
    readDoctorBpTarget(client as unknown as BpTargetRpc, id.data),
    identity.role === "doctor" ? readDoctorLdl(client as unknown as LdlRpc, id.data) : Promise.resolve(null),
  ]);
  return bp ? { kind: "ready", bp, ldl } : { kind: "unavailable" };
});

/** An explicit press on the card's confirm button. Nurses never reach the RPC; the database refuses anyone not a physician on the case. */
export const setBpTargetFromCard = loggedAction("setBpTargetFromCard", async function setBpTargetFromCard(input: unknown): Promise<BpTargetCommandResult> {
  if (!bpTargetsEnabled()) return { status: "access" };
  const { client, identity } = await requireRealStaff();
  // TS mirror of the SQL rule (target.set: family physician or cardiologist); the database also checks the assignment.
  if (!canAny(rolesFromIdentities({ staff: { role: identity.role, specialty: identity.specialty ?? null } }), "target.set")) return { status: "access" };
  return runBpTargetSet(client as unknown as BpTargetRpc, input);
});
