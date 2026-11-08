import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTelegramWebhook, type TelegramDeadLetterPort, type TelegramWebhookConfig } from "@/lib/telegram-channel/ingress";
import { inboxEventFrom, linkTokenHash, telegramHttpsPort } from "@/lib/telegram-channel/link";
import { createTelegramAdapter, isMemberAppLink, isMemberSigninLink, isStaffAppLink, type TelegramHttpPort } from "@/lib/telegram-channel/outbound";
import { parseTelegramContact, parseTelegramMedia, parseTelegramUpdate, type TelegramBot } from "@/lib/telegram-channel/protocol";
import { dispatchConversation, recordObservation } from "@/lib/conversation-persistence/worker";
import { normalizeReplyBody } from "@/lib/conversation-persistence/contracts";
import { dispatchSystemMessage, replySigninButton, runTelegramSweep } from "@/lib/telegram-runtime/dispatch";
import { inboxPort, mediaPort } from "@/lib/telegram-runtime/server";
import { telegramWebhook, runConfiguredTelegramSweep } from "@/lib/telegram-runtime/server";

/**
 * SYNTHETIC checks for the T1 runtime: link envelope, webhook kill switch, secret
 * and dead-letter paths, the inbox port mapping, the CR2 worker response matrix and
 * the system-message dispatcher. Injected ports only; global fetch throws, so an
 * accidental real request fails the run. Database behaviour is proved separately by
 * check-telegram-link-inbox.sql and check-telegram-races.mjs.
 */
let realFetch = 0;
globalThis.fetch = (() => { realFetch++; throw Error("Real network access is forbidden in this check."); }) as typeof fetch;

const BOT: TelegramBot = { account: "synthetic-member", botId: 100 };
const SECRET = "synthetic_webhook_secret_0123456789abcdef";
const MEMBER = 2001;
const results: string[] = [];
const scenario = async (name: string, fn: () => Promise<void> | void) => { await fn(); results.push(name); console.log(`ok   ${name}`); };
const update = (id: number, text: string, chat: { id: number; type: string } = { id: MEMBER, type: "private" }) =>
  ({ update_id: id, message: { message_id: id + 500, date: 1_760_000_000, from: { id: MEMBER, is_bot: false, first_name: "Synthetic" }, chat, text } });
const event = (id: number, text: string) => { const p = parseTelegramUpdate(update(id, text), BOT); assert.ok(p.ok); return p.event; };
const config = (o: Partial<TelegramWebhookConfig> = {}): TelegramWebhookConfig => ({ ...BOT, enabled: true, webhookSecret: SECRET, maxBodyBytes: 262_144, readTimeoutMs: 200, commitTimeoutMs: 200, ...o });
/** A request whose body counts how often it is pulled, to prove nothing was read. */
function request(body: unknown, secret: string | null = SECRET) {
  let pulls = 0;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(bytes); c.close(); } }, { highWaterMark: 0 });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return { req: new Request("https://noreon.invalid/api/telegram/webhook", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit), pulls: () => pulls };
}
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

await scenario("link: only the exact `/start <32-char token>` is a link; it carries a digest, never the token or text", () => {
  const link = inboxEventFrom(event(1, `/start ${TOKEN}`));
  assert.equal(link.kind, "link");
  assert.equal(link.payload.tokenHash, createHash("sha256").update(TOKEN).digest("hex"));
  assert.equal(link.payload.tokenHash, linkTokenHash(TOKEN));
  assert.ok(!JSON.stringify(link).includes(TOKEN), "Raw token never reaches the inbox");
  assert.equal(link.payload.chatId, MEMBER);
  for (const inert of ["/start", `/start ${TOKEN.slice(1)}`, `/start ${TOKEN} extra`, `/start  ${TOKEN}`, "/start@NoreonBot", `/start ${TOKEN}x`]) {
    const e = inboxEventFrom(event(2, inert));
    assert.equal(e.kind, "start", inert);
    assert.ok(!("text" in e.payload), "An inert /start never becomes member text");
  }
  const text = inboxEventFrom(event(3, "I have a headache since morning"));
  assert.equal(text.kind, "text");
  assert.equal(text.payload.text, "I have a headache since morning");
  assert.ok(Object.isFrozen(text) && Object.isFrozen(text.payload));
});

await scenario("inbox: same-chat prompt reply id survives only as text context", () => {
  const original=update(40,"synthetic reply");
  const reply=parseTelegramUpdate({...original,message:{...original.message,reply_to_message:{message_id:41,chat:original.message.chat}}},BOT);
  assert.ok(reply.ok);assert.equal(inboxEventFrom(reply.event).payload.replyToMessageId,41);
  assert.ok(!('replyToMessageId' in inboxEventFrom(event(41,'synthetic plain text')).payload));
});

await scenario("link: a group-chat /start never parses, so it can never link", () => {
  const group = parseTelegramUpdate(update(4, `/start ${TOKEN}`, { id: -100123, type: "group" }), BOT);
  assert.equal(group.ok, false);
});

await scenario("webhook: flag off answers 503 before reading the body; the sweep does nothing", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.NOREON_TELEGRAM_ENABLED;
    process.env.NOREON_TELEGRAM_ACCOUNT = BOT.account; process.env.NOREON_TELEGRAM_BOT_ID = String(BOT.botId);
    process.env.NOREON_TELEGRAM_WEBHOOK_SECRET = SECRET; process.env.NOREON_TELEGRAM_BOT_TOKEN = "100:synthetic_opaque_bot_token_0123456789AB";
    const r = request(update(5, "hello"));
    const res = await telegramWebhook()(r.req);
    assert.equal(res.status, 503);
    assert.equal(r.pulls(), 0, "No body pull while disabled");
    assert.equal(await runConfiguredTelegramSweep(), null, "Disabled dispatcher sends nothing");
    process.env.NOREON_TELEGRAM_ENABLED = "TRUE";
    assert.equal(await runConfiguredTelegramSweep(), null, "Only the exact value \"true\" enables");
  } finally { process.env = saved; }
  assert.equal(realFetch, 0);
});

