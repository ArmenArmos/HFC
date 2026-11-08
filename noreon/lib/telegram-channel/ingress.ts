import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  BodyReadError, parseTelegramContact, parseTelegramMedia, parseTelegramRedo, parseTelegramUpdate, readBoundedBody, technicalInteger, TELEGRAM_ADAPTER, TELEGRAM_LIMITS, validTelegramBot,
  type TelegramBot, type TelegramContactEvent, type TelegramIngressEvent, type TelegramRedoEvent, type TelegramMediaEvent, type TelegramRejection,
} from "./protocol";

/**
 * Webhook entry point as a plain Request -> Response function. Nothing here is
 * mounted as a route or reads the environment: a caller must inject explicit
 * configuration and a durable inbox port, and without both every request is
 * refused before its body is touched.
 *
 * A 200 tells Telegram the update is safely stored and must not be sent again,
 * so it is returned only after the inbox port reports a committed receipt for
 * exactly this event. It does not mean the message was processed, delivered to a
 * person or authorised for anything.
 */

/**
 * One configured bot. The secret is the `secret_token` given to setWebhook
 * (https://core.telegram.org/bots/api#setwebhook) and must be unique to this bot:
 * the header proves which configuration Telegram was given, so a secret shared by
 * two bots could not tell their updates apart.
 */
export type TelegramWebhookConfig = TelegramBot & {
  /** Must be exactly `true`; anything else leaves the handler refusing every request. */
  enabled: boolean;
  /** Telegram allows 1-256 of [A-Za-z0-9_-]; at least 32 is required here. */
  webhookSecret: string;
  maxBodyBytes: number;
  readTimeoutMs: number;
  commitTimeoutMs: number;
};

/**
 * What a durable inbox must answer, and only after its transaction commits.
 * `committed-duplicate` means the canonical event ID was already stored with the
 * same fingerprint; a different fingerprint under the same ID is `conflict`.
 */
export type TelegramInboxReceipt =
  | { status: "committed" | "committed-duplicate"; eventId: string; fingerprint: string }
  | { status: "failed" | "unknown" | "conflict" };
export type TelegramInboxPort = (event: TelegramIngressEvent, options: { signal: AbortSignal }) => Promise<TelegramInboxReceipt>;
/**
 * Stores an authenticated but unsupported update as a content-free dead letter (G5)
 * and reports whether that record committed. Only then is the update acknowledged,
 * so Telegram stops redelivering a poison update instead of retrying it for a day.
 */
export type TelegramDeadLetterPort = (eventId: string, reason: TelegramRejection, options: { signal: AbortSignal }) => Promise<boolean>;
/** Stores a private non-text message (identifiers only) so the member gets a reply and the doctor an alert. */
export type TelegramRedoPort = (event: TelegramRedoEvent, options: { signal: AbortSignal }) => Promise<TelegramInboxReceipt>;
export type TelegramMediaPort = (event: TelegramMediaEvent, options: { signal: AbortSignal }) => Promise<TelegramInboxReceipt>;
/** Stores the member's own shared contact (normalised phone only) as a phone-ownership proof attempt. */
export type TelegramContactPort = (event: TelegramContactEvent, options: { signal: AbortSignal }) => Promise<TelegramInboxReceipt>;

const committed = z.strictObject({ status: z.enum(["committed", "committed-duplicate"]), eventId: z.string(), fingerprint: z.string() });
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const SUPPLIED = /^[A-Za-z0-9_-]{1,256}$/;
const HEADER = "X-Telegram-Bot-Api-Secret-Token";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
/** Constant codes only. No input, error text or configuration ever reaches a response. */
const refuse = (status: number, code: string) => Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
/** Empty on purpose: Telegram reads a JSON body with a `method` field as a Bot API call. */
const acknowledge = () => new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });

