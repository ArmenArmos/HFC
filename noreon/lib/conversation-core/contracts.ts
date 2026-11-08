import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Channel-neutral conversation core: entity, command and state contracts.
 *
 * Noreon owns every piece of state declared here. Channel adapters only hand the
 * core a verified transport envelope (see channel-contract.ts) and never supply a
 * member, role, assignment, recipient or approved body that the core trusts.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ConversationId = Brand<string, "ConversationId">;
export type MemberId = Brand<string, "MemberId">;
export type StaffId = Brand<string, "StaffId">;
export type ClinicId = Brand<string, "ClinicId">;
export type DraftId = Brand<string, "DraftId">;
export type IntentId = Brand<string, "IntentId">;
export type RequestId = Brand<string, "RequestId">;
export type ApprovalId = Brand<string, "ApprovalId">;
export type DeliveryId = Brand<string, "DeliveryId">;
export type AttemptId = Brand<string, "AttemptId">;
export type EndpointId = Brand<string, "EndpointId">;
export type AdapterId = Brand<string, "AdapterId">;
export type EpisodeId = Brand<string, "EpisodeId">;
export type ProactiveInstanceId = Brand<string, "ProactiveInstanceId">;

export const COMMAND_SCHEMA_VERSION = 1;
export const MAX_REPLY_LENGTH = 8000;

/**
 * Hash over a JSON array whose first two positions are a domain label and its
 * version. JSON string escaping keeps field boundaries unambiguous, unlike
 * concatenation, and the text is hashed exactly as stored (no normalisation).
 */
export function canonicalHash(domain: string, version: number, fields: readonly (string | number | null)[]): string {
  return createHash("sha256").update(JSON.stringify([domain, version, ...fields]), "utf8").digest("hex");
}
export const replyContentHash = (conversationId: ConversationId, memberId: MemberId, body: string) =>
  canonicalHash("noreon.reply-content", 1, [conversationId, memberId, body]);

// Commands ------------------------------------------------------------------

export const COMMAND_PURPOSES = ["reply.approve", "reply.edit", "reply.reject", "reply.request_info"] as const;
export type CommandPurpose = (typeof COMMAND_PURPOSES)[number];

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const base = { schema: z.literal(COMMAND_SCHEMA_VERSION), intentId: opaqueId, requestId: opaqueId };
/** Strict: an unknown key such as memberId, role, recipient or approvedBody rejects the command. */
export const commandSchema = z.discriminatedUnion("purpose", [
  z.strictObject({ ...base, purpose: z.literal("reply.approve") }),
  z.strictObject({ ...base, purpose: z.literal("reply.edit"), body: z.string().min(1).max(MAX_REPLY_LENGTH) }),
  z.strictObject({ ...base, purpose: z.literal("reply.reject") }),
  z.strictObject({ ...base, purpose: z.literal("reply.request_info") }),
]);
export type Command = z.infer<typeof commandSchema>;

export type DenialCode =
  | "invalid_command" | "authority_unavailable" | "policy_unavailable" | "forwarded_content"
  | "principal_unknown" | "not_staff" | "not_member" | "staff_inactive" | "role_not_permitted"
  | "clinic_mismatch" | "clinic_inactive" | "clinic_status_unavailable" | "not_assigned" | "link_generation_changed"
  | "intent_unknown" | "intent_actor_mismatch" | "intent_wrong_purpose" | "intent_expired"
  | "intent_consumed" | "intent_invalidated" | "draft_not_pending" | "stale_revision"
  | "stale_conversation" | "content_hash_mismatch" | "request_conflict" | "conversation_unknown" | "urgent_episode_active";
export type Denial = { ok: false; code: DenialCode };

// Current authority, injected per call. Fixture snapshots are not production auth.

export type StaffRole = "doctor" | "nurse" | "admin";
export type StaffRecord = { staffId: StaffId; active: boolean; role: StaffRole; clinicId: ClinicId; displayName: string };
export type PrincipalBinding =
  | { kind: "staff"; staffId: StaffId; generation: number; revoked: boolean }
  | { kind: "member"; memberId: MemberId; generation: number; revoked: boolean };
