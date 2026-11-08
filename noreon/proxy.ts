import { NextResponse, type NextRequest } from "next/server";
import { updateClinicSession } from "@/lib/clinic-portal/session";
import { MEMBER_APP_ORIGIN, memberAppAccess } from "@/lib/deployment";
import { updateSession } from "@/lib/supabase/session";
import { MEMBER_BINDING_HEADER } from "@/lib/patient/account-binding";
import { backofficeHost, demoStaffHostAllowed, legacyStaffEntryRedirect, staffPathAllowed, staffPortalForHost } from "@/lib/staff/hosts";
import { clinicPortalEnabled } from "@/lib/clinic-portal/config";
import { backofficeRootRewrite } from "@/lib/backoffice/session";
import { updateStaffSession } from "@/lib/staff/session";
import { realReviewEnabled } from "@/lib/patient-care/real-review-config";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, propagateRequestId, requestIdFrom } from "@/lib/observability/request-id";
import { clientIpPrefix, cookieActor, country, uaFamily } from "@/lib/observability/request-meta";
import { isLocale } from "@/lib/locale";

const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|css|js|map|txt|xml|webmanifest)$/i;

/**
 * Every request gets an id (kept from x-request-id when it looks like one) that the app
 * reads through headers() and every response returns, plus one log line per request,
 * public and prerendered pages included (static files are skipped). The line carries the
 * sign-in cookie kind, browser family, country and a /24 or /48 network, never the full IP.
 * The line is buffered and sent after the response; nothing here waits on the network.
 * See docs/operations/logging.md.
 */
export async function proxy(request: NextRequest) {
  const started = performance.now();
  const requestId = requestIdFrom(request.headers);
  request.headers.set(REQUEST_ID_HEADER, requestId);
  // Layouts and pages must use the same URL language, ahead of the saved preference.
  const locale = request.nextUrl.searchParams.get("locale");
  request.headers.delete("x-noreon-staff-locale");
  if (request.nextUrl.pathname.startsWith("/staff/") && isLocale(locale)) request.headers.set("x-noreon-staff-locale", locale);
  const response = await routeRequest(request);
  try {
    propagateRequestId(response, request.headers, requestId);
    const path = request.nextUrl.pathname;
    // The matcher already skips /_next/static and /_next/image; other static files are not logged.
    if (!STATIC_FILE.test(path)) {
      const outcome = response.headers.has("x-middleware-next") ? "next" : response.headers.has("x-middleware-rewrite") ? "rewrite"
        : response.status >= 300 && response.status < 400 ? "redirect" : response.status === 404 ? "not_found" : response.status >= 400 ? "denied" : "ok";
      log.info("proxy", {
        request_id: requestId,
        route: path,
        method: request.method,
        route_type: "proxy",
        status: response.status,
        outcome,
        duration_ms: performance.now() - started,
        actor_kind: cookieActor(request.cookies.getAll().map((cookie) => cookie.name)),
        ua_family: uaFamily(request.headers.get("user-agent")),
        country: country(request.headers),
        ip_prefix: clientIpPrefix(request.headers),
      });
    }
  } catch {
    // The id and the log line must never change what the request does.
  }
  return response;
}

/** Retired product entry points return to the informational homepage. */
function routeRequest(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const path = request.nextUrl.pathname;
  // One sign-in page at the backoffice root for staff and clinic (Khikar, 17 Oct). The old
  // login addresses redirect there; "/" renders the shared page without changing the address.
  const backoffice = backofficeHost(host) && (realReviewEnabled(process.env) || clinicPortalEnabled());
  if (backoffice && (path === "/staff/real/login" || path === "/clinic/real/login") && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(new URL(`/${request.nextUrl.search}`, request.url));
  }
  if (backoffice && path === "/") return backofficeRootRewrite(request);
  if (path === "/clinic/real" || path.startsWith("/clinic/real/")) return updateClinicSession(request);
  const legacyEntry = legacyStaffEntryRedirect(host, path, request.method);
  if (legacyEntry) return NextResponse.redirect(new URL(legacyEntry, request.url));
  if (!staffPathAllowed(host, path) || path === "/patient/doctor" || path.startsWith("/patient/doctor/") || path === "/patient/backoffice" || path.startsWith("/patient/backoffice/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const portal = staffPortalForHost(host);
  if (portal && path === "/") {
    if (realReviewEnabled(process.env)) return NextResponse.redirect(new URL("/staff/real/members", request.url));
    if (demoStaffHostAllowed(host)) return NextResponse.redirect(new URL(`/staff/${portal === "admin" ? "backoffice" : "doctor"}`, request.url));
    return new NextResponse("Not found", { status: 404 });
  }
  if (path.startsWith("/staff")) return updateStaffSession(request);
  // A member page's request to a route under /api/patient gets the same account check as one under /patient.
  if (path.startsWith("/api/patient/") && request.headers.has(MEMBER_BINDING_HEADER)) return updateSession(request);
  if (!path.startsWith("/patient") && !/^\/(login|auth|welcome|health-questions)(\/|$)/.test(path)) return NextResponse.next({ request });
  if (path.startsWith("/patient")) {
    const access = memberAppAccess(host);
    if (access === "redirect") return NextResponse.redirect(new URL(`${path}${request.nextUrl.search}`, MEMBER_APP_ORIGIN), 307);
    if (access === "not-found" || process.env.NOREON_DEPLOYMENT_TARGET === "marketing") {
      return new NextResponse("Not found", { status: 404 });
    }
    // Public script, member-host rules still apply. Its directory limits scope to /patient/.
    // The static offline page (WP R) the worker stores at install: no session, no member data.
    if (path === "/patient/sw.js" || path === "/patient/offline.html") return NextResponse.next({ request });
    return updateSession(request);
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    // Every path except Next's static assets: the session guard (PROTECTED_PREFIXES in
    // lib/supabase/session.ts) and the request log see all routes.
    "/((?!_next/static|_next/image).*)",
  ],
};