type Settings = Readonly<{ bot: TelegramBot; secretDigest: Buffer; maxBodyBytes: number; readTimeoutMs: number; commitTimeoutMs: number; inbox: TelegramInboxPort; deadLetter?: TelegramDeadLetterPort; redo?: TelegramRedoPort; media?: TelegramMediaPort; contact?: TelegramContactPort }>;

function settingsFrom(config: TelegramWebhookConfig | undefined, inbox: TelegramInboxPort | undefined, deadLetter?: TelegramDeadLetterPort, media?: TelegramMediaPort, contact?: TelegramContactPort, redo?: TelegramRedoPort): Settings | null {
  if (!config || config.enabled !== true || typeof inbox !== "function" || !validTelegramBot(config)) return null;
  if (typeof config.webhookSecret !== "string" || !SECRET.test(config.webhookSecret)) return null;
  if (!technicalInteger(config.maxBodyBytes, TELEGRAM_LIMITS.minBodyBytes, TELEGRAM_LIMITS.maxBodyBytes)) return null;
  if (!technicalInteger(config.readTimeoutMs, 1, TELEGRAM_LIMITS.maxTimeoutMs) || !technicalInteger(config.commitTimeoutMs, 1, TELEGRAM_LIMITS.maxTimeoutMs)) return null;
  // Only the digest is kept; the secret itself is not retained by the handler.
  return Object.freeze({
    bot: Object.freeze({ account: config.account, botId: config.botId }), secretDigest: digest(config.webhookSecret),
    maxBodyBytes: config.maxBodyBytes, readTimeoutMs: config.readTimeoutMs, commitTimeoutMs: config.commitTimeoutMs, inbox,
    ...(typeof deadLetter === "function" ? { deadLetter } : {}),
    ...(typeof redo === "function" ? { redo } : {}),
    ...(typeof media === "function" ? { media } : {}),
    ...(typeof contact === "function" ? { contact } : {}),
  });
}

/**
 * A stable dead-letter key for an update that failed parsing: its namespaced
 * update_id when one is readable, otherwise a digest of the body. No content is kept.
 */
function deadLetterId(value: unknown, raw: string, bot: TelegramBot) {
  const updateId = typeof value === "object" && value !== null ? (value as Record<string, unknown>).update_id : undefined;
  if (technicalInteger(updateId, 1, Number.MAX_SAFE_INTEGER)) return JSON.stringify([TELEGRAM_ADAPTER, bot.account, bot.botId, "update", updateId]);
  return JSON.stringify([TELEGRAM_ADAPTER, bot.account, bot.botId, "body", createHash("sha256").update(raw, "utf8").digest("hex")]);
}

/** Fixed-size digests compared in constant time; a malformed or combined header never matches. */
function authentic(request: Request, expected: Buffer) {
  const supplied = request.headers.get(HEADER);
  if (supplied === null || !SUPPLIED.test(supplied)) return false;
  return timingSafeEqual(digest(supplied), expected);
}

