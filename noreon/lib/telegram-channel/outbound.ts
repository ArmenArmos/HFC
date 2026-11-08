import "server-only";
import { z } from "zod";
import { renderOutboundText, type ChannelAdapter, type OutboundPayload } from "@/lib/conversation-core/channel-contract";
import type { AttemptOutcome } from "@/lib/conversation-core/contracts";
import { readBoundedBody, technicalInteger, telegramIntentButton, TELEGRAM_ADAPTER, TELEGRAM_LIMITS, validTelegramBot, type TelegramBot } from "./protocol";

/**
 * Outbound half of the Telegram channel: hands one core-pinned payload to the
 * Bot API once and reports what can be proven about the result.
 *
 * Nothing is sent unless a caller injects explicit configuration and an HTTP
 * port; there is no environment lookup and no default transport. The adapter
 * never retries, reroutes or truncates, and edits only the card message it is told
 * to. Only a 200 response that echoes
 * the exact chat, bot and text is `accepted`, which means Telegram accepted the
 * request, not that anyone received or read it. A bounded, verified rejection
 * from the small allowlist below proves `definitely_failed`. Everything else
 * after the HTTP call starts is `unknown`: sendMessage documents no idempotent
 * resend and a timeout cannot prove nothing was sent.
 */

export type TelegramOutboundConfig = TelegramBot & {
  enabled: boolean;
  /** Bot API token; its numeric prefix must equal `botId`. Kept only inside this closure. */
  botToken: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

/**
 * The only way this module reaches the network. The URL carries the bot token,
 * so an implementation must never log it, and must honour `redirect` and `signal`.
 * It is called at most once per `deliver` or `acknowledgeCallback`.
 */
export type TelegramHttpPort = (url: string, init: {
  method: "POST"; headers: { "Content-Type": "application/json" }; body: string; redirect: "error"; signal: AbortSignal;
}) => Promise<Response>;

/** `acknowledged` means Telegram accepted the empty answer; it says nothing about the action itself. */
export type CallbackAcknowledgement = "acknowledged" | "unknown" | "unsupported";
/** One row of card buttons: the label and the opaque reference the database issued for it. */
export type TelegramCallbackRow = ReadonlyArray<Readonly<{ label: string; ref: string }>>;
/** `edited` means Telegram accepted the new text; `unknown` that it could not be proven. Neither changes what was saved. */
export type TelegramEditOutcome = "edited" | "unknown" | "unsupported";
/** A fixed Noreon system message (acknowledgement, link confirmation): exact text, no doctor attribution. */
export type SystemTextPayload = Readonly<{
  address: string; text: string;
  /** Nurse details are protected even when they have no inline controls. */
  protectContent?: boolean;
  /**
   * `request_contact` shows a single "share my phone number" button; `remove` clears it;
   * `open_url` shows one link button under the message, only to a staff app page or, for a
   * member notice, a member app page or its one-tap sign-in link; `callback` shows a card's
   * buttons, whose data is only an opaque reference, and protects the message.
   */
  keyboard?: Readonly<{ kind: "request_contact"; label: string }> | Readonly<{ kind: "remove" }> | Readonly<{ kind: "force_reply" }> | Readonly<{ kind: "open_url"; label: string; url: string }> | Readonly<{ kind: "callback"; rows: ReadonlyArray<TelegramCallbackRow>; forceReply?: boolean }>;
}>;

/** The only hosts a link button may open: the staff app. Staff notices never link anywhere else. */
export const TELEGRAM_LINK_HOSTS: readonly string[] = Object.freeze(["backoffice.noreon.health"]);
const staffLinkPath = /^\/staff\/real\/[a-z0-9/-]{1,120}$/;
/** An exact, canonical https link to a staff app page: no credentials, port, query or fragment. */
export function isStaffAppLink(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 512) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "https:" && TELEGRAM_LINK_HOSTS.includes(parsed.hostname) && parsed.port === "" && parsed.username === "" && parsed.password === ""
    && parsed.search === "" && parsed.hash === "" && staffLinkPath.test(parsed.pathname) && parsed.href === url;
}
/** The only host a member notice button may open: the member app. */
export const MEMBER_LINK_HOSTS: readonly string[] = Object.freeze(["app.noreon.health"]);
const memberLinkPath = /^\/patient\/[a-z0-9/-]{1,120}$/;
/** An exact, canonical https link to a member app page: no credentials, port, query or fragment. */
export function isMemberAppLink(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 512) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "https:" && MEMBER_LINK_HOSTS.includes(parsed.hostname) && parsed.port === "" && parsed.username === "" && parsed.password === ""
    && parsed.search === "" && parsed.hash === "" && memberLinkPath.test(parsed.pathname) && parsed.href === url;
}
/** The one-tap sign-in link on a member notice's button: the member app's link page, token only in the fragment. */
export function isMemberSigninLink(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 512) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "https:" && MEMBER_LINK_HOSTS.includes(parsed.hostname) && parsed.port === "" && parsed.username === "" && parsed.password === ""
    && parsed.search === "" && parsed.pathname === "/patient/telegram-link" && /^#t=[A-Za-z0-9_-]{32}$/.test(parsed.hash) && parsed.href === url;
}
const buttonLabel = (label: unknown): label is string => typeof label === "string" && label.length >= 1 && label.length <= 64 && label.isWellFormed() && label.trim() === label;
export type TelegramChannelAdapter = ChannelAdapter & {
  /** As ChannelAdapter.deliver, optionally with the member's one-tap sign-in button. */
  deliver(payload: OutboundPayload, extra?: Readonly<{ keyboard?: Readonly<{ kind: "open_url"; label: string; url: string }> }>): Promise<AttemptOutcome>;
  acknowledgeCallback(callbackId: string, text?: string): Promise<CallbackAcknowledgement>;
  deliverText(payload: SystemTextPayload): Promise<AttemptOutcome>;
  editText(payload: Readonly<{ address: string; messageId: number; text: string; keyboard: Readonly<{ kind: "callback"; rows: ReadonlyArray<TelegramCallbackRow> }> }>): Promise<TelegramEditOutcome>;
  /** Removes spent controls without fetching or repeating the old message's details. */
  clearKeyboard(payload: Readonly<{ address: string; messageId: number }>): Promise<TelegramEditOutcome>;
};

