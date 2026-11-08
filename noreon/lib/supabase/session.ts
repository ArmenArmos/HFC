import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ACCOUNT_CHANGED_HEADER, ACCOUNT_UNCHECKED_HEADER, MEMBER_BINDING_HEADER, OPEN_WITHOUT_SESSION, VERIFIED_MEMBER_HEADER, accountChanged } from "@/lib/patient/account-binding";
import { authServiceUnavailable } from "@/lib/supabase/auth-availability";
import { continuePath } from '@/lib/patient/continue-path';

/**
 * Routes that require a member session. The proxy matcher (proxy.ts) sees every path except
 * Next's static assets, so this list is the only place to add a protected prefix. A signed-out
 * visit goes to sign-in with ?next=, so every page a one-tap link opens (CONTINUE_PATHS in
 * lib/patient/continue-path.ts) must be here, or the member lands on Home after signing in.
 */
const PROTECTED_PREFIXES = [
  "/patient/zoe",
  "/patient/chat",
  "/patient/care",
  "/patient/results",
  "/patient/progress",
  "/patient/review",
  "/patient/profile",
  "/patient/ready",
  "/patient/dashboard",
  "/patient/questions",
  "/patient/urgent",
  "/patient/measurements",
  "/patient/account",
  "/patient/example",
  // WP F: the caregiver surface (members cared for, invitations).
  "/patient/caring",
];

/**
 * A server action posted from Zoe's chat also passes: urgent text sent as the session ended must reach the red check.
 * Nothing opens by this: an action is reachable at any path, and each one checks its own session.
 */
const zoeActionPost = (request: NextRequest) => request.method === "POST" && (request.nextUrl.pathname === "/patient/zoe" || request.nextUrl.pathname === "/patient/chat") && request.headers.has("next-action");
/**
 * A Server Action is never sent to sign-in: it answers for itself, so an ended session reaches the form as a reply, and
 * what the member typed stays (BC-05). Redirected, Next forwards it back here and the reply is lost. This opens nothing:
 * the same action is reachable from /patient, which is not protected, and each one checks its own session.
 */
const actionPost = (request: NextRequest) => request.method === "POST" && request.headers.has("next-action");

/** Hands the layout a value from here, the way propagateRequestId does for the request id. */
function forwardToApp(response: NextResponse, name: string, value: string) {
  const out = response.headers;
  const keys = (out.get("x-middleware-override-headers") ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (!keys.includes(name)) out.set("x-middleware-override-headers", [...keys, name].join(","));
  out.set(`x-middleware-request-${name}`, value);
}

export async function updateSession(request: NextRequest) {
  request.headers.delete(VERIFIED_MEMBER_HEADER);
  // Demo pages enforce their isolated encrypted session on the server.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Before Supabase is configured, pass through rather than throwing. A proxy
  // that crashes takes down every route it matches, which makes a fresh clone
  // look broken rather than unconfigured.
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // A response that carries a refreshed session must never be cached and replayed.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not remove: this refreshes the auth token and must run before any redirect.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // A refresh above rotated the tokens; a refusal that dropped it would sign the member out.
  const refuse = (status: number, marker: string) => {
    const refused = NextResponse.json({ error: "account_check" }, { status, headers: { "Cache-Control": "no-store", [marker]: "1" } });
    for (const cookie of response.cookies.getAll()) refused.cookies.set(cookie);
    return refused;
  };
  const expected = request.headers.get(MEMBER_BINDING_HEADER);
  // A page rendered for one member never writes as another, or receives another's data (QA a6-01, BC-02): this runs
  // before any action, page or route handler.
  if (accountChanged(expected, user)) return refuse(409, ACCOUNT_CHANGED_HEADER);
  // Unchecked is not allowed through (Astra R1), except Zoe's chat action: urgent text must reach the red check, and
  // patientIdentity makes the same comparison before anything is stored for the member.
  const authDown = !user && authServiceUnavailable(error);
  if (expected && authDown && !zoeActionPost(request)) return refuse(503, ACCOUNT_UNCHECKED_HEADER);

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // The auth service failing is not a sign-out (QA A1-obs): the page's own check shows the retry.
  if (!user && !authDown && isProtected && pathname !== OPEN_WITHOUT_SESSION && !actionPost(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/patient";
    const notice = request.nextUrl.searchParams.get('notice');
    const target = pathname === '/patient/chat' && notice ? continuePath(`${pathname}?notice=${notice}`) : null;
    url.searchParams.set("next", target ?? pathname);
    return NextResponse.redirect(url);
  }

  if (user) forwardToApp(response, VERIFIED_MEMBER_HEADER, user.id);
  return response;
}
