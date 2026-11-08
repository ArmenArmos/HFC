import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setImmediate as tick, setTimeout as sleep } from "node:timers/promises";
import type { OutboundPayload, VerifiedEnvelope } from "@/lib/conversation-core/channel-contract";
import {
  COMMAND_SCHEMA_VERSION,
  type AdapterId, type ApprovalId, type AttemptId, type AuthoritySnapshot, type ClinicId, type CommandPurpose,
  type DeliveryId, type EndpointId, type IntentId, type StaffId,
} from "@/lib/conversation-core/contracts";
import { runSender } from "@/lib/conversation-core/delivery-machine";
import { fictionalWorld } from "@/lib/conversation-core/fixtures";
import { actionsFor, executeCommand, openConversation, proposeDraft, receiveMemberMessage, type ActorRef } from "@/lib/conversation-core/reply-machine";
import { createTelegramWebhook, type TelegramInboxPort, type TelegramWebhookConfig } from "@/lib/telegram-channel/ingress";
import { createTelegramAdapter, type TelegramHttpPort, type TelegramOutboundConfig } from "@/lib/telegram-channel/outbound";
import {
  parseTelegramUpdate, telegramIntentButton, telegramPrincipalRef, TELEGRAM_ADAPTER,
  type TelegramBot, type TelegramIngressEvent,
} from "@/lib/telegram-channel/protocol";

/**
 * SYNTHETIC boundary checks for the Telegram channel adapter.
 *
 * Every request goes through the actual Request -> Response webhook handler and
 * every send through the actual ChannelAdapter with an injected HTTP port. The
 * inbox is a RECORDING STAND-IN (a Map, not a database): it proves the handler's
 * commit-before-acknowledge handshake, not durability. The intent resolver in the
 * core trace is a SYNTHETIC stand-in for Noreon's trusted product resolver. No
 * Telegram service, bot, token, database or network is involved, and global
 * fetch is replaced so that an accidental real request fails the run.
 */

let realFetchAttempts = 0;
globalThis.fetch = (() => {
  realFetchAttempts++;
  throw Error("Real network access is forbidden in this check.");
}) as typeof fetch;

// Synthetic fixtures ------------------------------------------------------------

const SECRET = "synthetic_webhook_secret_0123456789abcdef";
const TOKEN = "100:synthetic_opaque_bot_token_0123456789AB";
const BOT: TelegramBot = { account: "synthetic-member", botId: 100 };
const OTHER_BOT: TelegramBot = { account: "synthetic-other", botId: 101 };
const MEMBER = 2001, DOCTOR = 1001, DOCTOR_B = 1002;
const ENDPOINT = "https://noreon.invalid/telegram";
const CAP = 262_144;

const webhookConfig = (overrides: Partial<TelegramWebhookConfig> = {}): TelegramWebhookConfig =>
  ({ enabled: true, ...BOT, webhookSecret: SECRET, maxBodyBytes: CAP, readTimeoutMs: 150, commitTimeoutMs: 150, ...overrides });
const outboundConfig = (overrides: Partial<TelegramOutboundConfig> = {}): TelegramOutboundConfig =>
  ({ enabled: true, ...BOT, botToken: TOKEN, timeoutMs: 60, maxResponseBytes: CAP, ...overrides });

const person = (id: number) => ({ id, is_bot: false, first_name: "Synthetic" });
const privateChat = (id: number) => ({ id, type: "private", first_name: "Synthetic" });
const textMessage = (updateId: number, text: string, from: number) =>
  ({ message_id: updateId + 500, date: 1_760_000_000, from: person(from), chat: privateChat(from), text });
const textUpdate = (updateId: number, text = "Synthetic member text", from = MEMBER, extra: Record<string, unknown> = {}) =>
  ({ update_id: updateId, message: { ...textMessage(updateId, text, from), ...extra } });
const botMessage = (chatId: number, botId = BOT.botId) => ({
  message_id: 77, date: 1_760_000_000, from: { id: botId, is_bot: true, first_name: "Synthetic bot" }, chat: privateChat(chatId),
  text: "Untrusted earlier bot display text", reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: "ni1:display_only_reference" }]] },
});
const REF = "opaque_reference_0123456789";
const callbackUpdate = (updateId: number, data = `ni1:${REF}`, from = DOCTOR, extra: Record<string, unknown> = {}) =>
  ({ update_id: updateId, callback_query: { id: `cb_${updateId}`, from: person(from), message: botMessage(from), chat_instance: "-5550001", data, ...extra } });
/** A callback whose carrier message was authored by `bot`, as Telegram would deliver it to that bot. */
const callbackFor = (bot: TelegramBot, updateId: number, from = DOCTOR, data = `ni1:${REF}`) =>
  callbackUpdate(updateId, data, from, { message: botMessage(from, bot.botId) });

type RequestOptions = { secret?: string | null; method?: string; contentType?: string | null; url?: string; headers?: [string, string][]; signal?: AbortSignal };
function headersFor(options: RequestOptions) {
  const headers = new Headers(options.headers);
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/json");
  if (options.secret !== null) headers.append("X-Telegram-Bot-Api-Secret-Token", options.secret ?? SECRET);
  return headers;
}
const utf8 = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const webhookRequest = (body: unknown, options: RequestOptions = {}) =>
  new Request(options.url ?? ENDPOINT, { method: options.method ?? "POST", headers: headersFor(options), body: typeof body === "string" ? body : JSON.stringify(body), signal: options.signal });

/** A request body that counts every pull, so "zero body reads" is observed rather than assumed. */
function spiedRequest(plan: { chunks?: Uint8Array[]; hang?: boolean }, options: RequestOptions = {}) {
  const spy = { pulls: 0, bytes: 0 };
  const chunks = [...(plan.chunks ?? [])];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      spy.pulls++;
      const next = chunks.shift();
      if (next) { spy.bytes += next.byteLength; controller.enqueue(next); return; }
      if (plan.hang) return new Promise<void>(() => {});
      controller.close();
    },
  }, { highWaterMark: 0 });
  const request = new Request(options.url ?? ENDPOINT, { method: options.method ?? "POST", headers: headersFor(options), body, duplex: "half", signal: options.signal } as RequestInit);
  return { request, spy };
}

/**
 * RECORDING STAND-IN for the durable inbox. Check-and-insert runs synchronously
 * after a yield, which models a unique key on the canonical event id within one
 * process. It is a Map, survives nothing and proves only the handshake.
 */
class RecordingInbox {
  rows = new Map<string, TelegramIngressEvent>();
  calls: TelegramIngressEvent[] = [];
  loseNextAcknowledgement = false;
  port: TelegramInboxPort = async event => {
    this.calls.push(event);
    await tick();
    const key = event.envelope.eventId, prior = this.rows.get(key);
    if (prior && prior.fingerprint !== event.fingerprint) return { status: "conflict" };
    if (!prior) this.rows.set(key, event);
    if (this.loseNextAcknowledgement) {
      this.loseNextAcknowledgement = false;
      throw Error(`synthetic lost commit acknowledgement ${SECRET}`);
    }
    return { status: prior ? "committed-duplicate" : "committed", eventId: key, fingerprint: event.fingerprint };
  };
}

