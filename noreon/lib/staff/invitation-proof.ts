import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const proofSchema = z.object({
  version: z.literal(2),
  purpose: z.literal("doctor-onboarding"),
  invitationId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.uuid(),
  generation: z.number().int().positive().safe(),
  stage: z.enum(["verified", "password_set"]),
  issuedAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type InvitationProof = z.infer<typeof proofSchema>;
type InvitationBinding = { id: string; generation: number; authUserId: string | null; expectedAuthUserId: string; status: string; expiresAt: string };
export function invitationProofMatches(proof: InvitationProof, context: InvitationBinding, userId: string, sessionId:string, now = Date.now()) {
  return proof.expiresAt > now && Date.parse(context.expiresAt) > now && context.status !== "revoked" &&
    proof.invitationId === context.id && proof.generation === context.generation && proof.userId === userId && proof.sessionId===sessionId &&
    context.authUserId === userId && context.expectedAuthUserId === userId;
}
type ProofInput = Pick<InvitationProof, "invitationId" | "userId" | "sessionId" | "generation" | "stage"> & { invitationExpiresAt: number };
const lifetime = 10 * 60_000;
function key(secret: string) {
  if (Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 256) throw Error("Invitation verification is unavailable.");
  return secret;
}
export function issueInvitationProof(input: ProofInput, secret: string, now = Date.now()) {
  const payload = proofSchema.parse({
    version: 2, purpose: "doctor-onboarding", invitationId: input.invitationId,
    userId: input.userId, sessionId:input.sessionId, generation: input.generation, stage: input.stage,
    issuedAt: now, expiresAt: Math.min(now + lifetime, input.invitationExpiresAt),
  });
  if (payload.expiresAt <= now) throw Error("Invitation expired.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key(secret)).update(body).digest("base64url");
  return `${body}.${signature}`;
}
export function verifyInvitationProof(value: string, secret: string, now = Date.now()): InvitationProof | null {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const [body, signature] = value.split(".");
    const expected = createHmac("sha256", key(secret)).update(body).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const parsed = proofSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.expiresAt <= now || parsed.data.issuedAt > now + 5_000 ||
        parsed.data.expiresAt <= parsed.data.issuedAt || parsed.data.expiresAt - parsed.data.issuedAt > lifetime) return null;
    return parsed.data;
  } catch { return null; }
}
