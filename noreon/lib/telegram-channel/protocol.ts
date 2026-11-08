import "server-only";
import { z } from "zod";
import type { VerifiedEnvelope } from "@/lib/conversation-core/channel-contract";
import { canonicalHash, type AdapterId, type RequestId } from "@/lib/conversation-core/contracts";

/**
 * Telegram transport facts, and nothing else.
 *
 * This module turns one authenticated webhook update into a channel-scoped
 * envelope for the conversation core. It never decides who a person is, what
 * role they hold, which member or draft they mean, or what a button does: those
 * are Noreon decisions made later against current, durable state. A sender ID is
 * a reference to resolve, not an identity, and callback data is an inert
 * reference to look up, not a command.
 *
 * Shapes follow https://core.telegram.org/bots/api#update (checked 16 October
 * 2026). Unknown keys are rejected rather than ignored, so a new Telegram field
 * surfaces as an explicit unsupported update instead of passing unexamined.
 */

export const TELEGRAM_ADAPTER = "telegram" as AdapterId;

/** Technical ceilings for configuration. They bound resource use; they are not product policy. */
export const TELEGRAM_LIMITS = {
  /**
   * Floor for request and response byte caps. A 4096-unit text escaped as \uXXXX,
   * plus entities and a replied-to message, must always fit; a smaller cap would
   * refuse valid updates forever or record a message Telegram accepted as unknown.
   */
  minBodyBytes: 262_144,
  maxBodyBytes: 1_048_576,
  /** Below Node's setTimeout ceiling of 2^31-1 ms, which would otherwise fire immediately. */
  maxTimeoutMs: 60_000,
  /** https://core.telegram.org/bots/api#sendmessage: text of 1-4096 characters. */
  maxTextUnits: 4096,
  /** https://core.telegram.org/bots/api#inlinekeyboardbutton: callback_data of 1-64 bytes. */
  maxCallbackBytes: 64,
} as const;

/**
 * The configured bot this adapter speaks for. `account` is Noreon's stable name
 * for the deployment and `botId` is Telegram's numeric bot ID. Together they
 * namespace every principal, event and request key, so two bots never share
 * identities or dedupe keys. Renaming either one is a migration, not a setting:
 * existing links and receipts stop matching by design.
 */
export type TelegramBot = Readonly<{ account: string; botId: number }>;

export const technicalInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function validTelegramBot(bot: unknown): bot is TelegramBot {
  if (typeof bot !== "object" || bot === null) return false;
  const { account, botId } = bot as Record<string, unknown>;
  return typeof account === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(account) && technicalInteger(botId, 1, Number.MAX_SAFE_INTEGER);
}

/** JSON array encoding keeps every field boundary unambiguous whatever the account name contains. */
const namespaced = (bot: TelegramBot, kind: "user" | "update", value: number) =>
  JSON.stringify([TELEGRAM_ADAPTER, bot.account, bot.botId, kind, value]);

/** The core principal reference for a Telegram user of one configured bot. Linking it to a member or staff record is Noreon's job. */
export const telegramPrincipalRef = (bot: TelegramBot, userId: number) => namespaced(bot, "user", userId);

// Update shapes -------------------------------------------------------------------

const telegramId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const displayName = z.string().max(256);
const user = z.strictObject({
  id: telegramId, is_bot: z.boolean(), first_name: displayName.optional(), last_name: displayName.optional(), username: displayName.optional(),
  language_code: z.string().max(35).optional(), is_premium: z.literal(true).optional(), added_to_attachment_menu: z.literal(true).optional(),
});
const privateChat = z.strictObject({
  id: telegramId, type: z.literal("private"), first_name: displayName.optional(), last_name: displayName.optional(), username: displayName.optional(),
});
const text = z.string().min(1).max(TELEGRAM_LIMITS.maxTextUnits).refine(value => value.isWellFormed());

