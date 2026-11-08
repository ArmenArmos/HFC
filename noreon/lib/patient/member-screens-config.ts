/** Presentation only. Clinical permissions, publication and other feature gates still apply. */
export function memberScreensPrototypeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOREON_MEMBER_SCREENS_PROTOTYPE === "true";
}