const API_ORIGIN = "https://api.telegram.org";
const UNSUPPORTED = Object.freeze({ kind: "unsupported" as const });
type UnknownReason = "telegram_no_response" | "telegram_timeout" | "telegram_response_unverified";
type RejectionEvidence = "telegram_bot_blocked" | "telegram_chat_not_found" | "telegram_message_refused";
type CallResult<T> = { ok: true; value: T } | { ok: false; reason: UnknownReason } | { ok: false; evidence: RejectionEvidence };

const rejectedMessage = z.object({ ok: z.literal(false), error_code: z.union([z.literal(400), z.literal(403)]), description: z.string().max(256) }).strict();
/** Exact provider descriptions are inspected only here; only fixed evidence leaves this module. */
function rejectionEvidence(raw: unknown, status: number): RejectionEvidence | null {
  const parsed = rejectedMessage.safeParse(raw);
  if (!parsed.success || parsed.data.error_code !== status) return null;
  const description = parsed.data.description;
  if (status === 403 && description === "Forbidden: bot was blocked by the user") return "telegram_bot_blocked";
  if (status === 400 && description === "Bad Request: chat not found") return "telegram_chat_not_found";
  if (status === 400 && ["Bad Request: message is too long", "Bad Request: message text is empty"].includes(description)) return "telegram_message_refused";
  if (status === 403 && ["Forbidden: user is deactivated", "Forbidden: bot can't initiate conversation with a user"].includes(description)) return "telegram_message_refused";
  return null;
}

const chatAddress = /^[1-9]\d{0,15}$/;
const callbackId = /^[A-Za-z0-9_-]{1,128}$/;
const sentMessage = z.object({
  ok: z.literal(true),
  result: z.object({
    message_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    from: z.object({ id: z.number(), is_bot: z.literal(true) }),
    chat: z.object({ id: z.number(), type: z.literal("private") }),
    text: z.string(),
  }),
});
const answeredCallback = z.object({ ok: z.literal(true), result: z.literal(true) });
/** https://core.telegram.org/bots/api#answercallbackquery: text of 0-200 characters. */
const CALLBACK_ANSWER_UNITS = 200;
const MAX_BUTTON_ROWS = 8;