// Inert formatting metadata. Accepted so ordinary messages (a /start command, a
// pasted link, a reply) are not refused, then discarded: nothing downstream reads
// entities, previews or quotes, and none of them can name an actor or an action.
const entities = z.array(z.looseObject({
  type: z.string().regex(/^[a-z_]{1,32}$/), offset: z.number().int().min(0).max(TELEGRAM_LIMITS.maxTextUnits), length: z.number().int().min(1).max(TELEGRAM_LIMITS.maxTextUnits),
})).max(TELEGRAM_LIMITS.maxTextUnits);
const linkPreview = z.strictObject({
  is_disabled: z.boolean().optional(), url: z.string().max(2048).optional(), prefer_small_media: z.boolean().optional(),
  prefer_large_media: z.boolean().optional(), show_above_text: z.boolean().optional(),
});
/** The message being replied to; only its ID and chat are kept, and the chat must be this one. */
const repliedTo = z.looseObject({ message_id: telegramId, chat: z.looseObject({ id: telegramId, type: z.literal("private") }) });
const quote = z.looseObject({ text: z.string().max(TELEGRAM_LIMITS.maxTextUnits), position: z.number().int().min(0) });

/**
 * A private text message. Forwarded, automatic-forward, sender_chat, via_bot,
 * edited, topic, business, external-reply and media messages all fail here
 * because their keys are not listed.
 */
const memberMessage = z.strictObject({
  message_id: telegramId, date: telegramId, from: user, chat: privateChat, text,
  entities: entities.optional(), link_preview_options: linkPreview.optional(), reply_to_message: repliedTo.optional(), quote: quote.optional(),
});
/** The bot's own message that carried the button. A positive date excludes Telegram's InaccessibleMessage. */
const carrierMessage = z.strictObject({
  message_id: telegramId, date: telegramId, from: user, chat: privateChat, text: z.string().max(TELEGRAM_LIMITS.maxTextUnits),
  entities: entities.optional(), link_preview_options: linkPreview.optional(), reply_markup: z.looseObject({ inline_keyboard: z.array(z.array(z.unknown())) }).optional(),
  edit_date: telegramId.optional(), reply_to_message: repliedTo.optional(), has_protected_content: z.literal(true).optional(),
});
/** Inline-mode (inline_message_id) and game callbacks fail here because their keys are not listed. */
const callbackQuery = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), from: user, message: carrierMessage, chat_instance: z.string().min(1).max(256), data: z.string().min(1).max(256),
});
const update = z.union([
  z.strictObject({ update_id: telegramId, message: memberMessage }),
  z.strictObject({ update_id: telegramId, callback_query: callbackQuery }),
]);

// Parsing -----------------------------------------------------------------------

export const CALLBACK_PREFIX = "ni1:";
const INTENT_REF = /^[A-Za-z0-9_-]{16,60}$/;

export type TelegramTransport = Readonly<{
  updateId: number; kind: "text" | "callback"; senderId: number; chatId: number; messageId: number;
  callbackId?: string;
  /** Untrusted: which earlier message in the same chat the person replied to. Context only, never authority. */
  replyToMessageId?: number;
}>;
export type TelegramIngressEvent = Readonly<{
  transport: TelegramTransport;
  /** Server-derived from the namespaced update or callback; identical on every redelivery. */
  requestId: RequestId;
  /** Canonical hash of every fact the event carries, for the inbox to detect a conflicting replay of one key. */
  fingerprint: string;
  envelope: VerifiedEnvelope;
}>;
export type TelegramRejection = "unsupported_shape" | "bot_sender" | "sender_chat_mismatch" | "foreign_carrier" | "reply_chat_mismatch" | "invalid_callback_data";

/**
 * Admits a private text message or a button press in a private chat with the
 * configured bot, and nothing else. Callers must authenticate the webhook first:
 * parsing proves shape and internal consistency, not origin.
 */
