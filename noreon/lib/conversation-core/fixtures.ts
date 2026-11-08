import "server-only";
import { createHash } from "node:crypto";
import type { ActionView, AdapterCapabilities, ChannelAdapter, OutboundPayload, VerifiedEnvelope } from "./channel-contract";
import { renderOutboundText } from "./channel-contract";
import {
  COMMAND_SCHEMA_VERSION, createCoreState,
  type AdapterId, type AttemptOutcome, type AuthoritySnapshot, type ClinicId, type CommandPurpose, type ConversationId,
  type CoreContext, type CoreState, type EndpointBinding, type EndpointId, type MemberId, type PrincipalBinding,
  type RoutePolicy, type StaffId, type StaffRecord,
} from "./contracts";

/**
 * SIMULATED fixtures for scripts/check-conversation-core.ts only.
 *
 * Everything here is fictional: identities, links, policy and transport. The
 * authority snapshot stands in for current Noreon state and is not an
 * authentication mechanism; the "Telegram" adapter parses Telegram-shaped
 * objects but never talks to Telegram. No production module imports this file.
 */

export const NOREON_STAFF = "noreon-staff-web" as AdapterId;
export const NOREON_MEMBER = "noreon-member-inbox" as AdapterId;
export const TELEGRAM = "telegram" as AdapterId;

/** Deterministic opaque IDs so traces are reproducible; production would use a CSPRNG. */
export function fictionalIdSource(seed: string) {
  let n = 0;
  return (kind: string) => `${kind.slice(0, 3)}_${createHash("sha256").update(`${seed}:${kind}:${++n}`).digest("base64url").slice(0, 22)}`;
}

export class FictionalAuthority implements AuthoritySnapshot {
  principals = new Map<string, PrincipalBinding>();
  staffRecords = new Map<StaffId, StaffRecord>();
  clinics = new Map<ClinicId, boolean>();
  assignments = new Set<string>();
  endpoints = new Map<EndpointId, EndpointBinding>();
  principal(adapter: AdapterId, principalRef: string) { return this.principals.get(JSON.stringify([adapter, principalRef])); }
  staff(staffId: StaffId) { return this.staffRecords.get(staffId); }
  clinicActive(clinicId: ClinicId) { return this.clinics.get(clinicId); }
  isAssigned(memberId: MemberId, staffId: StaffId) { return this.assignments.has(JSON.stringify([memberId, staffId])); }
  endpoint(endpointId: EndpointId) { return this.endpoints.get(endpointId); }

  bind(adapter: AdapterId, principalRef: string, binding: PrincipalBinding) { this.principals.set(JSON.stringify([adapter, principalRef]), binding); }
  assign(memberId: MemberId, staffId: StaffId, assigned = true) {
    const key = JSON.stringify([memberId, staffId]);
    if (assigned) this.assignments.add(key); else this.assignments.delete(key);
  }
  /** Relinking increments the generation; intents and pinned endpoints from the old generation stop matching. */
  relinkPrincipal(adapter: AdapterId, principalRef: string) {
    const b = this.principal(adapter, principalRef);
    if (b) this.bind(adapter, principalRef, { ...b, generation: b.generation + 1 });
  }
  revokePrincipal(adapter: AdapterId, principalRef: string) {
    const b = this.principal(adapter, principalRef);
    if (b) this.bind(adapter, principalRef, { ...b, revoked: true });
  }
  relinkEndpoint(endpointId: EndpointId, address: string) {
    const e = this.endpoints.get(endpointId);
    if (e) this.endpoints.set(endpointId, { ...e, address, generation: e.generation + 1 });
  }
}

export class FictionalRoutePolicy implements RoutePolicy {
  version: string; routes: Map<MemberId, EndpointId>; allowed: Set<AdapterId>;
  constructor(version: string, routes: Map<MemberId, EndpointId>, allowed: Set<AdapterId>) {
    this.version = version; this.routes = routes; this.allowed = allowed;
  }
  clinicalReplyEndpoint(memberId: MemberId) { return this.routes.get(memberId); }
  clinicalReplyAllowed(adapter: AdapterId) { return this.allowed.has(adapter); }
}

/** Records every transport invocation so checks can count real sends, not snapshots. */
type AttributedReply = Pick<OutboundPayload, "approvalId" | "approvedBy" | "body">;
export type FakeTransportCall = { adapter: AdapterId; address: string; text: string } & AttributedReply;
export type FakeTelegramResponse = { ok: true; message_id: number } | { ok: false; error_code: number; description: string };