async function hasSettled(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 5; i++) await tick();
  return settled;
}

const parsed = (value: unknown, bot = BOT) => {
  const result = parseTelegramUpdate(value, bot);
  assert.ok(result.ok, `expected admission, got ${JSON.stringify(result)}`);
  return result.event;
};
const rejection = (value: unknown, bot = BOT) => {
  const result = parseTelegramUpdate(value, bot);
  assert.equal(result.ok, false, "expected rejection");
  return result.ok ? null : result.reason;
};

const scenarios: [string, () => void | Promise<void>][] = [];
const scenario = (name: string, fn: () => void | Promise<void>) => scenarios.push([name, fn]);

// Webhook authentication and request bounds -------------------------------------

scenario("disabled, missing or invalid configuration fails closed with zero body pulls and zero port calls", async () => {
  const inbox = new RecordingInbox();
  const invalid: (Partial<TelegramWebhookConfig> | undefined)[] = [
    undefined, { enabled: false }, { enabled: "true" as unknown as true }, { webhookSecret: "" }, { webhookSecret: "short_secret" },
    { webhookSecret: `${SECRET}!` }, { webhookSecret: "x".repeat(257) }, { account: "bad:account" }, { account: "" }, { account: "x".repeat(65) },
    { botId: 0 }, { botId: -1 }, { botId: 1.5 }, { botId: 2 ** 53 }, { maxBodyBytes: 0 }, { maxBodyBytes: 8192 }, { maxBodyBytes: CAP - 1 }, { maxBodyBytes: 1_048_577 }, { maxBodyBytes: CAP + 0.5 },
    { readTimeoutMs: 0 }, { readTimeoutMs: 60_001 }, { readTimeoutMs: 2 ** 31 }, { readTimeoutMs: Number.NaN }, { commitTimeoutMs: 0 }, { commitTimeoutMs: Infinity },
  ];
  for (const overrides of invalid) {
    const handler = createTelegramWebhook({ config: overrides ? webhookConfig(overrides) : undefined, inbox: inbox.port });
    const { request, spy } = spiedRequest({ chunks: [utf8(textUpdate(1))] });
    const response = await handler(request);
    assert.equal(response.status, 503, JSON.stringify(overrides));
    assert.equal(spy.pulls, 0, JSON.stringify(overrides));
  }
  const noInbox = spiedRequest({ chunks: [utf8(textUpdate(1))] });
  assert.equal((await createTelegramWebhook({ config: webhookConfig() })(noInbox.request)).status, 503);
  assert.equal(noInbox.spy.pulls, 0);
  assert.equal(inbox.calls.length, 0);
});

scenario("secret is checked before the body: missing, wrong, equal-length, combined and padded headers read nothing", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const equalLength = SECRET.slice(0, -1) + (SECRET.endsWith("f") ? "e" : "f");
  const attempts: RequestOptions[] = [
    { secret: null }, { secret: "" }, { secret: "wrong" }, { secret: equalLength }, { secret: SECRET.toUpperCase() },
    { secret: `${SECRET.slice(0, 20)} ${SECRET.slice(20)}` }, { secret: `${SECRET}\u00a0` }, { secret: SECRET.slice(0, -1) }, { secret: `${SECRET}0` }, { secret: "x".repeat(10_000) },
    { headers: [["X-Telegram-Bot-Api-Secret-Token", SECRET]] }, // appended twice: "secret, secret"
    { headers: [["X-Telegram-Bot-Api-Secret-Token", "wrong"]] },
  ];
  // Fetch strips surrounding whitespace from header values before any handler runs; this pins that assumption.
  assert.equal(new Headers([["X-Telegram-Bot-Api-Secret-Token", ` ${SECRET}\t`]]).get("X-Telegram-Bot-Api-Secret-Token"), SECRET);
  for (const options of attempts) {
    const { request, spy } = spiedRequest({ chunks: [utf8(textUpdate(1))] }, options);
    const response = await handler(request);
    assert.equal(response.status, 401, JSON.stringify(options).slice(0, 80));
    assert.equal(spy.pulls, 0);
    assert.ok(!(await response.text()).includes(SECRET));
  }
  assert.equal(inbox.calls.length, 0);
  const accepted = spiedRequest({ chunks: [utf8(textUpdate(1))] });
  assert.equal((await handler(accepted.request)).status, 200);
  assert.ok(accepted.spy.pulls > 0, "a correctly authenticated request is read");
});

scenario("a secret configured for one bot does not authenticate another bot's handler", async () => {
  const inbox = new RecordingInbox();
  const other = createTelegramWebhook({ config: webhookConfig({ ...OTHER_BOT, webhookSecret: `${SECRET}_other` }), inbox: inbox.port });
  const { request, spy } = spiedRequest({ chunks: [utf8(textUpdate(1))] });
  assert.equal((await other(request)).status, 401);
  assert.equal(spy.pulls, 0);
  assert.equal(inbox.calls.length, 0);
});

scenario("configuration is copied at construction; later mutation of the caller's object changes nothing", async () => {
  const inbox = new RecordingInbox();
  const config = webhookConfig();
  const handler = createTelegramWebhook({ config, inbox: inbox.port });
  config.webhookSecret = `${SECRET}_mutated`;
  (config as { account: string }).account = "mutated";
  assert.equal((await handler(webhookRequest(textUpdate(1)))).status, 200);
  assert.equal((await handler(webhookRequest(textUpdate(2), { secret: `${SECRET}_mutated` }))).status, 401);
  assert.equal(inbox.calls[0].envelope.principalRef, telegramPrincipalRef(BOT, MEMBER));
});

scenario("method, query, content type and declared length are refused after authentication and before the body", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const cases: [RequestOptions, number][] = [
    [{ method: "PUT" }, 405], [{ url: `${ENDPOINT}?token=${SECRET}` }, 400], [{ contentType: "text/plain" }, 415], [{ contentType: null }, 415],
    [{ headers: [["content-length", String(CAP + 1)]] }, 413], [{ headers: [["content-length", "12x"]] }, 400], [{ headers: [["content-length", "-1"]] }, 400],
  ];
  for (const [options, status] of cases) {
    const { request, spy } = spiedRequest({ chunks: [utf8(textUpdate(1))] }, options);
    const response = await handler(request);
    assert.equal(response.status, status, JSON.stringify(options));
    assert.equal(spy.pulls, 0, JSON.stringify(options));
    assert.ok(!(await response.text()).includes(SECRET));
  }
  assert.equal((await handler(new Request(ENDPOINT, { method: "GET", headers: headersFor({}) }))).status, 405);
  assert.equal(inbox.calls.length, 0);
});

