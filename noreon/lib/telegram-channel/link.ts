import "server-only";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { TelegramHttpPort } from "./outbound";
import type { TelegramIngressEvent } from "./protocol";

/**
 * Account linking and the real HTTP port: the two pieces the reviewed adapter left
 * out on purpose (TG-02, G5).
 *
 * A link is only ever the exact text `/start <token>` in a private chat with the
 * configured bot, where the token is the one the member's authenticated app session
 * just received. The token is opaque here: it is hashed and handed to the inbox,
 * and only Noreon's database decides which member, if any, it belongs to. A link
 * envelope never establishes identity on its own.
 */

/** Tokens are 24 random bytes in URL-safe base64: exactly 32 characters. */
const LINK = /^\/start ([A-Za-z0-9_-]{32})$/;
const START = /^\/start(?:@[A-Za-z0-9_]{1,64})?(?:\s|$)/;

export type InboxKind = "text" | "link" | "start" | "callback";
export type InboxEvent = Readonly<{
  adapter: "telegram"; eventId: string; fingerprint: string; principalRef: string; kind: InboxKind;
  payload: Readonly<Record<string, string | number>>;
}>;

export const linkTokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Turns a verified ingress event into the inbox row Noreon stores. Message text is
 * kept only for ordinary messages; a link carries only the token digest, and any
 * other /start (bare, wrong length, extra words) is inert and never becomes text a
 * doctor sees.
 */
export function inboxEventFrom(event: TelegramIngressEvent): InboxEvent {
  const { envelope, transport, fingerprint } = event;
  const base = { adapter: "telegram" as const, eventId: envelope.eventId, fingerprint, principalRef: envelope.principalRef };
  const where = { chatId: transport.chatId, messageId: transport.messageId };
  // The press's query id (to answer it) and the opaque reference: the button text and callback prefix stay behind.
  if (envelope.kind === "action") return Object.freeze({ ...base, kind: "callback", payload: Object.freeze({ ...where, callbackId: transport.callbackId!, intentRef: (envelope.action as { intentRef: string }).intentRef }) });
  const link = LINK.exec(envelope.text);
  if (link) return Object.freeze({ ...base, kind: "link", payload: Object.freeze({ ...where, tokenHash: linkTokenHash(link[1]) }) });
  if (START.test(envelope.text)) return Object.freeze({ ...base, kind: "start", payload: Object.freeze(where) });
  return Object.freeze({ ...base, kind: "text", payload: Object.freeze({ ...where, text: envelope.text,
    ...(transport.replyToMessageId === undefined ? {} : { replyToMessageId: transport.replyToMessageId }) }) });
}

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * The production HTTP port. The URL carries the bot token, so this port uses
 * `node:https` directly rather than the global fetch that Next.js instruments for
 * tracing, so Next's fetch spans never see the URL. Limit: an HTTP-level
 * instrumentation (for example OpenTelemetry's http module) would see the request
 * path; none is configured, and a preview deployment must confirm no `/bot` path
 * appears in logs before activation. Only api.telegram.org over
 * HTTPS is reachable, redirects are never followed (a 3xx comes back as a non-200
 * the adapter treats as unverified), the caller's signal bounds the exchange, and
 * every error is a fixed message with no URL, token or body.
 */
export const telegramHttpsPort: TelegramHttpPort = (url, init) => new Promise<Response>((resolve, reject) => {
  let target: URL;
  try { target = new URL(url); } catch { reject(Error("Telegram request refused")); return; }
  if (target.protocol !== "https:" || target.hostname !== "api.telegram.org" || target.port !== "" || target.search || target.username || target.password) {
    reject(Error("Telegram request refused")); return;
  }
  if (init.signal.aborted) { reject(Error("Telegram request cancelled")); return; }
  const body = Buffer.from(init.body, "utf8");
  let req: ReturnType<typeof httpsRequest>;
  try {
  req = httpsRequest({
    protocol: "https:", hostname: "api.telegram.org", port: 443, path: target.pathname, method: init.method,
    headers: { "Content-Type": init.headers["Content-Type"], "Content-Length": String(body.byteLength) }, signal: init.signal,
  }, res => {
    const status = res.statusCode && res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502;
    res.on("error", () => {});
    if (NO_BODY.has(status)) { res.resume(); resolve(new Response(null, { status })); return; }
    resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status }));
  });
  } catch { reject(Error("Telegram request failed")); return; }
  req.on("error", () => reject(Error("Telegram request failed")));
  req.end(body);
});