export class FakeTransport {
  calls: FakeTransportCall[] = [];
  /** Next behaviour; `throw` simulates a timeout or lost acknowledgement after invocation. */
  next: FakeTelegramResponse | "throw" = { ok: true, message_id: 1 };
  /** Runs after the transport has been invoked, before the adapter returns. */
  duringSend?: () => void;
  async send(adapter: AdapterId, address: string, text: string, reply: AttributedReply): Promise<FakeTelegramResponse> {
    this.calls.push({ adapter, address, text, body: reply.body, approvalId: reply.approvalId, approvedBy: reply.approvedBy });
    this.duringSend?.();
    const next = this.next;
    if (next === "throw") throw Error("fictional lost acknowledgement");
    return next.ok ? { ...next, message_id: this.calls.length } : next;
  }
}

/** Fictional table of documented definite rejections. Empty on purpose: no blanket 4xx assumption. */
export const FICTIONAL_DEFINITE_REJECTIONS = new Set<string>();

const PURPOSE_CODES: Record<string, CommandPurpose> = { a: "reply.approve", e: "reply.edit", r: "reply.reject", i: "reply.request_info" };
const CODE_FOR: Record<CommandPurpose, string> = { "reply.approve": "a", "reply.edit": "e", "reply.reject": "r", "reply.request_info": "i" };
const requestIdFrom = (namespace: string, value: string) => `rq_${createHash("sha256").update(JSON.stringify([namespace, value])).digest("base64url").slice(0, 24)}`;

/** Synthetic Telegram-shaped update. `verified` stands in for the transport secret check. */
export type SyntheticTelegramUpdate = {
  verified: boolean; update_id: number;
  callback_query?: { id: string; from: { id: number }; data: string; edit_text?: string };
  message?: { message_id: number; from: { id: number }; text: string; forward_origin?: unknown };
};

export function telegramAdapter(transport: FakeTransport, maxUtf16Units = 4096) {
  const id = TELEGRAM;
  const adapter: ChannelAdapter & {
    fromUpdate(update: SyntheticTelegramUpdate): VerifiedEnvelope | null;
    render(view: ActionView): { text: string; inline_keyboard: { text: string; callback_data: string }[][] };
  } = {
    id,
    capabilities: (): AdapterCapabilities => ({ adapter: id, plainText: { maxUtf16Units }, idempotentRetry: false }),
    fromUpdate(update) {
      if (!update.verified) return null;
      const base = { adapter: id, eventId: `update:${update.update_id}` };
      if (update.callback_query) {
        const q = update.callback_query;
        const [code, intentId, extra] = q.data.split(":");
        const purpose = PURPOSE_CODES[code ?? ""];
        if (!purpose || !intentId || extra !== undefined) return null;
        const action: Record<string, unknown> = { schema: COMMAND_SCHEMA_VERSION, purpose, intentId, requestId: requestIdFrom("tg-callback", q.id) };
        if (q.edit_text !== undefined) action.body = q.edit_text;
        return { ...base, principalRef: `tg-user:${q.from.id}`, forwarded: false, kind: "action", action };
      }
      if (update.message) {
        const m = update.message;
        return { ...base, principalRef: `tg-user:${m.from.id}`, forwarded: m.forward_origin !== undefined, kind: "text", text: m.text };
      }
      return null;
    },
    render: view => ({
      text: view.draft.body,
      inline_keyboard: [view.actions.map(a => ({ text: a.label, callback_data: `${CODE_FOR[a.purpose]}:${a.intentId}` }))],
    }),
    async deliver(payload: OutboundPayload): Promise<AttemptOutcome> {
      const text = renderOutboundText(payload);
      if (text.length > maxUtf16Units) return { kind: "unsupported" };
      try {
        const response = await transport.send(id, payload.address, text, payload);
        if (response.ok) return { kind: "accepted", providerRef: `tg-message:${response.message_id}` };
        return FICTIONAL_DEFINITE_REJECTIONS.has(`${response.error_code}:${response.description}`)
          ? { kind: "definitely_failed", evidence: `${response.error_code}:${response.description}` }
          : { kind: "unknown", reason: `unclassified_${response.error_code}` };
      } catch {
        return { kind: "unknown", reason: "no_acknowledgement" };
      }
    },
  };
  return adapter;
}