scenario("body is bounded while streaming, decoded strictly and cancelled or timed out without reaching the inbox", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const oversized = spiedRequest({ chunks: Array.from({ length: 400 }, () => new Uint8Array(1000).fill(32)) });
  assert.equal((await handler(oversized.request)).status, 413);
  assert.ok(oversized.spy.bytes <= CAP + 1000, `stopped pulling after the cap (${oversized.spy.bytes} bytes)`);
  for (const body of ["{", "", "null", "[]", '"text"']) assert.notEqual((await handler(webhookRequest(body))).status, 200, body);
  const invalidUtf8 = spiedRequest({ chunks: [new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d])] });
  assert.equal((await handler(invalidUtf8.request)).status, 400);
  const started = Date.now();
  const slow = spiedRequest({ chunks: [utf8("{")], hang: true });
  assert.equal((await handler(slow.request)).status, 408);
  assert.ok(Date.now() - started < 2000, "read timeout bounds a stalled body");
  const abort = new AbortController();
  const cancelled = spiedRequest({ chunks: [utf8("{")], hang: true }, { signal: abort.signal });
  const pending = handler(cancelled.request);
  await tick();
  abort.abort();
  assert.equal((await pending).status, 400);
  assert.equal(inbox.calls.length, 0);
});

// Admitted shapes and namespaces ---------------------------------------------------

scenario("ordinary private text is admitted with inert documented metadata: /start, entities, link preview and same-chat replies", async () => {
  const start = parsed(textUpdate(1, "/start link_token_untrusted", MEMBER, { entities: [{ type: "bot_command", offset: 0, length: 6 }] }));
  assert.equal(start.envelope.kind, "text");
  assert.equal(start.envelope.kind === "text" && start.envelope.text, "/start link_token_untrusted", "the start token stays inert text");
  assert.deepEqual(Object.keys(start.envelope).sort(), ["adapter", "eventId", "forwarded", "kind", "principalRef", "text"]);
  parsed(textUpdate(2, "See https://example.invalid", MEMBER, { entities: [{ type: "url", offset: 4, length: 23 }], link_preview_options: { is_disabled: true } }));
  const reply = parsed(textUpdate(3, "Replying", MEMBER, { reply_to_message: { ...botMessage(MEMBER), message_id: 41 }, quote: { text: "earlier", position: 0 } }));
  assert.equal(reply.transport.replyToMessageId, 41);
  assert.equal(rejection(textUpdate(4, "Replying", MEMBER, { reply_to_message: { ...botMessage(DOCTOR), message_id: 41 } })), "reply_chat_mismatch");
  const text = parsed(textUpdate(5, "Exact հայերեն text 🔥 <b>not markup</b>"));
  assert.deepEqual(text.envelope, { adapter: TELEGRAM_ADAPTER, principalRef: telegramPrincipalRef(BOT, MEMBER), eventId: text.envelope.eventId, forwarded: false, kind: "text", text: "Exact հայերեն text 🔥 <b>not markup</b>" });
  assert.ok(Object.isFrozen(text) && Object.isFrozen(text.envelope) && Object.isFrozen(text.transport));
});

scenario("unsupported, forwarded, edited, group, business, inline, media and unknown shapes are rejected explicitly and never reach the inbox", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const message = textUpdate(1).message;
  const variants: unknown[] = [
    { update_id: 1, edited_message: message }, { update_id: 1, channel_post: message }, { update_id: 1, business_message: message },
    { update_id: 1, edited_business_message: message }, { update_id: 1, inline_query: { id: "q", from: person(MEMBER), query: "", offset: "" } },
    { update_id: 1, message_reaction: {} }, { update_id: 1, my_chat_member: {} }, { update_id: 1, poll_answer: {} }, { update_id: 1 },
    { update_id: 1, message, callback_query: callbackUpdate(1).callback_query }, { ...textUpdate(1), actor: "doctor" }, { ...textUpdate(1), account: "synthetic-other" },
    textUpdate(1, "x", MEMBER, { forward_origin: { type: "user", date: 1, sender_user: person(DOCTOR) } }), textUpdate(1, "x", MEMBER, { is_automatic_forward: true }),
    textUpdate(1, "x", MEMBER, { sender_chat: privateChat(5) }), textUpdate(1, "x", MEMBER, { via_bot: { id: 7, is_bot: true, first_name: "b" } }),
    textUpdate(1, "x", MEMBER, { edit_date: 2 }), textUpdate(1, "x", MEMBER, { message_thread_id: 3 }), textUpdate(1, "x", MEMBER, { business_connection_id: "b" }),
    textUpdate(1, "x", MEMBER, { external_reply: { origin: { type: "hidden_user", date: 1, sender_user_name: "x" } } }), textUpdate(1, "x", MEMBER, { voice: { file_id: "v" } }),
    textUpdate(1, "x", MEMBER, { document: { file_id: "d" } }), textUpdate(1, "x", MEMBER, { photo: [] }), textUpdate(1, "x", MEMBER, { role: "doctor" }),
    { update_id: 1, message: { ...message, chat: { id: -42, type: "group", title: "g" } } }, { update_id: 1, message: { ...message, chat: { id: MEMBER, type: "supergroup", title: "g" } } },
    { update_id: 1, message: { ...message, text: undefined, caption: "x" } }, { update_id: 1, message: { ...message, text: "" } }, { update_id: 1, message: { ...message, text: "x".repeat(4097) } },
    { update_id: 1, message: { ...message, text: "lone \ud800 surrogate" } }, { update_id: 0, message }, { update_id: -1, message }, { update_id: 1.5, message },
    { update_id: 2 ** 53, message }, { update_id: "1", message }, { update_id: 1, message: { ...message, from: { ...person(MEMBER), id: 2 ** 53 } } },
    { update_id: 1, message: { ...message, entities: [{ type: "Bot-Command", offset: 0, length: 1 }] } },
  ];
  for (const variant of variants) {
    const response = await handler(webhookRequest(variant));
    assert.equal(response.status, 422, JSON.stringify(variant).slice(0, 120));
  }
  assert.equal(inbox.calls.length, 0);
});

scenario("sender, private chat and configured bot must agree; transport facts never confer identity", () => {
  assert.equal(rejection({ update_id: 1, message: { ...textUpdate(1).message, from: person(DOCTOR) } }), "sender_chat_mismatch");
  assert.equal(rejection({ update_id: 1, message: { ...textUpdate(1).message, from: { ...person(MEMBER), is_bot: true } } }), "bot_sender");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR_B, { message: botMessage(DOCTOR) })), "sender_chat_mismatch", "another user clicking a copied button");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { from: { ...person(DOCTOR), is_bot: true } })), "bot_sender");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { message: { ...botMessage(DOCTOR), from: person(DOCTOR) } })), "foreign_carrier", "forged nested sender");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { message: botMessage(DOCTOR, OTHER_BOT.botId) })), "foreign_carrier", "another bot's message");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { message: { ...botMessage(DOCTOR), from: { id: BOT.botId, is_bot: false, first_name: "x" } } })), "foreign_carrier");
  const { message: _carrier, ...inline } = callbackUpdate(1).callback_query;
  void _carrier;
  assert.equal(rejection({ update_id: 1, callback_query: { ...inline, inline_message_id: "inline" } }), "unsupported_shape");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { message: { chat: privateChat(DOCTOR), message_id: 77, date: 0 } })), "unsupported_shape", "inaccessible message");
  assert.equal(rejection(callbackUpdate(1, `ni1:${REF}`, DOCTOR, { game_short_name: "g" })), "unsupported_shape");
  const event = parsed(callbackUpdate(9));
  assert.equal(event.envelope.principalRef, telegramPrincipalRef(BOT, DOCTOR), "actor is the clicking sender");
  assert.deepEqual(event.transport, { updateId: 9, kind: "callback", senderId: DOCTOR, chatId: DOCTOR, messageId: 77, callbackId: "cb_9" });
});