await scenario("webhook: a wrong secret is 401 with no body read and no inbox call", async () => {
  let inboxCalls = 0;
  const hook = createTelegramWebhook({ config: config(), inbox: async () => { inboxCalls++; return { status: "failed" }; } });
  for (const secret of [null, "wrong_secret_wrong_secret_wrong_secret_00", SECRET + "x"]) {
    const r = request(update(6, "hello"), secret);
    const res = await hook(r.req);
    assert.equal(res.status, 401);
    assert.equal(r.pulls(), 0);
  }
  assert.equal(inboxCalls, 0);
});

await scenario("webhook: acknowledged only after the database commit answer; failures are retryable 503", async () => {
  const calls: unknown[] = [];
  let answer: unknown = null;
  const rpc = async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return answer; };
  const hook = createTelegramWebhook({ config: config(), inbox: inboxPort(rpc) });
  const body = update(7, "Synthetic member text");
  const parsed = parseTelegramUpdate(body, BOT); assert.ok(parsed.ok);
  answer = { status: "committed", eventId: parsed.event.envelope.eventId, fingerprint: parsed.event.fingerprint };
  assert.equal((await hook(request(body).req)).status, 200);
  assert.deepEqual(calls[0], { name: "channel_inbox_commit", args: { p_event: inboxEventFrom(parsed.event) } });
  answer = { status: "committed-duplicate", eventId: parsed.event.envelope.eventId, fingerprint: parsed.event.fingerprint };
  assert.equal((await hook(request(body).req)).status, 200, "Redelivery is acknowledged as a committed duplicate");
  for (const bad of [{ status: "conflict" }, { status: "failed", code: "unavailable" }, { status: "committed", eventId: "other", fingerprint: parsed.event.fingerprint }, null]) {
    answer = bad;
    assert.equal((await hook(request(body).req)).status, 503, JSON.stringify(bad));
  }
});

await scenario("webhook: an authenticated poison update is dead-lettered without content, then acknowledged (G5)", async () => {
  const letters: [string, string][] = [];
  let store = true;
  const deadLetter: TelegramDeadLetterPort = async (id, reason) => { letters.push([id, reason]); return store; };
  const hook = createTelegramWebhook({ config: config(), inbox: async () => ({ status: "failed" }), deadLetter });
  const group = update(8, "group text", { id: -100123, type: "group" });
  assert.equal((await hook(request(group).req)).status, 200);
  assert.deepEqual(letters[0], [JSON.stringify(["telegram", BOT.account, BOT.botId, "update", 8]), "unsupported_shape"]);
  const noId = { message: { text: "no update id" } };
  assert.equal((await hook(request(noId).req)).status, 200);
  assert.match(letters[1][0], /^\["telegram","synthetic-member",100,"body","[a-f0-9]{64}"\]$/);
  assert.ok(!letters.flat().some(v => v.includes("group text") || v.includes("no update id")), "No content in dead letters");
  store = false;
  assert.equal((await hook(request(group).req)).status, 422, "Unstored dead letter stays retryable");
  const noPort = createTelegramWebhook({ config: config(), inbox: async () => ({ status: "failed" }) });
  assert.equal((await noPort(request(group).req)).status, 422);
});

// CR2 worker response matrix (architecture note, test 2) ------------------------
const envelope = {
  deliveryId: "00000000-0000-4000-8000-000000000001", attemptId: "00000000-0000-4000-8000-000000000002", attemptSeq: 1 as const,
  endpointId: "00000000-0000-4000-8000-000000000003", address: String(MEMBER), generation: 1, body: "Exact synthetic reply", contentHash: "h",
  approvalId: "00000000-0000-4000-8000-000000000004",
  approvedBy: { staffId: "00000000-0000-4000-8000-000000000005", displayName: "Dr Synthetic", role: "doctor" as const, clinicId: "00000000-0000-4000-8000-000000000006" },
};
type Answer = { ok: true; result: "recorded" | "duplicate" | "late" | "conflict" } | { ok: false; code: string; retryable: boolean };
function harness(answers: (Answer | "throw")[], options: { adapter?: string; accountRef?: string; deliver?: () => Promise<unknown> } = {}) {
  let claims = 0, delivers = 0;
  const recorded: unknown[] = [];
  const repo = {
    claim: async () => { claims++; return { ok: true as const, fresh: true as const, adapter: options.adapter ?? "telegram", accountRef: options.accountRef ?? "acct", envelope }; },
    outcome: async (_a: string, o: unknown) => { recorded.push(o); const next = answers.shift() ?? "throw"; if (next === "throw") throw Error("lost"); return next; },
  };
  const transport = { id: "telegram", accountRef: "acct", deliver: async () => { delivers++; return options.deliver ? options.deliver() : { kind: "accepted", providerRef: "p1" }; } };
  return { run: () => dispatchConversation(repo, transport, "d", "a", { tries: 3, backoffMs: 0 }), claims: () => claims, delivers: () => delivers, recorded };
}

await scenario("CR2 matrix: thrown before commit, then recorded; response lost after commit, then duplicate; busy, then recorded", async () => {
  for (const [answers, expected] of [
    [["throw", { ok: true, result: "recorded" }], "recorded"],
    [["throw", { ok: true, result: "duplicate" }], "duplicate"],
    [[{ ok: false, code: "busy", retryable: true }, { ok: true, result: "recorded" }], "recorded"],
  ] as [(Answer | "throw")[], string][]) {
    const h = harness(answers);
    const r = await h.run();
    assert.deepEqual(r, { state: "outcome_recorded", attemptId: "a", result: expected });
    assert.equal(h.claims(), 1); assert.equal(h.delivers(), 1);
    assert.ok(h.recorded.every(o => o === h.recorded[0]) && Object.isFrozen(h.recorded[0]), "Same immutable observation on every try");
  }
});

await scenario("CR2 matrix: conflict, unknown-reconciler-wins (late) and non-retryable rejection are reported truthfully", async () => {
  for (const [answer, expected] of [
    [{ ok: true, result: "conflict" }, { state: "outcome_recorded", attemptId: "a", result: "conflict" }],
    [{ ok: true, result: "late" }, { state: "outcome_recorded", attemptId: "a", result: "late" }],
    [{ ok: false, code: "attempt_unknown", retryable: false }, { state: "outcome_rejected", attemptId: "a", code: "attempt_unknown" }],
  ] as [Answer, unknown][]) {
    const h = harness([answer]);
    assert.deepEqual(await h.run(), expected);
    assert.equal(h.delivers(), 1); assert.equal(h.recorded.length, 1);
  }
});