export function createTelegramWebhook(options: { config?: TelegramWebhookConfig; inbox?: TelegramInboxPort; deadLetter?: TelegramDeadLetterPort; media?: TelegramMediaPort; contact?: TelegramContactPort; redo?: TelegramRedoPort }): (request: Request) => Promise<Response> {
  const settings = settingsFrom(options.config, options.inbox, options.deadLetter, options.media, options.contact, options.redo);
  return async request => {
    if (!settings) return refuse(503, "unavailable");
    if (!authentic(request, settings.secretDigest)) return refuse(401, "unauthorized");
    if (request.method !== "POST") return refuse(405, "method_not_allowed");
    if (new URL(request.url).search) return refuse(400, "unsupported_request");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return refuse(415, "unsupported_content_type");
    const declared = request.headers.get("content-length");
    if (declared !== null && !/^\d{1,16}$/.test(declared)) return refuse(400, "invalid_body");
    if (declared !== null && Number(declared) > settings.maxBodyBytes) return refuse(413, "body_too_large");

    const body = await readBody(request, settings);
    if (!body.ok) return body.response;
    const parsed = parseTelegramUpdate(body.value, settings.bot);
    if (!parsed.ok) {
      const contact = settings.contact ? parseTelegramContact(body.value, settings.bot) : { ok: false as const };
      if (contact.ok && settings.contact) {
        const port = settings.contact, event = contact.event;
        const receipt = await bounded(signal => port(event, { signal }), settings.commitTimeoutMs);
        const checked = committed.safeParse(receipt);
        return checked.success && checked.data.eventId === event.eventId && checked.data.fingerprint === event.fingerprint ? acknowledge() : refuse(503, "inbox_unavailable");
      }
      const redo = settings.redo ? parseTelegramRedo(body.value, settings.bot) : { ok: false as const };
      if (redo.ok && settings.redo) {
        const port = settings.redo, event = redo.event;
        const receipt = await bounded(signal => port(event, { signal }), settings.commitTimeoutMs);
        const checked = committed.safeParse(receipt);
        return checked.success && checked.data.eventId === event.eventId && checked.data.fingerprint === event.fingerprint ? acknowledge() : refuse(503, "inbox_unavailable");
      }
      const media = settings.media ? parseTelegramMedia(body.value, settings.bot) : { ok: false as const };
      if (media.ok && settings.media) {
        const port = settings.media, event = media.event;
        const receipt = await bounded(signal => port(event, { signal }), settings.commitTimeoutMs);
        const checked = committed.safeParse(receipt);
        return checked.success && checked.data.eventId === event.eventId && checked.data.fingerprint === event.fingerprint ? acknowledge() : refuse(503, "inbox_unavailable");
      }
      if (!settings.deadLetter) return refuse(422, "unsupported_update");
      const port = settings.deadLetter;
      const stored = await bounded(signal => port(deadLetterId(body.value, body.raw, settings.bot), parsed.reason, { signal }), settings.commitTimeoutMs);
      return stored === true ? acknowledge() : refuse(422, "unsupported_update");
    }
    return (await commit(parsed.event, settings)) ? acknowledge() : refuse(503, "inbox_unavailable");
  };
}

/** One awaited call with a timeout; a throw, timeout or late answer is `null`. */
async function bounded<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
  const answer = (async () => { try { return await call(controller.signal); } catch { return null; } })();
  try { return await Promise.race([answer, timedOut]); } finally { clearTimeout(timer); }
}

async function readBody(request: Request, settings: Settings): Promise<{ ok: true; value: unknown; raw: string } | { ok: false; response: Response }> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, settings.readTimeoutMs);
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  try {
    const raw = await readBoundedBody(request.body, controller.signal, settings.maxBodyBytes);
    return { ok: true, value: JSON.parse(raw), raw };
  } catch (error) {
    if (error instanceof BodyReadError && error.code === "too_large") return { ok: false, response: refuse(413, "body_too_large") };
    if (error instanceof BodyReadError && error.code === "cancelled") return { ok: false, response: timedOut ? refuse(408, "body_timeout") : refuse(400, "request_cancelled") };
    return { ok: false, response: refuse(400, "invalid_body") };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
  }
}

/**
 * One call to the inbox port, awaited. Success requires the exact committed
 * tuple for this event; anything else, including a thrown error, a timeout or a
 * receipt for some other event, is a retryable failure. A late answer after the
 * timeout is ignored: Telegram will redeliver and the inbox dedupes it.
 */
async function commit(event: TelegramIngressEvent, settings: Settings): Promise<boolean> {
  const { eventId } = event.envelope, { fingerprint } = event;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, settings.commitTimeoutMs); });
  const receipt = (async () => {
    try { return await settings.inbox(event, { signal: controller.signal }); } catch { return null; }
  })();
  try {
    const checked = committed.safeParse(await Promise.race([receipt, timedOut]));
    return checked.success && checked.data.eventId === eventId && checked.data.fingerprint === fingerprint;
  } finally {
    clearTimeout(timer);
  }
}