scenario("callback data is an inert opaque reference: JSON, roles, purposes, bodies and malformed references are refused", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const forged = [
    '{"role":"doctor","purpose":"reply.approve"}', '{"schema":1,"purpose":"reply.approve","intentId":"int_aaaaaaaaaaaaaaaaaaaa","requestId":"rq_aaaaaaaaaaaaaaaaaa"}',
    "reply.approve", `a:${REF}`, `ni1:${REF}:reply.approve`, `ni1:${REF} body`, `ni2:${REF}`, "ni1:short", `ni1:${"x".repeat(61)}`,
    `ni1:${"🔥".repeat(16)}`, "ni1:abc/def_ghijklmnopqr", "", `NI1:${REF}`,
  ];
  for (const data of forged) {
    assert.equal(rejection(callbackUpdate(1, data)), data === "" ? "unsupported_shape" : "invalid_callback_data", data);
    assert.equal((await handler(webhookRequest(callbackUpdate(1, data)))).status, 422);
  }
  assert.equal(inbox.calls.length, 0);
  const event = parsed(callbackUpdate(2, `ni1:${REF}`));
  assert.equal(event.envelope.kind, "action");
  assert.deepEqual(event.envelope.kind === "action" && event.envelope.action, { intentRef: REF });
  const world = fictionalWorld("inert-callback");
  const denied = executeCommand(world.state, world.ctx, event.envelope);
  assert.deepEqual(denied, { ok: false, code: "invalid_command" }, "the parsed callback cannot satisfy the core command schema");
});

scenario("intent buttons stay within Telegram's 1-64 byte callback limit and reject unsafe labels or references", () => {
  assert.deepEqual(telegramIntentButton("Approve and send this exact reply", "x".repeat(60)), { text: "Approve and send this exact reply", callback_data: `ni1:${"x".repeat(60)}` });
  assert.equal(Buffer.byteLength(telegramIntentButton("Approve", "x".repeat(60)).callback_data, "utf8"), 64);
  for (const [label, ref] of [["Approve", "x".repeat(61)], ["Approve", "x".repeat(15)], ["Approve", "bad/ref_0123456789"], ["Approve", "🔥".repeat(16)], ["", REF], ["x".repeat(129), REF], ["lone \ud800", REF]])
    assert.throws(() => telegramIntentButton(label, ref), `${label.slice(0, 10)} ${ref.slice(0, 10)}`);
});

scenario("canonical bot namespace reaches the core principal, event and request keys; replays are stable and collisions absent", () => {
  const a = parsed(callbackUpdate(5)), again = parsed(callbackUpdate(5));
  assert.deepEqual(a, again, "redelivery yields identical keys and fingerprint");
  const b = parsed(callbackFor(OTHER_BOT, 5), OTHER_BOT);
  assert.notEqual(b.envelope.principalRef, a.envelope.principalRef);
  assert.notEqual(b.envelope.eventId, a.envelope.eventId);
  assert.notEqual(b.requestId, a.requestId);
  assert.notEqual(b.fingerprint, a.fingerprint);
  assert.match(a.requestId, /^[A-Za-z0-9_-]{16,128}$/, "request id satisfies the core opaque id schema");
  const keys = new Set<string>();
  const bots: TelegramBot[] = [{ account: "a", botId: 12 }, { account: "a1", botId: 2 }, { account: "a-1", botId: 2 }, { account: "a_1", botId: 2 }, { account: "a", botId: 1 }];
  for (const bot of bots) {
    // User, update and callback IDs reuse the same numbers in every bot, so only the namespace can separate the keys.
    const text = parsed(textUpdate(12, "x", 12), bot), callback = parsed({ ...callbackFor(bot, 13, 12), callback_query: { ...callbackFor(bot, 13, 12).callback_query, id: "12" } }, bot);
    for (const key of [text.envelope.principalRef, text.envelope.eventId, text.requestId, callback.envelope.eventId, callback.requestId]) {
      assert.ok(!keys.has(key), `collision on ${key}`);
      keys.add(key);
    }
    assert.equal(callback.envelope.principalRef, text.envelope.principalRef, "one principal per user within a bot namespace");
  }
  const renamed = parsed(textUpdate(5), { ...BOT, account: "synthetic-renamed" }), original = parsed(textUpdate(5));
  assert.notEqual(renamed.envelope.eventId, original.envelope.eventId, "a renamed namespace never matches old dedupe keys");
  const world = fictionalWorld("renamed-namespace");
  world.authority.bind(TELEGRAM_ADAPTER, original.envelope.principalRef, { kind: "member", memberId: world.member, generation: 1, revoked: false });
  openConversation(world.state, world.ctx, { conversationId: world.conversationId, memberId: world.member, clinicId: world.clinic });
  assert.deepEqual(receiveMemberMessage(world.state, world.ctx, renamed.envelope), { ok: false, code: "principal_unknown" }, "links do not carry over to a renamed namespace");
  assert.deepEqual(receiveMemberMessage(world.state, world.ctx, original.envelope), { ok: true, duplicate: false });
});

// Commit before acknowledgement ----------------------------------------------------

scenario("the handler waits for the inbox port and acknowledges only an exact committed receipt", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: TelegramIngressEvent[] = [];
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: async event => {
    seen.push(event);
    await gate;
    return { status: "committed", eventId: event.envelope.eventId, fingerprint: event.fingerprint };
  } });
  const pending = handler(webhookRequest(textUpdate(1)));
  for (let i = 0; i < 20 && seen.length === 0; i++) await tick();
  assert.equal(seen.length, 1);
  assert.equal(await hasSettled(pending), false, "no acknowledgement before the port resolves");
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "", "the acknowledgement carries no body for Telegram to interpret");
});

