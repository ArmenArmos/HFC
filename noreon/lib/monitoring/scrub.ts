/**
 * Everything Sentry receives passes through here first, in the browser and on the server.
 *
 * Noreon is a health service, so the rule is an allow-list: an event keeps the error type,
 * a scrubbed message, the stack, the route without its query, the runtime and browser
 * facts Sentry adds, and our own request id. Bodies, cookies, query strings, most headers,
 * user details, console output and anything whose key or text looks like a phone number,
 * a name, a reading, a lab value or message text are removed or replaced before sending.
 *
 * The SDK's own `dataCollection` settings already turn most of this off; this is the
 * second line, and scripts/check-sentry-scrub.ts feeds it PHI samples to prove it holds.
 */
import type { BrowserOptions, Breadcrumb, Event, StackFrame } from "@sentry/nextjs";

type ErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];
type TransactionEvent = Parameters<NonNullable<BrowserOptions["beforeSendTransaction"]>>[0];

export const REQUEST_ID_HEADER = "x-request-id";
export const REDACTED = "[redacted]";

/** Request headers kept on an event. Everything else, cookies and auth included, is dropped. */
const HEADER_ALLOW = new Set(["user-agent", "x-request-id", "content-type", "accept-language"]);

/** Allowed header values must look like what the header holds; anything else is dropped. */
const HEADER_SHAPE: Record<string, RegExp> = {
  "user-agent": /^[\x20-\x7e]{1,300}$/,
  "x-request-id": /^[A-Za-z0-9._:-]{8,128}$/,
  "content-type": /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w-]+=[\w.-]+)*$/,
  "accept-language": /^[A-Za-z0-9,;=.*\s-]{1,100}$/,
};

/** Contexts Sentry fills with runtime facts. Any other context is dropped. */
const CONTEXT_ALLOW = new Set(["os", "browser", "device", "runtime", "app", "culture", "trace", "cloud_resource", "nextjs", "react"]);

/** Breadcrumb data keys worth keeping; values are scrubbed again. */
const BREADCRUMB_DATA_ALLOW = new Set(["method", "status_code", "url", "from", "to", "reason"]);

/** Key words whose values are never sent, wherever they appear (matched per word of the key). */
const SENSITIVE_WORDS = new Set([
  "name", "firstname", "lastname", "surname", "fullname", "username", "patronymic",
  "phone", "mobile", "msisdn", "email", "mail", "address", "dob", "birthday", "age", "sex", "gender",
  "ssn", "passport", "national", "message", "messages", "text", "body", "note", "notes", "comment", "comments",
  "answer", "answers", "question", "reply", "content", "caption", "chat", "transcript", "summary",
  "bp", "blood", "pressure", "systolic", "diastolic", "pulse", "heart", "glucose", "sugar", "cholesterol",
  "hba1c", "ldl", "hdl", "creatinine", "lab", "labs", "result", "results", "reading", "readings",
  "value", "values", "weight", "height", "bmi", "waist", "token", "secret", "password", "cookie", "cookies",
  "auth", "authorization", "session", "otp", "ip", "query", "telegram",
]);
const SENSITIVE_PREFIXES = ["diagnos", "symptom", "medic", "medication", "drug", "dose", "prescri", "birth", "phone", "email", "telegram", "password"];

/** Splits camelCase, snake_case and dotted keys into lowercase words. */
export function sensitiveKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // "code" alone is a one-time sign-in code; status_code and error_code are fine.
  if (words.length === 1 && words[0] === "code") return true;
  if (words.at(-1) === "code" && ["otp", "sms", "verification", "login", "auth"].includes(words.at(-2) ?? "")) return true;
  return words.some((word) => SENSITIVE_WORDS.has(word) || SENSITIVE_PREFIXES.some((prefix) => word.startsWith(prefix)));
}

