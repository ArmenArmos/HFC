import "server-only";
import type { ActionView, VerifiedEnvelope } from "./channel-contract";
import {
  audit, canonicalHash, commandSchema, COMMAND_PURPOSES, MAX_REPLY_LENGTH, replyContentHash,
  type ApprovalId, type ApprovalIntent, type ClinicId, type Command, type CommandPurpose, type CommandSuccess, type Conversation,
  type ConversationId, type CoreContext, type CoreState, type Denial, type DenialCode, type DeliveryId, type DeliveryIntent,
  type DraftId, type HoldReason, type IntentId, type MemberId, type PinnedEndpoint, type ReplyDraft, type RequestId, type StaffRecord,
} from "./contracts";

/**
 * Reply commands shared by every entry point. Noreon staff web and Telegram call
 * these same functions; nothing here branches on which adapter is calling.
 *
 * Each command validates completely before its first write, so in this
 * single-threaded in-memory form a command is all-or-nothing. A durable store
 * must provide the same property with a transaction and row-level arbitration;
 * that guarantee is not demonstrated by this module.
 */

export type ActorRef = Pick<VerifiedEnvelope, "adapter" | "principalRef" | "forwarded">;
type Actor = { staff: StaffRecord; generation: number };

const deny = (state: CoreState, ctx: CoreContext, kind: string, code: DenialCode, detail: Record<string, string | number | boolean> = {}): Denial => {
  audit(state, ctx, kind, "denied", { code, ...detail });
  return { ok: false, code };
};

const LABELS: Record<CommandPurpose, string> = {
  "reply.approve": "Approve and send this exact reply",
  "reply.edit": "Edit reply",
  "reply.reject": "Reject reply",
  "reply.request_info": "Ask the assistant to gather more information",
};

export function openConversation(state: CoreState, ctx: CoreContext, input: { conversationId: ConversationId; memberId: MemberId; clinicId: ClinicId }) {
  if (state.conversations.has(input.conversationId)) throw Error("Conversation already exists.");
  state.conversations.set(input.conversationId, { id: input.conversationId, memberId: input.memberId, clinicId: input.clinicId, version: 0, messages: [], reviewAfterSend: [] });
  audit(state, ctx, "conversation.open", "recorded", { conversationId: input.conversationId });
}

const conversationOf = (state: CoreState, memberId: MemberId) => [...state.conversations.values()].find(c => c.memberId === memberId);
const latestDraft = (state: CoreState, conversationId: ConversationId) => [...state.drafts.values()].filter(d => d.conversationId === conversationId).at(-1);

function invalidateIntents(state: CoreState, predicate: (intent: ApprovalIntent) => boolean, reason: string) {
  let count = 0;
  for (const intent of state.intents.values()) if (intent.state === "open" && predicate(intent)) { intent.state = "invalidated"; intent.invalidatedBy = reason; count++; }
  return count;
}

/**
 * Member text is appended as inert data and never interpreted. It advances the
 * conversation version, which invalidates pending intents and holds an approved
 * reply that has not been claimed for sending. A reply already handed to a
 * transport cannot be recalled; that ordering is recorded for review instead.
 */