scenario("void, truthy, malformed, mismatched, failed, unknown, conflict, thrown and stalled receipts are retryable 503", async () => {
  const receipts: ((event: TelegramIngressEvent) => unknown)[] = [
    () => undefined, () => true, () => ({}), () => ({ status: "committed" }), () => ({ ok: true }), () => "committed",
    e => ({ status: "committed", eventId: e.envelope.eventId }), e => ({ status: "committed", eventId: `${e.envelope.eventId}x`, fingerprint: e.fingerprint }),
    e => ({ status: "committed", eventId: e.envelope.eventId, fingerprint: "other" }), e => ({ status: "committed", eventId: e.envelope.eventId, fingerprint: e.fingerprint, extra: 1 }),
    e => ({ status: "processed", eventId: e.envelope.eventId, fingerprint: e.fingerprint }), () => ({ status: "failed" }), () => ({ status: "unknown" }), () => ({ status: "conflict" }),
    e => ({ status: "conflict", eventId: e.envelope.eventId, fingerprint: e.fingerprint }),
    () => { throw Error(`database said ${SECRET}`); }, () => Promise.reject(Error(SECRET)),
  ];
  for (const receipt of receipts) {
    let calls = 0;
    const handler = createTelegramWebhook({ config: webhookConfig(), inbox: async event => { calls++; return receipt(event) as never; } });
    const response = await handler(webhookRequest(textUpdate(1)));
    assert.equal(response.status, 503, receipt.toString());
    assert.equal(calls, 1, "exactly one port call, no handler retry");
    assert.ok(!(await response.text()).includes(SECRET));
  }
  let signal: AbortSignal | undefined;
  const stalled = createTelegramWebhook({ config: webhookConfig({ commitTimeoutMs: 40 }), inbox: (_event, options) => { signal = options.signal; return new Promise(() => {}); } });
  const started = Date.now();
  assert.equal((await stalled(webhookRequest(textUpdate(1)))).status, 503);
  assert.ok(Date.now() - started < 2000 && signal?.aborted === true, "a stalled commit times out and is signalled");
});

scenario("simultaneous duplicates both reach the durable port; one row, both acknowledged only after their own receipt", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const [first, second] = await Promise.all([handler(webhookRequest(textUpdate(7))), handler(webhookRequest(textUpdate(7)))]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(inbox.calls.length, 2, "no handler-local dedupe cache");
  assert.equal(inbox.rows.size, 1);
  const conflict = await Promise.all([handler(webhookRequest(textUpdate(8, "original"))), handler(webhookRequest(textUpdate(8, "different body")))]);
  assert.deepEqual(conflict.map(r => r.status).sort(), [200, 503], "same event key with a different fingerprint is a conflict, not a second message");
  assert.equal((await handler(webhookRequest({ ...textUpdate(8, "original"), message: { ...textUpdate(8, "original").message, from: person(DOCTOR), chat: privateChat(DOCTOR) } }))).status, 503, "same key, different actor");
  assert.equal(inbox.rows.size, 2);
});

scenario("a commit whose acknowledgement is lost answers 503, and Telegram's redelivery is acknowledged as a committed duplicate", async () => {
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  inbox.loseNextAcknowledgement = true;
  const lost = await handler(webhookRequest(textUpdate(9)));
  assert.equal(lost.status, 503);
  assert.ok(!(await lost.text()).includes(SECRET));
  assert.equal(inbox.rows.size, 1, "the stand-in committed before losing the response");
  assert.equal((await handler(webhookRequest(textUpdate(9)))).status, 200);
  assert.equal(inbox.rows.size, 1);
  assert.equal(inbox.calls.length, 2);
});

// Outbound ----------------------------------------------------------------------

const SYNTHETIC_BODY = "Exact <b>plain</b> reply *not markdown*. Armenian: Բարև, սա ֆիկտիվ պատասխան է։ 🔥";
const payload = (overrides: Partial<{ body: string; displayName: string; address: string }> = {}): OutboundPayload => Object.freeze({
  deliveryId: "del_synthetic_000000000000" as DeliveryId, attemptId: "att_synthetic_000000000000" as AttemptId, attemptSeq: 1,
  endpointId: "endpoint-synthetic" as EndpointId, address: overrides.address ?? String(MEMBER), generation: 1,
  body: overrides.body ?? SYNTHETIC_BODY, contentHash: "pinned-hash", approvalId: "app_synthetic_000000000000" as ApprovalId,
  approvedBy: Object.freeze({ staffId: "staff-synthetic" as StaffId, displayName: overrides.displayName ?? "Dr Synthetic Avetisyan", role: "doctor" as const, clinicId: "clinic-synthetic" as ClinicId }),
});
type HttpCall = { url: string; init: Parameters<TelegramHttpPort>[1]; body: Record<string, unknown> };
function recordingHttp(respond: (call: HttpCall) => Response | Promise<Response>) {
  const calls: HttpCall[] = [];
  const port: TelegramHttpPort = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  };
  return { calls, port };
}
const sentMessage = (call: HttpCall, result: Record<string, unknown> = {}) => Response.json({
  ok: true,
  result: { message_id: 9, date: 1_760_000_000, from: { id: BOT.botId, is_bot: true, first_name: "Synthetic bot" }, chat: { id: call.body.chat_id, type: "private", first_name: "S" }, text: call.body.text, entities: [], ...result },
});

scenario("outbound sends the exact rendered attribution and body once, as plain text, to the fixed HTTPS endpoint", async () => {
  const http = recordingHttp(call => sentMessage(call));
  const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
  assert.deepEqual(adapter.capabilities(), { adapter: TELEGRAM_ADAPTER, plainText: { maxUtf16Units: 4096 }, idempotentRetry: false });
  const result = await adapter.deliver(payload());
  assert.deepEqual(result, { kind: "accepted", providerRef: JSON.stringify(["telegram", BOT.account, BOT.botId, MEMBER, 9]) });
  assert.equal(http.calls.length, 1);
  const [call] = http.calls;
  assert.equal(call.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual({ method: call.init.method, redirect: call.init.redirect, headers: call.init.headers }, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" } });
  assert.deepEqual(call.body, { chat_id: MEMBER, text: `Dr Synthetic Avetisyan\n\n${SYNTHETIC_BODY}`, link_preview_options: { is_disabled: true } });
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(adapter).includes(TOKEN) && !JSON.stringify(result).includes(TOKEN));
});

scenario("whole-envelope UTF-16 boundary, Unicode validity, destination and attribution are enforced before any HTTP call", async () => {
  const http = recordingHttp(call => sentMessage(call));
  const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
  const prefix = "Dr Synthetic Avetisyan\n\n".length;
  const exact = "🔥".repeat((4096 - prefix) / 2);
  assert.equal(`Dr Synthetic Avetisyan\n\n${exact}`.length, 4096);
  assert.equal((await adapter.deliver(payload({ body: exact }))).kind, "accepted", "exactly 4096 UTF-16 units including attribution");
  assert.equal(http.calls.length, 1);
  const escapedEcho = recordingHttp(call => {
    const json = JSON.stringify({ ok: true, result: { message_id: 9, from: { id: BOT.botId, is_bot: true }, chat: { id: MEMBER, type: "private" }, text: call.body.text, entities: Array.from({ length: 1000 }, (_, i) => ({ type: "hashtag", offset: i, length: 1 })) } });
    return new Response(json.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));
  });
  const armenian = "Բ".repeat(4096 - prefix);
  assert.equal((await createTelegramAdapter({ config: outboundConfig(), http: escapedEcho.port }).deliver(payload({ body: armenian }))).kind, "accepted", "a worst-case escaped echo fits the response floor");
  const refused: Partial<{ body: string; displayName: string; address: string }>[] = [
    { body: `a${exact}` }, { body: "x".repeat(4096) }, { body: "lone \ud83d surrogate" }, { body: "" }, { body: "trailing newline\n" }, { body: "trailing space " },
    { displayName: "" }, { displayName: " Dr Leading Space" }, { address: "@member" }, { address: "-100123" }, { address: "0" }, { address: "02001" }, { address: " 2001" }, { address: "2001.0" },
    { address: "9007199254740993" }, { address: "tg-chat:2001" },
  ];
  for (const overrides of refused) assert.deepEqual(await adapter.deliver(payload(overrides)), { kind: "unsupported" }, JSON.stringify(overrides).slice(0, 60));
  assert.equal((await adapter.deliver(payload({ body: " inner leading space stays exact" }))).kind, "accepted", "only the envelope edges are trimmed by Telegram");
  assert.deepEqual(await adapter.deliver({ ...payload(), body: 7 } as unknown as OutboundPayload), { kind: "unsupported" });
  assert.deepEqual(await adapter.deliver({ ...payload(), approvedBy: undefined } as unknown as OutboundPayload), { kind: "unsupported" });
  assert.equal(http.calls.length, 2, "no refused envelope reached HTTP");
});