await scenario("CR2 matrix: every recording try fails without confirmed retention: reported unconfirmed, nothing is resent", async () => {
  const h = harness(["throw", "throw", "throw"]);
  const r = await h.run();
  assert.equal(r.state, "recording_unconfirmed");
  assert.deepEqual("observation" in r && r.observation, { kind: "accepted", providerRef: "p1" });
  assert.equal(h.delivers(), 1); assert.equal(h.claims(), 1); assert.equal(h.recorded.length, 3);
});

await scenario("CR2 matrix: malformed, unsupported and thrown transport results become explicit observations", async () => {
  for (const [deliver, expected] of [
    [async () => ({ kind: "accepted" }), { kind: "unknown", reason: "transport_outcome_malformed" }],
    [async () => ({ kind: "sent", providerRef: "x" }), { kind: "unknown", reason: "transport_outcome_malformed" }],
    [async () => ({ kind: "unsupported" }), { kind: "definitely_failed", evidence: "not_sent_unsupported_payload" }],
    [async () => { throw Error("socket"); }, { kind: "unknown", reason: "Transport invocation returned no conclusive acknowledgement" }],
  ] as [() => Promise<unknown>, unknown][]) {
    const h = harness([{ ok: true, result: "recorded" }], { deliver });
    await h.run();
    assert.deepEqual(h.recorded[0], expected);
    assert.equal(h.delivers(), 1);
  }
});

await scenario("CR2 matrix: adapter or bot-namespace mismatch sends nothing and records a definite failure, even when recording throws", async () => {
  for (const options of [{ adapter: "whatsapp" }, { accountRef: "other-bot" }]) {
    const ok = harness([{ ok: true, result: "recorded" }], options);
    assert.deepEqual(await ok.run(), { state: "not_invoked", reason: "adapter_mismatch" });
    assert.equal(ok.delivers(), 0);
    assert.deepEqual(ok.recorded[0], { kind: "definitely_failed", evidence: "Adapter unavailable before invocation" });
    const failing = harness(["throw", "throw", "throw"], options);
    const r = await failing.run();
    assert.equal(r.state, "recording_unconfirmed");
    assert.equal(failing.delivers(), 0);
  }
});

await scenario("CR2 matrix: an unconfirmed claim and a refused claim never deliver", async () => {
  let delivers = 0;
  const transport = { id: "telegram", deliver: async () => { delivers++; return { kind: "accepted", providerRef: "x" }; } };
  const outcome = async () => ({ ok: true as const, result: "recorded" as const });
  assert.equal((await dispatchConversation({ claim: async () => { throw Error("lost ack"); }, outcome }, transport, "d", "a")).state, "claim_unconfirmed");
  assert.equal((await dispatchConversation({ claim: async () => ({ ok: false as const, code: "already_claimed_or_held" }), outcome }, transport, "d", "a")).state, "not_invoked");
  assert.equal(delivers, 0);
  assert.equal((await recordObservation({ outcome: async () => ({ ok: true, result: "recorded" }) }, "a", Object.freeze({ kind: "unknown", reason: "x" }), 1, 0)).state, "outcome_recorded");
});

await scenario("CR2 matrix: the observation is committed on its own before recording; a conflicting retained observation stops recording", async () => {
  const order: string[] = [];
  let observeAnswers: unknown[] = [{ ok: false, code: "busy", retryable: true }, { ok: true, result: "retained" }];
  const recorder = {
    observe: async (_a: string, o: unknown) => { order.push(`observe:${(o as { kind: string }).kind}`); return observeAnswers.shift(); },
    outcome: async () => { order.push("outcome"); return { ok: true, result: "recorded" }; },
  };
  const ok = await recordObservation(recorder, "a", Object.freeze({ kind: "accepted", providerRef: "p" }), 3, 0);
  assert.deepEqual(ok, { state: "outcome_recorded", attemptId: "a", result: "recorded" });
  assert.deepEqual(order, ["observe:accepted", "observe:accepted", "outcome"]);
  order.length = 0; observeAnswers = [{ ok: true, result: "conflict" }];
  assert.deepEqual(await recordObservation(recorder, "a", Object.freeze({ kind: "unknown", reason: "r" }), 3, 0), { state: "outcome_recorded", attemptId: "a", result: "conflict" });
  assert.deepEqual(order, ["observe:unknown"], "A conflicting observation is never applied");
  order.length = 0; observeAnswers = [null, { ok: false, code: "busy", retryable: true }, null];
  assert.equal((await recordObservation(recorder, "a", Object.freeze({ kind: "unknown", reason: "r" }), 3, 0)).state, "recording_unconfirmed", "Unconfirmed retention is never projected or called retained (R2-2)");
  assert.deepEqual(order, ["observe:unknown", "observe:unknown", "observe:unknown"]);
  order.length = 0; observeAnswers = [{ ok: true, result: "retained" }];
  const retainedOnly = await recordObservation({ observe: recorder.observe, outcome: async () => { order.push("outcome"); throw Error("lost"); } }, "a", Object.freeze({ kind: "accepted", providerRef: "p" }), 2, 0);
  assert.equal(retainedOnly.state, "observation_retained", "Retained is reported only after confirmed retention");
});

// System messages through the real adapter with an injected HTTP port --------------
const TOKEN_BOT = "100:synthetic_opaque_bot_token_0123456789AB";
function adapterWith(http: TelegramHttpPort, timeoutMs = 50) {
  return createTelegramAdapter({ config: { ...BOT, enabled: true, botToken: TOKEN_BOT, timeoutMs, maxResponseBytes: 262_144 }, http });
}
const sentEcho = (text: string) => async () => new Response(JSON.stringify({ ok: true, result: { message_id: 9, from: { id: BOT.botId, is_bot: true }, chat: { id: MEMBER, type: "private" }, text } }), { status: 200 });
function systemRpc(text: string, adapter = "telegram", accountRef = JSON.stringify([BOT.account, BOT.botId])) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "system_message_claim") return { ok: true, fresh: true, adapter, accountRef, envelope: { messageId: "00000000-0000-4000-8000-0000000000aa", attemptId: args.p_attempt, address: String(MEMBER), text, bodyHash: "h" } };
    if (name === "delivery_observe") { assert.equal(args.p_channel, "system"); return { ok: true, result: "retained" }; }
    if (name === "system_message_outcome") return { ok: true, result: "recorded" };
    throw Error(`unexpected ${name}`);
  };
  return { rpc, calls };
}
const ACK = "Synthetic acknowledgement. Call 103 in an emergency.";
const attempt = "00000000-0000-4000-8000-0000000000bb";