/** The inline keyboard of a card, or null if a row, label or reference could not be carried as given. */
function callbackMarkup(rows: ReadonlyArray<TelegramCallbackRow>): object | null {
  if (rows.length > MAX_BUTTON_ROWS) return null;
  try {
    return { inline_keyboard: rows.map(row => row.map(({ label, ref }) => {
      if (!buttonLabel(label)) throw Error("Unsupported button label.");
      return telegramIntentButton(label, ref);
    })) };
  } catch { return null; }
}
const carriable = (text: unknown): text is string => typeof text === "string" && text.length >= 1 && text.length <= TELEGRAM_LIMITS.maxTextUnits && text.isWellFormed() && text.trim() === text;

type Settings = Readonly<{ account: string; botId: number; botToken: string; timeoutMs: number; maxResponseBytes: number; http: TelegramHttpPort }>;

function settingsFrom(config: TelegramOutboundConfig | undefined, http: TelegramHttpPort | undefined): Settings | null {
  if (!config || config.enabled !== true || typeof http !== "function" || !validTelegramBot(config)) return null;
  // The token's bot ID binds the credential to the configured namespace.
  if (typeof config.botToken !== "string" || !new RegExp(`^${config.botId}:[A-Za-z0-9_-]{30,128}$`).test(config.botToken)) return null;
  if (!technicalInteger(config.timeoutMs, 1, TELEGRAM_LIMITS.maxTimeoutMs) || !technicalInteger(config.maxResponseBytes, TELEGRAM_LIMITS.minBodyBytes, TELEGRAM_LIMITS.maxBodyBytes)) return null;
  return Object.freeze({ account: config.account, botId: config.botId, botToken: config.botToken, timeoutMs: config.timeoutMs, maxResponseBytes: config.maxResponseBytes, http });
}

/**
 * The exact text the core rendered, or null if Telegram could not carry it
 * unchanged. Surrounding whitespace is conservatively unsupported pending live
 * echo verification (TG-06); provider trimming has not been established. Approved
 * text is refused rather than altered.
 */
function preparedMessage(payload: OutboundPayload): { chatId: number; text: string } | null {
  if (typeof payload !== "object" || payload === null || typeof payload.body !== "string" || payload.body.length < 1) return null;
  if (typeof payload.approvedBy?.displayName !== "string" || payload.approvedBy.displayName.length < 1) return null;
  if (typeof payload.address !== "string" || !chatAddress.test(payload.address) || !Number.isSafeInteger(Number(payload.address))) return null;
  const text = renderOutboundText(payload);
  if (text.length > TELEGRAM_LIMITS.maxTextUnits || !text.isWellFormed() || text.trim() !== text) return null;
  return { chatId: Number(payload.address), text };
}

/**
 * Exactly one HTTP call, bounded by one timeout that covers the response body
 * too. Returns the verified value, send rejection or reason the outcome stays unknown;
 * provider text, status details and the URL are never surfaced.
 */
