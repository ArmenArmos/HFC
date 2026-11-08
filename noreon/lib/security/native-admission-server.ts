import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseNativeAdmission } from "./native-admission";
/** Caller supplies only a remotely verified owner and its abort-aware server client. */
export async function claimNativeMemberRequest(
  client: SupabaseClient<Database>,
  owner: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { data, error } = await client.rpc("claim_native_member_request", {
    p_owner: owner,
  });
  signal.throwIfAborted();
  if (error || !Array.isArray(data) || data.length !== 1)
    throw Error("unavailable");
  return parseNativeAdmission(data[0]);
}