await scenario("system message: accepted, timeout and thrown sends are recorded as accepted, unknown and unknown, each after exactly one HTTP call", async () => {
  for (const [http, kind] of [
    [sentEcho(ACK), "accepted"],
    [() => new Promise<Response>(() => {}), "unknown"],
    [async () => { throw Error("reset"); }, "unknown"],
    [sentEcho("Edited by the provider"), "unknown"],
  ] as [TelegramHttpPort, string][]) {
    let httpCalls = 0;
    const counted: TelegramHttpPort = (url, init) => { httpCalls++; assert.equal(init.redirect, "error"); assert.equal(JSON.parse(init.body).text, ACK); return http(url, init); };
    const { rpc, calls } = systemRpc(ACK);
    const r = await dispatchSystemMessage(rpc, adapterWith(counted), JSON.stringify([BOT.account, BOT.botId]), "00000000-0000-4000-8000-0000000000aa", attempt, { tries: 1, backoffMs: 0 });
    assert.equal(r.state, "outcome_recorded");
    assert.equal(httpCalls, 1);
    assert.equal((calls.at(-1)!.args.p_outcome as { kind: string }).kind, kind);
  }
});

await scenario("system message: untrimmed or oversized text is not sent and is recorded as definitely failed", async () => {
  for (const text of [` ${ACK}`, `${ACK}\n`, "x".repeat(4097)]) {
    let httpCalls = 0;
    const { rpc, calls } = systemRpc(text);
    await dispatchSystemMessage(rpc, adapterWith(async () => { httpCalls++; return new Response("{}"); }), JSON.stringify([BOT.account, BOT.botId]), "00000000-0000-4000-8000-0000000000aa", attempt, { tries: 1, backoffMs: 0 });
    assert.equal(httpCalls, 0);
    assert.deepEqual(calls.at(-1)!.args.p_outcome, { kind: "definitely_failed", evidence: "not_sent_unsupported_payload" });
  }
});

await scenario("sweep: inbox, reconcile, then queued sends; a bot-namespace mismatch sends nothing", async () => {
  let httpCalls = 0;
  const order: string[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    order.push(name);
    if (name === "channel_inbox_next") return ["00000000-0000-4000-8000-0000000000c1"];
    if (name === "channel_inbox_process") return { ok: true, status: "done", result: "received" };
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    if (name === "telegram_dispatch_queue") return { system: ["00000000-0000-4000-8000-0000000000aa"], replies: [] };
    if (name === "system_message_claim") return { ok: true, fresh: true, adapter: "telegram", accountRef: JSON.stringify(["another-bot", 5]), envelope: { messageId: "00000000-0000-4000-8000-0000000000aa", attemptId: args.p_attempt, address: String(MEMBER), text: ACK, bodyHash: "h" } };
    if (name === "delivery_observe") return { ok: true, result: "retained" };
    if (name === "system_message_outcome") return { ok: true, result: "recorded" };
    if (name === "telegram_auth_message_queue") return [];
    throw Error(name);
  };
  const report = await runTelegramSweep({ rpc, adapter: adapterWith(async () => { httpCalls++; return new Response("{}"); }), accountRef: JSON.stringify([BOT.account, BOT.botId]) });
  assert.deepEqual(order, ["channel_inbox_next", "channel_inbox_process", "delivery_reconcile_stale", "zoe_held_ack_release", "member_notice_reminders_run", "bp_week_reminders_run", "member_medicine_reminders_run", "member_medicine_asks_run", "telegram_dispatch_queue", "system_message_claim", "delivery_observe", "system_message_outcome", "telegram_auth_message_queue"]);
  assert.deepEqual(report.system, { not_invoked: 1 });
  assert.equal(httpCalls, 0);
});

await scenario("auth prompt: the share-contact button is sent once and its outcome recorded; an unconfirmed claim never sends", async () => {
  const bodies: string[] = [];
  const order: string[] = [];
  const AUTH = "00000000-0000-4000-8000-0000000000ab";
  let claimAnswer: unknown = { ok: true, fresh: true, envelope: { messageId: AUTH, attemptId: "00000000-0000-4000-8000-0000000000ac", address: String(MEMBER), text: "Synthetic share prompt.", keyboard: { kind: "request_contact", label: "Synthetic share" } } };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    order.push(name);
    if (name === "channel_inbox_next") return [];
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    if (name === "telegram_dispatch_queue") return { system: [], replies: [] };
    if (name === "telegram_auth_message_queue") return [AUTH];
    if (name === "telegram_auth_message_claim") { assert.equal(args.p_message, AUTH); return claimAnswer; }
    if (name === "telegram_auth_message_outcome") { assert.equal((args.p_outcome as { kind: string }).kind, "accepted"); return { ok: true, result: "recorded" }; }
    throw Error(name);
  };
  const http: TelegramHttpPort = async (_url, init) => { bodies.push(String(init.body)); return sentEcho("Synthetic share prompt.")(); };
  const ids = ["00000000-0000-4000-8000-0000000000ac"];
  const report = await runTelegramSweep({ rpc, adapter: adapterWith(http), accountRef: JSON.stringify([BOT.account, BOT.botId]), newId: () => ids[0] });
  assert.deepEqual(report.auth, { outcome_recorded: 1 });
  assert.equal(bodies.length, 1);
  assert.deepEqual(JSON.parse(bodies[0]).reply_markup, { keyboard: [[{ text: "Synthetic share", request_contact: true }]], one_time_keyboard: true, resize_keyboard: true });
  claimAnswer = { ok: false, code: "template_unapproved" };
  const held = await runTelegramSweep({ rpc, adapter: adapterWith(http), accountRef: JSON.stringify([BOT.account, BOT.botId]), newId: () => ids[0] });
  assert.deepEqual(held.auth, { not_invoked: 1 });
  assert.equal(bodies.length, 1, "Held copy is never sent");
  assert.ok(order.includes("telegram_auth_message_outcome"));
});

