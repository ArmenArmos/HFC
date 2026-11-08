"use server";
import { z } from "zod";
import { loggedAction } from "@/lib/observability/with-logging";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { riskTiersEnabled } from "@/lib/clinical-review/config";
import { readMemberRiskTier, readWorklist, type WorklistRpc } from "./server";
import { WORKLIST_CARD_LIMIT, type WorklistRead } from "./schema";

const ROLES = new Set(["nurse", "doctor", "coordinator", "admin"]);

/** The worklist chat card. Words or the chip only open it; it writes nothing but the audit of the read. */
export const readCareTeamWorklist = loggedAction("readCareTeamWorklist", async function readCareTeamWorklist(): Promise<WorklistRead> {
  if (!riskTiersEnabled()) return { kind: "off" };
  const { client, identity } = await requireRealStaff();
  if (!ROLES.has(identity.role)) return { kind: "access" };
  return readWorklist(client as unknown as WorklistRpc, WORKLIST_CARD_LIMIT);
});

/** The tier badge in a staff member header. Null when off, none yet or refused. */
export const readMemberTierBadge = loggedAction("readMemberTierBadge", async function readMemberTierBadge(memberId: unknown) {
  if (!riskTiersEnabled()) return null;
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return null;
  const { client, identity } = await requireRealStaff();
  if (!ROLES.has(identity.role)) return null;
  return readMemberRiskTier(client as unknown as WorklistRpc, id.data);
});
