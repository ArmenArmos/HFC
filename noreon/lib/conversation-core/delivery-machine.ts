import "server-only";
import type { AdapterCapabilities, ChannelAdapter, OutboundPayload } from "./channel-contract";
import { renderOutboundText } from "./channel-contract";
import { audit, replyContentHash, type AdapterId, type AttemptId, type AttemptOutcome, type CoreContext, type CoreState, type DeliveryId, type DeliveryIntent, type DeliveryState, type HoldReason } from "./contracts";
import { setHeld, staffMayActFor } from "./reply-machine";

/**
 * Sender side of the outbox. A delivery is claimable only from `queued`, and
 * nothing moves a delivery back to `queued`: there is no automatic resend,
 * fallback channel or reroute. `unknown` stays unknown until a separately
 * authorised reconciliation decision, which this module does not implement.
 *
 * `accepted_by_provider` means the transport accepted the request. It is not a
 * delivery or read receipt, and no state here claims either.
 */

export type ClaimResult =
  | { ok: true; payload: OutboundPayload }
  | { ok: false; code: "not_found" | "not_claimable"; state?: DeliveryState }
  | { ok: false; code: "held"; holdReason: HoldReason };

/** Everything that could have changed since approval is checked again here, against current state. */
function recheck(state: CoreState, ctx: CoreContext, delivery: DeliveryIntent, capabilities: (adapter: AdapterId) => AdapterCapabilities | undefined): HoldReason | null {
  if (!ctx.authority) return "authority_unavailable";
  const draft = state.drafts.get(delivery.draftId), conversation = state.conversations.get(delivery.conversationId);
  const approval = state.approvals.get(delivery.approvalId);
  if (!draft || !conversation || !approval || draft.status !== "approved" || !draft.approvalIds.includes(approval.id)
    || draft.current.revision !== delivery.revision || draft.current.contentHash !== delivery.contentHash
    || draft.current.body !== delivery.body || approval.draftId !== draft.id || approval.deliveryId !== delivery.id
    || approval.revision !== delivery.revision || approval.contentHash !== delivery.contentHash || approval.conversationVersion !== delivery.conversationVersion
    || replyContentHash(conversation.id, conversation.memberId, delivery.body) !== delivery.contentHash) return "approved_content_changed";
  if (conversation.version !== delivery.conversationVersion) return "newer_member_message";
  const approver = ctx.authority.staff(approval.approvedBy.staffId);
  if (!approver || staffMayActFor(ctx, approver, conversation)) return "approver_authority_lost";
  const principal = ctx.authority.principal(approval.via.adapter, approval.via.principalRef);
  if (!principal || principal.revoked || principal.kind !== "staff" || principal.staffId !== approver.staffId
    || principal.generation !== approval.via.linkGeneration) return "approver_authority_lost";
  const pinned = delivery.endpoint;
  if (!pinned) return "route_policy_missing";
  if (!ctx.routePolicy) return "route_policy_missing";
  if (ctx.routePolicy.version !== pinned.policyVersion || ctx.routePolicy.clinicalReplyEndpoint(delivery.memberId) !== pinned.endpointId || !ctx.routePolicy.clinicalReplyAllowed(pinned.adapter)) return "route_changed";
  const binding = ctx.authority.endpoint(pinned.endpointId);
  if (!binding || !binding.active || binding.memberId !== delivery.memberId || binding.adapter !== pinned.adapter
    || binding.generation !== pinned.generation || binding.address !== pinned.address) return "endpoint_rebound";
  const caps = capabilities(pinned.adapter);
  if (!caps?.plainText || caps.adapter !== pinned.adapter || !Number.isSafeInteger(caps.plainText.maxUtf16Units)
    || caps.plainText.maxUtf16Units < 1 || renderOutboundText({ body: delivery.body, approvedBy: approval.approvedBy }).length > caps.plainText.maxUtf16Units) return "capability_unsupported";
  return null;
}

