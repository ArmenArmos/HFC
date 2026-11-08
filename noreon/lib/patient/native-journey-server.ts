import "server-only";
import { claimNativeMemberRequest } from "@/lib/security/native-admission-server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createDatabasePatientStore } from "./database-store";
import { untilAbort } from "./native-journey";
type Environment = Record<string, string | undefined>;
export function nativeJourneyEnabled(env: Environment) {
  return (
    env.NOREON_NATIVE_JOURNEY_ENABLED === "true" &&
    env.NOREON_DEPLOYMENT_TARGET === "app"
  );
}
export async function createNativeJourneyContext(
  token: string,
  signal: AbortSignal,
  env: Environment,
  fetcher: typeof fetch = fetch,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL,
    key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !secret) throw Error("unavailable");
  const scopedFetch: typeof fetch = (input, init) => {
    signal.throwIfAborted();
    const caller =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const combined = caller ? AbortSignal.any([signal, caller]) : signal;
    return untilAbort(fetcher(input, { ...init, signal: combined }), combined);
  };
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const reader = createClient<Database>(url, key, {
    ...options,
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: scopedFetch,
    },
  });
  const { data, error } = await untilAbort(reader.auth.getUser(token), signal);
  signal.throwIfAborted();
  if (error || !data.user?.phone || !data.user.phone_confirmed_at) return null;
  const user = { userId: data.user.id, phone: data.user.phone };
  // Construct the privileged writer only after remote token/phone verification.
  const writer = () => {
    signal.throwIfAborted();
    return createClient<Database>(url, secret, {
      ...options,
      global: { fetch: scopedFetch },
    });
  };
  return {
    user,
    admit: async () => claimNativeMemberRequest(writer(), user.userId, signal),
    store: createDatabasePatientStore(async () => {
      signal.throwIfAborted();
      return reader;
    }, writer),
  };
}