async function callOnce<T>(settings: Settings, method: "sendMessage" | "editMessageText" | "editMessageReplyMarkup" | "answerCallbackQuery", body: object, verify: (value: unknown) => T | null): Promise<CallResult<T>> {
  const url = `${API_ORIGIN}/bot${settings.botToken}/${method}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ ok: false; reason: UnknownReason }>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: "telegram_timeout" }); }, settings.timeoutMs);
  });
  const exchange = (async (): Promise<CallResult<T>> => {
    let response: Response;
    try {
      response = await settings.http(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: controller.signal });
    } catch {
      return { ok: false, reason: "telegram_no_response" };
    }
    if (!(response instanceof Response)) return { ok: false, reason: "telegram_response_unverified" };
    const mayRejectSend = method === "sendMessage" && (response.status === 400 || response.status === 403)
      && /^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "");
    if ((response.status !== 200 && !mayRejectSend) || response.redirected || (response.url !== "" && response.url !== url)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, reason: "telegram_response_unverified" };
    }
    try {
      const raw: unknown = JSON.parse(await readBoundedBody(response.body, controller.signal, settings.maxResponseBytes));
      if (mayRejectSend) {
        const evidence = rejectionEvidence(raw, response.status);
        return evidence === null ? { ok: false, reason: "telegram_response_unverified" } : { ok: false, evidence };
      }
      const value = verify(raw);
      return value === null ? { ok: false, reason: "telegram_response_unverified" } : { ok: true, value };
    } catch {
      return { ok: false, reason: "telegram_response_unverified" };
    }
  })();
  try {
    return await Promise.race([exchange, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendExact(settings: Settings, message: { chatId: number; text: string; replyMarkup?: object; protectContent?: boolean }): Promise<AttemptOutcome> {
  // Plain text: no parse_mode, so the body is never interpreted as HTML or Markdown.
  // Previews off: Telegram would otherwise fetch links found in clinical text.
  // Protected: a message whose button signs in cannot be forwarded or saved by official clients (review F-2).
  const result = await callOnce(settings, "sendMessage", { chat_id: message.chatId, text: message.text, link_preview_options: { is_disabled: true }, ...(message.replyMarkup ? { reply_markup: message.replyMarkup } : {}), ...(message.protectContent ? { protect_content: true } : {}) }, raw => {
    const parsed = sentMessage.safeParse(raw);
    if (!parsed.success) return null;
    const sent = parsed.data.result;
    return sent.chat.id === message.chatId && sent.from.id === settings.botId && sent.text === message.text ? sent.message_id : null;
  });
  if (!result.ok) return "evidence" in result ? { kind: "definitely_failed", evidence: result.evidence } : { kind: "unknown", reason: result.reason };
  return { kind: "accepted", providerRef: JSON.stringify([TELEGRAM_ADAPTER, settings.account, settings.botId, message.chatId, result.value]) };
}

export function createTelegramAdapter(options: { config?: TelegramOutboundConfig; http?: TelegramHttpPort }): TelegramChannelAdapter {
  const settings = settingsFrom(options.config, options.http);
  return {
    id: TELEGRAM_ADAPTER,
    capabilities: () => ({ adapter: TELEGRAM_ADAPTER, plainText: settings ? { maxUtf16Units: TELEGRAM_LIMITS.maxTextUnits } : null, idempotentRetry: false }),

    /**
     * `extra.keyboard`: the one-tap "Open Noreon" sign-in button for the member (lead decision 19 Oct).
     * Only a member sign-in link is accepted, never another URL, and the message is then protected.
     */
    async deliver(payload: OutboundPayload, extra?: Readonly<{ keyboard?: Readonly<{ kind: "open_url"; label: string; url: string }> }>): Promise<AttemptOutcome> {
      const message = settings && preparedMessage(payload);
      if (!settings || !message) return UNSUPPORTED;
      const keyboard = extra?.keyboard;
      if (keyboard === undefined) return sendExact(settings, message);
      if (keyboard.kind !== "open_url" || !buttonLabel(keyboard.label) || !isMemberSigninLink(keyboard.url)) return UNSUPPORTED;
      return sendExact(settings, { ...message, replyMarkup: { inline_keyboard: [[{ text: keyboard.label, url: keyboard.url }]] }, protectContent: true });
    },

    /** Same rules as `deliver`: one call, verified acceptance or rejection, unknown when unproven. */
    async deliverText(payload: SystemTextPayload): Promise<AttemptOutcome> {
      if (!settings || typeof payload !== "object" || payload === null || typeof payload.text !== "string" || payload.text.length < 1) return UNSUPPORTED;
      if (typeof payload.address !== "string" || !chatAddress.test(payload.address) || !Number.isSafeInteger(Number(payload.address))) return UNSUPPORTED;
      if (payload.text.length > TELEGRAM_LIMITS.maxTextUnits || !payload.text.isWellFormed() || payload.text.trim() !== payload.text) return UNSUPPORTED;
      let replyMarkup: object | undefined, protectContent = payload.protectContent === true;
      if (payload.keyboard?.kind === "request_contact") {
        const label = payload.keyboard.label;
        if (!buttonLabel(label)) return UNSUPPORTED;
        replyMarkup = { keyboard: [[{ text: label, request_contact: true }]], one_time_keyboard: true, resize_keyboard: true };
      } else if (payload.keyboard?.kind === "open_url") {
        const { label, url } = payload.keyboard;
        if (!buttonLabel(label) || !(isStaffAppLink(url) || isMemberAppLink(url) || isMemberSigninLink(url))) return UNSUPPORTED;
        replyMarkup = { inline_keyboard: [[{ text: label, url }]] };
        protectContent = protectContent || isMemberSigninLink(url);
      } else if (payload.keyboard?.kind === "callback") {
        const markup = callbackMarkup(payload.keyboard.rows);
        if (!markup) return UNSUPPORTED;
        replyMarkup = payload.keyboard.forceReply === true ? { ...markup, force_reply: true } : markup;
        protectContent = true;
      } else if (payload.keyboard?.kind === "force_reply") replyMarkup = { force_reply: true, selective: true };
      else if (payload.keyboard?.kind === "remove") replyMarkup = { remove_keyboard: true };
      else if (payload.keyboard !== undefined) return UNSUPPORTED;
      return sendExact(settings, { chatId: Number(payload.address), text: payload.text, ...(replyMarkup ? { replyMarkup } : {}), protectContent });
    },

    /**
     * Stops the client's loading indicator after a button press
     * (https://core.telegram.org/bots/api#answercallbackquery). `text` is the short
     * line Noreon has already decided; there is no alert or URL. Calling it, and
     * when, belongs to the durable dispatcher, not the webhook.
     */
    async acknowledgeCallback(id: string, text?: string): Promise<CallbackAcknowledgement> {
      if (!settings || typeof id !== "string" || !callbackId.test(id)) return "unsupported";
      if (text !== undefined && (typeof text !== "string" || text.length < 1 || text.length > CALLBACK_ANSWER_UNITS || !text.isWellFormed())) return "unsupported";
      const result = await callOnce(settings, "answerCallbackQuery", { callback_query_id: id, ...(text === undefined ? {} : { text }) }, raw => (answeredCallback.safeParse(raw).success ? true : null));
      return result.ok ? "acknowledged" : "unknown";
    },

    /**
     * Rewrites one card message after a press (https://core.telegram.org/bots/api#editmessagetext):
     * one call, plain text, the new buttons. It repeats nothing: the action is already saved,
     * and Telegram refusing an unchanged text simply reads as unknown.
     */
    async editText(payload): Promise<TelegramEditOutcome> {
      if (!settings || typeof payload !== "object" || payload === null || !carriable(payload.text) || !technicalInteger(payload.messageId, 1, Number.MAX_SAFE_INTEGER)) return "unsupported";
      if (typeof payload.address !== "string" || !chatAddress.test(payload.address) || !Number.isSafeInteger(Number(payload.address)) || payload.keyboard?.kind !== "callback") return "unsupported";
      const markup = callbackMarkup(payload.keyboard.rows), chatId = Number(payload.address);
      if (!markup) return "unsupported";
      const result = await callOnce(settings, "editMessageText", { chat_id: chatId, message_id: payload.messageId, text: payload.text, link_preview_options: { is_disabled: true }, reply_markup: markup }, raw => {
        const parsed = sentMessage.safeParse(raw);
        return parsed.success && parsed.data.result.chat.id === chatId && parsed.data.result.message_id === payload.messageId && parsed.data.result.text === payload.text ? true : null;
      });
      return result.ok ? "edited" : "unknown";
    },

    async clearKeyboard(payload): Promise<TelegramEditOutcome> {
      if (!settings || !chatAddress.test(payload.address) || !Number.isSafeInteger(Number(payload.address)) || !technicalInteger(payload.messageId, 1, Number.MAX_SAFE_INTEGER)) return "unsupported";
      const result = await callOnce(settings, "editMessageReplyMarkup", {chat_id:Number(payload.address), message_id:payload.messageId, reply_markup:{inline_keyboard:[]}}, raw => {
        const parsed = z.object({ok:z.literal(true),result:z.object({message_id:z.number(),chat:z.object({id:z.number(),type:z.literal('private')})})}).safeParse(raw);
        return parsed.success && parsed.data.result.message_id === payload.messageId && parsed.data.result.chat.id === Number(payload.address) ? true : null;
      });
      return result.ok ? "edited" : "unknown";
    },
  };
}