scenario("ambiguous outcomes after invocation are unknown, with one call, no retry and no secret in diagnostics", async () => {
  const hanging = () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}) }, { highWaterMark: 0 }));
  const redirected = (call: HttpCall) => Object.defineProperty(sentMessage(call), "redirected", { value: true });
  const elsewhere = (call: HttpCall) => Object.defineProperty(sentMessage(call), "url", { value: "https://api.telegram.org/elsewhere" });
  const responders: [string, (call: HttpCall) => Response | Promise<Response>][] = [
    ["chat mismatch", call => sentMessage(call, { chat: { id: MEMBER + 1, type: "private" } })], ["group chat", call => sentMessage(call, { chat: { id: MEMBER, type: "group" } })],
    ["other bot", call => sentMessage(call, { from: { id: 101, is_bot: true, first_name: "b" } })], ["human sender", call => sentMessage(call, { from: { id: BOT.botId, is_bot: false, first_name: "b" } })],
    ["text changed", call => sentMessage(call, { text: "different" })], ["message id 0", call => sentMessage(call, { message_id: 0 })],
    ["message id fractional", call => sentMessage(call, { message_id: 1.5 })], ["message id string", call => sentMessage(call, { message_id: "9" })],
    ["ok false", () => Response.json({ ok: false, error_code: 400, description: `Bad Request ${TOKEN}` })], ["429", () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, { status: 429 })],
    ["500", () => new Response(TOKEN, { status: 500 })], ["502", () => new Response(null, { status: 502 })], ["redirected", redirected], ["url mismatch", elsewhere],
    ["malformed", () => new Response("{")], ["empty", () => new Response("")], ["oversized", () => new Response(JSON.stringify({ ok: true, pad: "x".repeat(CAP) }))],
    ["not a Response", () => ({ status: 200 }) as unknown as Response], ["throws", () => { throw Error(`connect failed ${TOKEN}`); }],
    ["rejects", () => Promise.reject(Error(TOKEN))], ["never resolves", () => new Promise<Response>(() => {})], ["body stalls", hanging],
  ];
  for (const [name, respond] of responders) {
    const http = recordingHttp(respond);
    const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
    const result = await adapter.deliver(payload());
    assert.equal(result.kind, "unknown", name);
    assert.equal(http.calls.length, 1, `${name}: exactly one invocation`);
    assert.ok(!JSON.stringify(result).includes(TOKEN) && !JSON.stringify(result).includes("Bad Request"), `${name}: constant diagnostics`);
    if (name === "never resolves" || name === "body stalls") assert.equal(http.calls[0].init.signal.aborted, true, `${name}: timeout aborts the port`);
  }
});

scenario("trusted bounded Telegram send rejections prove non-delivery without exposing provider descriptions", async () => {
  const cases: [number, string, string][] = [
    [403, "Forbidden: bot was blocked by the user", "telegram_bot_blocked"],
    [400, "Bad Request: chat not found", "telegram_chat_not_found"],
    [400, "Bad Request: message is too long", "telegram_message_refused"],
    [400, "Bad Request: message text is empty", "telegram_message_refused"],
    [403, "Forbidden: user is deactivated", "telegram_message_refused"],
    [403, "Forbidden: bot can't initiate conversation with a user", "telegram_message_refused"],
  ];
  for (const [status, description, reason] of cases) {
    const http = recordingHttp(call => Object.defineProperty(Response.json({ ok: false, error_code: status, description }, { status }), "url", { value: call.url }));
    const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
    assert.deepEqual(await adapter.deliver(payload()), { kind: "definitely_failed", evidence: reason });
    assert.deepEqual(await adapter.deliverText({ address: String(MEMBER), text: "Synthetic system notice" }), { kind: "definitely_failed", evidence: reason });
    assert.equal(http.calls.length, 2, "one call for each explicit send; no automatic retry");
    assert.equal(await adapter.acknowledgeCallback("cb_rejected"), "unknown", "callback semantics unchanged");
    assert.equal(await adapter.editText({ address: String(MEMBER), messageId: 9, text: "Synthetic card", keyboard: { kind: "callback", rows: [] } }), "unknown", "edit semantics unchanged");
    assert.equal(await adapter.clearKeyboard({ address: String(MEMBER), messageId: 9 }), "unknown", "clear semantics unchanged");
  }
});

scenario("untrusted or ambiguous rejection responses never enable a safe resend", async () => {
  const rejection = { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
  const responders: [string, () => Response][] = [
    ["status mismatch", () => Response.json(rejection, { status: 400 })],
    ["success status", () => Response.json(rejection)],
    ["server failure", () => Response.json(rejection, { status: 500 })],
    ["rate limit", () => Response.json({ ...rejection, error_code: 429 }, { status: 429 })],
    ["unknown description", () => Response.json({ ...rejection, description: `Forbidden: ${TOKEN}` }, { status: 403 })],
    ["extra description", () => Response.json({ ...rejection, description: `${rejection.description} ${TOKEN}` }, { status: 403 })],
    ["contradictory result", () => Response.json({ ...rejection, result: true }, { status: 403 })],
    ["wrong shape", () => Response.json({ ...rejection, ok: "false" }, { status: 403 })],
    ["wrong content type", () => new Response(JSON.stringify(rejection), { status: 403, headers: { "content-type": "text/html" } })],
    ["redirected", () => Object.defineProperty(Response.json(rejection, { status: 403 }), "redirected", { value: true })],
    ["url mismatch", () => Object.defineProperty(Response.json(rejection, { status: 403 }), "url", { value: "https://other.invalid/" })],
    ["oversized", () => Response.json({ ...rejection, padding: "x".repeat(CAP) }, { status: 403 })],
    ["malformed", () => new Response("{", { status: 403, headers: { "content-type": "application/json" } })],
    ["body stalls", () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}) }, { highWaterMark: 0 }), { status: 403, headers: { "content-type": "application/json" } })],
  ];
  for (const [name, respond] of responders) {
    const http = recordingHttp(respond);
    const result = await createTelegramAdapter({ config: outboundConfig(), http: http.port }).deliver(payload());
    assert.equal(result.kind, "unknown", name);
    assert.ok(!JSON.stringify(result).includes(TOKEN) && !JSON.stringify(result).includes("Forbidden"), `${name}: fixed diagnostics only`);
    assert.equal(http.calls.length, 1, name);
  }
});

