import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";
import { clinicHostAllowed, clinicPortalEnabled } from "@/lib/clinic-portal/config";
import { realReviewEnabled } from "@/lib/patient-care/real-review-config";

/**
 * The backoffice root renders the shared sign-in page. Refresh each portal's own session
 * cookie here (as /staff/real and /clinic/real requests do) so the page can send a signed-in
 * visitor on without a server component rotating a token it cannot save.
 */
export async function backofficeRootRewrite(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const names = [
    ...(realReviewEnabled(process.env) ? ["noreon-real-staff-auth"] : []),
    ...(clinicPortalEnabled() && clinicHostAllowed(host) ? ["noreon-real-clinic-auth"] : []),
  ];
  const written: { name: string; value: string; options: object }[] = [];
  // Only page loads refresh; a sign-in POST sets its own cookie and must not race a refresh.
  if (url && key && (request.method === "GET" || request.method === "HEAD")) for (const name of names) {
    if (!request.cookies.getAll().some((c) => c.name.startsWith(name))) continue;
    const client = createServerClient<Database>(url, key, {
      cookieOptions: { name, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) { for (const { name, value, options } of values) { request.cookies.set(name, value); written.push({ name, value, options }); } },
      },
    });
    await client.auth.getUser();
  }
  const response = NextResponse.rewrite(new URL(`/staff/real/login${request.nextUrl.search}`, request.url), { request });
  for (const { name, value, options } of written) response.cookies.set(name, value, options);
  return response;
}
