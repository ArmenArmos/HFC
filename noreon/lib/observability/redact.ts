/**
 * The only gate between the app and the log store. Noreon holds health data, so this is an
 * allow-list: a field reaches a log line only when it is named below AND its value passes
 * that field's shape check. Everything else is dropped and only counted. Free text never
 * passes as such: error messages and stacks go through scrubbers, routes through a
 * normaliser that keeps plain words and turns ids into placeholders, and query strings
 * are removed everywhere.
 *
 * Never log names, phone numbers, emails, message text, answers, measurements, lab values,
 * document contents, tokens, cookies, headers or query strings. Adding a field here is a
 * privacy change: it needs a strict shape and a case in scripts/check-log-redaction.ts.
 */

import { ERROR_VOCABULARY } from "./error-words";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type ActorKind = "member" | "staff" | "clinic" | "anon" | "system";

export type LogEvent = {
  _time: string;
  ts: string;
  level: LogLevel;
  msg: string;
  [field: string]: string | number | boolean | Record<string, number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const EVENT = /^[a-z][a-z0-9_.-]{0,79}$/;
/** Postgres SQLSTATE (23505), PostgREST (PGRST303), Node (ECONNRESET, UND_ERR_SOCKET), Supabase auth (otp_expired). */
const CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3}|(?!.*\d{3})(?:[A-Z][A-Z0-9_]{1,39}|[a-z][a-z0-9_]{1,39}))$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const ACTORS = new Set<ActorKind>(["member", "staff", "clinic", "anon", "system"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const OUTCOMES = new Set(["ok", "error", "redirect", "not_found", "denied", "next", "rewrite", "timeout", "skipped"]);
const ROUTE_TYPES = new Set(["page", "route", "action", "proxy", "render", "middleware", "sweep"]);
const DB_KINDS = new Set(["rpc", "rest", "auth", "storage", "functions"]);

/**
 * Count keys are allowed only when they name a count (processed, failed, sent...). Anything
 * else, a measurement or lab name included, is dropped even when its value is a number.
 */
const COUNT_WORDS = new Set([
  "processed", "failed", "failures", "sent", "skipped", "claimed", "queued", "retried", "retries", "errors", "error",
  "count", "total", "deleted", "removed", "cleaned", "attempted", "delivered", "halted", "more", "done", "expired",
  "released", "scanned", "screened", "escalated", "finished", "created", "updated", "reconciled", "received", "stale",
  "pending", "dropped", "rejected", "acknowledged", "notified", "cancelled", "completed", "jobs", "runs", "batches",
  "items", "messages", "replies", "inbox", "outbox", "source", "succeeded", "ok", "busy", "limited", "deferred",
]);
const countKey = (key: string) =>
  key.split(/_|(?=[A-Z])/).some((word) => COUNT_WORDS.has(word.toLowerCase()));

/**
 * A word survives in error text only when it is in the vocabulary, or is shaped like code
 * (snake_case, camelCase, dotted, or an upper-case code such as JWT or PGRST); anything
 * else, a lower-case name included, becomes `<w>`.
 */
const scrubWords = (text: string) =>
  text.replace(/<(?:w|url|email|opaque|detail)>|[^\s,;:()/[\]{}<>?#=]+/g, (token) => {
    if (token.startsWith("<")) return token;
    if (/[^\x00-\x7F]/.test(token)) return "<w>";
    const word = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (!word) return token;
    if (/^[a-z]+(?:_[a-z]+)+$/.test(word) || /^[a-z]+(?:[A-Z][a-z]*)+$/.test(word) || /^[a-z]+(?:\.[a-z]+)+$/i.test(word)) return token;
    if (/^[A-Z][A-Z_]{1,11}$/.test(word)) return token;
    return ERROR_VOCABULARY.has(word.toLowerCase()) ? token : "<w>";
  });

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value: unknown) => (isFiniteNumber(value) && value >= 0 ? Math.round(value * 10) / 10 : undefined);
const int = (min: number, max: number) => (value: unknown) =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
const matches = (pattern: RegExp) => (value: unknown) => (typeof value === "string" && pattern.test(value) ? value : undefined);
const oneOf = (set: Set<string>) => (value: unknown) => (typeof value === "string" && set.has(value) ? value : undefined);
const lowerUuid = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined);