await scenario("sweep: without a valid bot token the inbox is processed but nothing is claimed or failed", async () => {
  const order: string[] = [];
  const rpc = async (name: string) => {
    order.push(name);
    if (name === "channel_inbox_next") return [];
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    throw Error(`unexpected ${name}`);
  };
  const noToken = createTelegramAdapter({ config: { ...BOT, enabled: true, botToken: "", timeoutMs: 50, maxResponseBytes: 262_144 }, http: async () => { throw Error("never"); } });
  const report = await runTelegramSweep({ rpc, adapter: noToken, accountRef: JSON.stringify([BOT.account, BOT.botId]) });
  assert.equal(report.sending, "off");
  assert.deepEqual(order, ["channel_inbox_next", "delivery_reconcile_stale"]);
});

const mediaUpdate = (id: number, extra: Record<string, unknown> = {}, chat: { id: number; type: string } = { id: MEMBER, type: "private" }) =>
  ({ update_id: id, message: { message_id: id + 500, date: 1_760_000_000, from: { id: MEMBER, is_bot: false, first_name: "Synthetic" }, chat, voice: { file_id: "synthetic-file", duration: 3 }, ...extra } });

await scenario("media: a private voice note, photo or file is recognised by identifiers only; forwarded, group and text messages are not", () => {
  const voice = parseTelegramMedia(mediaUpdate(40), BOT);
  assert.ok(voice.ok);
  assert.deepEqual(Object.keys(voice.event).sort(), ["chatId", "eventId", "fingerprint", "messageId", "principalRef"]);
  assert.ok(!JSON.stringify(voice.event).includes("synthetic-file"), "No media reference kept");
  assert.equal(voice.event.eventId, JSON.stringify(["telegram", BOT.account, BOT.botId, "update", 40]));
  assert.equal(parseTelegramMedia(mediaUpdate(41, { forward_origin: { type: "user" } }), BOT).ok, false);
  assert.equal(parseTelegramMedia(mediaUpdate(42, {}, { id: -100, type: "group" }), BOT).ok, false);
  const dice = { update_id: 47, message: { message_id: 1, date: 1, from: { id: MEMBER, is_bot: false }, chat: { id: MEMBER, type: "private" }, dice: { emoji: "x", value: 3 } } };
  assert.equal(parseTelegramMedia(dice, BOT).ok, true, "Kinds outside any list still get the text-only reply");
  assert.equal(parseTelegramMedia({ update_id: 48, message: { message_id: 1, date: 1, from: { id: MEMBER, is_bot: false }, chat: { id: MEMBER, type: "private" }, pinned_message: {} } }, BOT).ok, false, "Service events are not media");
  assert.equal(parseTelegramMedia(update(43, "plain text"), BOT).ok, false);
  assert.equal(parseTelegramMedia({ update_id: 44, message: { message_id: 1, date: 1, from: { id: 9, is_bot: false }, chat: { id: MEMBER, type: "private" }, photo: [] } }, BOT).ok, false, "Sender must be the chat");
});

await scenario("webhook: media is committed through its own port and acknowledged only after the database answer", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let answer: unknown = null;
  const rpc = async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return answer; };
  const letters: string[] = [];
  const hook = createTelegramWebhook({ config: config(), inbox: async () => ({ status: "failed" }), media: mediaPort(rpc), deadLetter: async id => { letters.push(id); return true; } });
  const body = mediaUpdate(45);
  const parsed = parseTelegramMedia(body, BOT); assert.ok(parsed.ok);
  answer = { status: "committed", eventId: parsed.event.eventId, fingerprint: parsed.event.fingerprint };
  assert.equal((await hook(request(body).req)).status, 200);
  assert.deepEqual(calls[0].args.p_event, { adapter: "telegram", eventId: parsed.event.eventId, fingerprint: parsed.event.fingerprint, principalRef: parsed.event.principalRef, kind: "media", payload: { chatId: MEMBER, messageId: 545 } });
  answer = { status: "failed", code: "unavailable" };
  assert.equal((await hook(request(body).req)).status, 503, "Uncommitted media stays retryable");
  assert.equal(letters.length, 0, "Media is never dead-lettered");
  const forwarded = mediaUpdate(46, { forward_origin: { type: "user" } });
  assert.equal((await hook(request(forwarded).req)).status, 200);
  assert.equal(letters.length, 1, "Forwarded media is a content-free dead letter");
});

await scenario("https port: only api.telegram.org over HTTPS, never global fetch, errors carry no URL", async () => {
  const before = realFetch;
  const init = { method: "POST" as const, headers: { "Content-Type": "application/json" as const }, body: "{}", redirect: "error" as const };
  for (const url of ["http://api.telegram.org/botX/sendMessage", "https://evil.example/botX/sendMessage", "https://api.telegram.org:8443/botX/sendMessage", "https://api.telegram.org/botX/sendMessage?x=1", "not a url"]) {
    await assert.rejects(telegramHttpsPort(url, { ...init, signal: new AbortController().signal }), (e: Error) => e.message === "Telegram request refused" && !e.message.includes("botX"));
  }
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(telegramHttpsPort("https://api.telegram.org/bot100:secret/sendMessage", { ...init, signal: aborted.signal }), (e: Error) => !e.message.includes("secret"));
  assert.equal(realFetch, before, "The Telegram port never uses global fetch");
});

const contactUpdate = (id: number, contact: Record<string, unknown>, extra: Record<string, unknown> = {}, from = MEMBER, chat: { id: number; type: string } = { id: MEMBER, type: "private" }) =>
  ({ update_id: id, message: { message_id: id + 500, date: 1_760_000_100, from: { id: from, is_bot: false, first_name: "Synthetic" }, chat, contact, ...extra } });