scenario("disabled, missing or invalid outbound configuration makes zero calls and reports no capability", async () => {
  let calls = 0;
  const port: TelegramHttpPort = async () => { calls++; throw Error("must not be called"); };
  const invalid: (Partial<TelegramOutboundConfig> | undefined)[] = [
    undefined, { enabled: false }, { botToken: "" }, { botToken: "101:synthetic_opaque_bot_token_0123456789AB" }, { botToken: `${TOKEN}/x` },
    { botToken: "100:short" }, { botId: 0 }, { account: "bad account" }, { timeoutMs: 0 }, { timeoutMs: 60_001 }, { timeoutMs: 2 ** 31 }, { timeoutMs: 1.5 },
    { maxResponseBytes: 0 }, { maxResponseBytes: 8192 }, { maxResponseBytes: 1_048_577 }, { maxResponseBytes: Number.NaN },
  ];
  for (const overrides of invalid) {
    const adapter = createTelegramAdapter({ config: overrides ? outboundConfig(overrides) : undefined, http: port });
    assert.equal(adapter.capabilities().plainText, null, JSON.stringify(overrides));
    assert.deepEqual(await adapter.deliver(payload()), { kind: "unsupported" });
    assert.equal(await adapter.acknowledgeCallback("cb_1"), "unsupported");
  }
  const noPort = createTelegramAdapter({ config: outboundConfig() });
  assert.equal(noPort.capabilities().plainText, null);
  assert.deepEqual(await noPort.deliver(payload()), { kind: "unsupported" });
  assert.equal(calls, 0);
});