/** Synthetic Noreon staff web form posts and a member inbox delivery channel. */
export function noreonAdapters(transport: FakeTransport) {
  const staff = {
    id: NOREON_STAFF,
    fromForm(post: { sessionRef: string; formNonce: string; fields: Record<string, unknown> }): VerifiedEnvelope {
      return {
        adapter: NOREON_STAFF, principalRef: post.sessionRef, eventId: `form:${post.formNonce}`, forwarded: false, kind: "action",
        action: { schema: COMMAND_SCHEMA_VERSION, requestId: requestIdFrom("noreon-form", post.formNonce), ...post.fields },
      };
    },
    render: (view: ActionView) => ({ body: view.draft.body, buttons: view.actions.map(a => ({ label: a.label, fields: { purpose: a.purpose, intentId: a.intentId } })) }),
  };
  const memberInbox: ChannelAdapter = {
    id: NOREON_MEMBER,
    capabilities: () => ({ adapter: NOREON_MEMBER, plainText: { maxUtf16Units: 8000 }, idempotentRetry: false }),
    async deliver(payload) {
      const text = renderOutboundText(payload);
      if (text.length > 8000) return { kind: "unsupported" };
      try {
        const response = await transport.send(NOREON_MEMBER, payload.address, text, payload);
        return response.ok ? { kind: "accepted", providerRef: `inbox:${response.message_id}` } : { kind: "unknown", reason: "unclassified" };
      } catch { return { kind: "unknown", reason: "no_acknowledgement" }; }
    },
  };
  return { staff, memberInbox };
}

/** One fictional clinic, member, two doctors, a nurse and links on both channels. */
export function fictionalWorld(seed = "fictional-world") {
  const clock = { t: Date.UTC(2026, 9, 16, 9, 0, 0) };
  const authority = new FictionalAuthority();
  const clinic = "clinic-fictional-1" as ClinicId;
  authority.clinics.set(clinic, true);
  const member = "member-fictional-1" as MemberId;
  const doctor = "staff-fictional-doctor-a" as StaffId;
  const doctorB = "staff-fictional-doctor-b" as StaffId;
  const nurse = "staff-fictional-nurse" as StaffId;
  const conversationId = "conversation-fictional-1" as ConversationId;
  authority.staffRecords.set(doctor, { staffId: doctor, active: true, role: "doctor", clinicId: clinic, displayName: "Dr Fictional Avetisyan" });
  authority.staffRecords.set(doctorB, { staffId: doctorB, active: true, role: "doctor", clinicId: clinic, displayName: "Dr Fictional Baghdasaryan" });
  authority.staffRecords.set(nurse, { staffId: nurse, active: true, role: "nurse", clinicId: clinic, displayName: "Nurse Fictional" });
  authority.assign(member, doctor);
  authority.assign(member, nurse);
  authority.bind(NOREON_STAFF, "session:doctor-a", { kind: "staff", staffId: doctor, generation: 1, revoked: false });
  authority.bind(NOREON_STAFF, "session:doctor-b", { kind: "staff", staffId: doctorB, generation: 1, revoked: false });
  authority.bind(NOREON_STAFF, "session:nurse", { kind: "staff", staffId: nurse, generation: 1, revoked: false });
  authority.bind(TELEGRAM, "tg-user:1001", { kind: "staff", staffId: doctor, generation: 1, revoked: false });
  authority.bind(TELEGRAM, "tg-user:1002", { kind: "staff", staffId: doctorB, generation: 1, revoked: false });
  authority.bind(TELEGRAM, "tg-user:2001", { kind: "member", memberId: member, generation: 1, revoked: false });
  const memberTelegram = "endpoint-fictional-member-tg" as EndpointId;
  authority.endpoints.set(memberTelegram, { endpointId: memberTelegram, memberId: member, adapter: TELEGRAM, address: "tg-chat:2001", generation: 1, active: true });
  const routePolicy = new FictionalRoutePolicy("route-policy-fictional-v1", new Map([[member, memberTelegram]]), new Set([TELEGRAM]));
  const transport = new FakeTransport();
  const telegram = telegramAdapter(transport);
  const noreon = noreonAdapters(transport);
  const state: CoreState = createCoreState();
  const ctx: CoreContext = { now: () => clock.t, newId: fictionalIdSource(seed), authority, routePolicy, intentTtlMs: 15 * 60_000 };
  const adapters = new Map<AdapterId, ChannelAdapter>([[TELEGRAM, telegram], [NOREON_MEMBER, noreon.memberInbox]]);
  return { clock, authority, routePolicy, transport, telegram, noreon, state, ctx, adapters, clinic, member, doctor, doctorB, nurse, conversationId, memberTelegram };
}
export type FictionalWorld = ReturnType<typeof fictionalWorld>;