/** Noreon-managed link between a member and one adapter address. `address` is adapter metadata only. */
export type EndpointBinding = { endpointId: EndpointId; memberId: MemberId; adapter: AdapterId; address: string; generation: number; active: boolean };
export type AuthoritySnapshot = {
  principal(adapter: AdapterId, principalRef: string): PrincipalBinding | undefined;
  staff(staffId: StaffId): StaffRecord | undefined;
  /** Missing resolver or unknown status fails closed on staff actions and claims. */
  clinicActive?(clinicId: ClinicId): boolean | undefined;
  isAssigned(memberId: MemberId, staffId: StaffId): boolean;
  endpoint(endpointId: EndpointId): EndpointBinding | undefined;
};
/** Approved routing/privacy policy. The core never invents a route or a fallback. */
export type RoutePolicy = {
  version: string;
  clinicalReplyEndpoint(memberId: MemberId): EndpointId | undefined;
  clinicalReplyAllowed(adapter: AdapterId): boolean;
};
export type CoreContext = {
  now: () => number;
  newId: (kind: string) => string;
  authority: AuthoritySnapshot | undefined;
  routePolicy: RoutePolicy | undefined;
  /** Explicit intent lifetime; missing or invalid fails closed. */
  intentTtlMs: number | undefined;
};

// Entities --------------------------------------------------------------------

export type MessageSource = { adapter: AdapterId; eventId: string; forwarded: boolean } | { internal: "ai_assistant" };
/** Text is inert data. Nothing in the core parses message text for commands. */
export type Message = { seq: number; author: "member" | "ai_assistant"; text: string; at: number; source: MessageSource };
export type Conversation = {
  id: ConversationId; memberId: MemberId; clinicId: ClinicId; version: number; messages: Message[];
  urgentEpisodeId?: EpisodeId;
  /** Set when a member message arrived after an external send had already started. */
  reviewAfterSend: DeliveryId[];
};
export type DraftAuthor = { kind: "ai_assistant" } | { kind: "staff"; staffId: StaffId };
export type DraftRevision = { revision: number; body: string; contentHash: string; author: DraftAuthor; createdAt: number };
export type DraftStatus = "pending" | "approved" | "rejected" | "info_requested" | "superseded";
export type ReplyDraft = {
  id: DraftId; conversationId: ConversationId; status: DraftStatus; current: DraftRevision; history: DraftRevision[];
  approvalIds: ApprovalId[]; reopenedReason?: "newer_member_message";
};
export type ApprovalIntent = {
  id: IntentId; purpose: CommandPurpose; staffId: StaffId; adapter: AdapterId; principalRef: string; linkGeneration: number;
  draftId: DraftId; revision: number; contentHash: string; conversationVersion: number;
  issuedAt: number; expiresAt: number; state: "open" | "consumed" | "invalidated"; invalidatedBy?: string;
};
export type ReplyApproval = {
  id: ApprovalId; draftId: DraftId; revision: number; contentHash: string; conversationVersion: number;
  readonly approvedBy: Readonly<{ staffId: StaffId; displayName: string; role: StaffRole; clinicId: ClinicId }>;
  approvedAt: number; via: { adapter: AdapterId; principalRef: string; linkGeneration: number; intentId: IntentId; requestId: RequestId };
  deliveryId: DeliveryId;
};
export type DeliveryState = "queued" | "sending" | "accepted_by_provider" | "definitely_failed" | "unknown" | "held";
export type HoldReason =
  | "route_policy_missing" | "no_permitted_route" | "endpoint_unavailable" | "privacy_policy_disallows_channel"
  | "authority_unavailable" | "approved_content_changed" | "newer_member_message" | "approver_authority_lost"
  | "route_changed" | "endpoint_rebound" | "capability_unsupported";
export type PinnedEndpoint = { endpointId: EndpointId; adapter: AdapterId; address: string; generation: number; policyVersion: string };
export type AttemptOutcome =
  | { kind: "accepted"; providerRef: string } | { kind: "definitely_failed"; evidence: string }
  | { kind: "unknown"; reason: string } | { kind: "unsupported" };