export function receiveMemberMessage(state: CoreState, ctx: CoreContext, envelope: VerifiedEnvelope): { ok: true; duplicate: boolean } | Denial {
  if (!ctx.authority) return deny(state, ctx, "member.message", "authority_unavailable");
  if (envelope.kind !== "text") return deny(state, ctx, "member.message", "invalid_command");
  const dedupe = JSON.stringify([envelope.adapter, envelope.eventId]);
  const binding = ctx.authority.principal(envelope.adapter, envelope.principalRef);
  if (!binding || binding.revoked) return deny(state, ctx, "member.message", "principal_unknown");
  if (binding.kind !== "member") return deny(state, ctx, "member.message", "not_member");
  const conversation = conversationOf(state, binding.memberId);
  if (!conversation) return deny(state, ctx, "member.message", "conversation_unknown");
  if (state.seenEvents.has(dedupe)) return { ok: true, duplicate: true };

  state.seenEvents.add(dedupe);
  conversation.version++;
  const seq = conversation.messages.length + 1;
  conversation.messages.push({ seq, author: "member", text: envelope.text, at: ctx.now(), source: { adapter: envelope.adapter, eventId: envelope.eventId, forwarded: envelope.forwarded } });
  const draftIds = new Set([...state.drafts.values()].filter(d => d.conversationId === conversation.id).map(d => d.id));
  const invalidated = invalidateIntents(state, i => draftIds.has(i.draftId), "newer_member_message");
  audit(state, ctx, "member.message", "recorded", { conversationId: conversation.id, seq, version: conversation.version, intentsInvalidated: invalidated });

  for (const delivery of state.deliveries.values()) {
    if (delivery.conversationId !== conversation.id) continue;
    if (delivery.state === "queued") {
      setHeld(state, ctx, delivery, "newer_member_message");
      const draft = state.drafts.get(delivery.draftId)!;
      if (draft.status === "approved" && draft.current.revision === delivery.revision) { draft.status = "pending"; draft.reopenedReason = "newer_member_message"; }
    } else if (delivery.state === "sending") {
      const attempt = delivery.attempts.at(-1)!;
      attempt.memberMessageDuringSend ??= seq;
      if (!conversation.reviewAfterSend.includes(delivery.id)) conversation.reviewAfterSend.push(delivery.id);
      audit(state, ctx, "delivery.send_already_started", "recorded", { deliveryId: delivery.id, attemptSeq: attempt.seq, memberMessageSeq: seq });
    }
  }
  return { ok: true, duplicate: false };
}

export function setHeld(state: CoreState, ctx: CoreContext, delivery: DeliveryIntent, reason: HoldReason) {
  delivery.state = "held";
  delivery.holdReason = reason;
  delivery.stateSeq++;
  audit(state, ctx, "delivery.held", "recorded", { deliveryId: delivery.id, reason });
}

/** AI output becomes a pending draft only. There is no path from here to approval or sending. */
export function proposeDraft(state: CoreState, ctx: CoreContext, input: { conversationId: ConversationId; body: string }): { ok: true; draftId: DraftId } | Denial {
  const conversation = state.conversations.get(input.conversationId);
  if (!conversation) return deny(state, ctx, "draft.propose", "conversation_unknown");
  if (typeof input.body !== "string" || input.body.length < 1 || input.body.length > MAX_REPLY_LENGTH) return deny(state, ctx, "draft.propose", "invalid_command");
  for (const older of state.drafts.values())
    if (older.conversationId === conversation.id && (older.status === "pending" || older.status === "info_requested")) {
      older.status = "superseded";
      invalidateIntents(state, i => i.draftId === older.id, "draft_superseded");
    }
  const id = ctx.newId("draft") as DraftId;
  state.drafts.set(id, {
    id, conversationId: conversation.id, status: "pending", history: [], approvalIds: [],
    current: { revision: 1, body: input.body, contentHash: replyContentHash(conversation.id, conversation.memberId, input.body), author: { kind: "ai_assistant" }, createdAt: ctx.now() },
  });
  audit(state, ctx, "draft.propose", "recorded", { draftId: id, author: "ai_assistant", revision: 1 });
  return { ok: true, draftId: id };
}

function resolveStaff(state: CoreState, ctx: CoreContext, kind: string, actor: ActorRef): Actor | Denial {
  if (!ctx.authority) return deny(state, ctx, kind, "authority_unavailable");
  if (actor.forwarded) return deny(state, ctx, kind, "forwarded_content");
  const binding = ctx.authority.principal(actor.adapter, actor.principalRef);
  if (!binding || binding.revoked) return deny(state, ctx, kind, "principal_unknown");
  if (binding.kind !== "staff") return deny(state, ctx, kind, "not_staff");
  const staff = ctx.authority.staff(binding.staffId);
  if (!staff || !staff.active) return deny(state, ctx, kind, "staff_inactive");
  if (staff.role !== "doctor") return deny(state, ctx, kind, "role_not_permitted");
  return { staff, generation: binding.generation };
}