export function claimDelivery(state: CoreState, ctx: CoreContext, deliveryId: DeliveryId, capabilities: (adapter: AdapterId) => AdapterCapabilities | undefined): ClaimResult {
  const delivery = state.deliveries.get(deliveryId);
  if (!delivery) return { ok: false, code: "not_found" };
  if (delivery.state !== "queued") {
    audit(state, ctx, "delivery.claim", "denied", { deliveryId, state: delivery.state });
    return { ok: false, code: "not_claimable", state: delivery.state };
  }
  const hold = recheck(state, ctx, delivery, capabilities);
  if (hold) {
    setHeld(state, ctx, delivery, hold);
    return { ok: false, code: "held", holdReason: hold };
  }
  const pinned = delivery.endpoint!;
  const approval = state.approvals.get(delivery.approvalId)!;
  const attempt = { id: ctx.newId("attempt") as AttemptId, seq: delivery.attempts.length + 1, claimedAt: ctx.now(), lateOutcomes: [] };
  delivery.attempts.push(attempt);
  delivery.state = "sending";
  delivery.stateSeq++;
  audit(state, ctx, "delivery.claim", "allowed", { deliveryId, attemptSeq: attempt.seq, endpointId: pinned.endpointId, generation: pinned.generation });
  return {
    ok: true,
    payload: Object.freeze({
      deliveryId, attemptId: attempt.id, attemptSeq: attempt.seq, endpointId: pinned.endpointId, address: pinned.address,
      generation: pinned.generation, body: delivery.body, contentHash: delivery.contentHash,
      approvalId: approval.id, approvedBy: Object.freeze({ ...approval.approvedBy }),
    }),
  };
}

const RESOLVED: Record<AttemptOutcome["kind"], DeliveryState> = {
  accepted: "accepted_by_provider", definitely_failed: "definitely_failed", unknown: "unknown", unsupported: "held",
};

/** Applies an outcome only to the current in-flight attempt; anything else is kept as evidence and not applied. */
export function recordOutcome(state: CoreState, ctx: CoreContext, ref: { deliveryId: DeliveryId; attemptId: AttemptId; attemptSeq: number }, outcome: AttemptOutcome): { applied: boolean; state?: DeliveryState } {
  const delivery = state.deliveries.get(ref.deliveryId);
  if (!delivery) return { applied: false };
  const attempt = delivery.attempts.find(a => a.id === ref.attemptId && a.seq === ref.attemptSeq);
  const current = attempt && attempt.seq === delivery.attempts.length && delivery.state === "sending" && !attempt.outcome;
  if (!current) {
    attempt?.lateOutcomes.push(outcome);
    audit(state, ctx, "delivery.outcome", "denied", { deliveryId: delivery.id, attemptSeq: ref.attemptSeq, outcome: outcome.kind, state: delivery.state, reason: attempt ? "not_current" : "unknown_attempt" });
    return { applied: false, state: delivery.state };
  }
  attempt.outcome = outcome;
  attempt.outcomeAt = ctx.now();
  if (outcome.kind === "unsupported") setHeld(state, ctx, delivery, "capability_unsupported");
  else { delivery.state = RESOLVED[outcome.kind]; delivery.stateSeq++; }
  audit(state, ctx, "delivery.outcome", "recorded", { deliveryId: delivery.id, attemptSeq: attempt.seq, outcome: outcome.kind, state: delivery.state });
  return { applied: true, state: delivery.state };
}

/** Claim, hand the pinned payload to its own adapter once, record the outcome. A thrown error is `unknown`. */
export async function runSender(state: CoreState, ctx: CoreContext, deliveryId: DeliveryId, adapters: ReadonlyMap<AdapterId, ChannelAdapter>): Promise<ClaimResult | { ok: true; state: DeliveryState }> {
  const claim = claimDelivery(state, ctx, deliveryId, adapter => adapters.get(adapter)?.capabilities());
  if (!claim.ok) return claim;
  const adapter = adapters.get(state.deliveries.get(deliveryId)!.endpoint!.adapter)!;
  let outcome: AttemptOutcome;
  try { outcome = await adapter.deliver(claim.payload); }
  catch { outcome = { kind: "unknown", reason: "adapter_threw" }; }
  const recorded = recordOutcome(state, ctx, claim.payload, outcome);
  return { ok: true, state: recorded.state! };
}

/**
 * Conservative recovery for a sender that stopped after claiming (for example a
 * crash after invoking the transport): an expired `sending` claim becomes
 * `unknown`, never `queued`. The lease is an explicit input with no default.
 */
export function expireSendingClaims(state: CoreState, ctx: CoreContext, leaseMs: number): DeliveryId[] {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw Error("An explicit positive claim lease is required.");
  const expired: DeliveryId[] = [];
  for (const delivery of state.deliveries.values()) {
    const attempt = delivery.attempts.at(-1);
    if (delivery.state !== "sending" || !attempt || ctx.now() - attempt.claimedAt <= leaseMs) continue;
    attempt.outcome = { kind: "unknown", reason: "claim_expired" };
    attempt.outcomeAt = ctx.now();
    delivery.state = "unknown";
    delivery.stateSeq++;
    audit(state, ctx, "delivery.claim_expired", "recorded", { deliveryId: delivery.id, attemptSeq: attempt.seq, state: "unknown" });
    expired.push(delivery.id);
  }
  return expired;
}