export function parseTelegramUpdate(value: unknown, bot: TelegramBot): { ok: true; event: TelegramIngressEvent } | { ok: false; reason: TelegramRejection } {
  const parsed = update.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "unsupported_shape" };
  const data = parsed.data;
  const isCallback = "callback_query" in data;
  const sender = isCallback ? data.callback_query.from : data.message.from;
  const message = isCallback ? data.callback_query.message : data.message;

  // The actor is whoever sent the message or pressed the button, and only in their own private chat.
  if (sender.is_bot) return { ok: false, reason: "bot_sender" };
  if (sender.id !== message.chat.id) return { ok: false, reason: "sender_chat_mismatch" };
  if (message.reply_to_message && message.reply_to_message.chat.id !== message.chat.id) return { ok: false, reason: "reply_chat_mismatch" };

  const common = { adapter: TELEGRAM_ADAPTER, principalRef: telegramPrincipalRef(bot, sender.id), eventId: namespaced(bot, "update", data.update_id), forwarded: false };
  let envelope: VerifiedEnvelope, content: string, callbackId: string | undefined;
  if (isCallback) {
    const query = data.callback_query;
    // The button must sit on a message this bot sent; a nested sender is never taken as the actor.
    if (!query.message.from.is_bot || query.message.from.id !== bot.botId) return { ok: false, reason: "foreign_carrier" };
    if (Buffer.byteLength(query.data, "utf8") > TELEGRAM_LIMITS.maxCallbackBytes || !query.data.startsWith(CALLBACK_PREFIX) || !INTENT_REF.test(query.data.slice(CALLBACK_PREFIX.length)))
      return { ok: false, reason: "invalid_callback_data" };
    envelope = { ...common, kind: "action", action: Object.freeze({ intentRef: query.data.slice(CALLBACK_PREFIX.length) }) };
    content = query.data;
    callbackId = query.id;
  } else {
    envelope = { ...common, kind: "text", text: data.message.text };
    content = data.message.text;
  }

  const replyToMessageId = message.reply_to_message?.message_id;
  const transport: TelegramTransport = Object.freeze({
    updateId: data.update_id, kind: isCallback ? "callback" : "text", senderId: sender.id, chatId: message.chat.id, messageId: message.message_id,
    ...(callbackId === undefined ? {} : { callbackId }), ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
  });
  // A callback's request identity is the press itself, so a redelivered press replays rather than repeats.
  const requestId = `rq_${canonicalHash("noreon.telegram.request", 1, [bot.account, bot.botId, transport.kind, callbackId ?? data.update_id])}` as RequestId;
  const fingerprint = canonicalHash("noreon.telegram.receipt", 1, [
    common.eventId, common.principalRef, requestId, transport.kind, transport.chatId, transport.messageId, callbackId ?? null, content, replyToMessageId ?? null,
  ]);
  return { ok: true, event: Object.freeze({ transport, requestId, fingerprint, envelope: Object.freeze(envelope) }) };
}

// Contact share (phone-ownership proof) ---------------------------------------------

export type TelegramContactEvent = Readonly<{
  eventId: string; principalRef: string; fingerprint: string; chatId: number; messageId: number;
  /** Telegram's message time, whole seconds. */
  sentAt: number;
  /** E.164 with a leading +, digits only otherwise; null for a contact card that is not the sender's own. */
  phone: string | null;
}>;

/**
 * A person sharing **their own** Telegram contact in a private chat with the bot, the
 * only input that can prove a phone number. Accepted only when the contact names the
 * sender (`contact.user_id` present and equal to `from.id`). Someone else's or a typed
 * card is returned with `phone: null` (never its number) so the open request is refused
 * and consumed; a forwarded message, a group or a bot is not a contact event at all.
 * Name and vCard are dropped here; only the normalised own number leaves this function.
 */