export type DeliveryAttempt = {
  id: AttemptId; seq: number; claimedAt: number; outcome?: AttemptOutcome; outcomeAt?: number;
  /** A member message arrived after this attempt was handed to the transport; it cannot be recalled. */
  memberMessageDuringSend?: number;
  /** Outcome reported after the state was already resolved; kept for reconciliation, never applied. */
  lateOutcomes: AttemptOutcome[];
};
export type DeliveryIntent = {
  id: DeliveryId; conversationId: ConversationId; memberId: MemberId; draftId: DraftId; approvalId: ApprovalId;
  revision: number; body: string; contentHash: string; conversationVersion: number;
  endpoint?: PinnedEndpoint; state: DeliveryState; holdReason?: HoldReason; attempts: DeliveryAttempt[]; stateSeq: number;
};
export type AuditEvent = { seq: number; at: number; kind: string; decision: "allowed" | "denied" | "recorded"; detail: Record<string, string | number | boolean> };
export type CareTask = { kind: "info_requested" | "urgent_escalation"; conversationId: ConversationId; createdAt: number; staffId?: StaffId; draftId?: DraftId; episodeId?: EpisodeId };

// Urgent and proactive --------------------------------------------------------

export type UrgentEpisode = {
  id: EpisodeId; conversationId: ConversationId; memberId: MemberId; triggerId: string; triggerVersion: string | null; startedAt: number;
  guidance: { kind: "approved"; contentId: string; version: string; locale: string; text: string } | { kind: "unavailable"; locale: string; reason: "configuration_missing" | "locale_not_approved" };
  call103: { kind: "call"; number: "103" };
  escalation: { state: "enqueued"; ref: string } | { state: "enqueue_failed" };
  routineStopped: true;
};
export type ProactiveInstance = {
  id: ProactiveInstanceId; key: string; memberId: MemberId; scheduleId: string; scheduleVersion: number; planVersion: string;
  questionId: string; contentId: string; contentVersion: string; slotAt: number;
  state: "pending" | "claimed" | "answered" | "superseded" | "cancelled_urgent";
};

/** The approved schedule fields the sender recheck needs; slots become instances. */
export type ApprovedSchedule = { scheduleId: string; version: number; planVersion: string; approvedBy: string; fingerprint: string; quietHours: { startMinute: number; endMinute: number; utcOffsetMinutes: number } };

export type StoredRequest = { fingerprint: string; staffId: StaffId; principalRef: string; linkGeneration: number; conversationId: ConversationId; result: CommandSuccess };
export type CommandSuccess = {
  ok: true; purpose: CommandPurpose; draftId: DraftId; revision: number; replayed: boolean;
  approvalId?: ApprovalId; deliveryId?: DeliveryId;
};

export type CoreState = {
  conversations: Map<ConversationId, Conversation>;
  drafts: Map<DraftId, ReplyDraft>;
  intents: Map<IntentId, ApprovalIntent>;
  requests: Map<string, StoredRequest>;
  approvals: Map<ApprovalId, ReplyApproval>;
  deliveries: Map<DeliveryId, DeliveryIntent>;
  /** One delivery intent per approval of (draft, revision, conversation version). */
  deliveryByApprovalKey: Map<string, DeliveryId>;
  seenEvents: Set<string>;
  tasks: CareTask[];
  urgentEpisodes: Map<EpisodeId, UrgentEpisode>;
  proactive: Map<ProactiveInstanceId, ProactiveInstance>;
  proactiveKeys: Map<string, ProactiveInstanceId>;
  activeSchedules: Map<string, number>;
  schedules: Map<string, ApprovedSchedule>;
  audit: AuditEvent[];
};

export function createCoreState(): CoreState {
  return {
    conversations: new Map(), drafts: new Map(), intents: new Map(), requests: new Map(), approvals: new Map(),
    deliveries: new Map(), deliveryByApprovalKey: new Map(), seenEvents: new Set(), tasks: [],
    urgentEpisodes: new Map(), proactive: new Map(), proactiveKeys: new Map(), activeSchedules: new Map(), schedules: new Map(), audit: [],
  };
}

export function audit(state: CoreState, ctx: Pick<CoreContext, "now">, kind: string, decision: AuditEvent["decision"], detail: AuditEvent["detail"] = {}) {
  state.audit.push({ seq: state.audit.length + 1, at: ctx.now(), kind, decision, detail });
}