/** Current clinic and assignment, checked at every view, command, replay and claim. */
export function staffMayActFor(ctx: CoreContext, staff: StaffRecord, conversation: Conversation): DenialCode | null {
  if (!ctx.authority) return "authority_unavailable";
  const current = ctx.authority.staff(staff.staffId);
  if (!current || !current.active) return "staff_inactive";
  if (current.role !== "doctor") return "role_not_permitted";
  if (current.clinicId !== conversation.clinicId) return "clinic_mismatch";
  const clinicActive = ctx.authority.clinicActive?.(current.clinicId);
  if (clinicActive === undefined) return "clinic_status_unavailable";
  if (clinicActive !== true) return "clinic_inactive";
  if (!ctx.authority.isAssigned(conversation.memberId, current.staffId)) return "not_assigned";
  return null;
}

/** Issues single-purpose intents bound to this actor, link generation, draft revision, hash and conversation version. */
export function actionsFor(state: CoreState, ctx: CoreContext, actorRef: ActorRef, conversationId: ConversationId): { ok: true; view: ActionView } | Denial {
  const actor = resolveStaff(state, ctx, "view", actorRef);
  if ("ok" in actor) return actor;
  const ttl = ctx.intentTtlMs;
  if (ttl === undefined || !Number.isSafeInteger(ttl) || ttl < 1) return deny(state, ctx, "view", "policy_unavailable");
  const conversation = state.conversations.get(conversationId);
  if (!conversation) return deny(state, ctx, "view", "conversation_unknown");
  const refused = staffMayActFor(ctx, actor.staff, conversation);
  if (refused) return deny(state, ctx, "view", refused, { staffId: actor.staff.staffId });
  const draft = latestDraft(state, conversationId);
  if (!draft || draft.status !== "pending") return deny(state, ctx, "view", "draft_not_pending");

  const actions = COMMAND_PURPOSES.filter(purpose => !conversation.urgentEpisodeId || purpose !== "reply.request_info").map(purpose => {
    const id = ctx.newId("intent") as IntentId;
    state.intents.set(id, {
      id, purpose, staffId: actor.staff.staffId, adapter: actorRef.adapter, principalRef: actorRef.principalRef, linkGeneration: actor.generation,
      draftId: draft.id, revision: draft.current.revision, contentHash: draft.current.contentHash, conversationVersion: conversation.version,
      issuedAt: ctx.now(), expiresAt: ctx.now() + ttl, state: "open",
    });
    return { purpose, intentId: id, label: LABELS[purpose] };
  });
  audit(state, ctx, "view", "allowed", { staffId: actor.staff.staffId, draftId: draft.id, revision: draft.current.revision, version: conversation.version });
  return {
    ok: true,
    view: {
      conversationId, conversationVersion: conversation.version, actions,
      draft: { revision: draft.current.revision, body: draft.current.body, contentHash: draft.current.contentHash, author: draft.current.author.kind },
    },
  };
}

const requestKey = (envelope: VerifiedEnvelope, requestId: string) => JSON.stringify([envelope.adapter, requestId]);
const fingerprintOf = (actor: Actor, command: Command) =>
  canonicalHash("noreon.command-request", 1, [actor.staff.staffId, command.purpose, command.intentId, command.purpose === "reply.edit" ? command.body : null]);