export function parseTelegramContact(value: unknown, bot: TelegramBot): { ok: true; event: TelegramContactEvent } | { ok: false } {
  const shape = z.looseObject({
    update_id: telegramId,
    message: z.looseObject({
      message_id: telegramId, date: telegramId,
      from: z.looseObject({ id: telegramId, is_bot: z.literal(false) }),
      chat: z.looseObject({ id: telegramId, type: z.literal("private") }),
      contact: z.looseObject({ phone_number: z.string().min(4).max(32), user_id: telegramId.optional() }),
    }),
  });
  const parsed = shape.safeParse(value);
  if (!parsed.success) return { ok: false };
  const { update_id: updateId, message } = parsed.data;
  const raw = message as Record<string, unknown>;
  if (message.from.id !== message.chat.id || "text" in raw || FORWARD_KEYS.some(key => key in raw)) return { ok: false };
  const own = message.contact.user_id !== undefined && message.contact.user_id === message.from.id;
  const digits = message.contact.phone_number.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (own && !/^[1-9]\d{6,14}$/.test(digits)) return { ok: false };
  const phone = own ? `+${digits}` : null;
  const principalRef = telegramPrincipalRef(bot, message.from.id), eventId = namespaced(bot, "update", updateId);
  const fingerprint = canonicalHash("noreon.telegram.contact", 1, [eventId, principalRef, message.chat.id, message.message_id, message.date, phone]);
  return { ok: true, event: Object.freeze({ eventId, principalRef, fingerprint, chatId: message.chat.id, messageId: message.message_id, sentAt: message.date, phone }) };
}

// Media the bot cannot read ----------------------------------------------------------

const FORWARD_KEYS = ["forward_origin", "forward_from", "forward_from_chat", "forward_date", "forward_sender_name", "is_automatic_forward", "sender_chat", "via_bot", "edit_date", "business_connection_id", "message_thread_id"];
/** Service events are not something a person wrote; they stay dead letters. */
const SERVICE_KEYS = ["new_chat_members", "left_chat_member", "new_chat_title", "new_chat_photo", "delete_chat_photo", "group_chat_created", "supergroup_chat_created", "channel_chat_created", "message_auto_delete_timer_changed", "migrate_to_chat_id", "migrate_from_chat_id", "pinned_message", "invoice", "successful_payment", "refunded_payment", "users_shared", "chat_shared", "connected_website", "write_access_allowed", "passport_data", "proximity_alert_triggered", "boost_added", "chat_background_set", "web_app_data"];

export type TelegramMediaEvent = Readonly<{ eventId: string; principalRef: string; fingerprint: string; chatId: number; messageId: number }>;

/**
 * Recognises a private message from a person that carries something other than text
 * (a photo, voice note, file...). Only identifiers are returned: the member is told the
 * bot reads text only and their doctor is alerted, but nothing of the content is stored.
 * Forwarded, group, bot and edited messages are still rejected.
 */
export function parseTelegramMedia(value: unknown, bot: TelegramBot): { ok: true; event: TelegramMediaEvent } | { ok: false } {
  const shape = z.looseObject({
    update_id: telegramId,
    message: z.looseObject({
      message_id: telegramId, date: telegramId,
      from: z.looseObject({ id: telegramId, is_bot: z.literal(false) }),
      chat: z.looseObject({ id: telegramId, type: z.literal("private") }),
    }),
  });
  const parsed = shape.safeParse(value);
  if (!parsed.success) return { ok: false };
  const { update_id: updateId, message } = parsed.data;
  const raw = message as Record<string, unknown>;
  // Anything a person sends privately that is not plain text (photo, voice, file, location,
  // sticker, dice, a kind Telegram adds later...) gets the text-only reply.
  // A forwarded file gets the media reply too, and any other forward stays a dead letter. Nothing of a file is ever fetched.
  const forwardedFile = ("document" in raw || "photo" in raw) && FORWARD_KEYS.some(key => key in raw) && !("sender_chat" in raw || "via_bot" in raw || "is_automatic_forward" in raw || "edit_date" in raw);
  if (message.from.id !== message.chat.id || "text" in raw || (FORWARD_KEYS.some(key => key in raw) && !forwardedFile) || SERVICE_KEYS.some(key => key in raw)) return { ok: false };
  const principalRef = telegramPrincipalRef(bot, message.from.id), eventId = namespaced(bot, "update", updateId);
  const fingerprint = canonicalHash("noreon.telegram.media", 1, [eventId, principalRef, message.chat.id, message.message_id]);
  return { ok: true, event: Object.freeze({ eventId, principalRef, fingerprint, chatId: message.chat.id, messageId: message.message_id }) };
}

