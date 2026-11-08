import { memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";

/** Zoe app V3. With the new chat (NOREON_MEMBER_CHAT_V2) on, /patient/chat shows the reading card and the dialog order, the care queue is read, and the read-only overview is available. */
export function zoeAppV3Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_ZOE_APP_V3 === "true";
}
/** The medicines card: the classic member chat, or the new chat under V3. */
export function medicinesCardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return memberChatOnlyEnabled(env) || (zoeAppV3Enabled(env) && env.NOREON_MEMBER_CHAT_V2 === "true");
}
/** The source each questionnaire save records: the member's own answer, under V3 only. */
export const anamnesisSource = (): string | null => zoeAppV3Enabled() ? "patient_reported_anamnesis" : null;

/** Existing inline booking and plan views, also available in the V3 chat. */
export function journeyCardsEnabled(env:Record<string,string|undefined>=process.env):boolean{
 return memberChatOnlyEnabled(env)||(zoeAppV3Enabled(env)&&env.NOREON_MEMBER_CHAT_V2==='true');
}

/** The overview lives inside the new chat, so it needs that switch too. */
export function memberOverviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_MEMBER_CHAT_V2 === "true" && zoeAppV3Enabled(env);
}