export function executeCommand(state: CoreState, ctx: CoreContext, envelope: VerifiedEnvelope): CommandSuccess | Denial {
  if (envelope.kind !== "action") return deny(state, ctx, "command", "invalid_command");
  const parsed = commandSchema.safeParse(envelope.action);
  if (!parsed.success) return deny(state, ctx, "command", "invalid_command");
  const command = parsed.data;
  const actor = resolveStaff(state, ctx, "command", envelope);
  if ("ok" in actor) return actor;
  const staffId = actor.staff.staffId;

  const key = requestKey(envelope, command.requestId);
  const prior = state.requests.get(key);
  if (prior) {
    if (prior.fingerprint !== fingerprintOf(actor, command) || prior.staffId !== staffId || prior.principalRef !== envelope.principalRef) return deny(state, ctx, "command", "request_conflict", { staffId });
    if (prior.linkGeneration !== actor.generation) return deny(state, ctx, "command.replay", "link_generation_changed", { staffId });
    const refused = staffMayActFor(ctx, actor.staff, state.conversations.get(prior.conversationId)!);
    if (refused) return deny(state, ctx, "command.replay", refused, { staffId });
    audit(state, ctx, "command.replay", "allowed", { staffId, purpose: command.purpose });
    return { ...prior.result, replayed: true };
  }

  const intent = state.intents.get(command.intentId as IntentId);
  if (!intent) return deny(state, ctx, "command", "intent_unknown", { staffId });
  if (intent.staffId !== staffId || intent.adapter !== envelope.adapter || intent.principalRef !== envelope.principalRef) return deny(state, ctx, "command", "intent_actor_mismatch", { staffId });
  if (intent.linkGeneration !== actor.generation) return deny(state, ctx, "command", "link_generation_changed", { staffId });
  if (intent.purpose !== command.purpose) return deny(state, ctx, "command", "intent_wrong_purpose", { staffId });
  if (intent.state === "consumed") return deny(state, ctx, "command", "intent_consumed", { staffId });
  if (intent.state === "invalidated") return deny(state, ctx, "command", "intent_invalidated", { staffId, reason: intent.invalidatedBy ?? "" });
  if (ctx.now() >= intent.expiresAt) return deny(state, ctx, "command", "intent_expired", { staffId });

  const draft = state.drafts.get(intent.draftId)!;
  const conversation = state.conversations.get(draft.conversationId)!;
  const refused = staffMayActFor(ctx, actor.staff, conversation);
  if (refused) return deny(state, ctx, "command", refused, { staffId });
  if (conversation.urgentEpisodeId && command.purpose === "reply.request_info") return deny(state, ctx, "command", "urgent_episode_active", { staffId });
  if (draft.status !== "pending") return deny(state, ctx, "command", "draft_not_pending", { staffId });
  if (draft.current.revision !== intent.revision) return deny(state, ctx, "command", "stale_revision", { staffId });
  if (conversation.version !== intent.conversationVersion) return deny(state, ctx, "command", "stale_conversation", { staffId });
  if (draft.current.contentHash !== intent.contentHash || replyContentHash(conversation.id, conversation.memberId, draft.current.body) !== intent.contentHash)
    return deny(state, ctx, "command", "content_hash_mismatch", { staffId });

  if (command.purpose === "reply.approve" && state.deliveryByApprovalKey.has(JSON.stringify([draft.id, draft.current.revision, conversation.version])))
    return deny(state, ctx, "command", "draft_not_pending", { staffId });

  // Every check has passed; from here the command writes.
  intent.state = "consumed";
  const result = apply(state, ctx, command, envelope, actor.staff, intent, draft, conversation);
  state.requests.set(key, { fingerprint: fingerprintOf(actor, command), staffId, principalRef: envelope.principalRef, linkGeneration: actor.generation, conversationId: conversation.id, result });
  return result;
}

