/**
 * The Zoe chat design preview (/patient/zoe/preview): demo journeys built from the chat kit, for Khikar and the
 * founders to approve on a phone. Off unless NOREON_ZOE_CHAT_DESIGN_PREVIEW is exactly "true"; it saves and sends
 * nothing either way. Remove with the route once the real chat uses the kit (output/zoe-chat-design/DESIGN.md §7).
 */
export const ZOE_CHAT_DESIGN_PREVIEW = "NOREON_ZOE_CHAT_DESIGN_PREVIEW";
export function zoeChatDesignPreviewEnabled(env: Record<string, string | undefined> = process.env) {
  return env[ZOE_CHAT_DESIGN_PREVIEW] === "true";
}

/** The live chat in the kit's look, member by member journey, until the founders approve it. Look only: no behaviour changes. */
export function zoeChatKitEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NOREON_ZOE_CHAT_KIT === "true";
}
