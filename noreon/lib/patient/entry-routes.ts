import { newChatHome } from "@/lib/patient/member-chat-config";

/**
 * Where the member entry pages send a member instead of drawing themselves. One place, so a change to any hop can be
 * walked for cycles (scripts/check-entry-routes.ts): on 4 Nov production looped chat -> profile -> zoe -> chat for a member
 * whose profile was not saved yet, because /patient/zoe sent every member to the new chat and the chat sent the unregistered
 * ones back through the profile page.
 */
export type EntryFacts = { registered: boolean; urgent: boolean; profile: boolean; consent: boolean };
export type EntryEnv = { chatOnly: boolean; chatV2: boolean; v3: boolean; emergencyCard: boolean };
export const NOT_FOUND = "notfound";

/** /patient/chat: where it goes instead of drawing the chat (null means it draws). */
export function chatHop(f: Pick<EntryFacts, "registered" | "urgent">, env: Pick<EntryEnv, "chatV2" | "emergencyCard">): string | null {
  if (!env.chatV2) return NOT_FOUND;
  if (!f.registered) return "/patient/profile";
  if (f.urgent && !env.emergencyCard) return "/patient/urgent";
  return null;
}

/** /patient/profile with the chat-only presentation on: the chat pages own the profile step. */
export function profileHop(f: Pick<EntryFacts, "profile" | "consent">, env: Pick<EntryEnv, "chatOnly">, view?: string | string[]): string | null {
  if (!env.chatOnly || view === "classic") return null;
  return f.profile && f.consent ? "/patient/zoe?card=account" : "/patient/zoe";
}

/**
 * /patient/zoe: a plain visit opens the new chat only when /patient/chat would really draw it. A member that the chat
 * would send to the profile step stays here, where the older chat-only page runs the profile and questionnaire itself.
 */
export function zoeChatHop(
  f: Pick<EntryFacts, "registered" | "urgent">,
  env: Pick<EntryEnv, "chatV2" | "v3" | "emergencyCard">,
  params: { view?: string | string[]; card?: string | string[]; section?: string | string[] },
): string | null {
  const on = newChatHome(params, { NOREON_ZOE_APP_V3: env.v3 ? "true" : undefined, NOREON_MEMBER_CHAT_V2: env.chatV2 ? "true" : undefined });
  return on && chatHop(f, env) === null ? "/patient/chat" : null;
}
