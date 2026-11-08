import {memberStaffName} from "@/lib/member-staff-name.mjs";
import "server-only";
import type { AdapterId, ApprovalId, AttemptId, AttemptOutcome, CommandPurpose, DeliveryId, EndpointId, IntentId, ReplyApproval } from "./contracts";

/**
 * What a channel adapter may tell the core, and what the core asks of it.
 *
 * The adapter verifies transport authenticity before building an envelope, then
 * reports only a channel-scoped principal reference and event reference. It has
 * no method for choosing a member, role, assignment, route, fallback, retry or
 * approval: those decisions live in reply-machine.ts and delivery-machine.ts.
 */
export type VerifiedEnvelope = {
  adapter: AdapterId;
  /** Channel-scoped identity reference; resolved to a Noreon principal by the core. */
  principalRef: string;
  /** Transport event reference, namespaced by adapter for deduplication. */
  eventId: string;
  /** Transport reported that this content was forwarded from someone else. */
  forwarded: boolean;
} & ({ kind: "text"; text: string } | { kind: "action"; action: unknown });

/** Action descriptions the core permits for one actor; the adapter only renders them. */
export type ActionView = {
  conversationId: string;
  conversationVersion: number;
  draft: { revision: number; body: string; contentHash: string; author: "ai_assistant" | "staff" };
  actions: { purpose: CommandPurpose; intentId: IntentId; label: string }[];
};

export type AdapterCapabilities = {
  adapter: AdapterId;
  /** Full rendered envelope, including attribution, in UTF-16 code units; null if unsupported. */
  plainText: { maxUtf16Units: number } | null;
  /** No adapter here documents a safe idempotent resend, so the core never retries. */
  idempotentRetry: false;
};

/** Immutable payload pinned by the core at claim time. The adapter may not alter body or destination. */
export type OutboundPayload = Readonly<{
  deliveryId: DeliveryId; attemptId: AttemptId; attemptSeq: number;
  endpointId: EndpointId; address: string; generation: number; body: string; contentHash: string;
  approvalId: ApprovalId;
  approvedBy: ReplyApproval["approvedBy"];
}>;

/** Product-owned plain-text envelope. The separately hashed clinical body is unchanged. */
export function renderOutboundText(payload: Pick<OutboundPayload, "body" | "approvedBy">): string {
  // The envelope has no locale; use the script of the approved body for anonymous attribution.
  const language = /\p{Script=Armenian}/u.test(payload.body) ? "hy" : /\p{Script=Cyrillic}/u.test(payload.body) ? "ru" : "en";
  const doctor = memberStaffName(payload.approvedBy.displayName) === null ? {en:"Your doctor",hy:"Ձեր բժիշկը",ru:"Ваш врач"}[language] : payload.approvedBy.displayName;
  return `${doctor}\n\n${payload.body}`;
}

export type ChannelAdapter = {
  id: AdapterId;
  capabilities(): AdapterCapabilities;
  /**
   * Hand the exact payload to the transport once. Must return `unsupported`
   * without invoking the transport rather than truncate, translate or edit text,
   * and `definitely_failed` only for documented definite rejections; anything
   * else after invocation (timeout, lost acknowledgement, unclassified error) is
   * `unknown`.
   */
  deliver(payload: OutboundPayload): Promise<AttemptOutcome>;
};