await scenario("contact proof: only the sender's own, non-forwarded contact in a private chat counts; only the normalised phone is kept", () => {
  const own = parseTelegramContact(contactUpdate(60, { phone_number: "374 99 00-11 22", first_name: "Synthetic", user_id: MEMBER, vcard: "BEGIN:VCARD" }), BOT);
  assert.ok(own.ok);
  assert.equal(own.event.phone, "+37499001122");
  assert.equal(own.event.sentAt, 1_760_000_100);
  assert.ok(!JSON.stringify(own.event).includes("Synthetic") && !JSON.stringify(own.event).includes("VCARD"), "Name and vCard dropped");
  // A typed or someone else's card is a refusal input: no number leaves the parser.
  for (const [n, contact] of [[61, { phone_number: "+37499001122" }], [62, { phone_number: "+37499001122", user_id: 999 }]] as const) {
    const foreign = parseTelegramContact(contactUpdate(n, contact), BOT);
    assert.ok(foreign.ok && foreign.event.phone === null, "Typed or someone else's card is never proof");
    assert.ok(!JSON.stringify(foreign).includes("37499001122"), "Its number is dropped");
  }
  assert.equal(parseTelegramContact(contactUpdate(63, { phone_number: "+37499001122", user_id: MEMBER }, { forward_origin: { type: "user" } }), BOT).ok, false, "Forwarded contact");
  assert.equal(parseTelegramContact(contactUpdate(64, { phone_number: "+37499001122", user_id: MEMBER }, {}, MEMBER, { id: -100, type: "group" }), BOT).ok, false, "Group chat");
  assert.equal(parseTelegramContact(contactUpdate(65, { phone_number: "12", user_id: MEMBER }), BOT).ok, false, "Implausible number");
});

await scenario("contact request: the share button is sent once with the exact text; bad labels send nothing", async () => {
  let body: Record<string, unknown> | null = null, calls = 0;
  const http: TelegramHttpPort = async (_url, init) => { calls++; body = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, result: { message_id: 1, from: { id: BOT.botId, is_bot: true }, chat: { id: MEMBER, type: "private" }, text: "Share your number." } }), { status: 200 }); };
  const adapter = adapterWith(http);
  const r = await adapter.deliverText({ address: String(MEMBER), text: "Share your number.", keyboard: { kind: "request_contact", label: "Share my phone number" } });
  assert.equal(r.kind, "accepted");
  assert.deepEqual((body as unknown as { reply_markup: unknown }).reply_markup, { keyboard: [[{ text: "Share my phone number", request_contact: true }]], one_time_keyboard: true, resize_keyboard: true });
  assert.equal((await adapter.deliverText({ address: String(MEMBER), text: "x", keyboard: { kind: "request_contact", label: " padded " } })).kind, "unsupported");
  assert.equal(calls, 1);
});

await scenario("staff notice: the open button links only to a staff app page, sent once; anything else sends nothing", async () => {
  let body: Record<string, unknown> | null = null, calls = 0;
  const text = "You have a new message from a member.";
  const http: TelegramHttpPort = async (_url, init) => { calls++; body = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, result: { message_id: 2, from: { id: BOT.botId, is_bot: true }, chat: { id: MEMBER, type: "private" }, text } }), { status: 200 }); };
  const adapter = adapterWith(http);
  const url = "https://backoffice.noreon.health/staff/real/conversations/5e000000-0000-4000-8000-000000000001";
  const r = await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open in Noreon", url } });
  assert.equal(r.kind, "accepted");
  assert.deepEqual((body as unknown as { reply_markup: unknown }).reply_markup, { inline_keyboard: [[{ text: "Open in Noreon", url }]] });
  for (const bad of ["http://backoffice.noreon.health/staff/real/unassigned", "https://evil.example/staff/real/unassigned", "https://backoffice.noreon.health.evil.example/staff/real/unassigned",
    "https://user@backoffice.noreon.health/staff/real/unassigned", "https://backoffice.noreon.health:8443/staff/real/unassigned", "https://backoffice.noreon.health/patient/review",
    "https://backoffice.noreon.health/staff/real/unassigned?x=1", "https://backoffice.noreon.health/staff/real/unassigned#x", "https://backoffice.noreon.health/staff/real/../../api/x",
    "https://BACKOFFICE.noreon.health/staff/real/unassigned", "javascript:alert(1)", ""]) {
    assert.equal(isStaffAppLink(bad), false, bad);
    assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open in Noreon", url: bad } })).kind, "unsupported", bad);
  }
  assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: " padded ", url } })).kind, "unsupported");
  assert.ok(isStaffAppLink("https://backoffice.noreon.health/staff/real/unassigned") && isStaffAppLink("https://backoffice.noreon.health/staff/real/members/5e000000-0000-4000-8000-000000000003"));
  assert.equal(calls, 1);
});

await scenario("staff notice: the sweep passes the claimed link button through unchanged", async () => {
  const bodies: string[] = [];
  const AUTH = "00000000-0000-4000-8000-0000000000ad";
  const url = "https://backoffice.noreon.health/staff/real/unassigned";
  const rpc = async (name: string) => {
    if (name === "channel_inbox_next") return [];
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    if (name === "telegram_dispatch_queue") return { system: [], replies: [] };
    if (name === "telegram_auth_message_queue") return [AUTH];
    if (name === "telegram_auth_message_claim") return { ok: true, fresh: true, envelope: { messageId: AUTH, attemptId: "00000000-0000-4000-8000-0000000000ae", address: String(MEMBER), text: "Synthetic notice.", keyboard: { kind: "open_url", label: "Open", url } } };
    if (name === "telegram_auth_message_outcome") return { ok: true, result: "recorded" };
    throw Error(name);
  };
  const http: TelegramHttpPort = async (_url, init) => { bodies.push(String(init.body)); return sentEcho("Synthetic notice.")(); };
  const report = await runTelegramSweep({ rpc, adapter: adapterWith(http), accountRef: JSON.stringify([BOT.account, BOT.botId]), newId: () => "00000000-0000-4000-8000-0000000000ae" });
  assert.deepEqual(report.auth, { outcome_recorded: 1 });
  assert.deepEqual(JSON.parse(bodies[0]).reply_markup, { inline_keyboard: [[{ text: "Open", url }]] });
});

