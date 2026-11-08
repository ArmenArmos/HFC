/** Presentation only. Chat access, consent and action permissions keep their own gates. */
export function memberChatOnlyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_MEMBER_CHAT_ONLY === "true";
}

/** Chat intake uses the same consent and questionnaire engine; red still opens the urgent route. */
export function memberChatDestination({ enabled, view, urgent }: {
  enabled: boolean; view?: string | string[]; complete: boolean; urgent: boolean;
}): "/patient/urgent" | "/patient/questions" | "/patient/zoe" | null {
  if (!enabled || view === "classic") return null;
  if (urgent) return "/patient/urgent";
  return "/patient/zoe";
}

/**
 * With the new chat and Zoe app V3 both on, the member chat is /patient/chat, and a plain /patient/zoe opens it.
 * A deep link to a card or section and ?view=classic stay on the previous page, which is the way back.
 */
export function newChatHome({ view, card, section }: { view?: string | string[]; card?: string | string[]; section?: string | string[] }, env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_ZOE_APP_V3 === "true" && env.NOREON_MEMBER_CHAT_V2 === "true" && view !== "classic" && !card && !section;
}
