/** One default-off switch for the prototype Home and member navigation treatment. */
export function memberHomeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_MEMBER_HOME_PROTOTYPE === "true";
}