await scenario("member notice: the open button links only to a member app page; reminders are queued before sending and never block the sweep", async () => {
  let calls = 0;
  const text = "Your visit is confirmed.";
  const sentBodies: string[] = [];
  const http: TelegramHttpPort = async (_url, init) => { calls++; sentBodies.push(String(init.body)); return sentEcho(text)(); };
  const adapter = adapterWith(http);
  const url = "https://app.noreon.health/patient/care";
  assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open Noreon", url } })).kind, "accepted");
  for (const bad of ["https://app.noreon.health/staff/real/unassigned", "https://backoffice.noreon.health/patient/care", "https://app.noreon.health/patient/care?x=1",
    "https://app.noreon.health/patient/care#t=x", "https://app.noreon.health/api/x", "http://app.noreon.health/patient/care", "https://app.noreon.health.evil.example/patient/care"]) {
    assert.equal(isMemberAppLink(bad), false, bad);
    assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open Noreon", url: bad } })).kind, "unsupported", bad);
  }
  assert.ok(isMemberAppLink("https://app.noreon.health/patient/results") && isMemberAppLink("https://app.noreon.health/patient/dashboard"));
  assert.equal(calls, 1);
  // The one-tap sign-in link on the button: only the link page with a well-formed token in the fragment.
  const signin = `https://app.noreon.health/patient/telegram-link#t=${"A".repeat(30)}-_`;
  assert.ok(isMemberSigninLink(signin));
  for (const bad of [`https://app.noreon.health/patient/telegram-link?t=${"A".repeat(32)}`, `https://app.noreon.health/patient/telegram-link#t=${"A".repeat(31)}`,
    `https://app.noreon.health/patient/telegram-link#t=${"A".repeat(32)}&x=1`, `https://app.noreon.health/patient/care#t=${"A".repeat(32)}`,
    `https://backoffice.noreon.health/patient/telegram-link#t=${"A".repeat(32)}`, `http://app.noreon.health/patient/telegram-link#t=${"A".repeat(32)}`,
    `https://app.noreon.health/patient/telegram-link/#t=${"A".repeat(32)}`, `https://app.noreon.health:444/patient/telegram-link#t=${"A".repeat(32)}`]) {
    assert.equal(isMemberSigninLink(bad), false, bad);
    assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open Noreon", url: bad } })).kind, "unsupported", bad);
  }
  assert.equal(calls, 1);
  assert.equal((await adapter.deliverText({ address: String(MEMBER), text, keyboard: { kind: "open_url", label: "Open Noreon", url: signin } })).kind, "accepted");
  assert.equal(calls, 2);
  // Review F-2: a message whose button signs in is protected (no forward or save); a plain page button is not.
  assert.equal(JSON.parse(sentBodies[1]).protect_content, true, "Sign-in button: protect_content");
  assert.equal("protect_content" in JSON.parse(sentBodies[0]), false, "Page button: not protected");
  const order: string[] = [];
  const rpc = (failReminders: boolean) => async (name: string) => {
    order.push(name);
    if (name === "channel_inbox_next") return [];
    if (name === "delivery_reconcile_stale") return { ok: true, reconciled: 0 };
    if (name === "member_notice_reminders_run") { if (failReminders) throw Error("db"); return { ok: true, state: "ran", queued: 2 }; }
    if (name === "bp_week_reminders_run") { if (failReminders) throw Error("db"); return { ok: true, state: "ran", queued: 1 }; }
    if (name === "member_medicine_reminders_run") return { ok: true, state: "off" };
    if (name === "member_medicine_asks_run") { if (failReminders) throw Error("db"); return { ok: true, state: "ran", opened: 1, queued: 1 }; }
    if (name === "telegram_dispatch_queue") return { system: [], replies: [] };
    if (name === "telegram_auth_message_queue") return [];
    throw Error(name);
  };
  const ref = JSON.stringify([BOT.account, BOT.botId]);
  assert.equal((await runTelegramSweep({ rpc: rpc(false), adapter, accountRef: ref })).reminders, "queued 2");
  assert.ok(order.indexOf("member_notice_reminders_run") < order.indexOf("telegram_auth_message_queue"));
  // BP week and medicine reminders are queued in the same sweep, before sending (dark switches decide).
  assert.ok(order.indexOf("bp_week_reminders_run") < order.indexOf("telegram_auth_message_queue") && order.indexOf("member_medicine_reminders_run") < order.indexOf("telegram_auth_message_queue"));
  const sweep = await runTelegramSweep({ rpc: rpc(false), adapter, accountRef: ref });
  assert.equal(sweep.bpWeek, "queued 1");
  assert.equal(sweep.medicines, "off");
  assert.equal(sweep.medicineAsks, "queued 1");
  assert.ok(order.indexOf("member_medicine_asks_run") < order.indexOf("telegram_auth_message_queue"), "missed-dose asks are queued before sending");
  const failed = await runTelegramSweep({ rpc: rpc(true), adapter, accountRef: ref });
  assert.equal(failed.reminders, "failed");
  assert.equal(failed.bpWeek, "failed", "a failing BP week sweep never blocks sending");
  assert.equal(failed.medicineAsks, "failed", "a failing medicine-ask sweep never blocks sending");
});

