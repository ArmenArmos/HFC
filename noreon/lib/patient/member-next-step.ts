/** The member chat shows the next step after each stage as plain text and a link. Own switch, off by default; needs NOREON_MEMBER_CHAT_V2. */
export function memberNextStepEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_MEMBER_NEXT_STEP === "true";
}
