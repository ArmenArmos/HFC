/**
 * Which account a member page belongs to (QA a6-01). Sign-in cookies are shared by every tab of a browser, so after
 * someone else signs in, a page rendered for the first member still sends its requests under the second account: its
 * writes land there, and its soft navigations and polls bring that account's data back into this tab (BC-02). The
 * layout does not re-render for those, so the tab cannot notice from what comes back. Each page therefore names the
 * account it was rendered for on every member request, reads included, and the proxy refuses one whose session is
 * someone else before anything runs. It guards against a mix-up in a member's own browser, not an attacker: Row Level
 * Security stays the access boundary, and a request without the header is judged by its session alone.
 */
/** Browser to proxy, on member requests: the account this page was rendered for. */
export const MEMBER_BINDING_HEADER = "x-noreon-member-page";
/** The binding of a page rendered with no account. It matches no session, so under a session the write is refused (Astra R1). */
export const NO_ACCOUNT = "none";
/** Proxy to browser: this request was refused because another account is signed in. Tells it from any other 409. */
export const ACCOUNT_CHANGED_HEADER = "x-noreon-account-changed";
/** Proxy to browser: the session could not be checked, so this request was not run and is safe to send again. */
export const ACCOUNT_UNCHECKED_HEADER = "x-noreon-account-unchecked";
/** Proxy to the member layout: the account the proxy verified. Removed from what the browser sends. */
export const VERIFIED_MEMBER_HEADER = "x-noreon-verified-member";

/**
 * The 103 screen: static guidance with no member data. A session that ends while someone types urgent words never costs
 * it, and nothing about an account may slow or cover the way to it.
 */
export const OPEN_WITHOUT_SESSION = "/patient/zoe/urgent";
/**
 * How long a Server Action may go unanswered before it reads as failed (BC-03). The wait has to end at the fetch: Next
 * runs Server Actions one at a time, so one that never answers would hold "Try again" behind it for ever.
 */
export const ACTION_TIMEOUT_MS = 25_000;

/** No session is not another account: that request goes on to its own session check. */
export const accountChanged = (expected: string | null, user: { id: string } | null | undefined) =>
  !!expected && !!user && user.id !== expected;

const memberPath = (path: string) => /^\/(?:api\/)?patient(?:\/|$)/.test(path);

const inputUrl = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input));

const UNCHECKED_RETRIES = 2;
const unchecked = (response: Response) => response.status === 503 && response.headers.has(ACCOUNT_UNCHECKED_HEADER);

/** The page itself, without Next's cache-busting marker. */
const pageUrl = (url: URL) => {
  const page = new URL(url);
  page.searchParams.delete("_rsc");
  return page.href;
};

/** Held on purpose: the page is covered or leaving, so nobody is left to read an answer. */
const held = () => new Promise<Response>(() => {});

/**
 * The request, aborted if its whole reply is not in within ms. Next only reports the failure once the fetch itself has
 * ended, and it waits for the body too, so the deadline outlasts the headers (Astra BC-R1): a clone is read to the end,
 * which leaves the reply for Next untouched. An abort errors both.
 */
async function answeredWithin(send: (signal: AbortSignal) => Promise<Response>, ms: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    const response = await send(abort.signal);
    void response.clone().arrayBuffer().catch(() => null).finally(() => clearTimeout(timer));
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/** Adds the binding to this page's own member requests, and stops the page when one is refused. */
export function boundFetch(
  original: typeof fetch,
  page: {
    origin: string;
    bound: () => string | null;
    signInPage: () => boolean;
    onRefused: (request: "read" | "write") => void;
    /** Leaves for a full load, which gets the page and its account from one request. */
    fullLoad: (url: string) => void;
    retryDelayMs?: number;
    actionTimeoutMs?: number;
  },
): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(inputUrl(input), page.origin);
    const read = method === "GET" || method === "HEAD";
    if (url.origin !== page.origin || !memberPath(url.pathname) || (read && url.pathname === OPEN_WITHOUT_SESSION)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const bound = page.bound();
    // Fail closed: a soft navigation's answer would land in a tab that cannot tell whose it is. A full load can.
    if (!bound && read && headers.has("rsc")) {
      if (headers.has("next-router-prefetch")) return new Response(null, { status: 204 });
      page.fullLoad(pageUrl(url));
      return held();
    }
    // Only the sign-in page writes unbound: its actions create the session, and no member's form is on it.
    const account = bound ?? (page.signInPage() ? null : NO_ACCOUNT);
    if (!account) return original(input, init);
    headers.set(MEMBER_BINDING_HEADER, account);
    const action = headers.has("next-action");
    const send = () => action
      ? answeredWithin((signal) => original(input, { ...init, headers, signal }), page.actionTimeoutMs ?? ACTION_TIMEOUT_MS)
      : original(input, { ...init, headers });
    let response = await send();
    // Auth blinked: nothing ran, so try again in a moment. If it stays down the caller sees what it sees when offline.
    for (let tries = 0; unchecked(response); tries++) {
      if (tries === UNCHECKED_RETRIES || input instanceof Request) throw new TypeError("The session could not be checked");
      await new Promise((resolve) => setTimeout(resolve, page.retryDelayMs ?? 800));
      response = await send();
    }
    if (response.status !== 409 || !response.headers.has(ACCOUNT_CHANGED_HEADER)) return response;
    page.onRefused(read ? "read" : "write");
    // The whole page is covered by the refusal, and a form that got an answer here would report it as its own failure,
    // or retry into the same refusal, behind a screen that says nothing was saved.
    return held();
  };
}