/**
 * Turns a path into a route template: query and fragment removed, uuids to `:id`, numbers
 * to `:n`, and any other segment that is not a short lowercase word (tokens, codes, names,
 * phone numbers, file names) to `:x`. Next's own templates (`[id]`, `(group)`) are kept.
 */
export function normaliseRoute(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  const path = value.split(/[?#]/, 1)[0];
  const segments = path.split("/").slice(1, 13).map((segment) => {
    if (segment === "") return "";
    if (UUID.test(segment)) return ":id";
    if (/^\d+$/.test(segment)) return ":n";
    if (/^\[{1,2}(\.\.\.)?[A-Za-z][A-Za-z0-9_]{0,40}\]{1,2}$/.test(segment)) return segment;
    if (/^\([a-z][a-z0-9-]{0,40}\)$/.test(segment)) return segment;
    if (/^@[a-z][a-z0-9-]{0,40}$/.test(segment)) return segment;
    if (/^_?[a-z][a-z0-9-]{0,39}(\.(txt|xml|ico|png|webmanifest|json))?$/.test(segment) && !/\d{3}/.test(segment)) return segment;
    return ":x";
  });
  return `/${segments.join("/")}`.replace(/\/{2,}/g, "/").slice(0, 200);
}

/**
 * Error text often quotes data back ("invalid input syntax for type uuid: \"...\"", a
 * failing value, a URL with a token). Quoted runs, emails, URLs, long digit runs and long
 * opaque strings are replaced; the remainder is cut to 160 characters.
 */
export function scrubErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const scrubbed = value
    .split("\n", 1)[0]
    // Postgres and PostgREST echo row data in their details: cut everything from the first
    // detail marker ("Failing row contains (...)", "Key (col)=(value)", "DETAIL:"), whatever follows.
    .replace(/\b(failing row contains|key \(|detail:|details:|hint:|returned row|row contains)[\s\S]*$/i, "<detail>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|«[^»]*»|“[^”]*”/g, "?")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[^\s@]+@[^\s@]+/g, "<email>")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "#")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<opaque>")
    .replace(/=\s*\S+/g, "=?")
    // Every number goes (a reading, a count, an age, part of a phone or an id).
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    // Parentheses keep only a code ("(PGRST#)", "(#)"), never words.
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => (/^[A-Z0-9_#]{1,20}$/.test(inner.trim()) ? `(${inner.trim()})` : "(?)"))
    .trim();
  return scrubbed ? scrubWords(scrubbed).slice(0, 160) : undefined;
}
/** Keeps only `at fn (file:line:col)` frames, without query strings, at most 12. */
export function scrubStack(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const frames = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line))
    .map((line) => line.replace(/\?[^:)\s]*/g, "").replace(/"[^"]*"|'[^']*'/g, "?"))
    .filter((line) => /^at [A-Za-z0-9_$.<>\[\] ]{0,120}(\(?[^\s()]*:\d+:\d+\)?)?$/.test(line) || /^at [^\s()]+:\d+:\d+$/.test(line))
    .slice(0, 12);
  return frames.length ? frames.join("\n").slice(0, 2000) : undefined;
}

/** Numeric counts from a sweep report: code-defined keys, finite numbers, never clinical-looking keys. */
export function scrubCounts(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  const visit = (object: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, entry] of Object.entries(object)) {
      if (Object.keys(out).length >= 30) return;
      if (!/^[a-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
      const name = prefix ? `${prefix}.${key}` : key;
      if (isFiniteNumber(entry) && countKey(key)) out[name] = entry;
      else if (typeof entry === "boolean" && countKey(key)) out[name] = entry ? 1 : 0;
      else if (depth < 1 && entry && typeof entry === "object" && !Array.isArray(entry)) visit(entry as Record<string, unknown>, name, depth + 1);
    }
  };
  visit(value as Record<string, unknown>, "", 0);
  return Object.keys(out).length ? out : undefined;
}

type Check = (value: unknown) => string | number | boolean | Record<string, number> | undefined;

/** The allow-list. A field not named here never reaches a log line. */
export const LOG_FIELDS: Readonly<Record<string, Check>> = {
  request_id: matches(REQUEST_ID),
  route: normaliseRoute,
  route_type: oneOf(ROUTE_TYPES),
  method: (value) => (typeof value === "string" && METHODS.has(value.toUpperCase()) ? value.toUpperCase() : undefined),
  status: int(100, 599),
  outcome: oneOf(OUTCOMES),
  duration_ms: nonNegative,
  actor_kind: oneOf(ACTORS),
  actor_id: lowerUuid,
  member_id: lowerUuid,
  place: oneOf(new Set(["page", "runtime"])),
  unavailable_reason: oneOf(new Set(["unavailable", "clinical-hold", "profile-mismatch", "source-unavailable"])),
  staff_role: oneOf(new Set(["doctor", "nurse"])),
  conversation_id: lowerUuid,
  run_id: lowerUuid,
  submission_id: lowerUuid,
  action: matches(/^[A-Za-z_$][A-Za-z0-9_$]{0,62}$/),
  sweep: matches(IDENT),
  db: oneOf(DB_KINDS),
  rpc: matches(IDENT),
  table: matches(IDENT),
  rpc_ms: nonNegative,
  db_status: int(0, 599),
  error_code: matches(CODE),
  error_name: matches(/^[A-Z][A-Za-z0-9]{0,40}$/),
  error_message: scrubErrorMessage,
  error_stack: scrubStack,
  digest: matches(/^[A-Za-z0-9]{1,40}$/),
  counts: scrubCounts,
  batch: int(0, 100000),
  dropped: int(0, 1000000),
  // Proxy-only request facts; see request-meta.ts. The IP field only ever holds a network
  // prefix (/24 or /48), never an address.
  ua_family: oneOf(new Set(["bot", "telegram", "edge", "samsung", "opera", "firefox", "chrome", "safari", "curl", "node", "other"])),
  country: matches(/^[A-Z]{2}$/),
  ip_prefix: matches(/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}0\/24$|^[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$/),
  region: matches(/^[a-z0-9-]{2,20}$/),
  commit: matches(/^[0-9a-f]{7,12}$/),
  env: oneOf(new Set(["production", "preview", "development", "test"])),
  runtime: oneOf(new Set(["nodejs", "edge"])),
  // Rate-limit refusals (lib/security/rate-limit.ts): the operation, the bucket kinds that were
  // checked (never their keys) and the Retry-After seconds.
  operation: oneOf(new Set(["member_code", "member_verify", "member_link", "staff_signin", "member_upload", "clinic_upload"])),
  limit_kinds: matches(/^(?:source|phone|email|user)(?:,(?:source|phone|email|user)){0,3}$/),
  retry_after: int(0, 86400),
};

/** Builds a log line from untrusted fields. Only allow-listed, well-shaped values survive. */
export function redactEvent(level: unknown, msg: unknown, fields: Record<string, unknown> = {}, now: Date = new Date()): LogEvent {
  const ts = now.toISOString();
  const event: LogEvent = {
    _time: ts,
    ts,
    level: LEVELS.has(level as LogLevel) ? (level as LogLevel) : "info",
    msg: typeof msg === "string" && EVENT.test(msg) ? msg : "invalid_msg",
  };
  let dropped = 0;
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    const check = Object.prototype.hasOwnProperty.call(LOG_FIELDS, key) ? LOG_FIELDS[key] : undefined;
    const value = check ? check(raw) : undefined;
    if (value === undefined) {
      dropped++;
      continue;
    }
    event[key] = value;
  }
  if (dropped) event.redacted_fields = dropped;
  return event;
}