function apply(state: CoreState, ctx: CoreContext, command: Command, envelope: VerifiedEnvelope, staff: StaffRecord, intent: ApprovalIntent, draft: ReplyDraft, conversation: Conversation): CommandSuccess {
  const at = ctx.now(), base = { ok: true as const, purpose: command.purpose, draftId: draft.id, replayed: false };
  switch (command.purpose) {
    case "reply.edit": {
      invalidateIntents(state, i => i.draftId === draft.id, "draft_edited");
      draft.history.push(draft.current);
      draft.current = {
        revision: draft.current.revision + 1, body: command.body, contentHash: replyContentHash(conversation.id, conversation.memberId, command.body),
        author: { kind: "staff", staffId: staff.staffId }, createdAt: at,
      };
      audit(state, ctx, "command.edit", "allowed", { staffId: staff.staffId, draftId: draft.id, revision: draft.current.revision });
      return { ...base, revision: draft.current.revision };
    }
    case "reply.reject":
    case "reply.request_info": {
      draft.status = command.purpose === "reply.reject" ? "rejected" : "info_requested";
      invalidateIntents(state, i => i.draftId === draft.id, draft.status);
      if (command.purpose === "reply.request_info") state.tasks.push({ kind: "info_requested", conversationId: conversation.id, createdAt: at, staffId: staff.staffId, draftId: draft.id });
      audit(state, ctx, `command.${draft.status}`, "allowed", { staffId: staff.staffId, draftId: draft.id, revision: draft.current.revision });
      return { ...base, revision: draft.current.revision };
    }
    case "reply.approve": {
      const approvalKey = JSON.stringify([draft.id, draft.current.revision, conversation.version]);
      const approvalId = ctx.newId("approval") as ApprovalId, deliveryId = ctx.newId("delivery") as DeliveryId;
      const route = pinRoute(ctx, conversation.memberId);
      draft.status = "approved";
      draft.reopenedReason = undefined;
      draft.approvalIds.push(approvalId);
      invalidateIntents(state, i => i.draftId === draft.id, "draft_approved");
      state.approvals.set(approvalId, {
        id: approvalId, draftId: draft.id, revision: draft.current.revision, contentHash: draft.current.contentHash, conversationVersion: conversation.version,
        approvedBy: Object.freeze({ staffId: staff.staffId, displayName: staff.displayName, role: staff.role, clinicId: staff.clinicId }), approvedAt: at,
        via: { adapter: envelope.adapter, principalRef: envelope.principalRef, linkGeneration: intent.linkGeneration, intentId: intent.id, requestId: command.requestId as RequestId }, deliveryId,
      });
      state.deliveries.set(deliveryId, {
        id: deliveryId, conversationId: conversation.id, memberId: conversation.memberId, draftId: draft.id, approvalId,
        revision: draft.current.revision, body: draft.current.body, contentHash: draft.current.contentHash, conversationVersion: conversation.version,
        endpoint: "endpoint" in route ? route.endpoint : undefined, state: "endpoint" in route ? "queued" : "held",
        holdReason: "hold" in route ? route.hold : undefined, attempts: [], stateSeq: 1,
      });
      state.deliveryByApprovalKey.set(approvalKey, deliveryId);
      audit(state, ctx, "command.approve", "allowed", { staffId: staff.staffId, draftId: draft.id, revision: draft.current.revision, approvalId, deliveryId });
      audit(state, ctx, "delivery.created", "recorded", { deliveryId, state: "endpoint" in route ? "queued" : "held", ...("hold" in route ? { reason: route.hold } : {}) });
      return { ...base, revision: draft.current.revision, approvalId, deliveryId };
    }
  }
}

/** Pins the endpoint and generation the approved policy names now. Missing policy holds; nothing is guessed. */
export function pinRoute(ctx: CoreContext, memberId: MemberId): { endpoint: PinnedEndpoint } | { hold: HoldReason } {
  if (!ctx.authority) return { hold: "authority_unavailable" };
  const policy = ctx.routePolicy;
  if (!policy) return { hold: "route_policy_missing" };
  const endpointId = policy.clinicalReplyEndpoint(memberId);
  if (!endpointId) return { hold: "no_permitted_route" };
  const binding = ctx.authority.endpoint(endpointId);
  if (!binding || !binding.active || binding.memberId !== memberId) return { hold: "endpoint_unavailable" };
  if (!policy.clinicalReplyAllowed(binding.adapter)) return { hold: "privacy_policy_disallows_channel" };
  return { endpoint: { endpointId, adapter: binding.adapter, address: binding.address, generation: binding.generation, policyVersion: policy.version } };
}