export type TelegramRedoEvent = Readonly<{ eventId: string; principalRef: string; fingerprint: string; chatId: number; messageId: number }>;
/**
 * An edited or forwarded text from a person in a private chat: identifiers only, and never the words (QA a9-05). It is not
 * read as a new message, so the member is asked to send it again. Anything else stays a dead letter.
 */
export function parseTelegramRedo(value: unknown, bot: TelegramBot): { ok: true; event: TelegramRedoEvent } | { ok: false } {
  const inner = z.looseObject({ message_id: telegramId, date: telegramId, from: z.looseObject({ id: telegramId, is_bot: z.literal(false) }), chat: z.looseObject({ id: telegramId, type: z.literal("private") }), text: z.string().min(1) });
  const parsed = z.looseObject({ update_id: telegramId, message: inner.optional(), edited_message: inner.optional() }).safeParse(value);
  if (!parsed.success) return { ok: false };
  const message = parsed.data.edited_message ?? parsed.data.message;
  if (!message || message.from.id !== message.chat.id) return { ok: false };
  if (!parsed.data.edited_message && !FORWARD_KEYS.some(key => key in (message as Record<string, unknown>))) return { ok: false };
  const principalRef = telegramPrincipalRef(bot, message.from.id), eventId = namespaced(bot, "update", parsed.data.update_id);
  const fingerprint = canonicalHash("noreon.telegram.redo", 1, [eventId, principalRef, message.chat.id, message.message_id]);
  return { ok: true, event: Object.freeze({ eventId, principalRef, fingerprint, chatId: message.chat.id, messageId: message.message_id }) };
}

/**
 * Renders a button whose callback data is only an opaque reference. Noreon must
 * later resolve the reference to a purpose-bound intent for the current actor and
 * link generation; the button text is display only.
 */
export function telegramIntentButton(label: string, intentRef: string): { text: string; callback_data: string } {
  const data = CALLBACK_PREFIX + intentRef;
  if (typeof label !== "string" || label.length < 1 || label.length > 128 || !label.isWellFormed()) throw Error("Unsupported button label.");
  if (!INTENT_REF.test(intentRef) || Buffer.byteLength(data, "utf8") > TELEGRAM_LIMITS.maxCallbackBytes) throw Error("Unsupported intent reference.");
  return { text: label, callback_data: data };
}

// Bounded body reading ------------------------------------------------------------

export class BodyReadError extends Error {
  readonly code: "too_large" | "cancelled" | "invalid_body";
  constructor(code: "too_large" | "cancelled" | "invalid_body") {
    super(code);
    this.code = code;
  }
}

/**
 * Reads a stream as strict UTF-8, refusing as soon as the running byte count
 * passes `maxBytes` rather than after buffering it, and stopping on `signal`.
 * Used for both webhook requests and provider responses.
 */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal, maxBytes: number): Promise<string> {
  if (signal.aborted) throw new BodyReadError("cancelled");
  if (!body) throw new BodyReadError("invalid_body");
  const reader = body.getReader();
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => reject(new BodyReadError("cancelled")); });
  aborted.catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new BodyReadError("invalid_body");
      size += next.value.byteLength;
      if (size > maxBytes) throw new BodyReadError("too_large");
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof BodyReadError ? error : new BodyReadError("invalid_body");
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new BodyReadError("invalid_body");
  }
}