scenario("callback acknowledgement is an empty answer with no text, alert or URL, sent once and never retried", async () => {
  const http = recordingHttp(() => Response.json({ ok: true, result: true }));
  const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
  assert.equal(await adapter.acknowledgeCallback("cb_42"), "acknowledged");
  assert.deepEqual(http.calls.map(c => [c.url, c.body]), [[`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, { callback_query_id: "cb_42" }]]);
  for (const id of ["", "x".repeat(129), "cb 1", "cb/1"]) assert.equal(await adapter.acknowledgeCallback(id), "unsupported");
  assert.equal(http.calls.length, 1);
  for (const respond of [() => Response.json({ ok: true, result: false }), () => new Response(null, { status: 429 }), () => new Promise<Response>(() => {})]) {
    const failing = recordingHttp(respond);
    assert.equal(await createTelegramAdapter({ config: outboundConfig(), http: failing.port }).acknowledgeCallback("cb_43"), "unknown");
    assert.equal(failing.calls.length, 1);
  }
});

// Synthetic positive core trace -----------------------------------------------------

type IssuedRef = { intentId: IntentId; purpose: CommandPurpose; principalRef: string; linkGeneration: number };
/**
 * SYNTHETIC stand-in for Noreon's trusted product intent resolver. Production
 * resolves durable intent rows and current link state in the database; this is
 * an in-memory map driven by the test. It lives here, injected explicitly, so
 * the adapter itself never turns callback data into a command.
 */
class SyntheticIntentResolver {
  refs = new Map<string, IssuedRef>();
  authority: AuthoritySnapshot;
  counter = 0;
  constructor(authority: AuthoritySnapshot) { this.authority = authority; }
  issue(action: { intentId: IntentId; purpose: CommandPurpose }, actor: ActorRef) {
    const binding = this.authority.principal(actor.adapter, actor.principalRef);
    assert.ok(binding && binding.kind === "staff");
    const ref = `ref_synthetic_${String(++this.counter).padStart(8, "0")}`;
    this.refs.set(ref, { intentId: action.intentId, purpose: action.purpose, principalRef: actor.principalRef, linkGeneration: binding.generation });
    return ref;
  }
  resolve(event: TelegramIngressEvent): { ok: true; envelope: VerifiedEnvelope } | { ok: false; code: string } {
    if (event.envelope.kind !== "action") return { ok: false, code: "not_an_action" };
    const issued = this.refs.get((event.envelope.action as { intentRef: string }).intentRef);
    if (!issued) return { ok: false, code: "unknown_reference" };
    if (event.envelope.adapter !== TELEGRAM_ADAPTER || issued.principalRef !== event.envelope.principalRef) return { ok: false, code: "actor_mismatch" };
    const binding = this.authority.principal(event.envelope.adapter, event.envelope.principalRef);
    if (!binding || binding.revoked || binding.kind !== "staff" || binding.generation !== issued.linkGeneration) return { ok: false, code: "link_generation_changed" };
    if (issued.purpose === "reply.edit") return { ok: false, code: "edit_requires_validated_workflow" };
    return { ok: true, envelope: { ...event.envelope, action: { schema: COMMAND_SCHEMA_VERSION, purpose: issued.purpose, intentId: issued.intentId, requestId: event.requestId } } };
  }
}

function traceWorld(seed: string) {
  const w = fictionalWorld(seed);
  const memberRef = telegramPrincipalRef(BOT, MEMBER), doctorRef = telegramPrincipalRef(BOT, DOCTOR), doctorBRef = telegramPrincipalRef(BOT, DOCTOR_B);
  w.authority.bind(TELEGRAM_ADAPTER, memberRef, { kind: "member", memberId: w.member, generation: 1, revoked: false });
  w.authority.bind(TELEGRAM_ADAPTER, doctorRef, { kind: "staff", staffId: w.doctor, generation: 1, revoked: false });
  w.authority.bind(TELEGRAM_ADAPTER, doctorBRef, { kind: "staff", staffId: w.doctorB, generation: 1, revoked: false });
  w.authority.assign(w.member, w.doctorB);
  w.authority.endpoints.set(w.memberTelegram, { ...w.authority.endpoints.get(w.memberTelegram)!, address: String(MEMBER) });
  openConversation(w.state, w.ctx, { conversationId: w.conversationId, memberId: w.member, clinicId: w.clinic });
  const inbox = new RecordingInbox();
  const handler = createTelegramWebhook({ config: webhookConfig(), inbox: inbox.port });
  const resolver = new SyntheticIntentResolver(w.authority);
  const doctor: ActorRef = { adapter: TELEGRAM_ADAPTER, principalRef: doctorRef, forwarded: false };
  const ingest = async (update: unknown) => {
    const before = inbox.calls.length;
    const response = await handler(webhookRequest(update));
    assert.equal(response.status, 200);
    assert.equal(inbox.calls.length, before + 1);
    return inbox.calls.at(-1)!;
  };
  return { ...w, inbox, handler, resolver, doctor, doctorRef, ingest };
}

scenario("synthetic core trace: member text, AI draft, doctor approval through an explicit trusted resolver, exact attributed send", async () => {
  const w = traceWorld("telegram-trace");
  const memberEvent = await w.ingest(textUpdate(10, "Synthetic member question"));
  assert.deepEqual(receiveMemberMessage(w.state, w.ctx, memberEvent.envelope), { ok: true, duplicate: false });
  const redelivered = await w.ingest(textUpdate(10, "Synthetic member question"));
  assert.deepEqual(receiveMemberMessage(w.state, w.ctx, redelivered.envelope), { ok: true, duplicate: true }, "core dedupes on the namespaced event id");
  const draft = proposeDraft(w.state, w.ctx, { conversationId: w.conversationId, body: "Synthetic AI draft reply for review." });
  assert.ok(draft.ok);
  const view = actionsFor(w.state, w.ctx, w.doctor, w.conversationId);
  assert.ok(view.ok);
  const approve = view.view.actions.find(action => action.purpose === "reply.approve")!;
  const button = telegramIntentButton(approve.label, w.resolver.issue(approve, w.doctor));
  const click = await w.ingest(callbackUpdate(11, button.callback_data, DOCTOR));
  assert.deepEqual(executeCommand(w.state, w.ctx, click.envelope), { ok: false, code: "invalid_command" }, "raw channel envelope is not a command");
  const resolved = w.resolver.resolve(click);
  assert.ok(resolved.ok);
  const approved = executeCommand(w.state, w.ctx, resolved.envelope);
  assert.ok(approved.ok && approved.purpose === "reply.approve" && approved.deliveryId);
  const replay = w.resolver.resolve(await w.ingest(callbackUpdate(11, button.callback_data, DOCTOR)));
  assert.ok(replay.ok);
  const replayed = executeCommand(w.state, w.ctx, replay.envelope);
  assert.ok(replayed.ok && replayed.replayed && replayed.deliveryId === approved.deliveryId, "stable server-derived request id replays, never re-approves");
  const http = recordingHttp(call => sentMessage(call));
  const adapter = createTelegramAdapter({ config: outboundConfig(), http: http.port });
  const sent = await runSender(w.state, w.ctx, approved.deliveryId as DeliveryId, new Map<AdapterId, typeof adapter>([[TELEGRAM_ADAPTER, adapter]]));
  assert.deepEqual(sent, { ok: true, state: "accepted_by_provider" });
  assert.equal(http.calls.length, 1);
  assert.deepEqual(http.calls[0].body, { chat_id: MEMBER, text: "Dr Fictional Avetisyan\n\nSynthetic AI draft reply for review.", link_preview_options: { is_disabled: true } });
  const again = await runSender(w.state, w.ctx, approved.deliveryId as DeliveryId, new Map<AdapterId, typeof adapter>([[TELEGRAM_ADAPTER, adapter]]));
  assert.equal(again.ok, false, "the core never resends an accepted delivery");
  assert.equal(http.calls.length, 1);
});

scenario("synthetic core trace refusals: other doctor, other bot account, relinked principal and edit purpose never become commands", async () => {
  const w = traceWorld("telegram-refusals");
  receiveMemberMessage(w.state, w.ctx, (await w.ingest(textUpdate(20, "Synthetic member question"))).envelope);
  assert.ok(proposeDraft(w.state, w.ctx, { conversationId: w.conversationId, body: "Synthetic draft." }).ok);
  const view = actionsFor(w.state, w.ctx, w.doctor, w.conversationId);
  assert.ok(view.ok);
  const approve = view.view.actions.find(a => a.purpose === "reply.approve")!, edit = view.view.actions.find(a => a.purpose === "reply.edit")!;
  const approveRef = w.resolver.issue(approve, w.doctor), editRef = w.resolver.issue(edit, w.doctor);

  const otherDoctor = await w.ingest(callbackUpdate(21, `ni1:${approveRef}`, DOCTOR_B));
  assert.deepEqual(w.resolver.resolve(otherDoctor), { ok: false, code: "actor_mismatch" });
  const forcedOther = { ...otherDoctor.envelope, action: { schema: COMMAND_SCHEMA_VERSION, purpose: "reply.approve", intentId: approve.intentId, requestId: otherDoctor.requestId } };
  assert.deepEqual(executeCommand(w.state, w.ctx, forcedOther), { ok: false, code: "intent_actor_mismatch" }, "the core refuses even if a resolver were wrong");

  const otherAccount = parsed(callbackFor(OTHER_BOT, 22, DOCTOR, `ni1:${approveRef}`), OTHER_BOT);
  assert.deepEqual(w.resolver.resolve(otherAccount), { ok: false, code: "actor_mismatch" });
  const forcedAccount = { ...otherAccount.envelope, action: { schema: COMMAND_SCHEMA_VERSION, purpose: "reply.approve", intentId: approve.intentId, requestId: otherAccount.requestId } };
  assert.deepEqual(executeCommand(w.state, w.ctx, forcedAccount), { ok: false, code: "principal_unknown" });

  assert.deepEqual(w.resolver.resolve(await w.ingest(callbackUpdate(23, `ni1:${editRef}`, DOCTOR))), { ok: false, code: "edit_requires_validated_workflow" });
  assert.deepEqual(w.resolver.resolve(await w.ingest(callbackUpdate(24, `ni1:ref_never_issued_0000`, DOCTOR))), { ok: false, code: "unknown_reference" });

  w.authority.relinkPrincipal(TELEGRAM_ADAPTER, w.doctorRef);
  const afterRelink = await w.ingest(callbackUpdate(25, `ni1:${approveRef}`, DOCTOR));
  assert.deepEqual(w.resolver.resolve(afterRelink), { ok: false, code: "link_generation_changed" });
  const forcedRelink = { ...afterRelink.envelope, action: { schema: COMMAND_SCHEMA_VERSION, purpose: "reply.approve", intentId: approve.intentId, requestId: afterRelink.requestId } };
  assert.deepEqual(executeCommand(w.state, w.ctx, forcedRelink), { ok: false, code: "link_generation_changed" });
  assert.equal(w.state.approvals.size, 0);
  assert.equal(w.state.deliveries.size, 0);
});

// Server-only boundary -------------------------------------------------------------

scenario("server-only: each Telegram module refuses to load without the server condition and loads with it", () => {
  const node = (conditions: string[], name: string) => spawnSync(process.execPath, [
    "--disable-warning=DEP0205", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...conditions, "--import", "./scripts/register-alias.mjs",
    "--input-type=module", "-e", `await import("@/lib/telegram-channel/${name}");`,
  ], { encoding: "utf8", timeout: 30_000, env: { ...process.env, NODE_OPTIONS: "" } });
  for (const name of ["protocol", "ingress", "outbound"]) {
    const client = node([], name);
    assert.notEqual(client.status, 0, `${name} loaded outside the server condition`);
    assert.match(client.stderr, /cannot be imported from a Client Component/);
    const server = node(["--conditions=noreon-server-test"], name);
    assert.equal(server.status, 0, `${name}: ${server.stderr.slice(0, 300)}`);
  }
});

let failed = 0;
for (const [name, fn] of scenarios) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n     ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
}
await sleep(0);
if (realFetchAttempts !== 0) { failed++; console.error(`FAIL real fetch was attempted ${realFetchAttempts} time(s)`); }
console.log(`${scenarios.length - failed}/${scenarios.length} Telegram channel scenarios passed (synthetic Request/Response and injected HTTP; recording inbox stand-in, no DB, Auth, network or Telegram).`);
process.exitCode = failed ? 1 : 0;
