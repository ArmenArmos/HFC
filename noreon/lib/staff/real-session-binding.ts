import "server-only";
import {noteActor} from '@/lib/observability/context';
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { z } from "zod";
type SessionAuth = Pick<SupabaseClient<Database>["auth"], "getSession" | "getUser" | "getClaims">;
const claimsSchema = z.object({sub:z.uuid(),session_id:z.uuid()});
/** The exact token is validated remotely and cryptographically before its session claim is used. */
export async function validatedStaffSession(auth:SessionAuth, accessToken?:string) {
  let token=accessToken;
  if(!token) {
    const cached=await auth.getSession();
    if(cached.error && (!cached.error.status || cached.error.status>=500)) throw Error("Account setup temporarily unavailable.");
    token=cached.data.session?.access_token;
  }
  if(!token) return null;
  const result=await auth.getUser(token);
  if(result.error && (!result.error.status || result.error.status>=500)) throw Error("Account setup temporarily unavailable.");
  const user=result.data.user;
  if(result.error || !user?.email || !user.email_confirmed_at) return null;
  const verified=await auth.getClaims(token);
  if(verified.error) throw Error("Account setup temporarily unavailable.");
  const claims=claimsSchema.safeParse(verified.data?.claims);
  if(!claims.success || claims.data.sub!==user.id) return null;
  noteActor('staff',user.id);
  return {user,sessionId:claims.data.session_id,claims:verified.data!.claims};
}
