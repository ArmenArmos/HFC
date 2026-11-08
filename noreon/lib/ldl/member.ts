import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readMemberLdl, type LdlRpc } from "./runtime";

/** Progress and Home: the member's own LDL goal (dark, database switch). Undefined shows nothing. */
export async function memberLdl() {
  return readMemberLdl((await createClient()) as unknown as LdlRpc);
}