/** Tags we set ourselves or Sentry sets with safe values; others are scrubbed as text. */
const ID_LIKE = /^[A-Za-z0-9._:-]{8,128}$/;
/** A query string or fragment after a URL or path. */
const URL_QUERY = /(\b(?:https?:\/\/|\/)[^\s?#"']*)[?#][^\s"']*/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Words an error message may keep. Everything else in Latin script is replaced, because
 * plain lowercase prose ("i feel dizzy"), a single name or a medicine cannot be told
 * apart from ordinary words by pattern. The list is error, runtime, HTTP, database and
 * product vocabulary; extend it when a useful word keeps showing up as [text].
 */
const MESSAGE_WORDS = new Set(`
a an the and or not no of to in on at for from by with without as is are was were be been being has have had do does did can cannot could
should must may will would this that these those it its into out over under after before during while when if then else than only also
all any some none each every other same new old more less too very just still again already yet up down off via per
error errors exception failed failure fail fails failing invalid valid unexpected expected unknown missing required undefined null nan
true false type types typeerror rangeerror referenceerror syntaxerror aborterror timeout timed abort aborted cancelled canceled
cannot read write properties property reading setting set get got call called calling function functions method object objects array
arrays string strings number numbers boolean value values key keys index length size limit limits exceeded maximum minimum max min
range format parse parsing parsed json xml html url uri path route routes page pages request requests response responses fetch fetched
network connection connect connected refused reset closed close open opened socket host dns port server client browser service services
status code http https get post put patch delete head options internal bad gateway unavailable forbidden unauthorized unauthenticated
not found conflict gone payload large many rate rejected reject resolve resolved promise promises unhandled uncaught handled thrown
throw async await load loading loaded chunk chunks module modules import export script scripts render rendering rendered hydration
hydrate mismatch component components element elements node nodes child children parent root document window event events listener
handler handlers hook hooks state props context provider effect effects ref refs key memo suspense boundary digest stack frame
database db table tables column columns row rows relation constraint constraints violates violation duplicate unique foreign primary
check null insert update upsert select query queries schema function permission denied policy rls role user users auth session
sessions token tokens expired expiry jwt claim claims signature sign signed signin signout login logout password reset verify
verification verified otp sms code codes captcha rpc postgrest postgres supabase storage bucket upload uploads file files download
image images pdf blob mime content length encoding charset utf
telegram bot webhook message messages send sent sending delivery deliver delivered dispatch queue queued job jobs cron sweep retry
retries retried attempt attempts backoff lock locked conflict transaction commit rollback migration
member members staff doctor doctors nurse nurses clinic clinics admin booking bookings visit visits report reports care plan plans
questionnaire answers question questions reading readings measurement measurements lab labs result results notice notices
consultation consultations callback callbacks alert alerts task tasks sentry test staging safe noreon zoe ai model provider gateway
vercel next nextjs react turbopack edge runtime nodejs api env environment config configuration feature flag flags disabled enabled
map filter reduce foreach push slice split join keys entries includes then catch finally id ids uuid name tostring
body div span button input form label link section main header footer nav ul li img svg
`.trim().split(/\s+/));

/** Words that make a following number a status or position, not a reading. */
const NUMBER_CONTEXT = new Set(["status", "code", "http", "line", "column", "port", "attempt", "attempts", "after", "retry", "chunk", "version", "v"]);

/** Identifier-shaped tokens: camelCase, PascalCase, snake_case, $names, acronyms, mixed digits. */
function codeLike(word: string): boolean {
  return /[a-z][A-Z]/.test(word) || /[_$]/.test(word) || /\d/.test(word) || /^[A-Z]{2,12}$/.test(word);
}

function allowedWord(word: string): boolean {
  if (codeLike(word)) return true;
  return word.split(/[.-]/).every((part) => part === "" || MESSAGE_WORDS.has(part.toLowerCase()) || codeLike(part));
}

/** Path segments keep route words and ids; anything with digits runs, @ or odd characters goes. */
function scrubPathSegment(segment: string): string {
  if (!segment || UUID_EXACT.test(segment)) return segment;
  // Staff notice tokens are 24 random bytes in hex, including values with no digit runs.
  if (/^[0-9a-f]{48}$/i.test(segment)) return REDACTED;
  if (/^[A-Za-z0-9_.\-[\]()]{1,64}$/.test(segment) && !/\d{4,}/.test(segment)) return segment;
  return REDACTED;
}

const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 200;

/**
 * Free text (error messages, breadcrumb messages, tags) keeps its shape for triage and
 * loses anything that could be member data: secrets and contact details by pattern,
 * readings and codes by number rules, then every word outside MESSAGE_WORDS. Ids and
 * paths are set aside first so they survive, then restored.
 */
export function scrubText(input: string): string {
  if (!input) return input;
  const kept: string[] = [];
  // Placeholders use private-use characters, never digits or letters, so later rules cannot touch them.
  const keep = (value: string) => `\u0001${String(kept.push(value) - 1).replace(/\d/g, (d) => String.fromCharCode(0xe000 + Number(d)))}\u0001`;
  let text = input
    // Secrets: Telegram bot tokens, JWTs, bearer tokens.
    .replace(/bot\d+:[\w-]+/gi, "bot[secret]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.?[\w-]*/g, "[secret]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [secret]")
    // Email addresses, then @handles.
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g, "[email]")
    .replace(/@[A-Za-z0-9_]{3,}/g, "[handle]")
    // Query strings and fragments in any URL-like text.
    .replace(URL_QUERY, "$1")
    // Postgres row and key details carry the values themselves.
    .replace(/(Failing row contains)[^]*$/i, `$1 (${REDACTED})`)
    .replace(/=\(([^)]*)\)/g, `=(${REDACTED})`);
  // Internal ids and paths survive as they are (path segments are checked on their own).
  text = text
    .replace(UUID, keep)
    // No lookbehind anywhere in this file: Safari before 16.4 cannot parse it, and this
    // module loads before the app on members' phones.
    .replace(/(\bhttps?:\/\/[^\s"'<>]+)|(^|[^\w/])(\/[A-Za-z0-9_.\-/[\]()]+)/g, (_m, url: string | undefined, before: string | undefined, bare: string | undefined) => {
      const match = /^(https?:\/\/[^/\s]+)?(.*)$/.exec(url ?? bare ?? "");
      const origin = match?.[1] ?? "";
      const path = (match?.[2] ?? "").split("/").map(scrubPathSegment).join("/");
      return (url ? "" : before ?? "") + keep(origin + path);
    });
  text = text
    // Quoted values (user input echoed by validators and databases): keep only code identifiers and known words.
    .replace(/(["'`«“‘])([^"'`»”’\n]{1,200})(["'`»”’])/g, (_m, open: string, inner: string, close: string) =>
      /^\u0001[\ue000-\ue009]+\u0001$/.test(inner) || (/^[A-Za-z_$][A-Za-z0-9_$.-]{0,40}$/.test(inner) && allowedWord(inner)) ? `${open}${inner}${close}` : `${open}${REDACTED}${close}`)
    // A clinical word followed by a number is a reading, whatever the number's size.
    .replace(/\b(?:systolic|diastolic|bp|pulse|glucose|sugar|ldl|hdl|hba1c|a1c|weight|height|bmi|cholesterol|creatinine|spo2|temperature|temp|hr)\b\s*[:=]?\s*\d+(?:[.,]\d+)?/gi, "[reading]")
    // Blood pressure pairs such as 140/90, 140 / 90 or 148 over 96.
    .replace(/\b\d{2,3}\s*(?:\/|over)\s*\d{2,3}\b/gi, "[reading]")
    // Numbers with clinical units.
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mm\s?hg|mmol\/?l?|µmol\/?l?|umol\/?l?|mg\/?dl|g\/?l|bpm|kg|cm|%)/gi, "[reading]")
    // Decimal numbers (lab values).
    .replace(/\b\d+[.,]\d+\b/g, "[number]")
    // Phone numbers and other long digit runs, with or without separators.
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[number]")
    // Any other number of 2 or more digits, unless a status, line or port precedes it.
    .replace(/(\b[A-Za-z]+\b\s*:?\s*)?\b\d{2,}\b/g, (match: string, before: string | undefined) => {
      const word = before?.trim().replace(/:$/, "").toLowerCase();
      return word && NUMBER_CONTEXT.has(word) && /(?:^|\D)\d{2,3}$/.test(match) ? match : `${before ?? ""}[number]`;
    })
    // Armenian, Cyrillic and Georgian words: member-entered text or names in local script.
    .replace(/[\u0531-\u058F\u0400-\u04FF\u10A0-\u10FF]+/g, "[text]")
    // Every remaining Latin word outside the error vocabulary.
    .replace(/(^|[^[\w])([A-Za-z_$][A-Za-z0-9_$]*(?:[.-][A-Za-z0-9_$]+)*)/g, (_m, before: string, word: string) => before + (allowedWord(word) ? word : "[text]"))
    // One marker for a run of removed words.
    .replace(/\[text\](?:[\s,;:.-]*\[text\])+/g, "[text]");
  text = text.replace(/\u0001([\ue000-\ue009]+)\u0001/g, (_m, code: string) =>
    kept[Number([...code].map((c) => c.charCodeAt(0) - 0xe000).join(""))] ?? REDACTED);
  // Bound the size so a pasted message cannot ride along in full.
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** A URL without query string, fragment or credentials; path segments that look like data are replaced. */
export function scrubUrl(input: string): string {
  if (!input) return input;
  try {
    const url = new URL(input, "http://relative.invalid");
    const path = url.pathname.split("/").map((segment) => scrubPathSegment(decodeURIComponentSafe(segment))).join("/");
    if (url.host === "relative.invalid") return path;
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return REDACTED;
  }
}

function decodeURIComponentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Generic objects (extra, unknown contexts, breadcrumb data): drop sensitive keys, scrub strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (sensitiveKey(key)) continue;
      out[key] = scrubValue(item, depth + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * Contexts Sentry fills itself (browser, OS, device, runtime, trace). Their keys are the
 * SDK's and their values describe the software, so they are kept, minus any query string
 * and any key that names something sensitive.
 */
function scrubRuntimeFacts(value: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (typeof value === "string") return value.replace(URL_QUERY, "$1").slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubRuntimeFacts(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key !== "name" && sensitiveKey(key)) continue;
      out[key] = scrubRuntimeFacts(item, depth + 1);
    }
    return out;
  }
  return undefined;
}

function scrubFrame(frame: StackFrame): StackFrame {
  // Local variable values can hold anything the code was handling; source lines are not needed.
  delete frame.vars;
  delete frame.pre_context;
  delete frame.context_line;
  delete frame.post_context;
  // Inline browser scripts report the page URL as their file, query string included.
  if (frame.filename) frame.filename = frame.filename.replace(URL_QUERY, "$1");
  if (frame.abs_path) frame.abs_path = frame.abs_path.replace(URL_QUERY, "$1");
  return frame;
}

/** Console breadcrumbs are dropped; request breadcrumbs keep method, status and a bare URL. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  const out: Breadcrumb = { ...breadcrumb };
  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (out.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(out.data)) {
      if (!BREADCRUMB_DATA_ALLOW.has(key)) continue;
      data[key] = (key === "url" || key === "from" || key === "to") && typeof value === "string" ? scrubUrl(value) : scrubValue(value);
    }
    out.data = data;
  }
  return out;
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

/**
 * The shared scrub for errors and transactions. Mutates and returns the event, which is
 * what Sentry's hooks expect; returning null would drop it, which we never need to do.
 */
export function scrubEvent<T extends Event>(event: T): T {
  // Our own request id, from the request header the Axiom logging proxy sets, becomes a tag.
  const requestId = headerValue(event.request?.headers as Record<string, unknown> | undefined, REQUEST_ID_HEADER);

  if (event.request) {
    const request = event.request;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      const name = key.toLowerCase();
      if (HEADER_ALLOW.has(name) && typeof value === "string" && HEADER_SHAPE[name]?.test(value)) headers[name] = value.slice(0, 300);
    }
    event.request = {
      method: request.method,
      url: request.url ? scrubUrl(request.url) : undefined,
      headers,
    };
  }

  // Only an internal UUID may identify who hit the error. An explicit null IP tells Sentry
  // not to infer the address (and the geo it derives from it) from the connection.
  const userId = event.user?.id;
  event.user = typeof userId === "string" && new RegExp(`^${UUID.source}$`, "i").test(userId)
    ? { id: userId, ip_address: null }
    : { ip_address: null };

  if (event.message) event.message = scrubText(event.message);
  if (event.logentry) event.logentry = { message: event.logentry.message ? scrubText(event.logentry.message) : undefined };
  if (event.transaction) event.transaction = scrubUrl(event.transaction);

  for (const exception of event.exception?.values ?? []) {
    // Linked causes (Error.cause) arrive as further entries here and get the same treatment.
    if (exception.value) exception.value = scrubText(exception.value);
    if (exception.mechanism) delete exception.mechanism.data;
    if (exception.stacktrace?.frames) exception.stacktrace.frames = exception.stacktrace.frames.map(scrubFrame);
  }
  for (const thread of event.threads?.values ?? []) {
    if (thread.stacktrace?.frames) thread.stacktrace.frames = thread.stacktrace.frames.map(scrubFrame);
  }

  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null);

  if (event.contexts) {
    const contexts: NonNullable<Event["contexts"]> = {};
    for (const [key, value] of Object.entries(event.contexts)) {
      if (CONTEXT_ALLOW.has(key) && value) contexts[key] = scrubRuntimeFacts(value) as NonNullable<Event["contexts"]>[string];
    }
    event.contexts = contexts;
  }

  // The React component stack names components only, but it is not needed for triage.
  if (event.contexts?.react) delete (event.contexts.react as Record<string, unknown>).componentStack;

  if (event.fingerprint) event.fingerprint = event.fingerprint.map((part) => (part === "{{ default }}" ? part : scrubText(part)));

  // Extra data is free-form and could hold anything; it is never sent.
  delete event.extra;

  if (event.tags) {
    const tags: NonNullable<Event["tags"]> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      if (sensitiveKey(key) && key !== "request_id") continue;
      tags[key] = typeof value === "string" ? scrubText(value) : value;
    }
    event.tags = tags;
  }
  if (requestId && ID_LIKE.test(requestId)) event.tags = { ...event.tags, request_id: requestId };

  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubText(span.description);
    if (span.data) span.data = scrubValue(span.data) as typeof span.data;
  }

  return event;
}

export function beforeSend(event: ErrorEvent): ErrorEvent {
  return scrubEvent(event);
}

export function beforeSendTransaction(event: TransactionEvent): TransactionEvent {
  return scrubEvent(event);
}

type EnvelopeItem = [{ type?: string }, unknown];
type Envelope = [unknown, EnvelopeItem[]];

/**
 * The last step before the network, for every envelope type (events, sessions, client
 * reports, check-ins). Release-health sessions carry `attrs.ip_address`, `attrs.user_agent`
 * and a `did` taken from the user, and they never pass through beforeSend. Session
 * tracking is turned off (sentry-options.ts); this is the backstop. Any string IP under
 * any key named ip_address is removed; the `null` that refuses IP inference stays.
 */
export function scrubEnvelope(envelope: Envelope): void {
  for (const [header, payload] of envelope[1] ?? []) {
    if (header?.type === "session" || header?.type === "sessions") scrubSession(payload);
    dropStringIps(payload, 0);
  }
}

function scrubSession(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const session = payload as { attrs?: Record<string, unknown>; did?: unknown; aggregates?: Array<Record<string, unknown>> };
  if (session.attrs) {
    delete session.attrs.ip_address;
    delete session.attrs.user_agent;
  }
  if (session.did !== undefined && !(typeof session.did === "string" && UUID_EXACT.test(session.did))) delete session.did;
  for (const aggregate of session.aggregates ?? []) {
    if (aggregate.did !== undefined && !(typeof aggregate.did === "string" && UUID_EXACT.test(aggregate.did))) delete aggregate.did;
  }
}

function dropStringIps(value: unknown, depth: number) {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) dropStringIps(item, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (key === "ip_address" && typeof item === "string") delete record[key];
    else dropStringIps(item, depth + 1);
  }
}
