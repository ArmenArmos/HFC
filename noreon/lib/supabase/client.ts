import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/types";

/**
 * Browser-side Supabase client. Only ever sees the publishable/anon key, so every
 * query it makes is subject to RLS. Never import this from server code.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
