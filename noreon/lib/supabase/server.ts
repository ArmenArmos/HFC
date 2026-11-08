import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/types";
import { withStaleClockRetry } from "./postgrest-retry";

/**
 * Server-side Supabase client bound to the request's cookies. Runs as the signed-in
 * user, so RLS still applies — this is the default for server components, route
 * handlers and server actions.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: withStaleClockRetry() },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component, where cookies are read-only. Safe to
            // ignore: middleware already refreshed the session for this request.
          }
        },
      },
    },
  );
}
