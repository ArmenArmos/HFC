import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseStatus, textSize, type MemberContactStatus, type TextSize } from "./member-preferences-contract";

/**
 * The member's text size for every patient page. Presentation only: any failure, or no
 * session, is Normal. The row is read through RLS, so no session simply finds nothing.
 */
export async function readMemberTextSize(): Promise<TextSize> {
  try {
    const { data, error } = await (await createClient()).from("member_preferences").select("text_size").maybeSingle();
    return error ? "normal" : textSize.catch("normal").parse(data?.text_size);
  } catch {
    return "normal";
  }
}

export async function readMemberContactStatus(): Promise<MemberContactStatus> {
  const { data, error } = await (await createClient()).rpc("member_contact_status");
  if (error) throw Error("Contact preferences unavailable");
  return { mode: "member", ...parseStatus(data) };
}