await scenario("reply links: Zoe texts and doctor replies carry the one-tap button only when the database arms it; never another URL", async () => {
  const ORIGIN = "https://app.noreon.health";
  const bodies: string[] = [];
  // Zoe (system message): armed, so the button carries the sign-in link and the message is protected.
  for (const [armAnswer, expectButton] of [[{ ok: true, step: "open_messages", label: "Open Noreon" }, true], [{ ok: false, code: "rate_limited" }, false], ["throw", false],
    // Review R1: a label Telegram would refuse drops the button, never the reply.
    [{ ok: true, step: "open_messages", label: "L".repeat(65) }, false], [{ ok: true, step: "open_messages", label: " Open " }, false]] as const) {
    const { rpc: base, calls } = systemRpc(ACK);
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === "telegram_signin_link_arm_reply") { calls.push({ name, args }); if (armAnswer === "throw") throw Error("db"); return armAnswer; }
      return base(name, args);
    };
    const http: TelegramHttpPort = async (url, init) => { bodies.push(String(init.body)); return sentEcho(ACK)(); };
    const r = await dispatchSystemMessage(rpc, adapterWith(http), JSON.stringify([BOT.account, BOT.botId]), "00000000-0000-4000-8000-0000000000aa", attempt, { tries: 1, backoffMs: 0, signinLinkOrigin: ORIGIN });
    assert.equal(r.state, "outcome_recorded", "The reply always goes");
    const arm = calls.find(c => c.name === "telegram_signin_link_arm_reply")!;
    assert.equal(arm.args.p_kind, "system"); assert.equal(arm.args.p_ref, "00000000-0000-4000-8000-0000000000aa"); assert.match(String(arm.args.p_token_hash), /^[a-f0-9]{64}$/);
    const body = JSON.parse(bodies.at(-1)!);
    assert.equal(body.text, ACK, "Text unchanged, no URL in it");
    if (expectButton) {
      assert.equal(body.protect_content, true);
      assert.equal(body.reply_markup.inline_keyboard[0][0].text, "Open Noreon");
      assert.match(body.reply_markup.inline_keyboard[0][0].url, /^https:\/\/app\.noreon\.health\/patient\/telegram-link#t=[A-Za-z0-9_-]{32}$/);
    } else assert.equal("reply_markup" in body, false, "Not armed: no button");
  }
  // Switch off: nothing armed.
  { const { rpc, calls } = systemRpc(ACK);
    await dispatchSystemMessage(rpc, adapterWith(async () => sentEcho(ACK)()), JSON.stringify([BOT.account, BOT.botId]), "00000000-0000-4000-8000-0000000000aa", attempt, { tries: 1, backoffMs: 0 });
    assert.equal(calls.some(c => c.name === "telegram_signin_link_arm_reply"), false); }
  // Doctor reply (delivery): the adapter accepts only a member sign-in link as the button.
  const text = "Dr Synthetic\n\nExact synthetic reply";
  const sent: string[] = [];
  const adapter = adapterWith(async (_u, init) => { sent.push(String(init.body)); return sentEcho(text)(); });
  const signin = `${ORIGIN}/patient/telegram-link#t=${"C".repeat(32)}`;
  assert.equal((await adapter.deliver(envelope as never, { keyboard: { kind: "open_url", label: "Open Noreon", url: signin } })).kind, "accepted");
  assert.deepEqual(JSON.parse(sent[0]).reply_markup, { inline_keyboard: [[{ text: "Open Noreon", url: signin }]] }); assert.equal(JSON.parse(sent[0]).protect_content, true);
  assert.equal(JSON.parse(sent[0]).text, text, "Clinical text unchanged");
  assert.equal((await adapter.deliver(envelope as never)).kind, "accepted"); assert.equal("reply_markup" in JSON.parse(sent[1]), false, "No button: plain reply");
  for (const bad of [`${ORIGIN}/patient/zoe`, "https://evil.example/patient/telegram-link#t=" + "C".repeat(32), `${ORIGIN}/patient/telegram-link?t=${"C".repeat(32)}`])
    assert.equal((await adapter.deliver(envelope as never, { keyboard: { kind: "open_url", label: "Open Noreon", url: bad } })).kind, "unsupported", bad);
  assert.equal(sent.length, 2, "A wrong button sends nothing");
  // The delivery button helper asks the database for this delivery, and gives nothing when it says no.
  const armCalls: Record<string, unknown>[] = [];
  const armRpc = (answer: unknown) => (async (name: string, args: Record<string, unknown>) => { assert.equal(name, "telegram_signin_link_arm_reply"); armCalls.push(args); return answer; }) as never;
  const b = await replySigninButton(armRpc({ ok: true, label: "Բացել Noreon-ը" }), ORIGIN, "delivery", envelope.deliveryId);
  assert.equal(b?.label, "Բացել Noreon-ը"); assert.equal(armCalls[0].p_kind, "delivery"); assert.equal(armCalls[0].p_ref, envelope.deliveryId);
  assert.equal(await replySigninButton(armRpc({ ok: false, code: "none" }), ORIGIN, "delivery", envelope.deliveryId), undefined);
  assert.equal(await replySigninButton(armRpc({ ok: true, label: "L".repeat(65) }), ORIGIN, "delivery", envelope.deliveryId), undefined, "Doctor reply: an over-long label gives no button (the reply is sent plain)");
  assert.equal(await replySigninButton(armRpc({ ok: true, label: "x" }), "http://localhost:3000", "delivery", envelope.deliveryId), undefined, "An origin the adapter refuses is never armed");
  assert.equal(armCalls.length, 3);
});

await scenario("D2: replies are normalised before hashing; delivery never edits text", () => {
  assert.equal(normalizeReplyBody("  Take it with food.\r\n\r\n"), "Take it with food.");
  assert.equal(normalizeReplyBody("Line one\r\nLine two"), "Line one\nLine two");
  assert.equal(normalizeReplyBody("Already exact"), "Already exact");
});

await scenario("weekly BP summary: exact flag, legacy and V3 dispatch, and isolated sweep failure", async () => {
  const saved = {flag: process.env.NOREON_ZOE_BP_TRENDS, v3: process.env.NOREON_ZOE_APP_V3};
  try {
    for (const flag of [undefined, "false", "TRUE", "true ", "true"]) {
      for (const v3 of ["false", "true"]) {
        if (flag === undefined) delete process.env.NOREON_ZOE_BP_TRENDS;
        else process.env.NOREON_ZOE_BP_TRENDS = flag;
        process.env.NOREON_ZOE_APP_V3 = v3;
        const calls: string[] = [];
        let fail = false;
        const rpc = async (name: string) => {
          calls.push(name);
          if (name === "channel_inbox_next" || name === "telegram_auth_message_queue") return [];
          if (name === "telegram_dispatch_queue") return {system: [], replies: []};
          if (name === "bp_weekly_summary_run") {
            if (fail) throw Error("Synthetic sweep failure");
            return {state: "ran", queued: 1};
          }
          return {state: "off"};
        };
        const deps = {rpc, adapter: adapterWith(async () => { throw Error("No delivery expected"); }), accountRef: "synthetic"};
        const result = await runTelegramSweep(deps);
        assert.equal(calls.includes("bp_weekly_summary_run"), flag === "true");
        assert.equal(result.bpWeekly, flag === "true" ? "queued 1" : "off");
        if (flag === "true") {
          assert.ok(calls.indexOf("bp_weekly_summary_run") < calls.indexOf("telegram_auth_message_queue"));
          fail = true;
          assert.equal((await runTelegramSweep(deps)).bpWeekly, "failed");
        }
      }
    }
  } finally {
    if (saved.flag === undefined) delete process.env.NOREON_ZOE_BP_TRENDS;
    else process.env.NOREON_ZOE_BP_TRENDS = saved.flag;
    if (saved.v3 === undefined) delete process.env.NOREON_ZOE_APP_V3;
    else process.env.NOREON_ZOE_APP_V3 = saved.v3;
  }
});

assert.equal(realFetch, 0, "No real network request");
console.log(`${results.length}/${results.length} Telegram runtime scenarios passed (injected ports; no database, network or Telegram).`);
